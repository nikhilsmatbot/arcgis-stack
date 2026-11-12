import Graphic from '@arcgis/core/Graphic';
import { getMapToken, getNearby, getRoute, searchPostal } from './api';
import type { MapToken } from './api';
import { createMap } from './map';
import type { Area, CategoryKey, LatLon, NearbyPlace } from './types';
import './styles.css';

// Postal codes from any country: 3-12 letters/digits, spaces or hyphens inside.
const POSTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/;

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'restaurants', label: 'Restaurants' },
  { key: 'hotels', label: 'Hotels' },
  { key: 'grocery', label: 'Grocery' },
  { key: 'pharmacies', label: 'Pharmacies' },
  { key: 'atms', label: 'ATMs' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'hospitals', label: 'Hospitals' },
  { key: 'things', label: 'Things to do' }
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('search-form');
const input = $<HTMLInputElement>('postal');
const message = $<HTMLParagraphElement>('search-message');
const areasSection = $<HTMLElement>('areas-section');
const areasList = $<HTMLUListElement>('areas');
const clearBtn = $<HTMLButtonElement>('clear-btn');
const nearbySection = $<HTMLElement>('nearby-section');
const nearbyTitle = $<HTMLHeadingElement>('nearby-title');
const nearbyCount = $<HTMLSpanElement>('nearby-count');
const chips = $<HTMLDivElement>('chips');
const nearbyMessage = $<HTMLParagraphElement>('nearby-message');
const nearbyList = $<HTMLUListElement>('nearby');
const routeSection = $<HTMLElement>('route-section');
const fromSelect = $<HTMLSelectElement>('from-select');
const toSelect = $<HTMLSelectElement>('to-select');
const routeBtn = $<HTMLButtonElement>('route-btn');
const routeInfo = $<HTMLParagraphElement>('route-info');

// ---- State ----
let areas: Area[] = []; // one chosen area per search
let selected = -1; // index into areas
// The same code often exists in several countries. These are the other
// matches from the latest search; picking one swaps it in for areas[altFor].
let alternates: Area[] = [];
let altFor = -1;
let category: CategoryKey = 'all';
let nearby: NearbyPlace[] = []; // places for the selected area + category
let areaPins: Graphic[] = [];
let nearbyPins: Graphic[] = [];
// Avoid repeat geocode calls (each one costs credits).
const nearbyCache = new Map<string, NearbyPlace[]>();
let nearbyRequest = 0; // guards against out-of-order responses

/** Points the route form can use: all areas, then the nearby places shown. */
interface RoutePoint extends LatLon {
  label: string;
}
let routePoints: RoutePoint[] = [];

function setMessage(text: string, isError = false): void {
  message.textContent = text;
  message.classList.toggle('info', !isError);
}

