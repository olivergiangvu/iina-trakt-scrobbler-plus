#!/usr/bin/env python3
"""Offline AIOStreams 2.38 Catch-up `Program` EPG regressions."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import identity_context as m

ORIGIN = "https://aio.example"
MEDIA = "https://iptv.example/timeshift/user/secret/30/2026-11-15:15-00/100450.ts"
CONTEXT = "aiostreams://return/12345678?played=12345678&source=abcdef12"


def program():
    return {
        "Id": "12345678", "Type": "Program", "Name": "Man Fire Food",
        "ChannelId": "0123456789abcdef", "ChannelName": "US: Cooking Channel",
        "StartDate": "2026-11-15T15:00:00.000Z",
        "EndDate": "2026-11-15T15:30:00.000Z",
        "IsSeries": True, "aiostreams": {"catchup": True},
        "ProviderIds": {"Imdb": "tt12345678"},
    }


class CatchupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / "identity-settings.json"
        self.config.write_text(json.dumps({"enabled": True, "origin": ORIGIN}))
        os.chmod(self.config, 0o600)
        self.config_patch = patch.object(m, "CONFIG_FILE", self.config)
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)

    def lookup(self, item=None, sources=None, context=CONTEXT, title="Man Fire Food"):
        item = program() if item is None else item
        sources = [{"Id": "abcdef12"}] if sources is None else sources
        def fetch(origin, route, token):
            self.assertEqual(origin, ORIGIN)
            self.assertEqual(token, "mock-user-token")
            if route.startswith("/Items?"):
                return {"Items": [item]}
            if route.startswith("/Items/12345678/PlaybackInfo?"):
                return {"MediaSources": sources}
            raise AssertionError("Unexpected AIO route")
        return m.obtain_identity(MEDIA, title, context, token="mock-user-token",
                                 fetch=fetch, now_ms=12345000)

    def test_authenticated_epg_program_remains_display_only(self):
        proof = self.lookup()
        self.assertEqual(proof["kind"], "iptv-catchup")
        self.assertEqual(proof["provenance"], "authenticated-aiostreams-program")
        self.assertEqual(proof["channel_name"], "US: Cooking Channel")
        self.assertEqual(proof["program_title"], "Man Fire Food")
        self.assertEqual(proof["start_at_utc"], "2026-11-15T15:00:00Z")
        self.assertEqual(proof["end_at_utc"], "2026-11-15T15:30:00Z")
        self.assertIs(proof["trakt_eligible"], False)
        self.assertEqual(proof["media_sha256"], hashlib.sha256(MEDIA.encode()).hexdigest())
        self.assertNotIn("ids", proof)
        self.assertNotIn("tt12345678", json.dumps(proof))
        self.assertNotIn("/timeshift/", json.dumps(proof))
        self.assertEqual(proof["expires_at_ms"] - proof["issued_at_ms"], m.TTL_MS)

    def test_wrong_item_type_and_expired_catchup_rejected(self):
        for delta in (
            {"Type": "Movie"}, {"Type": "Episode"},
            {"aiostreams": {"catchup": False}}, {"aiostreams": {}},
            {"ChannelName": ""}, {"ChannelId": "-"},
            {"StartDate": "2026-11-15T15:40:00Z"},
            {"EndDate": "2026-11-15T15:00:00Z"},
            {"EndDate": "2026-11-15T15:00:30Z"},
            {"Name": "Man Fire Food\nINJECTED"},
        ):
            with self.subTest(delta=delta):
                self.assertIsNone(self.lookup({**program(), **delta}))

    def test_selected_source_and_config_required(self):
        self.assertIsNone(self.lookup(sources=[{"Id": "badcafe0"}]))
        self.assertIsNone(self.lookup(context=CONTEXT.replace("abcdef12", "badcafe0")))
        self.config.write_text(json.dumps({"enabled": False, "origin": ORIGIN}))
        self.assertIsNone(self.lookup())

    def test_epg_sidecar_private_and_unrelated_to_trakt(self):
        proof = self.lookup()
        with patch.object(m, "IDENTITY_DIR", Path(self.temp.name) / "identity"):
            self.assertTrue(m.persist_identity(proof))
            records = list(m.IDENTITY_DIR.glob("identity-*.json"))
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(records[0].read_text())["trakt_eligible"], False)


if __name__ == "__main__":
    unittest.main()
