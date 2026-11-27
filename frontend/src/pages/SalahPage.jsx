import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { salah as api } from '../services/api';
import { useSession } from '../hooks/useSession.jsx';
import { useToast } from '../components/ToastProvider';
import Loader from '../components/Loader';
import DateField from '../components/DateField';
import FormSelect from '../components/FormSelect';
import { localDateKey } from '../utils/date';

const CORE_PRAYERS = ['Fajr', 'Zuhur', 'Asar', 'Magrib', 'Isha'];

// The stored values predate the landing page's transliterations. Keep the
// stored API names and show the familiar English spellings.
const PRAYER_LABELS = {
  Fajr: 'Fajr',
  Zuhur: 'Dhuhr',
  Asar: 'Asr',
  Magrib: 'Maghrib',
  Isha: 'Isha',
};

// Friday's midday prayer is Jumu'ah. The stored name stays "Zuhur" so history
// and counts are unaffected; only the label shown to the reader changes.
function prayerLabel(prayer, dateKey) {
  if (prayer === 'Zuhur') {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    if (new Date(y, m - 1, d).getDay() === 5) return 'Jummah';
  }
  return PRAYER_LABELS[prayer] || prayer;
}

// Only drives the row's icon and color - the displayed text is always the
// exact value the reader logged ("In Jamath" stays "In Jamath"), never a
// paraphrase.
const STATUS_META = {
  'In Jamath': { key: 'jamah', icon: 'groups' },
  'On Time': { key: 'ontime', icon: 'check_circle' },
  Late: { key: 'late', icon: 'schedule' },
  'Not Prayed': { key: 'missed', icon: 'cancel' },
  // The older form offered "others" and a few entries still carry it, so the
  // value stays selectable and keeps its own neutral icon.
  others: { key: 'other', icon: 'more_horiz' },
};

const EMPTY_STATUS = { key: 'empty', icon: 'radio_button_unchecked' };

// The row itself is the control: every prayer offers the same choices, and
// "Not logged" clears an entry so a tap can be undone without a separate form.
const STATUS_OPTIONS = [
  { value: '', label: 'Not logged' },
  { value: 'In Jamath', label: 'In Jamath' },
  { value: 'On Time', label: 'On Time' },
  { value: 'Late', label: 'Late' },
  { value: 'Not Prayed', label: 'Not Prayed' },
  { value: 'others', label: 'Others' },
];

