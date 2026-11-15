#!/usr/bin/env python3
"""No-network, no-token-echo test for the Catch-up context/API preflight."""
import unittest

import inspect_catchup as m


class PreflightTests(unittest.TestCase):
    def test_desktop_context(self):
        self.assertEqual(m.markers(
            "aiostreams://return/12345678?played=12345678&source=abcdef12",
            "https://aio.example"), ("12345678", "abcdef12"))
        self.assertIsNone(m.markers(
            "https://evil.example/#/live?played=12345678&source=abcdef12",
            "https://aio.example"))

    def test_probe_validates_selected_source_without_outputting_identity(self):
        routes = []
        def fetch(origin, route, token):
            self.assertEqual(origin, "https://aio.example")
            self.assertEqual(token, "private-user-token")
            routes.append(route)
            if route.startswith("/Items?"):
                return {"Items": [{"Id": "12345678", "Type": "Program",
                    "Name": "Man Fire Food", "aiostreams": {"catchup": True}}]}
            return {"MediaSources": [{"Id": "abcdef12"}]}
        result = m.inspect("https://aio.example", "private-user-token",
                           contexts=[("12345678", "abcdef12")], fetch=fetch)
        self.assertIn("EPG_READY: YES", result)
        self.assertNotIn("private-user-token", result)
        self.assertNotIn("12345678", result)
        self.assertNotIn("abcdef12", result)
        self.assertEqual(len(routes), 2)

    def test_rejects_unmatched_source(self):
        def fetch(_, route, _token):
            if route.startswith("/Items?"):
                return {"Items": [{"Id": "12345678", "Type": "Program",
                    "aiostreams": {"catchup": True}}]}
            return {"MediaSources": [{"Id": "badcafe0"}]}
        self.assertIn("BLOCKED", m.inspect("https://aio.example", "private-token",
            contexts=[("12345678", "abcdef12")], fetch=fetch))


if __name__ == "__main__":
    unittest.main()
