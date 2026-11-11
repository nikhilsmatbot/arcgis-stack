// Short-lived ArcGIS access token for the browser (app authentication).
//
// The server holds ARCGIS_CLIENT_ID and ARCGIS_CLIENT_SECRET (OAuth 2.0
// credentials for app authentication). It exchanges them for an access token
// with the client_credentials grant and hands only that token to the browser.
// The token expires, so nothing long-lived ever reaches the client.
//
// Give the OAuth credentials the Basemaps privilege only. Geocoding and routing
// keep using the server-only ARCGIS_API_KEY in arcgis.js.

import { UpstreamError } from './arcgis.js';

const DEFAULT_PORTAL = 'https://www.arcgis.com/sharing/rest';

// Token lifetime in minutes. Short = a copied token is useless sooner.
// Override with ARCGIS_TOKEN_MINUTES (1-120). Default 5.
const TOKEN_MINUTES = Math.min(120, Math.max(1, Number(process.env.ARCGIS_TOKEN_MINUTES) || 5));

let cached = null; // { token, expiresAt, lifetimeMs }
let inflight = null;

export function hasAppCredentials() {
  return Boolean(process.env.ARCGIS_CLIENT_ID && process.env.ARCGIS_CLIENT_SECRET);
}

/**
 * How long before expiry a token counts as stale: 20% of its lifetime,
 * at least 30 s. A 5-minute token is replaced when 1 minute is left, so the
 * browser always switches while the old one still works.
 */
function staleMarginMs(lifetimeMs) {
  return Math.max(30_000, lifetimeMs * 0.2);
}

async function requestToken() {
  const portal = (process.env.ARCGIS_PORTAL_URL || DEFAULT_PORTAL).replace(/\/$/, '');
  const body = new URLSearchParams({
    client_id: process.env.ARCGIS_CLIENT_ID,
    client_secret: process.env.ARCGIS_CLIENT_SECRET,
    grant_type: 'client_credentials',
    expiration: String(TOKEN_MINUTES),
    f: 'json'
  });

  const res = await fetch(`${portal}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new UpstreamError(`ArcGIS token endpoint returned non-JSON (HTTP ${res.status}).`);
  }
  if (data.error || !data.access_token) {
    const msg = data.error?.message || data.error_description || 'no access_token in response';
    throw new UpstreamError(`ArcGIS token error: ${msg}`, 502);
  }

  // Trust what ArcGIS actually granted, not what we asked for.
  const lifetimeMs = (Number(data.expires_in) || TOKEN_MINUTES * 60) * 1000;
  return { token: data.access_token, expiresAt: Date.now() + lifetimeMs, lifetimeMs };
}

/**
 * Return { token, expiresAt, refreshInMs }. Reuses the cached token until it
 * is stale. refreshInMs tells the client when to ask again; it is relative,
 * so client/server clock differences do not matter.
 */
export async function getAppToken() {
  if (!cached || cached.expiresAt - Date.now() <= staleMarginMs(cached.lifetimeMs)) {
    if (!inflight) {
      inflight = requestToken()
        .then((t) => {
          cached = t;
          return t;
        })
        .finally(() => {
          inflight = null;
        });
    }
    await inflight;
  }
  const { token, expiresAt, lifetimeMs } = cached;
  const refreshInMs = Math.max(0, expiresAt - staleMarginMs(lifetimeMs) - Date.now());
  return { token, expiresAt, refreshInMs };
}
