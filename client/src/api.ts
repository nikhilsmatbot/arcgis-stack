// Thin wrapper over the Express API. All ArcGIS calls go through the server.
import type { Place, RouteResult } from './types';

export interface Config {
  basemapApiKey: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (HTTP ${res.status}).`);
  }
  return body as T;
}

export function getConfig(): Promise<Config> {
  return request<Config>('/api/config');
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
