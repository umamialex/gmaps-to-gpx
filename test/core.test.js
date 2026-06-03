import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  decodeToken,
  extractStops,
  buildGpx,
  buildOsrmUrl,
  parseOsrmResponse,
  buildRouteSvg,
  linkToGpx,
} from "../src/core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const routes = JSON.parse(readFileSync(join(FIXTURES, "routes.json"), "utf8"));

function trackpoints(name) {
  const gpx = readFileSync(join(FIXTURES, name), "utf8");
  const out = [];
  const re = /lat="([-\d.]+)" lon="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(gpx))) out.push({ lat: +m[1], lon: +m[2] });
  return out;
}

function miles(a, b) {
  return Math.hypot(
    (a.lat - b.lat) * 69,
    (a.lon - b.lon) * 69 * Math.cos((a.lat * Math.PI) / 180)
  );
}
const minDist = (p, track) => Math.min(...track.map((t) => miles(p, t)));

// --- decoding --------------------------------------------------------------

test("decodeToken matches expected stops for every fixture route", () => {
  for (const [name, route] of Object.entries(routes)) {
    const tokens = decodeURIComponent(route.geocode_param).split(";");
    assert.equal(tokens.length, route.stops.length, name);
    tokens.forEach((tok, i) => {
      const { lat, lon } = decodeToken(tok);
      assert.ok(Math.abs(lat - route.stops[i][0]) < 1e-6, `${name} lat ${i}`);
      assert.ok(Math.abs(lon - route.stops[i][1]) < 1e-6, `${name} lon ${i}`);
    });
  }
});

test("decodeToken handles a short pin token", () => {
  const { lat, lon } = decodeToken("FStyzQEdBksm-g==");
  assert.ok(Math.abs(lat - 30.241323) < 1e-6);
  assert.ok(Math.abs(lon - -98.153722) < 1e-6);
});

test("decodeToken skips ftid/cid on a named-place token", () => {
  const { lat, lon } = decodeToken("FfbSyQEdYgQn-imHHqE03l1bhjE17lZV4wAHJg==");
  assert.ok(Math.abs(lat - 30.003958) < 1e-6);
  assert.ok(Math.abs(lon - -98.10627) < 1e-6);
});

test("decodeToken throws on a token with no coordinates", () => {
  assert.throws(() => decodeToken(btoa("\x00\x01\x02\x03")), /could not decode/);
});

// --- stop extraction -------------------------------------------------------

test("extractStops parses a full directions URL", () => {
  for (const [name, route] of Object.entries(routes)) {
    const url = `https://maps.google.com/?geocode=${route.geocode_param}&daddr=x&saddr=y`;
    const stops = extractStops(url);
    assert.equal(stops.length, route.stops.length, name);
    stops.forEach((s, i) => {
      assert.ok(Math.abs(s.lat - route.stops[i][0]) < 1e-6, `${name} ${i}`);
      assert.ok(Math.abs(s.lon - route.stops[i][1]) < 1e-6, `${name} ${i}`);
    });
  }
});

test("extractStops throws when geocode is missing", () => {
  assert.throws(() => extractStops("https://maps.google.com/?daddr=x"), /geocode=/);
});

test("every decoded stop lies on its route's track", () => {
  for (const [name, route] of Object.entries(routes)) {
    const track = trackpoints(route.gpx);
    route.stops.forEach(([lat, lon], i) => {
      const d = minDist({ lat, lon }, track);
      assert.ok(d < 0.25, `${name} stop ${i} is ${d.toFixed(2)} mi off track`);
    });
  }
});

// --- GPX output ------------------------------------------------------------

const SAMPLE = [
  { lat: 30.1, lon: -98.1 },
  { lat: 30.11, lon: -98.12 },
  { lat: 30.12, lon: -98.13 },
];

test("buildGpx emits a track, not route/waypoints (Sideways compatibility)", () => {
  const gpx = buildGpx(SAMPLE, "Test");
  assert.match(gpx, /<trk>/);
  assert.match(gpx, /<trkseg>/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, SAMPLE.length);
  assert.ok(!/<wpt[ >]/.test(gpx), "no <wpt>");
  assert.ok(!/<rte[ >]/.test(gpx), "no <rte>");
  assert.ok(!/<rtept[ >]/.test(gpx), "no <rtept>");
});

test("buildGpx round-trips coordinates", () => {
  const out = (() => {
    const gpx = buildGpx(SAMPLE, "Test");
    const pts = [];
    const re = /lat="([-\d.]+)" lon="([-\d.]+)"/g;
    let m;
    while ((m = re.exec(gpx))) pts.push({ lat: +m[1], lon: +m[2] });
    return pts;
  })();
  assert.equal(out.length, SAMPLE.length);
  out.forEach((p, i) => {
    assert.ok(Math.abs(p.lat - SAMPLE[i].lat) < 1e-6);
    assert.ok(Math.abs(p.lon - SAMPLE[i].lon) < 1e-6);
  });
});

test("buildGpx XML-escapes the track name", () => {
  const gpx = buildGpx(SAMPLE, "A & B <x>");
  assert.match(gpx, /A &amp; B &lt;x&gt;/);
  assert.ok(!gpx.includes("A & B <x>"));
});

