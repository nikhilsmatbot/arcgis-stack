# ArcGIS Postal Code Explorer

Small full-stack demo of ArcGIS services:

- **Map:** ArcGIS Maps SDK for JavaScript 4.29, `streets-navigation-vector` basemap.
- **Postal search:** Esri World Geocoder, looks up a postal code in any country (`20170`, `110001`, `SW1A 1AA`).
- **Nearby places:** the same geocoder's POI categories list restaurants, hotels, grocery, pharmacies, ATMs, fuel, hospitals and things to do around the area.
- **Routing:** ArcGIS Route service (`Route_World`), draws a driving route from the area to a place, or between any two points.

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
             ├─ /api/token   ─► short-lived map token (OAuth app auth, 5 min)
             ├─ /api/areas   ─► ArcGIS World Geocoder, postal lookup  (server key)
             ├─ /api/nearby  ─► ArcGIS World Geocoder, POI categories (server key)
             └─ /api/route   ─► ArcGIS Route_World     (server key)
```

### Credential model

No long-lived credential reaches the browser.

- **Geocoding and routing:** `ARCGIS_API_KEY` is only used inside Express. The browser calls `/api/places` and `/api/route`; it never sees the key.
- **Basemap:** the map SDK must send a credential with each tile request, so the browser needs *something*. The server holds `ARCGIS_CLIENT_ID` and `ARCGIS_CLIENT_SECRET`, exchanges them for an access token (`grant_type=client_credentials`, 5-minute expiry, set with `ARCGIS_TOKEN_MINUTES`), caches it, and gives the browser only that token via `/api/token`. The server rotates the token when 20% of its life is left and tells the client when to ask again (`refreshInMs`), so the map switches while the old token still works. A copied token stops working within 5 minutes; the client secret never leaves the server.
- **Limits:** anyone can call `/api/token` from a browser on the site, so a short lifetime does not stop someone determined; it only makes a copied token useless quickly. The real protection is the referrer lock (token only works from this site's origin) and the narrow privileges.
- **Scope:** give the OAuth credentials the Basemaps privilege only, so the browser token cannot geocode or route.

This is Esri's recommended pattern for public apps without user sign-in ("app authentication").

## Project layout

```
server/index.js     Express app, routes, error handling
server/arcgis.js    ArcGIS REST calls (postal lookup, nearby places, route)
server/token.js     OAuth app token: fetch, cache, refresh
client/index.html   Page shell
client/src/main.ts  UI wiring: search, areas, category chips, nearby list, route
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

1. Enter a postal code from any country, for example `20170`, `110001` or `SW1A 1AA`, and press Enter.
2. The map shows the area (red pin, dashed circle) and the nearest places (blue pins). If the same code exists in other countries, open **Not the right code?** under the area and pick another.
3. Use the chips (Restaurants, Hotels, Grocery, ...) to filter nearby places. Click a place to open it on the map.
4. Click **Route** on a place for a driving route from the area center, or use the **From / To** form for any two points. Search a second postal code to route between areas.

Validation: input must be 3 to 12 letters or digits (spaces and hyphens allowed inside). Anything else shows a message and never calls the API. The server re-checks the code and only accepts known category keys.

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

- **Nearby results:** the geocoder returns at most 50 places per request, nearest to the area center first, inside a circle sized from the postal area (1 to 10 km). In a dense area that can be the closest few hundred metres only. It is not an official postal boundary. ArcGIS Places service gives richer data (ratings, hours) if needed later.
- **Credits:** each postal search, each category filter and each route is one billable call. The client caches nearby results per area and category.
- **Keys:** never commit `.env`. Rotate a key if it leaks.
- **Coverage:** postal and POI data quality varies by country. Test the codes you plan to show before you present.
