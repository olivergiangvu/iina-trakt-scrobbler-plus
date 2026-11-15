#!/usr/bin/env python3
"""One-time AIOStreams Jellyfin Quick Connect -> macOS Keychain identity setup.

Only the exact, user-approved HTTPS origin is contacted. Never prints tokens,
Quick Connect secrets, user IDs, full request URLs or response bodies.
Does NOT launch IINA, modify video URLs, or create a Trakt writer.
"""
from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

ORIGIN = "https://olivergiangvu.asuscomm.com:18447"
API = ORIGIN + "/jellyfin"
SERVICE = "AIO-IINA-Identity-Token"
CONFIG = Path.home() / "Library/Application Support/AIO-IINA-Bridge/identity-settings.json"
MAX_JSON = 192 * 1024
WAIT_SECONDS = 180


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(ProxyHandler({}), NoRedirect())
DEVICE_ID = "aio-iina-" + uuid4().hex
HEADERS = {
    "Accept": "application/json",
    "X-Emby-Authorization": (
        'MediaBrowser Client="AIOIINABridge", Device="Oliver-Mac", '
        'DeviceId="' + DEVICE_ID + '", Version="0.7.3"'
    ),
}


def api_json(route: str, *, post: dict | None = None) -> dict:
    if not route.startswith("/") or "://" in route or "\\" in route:
        raise ValueError("invalid API route")
    data = None if post is None else json.dumps(
        post, separators=(",", ":")).encode("utf-8")
    headers = dict(HEADERS)
    if post is not None:
        headers["Content-Type"] = "application/json"
    request = Request(API + route, data=data, headers=headers,
                      method="POST" if post is not None else "GET")
    with OPENER.open(request, timeout=8) as response:
        if response.status != 200:
            raise ValueError("API response status")
        if "json" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("API response is not JSON")
        payload = response.read(MAX_JSON + 1)
    if len(payload) > MAX_JSON:
        raise ValueError("API response too large")
    result = json.loads(payload)
    if not isinstance(result, dict):
        raise ValueError("invalid API response")
    return result


def quick_connect() -> str:
    result = api_json("/QuickConnect/Initiate", post={})
    code, secret = result.get("Code"), result.get("Secret")
    if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9]{4,12}", code):
        raise ValueError("invalid Quick Connect code")
    if not isinstance(secret, str) or not 12 <= len(secret) <= 512:
        raise ValueError("invalid Quick Connect secret")
    print("Quick Connect code:", code, flush=True)
    print("Approve it in AIOStreams Configure -> Save & Install ->")
    print("Jellyfin apps -> Connect -> Quick Connect (within 3 minutes).", flush=True)
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(3)
        status = api_json("/QuickConnect/Connect?secret=" + quote(secret, safe=""))
        if status.get("Authenticated") is True:
            break
    else:
        raise TimeoutError("Quick Connect was not approved")
    auth = api_json("/Users/AuthenticateWithQuickConnect",
                    post={"Secret": secret})
    token = auth.get("AccessToken")
    if not isinstance(token, str) or not 20 <= len(token) <= 4096:
        raise ValueError("authentication response lacks user token")
    return token


def verify_user_token(token: str) -> None:
    headers = dict(HEADERS)
    headers["X-Emby-Token"] = token
    request = Request(API + "/Items?Ids=00000000000000000000000000000000",
                      headers=headers, method="GET")
    with OPENER.open(request, timeout=8) as response:
        if response.status != 200:
            raise ValueError("user token verification failed")
        payload = response.read(MAX_JSON + 1)
    if len(payload) > MAX_JSON:
        raise ValueError("API response too large")
    data = json.loads(payload)
    if not isinstance(data, dict) or not isinstance(data.get("Items"), list):
        raise ValueError("Jellyfin Items endpoint did not return an Items list")


def save_keychain(token: str) -> None:
    """Use Apple Keychain Services directly; secret never appears in ps/argv."""
    if sys.platform != "darwin":
        raise RuntimeError("Keychain setup requires macOS")
    security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    call = security.SecKeychainAddGenericPassword
    call.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p,
                     ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
                     ctypes.c_char_p, ctypes.c_void_p]
    call.restype = ctypes.c_int32
    service, account, secret = (SERVICE.encode("utf-8"),
                                ORIGIN.encode("utf-8"), token.encode("utf-8"))
    result = call(None, len(service), service, len(account), account,
                  len(secret), secret, None)
    if result == -25299:
        raise RuntimeError("AIO Keychain entry already exists; refusing to overwrite")
    if result != 0:
        raise RuntimeError("macOS Keychain rejected the new entry (OSStatus=%d)" % result)


def save_private_config() -> None:
    root = CONFIG.parent
    if root.is_symlink() or CONFIG.is_symlink() or CONFIG.exists():
        raise RuntimeError("Identity config exists or is a symlink; refusing to overwrite")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    fd = os.open(CONFIG, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump({"enabled": True, "origin": ORIGIN}, out, separators=(",", ":"))
        out.write("\n")


def main() -> int:
    print("AIO-IINA Companion: user-scoped Quick Connect identity setup")
    print("Server:", API)
    print("No Trakt writes, video changes, API keys or raw token output.")
    if CONFIG.exists() or CONFIG.is_symlink():
        print("BLOCKED: identity config already exists; refusing to overwrite")
        return 2
    try:
        token = quick_connect()
        verify_user_token(token)
        print("AIO API: PASS (authenticated /jellyfin/Items)")
        save_keychain(token)
        print("KEYCHAIN: SAVED (value hidden)")
        save_private_config()
        print("CONFIG: ENABLED (0600; exact HTTPS origin)")
        print("SETUP COMPLETE. Restart not required; test Catch-up next.")
        return 0
    except (HTTPError, URLError, OSError, ValueError, RuntimeError,
            TimeoutError, json.JSONDecodeError) as exc:
        # NEVER stringify HTTP errors: they may embed Quick Connect secrets.
        status = " HTTP " + str(exc.code) if isinstance(exc, HTTPError) else ""
        print("SETUP BLOCKED:", type(exc).__name__ + status)
        print("No existing IINA app, plugin, playback URL or Trakt state was changed.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
