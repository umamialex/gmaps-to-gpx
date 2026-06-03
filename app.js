// Browser entry point. Uses the same shared core as the CLI (src/core.js).
//
// Link expansion: the browser can't follow Google's redirect itself (CORS), so
// short links are expanded through a public CORS proxy that returns the page
// body (which contains the geocode= URL). If the user already pasted an
// expanded URL, we skip the proxy. OSRM is called directly (it sends CORS *).

import { linkToGpx, buildRouteSvg } from "./src/core.js";

// The browser can't follow Google's short-link redirect itself (CORS).
//
// Best path: a Cloudflare Worker (see worker/) that resolves the link
// server-side and returns it with CORS. Set EXPAND_WORKER to your deployed URL.
//
// Fallback: public CORS proxies. They're inconsistent — the server they fetch
// from sometimes gets a Google consent/shell page with no route data — so we
// try several and use the first response that actually contains `geocode=`.
const EXPAND_WORKER = "https://gmaps-expand.umamialex.workers.dev";

const CORS_PROXIES = [
  ...(EXPAND_WORKER ? [(u) => `${EXPAND_WORKER}/?url=${encodeURIComponent(u)}`] : []),
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

const $ = (id) => document.getElementById(id);
const form = $("form");
const statusEl = $("status");
const resultEl = $("result");
let lastGpx = null;
let lastFilename = "route.gpx";

/** Resolve a link to text containing geocode= (expanded URL or proxied body). */
async function expandToText(input) {
  const url = input.trim();
  if (url.includes("geocode=")) return url; // user pasted an expanded URL already

  for (const makeUrl of CORS_PROXIES) {
    try {
      const res = await fetch(makeUrl(url));
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("geocode=")) return text;
    } catch {
      // CORS/network error on this proxy — try the next one
    }
  }
  throw new Error(
    "Couldn't read that link automatically. Open it in Google Maps, then copy the " +
      "full URL from the address bar and paste that here instead."
  );
}

function setStatus(msg, kind) {
  statusEl.hidden = !msg;
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function slugify(name) {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "route") + ".gpx";
}

function renderResult({ stops, points, miles, hours, gpx }, name) {
  lastGpx = gpx;
  lastFilename = slugify(name);

  $("route-map").innerHTML = buildRouteSvg(points, stops, { width: 720, height: 320 });

  $("stat-distance").textContent = `${miles.toFixed(1)} mi`;
  $("stat-time").textContent = hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} hr`;
  $("stat-stops").textContent = stops.length;

  const ol = $("stops");
  ol.innerHTML = "";
  stops.forEach((s, i) => {
    const li = document.createElement("li");
    const endpoint = i === 0 || i === stops.length - 1;
    const label = i === 0 ? "Start" : i === stops.length - 1 ? "Finish" : `Stop ${i}`;
    li.textContent = `${label} — ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`;
    if (endpoint) li.className = "endpoint";
    ol.appendChild(li);
  });

  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value;
  const name = $("name").value || "Google Maps Route";
  const straight = !$("uturns").checked;

  $("go").disabled = true;
  resultEl.hidden = true;
  setStatus("Plotting your stage…", "working");

  try {
    const result = await linkToGpx({ url, expandToText, name, straight });
    renderResult(result, name);
    setStatus("", null);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    $("go").disabled = false;
  }
});

$("download").addEventListener("click", () => {
  if (!lastGpx) return;
  const blob = new Blob([lastGpx], { type: "application/gpx+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = lastFilename;
  a.click();
  URL.revokeObjectURL(a.href);
});
