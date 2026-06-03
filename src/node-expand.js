// Node-specific link expansion: follow the share link's redirects (no proxy
// needed) until we reach the URL that carries `geocode=`.

import https from "node:https";
import http from "node:http";

import { resolveGeocodeUrl } from "./core.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function fetchLocation(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.request(url, { method: "GET", headers: { "User-Agent": UA } }, (res) => {
      res.resume(); // drain the body; we only want the headers
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        resolve(new URL(loc, url).toString());
      } else {
        resolve(null);
      }
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => req.destroy(new Error("request timed out")));
    req.end();
  });
}

/** Resolve a Google Maps share link to its expanded URL (contains geocode=). */
export function expandToText(url) {
  return resolveGeocodeUrl(url, fetchLocation);
}
