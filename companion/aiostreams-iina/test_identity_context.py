#!/usr/bin/env python3
"""Offline Companion identity handoff checks; never call the internet."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

import identity_context as m

MEDIA = "https://cdn.example/videos/signed/index.m3u8?token=REDACTED"
RETURN = "https://aio.example/#/series/show-123?played=12345678&source=abcdef12"
TITLE = "City of Splendour · S01E02 · Episode 2"


def fixture(origin, route, token):
    assert origin == "https://aio.example"
    assert token == "mock-user-session-token"
    if "/Items?" in route:
        if "12345678" in route:
            return {"Items": [{
                "Id": "12345678", "Type": "Episode", "SeriesId": "11223344",
                "ParentIndexNumber": 1, "IndexNumber": 2
            }]}
        if "11223344" in route:
            return {"Items": [{
                "Id": "11223344", "Type": "Series",
                "Name": "This City Never Sleeps", "ProductionYear": 2026,
                "ProviderIds": {
                    "Imdb": "tt39443161", "Tmdb": "295002", "Tvdb": "483239"
                }
            }]}
    if "/Items/12345678/PlaybackInfo?" in route:
        return {"MediaSources": [{"Id": "abcdef12"}, {"Id": "wrong-source"}]}
    raise AssertionError("Unrecognized route: " + route)


def check():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cfg = root / "identity-settings.json"
        cfg.write_text('{"enabled":true,"origin":"https://aio.example"}', encoding="utf-8")
        os.chmod(cfg, 0o600)
        with patch.dict(os.environ, {"AIO_IINA_CALLBACK_ORIGINS": "https://aio.example"}), \
             patch.object(m, "CONFIG_FILE", cfg), \
             patch.object(m, "IDENTITY_DIR", root / "identity"):
            proof = m.obtain_identity(MEDIA, TITLE, RETURN,
                token="mock-user-session-token", fetch=fixture, now_ms=12345000)
            assert proof is not None
            assert proof["ids"] == {
                "imdb": "tt39443161", "tmdb": 295002, "tvdb": 483239}
            assert proof["season"] == 1 and proof["episode"] == 2
            assert proof["media_sha256"] == hashlib.sha256(MEDIA.encode()).hexdigest()
            assert proof["expires_at_ms"] - proof["issued_at_ms"] == m.TTL_MS
            assert "REDACTED" not in json.dumps(proof)
            assert "aio.example/#" not in json.dumps(proof)
            assert m.obtain_identity(MEDIA, "City of Splendour S01E03", RETURN,
                token="mock-user-session-token", fetch=fixture) is None
            assert m.obtain_identity(MEDIA, TITLE, RETURN.replace("abcdef12", "badcafe0"),
                token="mock-user-session-token", fetch=fixture) is None
            assert m.obtain_identity(MEDIA, TITLE, RETURN.replace("aio.example", "evil.example"),
                token="mock-user-session-token", fetch=fixture) is None
            assert m.obtain_identity(MEDIA, TITLE, RETURN.replace("https:", "http:"),
                token="mock-user-session-token", fetch=fixture) is None
            desktop = "aiostreams://return/12345678?played=12345678&source=abcdef12"
            desktop_proof = m.obtain_identity(MEDIA, TITLE, desktop,
                token="mock-user-session-token", fetch=fixture)
            assert desktop_proof is not None
            assert desktop_proof["origin"] == "https://aio.example"
            assert desktop_proof["ids"] == proof["ids"]
            assert m.obtain_identity(MEDIA, TITLE, desktop.replace("return", "evil"),
                token="mock-user-session-token", fetch=fixture) is None
            for bad_origin in (
                "http://aio.example", "https://evil.example/aio",
                "https://user:pass@evil.example", "https://aio.example/#fragment"
            ):
                cfg.write_text(json.dumps({"enabled": True, "origin": bad_origin}))
                assert m.obtain_identity(MEDIA, TITLE, desktop,
                    token="mock-user-session-token", fetch=fixture) is None
            cfg.write_text('{"enabled":true,"origin":"https://aio.example"}')
            cfg.write_text('{"enabled":false,"origin":"https://aio.example"}')
            assert m.obtain_identity(MEDIA, TITLE, desktop,
                token="mock-user-session-token", fetch=fixture) is None
            cfg.write_text('{"enabled":true,"origin":"https://aio.example"}')
            # Other show, inconsistent canonical IDs or missing selected source.
            def wrong_series(origin, route, token):
                d = fixture(origin, route, token)
                if "/Items?" in route and "11223344" in route:
                    d["Items"][0]["ProviderIds"]["Imdb"] = "not-an-imdb-id"
                return d
            assert m.obtain_identity(MEDIA, TITLE, RETURN,
                token="mock-user-session-token", fetch=wrong_series) is None
            def wrong_source(origin, route, token):
                d = fixture(origin, route, token)
                if "/PlaybackInfo?" in route:
                    d["MediaSources"] = [{"Id": "00000000"}]
                return d
            assert m.obtain_identity(MEDIA, TITLE, RETURN,
                token="mock-user-session-token", fetch=wrong_source) is None
            # New sidecar is private (0600) and never contains video URL.
            assert m.persist_identity(proof)
            files = list((root / "identity").glob("identity-*.json"))
            assert len(files) == 1
            assert files[0].stat().st_mode & 0o777 == 0o600
            assert (root / "identity").stat().st_mode & 0o777 == 0o700
            serialized = files[0].read_text(encoding="utf-8")
            assert "token=REDACTED" not in serialized
            assert "mock-user-session-token" not in serialized
            assert json.loads(serialized)["ids"]["imdb"] == "tt39443161"
            os.chmod(cfg, 0o644)
            assert m.obtain_identity(MEDIA, TITLE, RETURN,
                token="mock-user-session-token", fetch=fixture) is None
    print("PASS: AIO companion item+series+source proof, secure sidecar, fail-open identity")


if __name__ == "__main__":
    check()
