export interface Place {
  name: string;
  pincode: string;
  address: string;
  lat: number;
  lon: number;
  score?: number;
}

export interface RouteResult {
  paths: number[][][];
  kilometers: number | null;
  minutes: number | null;
}
