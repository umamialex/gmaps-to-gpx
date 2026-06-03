# Link-expander Worker

A tiny Cloudflare Worker that resolves a Google Maps short link to its expanded
URL (the one containing `geocode=`) and returns it with CORS headers, so the web
app can read it directly — no flaky public proxy, no manual paste.

## Deploy (one time)

From this `worker/` directory:

```bash
npx wrangler login      # opens a browser to authorize your Cloudflare account
npx wrangler deploy     # deploys expand.js
```

Wrangler prints the deployed URL, e.g.:

```
https://gmaps-expand.<your-subdomain>.workers.dev
```

## Wire up the site

Put that URL in `app.js`:

```js
const EXPAND_WORKER = "https://gmaps-expand.<your-subdomain>.workers.dev";
```

Commit and push — the site will use the Worker first and fall back to the public
proxies only if it's ever unavailable.

## Test it

```bash
curl "https://gmaps-expand.<your-subdomain>.workers.dev/?url=https://maps.app.goo.gl/5bUHyyQonJLkeHEn7"
# -> https://maps.google.com/?geocode=...   (a URL containing geocode=)
```

Free plan limits (100k requests/day) are far more than enough.
