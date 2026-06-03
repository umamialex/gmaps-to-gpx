"""Shared test helpers."""

import json
import math
import os
import sys
import xml.etree.ElementTree as ET

# Make the top-level gmaps_to_gpx module importable when tests run.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
GPX_NS = "{http://www.topografix.com/GPX/1/1}"


def load_routes():
    """Return the fixture metadata (tokens, expected stops, gpx filenames)."""
    with open(os.path.join(FIXTURES, "routes.json")) as f:
        return json.load(f)


def fixture_path(name):
    return os.path.join(FIXTURES, name)


def parse_trackpoints(gpx_path):
    """Parse a GPX file and return a list of (lat, lon) trackpoints."""
    root = ET.parse(gpx_path).getroot()
    return [
        (float(pt.get("lat")), float(pt.get("lon")))
        for pt in root.iter(f"{GPX_NS}trkpt")
    ]


def miles(a, b):
    """Approximate distance in miles between two (lat, lon) points."""
    return math.hypot(
        (a[0] - b[0]) * 69.0,
        (a[1] - b[1]) * 69.0 * math.cos(math.radians(a[0])),
    )


def min_distance_to_track(point, track):
    """Closest distance (miles) from a point to any point on a track."""
    return min(miles(point, t) for t in track)
