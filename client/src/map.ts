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
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import type { Place } from './types';
import '@arcgis/core/assets/esri/themes/light/main.css';

const PIN_COLOR: [number, number, number] = [200, 30, 30];
const ROUTE_COLOR: [number, number, number] = [40, 90, 180];

export interface MapHandle {
  showPlaces(places: Place[]): Graphic[];
  focus(graphic: Graphic): Promise<void>;
  showRoute(paths: number[][][]): void;
  clearRoute(): void;
  clear(): void;
}

export function createMap(containerId: string, basemapApiKey: string): MapHandle {
  if (basemapApiKey) {
    esriConfig.apiKey = basemapApiKey;
  }

  const placesLayer = new GraphicsLayer({ title: 'Places' });
  const routeLayer = new GraphicsLayer({ title: 'Route' });

  const map = new Map({
    basemap: 'streets-navigation-vector',
    layers: [routeLayer, placesLayer]
  });

  const view = new MapView({
    container: containerId,
    map,
    center: [78.9629, 20.5937], // India
    zoom: 4
  });

  return {
    showPlaces(places) {
      placesLayer.removeAll();
      const graphics = places.map(
        (place) =>
          new Graphic({
            geometry: new Point({ longitude: place.lon, latitude: place.lat }),
            symbol: new SimpleMarkerSymbol({
              color: PIN_COLOR,
              outline: { color: [255, 255, 255], width: 1 },
              size: 12
            }),
            attributes: { ...place },
            popupTemplate: {
              title: '{name}',
              content: '{address}<br>Pincode: {pincode}'
            }
          })
      );
      placesLayer.addMany(graphics);

      if (graphics.length === 1) {
        view.goTo({ target: graphics[0], zoom: 14 }, { duration: 600 }).catch(() => {});
      } else if (graphics.length > 1) {
        view.goTo(graphics, { duration: 600 }).catch(() => {});
      }
      return graphics;
    },

    focus(graphic) {
      return view
        .goTo({ target: graphic, zoom: 15 }, { duration: 600 })
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
      view.goTo(line, { duration: 600 }).catch(() => {});
    },

    clearRoute() {
      routeLayer.removeAll();
    },

    clear() {
      placesLayer.removeAll();
      routeLayer.removeAll();
      view.popup.close();
    }
  };
}