test("fixtures themselves are track-based GPX", () => {
  for (const [name, route] of Object.entries(routes)) {
    const gpx = readFileSync(join(FIXTURES, route.gpx), "utf8");
    assert.match(gpx, /<trkpt /, name);
    assert.ok(!/<wpt[ >]/.test(gpx), `${name} has no <wpt>`);
    assert.ok(!/<rtept[ >]/.test(gpx), `${name} has no <rtept>`);
  }
});

// --- routing helpers (pure) ------------------------------------------------

test("buildOsrmUrl formats coordinates lon,lat and adds continue_straight", () => {
  const url = buildOsrmUrl(SAMPLE, {});
  assert.match(url, /driving\/-98\.100000,30\.100000;/);
  assert.match(url, /continue_straight=true/);
  assert.ok(!buildOsrmUrl(SAMPLE, { straight: false }).includes("continue_straight"));
});

test("parseOsrmResponse maps geometry and throws on non-Ok", () => {
  const ok = {
    code: "Ok",
    routes: [{ distance: 1609.34, duration: 3600, geometry: { coordinates: [[-98.1, 30.1], [-98.2, 30.2]] } }],
  };
  const { points, miles: mi, hours } = parseOsrmResponse(ok);
  assert.deepEqual(points[0], { lat: 30.1, lon: -98.1 });
  assert.ok(Math.abs(mi - 1) < 1e-6);
  assert.ok(Math.abs(hours - 1) < 1e-6);
  assert.throws(() => parseOsrmResponse({ code: "NoRoute" }), /OSRM routing failed/);
});

// --- route drawing ---------------------------------------------------------

test("buildRouteSvg draws a polyline with start/finish markers", () => {
  const pts = [
    { lat: 30.1, lon: -98.1 },
    { lat: 30.2, lon: -98.2 },
    { lat: 30.15, lon: -98.05 },
  ];
  const stops = [
    { lat: 30.1, lon: -98.1 },
    { lat: 30.15, lon: -98.05 },
  ];
  const svg = buildRouteSvg(pts, stops, { width: 200, height: 100 });
  assert.match(svg, /<svg /);
  assert.match(svg, /viewBox="0 0 200 100"/);
  assert.match(svg, /<polyline /);
  assert.equal((svg.match(/<circle /g) || []).length, 2); // start + finish
  assert.match(svg, /#3ecf8e/); // start green
  assert.match(svg, /#ff5a5a/); // finish red
  // projected coordinates stay within the box
  for (const m of svg.matchAll(/(?:points="|cx=")([\d.]+)/g)) {
    assert.ok(Number(m[1]) >= 0 && Number(m[1]) <= 200);
  }
});

test("buildRouteSvg returns empty string for no points", () => {
  assert.equal(buildRouteSvg([]), "");
});

// --- orchestration with injected I/O (no real network) ---------------------

test("linkToGpx wires expand -> decode -> route -> gpx with injected fns", async () => {
  const route = routes.hill_country;
  const fakeExpand = async () =>
    `https://maps.google.com/?geocode=${route.geocode_param}&daddr=x`;
  // Fake OSRM: echo the stops back as a 2-point line.
  const fakeFetch = async (url) => ({
    ok: true,
    json: async () => ({
      code: "Ok",
      routes: [
        {
          distance: 1609.34,
          duration: 3600,
          geometry: { coordinates: [[-98.0, 30.0], [-98.1, 30.1]] },
        },
      ],
    }),
  });
  const res = await linkToGpx({
    url: "https://maps.app.goo.gl/whatever",
    expandToText: fakeExpand,
    fetchImpl: fakeFetch,
    name: "Injected",
  });
  assert.equal(res.stops.length, route.stops.length);
  assert.equal(res.points.length, 2);
  assert.match(res.gpx, /<trkpt /);
  assert.match(res.gpx, /<name>Injected<\/name>/);
});

// --- opt-in end-to-end (real network) --------------------------------------

const NETWORK = process.env.GMAPS_GPX_NETWORK_TESTS === "1";

test(
  "end-to-end: real link -> OSRM matches the fixture track",
  { skip: NETWORK ? false : "set GMAPS_GPX_NETWORK_TESTS=1 to run" },
  async () => {
    const { expandToText } = await import("../src/node-expand.js");
    const res = await linkToGpx({
      url: "https://maps.app.goo.gl/5bUHyyQonJLkeHEn7?g_st=ic",
      expandToText,
      name: "Hill Country Drive",
    });
    const expected = trackpoints("route_hill_country.gpx");
    assert.ok(res.points.length > 100);
    const ratio = res.points.length / expected.length;
    assert.ok(ratio > 0.8 && ratio < 1.25, `point-count ratio ${ratio.toFixed(2)}`);
    const sample = res.points.filter((_, i) => i % Math.ceil(res.points.length / 200) === 0);
    const worst = Math.max(...sample.map((p) => minDist(p, expected)));
    assert.ok(worst < 0.5, `max deviation ${worst.toFixed(2)} mi`);
  }
);
