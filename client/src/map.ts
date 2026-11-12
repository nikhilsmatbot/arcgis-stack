/*
 * PROTOTYPE NOTE: ArcGIS Maps SDK for JavaScript is a prototype choice.
 * The production map will move to MapLibre GL. Keep map code in this file
 * so that swap stays contained. Data comes from api.ts and must not depend
 * on the map library.
 */
import esriConfig from '@arcgis/core/config';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Circle from '@arcgis/core/geometry/Circle';
import Extent from '@arcgis/core/geometry/Extent';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import type { Area, NearbyPlace } from './types';
import '@arcgis/core/assets/esri/themes/light/main.css';

const AREA_COLOR: [number, number, number] = [200, 30, 30]; // red: searched postal areas
const PLACE_COLOR: [number, number, number] = [20, 110, 160]; // blue: nearby places
const ROUTE_COLOR: [number, number, number] = [40, 90, 180];

export interface MapHandle {
  /** Swap in a fresh access token (called before the old one expires). */
  setToken(token: string): void;
  /** Draw area pins, plus a dashed search circle around the selected one. */
  showAreas(areas: Area[], selected: number): Graphic[];
  /** Fit the view to an area's search circle. */
  zoomToArea(area: Area): void;
  /** Fit the view to the area center plus its nearby places (whole area if none). */
  zoomToPlaces(area: Area, places: NearbyPlace[]): void;
  /** Draw nearby-place pins. */
  showNearby(places: NearbyPlace[]): Graphic[];
  /** Center on a pin and open its popup. */
  focus(graphic: Graphic): Promise<void>;
  showRoute(paths: number[][][]): void;
  clearRoute(): void;
  clear(): void;
}

function areaCircle(area: Area): Circle {
  return new Circle({
    center: new Point({ longitude: area.lon, latitude: area.lat }),
    radius: area.radiusKm,
    radiusUnit: 'kilometers',
    geodesic: true
  });
}

export function createMap(containerId: string, token: string): MapHandle {
  // Short-lived access token from /api/token. The SDK appends it to
  // basemap requests. No long-lived key is stored in the client bundle.
  if (token) {
    esriConfig.apiKey = token;
  }

  const routeLayer = new GraphicsLayer({ title: 'Route' });
  const areaLayer = new GraphicsLayer({ title: 'Postal areas' });
  const nearbyLayer = new GraphicsLayer({ title: 'Nearby places' });

  const map = new Map({
    basemap: 'streets-navigation-vector',
    layers: [areaLayer, routeLayer, nearbyLayer]
  });

  const view = new MapView({
    container: containerId,
    map,
    center: [20, 25], // world view until the first search
    zoom: 2
  });

  return {
    setToken(next) {
      esriConfig.apiKey = next;
    },

    showAreas(areas, selected) {
      areaLayer.removeAll();

      const current = areas[selected];
      if (current) {
        areaLayer.add(
          new Graphic({
            geometry: areaCircle(current),
            symbol: new SimpleFillSymbol({
              color: [200, 30, 30, 0.05],
              outline: new SimpleLineSymbol({ color: AREA_COLOR, width: 1.5, style: 'dash' })
            })
          })
        );
      }

      const pins = areas.map(
        (area, i) =>
          new Graphic({
            geometry: new Point({ longitude: area.lon, latitude: area.lat }),
            symbol: new SimpleMarkerSymbol({
              color: AREA_COLOR,
              outline: { color: [255, 255, 255], width: 1.5 },
              size: i === selected ? 16 : 11
            }),
            attributes: { ...area },
            popupTemplate: {
              title: '{name}',
              content: 'Postal code {postal}<br>{country}'
            }
          })
      );
      areaLayer.addMany(pins);
      return pins;
    },

    zoomToArea(area) {
      view.goTo(areaCircle(area).extent.expand(1.15), { duration: 700 }).catch(() => {});
    },

    zoomToPlaces(area, places) {
      if (!places.length) {
        this.zoomToArea(area);
        return;
      }
      // Bounding box of the center and every place, with a floor so one
      // very close place does not zoom in to a single building.
      const lats = [area.lat, ...places.map((p) => p.lat)];
      const lons = [area.lon, ...places.map((p) => p.lon)];
      const pad = 0.003; // about 300 m
      const extent = new Extent({
        xmin: Math.min(...lons) - pad,
        ymin: Math.min(...lats) - pad,
        xmax: Math.max(...lons) + pad,
        ymax: Math.max(...lats) + pad,
        spatialReference: { wkid: 4326 }
      });
      view.goTo(extent.expand(1.2), { duration: 700 }).catch(() => {});
    },

    showNearby(places) {
      nearbyLayer.removeAll();
      const pins = places.map(
        (place) =>
          new Graphic({
            geometry: new Point({ longitude: place.lon, latitude: place.lat }),
            symbol: new SimpleMarkerSymbol({
              color: PLACE_COLOR,
              outline: { color: [255, 255, 255], width: 1 },
              size: 9
            }),
            attributes: { ...place },
            popupTemplate: {
              title: '{name}',
              content: '{type}<br>{address}<br>{distanceKm} km from area center<br>{phone}'
            }
          })
      );
      nearbyLayer.addMany(pins);
      return pins;
    },

    focus(graphic) {
      return view
        .goTo({ target: graphic, zoom: Math.max(view.zoom, 15) }, { duration: 600 })
        .then(() => {
          view.openPopup({ features: [graphic], location: graphic.geometry as Point });
        })
        .catch(() => {});
    },

    showRoute(paths) {
      routeLayer.removeAll();
      const line = new Graphic({
        geometry: new Polyline({ paths, spatialReference: { wkid: 4326 } }),
        symbol: new SimpleLineSymbol({ color: ROUTE_COLOR, width: 4 })
      });
      routeLayer.add(line);
      view.goTo(line.geometry.extent.expand(1.3), { duration: 600 }).catch(() => {});
    },

    clearRoute() {
      routeLayer.removeAll();
    },

    clear() {
      areaLayer.removeAll();
      nearbyLayer.removeAll();
      routeLayer.removeAll();
      view.popup.close();
    }
  };
}
