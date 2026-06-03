# gmaps-to-gpx

Convert a Google Maps directions link into a GPX track that the **Sideways** app
(and other apps that read GPX *tracks*) will load.

It expands the share link, decodes the exact stop coordinates that Google embedded in
it, routes through them along real roads, and writes a `<trk>` GPX.

## Usage

```bash
python3 gmaps_to_gpx.py "https://maps.app.goo.gl/XXXXXXXX" -o route.gpx --name "My Drive"
```

Just inspect the stops without routing or writing a file:

```bash
python3 gmaps_to_gpx.py "https://maps.app.goo.gl/XXXXXXXX" --print-stops
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-o`, `--output` | `route.gpx` | Output GPX path |
| `--name` | `Google Maps Route` | Track name written into the GPX |
| `--osrm` | `https://router.project-osrm.org` | OSRM routing server |
| `--allow-uturns` | off | Drop `continue_straight`; lets stops double back the same road |
| `--print-stops` | off | Decode and print the stops, then exit |

No third-party dependencies — Python 3 standard library only.

## Tests

Run the offline test suite (no network needed) from the repo root:

```bash
python3 -m unittest discover
```

Offline tests cover geocode-token decoding, stop extraction, GPX structure /
Sideways compatibility, and verify that every decoded stop actually lies on its
route's track. Fixtures live in `tests/fixtures/` (two real routes).

There's also an opt-in end-to-end test that expands a real share link and routes it
through OSRM:

```bash
GMAPS_GPX_NETWORK_TESTS=1 python3 -m unittest discover
```

## How it works

1. **Expand the link.** `maps.app.goo.gl/...` redirects to a `maps.google.com/?geocode=...`
   URL. The `geocode=` parameter holds one token per stop, in route order (origin first,
   then each waypoint, then destination).
2. **Decode the stops.** Each token is URL-safe base64 of a small protobuf:
   `0x15` + fixed32 **latitude**, `0x1d` + fixed32 **longitude** (little-endian signed int,
   degrees × 1e6). Named places carry extra `0x29` / `0x31` fixed64 (ftid/cid) fields after
   the coordinates, which are skipped.
3. **Route the stops.** The decoded stops are sent to OSRM with `continue_straight=true`.
   That option forbids U-turns at waypoints, so a stop on a spur or dead-end **loops
   through** cleanly instead of doubling back on the road it arrived on.
4. **Write the track.** Output is `<trk>`/`<trkseg>`/`<trkpt>`. Sideways only reads tracks;
   it reports `<rte>`/`<wpt>` route+waypoint files as "corrupt".

## Notes & gotchas

- **Getting the coordinates right matters more than the routing engine.** A route that
  "goes the wrong way on a road" is almost always a bad stop coordinate, not a router quirk.
  Decoding the link gives the exact stops Google used, which avoids that entirely.
- **No elevation.** OSRM does not return elevation, so the track has no `<ele>` tags. If you
  want elevation, route the same decoded stops through **BRouter `car-eco`** instead — that's
  the engine [gpx.studio](https://gpx.studio) uses. (Heads-up: BRouter treats a U-turn at a
  waypoint as free, so `car-eco`/`car-fast` will double back on spur stops unless you add a
  nudge via-point on the exit road.)
- Google labels the **first stop** as "A" on the map (the origin is unlabeled), so on-map
  letters are offset by one from the entry order.
