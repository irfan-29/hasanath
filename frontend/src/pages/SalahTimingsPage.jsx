import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { useToast } from '../components/ToastProvider';
import Loader from '../components/Loader';
import FormSelect from '../components/FormSelect';

const LOCATIONS = ['Coimbatore', 'Hosur', 'Salem', 'Ramanathapuram', 'Bengaluru'];

export default function SalahTimingsPage() {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, location: '', details: null });
  const [error, setError] = useState('');

  const load = useCallback(async (location) => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const target = location ? `/salah-timings?location=${encodeURIComponent(location)}` : '/salah-timings';
      const data = await api.get(target);
      setState({ loading: false, location: data.location, details: data.details, error: '' });
    } catch (err) {
      setState({ loading: false, location: '', details: null });
      setError('Could not load prayer times.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The API can return a city that is not in the picker's list (an older saved
  // setting, for example). Add it so the closed trigger still shows the city
  // that the times above were actually fetched for.
  const locationOptions = LOCATIONS.includes(state.location)
    ? LOCATIONS.map((location) => ({ value: location, label: location }))
    : [
        ...(state.location ? [{ value: state.location, label: state.location }] : []),
        ...LOCATIONS.map((location) => ({ value: location, label: location })),
      ];

  async function changeLocation(value) {
    try {
      // Saved first so the setting and the displayed times cannot disagree on
      // the next visit; the widget is re-fetched for the new location.
      await api.post('/settings', { location: value });
      await load(value);
      toast('Location updated');
    } catch (err) {
      setError('Could not change location.');
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Salah Timings</h1>
      </div>

      {/*
        The date and the city are one context block for the times below: the
        date first when it is known, then the city trigger, both centred on the
        same axis as the prayer cards. The city is still the selector - the
        trailing arrow opens the app's own menu - but it now sits with the
        date instead of off on the left edge.
      */}
      <div className="timings-context">
        {state.details && (
          <div className="prayer-meta">
            <h2>{state.details.date}</h2>
            <p>{state.details.hijriDate}</p>
          </div>
        )}
        <div className="timings-location">
          <span className="timings-location-kicker">Location</span>
          <FormSelect
            id="timings-location"
            className="timings-location-picker"
            ariaLabel="Select location"
            placeholder={state.loading ? 'Loading…' : 'Choose a city'}
            value={state.location || ''}
            disabled={state.loading}
            onChange={changeLocation}
            options={locationOptions}
            compact
          />
        </div>
      </div>

      {state.loading && !state.details ? (
        <Loader variant="inline" label="Loading prayer times" />
      ) : state.details ? (
        <div className="prayer-grid">
          {state.details.prayerTimes.map((prayer, i) => (
            <div className="prayer-card" key={`${prayer.timeType}-${i}`}>
              <div className="prayer-name">{prayer.timeType}</div>
              <div className="prayer-time">{prayer.time}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="container1"><p className="post-empty">{error || 'No prayer times available.'}</p></div>
      )}
    </>
  );
}
