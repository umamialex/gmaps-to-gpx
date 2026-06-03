"""End-to-end tests that hit the network (link expansion + OSRM routing).

These are skipped by default. Enable with:

    GMAPS_GPX_NETWORK_TESTS=1 python3 -m unittest discover

They depend on external services (the Google share link and the public OSRM
server), so treat failures as "network/service unavailable" rather than a bug
in the code unless the offline tests also fail.
"""

import os
import tempfile
import unittest

from tests.helpers import fixture_path, parse_trackpoints, min_distance_to_track
from gmaps_to_gpx import main

HILL_COUNTRY_LINK = "https://maps.app.goo.gl/5bUHyyQonJLkeHEn7?g_st=ic"

NETWORK = os.environ.get("GMAPS_GPX_NETWORK_TESTS") == "1"


@unittest.skipUnless(NETWORK, "set GMAPS_GPX_NETWORK_TESTS=1 to run network tests")
class TestEndToEnd(unittest.TestCase):
    def test_link_to_gpx_matches_fixture(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".gpx", delete=False)
        tmp.close()
        try:
            rc = main([HILL_COUNTRY_LINK, "-o", tmp.name, "--name", "Hill Country Drive"])
            self.assertEqual(rc, 0)
            produced = parse_trackpoints(tmp.name)
            expected = parse_trackpoints(fixture_path("route_hill_country.gpx"))

            # Point counts should be close (road network/OSRM may shift slightly).
            self.assertGreater(len(produced), 100)
            ratio = len(produced) / len(expected)
            self.assertTrue(0.8 < ratio < 1.25, f"point-count ratio {ratio:.2f}")

            # The produced track should hug the fixture everywhere.
            sample = produced[:: max(1, len(produced) // 200)]
            worst = max(min_distance_to_track(p, expected) for p in sample)
            self.assertLess(worst, 0.5, f"max deviation {worst:.2f} mi from fixture")
        finally:
            os.unlink(tmp.name)


if __name__ == "__main__":
    unittest.main()
