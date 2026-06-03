// Shared business logic for gmaps-to-gpx.
//
// This module is platform-agnostic: it contains only pure transforms plus a
// few orchestration helpers that take an injected `fetch`/expander. The Node
// CLI (bin/cli.js) and the browser app (app.js) both import it unchanged.
//
// Pipeline: expand link -> decode geocode tokens -> route via OSRM -> build GPX.

export const OSRM_DEFAULT = "https://router.project-osrm.org";

// --- geocode token decoding ------------------------------------------------

function base64urlToBytes(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b); // global in modern Node and browsers
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode one Google Maps geocode token to {lat, lon}.
 *
 * Tokens are URL-safe base64 of a tiny protobuf:
 *   0x15 + fixed32 latitude, 0x1d + fixed32 longitude
 *   (little-endian signed int, degrees * 1e6).
 * Named places carry extra 0x29 / 0x31 fixed64 (ftid/cid) fields after the
 * coordinates, which are skipped.
 */
export function decodeToken(token) {
  const bytes = base64urlToBytes(token);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let lat = null;
  let lon = null;
  let i = 0;
  while (i < bytes.length && (lat === null || lon === null)) {
    const tag = bytes[i];
    if (tag === 0x15 && i + 5 <= bytes.length) {
      lat = dv.getInt32(i + 1, true) / 1e6;
      i += 5;
    } else if (tag === 0x1d && i + 5 <= bytes.length) {
      lon = dv.getInt32(i + 1, true) / 1e6;
      i += 5;
    } else if (tag === 0x29 || tag === 0x31) {
      i += 9; // skip fixed64 ftid/cid
    } else {
      i += 1;
    }
  }
  if (lat === null || lon === null) {
    throw new Error(`could not decode coordinates from token: ${token}`);
  }
  return { lat, lon };
}

/**
 * Pull the `geocode=` value out of any text that contains it — a Google Maps
 * directions URL, or the HTML body returned when a short link is expanded.
 */
export function extractGeocodeParam(text) {
  const m = text.match(/geocode=([^&"'\s]+)/);
  if (!m) {
    throw new Error(
      "No 'geocode=' parameter found. Make sure this is a Google Maps " +
        "directions link with at least one stop."
    );
  }
  return decodeURIComponent(m[1]); // %3D -> '=', etc.
}

/** Decode an ordered list of {lat, lon} stops from text containing geocode=. */
export function extractStops(text) {
  const raw = extractGeocodeParam(text);
  const tokens = raw.split(";").filter((t) => t.trim());
  return tokens.map(decodeToken);
}

// --- routing ---------------------------------------------------------------

export function buildOsrmUrl(stops, { server = OSRM_DEFAULT, straight = true } = {}) {
  const coords = stops
    .map((s) => `${s.lon.toFixed(6)},${s.lat.toFixed(6)}`)
    .join(";");
  let qs = "overview=full&geometries=geojson";
  if (straight) qs += "&continue_straight=true";
  return `${server.replace(/\/$/, "")}/route/v1/driving/${coords}?${qs}`;
}

/** Turn an OSRM JSON response into {points, miles, hours}. */
export function parseOsrmResponse(data) {
  if (data.code !== "Ok") {
    throw new Error(`OSRM routing failed: ${data.code} ${data.message || ""}`.trim());
  }
  const route = data.routes[0];
  const points = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  return { points, miles: route.distance / 1609.34, hours: route.duration / 3600 };
}

/** Route through stops via OSRM using the injected fetch implementation. */
export async function routeStops(
  stops,
  { fetchImpl = fetch, server = OSRM_DEFAULT, straight = true } = {}
) {
  const url = buildOsrmUrl(stops, { server, straight });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`OSRM request failed (HTTP ${res.status})`);
  return parseOsrmResponse(await res.json());
}

// --- link expansion --------------------------------------------------------

/**
 * Follow a share link's redirects until a URL carrying `geocode=` is found.
 * `fetchLocation(url)` must return the next redirect URL, or null/undefined
 * when there is no further redirect. (Platform-specific; injected.)
 */
export async function resolveGeocodeUrl(startUrl, fetchLocation, maxHops = 10) {
  let url = startUrl;
  for (let hop = 0; hop < maxHops; hop++) {
    if (url.includes("geocode=")) return url;
    const next = await fetchLocation(url);
    if (!next) break;
    url = next;
  }
  if (url.includes("geocode=")) return url;
  throw new Error(
    "Could not find a 'geocode=' parameter in the link's redirect chain."
  );
}

// --- GPX output ------------------------------------------------------------

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build a <trk> GPX string. Sideways only reads tracks; it reports
 * <rte>/<wpt> route+waypoint files as "corrupt".
 */
export function buildGpx(points, name = "Google Maps Route") {
  const n = xmlEscape(name);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="gmaps-to-gpx" ' +
      'xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 ' +
      'http://www.topografix.com/GPX/1/1/gpx.xsd">',
    "  <metadata>",
    `    <name>${n}</name>`,
    "  </metadata>",
    "  <trk>",
    `    <name>${n}</name>`,
    "    <trkseg>",
  ];
  for (const p of points) {
    lines.push(`      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"></trkpt>`);
  }
  lines.push("    </trkseg>", "  </trk>", "</gpx>", "");
  return lines.join("\n");
}

// --- route drawing ---------------------------------------------------------

/**
 * Render the routed track as a standalone SVG string (no map tiles, no deps).
 * Yellow trace with start (green), finish (red), and intermediate stop markers.
 * Uses an equirectangular projection with longitude scaled by cos(lat) so the
 * shape isn't distorted, fit to the given box while preserving aspect ratio.
 */
export function buildRouteSvg(points, stops = [], opts = {}) {
  const { width = 720, height = 340, padding = 18 } = opts;
  if (!points || points.length === 0) return "";

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)) || 1;
  const spanX = (maxLon - minLon) * kx || 1e-6;
  const spanY = maxLat - minLat || 1e-6;
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const project = (lat, lon) => [
    offX + (lon - minLon) * kx * scale,
    offY + (maxLat - lat) * scale,
  ];

  const poly = points
    .map((p) => {
      const [x, y] = project(p.lat, p.lon);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const dot = (lat, lon, fill, r) => {
    const [x, y] = project(lat, lon);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="#0a0a0a" stroke-width="1.5"/>`;
  };
  const markers = stops
    .map((s, i) =>
      i === 0
        ? dot(s.lat, s.lon, "#3ecf8e", 6)
        : i === stops.length - 1
          ? dot(s.lat, s.lon, "#ff5a5a", 6)
          : dot(s.lat, s.lon, "#ffffff", 4)
    )
    .join("");

  return (
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Route preview">` +
    `<polyline points="${poly}" fill="none" stroke="#ffe600" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    markers +
    `</svg>`
  );
}

// --- orchestration ---------------------------------------------------------

/**
 * Full pipeline shared by CLI and web. Callers inject:
 *   - expandToText(url): resolve a link to text containing `geocode=`
 *                        (an expanded URL string, or an HTML body).
 *   - fetchImpl:         a fetch() for the OSRM request.
 * Returns { stops, points, miles, hours, gpx }.
 */
export async function linkToGpx({
  url,
  expandToText,
  fetchImpl = fetch,
  name = "Google Maps Route",
  straight = true,
  osrmServer = OSRM_DEFAULT,
}) {
  const text = await expandToText(url);
  const stops = extractStops(text);
  const { points, miles, hours } = await routeStops(stops, {
    fetchImpl,
    server: osrmServer,
    straight,
  });
  return { stops, points, miles, hours, gpx: buildGpx(points, name) };
}
