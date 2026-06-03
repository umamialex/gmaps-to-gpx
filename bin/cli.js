#!/usr/bin/env node
// CLI entry point. Thin wrapper around the shared core in src/core.js.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { linkToGpx, extractStops, OSRM_DEFAULT } from "../src/core.js";
import { expandToText } from "../src/node-expand.js";

const HELP = `Convert a Google Maps directions link into a Sideways-compatible GPX.

Usage:
  gmaps-to-gpx <link> [options]

Options:
  -o, --output <file>   Output GPX path (default: route.gpx)
      --name <name>     Track name (default: "Google Maps Route")
      --osrm <url>      OSRM server (default: ${OSRM_DEFAULT})
      --allow-uturns    Don't send continue_straight (lets stops double back)
      --print-stops     Decode and print the stops, then exit
  -h, --help            Show this help

Example:
  gmaps-to-gpx "https://maps.app.goo.gl/XXXX" -o drive.gpx --name "My Drive"
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o", default: "route.gpx" },
      name: { type: "string", default: "Google Maps Route" },
      osrm: { type: "string", default: OSRM_DEFAULT },
      "allow-uturns": { type: "boolean", default: false },
      "print-stops": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stderr.write(HELP);
    return values.help ? 0 : 1;
  }

  const url = positionals[0];
  const straight = !values["allow-uturns"];

  if (values["print-stops"]) {
    const stops = extractStops(await expandToText(url));
    printStops(stops);
    return 0;
  }

  const result = await linkToGpx({
    url,
    expandToText,
    name: values.name,
    straight,
    osrmServer: values.osrm,
  });

  printStops(result.stops);
  writeFileSync(values.output, result.gpx);
  process.stderr.write(
    `Wrote ${values.output}: ${result.points.length} points, ` +
      `${result.miles.toFixed(1)} mi, ~${result.hours.toFixed(2)} hr\n`
  );
  return 0;
}

function printStops(stops) {
  process.stderr.write(`Decoded ${stops.length} stops:\n`);
  stops.forEach((s, i) => {
    const label = i === 0 ? "origin" : i === stops.length - 1 ? "dest" : `stop ${i}`;
    process.stderr.write(
      `  ${String(i).padStart(2)} [${label.padEnd(6)}] ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}\n`
    );
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