const sameArea = (a: Area, b: Area) => a.postal === b.postal && a.lat === b.lat && a.lon === b.lon;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function start(): Promise<void> {
  let mapToken: MapToken | null = null;
  try {
    mapToken = await getMapToken();
  } catch (err) {
    setMessage(err instanceof Error ? `Map token: ${err.message}` : 'Could not get map token.', true);
  }

  const map = createMap('map', mapToken?.token ?? '');

  // Short-lived tokens: the server says when to ask again (refreshInMs).
  // It rotates its cached token at that point, so we get a fresh one while
  // the old one is still valid. +1 s so we land just after the server's cutover.
  function scheduleRefresh(refreshInMs: number): void {
    const delay = Math.max(5_000, refreshInMs + 1_000);
    window.setTimeout(async () => {
      try {
        const next = await getMapToken();
        map.setToken(next.token);
        scheduleRefresh(next.refreshInMs);
      } catch {
        // Server waking up or briefly unreachable: retry soon.
        scheduleRefresh(10_000);
      }
    }, delay);
  }
  if (mapToken) scheduleRefresh(mapToken.refreshInMs);

  // ---- Search ----
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    input.removeAttribute('aria-invalid');

    if (!POSTAL_PATTERN.test(code)) {
      input.setAttribute('aria-invalid', 'true');
      setMessage('Enter a postal code: 3 to 12 letters or digits, e.g. 20170 or SW1A 1AA.', true);
      return;
    }

    setMessage('Searching…');
    let found: Area[];
    try {
      found = await searchPostal(code);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed.', true);
      return;
    }
    if (found.length === 0) {
      setMessage(`No area found for postal code ${code}.`);
      return;
    }

    // Show the best match; keep the rest as alternates the user can switch to.
    const [best, ...rest] = found;
    let index = areas.findIndex((a) => sameArea(a, best));
    if (index === -1) {
      areas.push(best);
      index = areas.length - 1;
    }
    alternates = rest;
    altFor = index;

    setMessage(
      rest.length
        ? `Showing ${best.name}. This code exists in ${rest.length} other place${rest.length > 1 ? 's' : ''} too.`
        : `Showing ${best.name}.`
    );
    input.value = '';
    selectArea(index);
  });

  clearBtn.addEventListener('click', () => {
    areas = [];
    alternates = [];
    altFor = -1;
    selected = -1;
    nearby = [];
    areaPins = [];
    nearbyPins = [];
    nearbyRequest++;
    map.clear();
    setMessage('');
    renderAreas();
    renderNearby();
    renderRouteForm();
  });

  // ---- Areas ----
  function selectArea(index: number): void {
    selected = index;
    const area = areas[index];
    areaPins = map.showAreas(areas, selected);
    map.clearRoute();
    routeInfo.textContent = '';
    map.zoomToArea(area);
    renderAreas();
    void loadNearby();
  }

  function renderAreas(): void {
    areasSection.hidden = areas.length === 0;
    areasList.replaceChildren();
    areas.forEach((area, i) => {
      const li = el('li');
      const button = el('button', `item${i === selected ? ' active' : ''}`);
      button.type = 'button';
      button.append(
        el('strong', undefined, area.name),
        el('span', undefined, [area.country, `Postal code ${area.postal}`].filter(Boolean).join(' · '))
      );
      button.addEventListener('click', () => selectArea(i));
      li.appendChild(button);

      // Same code in other countries: collapsed, so it does not bury the nearby list.
      if (i === selected && i === altFor && alternates.length) {
        const details = el('details', 'alternates');
        details.appendChild(
          el('summary', undefined, `Not the right ${area.postal}? ${alternates.length} other match${alternates.length > 1 ? 'es' : ''}`)
        );
        alternates.forEach((alt, altIndex) => {
          const pick = el('button', 'item');
          pick.type = 'button';
          pick.append(el('strong', undefined, alt.name), el('span', undefined, alt.country));
          pick.addEventListener('click', () => {
            // Swap: the alternate becomes the area, the old area becomes an alternate.
            alternates[altIndex] = areas[i];
            areas[i] = alt;
            setMessage(`Showing ${alt.name}.`);
            selectArea(i);
          });
          details.appendChild(pick);
        });
        li.appendChild(details);
      }
      areasList.appendChild(li);
    });
  }

  // ---- Nearby places ----
  CATEGORIES.forEach(({ key, label }) => {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.dataset.key = key;
    chip.addEventListener('click', () => {
      if (category === key) return;
      category = key;
      void loadNearby();
    });
    chips.appendChild(chip);
  });

  async function loadNearby(): Promise<void> {
    const area = areas[selected];
    if (!area) return;
    const requestId = ++nearbyRequest;
    const cacheKey = `${area.lat},${area.lon},${category}`;

    chips.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => {
      const on = chip.dataset.key === category;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
    nearbySection.hidden = false;
    nearbyTitle.textContent = `Nearby ${area.postal}`;

    let places = nearbyCache.get(cacheKey);
    if (!places) {
      nearby = [];
      nearbyPins = map.showNearby([]);
      renderNearby('Loading nearby places…');
      try {
        places = await getNearby(area, category);
        nearbyCache.set(cacheKey, places);
      } catch (err) {
        if (requestId !== nearbyRequest) return;
        renderNearby(err instanceof Error ? err.message : 'Could not load nearby places.', true);
        renderRouteForm();
        return;
      }
    }
    if (requestId !== nearbyRequest) return; // a newer request superseded this one

    nearby = places;
    nearbyPins = map.showNearby(nearby);
    map.zoomToPlaces(area, nearby);
    renderNearby(nearby.length ? '' : `Nothing found within ${area.radiusKm} km for this filter.`);
    renderRouteForm();
  }

  function renderNearby(note = '', isError = false): void {
    if (selected === -1) nearbySection.hidden = true;
    nearbyMessage.textContent = note;
    nearbyMessage.classList.toggle('info', !isError);
    // The service returns at most 50, nearest first.
    nearbyCount.textContent = !nearby.length
      ? ''
      : nearby.length >= 50
        ? '50 nearest'
        : `${nearby.length} within ${areas[selected]?.radiusKm} km`;
    nearbyList.replaceChildren();

    nearby.forEach((place, i) => {
      const li = el('li', 'place');
      const button = el('button', 'item');
      button.type = 'button';
      button.append(
        el('strong', undefined, place.name),
        el('span', undefined, [place.type, `${place.distanceKm} km`].filter(Boolean).join(' · ')),
        el('span', undefined, place.address)
      );
      button.addEventListener('click', () => {
        const pin = nearbyPins[i];
        if (pin) void map.focus(pin);
      });

      const go = el('button', 'ghost', 'Route');
      go.type = 'button';
      go.title = `Route from ${areas[selected]?.postal} to ${place.name}`;
      go.addEventListener('click', () => {
        const from = areas[selected];
        if (from) void runRoute({ ...from, label: from.name }, { ...place, label: place.name });
      });

      li.append(button, go);
      nearbyList.appendChild(li);
    });
  }

  // ---- Route ----
  function renderRouteForm(): void {
    routePoints = [
      ...areas.map((a) => ({ lat: a.lat, lon: a.lon, label: `Area: ${a.name}` })),
      ...nearby.map((p) => ({ lat: p.lat, lon: p.lon, label: p.name }))
    ];
    routeSection.hidden = routePoints.length < 2;

    const keepFrom = fromSelect.value;
    fromSelect.replaceChildren();
    toSelect.replaceChildren();
    routePoints.forEach((point, i) => {
      fromSelect.add(new Option(point.label, String(i)));
      toSelect.add(new Option(point.label, String(i)));
    });
    // Default: from the selected area to the nearest place (or the next area).
    fromSelect.value = selected >= 0 ? String(selected) : keepFrom || '0';
    const firstOther = routePoints.findIndex((_, i) => String(i) !== fromSelect.value && i >= areas.length);
    toSelect.value = String(firstOther !== -1 ? firstOther : fromSelect.value === '0' ? 1 : 0);
  }

  async function runRoute(from: RoutePoint, to: RoutePoint): Promise<void> {
    routeSection.hidden = false;
    routeInfo.textContent = 'Calculating route…';
    routeBtn.disabled = true;
    try {
      const route = await getRoute(from, to);
      map.showRoute(route.paths);
      const parts: string[] = [];
      if (route.kilometers !== null) parts.push(`${route.kilometers.toFixed(1)} km`);
      if (route.minutes !== null) parts.push(`${Math.round(route.minutes)} min drive`);
      routeInfo.textContent = `${from.label.replace(/^Area: /, '')} → ${to.label.replace(/^Area: /, '')}${
        parts.length ? `: ${parts.join(', ')}` : ''
      }`;
      routeInfo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      routeInfo.textContent = err instanceof Error ? err.message : 'Route failed.';
    } finally {
      routeBtn.disabled = false;
    }
  }

  routeBtn.addEventListener('click', () => {
    const from = routePoints[Number(fromSelect.value)];
    const to = routePoints[Number(toSelect.value)];
    if (!from || !to) return;
    if (from === to) {
      routeInfo.textContent = 'Pick two different points.';
      return;
    }
    void runRoute(from, to);
  });

  renderAreas();
  renderNearby();
  renderRouteForm();
}

void start();
