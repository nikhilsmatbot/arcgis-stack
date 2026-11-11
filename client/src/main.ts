import Graphic from '@arcgis/core/Graphic';
import { getMapToken, getRoute, searchPincode } from './api';
import type { MapToken } from './api';
import { createMap } from './map';
import type { Place } from './types';
import './styles.css';

const PINCODE_PATTERN = /^\d{6}$/;

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#pincode')!;
const message = document.querySelector<HTMLParagraphElement>('#search-message')!;
const resultsList = document.querySelector<HTMLUListElement>('#results')!;
const resultsCount = document.querySelector<HTMLSpanElement>('#results-count')!;
const clearBtn = document.querySelector<HTMLButtonElement>('#clear-btn')!;
const fromSelect = document.querySelector<HTMLSelectElement>('#from-select')!;
const toSelect = document.querySelector<HTMLSelectElement>('#to-select')!;
const routeBtn = document.querySelector<HTMLButtonElement>('#route-btn')!;
const routeInfo = document.querySelector<HTMLParagraphElement>('#route-info')!;

// All places collected across searches. Routing picks From/To from this list.
let places: Place[] = [];
let graphics: Graphic[] = [];

function setMessage(text: string, isError: boolean): void {
  message.textContent = text;
  message.classList.toggle('info', !isError);
}

function setRouteInfo(text: string): void {
  routeInfo.textContent = text;
}

/** Add places not already in the list. Returns how many were new. */
function addPlaces(incoming: Place[]): number {
  let added = 0;
  for (const place of incoming) {
    const exists = places.some(
      (p) => p.pincode === place.pincode && p.lat === place.lat && p.lon === place.lon
    );
    if (!exists) {
      places.push(place);
      added++;
    }
  }
  return added;
}

// Refresh this long before the token expires.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function start(): Promise<void> {
  let mapToken: MapToken | null = null;
  try {
    mapToken = await getMapToken();
  } catch (err) {
    setMessage(err instanceof Error ? `Map token: ${err.message}` : 'Could not get map token.', true);
  }

  const map = createMap('map', mapToken?.token ?? '');

  // Short-lived tokens: fetch a new one before the current one expires.
  function scheduleRefresh(expiresAt: number | null): void {
    if (expiresAt === null) return; // long-lived fallback key, nothing to refresh
    const delay = Math.max(60_000, expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS);
    window.setTimeout(async () => {
      try {
        const next = await getMapToken();
        map.setToken(next.token);
        scheduleRefresh(next.expiresAt);
      } catch {
        // Retry in a minute if the server is waking up or briefly unreachable.
        scheduleRefresh(Date.now() + TOKEN_REFRESH_MARGIN_MS + 60_000);
      }
    }, delay);
  }
  if (mapToken) scheduleRefresh(mapToken.expiresAt);

  /** Redraw pins and list from the current places array. */
  function refresh(): void {
    graphics = places.length ? map.showPlaces(places) : [];
    if (!places.length) map.clear();
    map.clearRoute();
    renderResults();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    input.removeAttribute('aria-invalid');

    if (!PINCODE_PATTERN.test(query)) {
      input.setAttribute('aria-invalid', 'true');
      setMessage('Enter a 6-digit pincode using numbers only, e.g. 110001.', true);
      return;
    }

    setMessage('Searching…', false);
    let found: Place[];
    try {
      found = await searchPincode(query);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed.', true);
      return;
    }

    if (found.length === 0) {
      setMessage(`No places found for pincode ${query}.`, false);
      return;
    }

    const added = addPlaces(found);
    setMessage(
      added ? `Added ${added} place(s) for ${query}.` : `Pincode ${query} is already in the list.`,
      false
    );
    input.value = '';
    refresh();
  });

  clearBtn.addEventListener('click', () => {
    places = [];
    graphics = [];
    setMessage('', false);
    refresh();
  });

  routeBtn.addEventListener('click', async () => {
    const from = places[Number(fromSelect.value)];
    const to = places[Number(toSelect.value)];
    if (!from || !to) return;
    if (from === to) {
      setRouteInfo('Pick two different places.');
      return;
    }

    setRouteInfo('Calculating route…');
    routeBtn.disabled = true;
    try {
      const route = await getRoute(from, to);
      map.showRoute(route.paths);
      const parts: string[] = [];
      if (route.kilometers !== null) parts.push(`${route.kilometers.toFixed(1)} km`);
      if (route.minutes !== null) parts.push(`${Math.round(route.minutes)} min`);
      setRouteInfo(`${from.name} → ${to.name}${parts.length ? `: ${parts.join(', ')}` : ''}`);
    } catch (err) {
      setRouteInfo(err instanceof Error ? err.message : 'Route failed.');
    } finally {
      routeBtn.disabled = false;
    }
  });

  function renderResults(): void {
    resultsList.replaceChildren();
    resultsCount.textContent = places.length ? `${places.length} place(s)` : '';
    fromSelect.replaceChildren();
    toSelect.replaceChildren();

    places.forEach((place, i) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';

      const title = document.createElement('strong');
      title.textContent = place.name;
      const meta = document.createElement('span');
      meta.textContent = place.address || `${place.pincode}`;
      button.append(title, meta);

      button.addEventListener('click', () => {
        const graphic: Graphic | undefined = graphics[i];
        if (graphic) void map.focus(graphic);
      });
      li.appendChild(button);
      resultsList.appendChild(li);

      fromSelect.add(new Option(`${place.name} (${place.pincode})`, String(i)));
      toSelect.add(new Option(`${place.name} (${place.pincode})`, String(i)));
    });

    const hasTwo = places.length >= 2;
    clearBtn.disabled = places.length === 0;
    fromSelect.disabled = !hasTwo;
    toSelect.disabled = !hasTwo;
    routeBtn.disabled = !hasTwo;
    if (hasTwo) {
      toSelect.selectedIndex = 1;
      setRouteInfo('');
    } else {
      setRouteInfo(places.length ? 'Add one more pincode to route.' : '');
    }
  }

  renderResults();
}

void start();
