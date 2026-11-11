import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  challenges as api,
  friendChallenges as sharedApi,
  friends as friendsApi,
} from '../services/api';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useSession } from '../hooks/useSession.jsx';
import Loader from '../components/Loader';
import DateField from '../components/DateField';
import FormSelect from '../components/FormSelect';

// Shared-challenge days are ISO keys chosen by the server. Parsing at noon
// keeps a key on the same calendar day wherever the browser sits, and the day
// strip only ever renders keys the server sent, so the client never decides
// what can be marked.
const isoDay = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDay = (key) => new Date(`${key}T12:00:00`);
const shortDay = (key) => parseDay(key).toLocaleDateString('en-US', { weekday: 'short' });
const dayNumber = (key) => parseDay(key).getDate();
const dayFull = (key) => parseDay(key).toLocaleDateString('en-US', {
  weekday: 'long', month: 'short', day: 'numeric',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const shiftKey = (key, days) => {
  const date = parseDay(key);
  date.setDate(date.getDate() + days);
  return isoDay(date);
};
const daysBetweenKeys = (start, end) => Math.round((parseDay(end) - parseDay(start)) / DAY_MS);
// A challenge may start today or up to six days ago: those are the days a
// check-in can still repair. Future starts are allowed because the card simply
// waits for its first day.
const earliestStartKey = () => shiftKey(isoDay(), -6);
const formatWindowDay = (key) => parseDay(key).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
});
const PERIOD_OPTIONS = [
  { value: '10', label: '10 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'custom', label: 'Custom end date' },
];
// The last day of a preset window. Ten days from the 11th is the 20th, so the
// start day counts as day one.
const windowEnd = (start, period) => (
  !start || period === 'custom' ? '' : shiftKey(start, Number(period) - 1)
);
const DATE_ERROR_MESSAGES = {
  'invalid-start': 'Pick a valid start date.',
  'start-too-old': 'A challenge can start today or up to 6 days ago.',
  'invalid-period': 'Choose a 10, 30 or 90 day period, or a custom end date.',
  'invalid-end': 'Pick a valid end date.',
  'end-before-start': 'The end date cannot be before the start date.',
  'period-too-long': 'That challenge is too long.',
};

// The same window line on personal and friends' cards, so a challenge reads the
// same wherever it appears.
function ChallengeWindowLine({ startDate, endDate, status, daysRemaining }) {
  if (!startDate && !endDate) return null;
  let state = '';
  if (status === 'upcoming') state = 'Not started';
  else if (status === 'ended') state = 'Ended';
  else if (typeof daysRemaining === 'number') {
    state = daysRemaining <= 1 ? 'Last day' : `${daysRemaining} days left`;
  }
  const tone = status === 'ended' ? ' is-ended' : status === 'upcoming' ? ' is-upcoming' : '';
  return (
    <p className="challenge-window">
      <span className="material-symbols-rounded" aria-hidden="true">calendar_month</span>
      <span className="challenge-window-dates">
        {startDate ? formatWindowDay(startDate) : '—'}
        {endDate ? ` – ${formatWindowDay(endDate)}` : ''}
      </span>
      {state && <span className={`challenge-window-state${tone}`}>{state}</span>}
    </p>
  );
}

// Markup mirrors views/challenges.ejs so the shared stylesheet applies.
export default function ChallengesPage() {
  const { isLoggedIn, username } = useSession();
  const ask = useConfirm();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  // Each personal card checks in on its own, so the busy id identifies the card
  // being written rather than blocking the whole page.
  const [checkinBusy, setCheckinBusy] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Shared-with-friends state. Kept apart from the personal list because it is
  // served by a different document and can fail without taking the page down.
  const [friendList, setFriendList] = useState([]);
  const [sharedChallenges, setSharedChallenges] = useState([]);
  const [sharedBusy, setSharedBusy] = useState('');
  const [sharedError, setSharedError] = useState('');
  // The page is split the same way the profile is: your own streaks, and the
  // ones you share. The active tab also decides what a new challenge becomes.
  const [tab, setTab] = useState('self');
  const [selectedFriends, setSelectedFriends] = useState([]);
  // One-time challenges skip streak math and land under a hidden
  // "Completed" tab once they are done, so a single task can be reused
  // without cluttering the active list.
  const [oneTimeChallenge, setOneTimeChallenge] = useState(false);
  // The window for a new challenge. Preset periods produce an end date on the
  // server; "custom" sends the chosen end date instead.
  const [startDate, setStartDate] = useState(isoDay());
  const [period, setPeriod] = useState('30');
  const [endDate, setEndDate] = useState('');
  const [dateError, setDateError] = useState('');
  // Editing a shared challenge adds late friends; only the creator sees it.
  const [editingShared, setEditingShared] = useState(null);
  const [sharedDraft, setSharedDraft] = useState('');
  const [sharedSelected, setSharedSelected] = useState([]);
  const [sharedSaving, setSharedSaving] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.list();
      setList(data.challenges || []);
      setCanManage(Boolean(data.canManage));
    } catch (err) {
      setError('Could not load your challenges.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadShared = useCallback(async () => {
    try {
      const [friends, shared] = await Promise.all([
        friendsApi.list(),
        sharedApi.list(),
      ]);
      setFriendList(friends.friends || []);
      setSharedChallenges(shared.challenges || []);
    } catch (err) {
      // The friends module is additive: a failure must not hide personal
      // challenges that loaded fine.
      setSharedError('Could not load your friends’ challenges.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isLoggedIn) loadShared();
  }, [isLoggedIn, loadShared]);

  // isLoggedIn is null until /api/session resolves. Rendering the list during
  // that window showed signed-out visitors "No challenges yet" instead of the
  // sign-in gate - the empty state silently answered a question the page had
  // not been told yet. Wait rather than guess.
  if (isLoggedIn === null) {
    return (
      <>
        <div className="page-header">
          <h1>Challenges</h1>
          <p>Build habits and track your streaks</p>
        </div>
        <Loader variant="inline" label="Loading challenges" />
      </>
    );
  }

  // Guests see the gate; the checkbox controls are not rendered at all rather
  // than rendered disabled, so there is nothing to accidentally submit.
  if (isLoggedIn === false) {
    return (
      <>
        <div className="page-header">
          <h1>Challenges</h1>
          <p>Build habits and track your streaks</p>
        </div>
        <div className="gate-notice">
          <span className="gate-icon material-symbols-rounded" aria-hidden="true">lock</span>
          <div className="gate-body">
            <h2 className="gate-title">Sign in to manage challenges</h2>
            <p className="gate-text">
              Adding, editing and deleting challenges needs an account so your streaks
              are saved to you and not lost. You can still browse everything else.
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

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Challenges</h1>
          <p>Build habits and track your streaks</p>
        </div>
        <Loader variant="inline" label="Loading challenges" />
      </>
    );
  }

  // A personal check-in names one card and (optionally) one day. The server
  // owns the 7-day window, so a 400 here is always the window message.
  async function checkinSelf(challenge, day) {
    const forToday = !day || day === isoDay();
    const id = String(challenge._id);
    setCheckinBusy(id);
    setError('');
    try {
      const result = await api.checkin(id, day);
      setList(result.challenges || []);
      if (result.checkedIn) {
        toast(forToday ? 'Checked in for today' : `Logged for ${dayFull(day)}`);
      } else {
        toast(forToday ? 'Today’s check-in removed' : `Removed ${dayFull(day)}`, { kind: 'delete' });
      }
    } catch (err) {
      setError(err.status === 400
        ? 'That day is outside the 7-day check-in window.'
        : 'Could not save that check-in.');
    } finally {
      setCheckinBusy('');
    }
  }

  // One-time tasks are a single completion, not a streak, but they still go
  // through the same per-card route so no other challenge is reset.
  async function completeOneTime(challenge) {
    const id = String(challenge._id);
    setCheckinBusy(id);
    setError('');
    try {
      const result = await api.checkin(id);
      setList(result.challenges || []);
      if (result.checkedIn) {
        setCompletedOpen(true);
        toast('Task completed');
      } else {
        toast('Task reopened', { kind: 'delete' });
      }
    } catch (err) {
      setError('Could not update that task.');
    } finally {
      setCheckinBusy('');
    }
  }

  // Reset the create form's window whenever it opens, closes or switches tabs.
  function resetWindow() {
    setStartDate(isoDay());
    setPeriod('30');
    setEndDate('');
    setDateError('');
    setOneTimeChallenge(false);
  }

  function chooseStartDate(next) {
    setStartDate(next);
    setDateError('');
    // Keep a custom end from landing before the new start.
    if (period === 'custom' && endDate && endDate < next) setEndDate(next);
  }

  function choosePeriod(next) {
    setPeriod(next);
    setDateError('');
    // A custom window needs a concrete date to edit, so seed it with the same
    // 30-day default the preset offers.
    if (next === 'custom' && !endDate) setEndDate(shiftKey(startDate, 29));
  }

  // Mirrors the server's rules so the user sees the problem before a request.
  function validateWindow() {
    if (!startDate) return 'Pick a start date.';
    if (startDate < earliestStartKey()) return 'A challenge can start today or up to 6 days ago.';
    if (period === 'custom') {
      if (!endDate) return 'Pick an end date, or choose a preset period.';
      if (endDate < startDate) return 'The end date cannot be before the start date.';
      if (daysBetweenKeys(startDate, endDate) > 3660) return 'That challenge is too long.';
    }
    return '';
  }

  async function create() {
    const name = draft.trim();
    if (!name) return;
    const withFriends = tab === 'friends';
    if (withFriends && selectedFriends.length === 0) return;

    // One-time tasks are a checkbox, not a streak, so they have no window.
    const noWindow = !withFriends && oneTimeChallenge;
    if (!noWindow) {
      const invalid = validateWindow();
      if (invalid) {
        setDateError(invalid);
        return;
      }
    }
    const windowPayload = noWindow
      ? {}
      : { startDate, period, ...(period === 'custom' ? { endDate } : {}) };

    setSaving(true);
    setError('');
    setSharedError('');
    setDateError('');
    try {
      if (withFriends) {
        await sharedApi.create({ name, friends: selectedFriends, ...windowPayload });
        toast(`Challenge sent to ${selectedFriends.length} ${selectedFriends.length === 1 ? 'friend' : 'friends'}`);
      } else {
        await api.create({ name, oneTime: oneTimeChallenge, ...windowPayload });
        setOneTimeChallenge(false);
        toast('Challenge added');
      }
      setDraft('');
      setEditing(null);
      setSelectedFriends([]);
      resetWindow();
      if (withFriends) await loadShared();
      else await load();
    } catch (err) {
      const message = err.status === 400 && err.body && DATE_ERROR_MESSAGES[err.body.error];
      if (message) {
        setDateError(message);
      } else if (withFriends) {
        setSharedError('Could not send that challenge.');
      } else {
        setError('Could not add that challenge.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    const name = draft.trim();
    if (!name || !editing) return;
    setSaving(true);
    try {
      await api.rename(editing, name);
      setEditing(null);
      setDraft('');
      await load();
      toast('Challenge renamed');
    } catch (err) {
      setError('Could not rename that challenge.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    // Same confirmation the EJS form used, so the destructive action is never
    // one stray click away - now as an in-app dialog instead of a browser
    // alert, which the installed app cannot show.
    const ok = await ask({
      title: 'Delete this challenge?',
      message: 'Its check-in history goes with it.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await api.remove(id);
      await load();
      toast('Challenge deleted', { kind: 'delete' });
    } catch (err) {
      setError('Could not delete that challenge.');
    }
  }

  // ---- Shared challenges ---------------------------------------------------

  async function respondShared(challenge, action) {
    setSharedBusy(challenge.id);
    setSharedError('');
    try {
      const result = await sharedApi.respond(challenge.id, action);
      if (action === 'decline') {
        setSharedChallenges((current) => current.filter((entry) => entry.id !== challenge.id));
        toast('Invitation declined', { kind: 'delete' });
      } else {
        setSharedChallenges((current) => current.map((entry) => (
          entry.id === challenge.id ? result.challenge : entry
        )));
        toast('Challenge joined');
      }
    } catch (err) {
      setSharedError('Could not update that invitation.');
    } finally {
      setSharedBusy('');
    }
  }

  async function checkinShared(challenge, date) {
    const forToday = !date || date === isoDay();
    setSharedBusy(challenge.id);
    setSharedError('');
    try {
      const result = await sharedApi.checkin(challenge.id, date);
      setSharedChallenges((current) => current.map((entry) => (
        entry.id === challenge.id ? result.challenge : entry
      )));
      if (result.checkedIn) {
        toast(forToday ? 'Checked in for today' : `Logged for ${dayFull(date)}`);
      } else {
        toast(forToday ? 'Today’s check-in removed' : `Removed ${dayFull(date)}`, { kind: 'delete' });
      }
    } catch (err) {
      setSharedError(err.status === 400
        ? 'That day is outside the 7-day check-in window.'
        : 'Could not save that check-in.');
    } finally {
      setSharedBusy('');
    }
  }

  async function removeShared(challenge) {
    const deleting = challenge.creator.username === username;
    const ok = await ask({
      title: deleting ? 'Delete this challenge?' : 'Leave this challenge?',
      message: deleting
        ? 'It disappears for everyone and its streaks go with it.'
        : 'Your streak in this challenge goes with you.',
      confirmLabel: deleting ? 'Delete' : 'Leave',
      danger: true
    });
    if (!ok) return;

    setSharedBusy(challenge.id);
    setSharedError('');
    try {
      await sharedApi.remove(challenge.id);
      setSharedChallenges((current) => current.filter((entry) => entry.id !== challenge.id));
      toast(deleting ? 'Challenge deleted' : 'You left the challenge', { kind: 'delete' });
    } catch (err) {
      setSharedError('Could not update that challenge.');
    } finally {
      setSharedBusy('');
    }
  }

  function startEditShared(challenge) {
    setEditingShared(challenge.id);
    setSharedDraft(challenge.name);
    setSharedSelected([]);
    setSharedError('');
  }

  function cancelSharedEdit() {
    setEditingShared(null);
    setSharedDraft('');
    setSharedSelected([]);
  }

  function toggleSharedFriend(handle) {
    setSharedSelected((current) => (
      current.includes(handle)
        ? current.filter((entry) => entry !== handle)
        : [...current, handle]
    ));
  }

  async function saveSharedEdit(challenge) {
    const name = sharedDraft.trim();
    if (!name) return;
    const invitedCount = sharedSelected.length;
    setSharedSaving(true);
    setSharedError('');
    try {
      const result = await sharedApi.update(challenge.id, { name, friends: sharedSelected });
      setSharedChallenges((current) => current.map((entry) => (
        entry.id === challenge.id ? result.challenge : entry
      )));
      cancelSharedEdit();
      toast(invitedCount > 0
        ? `Challenge updated · ${invitedCount} invite${invitedCount === 1 ? '' : 's'} sent`
        : 'Challenge updated');
    } catch (err) {
      setSharedError(err.status === 400
        ? 'Give the challenge a name before saving.'
        : 'Could not update that challenge.');
    } finally {
      setSharedSaving(false);
    }
  }

  function toggleFriend(handle) {
    setSelectedFriends((current) => (
      current.includes(handle)
        ? current.filter((entry) => entry !== handle)
        : [...current, handle]
    ));
  }

  function selectTab(next) {
    if (next === tab) return;
    setTab(next);
    // An editor opened for one kind of challenge does not belong in the other.
    setEditing(null);
    setDraft('');
    setSelectedFriends([]);
    setEditingShared(null);
    setSharedDraft('');
    setSharedSelected([]);
    resetWindow();
    setError('');
    setSharedError('');
  }

  const selfTasks = list.filter((item) => item.kind !== 'shared');
  const activeTasks = selfTasks.filter((item) => !item.oneTime || !item.completed);
  const completedTasks = selfTasks.filter((item) => item.oneTime && item.completed);

  const bestCurrent = list.reduce((best, item) => Math.max(best, Number(item.currentStreak) || 0), 0);
  const bestEver = list.reduce((best, item) => Math.max(best, Number(item.maxStreak ?? item.currentStreak) || 0), 0);
  const activeCount = list.filter((item) => (Number(item.currentStreak) || 0) > 0).length;

  const creating = editing === '__new__';

  return (
    <>
      <div className="page-header page-header-with-action">
        <div>
          <h1>Challenges</h1>
          <p>Build habits and track your streaks</p>
        </div>
        <Link className="btn btn-outline" to="/stats">View detailed stats</Link>
      </div>

      <div className="challenge-tabs" role="tablist" aria-label="Challenge type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'self'}
          className={`challenge-tab${tab === 'self' ? ' is-active' : ''}`}
          onClick={() => selectTab('self')}
        >
          <span className="material-symbols-rounded" aria-hidden="true">task_alt</span>
          My challenges
          <span className="challenge-tab-count">{list.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'friends'}
          className={`challenge-tab${tab === 'friends' ? ' is-active' : ''}`}
          onClick={() => selectTab('friends')}
        >
          <span className="material-symbols-rounded" aria-hidden="true">group</span>
          Friends
          <span className="challenge-tab-count">{sharedChallenges.length}</span>
        </button>
      </div>


      {tab === 'self' && list.length > 0 && (
        <div className="challenge-consistency">
          <div className="challenge-consistency-head">
            <span className="challenge-consistency-eyebrow">Consistency</span>
            <span className="challenge-consistency-pill">
              {bestEver} {bestEver === 1 ? 'day' : 'days'} best
            </span>
          </div>
          <div className="challenge-consistency-body">
            <span className="challenge-consistency-flame material-symbols-rounded" aria-hidden="true">
              local_fire_department
            </span>
            <div className="challenge-consistency-copy">
              <strong>{bestCurrent}</strong>
              <span>day streak</span>
            </div>
            <div className="challenge-consistency-meta">
              <span>{list.length} {list.length === 1 ? 'challenge' : 'challenges'}</span>
              <span>{activeCount} active</span>
            </div>
          </div>
          <p className="challenge-consistency-hint">Small and steady beats big and brief.</p>
        </div>
      )}

      {tab === 'self' && canManage && (
        <div className="post-actions challenge-add-row">
          <button type="button" className="btn btn-primary" onClick={() => { setEditing('__new__'); setDraft(''); resetWindow(); }}>
            Add new challenge
          </button>
        </div>
      )}

      {editing && (
        <div className="container1 challenge-panel">
          <div className="form-floating">
            <input
              className="form-control form-control-sm"
              type="text"
              value={draft}
              autoFocus
              placeholder="Read for 20 minutes"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') creating ? create() : saveEdit(); }}
            />
            <label>Challenge</label>
          </div>

          {/* The window is fixed when the challenge is created: moving it
              later would leave check-ins outside their own dates. */}
          {creating && !(tab === 'self' && oneTimeChallenge) && (
            <div className="challenge-window-form">
              <div className="salah-form-grid">
                <DateField
                  id="challenge-start"
                  label="Start date"
                  value={startDate}
                  min={earliestStartKey()}
                  onChange={chooseStartDate}
                />
                <FormSelect
                  id="challenge-period"
                  label="Challenge period"
                  value={period}
                  options={PERIOD_OPTIONS}
                  onChange={choosePeriod}
                />
                {period === 'custom' && (
                  <DateField
                    id="challenge-end"
                    label="End date"
                    value={endDate}
                    min={startDate}
                    onChange={(next) => { setEndDate(next); setDateError(''); }}
                  />
                )}
              </div>
              <p className="challenge-form-hint">
                {period === 'custom'
                  ? 'Choose any end date on or after the start date.'
                  : `Runs ${formatWindowDay(startDate)} – ${formatWindowDay(windowEnd(startDate, period))}.`}
                {' '}Start today, up to 6 days ago, or in the future.
              </p>
              {dateError && (
                <p className="challenge-form-error" role="alert">{dateError}</p>
              )}
            </div>
          )}

          {creating && tab === 'self' && (
            <div>
              <label className="challenge-type-toggle" htmlFor="one-time-checkbox">
                <input
                  id="one-time-checkbox"
                  type="checkbox"
                  checked={oneTimeChallenge}
                  onChange={(e) => setOneTimeChallenge(e.target.checked)}
                />
                <span>One-time task</span>
              </label>
              <span className="help-text">Done tasks move to Completed and do not keep a streak.</span>
            </div>
          )}


          {/* The tab chooses the kind: your own streak, or one shared with
              friends. The picker stays hidden while renaming because the
              participants of an existing challenge are not part of an edit. */}
          {creating && tab === 'friends' && (
            <div className="friend-picker">
              <span className="friend-picker-title">Invite friends</span>
              {friendList.length === 0 ? (
                <p className="friend-picker-empty">
                  Add friends from <Link to={`/u/${username}`}>your profile</Link> first, then invite them here.
                </p>
              ) : (
                <div className="friend-picker-list">
                  {friendList.map((friend) => (
                    <label className="friend-picker-option" key={friend.id}>
                      <input
                        type="checkbox"
                        checked={selectedFriends.includes(friend.username)}
                        onChange={() => toggleFriend(friend.username)}
                      />
                      <span className="friend-avatar" aria-hidden="true">
                        {friend.username.charAt(0).toUpperCase()}
                      </span>
                      <span className="friend-picker-name">{friend.username}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="challenge-form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || (creating && tab === 'friends' && selectedFriends.length === 0)}
              onClick={() => (creating ? create() : saveEdit())}
            >
              {creating ? 'Add' : 'Save'}
            </button>
            <button type="button" className="btn btn-outline"
              onClick={() => { setEditing(null); setDraft(''); setSelectedFriends([]); resetWindow(); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tab === 'self' && error && (
        <div className="auth-alert" role="alert">
          <span className="material-symbols-rounded">error</span>
          {error}
        </div>
      )}

      {tab === 'self' && (
        <div className="container1 challenge-panel is-flat">
          <div className="challenge-list">
            {activeTasks.length === 0 && completedTasks.length === 0 && (
              <div className="challenge-empty-state">
                <span className="challenge-empty-icon material-symbols-rounded" aria-hidden="true">local_fire_department</span>
                <strong>Start with one small habit.</strong>
                <p>{canManage
                  ? 'Add a challenge above, then check in each day to build your streak.'
                  : 'No challenges have been added yet.'}</p>
              </div>
            )}

            {activeTasks.map((challenge, i) => {
              const isOneTime = Boolean(challenge.oneTime);
              const streak = Number(challenge.currentStreak) || 0;
              const best = Number(challenge.maxStreak) || 0;
              const busy = checkinBusy === String(challenge._id);
              // Legacy cards have no status field; they behave as active.
              const status = challenge.status || 'active';
              return (
                <article
                  className={`challenge-card${challenge.checkedInToday ? ' is-done' : ''}${isOneTime ? ' is-one-time' : ''}`}
                  data-challenge-id={challenge._id}
                  key={challenge._id}
                >
                  {canManage && isOneTime && (
                    <label className="challenge-check">
                      <input
                        type="checkbox"
                        checked={Boolean(challenge.completed)}
                        aria-label={`Mark ${challenge.challenge} complete`}
                        disabled={busy}
                        onChange={() => completeOneTime(challenge)}
                        id={`challenge_${i}`}
                      />
                      <span className="challenge-check-box" aria-hidden="true">
                        <span className="material-symbols-rounded">check</span>
                      </span>
                    </label>
                  )}
                  <div className="challenge-info">
                    <div className="challenge-header-row">
                      <div className="challenge-title-block">
                        <span className="challenge-card-eyebrow">{isOneTime ? 'One-time task' : 'Challenge'}</span>
                        <strong className="challenge-card-title">{challenge.challenge}</strong>
                      </div>
                      {canManage && (
                        <div className="challenge-actions">
                          <button
                            type="button"
                            className="challenge-icon-btn challenge-icon-btn-edit"
                            aria-label="Edit challenge"
                            title="Edit"
                            onClick={() => { setEditing(String(challenge._id)); setDraft(challenge.challenge); }}
                          >
                            <span className="material-symbols-rounded" aria-hidden="true">edit</span>
                          </button>
                          <button
                            type="button"
                            className="challenge-icon-btn challenge-icon-btn-danger"
                            aria-label="Delete challenge"
                            title="Delete"
                            onClick={() => remove(challenge._id)}
                          >
                            <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {!isOneTime && (
                      <ChallengeWindowLine
                        startDate={challenge.startDate}
                        endDate={challenge.endDate}
                        status={status}
                        daysRemaining={challenge.daysRemaining}
                      />
                    )}

                    {isOneTime ? (
                      <div className="challenge-card-stats">
                        <span className="challenge-meta">No streak · check to complete</span>
                        <span className="challenge-meta">Last updated: {challenge.lastUpdated || '—'}</span>
                      </div>
                    ) : (
                      <>
                        <div className="challenge-checkin-meta">
                          <span className="streak-badge">
                            <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
                            {streak} day streak
                          </span>
                          <span className="challenge-best-badge">Best {best}</span>
                          {canManage && status === 'active' && (
                            <button
                              type="button"
                              className={`btn btn-sm ${challenge.checkedInToday ? 'btn-outline' : 'btn-primary'}`}
                              disabled={busy}
                              aria-pressed={Boolean(challenge.checkedInToday)}
                              title={challenge.checkedInToday ? 'Undo today’s check-in' : 'Mark today complete'}
                              onClick={() => checkinSelf(challenge)}
                            >
                              {challenge.checkedInToday ? 'Checked in today' : 'Check in today'}
                            </button>
                          )}
                        </div>

                        {canManage && Array.isArray(challenge.recentDays) && challenge.recentDays.length > 0 && (
                          <div className="challenge-backfill">
                            <div className="backfill-head">
                              <span className="backfill-title">Catch up on the week</span>
                              <span className="backfill-hint">Tap a day to log or undo · last 7 days</span>
                            </div>
                            <div className="backfill-days">
                              {challenge.recentDays.map((day) => (
                                <button
                                  key={day.key}
                                  type="button"
                                  className={`backfill-day${day.checked ? ' is-done' : ''}`}
                                  aria-pressed={day.checked}
                                  aria-label={`${day.checked ? 'Remove' : 'Log'} check-in for ${dayFull(day.key)}`}
                                  title={dayFull(day.key)}
                                  disabled={busy}
                                  onClick={() => checkinSelf(challenge, day.key)}
                                >
                                  <span className="backfill-weekday">{shortDay(day.key)}</span>
                                  <span className="backfill-date">
                                    {dayNumber(day.key)}
                                    {day.checked && (
                                      <span className="material-symbols-rounded" aria-hidden="true">check</span>
                                    )}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <span className="challenge-meta challenge-last-updated">
                          Last updated: {challenge.lastUpdated || '—'}
                        </span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {completedTasks.length > 0 && (
            <section className="challenge-completed-section" aria-label="Completed one-time tasks">
              <button
                type="button"
                className="challenge-completed-toggle"
                aria-expanded={completedOpen}
                onClick={() => setCompletedOpen((v) => !v)}
              >
                <span>Completed ({completedTasks.length})</span>
                <span className="material-symbols-rounded" aria-hidden="true">
                  {completedOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {completedOpen && (
                <div className="challenge-list challenge-completed-list">
                  {completedTasks.map((challenge) => (
                    <article
                      className="challenge-card is-done is-closed"
                      data-challenge-id={challenge._id}
                      key={challenge._id}
                    >
                      <div className="challenge-info">
                        <div className="challenge-header-row">
                          <div className="challenge-title-block">
                            <span className="challenge-card-eyebrow">Completed</span>
                            <strong className="challenge-card-title">{challenge.challenge}</strong>
                          </div>
                          {canManage && (
                            <div className="challenge-actions">
                              <button
                                type="button"
                                className="challenge-icon-btn"
                                aria-label="Reopen task"
                                title="Reopen"
                                disabled={checkinBusy === String(challenge._id)}
                                onClick={() => completeOneTime(challenge)}
                              >
                                <span className="material-symbols-rounded" aria-hidden="true">undo</span>
                              </button>
                              <button
                                type="button"
                                className="challenge-icon-btn challenge-icon-btn-danger"
                                aria-label="Delete challenge"
                                title="Delete"
                                onClick={() => remove(challenge._id)}
                              >
                                <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="challenge-card-stats">
                          <span className="challenge-meta">One-time task · completed</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'friends' && (
        <>
          {sharedError && (
            <div className="auth-alert" role="alert">
              <span className="material-symbols-rounded">error</span>
              {sharedError}
            </div>
          )}

          <section className="friend-challenge-section is-tabbed">
            <div className="friend-challenge-head friend-challenge-head-row">
              <div>
                <h2>Friends’ challenges</h2>
                <p>Shared streaks. Check in daily and see where you stand.</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { setEditing('__new__'); setDraft(''); setSelectedFriends([]); resetWindow(); }}
                >
                  New challenge
                </button>
              )}
            </div>

            {friendList.length === 0 && (
              <p className="friend-challenge-note">
                <span className="material-symbols-rounded" aria-hidden="true">group</span>
                <span>
                  Add friends from <Link to={`/u/${username}`}>your profile</Link> to start one together.
                </span>
              </p>
            )}

            {sharedChallenges.length === 0 ? (
              <div className="challenge-empty-state friend-challenge-empty">
                <span className="challenge-empty-icon material-symbols-rounded" aria-hidden="true">group</span>
                <strong>No friends’ challenges yet.</strong>
                <p>Start one and invite a friend to keep each other accountable.</p>
              </div>
            ) : (
              <div className="friend-challenge-list">
                {sharedChallenges.map((challenge) => (
                  <FriendChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    busy={sharedBusy === challenge.id}
                    friends={friendList}
                    editing={editingShared === challenge.id}
                    draft={sharedDraft}
                    saving={sharedSaving}
                    selected={sharedSelected}
                    onDraftChange={setSharedDraft}
                    onToggleFriend={toggleSharedFriend}
                    onStartEdit={startEditShared}
                    onSave={saveSharedEdit}
                    onCancel={cancelSharedEdit}
                    onCheckin={checkinShared}
                    onRespond={respondShared}
                    onRemove={removeShared}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// One shared challenge: invitation controls while pending, streak + leaderboard
// once accepted.
function FriendChallengeCard({
  challenge, busy, friends = [], editing, draft, saving, selected = [],
  onDraftChange, onToggleFriend, onStartEdit, onSave, onCancel,
  onCheckin, onRespond, onRemove,
}) {
  const { username } = useSession();
  const pending = Boolean(challenge.me && challenge.me.status === 'pending');
  const status = challenge.status || 'active';
  const mine = challenge.me || {};
  const creatorIsYou = challenge.creator.username === username;
  // Existing members and pending invitees are already in the challenge; the
  // picker offers only friends who could actually be added.
  const taken = new Set([
    challenge.creator.username,
    ...challenge.leaderboard.map((entry) => entry.username),
    ...challenge.invited.map((entry) => entry.username),
  ]);
  const candidates = friends.filter((friend) => !taken.has(friend.username));

  return (
    <article className={`friend-challenge-card${pending ? ' is-pending' : ''}`}>
      <div className="friend-challenge-top">
        <div>
          <span className="challenge-card-eyebrow">
            {pending ? 'Invitation' : 'Friends’ challenge'}
          </span>
          <h3 className="friend-challenge-name">{challenge.name}</h3>
          <p className="friend-challenge-creator">
            Started by{' '}
            {creatorIsYou ? (
              'you'
            ) : (
              <Link to={`/u/${challenge.creator.username}`}>{challenge.creator.username}</Link>
            )}
            {' · '}
            {challenge.participantCount} {challenge.participantCount === 1 ? 'member' : 'members'}
          </p>
          <ChallengeWindowLine
            startDate={challenge.startDate}
            endDate={challenge.endDate}
            status={status}
            daysRemaining={challenge.daysRemaining}
          />
        </div>
        {!pending && (
          <div className="friend-challenge-top-actions">
            {creatorIsYou && !editing && (
              <button
                type="button"
                className="challenge-icon-btn challenge-icon-btn-edit"
                aria-label="Edit challenge"
                title="Edit and invite"
                disabled={busy}
                onClick={() => onStartEdit(challenge)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">edit</span>
              </button>
            )}
            {!editing && (
              <button
                type="button"
                className="challenge-icon-btn challenge-icon-btn-danger"
                aria-label={creatorIsYou ? 'Delete challenge' : 'Leave challenge'}
                title={creatorIsYou ? 'Delete' : 'Leave'}
                disabled={busy}
                onClick={() => onRemove(challenge)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  {creatorIsYou ? 'delete' : 'logout'}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <form
          className="friend-challenge-edit"
          onSubmit={(event) => { event.preventDefault(); onSave(challenge); }}
        >
          <label
            className="friend-challenge-edit-label"
            htmlFor={`friend-challenge-name-${challenge.id}`}
          >
            Challenge name
          </label>
          <input
            id={`friend-challenge-name-${challenge.id}`}
            className="form-control"
            type="text"
            value={draft}
            maxLength={80}
            onChange={(event) => onDraftChange(event.target.value)}
          />

          {challenge.startDate && challenge.endDate && (
            <p className="friend-challenge-edit-hint">
              Runs {formatWindowDay(challenge.startDate)} – {formatWindowDay(challenge.endDate)}.
              The window is fixed when the challenge is created.
            </p>
          )}

          <p className="friend-challenge-edit-hint">
            Invite friends who joined later. They will get an invitation to accept.
          </p>

          {candidates.length === 0 ? (
            <p className="friend-challenge-edit-empty">
              {friends.length === 0 ? (
                <>Add friends from <Link to={`/u/${username}`}>your profile</Link> first.</>
              ) : (
                'Everyone on your friends list is already in this challenge.'
              )}
            </p>
          ) : (
            <div className="friend-picker-list">
              {candidates.map((friend) => (
                <label className="friend-picker-option" key={friend.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(friend.username)}
                    onChange={() => onToggleFriend(friend.username)}
                  />
                  <span className="friend-avatar" aria-hidden="true">
                    {friend.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="friend-picker-name">{friend.username}</span>
                </label>
              ))}
            </div>
          )}

          <div className="challenge-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : pending ? (
        <div className="friend-challenge-pending">
          <p>Accept to join the leaderboard and start your streak.</p>
          <div className="friend-challenge-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => onRespond(challenge, 'accept')}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={busy}
              onClick={() => onRespond(challenge, 'decline')}
            >
              Decline
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="challenge-checkin-meta">
            <span className="streak-badge">
              <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
              {mine.currentStreak || 0} day streak
            </span>
            <span className="challenge-best-badge">Best {mine.maxStreak || 0}</span>
            {status === 'active' && (
              <button
                type="button"
                className={`btn btn-sm ${mine.checkedInToday ? 'btn-outline' : 'btn-primary'}`}
                disabled={busy}
                aria-pressed={Boolean(mine.checkedInToday)}
                title={mine.checkedInToday ? 'Undo today’s check-in' : 'Mark today complete'}
                onClick={() => onCheckin(challenge)}
              >
                {mine.checkedInToday ? 'Checked in today' : 'Check in today'}
              </button>
            )}
          </div>

          {Array.isArray(mine.recentDays) && mine.recentDays.length > 0 && (
            <div className="challenge-backfill">
              <div className="backfill-head">
                <span className="backfill-title">Catch up on the week</span>
                <span className="backfill-hint">Tap a day to log or undo · last 7 days</span>
              </div>
              <div className="backfill-days">
                {mine.recentDays.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    className={`backfill-day${day.checked ? ' is-done' : ''}`}
                    aria-pressed={day.checked}
                    aria-label={`${day.checked ? 'Remove' : 'Log'} check-in for ${dayFull(day.key)}`}
                    title={dayFull(day.key)}
                    disabled={busy}
                    onClick={() => onCheckin(challenge, day.key)}
                  >
                    <span className="backfill-weekday">{shortDay(day.key)}</span>
                    <span className="backfill-date">
                      {dayNumber(day.key)}
                      {day.checked && (
                        <span className="material-symbols-rounded" aria-hidden="true">check</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ChallengeLeaderboard entries={challenge.leaderboard} />

          {challenge.invited.length > 0 && (
            <p className="friend-challenge-invited">
              Waiting on{' '}
              {challenge.invited.map((entry, index) => (
                <span key={entry.id}>
                  <Link to={`/u/${entry.username}`}>{entry.username}</Link>
                  {index < challenge.invited.length - 1 ? ', ' : '.'}
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </article>
  );
}

// Top three stand on pedestals: first in the middle, second to its right, third
// to its left, each profile above its place. Ranks 4+ keep the compact list so
// a large challenge still reads at a glance.
function ChallengeLeaderboard({ entries }) {
  if (!entries || entries.length === 0) return null;
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="leaderboard-shell">
      <div className="leaderboard-head">
        <span>Leaderboard</span>
        <span>Current streak</span>
      </div>

      <ol className="podium-list" aria-label="Top three">
        {podium.map((entry) => (
          <li
            key={entry.id}
            className={`podium-slot is-rank-${entry.rank}${entry.isYou ? ' is-you' : ''}`}
            style={{ '--podium-delay': `${(entry.rank - 1) * 110}ms` }}
          >
            <div className="podium-profile">
              {entry.rank === 1 && (
                <span className="podium-crown material-symbols-rounded" aria-hidden="true">
                  emoji_events
                </span>
              )}
              <Link
                to={`/u/${entry.username}`}
                className="podium-avatar"
                aria-label={`Open ${entry.username}'s profile`}
              >
                {entry.username.charAt(0).toUpperCase()}
              </Link>
              <Link to={`/u/${entry.username}`} className="podium-name">
                <span className="podium-name-text">{entry.username}</span>
                {entry.isYou && <span className="podium-you">You</span>}
              </Link>
              <span className="podium-streak">
                <strong>{entry.currentStreak}</strong> day{entry.currentStreak === 1 ? '' : 's'}
              </span>
            </div>
            <div className="podium-base" aria-hidden="true">
              <span className="podium-place">{entry.rank}</span>
            </div>
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <div className="leaderboard leaderboard-rest" aria-label="Ranks four and below">
          {rest.map((entry) => (
            <div className={`leaderboard-row${entry.isYou ? ' is-you' : ''}`} key={entry.id}>
              <span className="leaderboard-rank">{entry.rank}</span>
              <Link
                to={`/u/${entry.username}`}
                className="leaderboard-player"
                aria-label={`Open ${entry.username}'s profile`}
              >
                <span className="friend-avatar" aria-hidden="true">
                  {entry.username.charAt(0).toUpperCase()}
                </span>
                <span className="leaderboard-name">
                  {entry.username}
                  {entry.isYou && <span className="leaderboard-you">You</span>}
                </span>
              </Link>
              <span className="leaderboard-streak">
                {entry.currentStreak}<span className="leaderboard-unit">d</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
