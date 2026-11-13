import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useToast } from '../components/ToastProvider';
import Loader from '../components/Loader';
import FormSelect from '../components/FormSelect';
import DateField from '../components/DateField';
import LocationPicker from '../components/LocationPicker';

export default function SalahTimingsPage() {
  const toast = useToast();
  const [view, setView] = useState({
    loading: true,
    needsLocation: false,
    location: '',
    details: null,
    methods: [],
    asrSchools: [],
  });
  const [method, setMethod] = useState(3);
  const [school, setSchool] = useState(0);
  // The ISO day currently on screen. Empty means "whatever day the server
  // considers today at the saved place", which is the initial state.
  const [dateKey, setDateKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The empty state can open the same picker as the heading, so a reader with
  // no place yet is not hunting for the control above.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Date changes can overlap with the automatic re-fetch after a settings
  // save; only the newest response may update the page.
  const requestRef = useRef(0);

  const load = useCallback(async (forDate = '') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setView((current) => ({ ...current, loading: true }));
    try {
      const target = forDate
        ? `/salah-timings?date=${encodeURIComponent(forDate)}`
        : '/salah-timings';
      const data = await api.get(target);
      if (requestId !== requestRef.current) return;
      setView({
        loading: false,
        needsLocation: Boolean(data.needsLocation),
        location: data.location || '',
        details: data.details,
        methods: data.methods || [],
        asrSchools: data.asrSchools || [],
      });
      // The server answers with the settings actually in force, so the
      // selectors always show what the times above were computed with.
      setMethod(Number(data.method));
      setSchool(Number(data.school));
      setDateKey(data.dateKey || data.details?.dateKey || '');
      setError('');
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setView((current) => ({ ...current, loading: false }));
      setError('Could not load prayer times.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const busy = saving || view.loading;

  // Every change is saved before the times are re-fetched, so the setting and
  // the cards cannot disagree on the next visit. The chosen day rides along:
  // changing the method while looking at tomorrow keeps tomorrow on screen.
  async function save(patch, message) {
    setSaving(true);
    try {
      await api.post('/settings', patch);
      await load(dateKey);
      toast(message);
    } catch (err) {
      // The cards may still be showing, so the inline error slot below is not
      // always on screen; the toast is what the reader actually sees.
      toast('Could not save that change.', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function changeLocation(place) {
    // Label, coordinates and zone travel together: times are computed from the
    // coordinates, so saving the name alone would point at the wrong place.
    await save({
      location: place.label,
      locationLat: place.latitude,
      locationLng: place.longitude,
      locationTimezone: place.timezone,
    }, 'Location updated');
  }

  // Payload only: the day is never written to settings. The next visit opens
  // on whatever the server calls today again.
  function changeDate(value) {
    setDateKey(value);
    load(value);
  }

  const details = view.details;
  const schoolLabel = view.asrSchools.find((entry) => Number(entry.value) === school);
  const schoolText = schoolLabel ? (schoolLabel.short || schoolLabel.label) : (school === 1 ? 'Hanafi' : 'Standard');

  return (
    <>
      <div className="page-header">
        <h1>Salah Timings</h1>
      </div>

      {/*
        Date, place and the two calculation choices are one context block for
        the times below. The place is the selector the same way the day is on
        the Salah tracker: heading size with a trailing arrow, no field chrome,
        everything on the cards' centre line.
      */}
      <div className="timings-context">
        {/* Without a place there is no day to name yet, so the date heading and
            its Hijri line stay out of the way until one is picked. */}
        {!view.needsLocation && (
          <div className="prayer-meta">
            <DateField
              id="timings-date"
              className="timings-date-picker"
              triggerIcon="expand_more"
              value={dateKey}
              valueLabel={view.loading && !details ? 'Loading…' : (details ? details.date : 'Choose a date')}
              onChange={changeDate}
            />
            {details && <p>{details.hijriDate}</p>}
          </div>
        )}

        <div className="timings-location">
          <span className="timings-location-kicker">Location</span>
          <LocationPicker
            className="timings-location-picker"
            value={view.location}
            disabled={busy}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={changeLocation}
          />
        </div>

        {view.methods.length > 0 && (
          <div className="timings-options">
            <div className="timings-option">
              <span className="timings-option-kicker">Method</span>
              <FormSelect
                id="timings-method"
                className="timings-option-select"
                ariaLabel="Calculation method"
                placeholder={busy ? 'Loading…' : 'Choose…'}
                value={String(method)}
                disabled={busy}
                onChange={(value) => save({ calculationMethod: Number(value) }, 'Calculation method updated')}
                options={view.methods.map((entry) => ({
                  value: String(entry.id),
                  label: entry.short || entry.label,
                }))}
                compact
              />
            </div>
            <div className="timings-option">
              <span className="timings-option-kicker">Asr</span>
              <FormSelect
                id="timings-asr"
                className="timings-option-select"
                ariaLabel="Asr calculation"
                placeholder={busy ? 'Loading…' : 'Choose…'}
                value={String(school)}
                disabled={busy}
                onChange={(value) => save({ asrSchool: Number(value) }, 'Asr calculation updated')}
                options={view.asrSchools.map((entry) => ({
                  value: String(entry.value),
                  label: entry.short || entry.label,
                }))}
                compact
              />
            </div>
          </div>
        )}

        {/* The compact rows only have room for short names; spell out the full
            convention underneath so "MWL" is never a mystery. */}
        {details && (details.methodName || schoolText) && (
          <p className="timings-method-note">
            {[details.methodName, `${schoolText} Asr`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {view.loading && !details ? (
        <Loader variant="inline" label="Loading prayer times" />
      ) : details ? (
        <div className="prayer-grid">
          {details.prayerTimes.map((prayer, i) => (
            <div className="prayer-card" key={`${prayer.timeType}-${i}`}>
              <div className="prayer-name">{prayer.timeType}</div>
              <div className="prayer-time">{prayer.time}</div>
            </div>
          ))}
        </div>
      ) : view.needsLocation ? (
        /* A new reader has no saved place, so the page asks for one instead of
           calculating times for a city they never chose. */
        <div className="timings-empty">
          <span className="material-symbols-rounded timings-empty-icon" aria-hidden="true">location_on</span>
          <h2 className="timings-empty-title">Choose your location</h2>
          <p className="timings-empty-text">
            Prayer times are calculated for the exact place you pick, anywhere in the world.
          </p>
          <button
            type="button"
            className="btn btn-primary timings-empty-action"
            onClick={() => setPickerOpen(true)}
          >
            Choose location
          </button>
        </div>
      ) : (
        <div className="container1"><p className="post-empty">{error || 'No prayer times available.'}</p></div>
      )}
    </>
  );
}
