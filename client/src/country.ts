// Which country does this user most likely mean?
//
// The same postal code exists in several countries (506001 is in Colombia and
// India). The geocoder returns them in no useful order, so we rank matches by
// signals from the browser. Nothing here is sent to the server.
//
// Order of trust:
//   1. A country the user explicitly picked before (saved in localStorage).
//   2. Countries of areas already on the map in this session.
//   3. The device time zone.
//   4. The browser's languages (weakest: en-US is common everywhere).
import type { Area } from './types';

const STORAGE_KEY = 'postal-explorer:country';

// Time zone -> ISO 3166-1 alpha-3. Common zones only; unknown zones are skipped.
const TIMEZONE_COUNTRY: Record<string, string> = {
  'Asia/Kolkata': 'IND', 'Asia/Calcutta': 'IND',
  'America/New_York': 'USA', 'America/Chicago': 'USA', 'America/Denver': 'USA',
  'America/Los_Angeles': 'USA', 'America/Phoenix': 'USA', 'America/Anchorage': 'USA',
  'Pacific/Honolulu': 'USA', 'America/Detroit': 'USA',
  'America/Toronto': 'CAN', 'America/Vancouver': 'CAN',
  'America/Mexico_City': 'MEX', 'America/Bogota': 'COL', 'America/Sao_Paulo': 'BRA',
  'Europe/London': 'GBR', 'Europe/Dublin': 'IRL', 'Europe/Paris': 'FRA',
  'Europe/Berlin': 'DEU', 'Europe/Madrid': 'ESP', 'Europe/Rome': 'ITA',
  'Europe/Amsterdam': 'NLD', 'Europe/Vilnius': 'LTU',
  'Asia/Dubai': 'ARE', 'Asia/Singapore': 'SGP', 'Asia/Tokyo': 'JPN',
  'Asia/Shanghai': 'CHN', 'Asia/Colombo': 'LKA', 'Asia/Jerusalem': 'ISR',
  'Australia/Sydney': 'AUS', 'Australia/Melbourne': 'AUS', 'Pacific/Auckland': 'NZL',
  'Africa/Casablanca': 'MAR', 'Africa/Johannesburg': 'ZAF'
};

// Language region (alpha-2) -> alpha-3, for the same set of countries.
const REGION_COUNTRY: Record<string, string> = {
  IN: 'IND', US: 'USA', CA: 'CAN', MX: 'MEX', CO: 'COL', BR: 'BRA', GB: 'GBR',
  IE: 'IRL', FR: 'FRA', DE: 'DEU', ES: 'ESP', IT: 'ITA', NL: 'NLD', LT: 'LTU',
  AE: 'ARE', SG: 'SGP', JP: 'JPN', CN: 'CHN', LK: 'LKA', IL: 'ISR', AU: 'AUS',
  NZ: 'NZL', MA: 'MAR', ZA: 'ZAF'
};

function savedCountry(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode etc.)
  }
}

/** Remember a country the user chose by hand. */
export function rememberCountry(countryCode: string): void {
  if (!countryCode) return;
  try {
    localStorage.setItem(STORAGE_KEY, countryCode);
  } catch {
    /* preference is optional */
  }
}

function preferredCountries(sessionAreas: Area[]): string[] {
  const list: string[] = [];
  const saved = savedCountry();
  if (saved) list.push(saved);

  // Most recent session area first.
  for (let i = sessionAreas.length - 1; i >= 0; i--) list.push(sessionAreas[i].countryCode);

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONE_COUNTRY[zone]) list.push(TIMEZONE_COUNTRY[zone]);
  } catch {
    /* ignore */
  }

  for (const lang of navigator.languages ?? []) {
    try {
      const region = new Intl.Locale(lang).maximize().region;
      if (region && REGION_COUNTRY[region]) list.push(REGION_COUNTRY[region]);
    } catch {
      /* ignore malformed language tags */
    }
  }
  return list.filter(Boolean);
}

/**
 * Put the most likely country first. Keeps the geocoder's order otherwise.
 * `confident` is false when no signal matched any candidate, so the caller
 * can make the other choices more visible.
 */
export function rankByLikelyCountry(found: Area[], sessionAreas: Area[]): { ranked: Area[]; confident: boolean } {
  const prefs = preferredCountries(sessionAreas);
  const score = (a: Area) => {
    const i = prefs.indexOf(a.countryCode);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const ranked = found
    .map((area, order) => ({ area, order, s: score(area) }))
    .sort((x, y) => x.s - y.s || x.order - y.order)
    .map((x) => x.area);
  const confident = found.length < 2 || score(ranked[0]) !== Number.POSITIVE_INFINITY;
  return { ranked, confident };
}
