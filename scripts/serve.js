// Minimal static file server for local web-app development.
//   npm run serve   ->   http://localhost:8080
// (Browsers need ES modules served over http, not file://.)

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = process.env.PORT || 8080;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".gpx": "application/gpx+xml",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path === "/") path = "/index.html";
      const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  })
  .listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