function SalahRing({ completed, total }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = Math.max(Number(total) || 0, 1);
  const progress = Math.min(Math.max(Number(completed) || 0, 0), safeTotal) / safeTotal;

  return (
    <div className="salah-ring" role="img" aria-label={`${completed} of ${total} prayers logged`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="salah-ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-fill-2)" />
            <stop offset="1" stopColor="#e6bd74" />
          </linearGradient>
        </defs>
        <circle className="salah-ring-track" cx="60" cy="60" r={radius} />
        <circle
          className="salah-ring-fill" cx="60" cy="60" r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <div className="salah-ring-label">
        <strong>{completed}</strong>
        <span>/ {total}</span>
        <em>prayers</em>
      </div>
    </div>
  );
}

// Salah is account-only. Its overview shows the selected day's report, and
// choosing a status writes that prayer immediately - there is no second form.
export default function SalahPage() {
  const { isLoggedIn } = useSession();
  const toast = useToast();

  // Local calendar day, not UTC: a reader east of UTC was opening the tracker
  // on yesterday's date until their offset had passed.
  const [findDate, setFindDate] = useState(localDateKey);

  const [history, setHistory] = useState({ loading: true, label: '', entries: [] });
  const [savingName, setSavingName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (forDate) => {
    setHistory((h) => ({ ...h, loading: true }));
    try {
      const data = await api.list(forDate);
      setHistory({ loading: false, label: data.date, entries: data.entries || [] });
    } catch (err) {
      setHistory({ loading: false, label: '', entries: [] });
      setError('Could not load your salah history.');
    }
  }, []);

  useEffect(() => { load(findDate); }, [findDate, load]);

  // One tap per prayer. A real status is written through the existing record
  // route; "Not logged" removes the row so the day can be corrected. The API
  // returns the full log, which keeps the ring and badge in step without a
  // second GET.
  async function updateStatus(prayer, nextValue) {
    if (savingName || history.loading) return;
    const current = history.entries.find((entry) => entry.name === prayer)?.value || '';
    if (nextValue === current) return;

    setSavingName(prayer);
    setError('');
    try {
      const payload = { date: findDate, name: prayer };
      const data = nextValue
        ? await api.record({ ...payload, value: nextValue })
        : await api.clear(payload);
      setHistory((h) => ({ ...h, entries: data.entries || h.entries }));
      toast(nextValue ? `${prayerLabel(prayer, findDate)} logged` : `${prayerLabel(prayer, findDate)} cleared`);
    } catch (err) {
      setError('Could not save that change.');
    } finally {
      setSavingName('');
    }
  }

  if (isLoggedIn === null) {
    return <Loader variant="page" label="Loading Salah Tracker" />;
  }

  // Guests get the same page header + single gate as Challenges, Charity and
  // Notifications. The logging card belongs to the form only; wrapping the
  // gate in it produced a card inside a card under a "Log Salah" heading that
  // had nothing to do with the message.
  if (isLoggedIn === false) {
    return (
      <>
        <div className="page-header">
          <h1>Salah Tracker</h1>
          <p>Log and review your daily prayers</p>
        </div>
        <div className="gate-notice">
          <span className="gate-icon material-symbols-rounded" aria-hidden="true">lock</span>
          <div className="gate-body">
            <h2 className="gate-title">Sign in to log your prayers</h2>
            <p className="gate-text">
              Recording which prayers you kept is personal, so it needs an account
              to keep your history safe. Everything else stays open.
            </p>
            <div className="gate-actions">
              <a href="/login" className="btn btn-primary">Sign in to continue</a>
              <a href="/register" className="btn btn-outline">Create account</a>
            </div>
          </div>
        </div>
      </>
    );
  }

  const statusByName = new Map(history.entries.map((entry) => [entry.name, entry.value]));
  const loggedCount = CORE_PRAYERS.filter((prayer) => {
    const status = statusByName.get(prayer);
    return status && status !== 'Not Prayed';
  }).length;

  return (
    <>
      <div className="page-header page-header-with-action">
        <div>
          <h1>Salah Tracker</h1>
          <p>Log and review your daily prayers</p>
        </div>
        {isLoggedIn && <Link className="btn btn-outline" to="/stats">View detailed stats</Link>}
      </div>

      {isLoggedIn && (
        <div className="container1 salah-overview is-flat">
          <div className="salah-overview-head">
            {/*
              The date itself is the selector: clicking the day label (the
              arrow marks it as changeable) opens the app's own calendar and
              loads whichever day is picked - the same selection the old
              history card offered, without the duplicate card.
            */}
            <div className="salah-overview-day">
              <span className="salah-overview-kicker">Selected day</span>
              <DateField
                id="selected-day"
                className="salah-day-picker"
                triggerIcon="expand_more"
                valueLabel={history.loading ? 'Loading…' : (history.label || 'Choose a date')}
                value={findDate}
                onChange={setFindDate}
              />
            </div>
            <span className="salah-overview-badge">{loggedCount} of 5 logged</span>
          </div>

          {error && (
            <div className="auth-alert" role="alert">
              <span className="material-symbols-rounded">error</span>
              {error}
            </div>
          )}

          <div className="salah-overview-body">
            <SalahRing completed={loggedCount} total={CORE_PRAYERS.length} />
            <div className="salah-prayer-statuses">
              {CORE_PRAYERS.map((prayer) => {
                const status = statusByName.get(prayer);
                const meta = STATUS_META[status] || EMPTY_STATUS;
                return (
                  <div className={`salah-status is-${meta.key}`} key={prayer}>
                    <span className="salah-status-icon material-symbols-rounded" aria-hidden="true">{meta.icon}</span>
                    <span className="salah-status-name">{prayerLabel(prayer, findDate)}</span>
                    {/* The value is the control: picking a status writes it
                        immediately, and "Not logged" clears the entry. */}
                    <FormSelect
                      id={`salah-status-${prayer}`}
                      className="salah-status-select"
                      ariaLabel={`${prayerLabel(prayer, findDate)} status`}
                      value={status || ''}
                      options={STATUS_OPTIONS}
                      onChange={(nextValue) => updateStatus(prayer, nextValue)}
                      disabled={Boolean(savingName) || history.loading}
                      compact
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}