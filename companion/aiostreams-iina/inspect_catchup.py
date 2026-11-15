#!/usr/bin/env python3
"""Read-only, standalone Mac check of existing AIO Catch-up context + API.

Download this one file and run it after playing an AIO Catch-up programme.
Never prints/stores the token, full return/stream URL, opaque item/source IDs
or callback-session data. No playback, IINA, Trakt or configuration mutations.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path.home() / "Library/Application Support/AIO-IINA-Bridge"
SERVICE = "AIO-IINA-Identity-Token"
ID = re.compile(r"^[a-zA-Z0-9-]{8,128}$")
SESSION = re.compile(r"^[a-f0-9]{32}\.json$")
MAX_JSON = 192 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def private_json(path: Path, maximum: int) -> dict | None:
    try:
        if path.is_symlink() or path.stat().st_mode & 0o077 or path.stat().st_size > maximum:
            return None
        result = json.loads(path.read_text(encoding="utf-8"))
        return result if isinstance(result, dict) else None
    except (OSError, ValueError, UnicodeError):
        return None


def configured_origin() -> str | None:
    row = private_json(ROOT / "identity-settings.json", 1024)
    if not row or row.get("enabled") is not True:
        return None
    origin = row.get("origin")
    if not isinstance(origin, str) or not re.fullmatch(
        r"https://[a-z0-9.-]+(?::[0-9]{1,5})?", origin, re.I
    ) or ".." in origin:
        return None
    try:
        u = urlsplit(origin)
        if not u.hostname or u.port is not None and not 1 <= u.port <= 65535:
            return None
    except ValueError:
        return None
    return origin


def user_token(origin: str) -> str | None:
    try:
        found = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-w", "-s", SERVICE,
             "-a", origin], capture_output=True, text=True, timeout=3, check=False)
        token = found.stdout.strip()
        return token if found.returncode == 0 and 20 <= len(token) <= 4096 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def markers(return_url: str, origin: str) -> tuple[str, str] | None:
    try:
        p = urlsplit(return_url)
        if p.scheme == "aiostreams":
            if p.netloc != "return" or p.username or p.password:
                return None
        elif (p.scheme != "https" or f"https://{p.netloc.lower()}" != origin or
              not p.fragment.startswith("/") or "?" not in p.fragment):
            return None
        values = parse_qsl(p.query, keep_blank_values=True)
        if "?" in p.fragment:
            values += parse_qsl(p.fragment.split("?", 1)[1].replace("?", "&"),
                                keep_blank_values=True)
        chosen = {}
        for key, value in values:
            if key in ("played", "source"):
                if key in chosen and chosen[key] != value:
                    return None
                chosen[key] = value
        item, source = chosen.get("played", ""), chosen.get("source", "")
        return (item, source) if ID.fullmatch(item) and ID.fullmatch(source) else None
    except (TypeError, ValueError):
        return None


def recent_contexts(origin: str):
    directory = ROOT / "sessions"
    if directory.is_symlink() or not directory.is_dir():
        return
    files = sorted((p for p in directory.iterdir() if SESSION.fullmatch(p.name)),
                   key=lambda p: p.stat().st_mtime if not p.is_symlink() else 0,
                   reverse=True)[:16]
    now = int(time.time() * 1000)
    for path in files:
        row = private_json(path, 8192)
        if not row or row.get("schema") != 1:
            continue
        try:
            if not (int(row["issued_at_ms"]) <= now <= int(row["expires_at_ms"])):
                continue
        except (ValueError, TypeError, KeyError):
            continue
        pair = markers(row.get("return_url"), origin)
        if pair:
            yield pair


def json_get(origin: str, route: str, token: str) -> dict:
    if not (route.startswith("/Items?") or re.fullmatch(
        r"/Items/[a-zA-Z0-9-]{8,128}/PlaybackInfo\?MediaSourceId=[a-zA-Z0-9-]{8,128}",
        route
    )):
        raise ValueError("unapproved route")
    opener = build_opener(ProxyHandler({}), NoRedirect())
    req = Request(origin + "/jellyfin" + route,
                  headers={"Accept": "application/json", "X-Emby-Token": token})
    with opener.open(req, timeout=6) as response:
        if not 200 <= response.status < 300 or "json" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("API did not return JSON")
        data = response.read(MAX_JSON + 1)
    if len(data) > MAX_JSON:
        raise ValueError("large API response")
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("invalid API result")
    return result


def inspect(origin: str, token: str, contexts=None, fetch=json_get) -> str:
    contexts = recent_contexts(origin) if contexts is None else contexts
    for item, source in contexts:
        payload = fetch(origin, "/Items?" + urlencode({"Ids": item}), token)
        rows = payload.get("Items")
        if not isinstance(rows, list) or len(rows) != 1:
            continue
        program = rows[0]
        if not isinstance(program, dict) or program.get("Id") != item or program.get("Type") != "Program":
            continue
        extension = program.get("aiostreams")
        if not isinstance(extension, dict) or extension.get("catchup") is not True:
            return "PROGRAM FOUND; CATCHUP_FLAG: BLOCKED"
        playback = fetch(origin, "/Items/" + item + "/PlaybackInfo?MediaSourceId=" + source, token)
        sources = playback.get("MediaSources")
        matched = isinstance(sources, list) and any(
            isinstance(row, dict) and row.get("Id") == source for row in sources[:32])
        if not matched:
            return "PROGRAM FOUND; SELECTED_SOURCE: BLOCKED"
        return "PROGRAM FOUND; CATCHUP_FLAG: PASS; SELECTED_SOURCE: PASS; EPG_READY: YES"
    return "NO RECENT CATCH-UP PROGRAM; open one in AIOStreams, then retry"


def main() -> int:
    if sys.platform != "darwin":
        print("BLOCKED: run on Mac")
        return 2
    origin = configured_origin()
    if not origin:
        print("CONFIG: BLOCKED")
        return 2
    token = user_token(origin)
    if not token:
        print("KEYCHAIN: BLOCKED")
        return 2
    print("CONFIG: PASS; KEYCHAIN: PASS; probe is read-only")
    try:
        result = inspect(origin, token)
    except (HTTPError, URLError, OSError, ValueError, TypeError,
            TimeoutError, UnicodeError, json.JSONDecodeError) as error:
        status = " HTTP " + str(error.code) if isinstance(error, HTTPError) else ""
        print("AIO API: BLOCKED (" + type(error).__name__ + status + ")")
        return 2
    print(result)
    return 0 if result.endswith("EPG_READY: YES") else 2


if __name__ == "__main__":
    raise SystemExit(main())
