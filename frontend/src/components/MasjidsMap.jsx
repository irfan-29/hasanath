import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// The map on the Masjids Nearby page: the reader's position and a pin for each
// masjid, drawn with Leaflet on OpenStreetMap's tiles.
//
// Why not Google's own map here: showing pins on a Google map inside a page
// needs a Google Cloud account with billing switched on. This needs no key and
// costs nothing. Directions still go to Google Maps, which is the part people
// actually want from it.
//
// Loaded only when the page asks for it (see MasjidsPage), so the map library
// is not part of what every other page downloads.

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

// Pins are drawn with CSS (.masjid-pin, .masjid-you), not Leaflet's image files,
// which do not survive bundling without extra configuration.
const pinIcon = (active) => L.divIcon({
  className: `masjid-pin${active ? ' is-active' : ''}`,
  html: '<span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30],
});
const youIcon = L.divIcon({ className: 'masjid-you', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] });

// A popup built from elements, never from an HTML string: the names come from
// outside the app and must be shown as text.
function popupFor(place, distanceText, directionsHref) {
  const box = document.createElement('div');
  box.className = 'masjid-popup';
  const name = document.createElement('strong');
  name.textContent = place.name || 'Masjid';
  const meta = document.createElement('span');
  meta.textContent = distanceText;
  const link = document.createElement('a');
  link.href = directionsHref;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Directions';
  box.append(name, meta, link);
  return box;
}

export default function MasjidsMap({ center, masjids, selectedId, onSelect, distanceLabel, directionsUrl }) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // The map's pictures (its tiles) arrive after the pins. Until the first set
  // is in, a note sits inside the frame so it never looks broken or empty.
  const [tilesReady, setTilesReady] = useState(false);

  // The map itself, made once.
  useEffect(() => {
    const map = L.map(nodeRef.current, {
      // Two fingers (or the buttons) to zoom: one finger must still scroll the page.
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile,
      tap: false,
    });
    const tiles = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    tiles.once('load', () => setTilesReady(true));
    // If the tiles cannot be fetched at all, stop saying "loading": the pins
    // and the list still work without the picture behind them.
    const giveUp = window.setTimeout(() => setTilesReady(true), 12000);
    map.attributionControl.setPrefix(false);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // On a phone, dragging starts only after the map has been tapped, so a
    // thumb travelling down the page does not get caught in it.
    const enableDrag = () => map.dragging.enable();
    map.on('click', enableDrag);
    return () => { window.clearTimeout(giveUp); map.off('click', enableDrag); map.remove(); mapRef.current = null; };
  }, []);

  // Pins, redrawn whenever the list or the centre changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();

    const points = [];
    if (center) {
      const at = [center.latitude, center.longitude];
      L.marker(at, { icon: youIcon, interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(layer);
      points.push(at);
    }
    masjids.forEach((place) => {
      const at = [place.latitude, place.longitude];
      const marker = L.marker(at, { icon: pinIcon(false), title: place.name || 'Masjid', alt: place.name || 'Masjid' }).addTo(layer);
      marker.bindPopup(popupFor(place, distanceLabel(place.distance), directionsUrl(place)), { closeButton: false, maxWidth: 220 });
      marker.on('click', () => onSelectRef.current(place.id));
      markersRef.current.set(place.id, marker);
      points.push(at);
    });

    if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 15);
  }, [center, masjids, distanceLabel, directionsUrl]);

  // The chosen masjid: its pin is highlighted, brought into view and opened.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker, id) => marker.setIcon(pinIcon(id === selectedId)));
    const marker = selectedId ? markersRef.current.get(selectedId) : null;
    if (marker) {
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: true });
      marker.openPopup();
    }
  }, [selectedId, masjids]);

  return (
    <div className="masjid-map-frame">
      <div className="masjid-map" ref={nodeRef} role="region" aria-label="Map of nearby masjids" />
      {!tilesReady && (
        <div className="masjid-map-wait" role="status">
          <span className="masjid-map-spinner" aria-hidden="true" />
          Loading the map…
        </div>
      )}
    </div>
  );
}
