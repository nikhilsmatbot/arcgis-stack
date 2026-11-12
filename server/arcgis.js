// Server-side calls to ArcGIS Location Platform REST services.
// The API key never reaches the browser. Keys come from env vars.

const GEOCODE_URL =
  'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
const ROUTE_URL =
  'https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve';

// Nearby-place filters offered to the client, mapped to ArcGIS geocoder POI
// categories. The client sends only the key, never a raw category string.
export const NEARBY_CATEGORIES = {
  all: 'Food,Hotel,Grocery,Pharmacy,ATM,Gas Station',
  restaurants: 'Food',
  hotels: 'Hotel',
  grocery: 'Grocery',
  pharmacies: 'Pharmacy',
  atms: 'ATM',
  fuel: 'Gas Station',
  hospitals: 'Hospital',
  things: 'Arts and Entertainment'
};

const MAX_RADIUS_KM = 10;

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function serviceKey() {
  const key = process.env.ARCGIS_API_KEY;
  if (!key) {
    throw new UpstreamError('ARCGIS_API_KEY is not set on the server.', 500);
  }
  return key;
}

async function readJson(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    throw new UpstreamError(`ArcGIS returned non-JSON (HTTP ${res.status}).`);
  }
  // ArcGIS REST reports errors in the body, often with HTTP 200.
  if (data.error) {
    throw new UpstreamError(`ArcGIS error: ${data.error.message}`, 502);
  }
  if (!res.ok) {
    throw new UpstreamError(`ArcGIS HTTP ${res.status}.`);
  }
  return data;
}

const normalizePostal = (s) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Look up a postal code in any country. The same code can exist in several
 * countries (20170 is in the USA, France, Spain, ...), so this returns every
 * match and the user picks one.
 *
 * Each area: { name, postal, country, lat, lon, radiusKm }.
 * radiusKm comes from the area's extent and sizes the nearby search.
 */
export async function geocodePostal(code) {
  const params = new URLSearchParams({
    SingleLine: code,
    category: 'Postal',
    maxLocations: '8',
    outFields: 'Postal,CntryName,City,Region',
    f: 'json',
    token: serviceKey()
  });

  const data = await readJson(await fetch(`${GEOCODE_URL}?${params}`));
  const wanted = normalizePostal(code);
  const candidates = data.candidates ?? [];

  // Prefer exact postal matches; fall back to whatever the geocoder found.
  const exact = candidates.filter((c) => normalizePostal(c.attributes?.Postal) === wanted);
  const chosen = exact.length ? exact : candidates;

  return chosen.map((c) => {
    const lat = c.location.y;
    const lon = c.location.x;
    let radiusKm = 2;
    if (c.extent) {
      // Half the extent's diagonal, kept within sane bounds.
      const half = haversineKm(c.extent.ymin, c.extent.xmin, c.extent.ymax, c.extent.xmax) / 2;
      radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, half));
    }
    return {
      name: c.address,
      postal: c.attributes?.Postal || code,
      country: c.attributes?.CntryName || '',
      lat,
      lon,
      radiusKm: Math.round(radiusKm * 10) / 10
    };
  });
}

/**
 * Places of interest around a point, nearest first.
 * Each place: { name, type, address, phone, lat, lon, distanceKm }.
 */
export async function nearbyPlaces({ lat, lon, radiusKm, category }) {
  const poiCategory = NEARBY_CATEGORIES[category];
  if (!poiCategory) {
    throw new UpstreamError('Unknown category.', 400);
  }
  const r = Math.min(MAX_RADIUS_KM, Math.max(0.5, radiusKm));

  // Bounding box of the search circle, in degrees.
  const dLat = r / 111.32;
  const dLon = r / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

  const params = new URLSearchParams({
    category: poiCategory,
    location: `${lon},${lat}`,
    searchExtent: `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`,
    maxLocations: '50',
    outFields: 'PlaceName,Place_addr,Type,Phone',
    f: 'json',
    token: serviceKey()
  });

  const data = await readJson(await fetch(`${GEOCODE_URL}?${params}`));

  return (data.candidates ?? [])
    .map((c) => ({
      name: c.attributes?.PlaceName || c.address,
      type: c.attributes?.Type || '',
      address: c.attributes?.Place_addr || c.address,
      phone: c.attributes?.Phone || '',
      lat: c.location.y,
      lon: c.location.x,
      distanceKm: Math.round(haversineKm(lat, lon, c.location.y, c.location.x) * 100) / 100
    }))
    .filter((p) => p.distanceKm <= r)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Solve a driving route between two points.
 * Returns polyline paths in WGS84 plus distance and time.
 */
export async function solveRoute(from, to) {
  const body = new URLSearchParams({
    stops: `${from.lon},${from.lat};${to.lon},${to.lat}`,
    returnRoutes: 'true',
    returnDirections: 'false',
    outputLines: 'esriNAOutputLineTrueShape',
    f: 'json',
    token: serviceKey()
  });

  const data = await readJson(
    await fetch(ROUTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
  );

  const route = data.routes?.features?.[0];
  if (!route) {
    throw new UpstreamError('No route found between these points.', 404);
  }

  return {
    paths: route.geometry.paths,
    kilometers: route.attributes.Total_Kilometers ?? null,
    minutes: route.attributes.Total_TravelTime ?? null
  };
}
