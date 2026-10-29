#!/usr/bin/env python3
"""AIOStreams -> IINA subtitle bridge v0.5.1 (Python 3 stdlib only).

The player link passes video, title, resume seconds, and repeated subtitle URLs.
Download subtitles and, when those URLs refer to AIOStreams Jellyfin routes,
look up language/source titles from the *same* server's PlaybackInfo API.
Missing metadata never prevents video playback. Signed URLs are never logged.
"""

import concurrent.futures
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

import callback_session
import identity_context

VERSION = "0.7.3-beta.1"
SCHEME = "aios-iina"
BETA_SCHEME = "aios-iina-beta"
MAX_URL_CHARS = 100000
MAX_VALUE_CHARS = 24000
MAX_SUBTITLES = 10  # AIOStreams player external-subtitle cap
MAX_SUB_BYTES = 4 * 1024 * 1024
MAX_META_BYTES = 2 * 1024 * 1024
# Playback preference for subtitles returned by AIOStreams.
# Embedded subtitles remain available in IINA; external VI/EN tracks are
# ranked first when metadata is present, without discarding other languages.
PREFERRED_SUBTITLE_LANGUAGES = ("VI", "EN")
MPV_SUBTITLE_LANGUAGES = "vi,vie,en,eng"
CACHE_ROOT = Path.home() / "Library" / "Caches" / "AIO-IINA-Bridge"
LOG_FILE = Path.home() / "Library" / "Logs" / "AIO-IINA-Bridge.log"

SUBTITLE_ROUTE = re.compile(
    r"^(?P<base>.*)/Videos/(?P<item>[0-9A-Za-z-]{8,128})/"
    r"(?P<source>[0-9A-Za-z-]{8,128})/Subtitles/"
    r"(?P<index>\d{1,6})(?:/\d+)?/Stream\.(?:vtt|srt|ass|ssa)$",
    re.IGNORECASE,
)
LANG_SHORT = {
    "vi": "VI", "vie": "VI", "vietnamese": "VI",
    "en": "EN", "eng": "EN", "english": "EN",
    "ja": "JA", "jpn": "JA", "jp": "JA",
    "ko": "KO", "kor": "KO", "zh": "ZH", "chi": "ZH", "zho": "ZH",
    "zh-cn": "ZH-CN", "zh-tw": "ZH-TW", "th": "TH", "tha": "TH",
    "id": "ID", "ind": "ID", "fr": "FR", "fre": "FR", "fra": "FR",
}


def log(message):
    # Never print/store full stream or subtitle URLs (they may carry keys).
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(datetime.datetime.now(datetime.timezone.utc).isoformat() + " " + message + "\n")
    except OSError:
        pass


def valid_http_url(value):
    if not isinstance(value, str) or not value or len(value) > MAX_VALUE_CHARS:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    try:
        u = urllib.parse.urlsplit(value)
        return u.scheme.lower() in ("https", "http") and bool(u.hostname) and not u.username and not u.password
    except ValueError:
        return False


def normalize_legacy_hls_title_marker(media):
    """Repair legacy AIO HLS path suffix, preserving query bytes and other URLs.

    Some upstream links percent-encode the old #aios_title fragment into the
    HLS path, yielding index.m3u8%23aios_title=... and a failing HTTP request.
    Only remove that exact terminal suffix after .m3u8, never arbitrary
    percent-encoded paths, authorization parameters or valid signed URLs.
    """
    parts = urllib.parse.urlsplit(media)
    # AIO custom-link substitution may decode %23 into a real # before this
    # function sees the nested media URL. IINA can then encode it again as a
    # literal path suffix, which fails on CDN HLS endpoints.
    if parts.path.lower().endswith(".m3u8") and parts.fragment.lower().startswith("aios_title="):
        return urllib.parse.urlunsplit(parts._replace(fragment=""))
    marker = re.search(r"(?i)(?<=\.m3u8)%23aios_title=[^/]+$", parts.path)
    if marker is None:
        return media
    return urllib.parse.urlunsplit(parts._replace(path=parts.path[:marker.start()]))


