# ArcGIS Pincode & Route Demo

Small full-stack demo of ArcGIS services:

- **Map:** ArcGIS Maps SDK for JavaScript 4.29, `streets-navigation-vector` basemap.
- **Geocoding:** Esri World Geocoder, looks up places by Indian pincode.
- **Routing:** ArcGIS Route service (`Route_World`), draws a driving route between two results.

> ArcGIS is a prototype choice. The production map will move to MapLibre GL.

## Stack

| Layer    | Tech                                              |
|----------|---------------------------------------------------|
| Client   | Vite, TypeScript, ArcGIS Maps SDK 4.29 (`@arcgis/core`) |
| Server   | Node.js 20+, Express 5                            |
| Data     | ArcGIS Location Platform REST APIs (geocode, route) |
| Hosting  | One Node service: Express serves the built client |

```
browser ──► Vite (dev) / Express (prod)
             ├─ /api/token   ─► short-lived map token (OAuth app auth, ~2 h)
             ├─ /api/places  ─► ArcGIS World Geocoder  (server key)
             └─ /api/route   ─► ArcGIS Route_World     (server key)
```

### Credential model

No long-lived credential reaches the browser.

- **Geocoding and routing:** `ARCGIS_API_KEY` is only used inside Express. The browser calls `/api/places` and `/api/route`; it never sees the key.
- **Basemap:** the map SDK must send a credential with each tile request, so the browser needs *something*. The server holds `ARCGIS_CLIENT_ID` and `ARCGIS_CLIENT_SECRET`, exchanges them for an access token (`grant_type=client_credentials`, 2-hour expiry), caches it, and gives the browser only that token via `/api/token`. The client refreshes it before it expires. A leaked token stops working within 2 hours; the client secret never leaves the server.
- **Scope:** give the OAuth credentials the Basemaps privilege only, so the browser token cannot geocode or route.

This is Esri's recommended pattern for public apps without user sign-in ("app authentication").

## Project layout

```
server/index.js     Express app, routes, error handling
server/arcgis.js    ArcGIS REST calls (geocode, route)
server/token.js     OAuth app token: fetch, cache, refresh
client/index.html   Page shell
client/src/main.ts  UI wiring: search, results, route form
client/src/map.ts   ArcGIS map layer code (prototype, swap to MapLibre later)
client/src/api.ts   Fetch wrapper for /api
client/src/types.ts Shared types
client/src/styles.css
vite.config.ts      Client root, build output, dev proxy
```

## 1. Get ArcGIS keys (free developer plan)

1. Sign up at https://developers.arcgis.com (free developer account).
2. Create two developer credentials (Content → New item → Developer credentials):
   - **API key credentials** → `ARCGIS_API_KEY`. Privileges: Geocoding, Routing. No referrer restriction (server calls send no referrer). Keep secret.
   - **OAuth 2.0 credentials → For app authentication** → `ARCGIS_CLIENT_ID` and `ARCGIS_CLIENT_SECRET`. Privilege: Basemaps only. Keep the secret secret.
3. Check current free credit limits on the pricing page before the showcase.

> Referrer gotcha: if you use a referrer-restricted API key, ArcGIS reports a referrer mismatch as `498 Token Invalid`, not as a referrer error. The OAuth app flow avoids this.

## 2. Run locally

Requires Node.js 20 or newer.

```bash
cd arcgis-stack
cp .env.example .env     # then fill in both keys
npm install
```

Development (two terminals):

```bash
npm run dev:server       # API on http://localhost:3001
npm run dev:client       # UI on http://localhost:5173 (proxies /api to 3001)
```

Production-style (one process):

```bash
npm run build
npm start                # http://localhost:3001 serves UI and API
```

## 3. Try it

1. Enter a 6-digit pincode, for example `110001`, and press Enter.
2. Click a result to center the map and open its popup.
3. Choose **From** and **To** (needs at least two results) and click **Get route**.

Validation: non-6-digit input shows a message and never calls the API. The server re-checks the pincode.

## 4. Deploy (free tier)

GitHub Pages cannot run the Express server, so deploy the whole app as one Node web service. Render's free tier works:

1. Push this folder to a GitHub repository.
2. In Render, **New → Web Service**, connect the repo.
3. Settings:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
4. Add environment variables `ARCGIS_API_KEY`, `ARCGIS_CLIENT_ID`, `ARCGIS_CLIENT_SECRET`. Render sets `PORT` automatically.
5. Delete `ARCGIS_BASEMAP_API_KEY` if it is still set. The app no longer reads it.

Free instances sleep after inactivity, so the first request can be slow.

## Notes and limits

- **Pincode results:** the geocoder returns address matches that carry the pincode. It does not list every point of interest in a pincode. A full list needs a places service or your own dataset.
- **Credits:** geocoding and routing consume credits. Each search and route is a billable call.
- **Keys:** never commit `.env`. Rotate a key if it leaks.
- **Coverage:** Indian pincode matching depends on the geocoder's data. Test a few known pincodes before you present.
