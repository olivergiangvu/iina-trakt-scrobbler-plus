"""Offline callback regression tests; no browser, server or Trakt access."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import callback_session as cb


BROWSER = "https://aio.example:18447/jellyfin/web#/details?id=1?played=12345678&source=abcdef12"
BROWSER_ROOT = "https://aio.example:18447/#/series/tt12345?played=12345678&source=abcdef12"
BROWSER_PROXY = "https://aio.example:18447/aio/#/series/tt12345?played=12345678&source=abcdef12"
DESKTOP = "aiostreams://return/series/12345?played=12345678&source=abcdef12"
MEDIA = "https://cdn.example/signed/master.m3u8?token=VERY_PRIVATE&x=1"


class CallbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        folder = Path(self.tmp.name)
        patcher1 = patch.object(cb, "SESSION_DIR", folder / "sessions")
        patcher2 = patch.object(cb, "ALLOWED_ORIGINS", folder / "allow.txt")
        patcher3 = patch.object(cb, "CALLBACK_LOG", folder / "callback-audit.log")
        patcher1.start()
        patcher2.start()
        patcher3.start()
        self.addCleanup(patcher1.stop)
        self.addCleanup(patcher2.stop)
        self.addCleanup(patcher3.stop)
        cb.ALLOWED_ORIGINS.write_text("https://aio.example:18447\n", encoding="utf-8")

    def test_allowed_context(self):
        self.assertEqual(cb.validated_return_url(BROWSER), BROWSER)
        self.assertEqual(cb.validated_return_url(BROWSER_ROOT), BROWSER_ROOT)
        self.assertEqual(cb.validated_return_url(BROWSER_PROXY), BROWSER_PROXY)
        self.assertIsNone(cb.validated_return_url("https://aio.example:18447/#/details?played=12345678"))
        self.assertIsNone(cb.validated_return_url("https://aio.example:18447/?played=12345678&source=abcdef12"))
        self.assertIsNone(cb.validated_return_url("https://aio.example:18447/#/details"))
        self.assertIsNone(cb.validated_return_url("https://evil.example/#/details?played=12345678&source=abcdef12"))
        self.assertIsNone(cb.validated_return_url("https://aio.example:18447/aio/../admin/#/details?played=12345678&source=abcdef12"))
        self.assertEqual(cb.validated_return_url(DESKTOP), DESKTOP)
        self.assertIsNone(cb.validated_return_url("https://evil.example/jellyfin/web?played=12345678&source=abcdef12"))
        self.assertIsNone(cb.validated_return_url("https://aio.example:18447/admin?played=12345678&source=abcdef12"))
        self.assertIsNone(cb.validated_return_url("https://aio.example:18447/jellyfin/web?played=x&source=y"))
        self.assertIsNone(cb.validated_return_url("javascript:alert(1)?played=12345678&source=abcdef12"))
        self.assertIsNone(cb.validated_return_url(BROWSER + "&source=different-id"))
        self.assertIsNone(cb.validated_return_url("http://aio.example:18447/jellyfin/web#/details?played=12345678&source=abcdef12"))

    def test_session_no_signed_url_at_rest_and_one_callback(self):
        token = cb.create_session(MEDIA, BROWSER, now_ms=1_700_000_000_000)
        self.assertRegex(token, r"^[a-f0-9]{32}$")
        folder = cb.SESSION_DIR
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        text = (folder / (token + ".json")).read_text()
        self.assertNotIn("VERY_PRIVATE", text)
        self.assertNotIn("cdn.example", text)
        self.assertEqual((folder / (token + ".json")).stat().st_mode & 0o777, 0o600)
        self.assertIn(cb.media_fingerprint(MEDIA), text)
        seen = []
        self.assertTrue(cb.complete_session(token, 315, now_ms=1_700_000_000_200, opener=seen.append))
        self.assertEqual(len(seen), 1)
        self.assertIn("AIO_CALLBACK_RETURN=sent", cb.CALLBACK_LOG.read_text(encoding="utf-8"))
        url = urlsplit(seen[0])
        self.assertEqual(parse_qs(url.fragment.split("?")[1])["position"], ["315"])
        self.assertEqual(parse_qs(url.fragment.split("?")[1])["played"], ["12345678"])
        self.assertEqual(parse_qs(url.fragment.split("?")[1])["source"], ["abcdef12"])
        self.assertFalse(cb.complete_session(token, 315, now_ms=1_700_000_000_200, opener=seen.append))
        self.assertEqual(len(seen), 1)

    def test_root_browser_return(self):
        token = cb.create_session(MEDIA, BROWSER_ROOT, now_ms=1_700_000_000_000)
        self.assertIsNotNone(token)
        seen = []
        self.assertTrue(cb.complete_session(token, 420, now_ms=1_700_000_000_100, opener=seen.append))
        self.assertEqual(len(seen), 1)
        url = urlsplit(seen[0])
        self.assertEqual(url.path, "/")
        self.assertEqual(parse_qs(url.fragment.split("?", 1)[1])["position"], ["420"])

    def test_desktop(self):
        token = cb.create_session(MEDIA, DESKTOP, now_ms=1_700_000_000_000)
        seen = []
        self.assertTrue(cb.complete_session(token, 5, now_ms=1_700_000_000_500, opener=seen.append))
        self.assertEqual(urlsplit(seen[0]).scheme, "aiostreams")
        self.assertEqual(parse_qs(urlsplit(seen[0]).query)["position"], ["5"])

    def test_reject_expired_and_unknown_and_zero(self):
        token = cb.create_session(MEDIA, BROWSER, now_ms=1_700_000_000_000)
        self.assertFalse(cb.complete_session(token, 0, now_ms=1_700_000_000_020, opener=lambda _: None))
        self.assertFalse(cb.complete_session(token, 5, now_ms=1_700_011_000_000, opener=lambda _: None))
        self.assertFalse(cb.complete_session("not-a-session", 5, now_ms=1_700_000_000_020, opener=lambda _: None))
        self.assertIsNone(cb.create_session(MEDIA, "https://evil.example/jellyfin/web?played=12345678&source=abcdef12"))
        self.assertIsNone(cb.create_session("file:///etc/passwd", BROWSER))


if __name__ == "__main__":
    unittest.main()