def parse_link(raw):
    if len(raw) > MAX_URL_CHARS:
        raise ValueError("custom link too long")
    parts = urllib.parse.urlsplit(raw)
    if parts.scheme.lower() not in (SCHEME, BETA_SCHEME) or parts.netloc.lower() != "play":
        raise ValueError("unexpected link scheme/host")
    params = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)

    def first(name, default=""):
        return next((value for key, value in params if key == name), default)

    media = first("url")
    if not valid_http_url(media):
        raise ValueError("invalid media URL")
    media = normalize_legacy_hls_title_marker(media)
    title = first("title")[:240]
    pos_text = first("position", "0")
    if not pos_text.isascii() or not pos_text.isdecimal():
        raise ValueError("invalid resume position")
    position = int(pos_text)
    if position > 100000000:
        raise ValueError("resume position out of range")
    subtitles, seen = [], set()
    for key, value in params:
        if key == "sub" and valid_http_url(value) and value not in seen:
            seen.add(value)
            subtitles.append(value)
            if len(subtitles) == MAX_SUBTITLES:
                break
    context = first("context")
    if context and len(context) > 4096:
        context = ""
    # The AIO desktop callback uses aiostreams://return, not HTTP.
    if context and not (valid_http_url(context) or context.startswith("aiostreams://return/")):
        context = ""
    return media, title, position, subtitles, context


def safe_player_title(title):
    """Keep metadata readable without allowing control characters in CLI args."""
    if not title:
        return ""
    # NFKC is intentionally NOT used: keep AIOStreams' original human title.
    # `force-media-title` is metadata; never modify the HTTP playback URL.
    readable = "".join(" " if unicodedata.category(ch).startswith("C") else ch
                       for ch in title)
    return " ".join(readable.split())[:240].strip()


def cli_args(media, title, position, paths):
    args = ["--no-stdin"]
    if position:
        args.append("--mpv-start=" + str(position))
    if paths:
        for path in paths:
            if ":" in path:
                raise ValueError("unsupported colon in subtitle cache path")
        # mpv uses this priority for automatic track selection when the
        # filenames contain recognized .vi/.en suffixes. Keep all tracks
        # manually switchable; do not enable two simultaneous subtitles.
        args.append("--mpv-slang=" + MPV_SUBTITLE_LANGUAGES)
        args.append("--mpv-sid=auto")
        args.append("--mpv-sub-files=" + ":".join(paths))
    # v0.5.1: IINA CLI must receive the original playback URL unmodified.
    # Appending #aios_title to the URL broke VOD playback on IINA 1.5.0.
    # Trakt+ reads mpv's media-title property as a safe metadata fallback.
    player_title = safe_player_title(title)
    if player_title:
        args.append("--mpv-force-media-title=" + player_title)
    args.append(media)
    return args


def iina_cli_path():
    home = Path.home()
    candidates = [
        Path("/Applications/IINA.app/Contents/MacOS/iina-cli"),
        home / "Applications" / "IINA.app" / "Contents" / "MacOS" / "iina-cli",
    ]
    for path in candidates:
        if path.is_file() and os.access(str(path), os.X_OK):
            return str(path)
    return None


def choose_ext(data, content_type, subtitle_url):
    head = data[:256].decode("utf-8-sig", errors="replace").lstrip()
    low = head.lower()
    if low.startswith(("<!doctype html", "<html", "<?xml", "{")):
        return None
    if low.startswith("[") and not low.startswith(("[script info]", "[v4+ styles]")):
        return None
    if head.startswith("WEBVTT"):
        return "vtt"
    if head.startswith(("[Script Info]", "[V4+ Styles]")):
        return "ass"
    ext = urllib.parse.urlsplit(subtitle_url).path.rsplit(".", 1)[-1].lower()
    if ext in ("srt", "vtt", "ass", "ssa"):
        return ext
    if "vtt" in content_type:
        return "vtt"
    if "subrip" in content_type:
        return "srt"
    return "srt"


