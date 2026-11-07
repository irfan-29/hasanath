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

// Markup mirrors views/challenges.ejs so the shared stylesheet applies.
export default function ChallengesPage() {
  const { isLoggedIn, username } = useSession();
  const ask = useConfirm();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [completed, setCompleted] = useState([]);
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
  const [friendsMode, setFriendsMode] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState([]);

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

  async function submitStreaks() {
    setSaving(true);
    setError('');
    try {
      // completedIds + date, matching POST /api/challenges/streaks, which
      // validates the date server-side before writing anything.
      await api.saveStreaks({ completed, date });
      // Reload instead of trusting the short save response: it omits the
      // challenge name and last-updated label, which blanked the cards.
      await load();
      toast('Streaks updated');
    } catch (err) {
      setError(err.status === 400 ? 'That date could not be read.' : 'Could not update streaks.');
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    const name = draft.trim();
    if (!name) return;
    const withFriends = friendsMode && selectedFriends.length > 0;
    if (friendsMode && !withFriends) return;

    setSaving(true);
    setError('');
    setSharedError('');
    try {
      if (withFriends) {
        await sharedApi.create({ name, friends: selectedFriends });
        toast(`Challenge sent to ${selectedFriends.length} ${selectedFriends.length === 1 ? 'friend' : 'friends'}`);
      } else {
        await api.create(name);
        toast('Challenge added');
      }
      setDraft('');
      setEditing(null);
      setFriendsMode(false);
      setSelectedFriends([]);
      await load();
      if (withFriends) await loadShared();
    } catch (err) {
      if (withFriends) setSharedError('Could not send that challenge.');
      else setError('Could not add that challenge.');
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

  async function checkinShared(challenge) {
    setSharedBusy(challenge.id);
    setSharedError('');
    try {
      const result = await sharedApi.checkin(challenge.id);
      setSharedChallenges((current) => current.map((entry) => (
        entry.id === challenge.id ? result.challenge : entry
      )));
      toast(result.checkedIn ? 'Checked in for today' : 'Check-in removed');
    } catch (err) {
      setSharedError('Could not save that check-in.');
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

  function toggleFriend(handle) {
    setSelectedFriends((current) => (
      current.includes(handle)
        ? current.filter((entry) => entry !== handle)
        : [...current, handle]
    ));
  }

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

      {list.length > 0 && (
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

      {canManage && (
        <div className="post-actions challenge-add-row">
          <button type="button" className="btn btn-primary" onClick={() => { setEditing('__new__'); setDraft(''); }}>
            Add new challenge
          </button>
        </div>
      )}

      {editing && (
        <div className="container1 challenge-panel">
          <div className="form-floating">
            <input
              className="form-control"
              type="text"
              value={draft}
              autoFocus
              placeholder="Read for 20 minutes"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') creating ? create() : saveEdit(); }}
            />
            <label>Challenge</label>
          </div>

          {/* A new challenge can be personal or shared. The friend picker is
              hidden while renaming: the participants of an existing challenge
              are not something an edit changes. */}
          {creating && (
            <div className="friend-picker">
              <label className="friend-picker-toggle">
                <input
                  type="checkbox"
                  checked={friendsMode}
                  onChange={(e) => {
                    setFriendsMode(e.target.checked);
                    if (!e.target.checked) setSelectedFriends([]);
                  }}
                />
                <span>Challenge your friends</span>
              </label>

              {friendsMode && (
                friendList.length === 0 ? (
                  <p className="friend-picker-empty">
                    Add friends from the <Link to="/notifications">Notifications</Link> tab first.
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
                )
              )}
            </div>
          )}

          <div className="new-task" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-success"
              disabled={saving || (creating && friendsMode && selectedFriends.length === 0)}
              onClick={() => (creating ? create() : saveEdit())}
            >
              {creating ? 'Add' : 'Save'}
            </button>
            <button type="button" className="btn btn-outline" style={{ marginLeft: '0.5rem' }}
              onClick={() => { setEditing(null); setDraft(''); setFriendsMode(false); setSelectedFriends([]); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="auth-alert" role="alert"><span className="material-symbols-rounded">error</span>{error}</div>}

      <div className="container1 challenge-panel is-flat">
        {canManage && (
          <DateField
            id="challenge-date"
            label="Date"
            value={date}
            onChange={(nextDate) => { setDate(nextDate); setCompleted([]); }}
          />
        )}

        <div className="challenge-list" style={{ marginTop: '1.25rem' }}>
          {list.length === 0 && (
            <div className="challenge-empty-state">
              <span className="challenge-empty-icon material-symbols-rounded" aria-hidden="true">local_fire_department</span>
              <strong>Start with one small habit.</strong>
              <p>{canManage
                ? 'Add a challenge above, then check in each day to build your streak.'
                : 'No challenges have been added yet.'}</p>
            </div>
          )}

          {list.map((challenge, i) => {
            const isDone = completed.includes(String(challenge._id));
            const streak = Number(challenge.currentStreak) || 0;
            const best = Number(challenge.maxStreak) || 0;
            return (
              <article
                className={`challenge-card${isDone ? ' is-done' : ''}`}
                data-challenge-id={challenge._id}
                key={challenge._id}
              >
                {canManage && (
                  <label className="challenge-check">
                    <input
                      type="checkbox"
                      checked={isDone}
                      aria-label={`Mark ${challenge.challenge} complete for this date`}
                      onChange={(e) => setCompleted((current) => e.target.checked
                        ? [...current, String(challenge._id)]
                        : current.filter((id) => id !== String(challenge._id)))}
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
                      <span className="challenge-card-eyebrow">Challenge</span>
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
                  <div className="challenge-card-stats">
                    <span className="streak-badge">
                      <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
                      {streak} day streak
                    </span>
                    <span className="challenge-best-badge">Best {best}</span>
                    <span className="challenge-meta">Last updated: {challenge.lastUpdated || '—'}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {canManage && list.length > 0 && (
          <div className="new-task" style={{ marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-success" onClick={submitStreaks} disabled={saving}>
              {saving ? 'Saving…' : 'Update Streaks'}
            </button>
          </div>
        )}
      </div>

      {sharedError && (
        <div className="auth-alert" role="alert">
          <span className="material-symbols-rounded">error</span>
          {sharedError}
        </div>
      )}

      {sharedChallenges.length > 0 && (
        <section className="friend-challenge-section">
          <div className="friend-challenge-head">
            <h2>Friends’ challenges</h2>
            <p>Shared streaks. Check in daily and see where you stand.</p>
          </div>

          <div className="friend-challenge-list">
            {sharedChallenges.map((challenge) => (
              <FriendChallengeCard
                key={challenge.id}
                challenge={challenge}
                busy={sharedBusy === challenge.id}
                onCheckin={checkinShared}
                onRespond={respondShared}
                onRemove={removeShared}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// One shared challenge: invitation controls while pending, streak + leaderboard
// once accepted.
function FriendChallengeCard({ challenge, busy, onCheckin, onRespond, onRemove }) {
  const { username } = useSession();
  const pending = Boolean(challenge.me && challenge.me.status === 'pending');
  const mine = challenge.me || {};
  const creatorIsYou = challenge.creator.username === username;

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
        </div>
        {!pending && (
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

      {pending ? (
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
          <div className="friend-challenge-meta">
            <span className="streak-badge">
              <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
              {mine.currentStreak || 0} day streak
            </span>
            <span className="challenge-best-badge">Best {mine.maxStreak || 0}</span>
            <button
              type="button"
              className={`btn btn-sm ${mine.checkedInToday ? 'btn-outline' : 'btn-success'}`}
              disabled={busy}
              aria-pressed={Boolean(mine.checkedInToday)}
              onClick={() => onCheckin(challenge)}
            >
              {mine.checkedInToday ? 'Checked in today' : 'Check in today'}
            </button>
          </div>

          <div className="leaderboard">
            <div className="leaderboard-head">
              <span>Leaderboard</span>
              <span>Streak</span>
            </div>
            {challenge.leaderboard.map((entry) => (
              <div className={`leaderboard-row${entry.isYou ? ' is-you' : ''}`} key={entry.id}>
                <span className="leaderboard-rank">{entry.rank}</span>
                <span className="leaderboard-player">
                  <span className="friend-avatar" aria-hidden="true">
                    {entry.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="leaderboard-name">
                    {entry.username}
                    {entry.isYou && <span className="leaderboard-you">You</span>}
                  </span>
                </span>
                <span className="leaderboard-streak">
                  {entry.currentStreak}<span className="leaderboard-unit">d</span>
                </span>
              </div>
            ))}
          </div>

          {challenge.invited.length > 0 && (
            <p className="friend-challenge-invited">
              Waiting on {challenge.invited.map((entry) => entry.username).join(', ')}.
            </p>
          )}
        </>
      )}
    </article>
  );
}
