#!/usr/bin/env python3
"""Offline Quick Connect setup tests. No live API, Keychain or file writes."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import setup_quickconnect as m


class SetupTests(unittest.TestCase):
    def setUp(self):
        m.configure_origin("https://aio.example:18447/jellyfin")

    def test_approved_origin_requires_https_and_no_secret(self):
        self.assertEqual(m.ORIGIN, "https://aio.example:18447")
        for invalid in ("http://aio.example", "https://user:secret@aio.example",
                        "https://aio.example/path", "https://aio.example:99999",
                        "https://aio..example"):
            with self.assertRaises(ValueError):
                m.configure_origin(invalid)

    def test_quick_connect_hides_secret_and_token(self):
        calls = []
        def fake_api(route, *, post=None):
            calls.append((route, post))
            if route == "/QuickConnect/Initiate":
                return {"Code": "123456", "Secret": "private-quickconnect-secret-123"}
            if route.startswith("/QuickConnect/Connect?secret="):
                return {"Authenticated": True}
            if route == "/Users/AuthenticateWithQuickConnect":
                self.assertEqual(post, {"Secret": "private-quickconnect-secret-123"})
                return {"AccessToken": "private-user-access-token-abcdefghijklmnopqrstuvwxyz"}
            raise AssertionError("Unexpected API route")
        output = io.StringIO()
        with patch.object(m, "api_json", side_effect=fake_api), \
             patch.object(m.time, "sleep"), \
             patch.object(m.time, "monotonic", side_effect=[0, 1]), \
             contextlib.redirect_stdout(output):
            token = m.quick_connect()
        self.assertTrue(token.startswith("private-user-access-token"))
        self.assertIn("123456", output.getvalue())
        self.assertNotIn("private-quickconnect-secret", output.getvalue())
        self.assertNotIn("private-user-access-token", output.getvalue())
        self.assertEqual(len(calls), 3)

    def test_rejects_unexpected_quick_connect_response(self):
        with patch.object(m, "api_json", return_value={"Code": "", "Secret": "long-secret"}):
            with self.assertRaises(ValueError):
                m.quick_connect()

    def test_api_route_is_origin_fixed(self):
        for unsafe in ("https://evil.example", "//evil.example", "bad", "/\\evil"):
            with self.assertRaises(ValueError):
                m.api_json(unsafe)

    def test_private_config_is_exclusive(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / "bridge" / "identity-settings.json"
            with patch.object(m, "CONFIG", target):
                m.save_private_config()
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads(target.read_text()),
                                 {"enabled": True, "origin": m.ORIGIN})
                with self.assertRaises(RuntimeError):
                    m.save_private_config()

    def test_keychain_uses_native_security_framework(self):
        class NativeCall:
            def __init__(self):
                self.calls = []
            def __call__(self, *args):
                self.calls.append(args)
                return 0
        native = NativeCall()
        class Framework:
            SecKeychainAddGenericPassword = native
        with patch.object(m.sys, "platform", "darwin"), \
             patch.object(m.ctypes, "CDLL", return_value=Framework()):
            m.save_keychain("abcdefghijklmnopqrstuv123456")
        self.assertEqual(len(native.calls), 1)
        self.assertEqual(native.calls[0][2], m.SERVICE.encode())
        self.assertEqual(native.calls[0][4], m.ORIGIN.encode())
        self.assertEqual(native.calls[0][6], b"abcdefghijklmnopqrstuv123456")


if __name__ == "__main__":
    unittest.main()