def fetch_subtitle(index, url, directory):
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "AIO-IINA-Bridge/" + VERSION,
            "Accept": "text/plain,text/vtt,*/*",
        })
        with urllib.request.urlopen(req, timeout=5) as response:
            if not 200 <= getattr(response, "status", 200) < 300:
                return None
            typ = (response.headers.get("Content-Type") or "").lower()
            if "html" in typ or "json" in typ:
                return None
            data = response.read(MAX_SUB_BYTES + 1)
        if not data or len(data) > MAX_SUB_BYTES or b"\x00" in data[:1024]:
            return None
        ext = choose_ext(data, typ, url)
        if not ext:
            return None
        dest = directory / ("AIOStreams-Sub-%02d.%s" % (index + 1, ext))
        with dest.open("xb") as f:
            f.write(data)
        return str(dest)
    except (OSError, urllib.error.URLError, ValueError, TimeoutError):
        return None


def metadata_route(subtitle_url):
    """AIOStreams subtitle URL -> PlaybackInfo URL + external track index.

    Use only its already-supplied API key/session and its *same-origin* base.
    No credential ever goes to a newly discovered host.
    """
    if not valid_http_url(subtitle_url):
        return None
    parts = urllib.parse.urlsplit(subtitle_url)
    match = SUBTITLE_ROUTE.match(parts.path)
    if not match:
        return None
    query = urllib.parse.parse_qs(parts.query)
    credentials = {}
    for key in ("ApiKey", "PlaySessionId"):
        value = next((v[0] for k, v in query.items() if k.lower() == key.lower() and v), None)
        if value is not None:
            credentials[key] = value
    credentials["MediaSourceId"] = match.group("source")
    meta_path = match.group("base") + "/Items/" + match.group("item") + "/PlaybackInfo"
    meta_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, meta_path, urllib.parse.urlencode(credentials), ""))
    return meta_url, int(match.group("index"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Avoid forwarding signed credentials to an unexpected redirect target.
        return None


def labels_from_playback_info(payload):
    """Map AIOStreams subtitle's URL index (1000+i) to verified track facts."""
    mapped = {}
    sources = payload.get("MediaSources") if isinstance(payload, dict) else None
    if not isinstance(sources, list):
        return mapped
    for source in sources[:8]:
        if not isinstance(source, dict):
            continue
        streams = source.get("MediaStreams")
        if not isinstance(streams, list):
            continue
        for stream in streams[:128]:
            if not isinstance(stream, dict) or stream.get("Type") != "Subtitle":
                continue
            delivery = stream.get("DeliveryUrl")
            if stream.get("DeliveryMethod") != "External" or not isinstance(delivery, str):
                continue
            match = SUBTITLE_ROUTE.match(urllib.parse.urlsplit(delivery).path)
            if not match:
                continue
            code = int(match.group("index"))
            title = stream.get("DisplayTitle") or stream.get("Title")
            lang = stream.get("Language")
            if isinstance(title, str) or isinstance(lang, str):
                mapped[code] = {
                    "title": title if isinstance(title, str) else "",
                    "lang": lang if isinstance(lang, str) else "",
                }
    return mapped


def fetch_metadata(subtitle_urls):
    """One best-effort request for the selected stream; falls back if unavailable.

    AIOStreams may answer 401/404 on older versions, in which case preserve
    v0.2's generic track names. This request NEVER blocks indefinitely.
    """
    routes = [(i, metadata_route(url)) for i, url in enumerate(subtitle_urls)]
    routes = [(i, r) for i, r in routes if r is not None]
    if not routes:
        return {}
    # Usually all subtitles belong to one MediaSourceId. Avoid many requests.
    metadata_url = routes[0][1][0]
    try:
        opener = urllib.request.build_opener(NoRedirect())
        req = urllib.request.Request(metadata_url, headers={
            "Accept": "application/json", "User-Agent": "AIO-IINA-Bridge/" + VERSION,
        })
        with opener.open(req, timeout=3) as response:
            if not 200 <= getattr(response, "status", 200) < 300:
                return {}
            data = response.read(MAX_META_BYTES + 1)
        if len(data) > MAX_META_BYTES:
            return {}
        mapping = labels_from_playback_info(json.loads(data.decode("utf-8")))
        return {
            i: mapping[route[1]]
            for i, route in routes
            if route[0] == metadata_url and route[1] in mapping
        }
    except (ValueError, UnicodeError, OSError, urllib.error.URLError, TimeoutError):
        return {}



# AIOStreams external-player links often contain subtitles only for the *list*'s
# initially enriched source.  Its native player asks PlaybackInfo for the exact
# chosen source; replay that read via the context URL AIOStreams itself supplies.
# No credentials are stored and no redirects are followed.
CONTEXT_ID = re.compile(r"^[a-fA-F0-9-]{8,128}$")


def return_context_info(return_url):
    """Use the AIOStreams-generated return URL, never infer the show from title."""
    if not valid_http_url(return_url):
        return None
    try:
        parsed = urllib.parse.urlsplit(return_url)
        # Browser return URLs carry a fragment like #/series/...?...&played=&source=
        # while Desktop may put these markers in the normal query.
        values = {}
        for candidate in (parsed.query, parsed.fragment.split("?", 1)[-1].replace("?", "&")):
            for k, v in urllib.parse.parse_qsl(candidate, keep_blank_values=True):
                if k in ("played", "source") and v:
                    values[k] = v
        item = values.get("played", "")
        source = values.get("source", "")
        if not CONTEXT_ID.fullmatch(item) or not CONTEXT_ID.fullmatch(source):
            return None
        path = re.sub(r"/web(?:/index\.html)?/?$", "", parsed.path, flags=re.IGNORECASE)
        if path == parsed.path or not path:
            # A root-mounted server uses /jellyfin/web (default for AIOStreams).
            # Do not guess a base on unrecognized URLs.
            if path == parsed.path:
                return None
        base = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
        return base, item, source
    except (TypeError, ValueError):
        return None


def selected_source_subtitles(return_url):
    """Best-effort PlaybackInfo GET for the selected source; returns (urls, facts).

    URLs are accepted only from the exact same origin and media/source IDs.
    Unknown/broken endpoints are ignored: playback then behaves exactly as v0.4.
    """
    parsed = return_context_info(return_url)
    if not parsed:
        return [], {}
    base, item, source = parsed
    endpoint = base + "/Items/" + item + "/PlaybackInfo?" + urllib.parse.urlencode({"MediaSourceId": source})
    try:
        req = urllib.request.Request(endpoint, headers={
            "Accept": "application/json",
            "User-Agent": "AIO-IINA-Bridge/" + VERSION,
        })
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=4) as response:
            if not 200 <= getattr(response, "status", 200) < 300:
                return [], {}
            body = response.read(MAX_META_BYTES + 1)
        if len(body) > MAX_META_BYTES:
            return [], {}
        payload = json.loads(body.decode("utf-8"))
        sources = payload.get("MediaSources", []) if isinstance(payload, dict) else []
        if not isinstance(sources, list):
            return [], {}
        result, facts = [], {}
        origin = urllib.parse.urlsplit(base)
        for entry in sources[:8]:
            if not isinstance(entry, dict):
                continue
            streams = entry.get("MediaStreams")
            if not isinstance(streams, list):
                continue
            for sub in streams[:300]:
                if not isinstance(sub, dict) or sub.get("Type") != "Subtitle" or sub.get("DeliveryMethod") != "External":
                    continue
                relative = sub.get("DeliveryUrl")
                if not isinstance(relative, str) or not relative:
                    continue
                if valid_http_url(relative):
                    url = relative
                elif relative.startswith("/"):
                    # Jellyfin DeliveryUrl is API-root-relative (/Videos/...),
                    # *not* website-root-relative (/jellyfin/Videos/...).
                    # Some servers already send the complete mount path.
                    api_mount = urllib.parse.urlsplit(base).path.rstrip("/")
                    url = urllib.parse.urlsplit(base).scheme + "://" + urllib.parse.urlsplit(base).netloc + (
                        relative if api_mount and relative.startswith(api_mount + "/")
                        else api_mount + relative
                    )
                else:
                    url = urllib.parse.urljoin(base.rstrip("/") + "/", relative)
                parsed_sub = urllib.parse.urlsplit(url)
                match = SUBTITLE_ROUTE.match(parsed_sub.path)
                if (parsed_sub.scheme != origin.scheme or parsed_sub.netloc != origin.netloc
                        or not match or match.group("item").lower().replace("-", "") != item.lower().replace("-", "")
                        or match.group("source").lower().replace("-", "") != source.lower().replace("-", "")):
                    continue
                if not valid_http_url(url) or url in facts:
                    continue
                result.append(url)
                facts[url] = {
                    "lang": sub.get("Language", ""),
                    "title": sub.get("DisplayTitle") or sub.get("Title") or "",
                }
        return result, facts
    except (ValueError, UnicodeError, OSError, urllib.error.URLError, TimeoutError):
        return [], {}


def merge_subtitle_candidates(passed_urls, selected_urls, selected_facts):
    """Exact selected-source API list first; then only a bounded link fallback.

    The API is authoritative when it responds with tracks; across variants do
    not borrow files silently, since subtitle timing can differ by release.
    """
    urls = selected_urls if selected_urls else passed_urls
    # Keep best languages even if the API offers dozens; avoid first-10 bias.
    urls = sorted(dict.fromkeys(urls), key=lambda u: subtitle_priority(selected_facts.get(u)))
    urls = urls[:MAX_SUBTITLES]
    return urls, {i: selected_facts[u] for i, u in enumerate(urls) if u in selected_facts}


def clean_label(value):
    if not isinstance(value, str):
        return ""
    normalized = unicodedata.normalize("NFKC", value)
    # Filenames must be safe, concise and not contain formatting/BiDi controls.
    filtered = "".join(
        " " if char in '/\\:*?\"<>|;' or unicodedata.category(char).startswith("C") else char
        for char in normalized
    )
    return re.sub(r"\s+", " ", filtered).strip(" .")[:95].strip(" .")


def normalized_language(facts):
    """ISO 639 variants from AIOStreams metadata; never infer from URL order."""
    if not isinstance(facts, dict):
        return ""
    raw = facts.get("lang")
    if not isinstance(raw, str):
        return ""
    raw = raw.strip().lower().replace("_", "-")
    # Accept region variants: vi-VN / en-US while keeping other languages.
    return LANG_SHORT.get(raw, LANG_SHORT.get(raw.split("-")[0], ""))


def subtitle_priority(facts):
    """VI first; EN second; other languages after; unknown last."""
    lang = normalized_language(facts)
    if lang in PREFERRED_SUBTITLE_LANGUAGES:
        return PREFERRED_SUBTITLE_LANGUAGES.index(lang)
    return len(PREFERRED_SUBTITLE_LANGUAGES) if lang else len(PREFERRED_SUBTITLE_LANGUAGES) + 1


def subtitle_filename(index, ext, facts):
    """Display metadata and append .vi/.en language suffix for mpv auto-pick."""
    if not facts:
        return "AIOStreams-Sub-%02d.%s" % (index + 1, ext)
    lang = normalized_language(facts)
    if not lang and facts.get("lang"):
        lang = clean_label(facts["lang"])[:12].upper()
    title = clean_label(facts.get("title", ""))
    if not lang and not title:
        return "AIOStreams-Sub-%02d.%s" % (index + 1, ext)
    components = ["AIOStreams-%02d" % (index + 1)]
    if lang:
        components.append("[" + lang + "]")
    if title:
        components.append(title)
    suffix = "." + lang.lower() if lang in PREFERRED_SUBTITLE_LANGUAGES else ""
    # mpv can identify .vi/.en in external subtitle filenames even when the
    # text subtitle itself has no embedded Language property.
    return " ".join(components) + suffix + "." + ext


def prepare_subtitles(urls, known_facts=None):
    if not urls:
        return [], 0
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(str(CACHE_ROOT), 0o700)
    except OSError:
        pass
    for old in CACHE_ROOT.iterdir():
        try:
            if old.is_dir() and not old.is_symlink() and time.time() - old.stat().st_mtime > 7 * 86400:
                shutil.rmtree(str(old))
        except OSError:
            continue
    directory = Path(tempfile.mkdtemp(prefix="play-", dir=str(CACHE_ROOT)))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_SUBTITLES + 1)
    futures = [pool.submit(fetch_subtitle, idx, url, directory) for idx, url in enumerate(urls)]
    meta_future = pool.submit(fetch_metadata, urls) if known_facts is None else None
    concurrent.futures.wait(futures + ([meta_future] if meta_future else []), timeout=8)
    files = [f.result() if f.done() and not f.cancelled() and f.exception() is None else None for f in futures]
    facts = known_facts if known_facts is not None else (meta_future.result() if meta_future.done() and meta_future.exception() is None else {})
    pool.shutdown(wait=False, cancel_futures=True)
    # Sort using server-confirmed subtitle language before passing to mpv.
    # Stable tie-break: retain AIOStreams source ordering within each language.
    available = [(i, Path(file)) for i, file in enumerate(files) if file]
    available.sort(key=lambda item: (subtitle_priority(facts.get(item[0])), item[0]))
    results, labelled = [], 0
    for order, (i, path) in enumerate(available):
        name = subtitle_filename(order, path.suffix.lstrip("."), facts.get(i))
        if name != path.name:
            try:
                target = path.with_name(name)
                path.rename(target)
                path = target
                labelled += bool(facts.get(i))
            except OSError:
                pass  # Still pass the original downloaded subtitle to IINA.
        results.append(str(path))
    return results, labelled


