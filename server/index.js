import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geocodePincode, solveRoute, UpstreamError } from './arcgis.js';
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
    const { token, expiresAt } = await getAppToken();
    res.json({ token, expiresAt, source: 'oauth-app' });
  } catch (err) {
    next(err);
  }
});

// GET /api/places?pincode=110001
app.get('/api/places', async (req, res, next) => {
  try {
    const pincode = String(req.query.pincode ?? '').trim();
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ error: 'Pincode must be 6 digits.' });
    }
    const places = await geocodePincode(pincode);
    res.json({ pincode, places });
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
