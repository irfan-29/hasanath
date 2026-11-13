import { useEffect, useRef, useState } from 'react';
import { locations as locationsApi } from '../services/api';

// A searchable place picker.
//
// The timings page used to offer five fixed cities. Any place on earth is now
// valid, so the control is a search box: type a city or town, pick a result,
// or hand over the browser's coordinates. The selected place carries its
// coordinates and IANA timezone, which is what the times are computed from.
//
// Controlled: `value` is the saved label and `onSelect(place)` is async so the
// caller can persist and re-fetch before the panel closes.

const SEARCH_DEBOUNCE_MS = 320;

// Reverse-geocoding is a nicety: the coordinates are what matter. BigDataCloud's
// client endpoint needs no key; if it is unreachable the label simply stays
// "My location".
async function reverseLabel(latitude, longitude) {
  try {
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
    );
    if (!response.ok) return 'My location';
    const data = await response.json();
    const parts = [data.city || data.locality, data.principalSubdivision, data.countryName]
      .filter(Boolean);
    return parts.length ? parts.join(', ') : 'My location';
  } catch (err) {
    return 'My location';
  }
}

export default function LocationPicker({
  value = '',
  onSelect,
  disabled = false,
  className = '',
  triggerClassName = 'app-field-control app-select-trigger',
  open: openProp,
  onOpenChange,
  children,
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  // Controlled when the page needs to open the panel from elsewhere (the
  // empty-state button on the timings page); self-managed otherwise.
  const open = openProp === undefined ? uncontrolledOpen : openProp;
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (openProp === undefined) setUncontrolledOpen(value);
    if (onOpenChange) onOpenChange(value);
  };
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside press or Escape, the same contract as the app's other
  // popovers. Focusing the input on open means a phone keyboard appears only
  // when the reader actually asked to search.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  // Debounced search. Two characters minimum, matching the server, so a single
  // keystroke never becomes a request.
  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await locationsApi.search(term);
        if (cancelled) return;
        setResults(data.locations || []);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setResults([]);
        setError('Could not search places. Check your connection and try again.');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  async function choose(place) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setError('');
    await onSelect(place);
  }

  async function useMyLocation() {
    setError('');
    if (!navigator.geolocation) {
      setError('This browser cannot share a location. Search for a city instead.');
      return;
    }
    setLocating(true);
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 10000,
          maximumAge: 300000,
        });
      });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const label = await reverseLabel(latitude, longitude);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      await choose({ label, latitude, longitude, timezone });
    } catch (err) {
      setError('Could not read your location. Search for a city instead.');
    } finally {
      setLocating(false);
    }
  }

  const showEmpty = !searching && !error && query.trim().length >= 2 && results.length === 0;

  return (
    <div className={`location-picker ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="app-field-value">{value || 'Choose location'}</span>
        <span className="app-field-icon material-symbols-rounded" aria-hidden="true">expand_more</span>
      </button>

      {open && (
        <div className="location-picker-panel" role="dialog" aria-label="Change location">
          <div className="location-picker-search">
            <span className="material-symbols-rounded" aria-hidden="true">search</span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              placeholder="Search city or town"
              aria-label="Search for a city or town"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              onChange={(event) => setQuery(event.target.value)}
            />
            {searching && <span className="location-picker-busy" aria-hidden="true">…</span>}
          </div>

          <button
            type="button"
            className="location-picker-gps"
            onClick={useMyLocation}
            disabled={locating}
          >
            <span className="material-symbols-rounded" aria-hidden="true">my_location</span>
            <span>{locating ? 'Finding your location…' : 'Use my current location'}</span>
          </button>

          {error && <p className="location-picker-error" role="alert">{error}</p>}

          {results.length > 0 && (
            <ul className="location-picker-results">
              {results.map((place) => (
                <li key={`${place.latitude},${place.longitude}`}>
                  <button type="button" onClick={() => choose(place)}>
                    <span className="material-symbols-rounded" aria-hidden="true">location_on</span>
                    <span className="location-picker-result-text">
                      <strong>{place.name}</strong>
                      <span>{[place.admin1, place.country].filter(Boolean).join(', ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showEmpty && (
            <p className="location-picker-empty">No places matched. Try a nearby city.</p>
          )}

          <p className="location-picker-hint">
            Times are calculated for the exact place you pick, anywhere in the world.
          </p>

          {children}
        </div>
      )}
    </div>
  );
}
