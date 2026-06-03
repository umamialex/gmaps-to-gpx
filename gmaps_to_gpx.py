#!/usr/bin/env python3
"""
gmaps_to_gpx.py — Convert a Google Maps directions link into a Sideways-compatible GPX.

Pipeline (figured out the hard way):
  1. Expand the share link (maps.app.goo.gl/...) and pull the `geocode=` parameter
     out of the redirect chain. It holds one token per stop, in route order
     (origin first, then each waypoint/destination).
  2. Decode each token. They're URL-safe base64 of a tiny protobuf:
        0x15 + fixed32 latitude, 0x1d + fixed32 longitude  (little-endian int, degrees * 1e6)
     Named places carry extra 0x29 / 0x31 fixed64 (ftid/cid) fields after the coords.
  3. Route through the exact stops with OSRM using continue_straight=true. That key
     forbids U-turns at waypoints, so stops on a spur/dead-end loop through cleanly
     instead of doubling back the same road.
  4. Emit a <trk>/<trkseg>/<trkpt> track — the only GPX flavor the Sideways app reads
     (it reports <rte>/<wpt> route+waypoint files as "corrupt").

Why correct coordinates matter: a route that "goes the wrong way on a road" is almost
always a bad stop coordinate, not a routing-engine quirk. Decoding the link gives the
exact stops Google used, which removes that whole class of problem.

Note: OSRM does not return elevation, so the track has no <ele> tags. (If you need
elevation, route the same decoded stops through BRouter car-eco instead — that's what
gpx.studio uses.)

Usage:
    python3 gmaps_to_gpx.py "https://maps.app.goo.gl/XXXX" -o route.gpx
    python3 gmaps_to_gpx.py "https://maps.app.goo.gl/XXXX" --name "My Drive"
    python3 gmaps_to_gpx.py "https://maps.app.goo.gl/XXXX" --print-stops   # just show stops
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
OSRM_DEFAULT = "https://router.project-osrm.org"


def expand_link(url: str, timeout: int = 30) -> str:
    """Follow the share link's redirects and return the URL that carries `geocode=`."""
    collected: list[str] = []

    class _Recorder(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            collected.append(newurl)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    opener = urllib.request.build_opener(_Recorder)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        resp = opener.open(req, timeout=timeout)
        collected.append(resp.geturl())
        resp.read(1)  # touch the body so the chain fully resolves
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        # A late hop (e.g. a consent page) may fail after we've already seen the
        # geocode URL — that's fine, we only need the recorded Location values.
        pass

    for candidate in collected:
        if "geocode=" in candidate:
            return candidate
    raise SystemExit(
        "Could not find a 'geocode=' parameter in the link's redirect chain.\n"
        "Make sure this is a Google Maps *directions* link with at least one stop."
    )


def decode_token(token: str) -> tuple[float, float]:
    """Decode one Google Maps geocode token to (lat, lon)."""
    raw = base64.urlsafe_b64decode(token)
    lat = lon = None
    i = 0
    while i < len(raw) and (lat is None or lon is None):
        tag = raw[i]
        if tag == 0x15:  # fixed32 latitude
            lat = struct.unpack_from("<i", raw, i + 1)[0] / 1e6
            i += 5
        elif tag == 0x1D:  # fixed32 longitude
            lon = struct.unpack_from("<i", raw, i + 1)[0] / 1e6
            i += 5
        elif tag in (0x29, 0x31):  # fixed64 ftid/cid — skip
            i += 9
        else:
            i += 1
    if lat is None or lon is None:
        raise ValueError(f"could not decode coordinates from token: {token!r}")
    return lat, lon


def extract_stops(expanded_url: str) -> list[tuple[float, float]]:
    """Pull the ordered list of (lat, lon) stops out of the expanded URL."""
    m = re.search(r"geocode=([^&]+)", expanded_url)
    if not m:
        raise SystemExit("No geocode parameter found in the expanded URL.")
    raw = urllib.parse.unquote(m.group(1))          # %3D -> '=', etc.
    tokens = [t for t in raw.split(";") if t.strip()]
    return [decode_token(t) for t in tokens]


def route_osrm(stops: list[tuple[float, float]], server: str, straight: bool,
               timeout: int = 60) -> tuple[list[tuple[float, float]], float, float]:
    """Route through stops via OSRM; return (track points, miles, hours)."""
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in stops)
    qs = "overview=full&geometries=geojson"
    if straight:
        qs += "&continue_straight=true"
    url = f"{server.rstrip('/')}/route/v1/driving/{coords}?{qs}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        data = json.load(resp)
    if data.get("code") != "Ok":
        raise SystemExit(f"OSRM routing failed: {data.get('code')} {data.get('message', '')}")
    route = data["routes"][0]
    pts = [(lat, lon) for lon, lat in route["geometry"]["coordinates"]]
    return pts, route["distance"] / 1609.34, route["duration"] / 3600.0


def write_gpx(points: list[tuple[float, float]], path: str, name: str) -> None:
    esc = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="gmaps_to_gpx.py" '
        'xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 '
        'http://www.topografix.com/GPX/1/1/gpx.xsd">',
        "  <metadata>",
        f"    <name>{esc}</name>",
        "  </metadata>",
        "  <trk>",
        f"    <name>{esc}</name>",
        "    <trkseg>",
    ]
    lines += [f'      <trkpt lat="{lat:.6f}" lon="{lon:.6f}"></trkpt>' for lat, lon in points]
    lines += ["    </trkseg>", "  </trk>", "</gpx>", ""]
    with open(path, "w") as f:
        f.write("\n".join(lines))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Convert a Google Maps route link to a Sideways GPX.")
    p.add_argument("url", help="Google Maps share/directions link (maps.app.goo.gl/... or full URL)")
    p.add_argument("-o", "--output", default="route.gpx", help="output GPX path (default: route.gpx)")
    p.add_argument("--name", default="Google Maps Route", help="track name")
    p.add_argument("--osrm", default=OSRM_DEFAULT, help=f"OSRM server (default: {OSRM_DEFAULT})")
    p.add_argument("--allow-uturns", action="store_true",
                   help="don't send continue_straight (lets stops double back)")
    p.add_argument("--print-stops", action="store_true",
                   help="just decode and print the stops, don't route or write a file")
    args = p.parse_args(argv)

    expanded = expand_link(args.url)
    stops = extract_stops(expanded)

    print(f"Decoded {len(stops)} stops:", file=sys.stderr)
    for i, (lat, lon) in enumerate(stops):
        label = "origin" if i == 0 else ("dest" if i == len(stops) - 1 else f"stop {i}")
        print(f"  {i:2d} [{label:6s}] {lat:.6f}, {lon:.6f}", file=sys.stderr)
    if args.print_stops:
        return 0

    points, miles, hours = route_osrm(stops, args.osrm, straight=not args.allow_uturns)
    write_gpx(points, args.output, args.name)
    print(f"Wrote {args.output}: {len(points)} points, {miles:.1f} mi, ~{hours:.2f} hr",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
