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
const TOKEN_MINUTES = 120;
// Refresh this long before expiry so a client never receives an almost-dead token.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

let cached = null; // { token, expiresAt }
let inflight = null;

export function hasAppCredentials() {
  return Boolean(process.env.ARCGIS_CLIENT_ID && process.env.ARCGIS_CLIENT_SECRET);
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

  const expiresInMs = (Number(data.expires_in) || TOKEN_MINUTES * 60) * 1000;
  return { token: data.access_token, expiresAt: Date.now() + expiresInMs };
}

/** Return a cached token, fetching a new one when close to expiry. */
export async function getAppToken() {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached;
  }
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
  return inflight;
}
