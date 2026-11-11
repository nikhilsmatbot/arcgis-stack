// Thin wrapper over the Express API. All ArcGIS calls go through the server.
import type { Place, RouteResult } from './types';

export interface MapToken {
  token: string;
  /** Epoch ms when the token expires (server clock, informational). */
  expiresAt: number;
  /** Ask for a new token after this many ms. Relative, so clock skew is irrelevant. */
  refreshInMs: number;
  source: 'oauth-app';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (HTTP ${res.status}).`);
  }
  return body as T;
}

export function getMapToken(): Promise<MapToken> {
  return request<MapToken>('/api/token', { cache: 'no-store' });
}

export async function searchPincode(pincode: string): Promise<Place[]> {
  const data = await request<{ places: Place[] }>(
    `/api/places?pincode=${encodeURIComponent(pincode)}`
  );
  return data.places;
}

export function getRoute(from: Pick<Place, 'lat' | 'lon'>, to: Pick<Place, 'lat' | 'lon'>): Promise<RouteResult> {
  return request<RouteResult>('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon }
    })
  });
}
