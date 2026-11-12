// Thin wrapper over the Express API. All ArcGIS service calls go through the server.
import type { Area, CategoryKey, LatLon, NearbyPlace, RouteResult } from './types';

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

/** Postal areas matching a code. One code can match several countries. */
export async function searchPostal(code: string): Promise<Area[]> {
  const data = await request<{ areas: Area[] }>(`/api/areas?code=${encodeURIComponent(code)}`);
  return data.areas;
}

/** Places of interest inside an area's radius, nearest first. */
export async function getNearby(area: Area, category: CategoryKey): Promise<NearbyPlace[]> {
  const query = new URLSearchParams({
    lat: String(area.lat),
    lon: String(area.lon),
    radiusKm: String(area.radiusKm),
    category
  });
  const data = await request<{ places: NearbyPlace[] }>(`/api/nearby?${query}`);
  return data.places;
}

export function getRoute(from: LatLon, to: LatLon): Promise<RouteResult> {
  return request<RouteResult>('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon }
    })
  });
}