def language_counts(paths):
    """Count recognized VI/EN subtitle filenames without disclosing URLs."""
    counts = {"vi": 0, "en": 0, "other": 0}
    for path in paths:
        match = re.search(r"\.(vi|en)\.(?:vtt|srt|ass|ssa)$", Path(path).name, re.IGNORECASE)
        key = match.group(1).lower() if match else "other"
        counts[key] += 1
    return counts


def handle(raw):
    try:
        media, title, position, subtitles, context = parse_link(raw)
        incoming_media = next((value for key, value in urllib.parse.parse_qsl(
            urllib.parse.urlsplit(raw).query, keep_blank_values=True
        ) if key == "url"), "")
        legacy_marker_removed = incoming_media != media
        cli = iina_cli_path()
        if not cli:
            log("ERROR: IINA CLI not found in /Applications or ~/Applications")
            return 2
        selected_urls, selected_facts = selected_source_subtitles(context) if context else ([], {})
        urls, known_facts = merge_subtitle_candidates(subtitles, selected_urls, selected_facts)
        paths, labelled = prepare_subtitles(urls, known_facts if selected_urls else None)
        args = [cli] + cli_args(media, title, position, paths)
        # Read-only diagnostic: the first resume value is authored by AIOStreams.
        # Never write raw signed media/subtitle/return URLs, titles or tokens.
        # A missing 'position' is also parsed as zero for compatibility.
        # Log only parameter presence, never raw link or its signed values.
        position_fields = [
            v for k, v in urllib.parse.parse_qsl(
                urllib.parse.urlsplit(raw).query, keep_blank_values=True
            ) if k == "position"
        ]
        log("AIO_RESUME_INPUT_SECONDS=%d; position_present=%s; position_fields=%d" %
            (position, bool(position_fields), len(position_fields)))
        # AIO callback is opt-in: only explicit allow-listed Web origin or
        # aiostreams://return creates a short-lived, permission-restricted
        # descriptor. No signed stream URL is stored in it.
        session_id = None
        if context:
            try:
                session_id = callback_session.create_session(media, context)
            except (OSError, ValueError):
                # Callback is never allowed to break otherwise valid video playback.
                log("AIO_CALLBACK_SESSION=unavailable")
        # Session creation is independent from video playback. A failed allowlist
        # or missing returnUrl is observable without revealing the URL or token.
        log("AIO_CALLBACK_SESSION=%s; context_present=%s" %
            ("created" if session_id else "not-created", bool(context)))
        try:
            # No shell interpolation. Signed URLs are passed as argv, never logged.
            subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)
        except OSError:
            if session_id:
                callback_session.discard_session(session_id)
            raise
        # Optional, read-only identity lookup. IINA is ALREADY launched.
        # Never allow unavailable metadata, auth or API timeouts to block video.
        # Only sanitized, short-lived identity fields are written on success.
        identity_created = False
        if context:
            try:
                identity_created = identity_context.create_from_launch(media, title, context)
            except Exception:
                identity_created = False
        log("AIO_IDENTITY_CONTEXT=" + ("created" if identity_created else "not-created"))
        counts = language_counts(paths)
        log("IINA CLI submitted; v0.5.1 url_unchanged=%s; legacy_title_marker_removed=%s; external_subtitles=%d/%d; metadata_labels=%d; "
            "context_provided=%s; context_tracks=%d; passed_tracks=%d; priority=VI>EN; vi_tracks=%d; en_tracks=%d; other_tracks=%d; resumed=%s" %
            ("false" if legacy_marker_removed else "true",
             "true" if legacy_marker_removed else "false",
             len(paths), len(urls), labelled, bool(context), len(selected_urls), len(subtitles),
             counts["vi"], counts["en"], counts["other"], bool(position)))
        return 0
    except (ValueError, OSError) as exc:
        log("ERROR: invalid link or launcher failure (%s)" % type(exc).__name__)
        return 1


