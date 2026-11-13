"""AIOStreams native Jellyfin API routes and exact item-to-source proof."""
import io
from contextlib import redirect_stdout
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import callback_session as cb
import identity_context as ic

ORIGIN = "https://aio.example:18447"
URL = "https://akm-cdn-play.hitv.ltd/opaque/index.m3u8?hdnts=secret&sign=secret"
RETURN = ORIGIN + "/jellyfin/web#/details?played=12345678&source=abcdef12"


class FakeResponse:
    status = 200
    headers = {"Content-Type": "application/json; charset=utf-8"}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self, _limit):
        return json.dumps({"Items": []}).encode("utf-8")


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patchers = [
            patch.object(ic, "CONFIG_FILE", root / "identity-settings.json"),
            patch.object(cb, "ALLOWED_ORIGINS", root / "allow.txt"),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        cb.ALLOWED_ORIGINS.write_text(ORIGIN + "\n", encoding="utf-8")
        ic.CONFIG_FILE.write_text(json.dumps({"enabled": True, "origin": ORIGIN}), encoding="utf-8")
        ic.CONFIG_FILE.chmod(0o600)

    def test_uses_real_aiostreams_jellyfin_api_prefix(self):
        requests = []

        class Opener:
            def open(self, req, timeout):
                requests.append((req.full_url, req.get_header("X-emby-token"), timeout))
                return FakeResponse()

        with patch.object(ic, "build_opener", return_value=Opener()):
            self.assertEqual(ic.json_get(ORIGIN, "/Items?Ids=12345678", "session-token"), {"Items": []})
        self.assertEqual(requests, [
            (ORIGIN + "/jellyfin/Items?Ids=12345678", "session-token", ic.HTTP_TIMEOUT)
        ])
        with self.assertRaises(ValueError):
            ic.json_get(ORIGIN, "/Users", "session-token")

    def test_read_only_preflight_checks_auth_without_leaking_tokens(self):
        buffer = io.StringIO()
        with patch.object(ic, "keychain_token", return_value="sensitive-user-token"), \
             patch.object(ic, "json_get", return_value={"Items": []}) as request, \
             redirect_stdout(buffer):
            self.assertEqual(ic.preflight_identity(), 0)
        request.assert_called_once_with(ORIGIN, "/Items?Ids=00000000000000000000000000000000",
                                        "sensitive-user-token")
        self.assertIn("READY FOR LIVE PLAYBACK TEST", buffer.getvalue())
        self.assertNotIn("sensitive-user-token", buffer.getvalue())
        self.assertNotIn(ORIGIN, buffer.getvalue())
        with patch.object(ic, "keychain_token", return_value=None), redirect_stdout(io.StringIO()):
            self.assertEqual(ic.preflight_identity(), 2)

    def test_exact_episode_series_and_source_yields_private_descriptor(self):
        calls = []

        def fetch(origin, route, token):
            self.assertEqual(origin, ORIGIN)
            self.assertEqual(token, "session-token")
            calls.append(route)
            path = urlsplit(route)
            if path.path == "/Items":
                item_id = parse_qs(path.query)["Ids"][0]
                if item_id == "12345678":
                    return {"Items": [{"Id": item_id, "Type": "Episode", "SeriesId": "87654321",
                                       "ParentIndexNumber": 1, "IndexNumber": 4}]}
                return {"Items": [{"Id": "87654321", "Type": "Series", "Name": "Fired Up!",
                                   "ProductionYear": 2026,
                                   "ProviderIds": {"Imdb": "tt12345678", "Tmdb": "999001"}}]}
            if path.path == "/Items/12345678/PlaybackInfo":
                return {"MediaSources": [{"Id": "abcdef12"}]}
            self.fail("Unrecognized route: " + route)

        identity = ic.obtain_identity(URL, "Fired Up! · S01E04 · Episode 4", RETURN,
                                      token="session-token", fetch=fetch, now_ms=1_700_000_000_000)
        self.assertIsNotNone(identity)
        self.assertEqual(identity["year"], 2026)
        self.assertEqual(identity["episode"], 4)
        self.assertEqual(identity["ids"]["imdb"], "tt12345678")
        self.assertEqual(len(calls), 3)
        self.assertNotIn("secret", json.dumps(identity))
        self.assertNotIn("hitv", json.dumps(identity))
        self.assertIsNone(ic.obtain_identity(URL, "Fired Up! S01E02", RETURN,
                                              token="session-token", fetch=fetch))


if __name__ == "__main__":
    unittest.main()
