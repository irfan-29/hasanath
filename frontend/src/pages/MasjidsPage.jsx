import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import Loader from '../components/Loader';
import LocationPicker from '../components/LocationPicker';

// The map and its library load only when this page is opened.
const MasjidsMap = lazy(() => import('../components/MasjidsMap'));

// Masjids nearby.
//
// The list comes through the app's own API (see api/services/masjids.js),
// which asks a masjid directory and OpenStreetMap and merges the two.
//
// Where "nearby" is measured from works the way it does on the prayer-times
// page: it starts from the reader's saved location, without asking the phone
// for anything. The same location picker sits at the top, so the reader can
// look around another place (a city they are travelling to, or their exact
// position right now). That choice is for this page only: it does not change
// the location saved for prayer times.
//
// The masjids are shown twice: as pins on a map, and as a list, nearest first.
// Routes are not drawn here. Directions opens Google Maps, which already knows
// the roads, the traffic and how the reader likes to travel.

const RADII = [
  { metres: 2000, label: '2 km' },
  { metres: 5000, label: '5 km' },
  { metres: 10000, label: '10 km' },
];
const DEFAULT_RADIUS = 2000;

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

export default function MasjidsPage() {
  const [state, setState] = useState({ status: 'loading', masjids: [], label: '', center: null });
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [busy, setBusy] = useState(true);
  // A place picked on this page ({ label, latitude, longitude }), or null to
  // use the saved location.
  const [picked, setPicked] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The masjid picked on the map or from the list; its pin is highlighted.
  const [selectedId, setSelectedId] = useState('');
  const mapWrapRef = useRef(null);
  // Guards against a slow answer landing after a newer request.
  const requestRef = useRef(0);

  const load = useCallback(async (metres, place) => {
    const request = ++requestRef.current;
    setBusy(true);
    setSelectedId('');
    try {
      const where = place ? `&lat=${Number(place.latitude).toFixed(5)}&lng=${Number(place.longitude).toFixed(5)}` : '';
      const data = await api.get(`/masjids/nearby?radius=${metres}${where}`);
      if (request !== requestRef.current) return;
      if (data.needsLocation) {
        setState({ status: 'needs-location', masjids: [], label: '', center: null });
      } else {
        setState({
          status: 'ready',
          masjids: data.masjids || [],
          label: place ? place.label : ((data.center && data.center.label) || ''),
          center: data.center || null,
        });
      }
    } catch (err) {
      if (request !== requestRef.current) return;
      setState((current) => ({ ...current, status: 'error', tooMany: Boolean(err && err.status === 429) }));
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }, []);

  // Start from the saved location, as the prayer-times page does.
  useEffect(() => { load(DEFAULT_RADIUS, null); }, [load]);

  const chooseRadius = (metres) => {
    if (metres === radius) return;
    setRadius(metres);
    load(metres, picked);
  };

  // A place chosen in the picker: a searched city, or the phone's position.
  const choosePlace = async (place) => {
    setPicked(place);
    await load(radius, place);
  };

  const backToSaved = () => {
    setPicked(null);
    load(radius, null);
  };

  // "Show on map" from a card: pick the pin and bring the map into view.
  const showOnMap = (id) => {
    setSelectedId(id);
    if (mapWrapRef.current) mapWrapRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const widest = RADII[RADII.length - 1].metres;
  const radiusText = RADII.find((option) => option.metres === radius)?.label;
  const hasPlace = state.status === 'ready' || (state.status === 'error' && (picked || state.label));

  return (
    <>
      <div className="page-header">
        <h1>Masjids Nearby</h1>
      </div>

      {state.status === 'needs-location' ? (
        <div className="masjid-status">
          <p className="post-empty">Choose a place to see the masjids around it.</p>
          <div className="masjid-location">
            <LocationPicker value="" open={pickerOpen} onOpenChange={setPickerOpen} onSelect={choosePlace} />
          </div>
          <p className="masjid-hint">
            To use the same place every time, save a location on the{' '}
            <Link to="/salah-timings">Salah Timings</Link> page.
          </p>
        </div>
      ) : (
        <div className="masjid-toolbar">
          <div className="masjid-location">
            <span className="masjid-kicker">Location</span>
            <LocationPicker
              value={state.label || (picked && picked.label) || ''}
              disabled={busy}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onSelect={choosePlace}
            />
            <p className="masjid-hint">
              {picked ? (
                <>
                  Looking around a place you picked. Your saved location has not changed.{' '}
                  <button type="button" className="masjid-link" onClick={backToSaved} disabled={busy}>
                    Back to my saved location
                  </button>
                </>
              ) : 'Your saved location. Pick another place to look somewhere else.'}
            </p>
          </div>
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
        </div>
      )}

      {busy && state.status !== 'needs-location' && (
        <div className="masjid-status">
          <Loader variant="inline" label={radius > 2000 ? 'Looking for masjids across a wider area' : 'Looking for masjids'} />
        </div>
      )}

      {!busy && state.status === 'error' && (
        <div className="masjid-status">
          <p className="post-empty">
            {state.tooMany
              ? 'That was a lot of searches in a short time. Please try again in a few minutes.'
              : 'The masjid search is not answering right now. Please try again in a moment.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => load(radius, picked)}>Try again</button>
        </div>
      )}

      {!busy && state.status === 'ready' && state.masjids.length === 0 && (
        <div className="masjid-status">
          <p className="post-empty">No masjids were found within {radiusText} of here.</p>
          {radius < widest && (
            <button type="button" className="btn btn-primary" onClick={() => chooseRadius(widest)}>
              Search {RADII[RADII.length - 1].label}
            </button>
          )}
        </div>
      )}

      {!busy && state.status === 'ready' && state.masjids.length > 0 && (
        <>
          <p className="masjid-count" role="status">
            {state.masjids.length} {state.masjids.length === 1 ? 'masjid' : 'masjids'} within {radiusText}, nearest first
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

      {hasPlace && (
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
      )}
    </>
  );
}
