import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  geocodePostal,
  nearbyPlaces,
  solveRoute,
  NEARBY_CATEGORIES,
  UpstreamError
} from './arcgis.js';
import { getAppToken, hasAppCredentials } from './token.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json({ limit: '10kb' }));

// Map token for the browser: a short-lived OAuth app token only. The server
// never sends a raw env value to the client, so a misplaced secret cannot leak.
app.get('/api/token', async (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!hasAppCredentials()) {
      return res
        .status(503)
        .json({ error: 'Map credentials not configured (ARCGIS_CLIENT_ID / ARCGIS_CLIENT_SECRET).' });
    }
    const { token, expiresAt, refreshInMs } = await getAppToken();
    res.json({ token, expiresAt, refreshInMs, source: 'oauth-app' });
  } catch (err) {
    next(err);
  }
});

// Postal codes from any country: 3-12 letters/digits, spaces or hyphens inside
// (110001, 20170, SW1A 1AA, K1A 0B1, 1010-001).
const POSTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/;

// GET /api/areas?code=20170  -> postal areas matching the code, any country
app.get('/api/areas', async (req, res, next) => {
  try {
    const code = String(req.query.code ?? '').trim();
    if (!POSTAL_PATTERN.test(code)) {
      return res.status(400).json({ error: 'Enter a postal code (3-12 letters or digits).' });
    }
    const areas = await geocodePostal(code);
    res.json({ code, areas });
  } catch (err) {
    next(err);
  }
});

// GET /api/nearby?lat=..&lon=..&radiusKm=..&category=restaurants
app.get('/api/nearby', async (req, res, next) => {
  try {
    const point = { lat: Number(req.query.lat), lon: Number(req.query.lon) };
    const radiusKm = Number(req.query.radiusKm) || 2;
    const category = String(req.query.category ?? 'all');
    if (!isPoint(point)) {
      return res.status(400).json({ error: 'lat and lon must be numbers.' });
    }
    if (!Object.hasOwn(NEARBY_CATEGORIES, category)) {
      return res.status(400).json({ error: 'Unknown category.' });
    }
    const places = await nearbyPlaces({ ...point, radiusKm, category });
    res.json({ category, places });
  } catch (err) {
    next(err);
  }
});

// POST /api/route  { from: {lat, lon}, to: {lat, lon} }
app.post('/api/route', async (req, res, next) => {
  try {
    const { from, to } = req.body ?? {};
    if (!isPoint(from) || !isPoint(to)) {
      return res.status(400).json({ error: 'from and to need numeric lat and lon.' });
    }
    const route = await solveRoute(from, to);
    res.json(route);
  } catch (err) {
    next(err);
  }
});

function isPoint(p) {
  return (
    p &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180
  );
}

// Serve the built client (production). In dev, Vite serves it instead.
app.use(express.static(distDir));

// JSON error handler. Never leaks stack traces to the browser.
app.use((err, _req, res, _next) => {
  if (err instanceof UpstreamError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => {
  console.log(`arcgis-stack server on http://localhost:${PORT}`);
});
