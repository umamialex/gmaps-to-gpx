# gmaps-to-gpx

Convert a Google Maps directions link into a GPX **track** that the **Sideways** app
(and other apps that read GPX tracks) will load.

It expands the share link, decodes the exact stop coordinates that Google embedded in it,
routes them along real roads, and writes a `<trk>` GPX. Available as both a **command-line
tool** and a **browser app** — both share the same core logic (`src/core.js`).

## Web app

A static, no-backend page (deployable to GitHub Pages): paste a link, get a GPX.
Run it locally with:

```bash
npm run serve     # http://localhost:8080
```

The browser can't follow Google's short-link redirect itself (CORS), so short links are
expanded through a public CORS proxy; routing then calls the public OSRM server directly
(it allows CORS). If expansion ever fails, open the link once and paste the resulting
expanded URL (the app detects `geocode=` and skips the proxy).

## CLI

```bash
node bin/cli.js "https://maps.app.goo.gl/XXXXXXXX" -o route.gpx --name "My Drive"
# or, after `npm link`:
gmaps-to-gpx "https://maps.app.goo.gl/XXXXXXXX" -o route.gpx
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o`, `--output` | `route.gpx` | Output GPX path |
| `--name` | `Google Maps Route` | Track name |
| `--osrm` | `https://router.project-osrm.org` | OSRM server |
| `--allow-uturns` | off | Drop `continue_straight`; lets stops double back |
| `--print-stops` | off | Decode and print the stops, then exit |
| `-h`, `--help` | | Show help |

Node ≥ 18, no third-party dependencies.

## Architecture

```
src/core.js        Shared, platform-agnostic business logic (pure + orchestration)
src/node-expand.js Node-only: follow the share link's redirects to the geocode URL
bin/cli.js         CLI entry — core + node-expand
index.html         Web app — core + a CORS-proxy expander, OSRM direct
app.js / styles.css
scripts/serve.js   Local static server for web dev
test/              node:test suite + fixtures
```

`core.js` exports pure functions — `decodeToken`, `extractStops`, `buildOsrmUrl`,
`parseOsrmResponse`, `buildGpx` — plus an orchestrator, `linkToGpx({ url, expandToText,
fetchImpl, ... })`, that takes the platform-specific link-expander and `fetch` as
injected dependencies. The CLI and the web app each supply their own expander; everything
else is identical between them.

### How it works

1. **Expand the link.** `maps.app.goo.gl/...` redirects to a `maps.google.com/?geocode=...`
   URL whose `geocode=` parameter holds one token per stop, in route order.
2. **Decode the stops.** Each token is URL-safe base64 of a small protobuf:
   `0x15` + fixed32 **latitude**, `0x1d` + fixed32 **longitude** (little-endian signed int,
   degrees × 1e6). Named places carry extra `0x29`/`0x31` fixed64 (ftid/cid) fields after the
   coordinates, which are skipped.
3. **Route the stops** through OSRM with `continue_straight=true` — that forbids U-turns at
   waypoints, so a stop on a spur/dead-end **loops through** instead of doubling back.
4. **Write the track** as `<trk>`/`<trkseg>`/`<trkpt>` (Sideways rejects `<rte>`/`<wpt>`).

## Tests

```bash
npm test                                   # offline unit tests
GMAPS_GPX_NETWORK_TESTS=1 npm test         # also runs the live end-to-end test
```

Offline tests cover token decoding, stop extraction, OSRM URL/response helpers, GPX
structure / Sideways compatibility, the orchestrator (with injected fake I/O), and verify
that every decoded stop actually lies on its route's track. Fixtures in `test/fixtures/`
are two real routes.

## Deploying the web app

A GitHub Actions workflow (`.github/workflows/pages.yml`) publishes the repo to GitHub
Pages on push to `main`. Enable **Settings → Pages → Source: GitHub Actions** once. The web
app imports the shared `src/core.js`, so the whole repo root is published; the app lives at
the site root.

## Notes & gotchas

- **Getting the coordinates right matters more than the routing engine.** A route that
  "goes the wrong way on a road" is almost always a bad stop coordinate, not a router quirk.
  Decoding the link gives the exact stops Google used.
- **No elevation.** OSRM doesn't return elevation, so tracks have no `<ele>` tags. (gpx.studio
  uses BRouter, which does — but BRouter treats U-turns at waypoints as free and will double
  back on spur stops unless you add a nudge via-point on the exit road.)
- Google labels the **first stop** as "A" on the map (the origin is unlabeled), so on-map
  letters are offset by one from entry order.
