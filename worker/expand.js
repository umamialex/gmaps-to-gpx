// Cloudflare Worker: resolve a Google Maps short link to its expanded URL.
//
// The browser can't follow Google's redirect itself (CORS), and public proxies
// are flaky (they often get a Google consent/shell page with no route data).
// This Worker follows the redirect chain server-side and returns the first URL
// that carries `geocode=` — which is set by the goo.gl/Firebase redirect before
// any consent page, so it's reliable. Response is plain text, CORS-enabled.
//
// Deploy: see worker/README.md  ->  npx wrangler deploy

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const target = new URL(request.url).searchParams.get("url");
    if (!target) {
      return new Response("missing ?url parameter", { status: 400, headers: CORS });
    }

    let url = target;
    try {
      for (let hop = 0; hop < 10; hop++) {
        if (url.includes("geocode=")) break;
        const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA } });
        const loc = res.headers.get("location");
        if (loc) {
          url = new URL(loc, url).toString();
          continue;
        }
        // Not a redirect — last resort: scan the body for a geocode URL.
        const m = (await res.text()).match(/geocode=[^&"'\s]+/);
        if (m) url = "https://maps.google.com/?" + m[0];
        break;
      }
    } catch (err) {
      return new Response(`upstream error: ${err.message}`, { status: 502, headers: CORS });
    }

    if (!url.includes("geocode=")) {
      return new Response("could not resolve route from link", { status: 502, headers: CORS });
    }
    return new Response(url, { headers: { ...CORS, "content-type": "text/plain" } });
  },
};
