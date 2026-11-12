/** A postal-code area in any country. */
export interface Area {
  name: string;
  postal: string;
  country: string;
  lat: number;
  lon: number;
  /** Size of the area; also the radius of the nearby search. */
  radiusKm: number;
}

/** A place of interest near an area. */
export interface NearbyPlace {
  name: string;
  type: string;
  address: string;
  phone: string;
  lat: number;
  lon: number;
  distanceKm: number;
}

/** Keys the server accepts for /api/nearby. Labels live in main.ts. */
export type CategoryKey =
  | 'all'
  | 'restaurants'
  | 'hotels'
  | 'grocery'
  | 'pharmacies'
  | 'atms'
  | 'fuel'
  | 'hospitals'
  | 'things';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteResult {
  paths: number[][][];
  kilometers: number | null;
  minutes: number | null;
}
