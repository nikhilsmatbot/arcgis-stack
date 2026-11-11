import Graphic from '@arcgis/core/Graphic';
import { getConfig, getRoute, searchPincode } from './api';
import { createMap } from './map';
import type { Place } from './types';
import './styles.css';

const PINCODE_PATTERN = /^\d{6}$/;

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#pincode')!;
const message = document.querySelector<HTMLParagraphElement>('#search-message')!;
const resultsList = document.querySelector<HTMLUListElement>('#results')!;
const resultsCount = document.querySelector<HTMLSpanElement>('#results-count')!;
const fromSelect = document.querySelector<HTMLSelectElement>('#from-select')!;
const toSelect = document.querySelector<HTMLSelectElement>('#to-select')!;
const routeBtn = document.querySelector<HTMLButtonElement>('#route-btn')!;
const routeInfo = document.querySelector<HTMLParagraphElement>('#route-info')!;

let places: Place[] = [];
let graphics: Graphic[] = [];

function setMessage(text: string, isError: boolean): void {
  message.textContent = text;
  message.classList.toggle('info', !isError);
}

function setRouteInfo(text: string): void {
  routeInfo.textContent = text;
}

async function start(): Promise<void> {
  let basemapApiKey = '';
  try {
    basemapApiKey = (await getConfig()).basemapApiKey;
  } catch {
    setMessage('Could not load config from server.', true);
  }

  const map = createMap('map', basemapApiKey);

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
    try {
      places = await searchPincode(query);
    } catch (err) {
      places = [];
      setMessage(err instanceof Error ? err.message : 'Search failed.', true);
      renderResults(map);
      return;
    }

    map.clear();
    if (places.length === 0) {
      setMessage(`No places found for pincode ${query}.`, false);
    } else {
      setMessage('', false);
      graphics = map.showPlaces(places);
    }
    renderResults(map);
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
      const parts = [];
      if (route.kilometers !== null) parts.push(`${route.kilometers.toFixed(1)} km`);
      if (route.minutes !== null) parts.push(`${Math.round(route.minutes)} min`);
      setRouteInfo(`${from.name} → ${to.name}${parts.length ? `: ${parts.join(', ')}` : ''}`);
    } catch (err) {
      setRouteInfo(err instanceof Error ? err.message : 'Route failed.');
    } finally {
      routeBtn.disabled = false;
    }
  });

  function renderResults(handle: ReturnType<typeof createMap>): void {
    resultsList.replaceChildren();
    resultsCount.textContent = places.length ? `${places.length} found` : '';
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
        const graphic = graphics[i];
        if (graphic) void handle.focus(graphic);
      });
      li.appendChild(button);
      resultsList.appendChild(li);

      fromSelect.add(new Option(place.name, String(i)));
      toSelect.add(new Option(place.name, String(i)));
    });

    const hasTwo = places.length >= 2;
    fromSelect.disabled = !hasTwo;
    toSelect.disabled = !hasTwo;
    routeBtn.disabled = !hasTwo;
    if (hasTwo) {
      toSelect.selectedIndex = 1;
      setRouteInfo('');
    } else {
      setRouteInfo(places.length ? 'Need two results to route.' : '');
      handle.clearRoute();
    }
  }
}

void start();
