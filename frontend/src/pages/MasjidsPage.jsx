import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import Loader from '../components/Loader';

// The map and its library load only when this page is opened.
const MasjidsMap = lazy(() => import('../components/MasjidsMap'));

// Masjids nearby.
//
// The list comes through the app's own API (see api/services/masjids.js),
// which asks a masjid directory and OpenStreetMap and merges the two. The
// phone's position is used when the reader allows it, because "nearby" is only
// as good as the point it is measured from; the place saved for prayer times
// is the fallback, and with neither the page asks for a location instead of
// guessing a city.
//
// The masjids are shown twice: as pins on a map, and as a list, nearest first.
// Routes are not drawn here. Directions opens Google Maps, which already knows
// the roads, the traffic and how the reader likes to travel.

const RADII = [
  { metres: 2000, label: '2 km' },
  { metres: 5000, label: '5 km' },
  { metres: 10000, label: '10 km' },
];
const DEFAULT_RADIUS = 5000;

// "350 m" up close, "2.4 km" beyond; nobody needs metres at five kilometres.
function distanceLabel(metres) {
  if (metres < 950) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toFixed(metres < 9950 ? 1 : 0)} km`;
}

// Google Maps' own link formats: no key, and on a phone they open the Maps app.
// When the directory supplied Google's id for the place, it is passed along, so
// Maps opens that exact masjid (with its photos and reviews) rather than a bare pin.
function directionsUrl(place) {
  if (place.placeId) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.name || 'Masjid')}&destination_place_id=${encodeURIComponent(place.placeId)}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
}

function placeUrl(place) {
  if (place.placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name || 'Masjid')}&query_place_id=${encodeURIComponent(place.placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
}

function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 300000 });
  });
}

export default function MasjidsPage() {
  const [state, setState] = useState({ status: 'locating', masjids: [], source: '', label: '' });
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [busy, setBusy] = useState(false);
  // The masjid picked on the map or from the list; its pin is highlighted.
  const [selectedId, setSelectedId] = useState('');
  const mapWrapRef = useRef(null);
  // The phone's position, when it gave one. null means "use the saved place".
  const coordsRef = useRef(null);
  // Guards against a slow answer landing after a newer request.
  const requestRef = useRef(0);

  const load = useCallback(async (metres) => {
    const request = ++requestRef.current;
    setBusy(true);
    try {
      const coords = coordsRef.current;
      const where = coords ? `&lat=${coords.lat.toFixed(5)}&lng=${coords.lng.toFixed(5)}` : '';
      const data = await api.get(`/masjids/nearby?radius=${metres}${where}`);
      if (request !== requestRef.current) return;
      if (data.needsLocation) {
        setState({ status: 'needs-location', masjids: [], source: '', label: '' });
      } else {
        setState({
          status: 'ready',
          masjids: data.masjids || [],
          source: data.source || '',
          label: (data.center && data.center.label) || '',
          center: data.center || null,
        });
      }
    } catch (err) {
      if (request !== requestRef.current) return;
      const tooMany = err && err.status === 429;
      setState((current) => ({ ...current, status: 'error', tooMany }));
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }, []);

  // Ask the phone where it is, then load. Without an answer the saved place is used.
  const locate = useCallback(async (metres) => {
    setState((current) => ({ ...current, status: current.masjids.length ? current.status : 'locating' }));
    try {
      const position = await readPosition();
      coordsRef.current = { lat: position.coords.latitude, lng: position.coords.longitude };
    } catch {
      coordsRef.current = null;
    }
    await load(metres);
  }, [load]);

  useEffect(() => { locate(DEFAULT_RADIUS); }, [locate]);

  // "Show on map" from a card: pick the pin and bring the map into view.
  const showOnMap = (id) => {
    setSelectedId(id);
    if (mapWrapRef.current) mapWrapRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const chooseRadius = (metres) => {
    if (metres === radius) return;
    setSelectedId('');
    setRadius(metres);
    load(metres);
  };

  const ready = state.status === 'ready';
  const widest = RADII[RADII.length - 1].metres;

  return (
    <>
      <div className="page-header">
        <h1>Masjids Nearby</h1>
      </div>

      {state.status === 'locating' && (
        <div className="masjid-status">
          <Loader variant="inline" label="Finding your location" />
        </div>
      )}

      {state.status === 'needs-location' && (
        <div className="masjid-status">
          <p className="post-empty">Choose a location, or allow location access, to see the masjids around you.</p>
          <div className="masjid-status-actions">
            <button type="button" className="btn btn-primary" onClick={() => locate(radius)}>Use my location</button>
            <Link to="/salah-timings" className="btn btn-outline">Choose location</Link>
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="masjid-status">
          <p className="post-empty">
            {state.tooMany
              ? 'That was a lot of searches in a short time. Please try again in a few minutes.'
              : 'The map service is not answering right now. Please try again in a moment.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => load(radius)} disabled={busy}>Try again</button>
        </div>
      )}

      {ready && (
        <>
          <div className="masjid-toolbar">
            <p className="masjid-where">
              <span className="material-symbols-rounded" aria-hidden="true">{state.source === 'gps' ? 'my_location' : 'location_on'}</span>
              {state.source === 'gps'
                ? 'Near your current location'
                : `Near ${state.label || 'your saved location'}`}
            </p>
            <div className="masjid-controls">
              <div className="masjid-radii" role="group" aria-label="Distance">
                {RADII.map((option) => (
                  <button
                    key={option.metres}
                    type="button"
                    className="masjid-radius"
                    aria-pressed={radius === option.metres}
                    onClick={() => chooseRadius(option.metres)}
                    disabled={busy}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => locate(radius)} disabled={busy}>
                <span className="material-symbols-rounded" aria-hidden="true">my_location</span>
                {state.source === 'gps' ? 'Update' : 'Use my location'}
              </button>
            </div>
          </div>

          {busy && <Loader variant="inline" label="Looking for masjids" />}

          {!busy && state.masjids.length === 0 && (
            <div className="masjid-status">
              <p className="post-empty">
                No masjids are on the map within {RADII.find((option) => option.metres === radius)?.label} of here.
              </p>
              {radius < widest && (
                <button type="button" className="btn btn-primary" onClick={() => chooseRadius(widest)}>
                  Search {RADII[RADII.length - 1].label}
                </button>
              )}
            </div>
          )}

          {!busy && state.masjids.length > 0 && (
            <>
              <p className="masjid-count" role="status">
                {state.masjids.length} {state.masjids.length === 1 ? 'masjid' : 'masjids'} within {RADII.find((option) => option.metres === radius)?.label}, nearest first
              </p>
              <div className="masjid-map-wrap" ref={mapWrapRef}>
                <Suspense fallback={<div className="masjid-map masjid-map-loading"><Loader variant="inline" label="Loading the map" /></div>}>
                  <MasjidsMap
                    center={state.center}
                    masjids={state.masjids}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    distanceLabel={distanceLabel}
                    directionsUrl={directionsUrl}
                  />
                </Suspense>
              </div>
              <ul className="masjid-list">
                {state.masjids.map((place) => (
                  <li className={`masjid-card${selectedId === place.id ? ' is-selected' : ''}`} key={place.id}>
                    <span className="masjid-icon" aria-hidden="true">
                      <span className="material-symbols-rounded">mosque</span>
                    </span>
                    <div className="masjid-body">
                      <h2 className="masjid-name">{place.name || 'Masjid'}</h2>
                      <p className="masjid-meta">
                        <span className="masjid-distance">{distanceLabel(place.distance)}</span>
                        {place.address ? ` · ${place.address}` : (!place.name ? ' · Name not on the map yet' : '')}
                      </p>
                      {place.jumuah && <p className="masjid-meta">Jumu’ah: {place.jumuah}</p>}
                      <div className="masjid-actions">
                        <a className="btn btn-primary btn-sm" href={directionsUrl(place)} target="_blank" rel="noopener noreferrer">
                          Directions
                        </a>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => showOnMap(place.id)}>
                          Show on map
                        </button>
                        <a className="btn btn-outline btn-sm" href={placeUrl(place)} target="_blank" rel="noopener noreferrer">
                          Open in Google Maps
                        </a>
                        {place.phone && (
                          <a className="btn btn-outline btn-sm" href={`tel:${place.phone.replace(/[^\d+]/g, '')}`}>Call</a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="masjid-note">
            Places come from{' '}
            <a href="https://masjidnear.me" target="_blank" rel="noopener noreferrer">masjidnear.me</a> and{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>,
            and the map is drawn by OpenStreetMap. If a masjid is missing or its name is wrong, you can{' '}
            <a
              href={state.center ? `https://www.openstreetmap.org/edit#map=17/${state.center.latitude}/${state.center.longitude}` : 'https://www.openstreetmap.org/'}
              target="_blank"
              rel="noopener noreferrer"
            >
              add or correct it on OpenStreetMap
            </a>, and it will appear here for everyone.
          </p>
        </>
      )}
    </>
  );
}
