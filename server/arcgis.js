// Server-side calls to ArcGIS Location Platform REST services.
// The API key never reaches the browser. Keys come from env vars.

const GEOCODE_URL =
  'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
const ROUTE_URL =
  'https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve';

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

/**
 * Geocode an Indian pincode. Returns candidates whose Postal attribute
 * matches the pincode, shaped as { name, pincode, address, lat, lon }.
 * Note: the geocoder returns address matches, not every POI in the pincode.
 */
export async function geocodePincode(pincode) {
  const params = new URLSearchParams({
    SingleLine: `${pincode}, India`,
    countryCode: 'IND',
    maxLocations: '25',
    outFields: 'Postal,PlaceName,City,Region',
    f: 'json',
    token: serviceKey()
  });

  const data = await readJson(await fetch(`${GEOCODE_URL}?${params}`));

  return (data.candidates ?? [])
    .filter((c) => c.attributes?.Postal === pincode)
    .map((c) => ({
      name: c.attributes.PlaceName || c.address,
      pincode,
      address: c.address,
      lat: c.location.y,
      lon: c.location.x,
      score: c.score
    }));
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
