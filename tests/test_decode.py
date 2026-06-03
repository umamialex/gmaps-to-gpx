"""Offline tests for geocode-token decoding and stop extraction."""

import base64
import unittest

from tests.helpers import (
    load_routes,
    fixture_path,
    parse_trackpoints,
    min_distance_to_track,
)
from gmaps_to_gpx import decode_token, extract_stops


class TestDecodeToken(unittest.TestCase):
    def test_tokens_match_expected_stops(self):
        routes = load_routes()
        for route_name, route in routes.items():
            # geocode_param is URL-encoded (%3D for '=', ';' between tokens).
            import urllib.parse

            tokens = urllib.parse.unquote(route["geocode_param"]).split(";")
            self.assertEqual(len(tokens), len(route["stops"]), route_name)
            for tok, (exp_lat, exp_lon) in zip(tokens, route["stops"]):
                lat, lon = decode_token(tok)
                self.assertAlmostEqual(lat, exp_lat, places=6, msg=f"{route_name}:{tok}")
                self.assertAlmostEqual(lon, exp_lon, places=6, msg=f"{route_name}:{tok}")

    def test_short_pin_token(self):
        # A short "pin" token (no ftid) -> exact coordinate.
        lat, lon = decode_token("FStyzQEdBksm-g==")
        self.assertAlmostEqual(lat, 30.241323, places=6)
        self.assertAlmostEqual(lon, -98.153722, places=6)

    def test_named_place_token_skips_ftid(self):
        # A long "named place" token carries extra ftid/cid bytes after the coords.
        lat, lon = decode_token("FfbSyQEdYgQn-imHHqE03l1bhjE17lZV4wAHJg==")
        self.assertAlmostEqual(lat, 30.003958, places=6)
        self.assertAlmostEqual(lon, -98.106270, places=6)

    def test_invalid_token_raises(self):
        # Valid base64 but no coordinate tags -> ValueError.
        junk = base64.urlsafe_b64encode(b"\x00\x01\x02\x03").decode()
        with self.assertRaises(ValueError):
            decode_token(junk)


class TestExtractStops(unittest.TestCase):
    def test_extract_from_url(self):
        routes = load_routes()
        for route_name, route in routes.items():
            url = (
                "https://maps.google.com/?geocode="
                + route["geocode_param"]
                + "&daddr=x&saddr=y&dirflg=d"
            )
            stops = extract_stops(url)
            self.assertEqual(len(stops), len(route["stops"]), route_name)
            for (lat, lon), (exp_lat, exp_lon) in zip(stops, route["stops"]):
                self.assertAlmostEqual(lat, exp_lat, places=6, msg=route_name)
                self.assertAlmostEqual(lon, exp_lon, places=6, msg=route_name)

    def test_missing_geocode_raises(self):
        with self.assertRaises(SystemExit):
            extract_stops("https://maps.google.com/?daddr=x")


class TestDecodedStopsLieOnTrack(unittest.TestCase):
    """Every decoded stop should sit on the route's actual GPX track."""

    def test_stops_are_on_track(self):
        routes = load_routes()
        for route_name, route in routes.items():
            track = parse_trackpoints(fixture_path(route["gpx"]))
            for i, stop in enumerate(route["stops"]):
                d = min_distance_to_track(tuple(stop), track)
                self.assertLess(
                    d, 0.25, msg=f"{route_name} stop {i} is {d:.2f} mi off its track"
                )


if __name__ == "__main__":
    unittest.main()