def self_test():
    raw = ("aios-iina://play?url=https%3A%2F%2Fexample.com%2Fwatch%3Fx%3D1%26y%3D2"
           "&title=Example%20S01E02&position=93"
           "&sub=https%3A%2F%2Fsub.example.com%2Fvie.srt%3Ftoken%3DA%2526B"
           "&sub=https%3A%2F%2Fsub.example.com%2Feng.srt")
    media, title, pos, subs, context = parse_link(raw)
    beta_raw = BETA_SCHEME + raw[len(SCHEME):]
    assert parse_link(beta_raw) == (media, title, pos, subs, context)
    assert pos == 93 and title == "Example S01E02" and len(subs) == 2 and not context
    assert subs[0].endswith("token=A%26B")
    cmd = cli_args(media, title, pos, ["/tmp/sub 1.srt", "/tmp/sub 2.ass"])
    assert cmd[0] == "--no-stdin" and "--mpv-start=93" in cmd
    assert "--mpv-sub-files=/tmp/sub 1.srt:/tmp/sub 2.ass" in cmd
    assert "--mpv-slang=vi,vie,en,eng" in cmd
    assert "--mpv-sid=auto" in cmd
    assert cmd[-1] == "https://example.com/watch?x=1&y=2"
    assert "--mpv-force-media-title=Example S01E02" in cmd
    # Regression: title must NOT affect byte-for-byte video URL passed to IINA.
    signed = ("https://example.test:18450/play/series/206713/tt17491088/"
              "1792769927/" + "a" * 64 + "/Example.Show.S02E05.mkv")
    for video_title in ("", "The Show · S02E05 · Episode", "A & B #1", "Show\nEpisode"):
        argv = cli_args(signed, video_title, 125, ["/tmp/sub.vi.vtt"])
        assert argv[-1] == signed, "title modified signed VOD URL"
        assert "--mpv-start=125" in argv
        assert "--mpv-sub-files=/tmp/sub.vi.vtt" in argv
        assert any(x.startswith("--mpv-force-media-title=") for x in argv) == bool(video_title)
        assert "#aios_title" not in argv[-1]
    legacy_bad = "https://a.example/video/index.m3u8%23aios_title=City%20of%20Splendour"
    legacy_clean = "https://a.example/video/index.m3u8"
    parsed_legacy = SCHEME + "://play?" + urllib.parse.urlencode({
        "url": legacy_bad, "title": "City of Splendour S01E03",
        "position": "0"
    })
    assert parse_link(parsed_legacy)[0] == legacy_clean
    assert cli_args(parse_link(parsed_legacy)[0], "City S01E03", 0, [])[-1] == legacy_clean
    # Encoded only once in the outer custom link: parse_qsl() decodes %23 to
    # a literal #aios_title fragment. This was missed by v0.7.2.
    once_encoded_outer = SCHEME + "://play?url=" + legacy_bad + "&title=City"
    assert parse_link(once_encoded_outer)[0] == legacy_clean
    fragment_bad = legacy_clean + "#aios_title=City%20of%20Splendour"
    assert normalize_legacy_hls_title_marker(fragment_bad) == legacy_clean
    signed_query = "?token=abc%26def&x=2%2F5"
    assert normalize_legacy_hls_title_marker(legacy_clean + signed_query + "#aios_title=City") == legacy_clean + signed_query
    assert normalize_legacy_hls_title_marker(legacy_bad + signed_query) == legacy_clean + signed_query
    for unchanged in (
        "https://a.example/video/index.m3u8%23other=value",
        "https://a.example/video/index.m3u8%2523aios_title=value",
        "https://a.example/video/movie.mp4%23aios_title=value",
        "https://a.example/video/index.m3u8?token=secret%26a",
        "https://a.example/video/index.m3u8#unrelated=fragment",
        "https://a.example/video/movie.mp4#aios_title=Original",
    ):
        assert normalize_legacy_hls_title_marker(unchanged) == unchanged
    assert safe_player_title("Example\nSeason\t2") == "Example Season 2"
    assert choose_ext(b"WEBVTT\n\n", "text/plain", "https://example.com/sub") == "vtt"
    assert choose_ext(b"[Script Info]\n", "text/plain", "https://example.com/sub") == "ass"
    assert choose_ext(b"<html>bad</html>", "text/html", "https://example.com/sub") is None
    url = "https://home.example/jellyfin/Videos/12345678/abcdef12/Subtitles/1000/0/Stream.vtt?ApiKey=SECRET&PlaySessionId=S1"
    result = metadata_route(url)
    assert result and result[1] == 1000 and result[0].startswith("https://home.example/jellyfin/Items/12345678/PlaybackInfo?")
    assert "MediaSourceId=abcdef12" in result[0] and "ApiKey=SECRET" in result[0]
    sample = {"MediaSources": [{"MediaStreams": [
        {"Type": "Subtitle", "DeliveryMethod": "External", "Language": "vie",
         "DisplayTitle": "Vietnamese - Yastream", "DeliveryUrl": "/jellyfin/Videos/12345678/abcdef12/Subtitles/1000/0/Stream.vtt"},
        {"Type": "Subtitle", "DeliveryMethod": "Embed", "Language": "eng"},
    ]}]}
    assert labels_from_playback_info(sample)[1000]["lang"] == "vie"
    assert subtitle_filename(0, "vtt", labels_from_playback_info(sample)[1000]) == "AIOStreams-01 [VI] Vietnamese - Yastream.vi.vtt"
    assert return_context_info("https://a.example/jellyfin/web#/details?id=1?played=12345678&source=abcdef12") == ("https://a.example/jellyfin", "12345678", "abcdef12")
    assert subtitle_priority({"lang": "eng"}) == 1
    assert subtitle_priority({"lang": "vi-VN"}) == 0
    assert subtitle_priority({"lang": "chi"}) == 2
    assert subtitle_priority(None) == 3
    assert language_counts(["AIOStreams-01 [VI].vi.vtt", "AIOStreams-02 [EN].en.vtt"])["vi"] == 1
    assert subtitle_filename(1, "vtt", None) == "AIOStreams-Sub-02.vtt"
    assert clean_label("Vietnamese / Yastream: x") == "Vietnamese Yastream x"
    assert metadata_route("https://example.com/generic/en.srt") is None
    for invalid in ("aios-iina://play?url=file%3A%2F%2F%2Fetc%2Fpasswd",
                    "aios-iina://other?url=https%3A%2F%2Fexample.com",
                    "aios-iina://play?url=https%3A%2F%2Fexample.com&position=-5"):
        try:
            parse_link(invalid)
        except ValueError:
            continue
        raise AssertionError("invalid link accepted")
    print("PASS v%s: playback URL / Trakt+ / resume / context parsing / VI > EN > others / mpv selection / metadata fallback / optional callback" % VERSION)


def main(argv):
    if len(argv) == 2 and argv[1] == "--self-test":
        self_test()
        return 0
    if len(argv) == 3 and argv[1] == "--dry-run-url":
        media, title, position, subs, context = parse_link(argv[2])
        print("VALID: position=%d, external_subtitles=%d, context=%s, TraktTitle=%s" % (position, len(subs), bool(context), bool(title)))
        return 0
    if len(argv) == 3 and argv[1] == "--handle-url":
        return handle(argv[2])
    print("Usage: bridge.py --self-test | --dry-run-url '<link>' | --handle-url '<link>'", file=sys.stderr)
    return 64


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:
        log("ERROR: unexpected failure (%s)" % type(exc).__name__)
        if "--self-test" in sys.argv:
            raise
        sys.exit(1)