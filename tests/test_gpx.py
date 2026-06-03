"""Offline tests for GPX writing and Sideways compatibility."""

import os
import tempfile
import unittest
import xml.etree.ElementTree as ET

from tests.helpers import load_routes, fixture_path, parse_trackpoints, GPX_NS
from gmaps_to_gpx import write_gpx


class TestWriteGpx(unittest.TestCase):
    def setUp(self):
        self.points = [(30.10, -98.10), (30.11, -98.12), (30.12, -98.13)]
        self.tmp = tempfile.NamedTemporaryFile(suffix=".gpx", delete=False)
        self.tmp.close()

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_is_wellformed_track_gpx(self):
        write_gpx(self.points, self.tmp.name, "Test Route")
        root = ET.parse(self.tmp.name).getroot()
        self.assertEqual(root.tag, f"{GPX_NS}gpx")
        self.assertIsNotNone(root.find(f"{GPX_NS}trk"))
        trkpts = list(root.iter(f"{GPX_NS}trkpt"))
        self.assertEqual(len(trkpts), len(self.points))

    def test_no_route_or_waypoint_elements(self):
        # Sideways treats <rte>/<wpt> files as corrupt; we must emit only tracks.
        write_gpx(self.points, self.tmp.name, "Test Route")
        root = ET.parse(self.tmp.name).getroot()
        self.assertEqual(list(root.iter(f"{GPX_NS}wpt")), [])
        self.assertEqual(list(root.iter(f"{GPX_NS}rte")), [])
        self.assertEqual(list(root.iter(f"{GPX_NS}rtept")), [])

    def test_coordinates_round_trip(self):
        write_gpx(self.points, self.tmp.name, "Test Route")
        out = parse_trackpoints(self.tmp.name)
        self.assertEqual(len(out), len(self.points))
        for (la, lo), (ela, elo) in zip(out, self.points):
            self.assertAlmostEqual(la, ela, places=6)
            self.assertAlmostEqual(lo, elo, places=6)

    def test_name_is_xml_escaped(self):
        write_gpx(self.points, self.tmp.name, "A & B <test>")
        root = ET.parse(self.tmp.name).getroot()  # would raise if not escaped
        name = root.find(f"{GPX_NS}metadata/{GPX_NS}name")
        self.assertEqual(name.text, "A & B <test>")


class TestFixturesAreSidewaysCompatible(unittest.TestCase):
    def test_fixtures_are_tracks(self):
        routes = load_routes()
        for route_name, route in routes.items():
            root = ET.parse(fixture_path(route["gpx"])).getroot()
            self.assertTrue(list(root.iter(f"{GPX_NS}trkpt")), route_name)
            self.assertEqual(list(root.iter(f"{GPX_NS}wpt")), [], route_name)
            self.assertEqual(list(root.iter(f"{GPX_NS}rtept")), [], route_name)


if __name__ == "__main__":
    unittest.main()
