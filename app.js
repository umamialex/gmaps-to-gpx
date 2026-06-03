// Browser entry point. Uses the same shared core as the CLI (src/core.js).
//
// Link expansion: the browser can't follow Google's redirect itself (CORS), so
// short links are expanded through a public CORS proxy that returns the page
// body (which contains the geocode= URL). If the user already pasted an
// expanded URL, we skip the proxy. OSRM is called directly (it sends CORS *).

import { linkToGpx } from "./src/core.js";

const CORS_PROXY = "https://api.codetabs.com/v1/proxy/?quest=";

const $ = (id) => document.getElementById(id);
const form = $("form");
const statusEl = $("status");
const resultEl = $("result");
let lastGpx = null;
let lastFilename = "route.gpx";

/** Resolve a link to text containing geocode= (expanded URL or proxied body). */
async function expandToText(input) {
  const url = input.trim();
  if (url.includes("geocode=")) return url; // user pasted an expanded URL
  const res = await fetch(CORS_PROXY + encodeURIComponent(url));
  if (!res.ok) {
    throw new Error(
      `Could not expand the link (proxy HTTP ${res.status}). ` +
        "Open the link once and paste the resulting URL instead."
    );
  }
  return await res.text();
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

  $("summary-text").textContent =
    `${miles.toFixed(1)} mi · ~${hours.toFixed(1)} hr · ${points.length} points · ${stops.length} stops`;

  const ol = $("stops");
  ol.innerHTML = "";
  stops.forEach((s, i) => {
    const li = document.createElement("li");
    const endpoint = i === 0 || i === stops.length - 1;
    const label = i === 0 ? "start" : i === stops.length - 1 ? "end" : `stop ${i}`;
    li.textContent = `${label}: ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`;
    if (endpoint) li.className = "endpoint";
    ol.appendChild(li);
  });

  resultEl.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("url").value;
  const name = $("name").value || "Google Maps Route";
  const straight = !$("uturns").checked;

  $("go").disabled = true;
  resultEl.hidden = true;
  setStatus("Expanding link, decoding stops, and routing…", "working");

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
