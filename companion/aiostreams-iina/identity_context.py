"""Opt-in, read-only AIOStreams episode identity lookup for existing Companion.

No second player, daemon, listener or Trakt writer. Playback NEVER depends on
this lookup; failures return None and do not touch IINA arguments.
The original signed media/return URLs and Jellyfin tokens are never persisted.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from callback_session import _markers, validated_return_url

ROOT = Path.home() / "Library" / "Application Support" / "AIO-IINA-Bridge"
CONFIG_FILE = ROOT / "identity-settings.json"
IDENTITY_DIR = ROOT / "identity"
KEYCHAIN_SERVICE = "AIO-IINA-Identity-Token"
MAX_JSON_BYTES = 192 * 1024
MAX_SIDE_CAR_BYTES = 4096
TTL_MS = 5 * 60 * 1000
HTTP_TIMEOUT = 4
ID_RE = re.compile(r"^[0-9a-zA-Z-]{8,128}$")
IMDB_RE = re.compile(r"^tt[0-9]{6,10}$", re.I)
PLAYBACK_EP = re.compile(r"\bS(\d{1,3})E(\d{1,4})\b", re.I)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def safe_int(value, lo, hi):
    try:
        if isinstance(value, bool) or str(value).strip() != str(int(value)):
            return None
        result = int(value)
        return result if lo <= result <= hi else None
    except (ValueError, TypeError):
        return None


def config_enabled(origin):
    """Identity lookup is off by default; config has no secrets."""
    try:
        if CONFIG_FILE.is_symlink() or CONFIG_FILE.stat().st_mode & 0o077:
            return False
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return data.get("enabled") is True and data.get("origin") == origin
    except (OSError, ValueError, TypeError):
        return False


def keychain_token(origin):
    """User-scoped Jellyfin session token, never an admin/API master key."""
    try:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-w",
             "-s", KEYCHAIN_SERVICE, "-a", origin],
            capture_output=True, text=True, timeout=3, check=False
        )
        value = result.stdout.strip()
        return value if result.returncode == 0 and 20 <= len(value) <= 4096 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def json_get(origin, route, token):
    """Only same-origin fixed Jellyfin item paths; never follow redirects."""
    if not route.startswith("/Items?") and not route.startswith("/Items/"):
        raise ValueError("non-item route")
    url = origin + route
    req = Request(url, headers={
        "Accept": "application/json", "X-Emby-Token": token,
        "User-Agent": "AIO-IINA-Identity/0.7-canary",
    })
    with build_opener(NoRedirect()).open(req, timeout=HTTP_TIMEOUT) as response:
        if not 200 <= getattr(response, "status", 200) < 300:
            return None
        if "json" not in (response.headers.get("Content-Type", "").lower()):
            return None
        data = response.read(MAX_JSON_BYTES + 1)
    if len(data) > MAX_JSON_BYTES:
        return None
    return json.loads(data.decode("utf-8"))


def provider_ids(record):
    raw = record.get("ProviderIds") if isinstance(record, dict) else None
    if not isinstance(raw, dict):
        return None
    lookup = {str(k).lower(): str(v).strip() for k, v in raw.items() if v is not None}
    imdb = lookup.get("imdb", "").lower()
    tmdb = safe_int(lookup.get("tmdb"), 1, 999999999)
    tvdb = safe_int(lookup.get("tvdb"), 1, 999999999)
    if imdb and not IMDB_RE.fullmatch(imdb):
        return None
    if not imdb and not tmdb:
        return None
    return {"imdb": imdb or None, "tmdb": tmdb, "tvdb": tvdb}


def exactly_one_item(payload, expected):
    rows = payload.get("Items") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or len(rows) != 1:
        return None
    row = rows[0]
    if not isinstance(row, dict) or str(row.get("Id", "")).lower() != expected.lower():
        return None
    return row


def context_info(return_url):
    """Resolve approved Web/Desktop callback without trusting media URL hosts."""
    if not validated_return_url(return_url):
        return None
    parts = urlsplit(return_url)
    ids = _markers(return_url)
    if not ids:
        return None
    item, source = ids.get("played"), ids.get("source")
    if not ID_RE.fullmatch(item or "") or not ID_RE.fullmatch(source or ""):
        return None

    if parts.scheme == "https":
        return f"https://{parts.netloc.lower()}", item, source

    if parts.scheme != "aiostreams" or parts.netloc != "return":
        return None
    # Desktop callbacks contain no trusted HTTPS host. Resolve only to a
    # privately configured, exact HTTPS origin; never infer from media URL.
    try:
        if CONFIG_FILE.is_symlink() or CONFIG_FILE.stat().st_mode & 0o077:
            return None
        settings = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if not isinstance(settings, dict) or settings.get("enabled") is not True:
            return None
        origin = settings.get("origin")
        if not isinstance(origin, str):
            return None
        trusted = urlsplit(origin)
        if (trusted.scheme != "https" or not trusted.hostname
                or trusted.username is not None or trusted.password is not None
                or trusted.path or trusted.query or trusted.fragment
                or origin != f"https://{trusted.netloc.lower()}"):
            return None
        _ = trusted.port  # Validate optional port syntax.
    except (OSError, ValueError, TypeError):
        return None
    return origin, item, source


def obtain_identity(media, title, return_url, *, token=None, fetch=None, now_ms=None):
    """Resolve an exact AIO episode+parent and verify the selected source.

    fetch(origin, route, token) injection enables offline regression tests.
    Returned identity has no signed URLs or auth credentials.
    """
    parsed = context_info(return_url)
    if parsed is None:
        return None
    origin, item_id, source_id = parsed
    if not config_enabled(origin):
        return None
    token = token or keychain_token(origin)
    if not token:
        return None
    fetch = fetch or json_get
    try:
        info = exactly_one_item(fetch(origin, "/Items?" + urlencode({
            "Ids": item_id, "Fields": "ProviderIds,ParentId"
        }), token), item_id)
        if not info or info.get("Type") != "Episode":
            return None
        show_id = str(info.get("SeriesId", ""))
        if not ID_RE.fullmatch(show_id):
            return None
        season = safe_int(info.get("ParentIndexNumber"), 0, 999)
        episode = safe_int(info.get("IndexNumber"), 1, 9999)
        if season is None or episode is None:
            return None
        visible = PLAYBACK_EP.search(title or "")
        if visible and (int(visible.group(1)) != season or int(visible.group(2)) != episode):
            return None
        show = exactly_one_item(fetch(origin, "/Items?" + urlencode({
            "Ids": show_id, "Fields": "ProviderIds"
        }), token), show_id)
        if not show or show.get("Type") != "Series":
            return None
        ids = provider_ids(show)
        if not ids:
            return None
        year = safe_int(show.get("ProductionYear"), 1900, 2100)
        if not year:
            return None
        playback = fetch(origin, "/Items/" + item_id + "/PlaybackInfo?" +
                         urlencode({"MediaSourceId": source_id}), token)
        sources = playback.get("MediaSources") if isinstance(playback, dict) else None
        if not isinstance(sources, list) or not any(
            isinstance(x, dict) and str(x.get("Id", "")).lower() == source_id.lower()
            for x in sources[:32]
        ):
            return None
        issued = int(now_ms if now_ms is not None else time.time() * 1000)
        if not isinstance(media, str) or not media.startswith(("https://", "http://")):
            return None
        return {
            "schema": 1,
            "kind": "episode",
            "provenance": "authenticated-aiostreams-item",
            "origin": origin,
            "media_sha256": hashlib.sha256(media.encode("utf-8")).hexdigest(),
            "item_id": item_id, "media_source_id": source_id,
            "series_id": show_id,
            "season": season, "episode": episode, "year": year,
            "canonical_title": str(show.get("Name", ""))[:160],
            "ids": ids,
            "issued_at_ms": issued, "expires_at_ms": issued + TTL_MS
        }
    except (HTTPError, URLError, OSError, TimeoutError, ValueError,
            TypeError, UnicodeError, json.JSONDecodeError):
        return None


def persist_identity(identity):
    """0600 private, atomic JSON envelope without stream URL or credentials."""
    if not isinstance(identity, dict) or identity.get("schema") != 1:
        return False
    content = json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(content) > MAX_SIDE_CAR_BYTES:
        return False
    IDENTITY_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    if IDENTITY_DIR.is_symlink():
        return False
    os.chmod(IDENTITY_DIR, 0o700)
    now = int(time.time() * 1000)
    for path in IDENTITY_DIR.glob("identity-*.json"):
        try:
            if path.is_symlink() or path.stat().st_size > MAX_SIDE_CAR_BYTES:
                continue
            row = json.loads(path.read_text(encoding="utf-8"))
            if int(row.get("expires_at_ms", 0)) < now:
                path.unlink(missing_ok=True)
        except (OSError, ValueError, TypeError):
            continue
    fd, tmp = tempfile.mkstemp(prefix=".pending-", dir=IDENTITY_DIR)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as writer:
            writer.write(content)
        path = IDENTITY_DIR / ("identity-" + secrets.token_hex(16) + ".json")
        os.replace(tmp, path)
        return True
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def create_from_launch(media, title, context):
    """Best-effort opt-in sidecar; main IINA launch remains fully independent."""
    result = obtain_identity(media, title, context)
    if not result:
        return False
    try:
        return persist_identity(result)
    except (OSError, TypeError, ValueError):
        return False
