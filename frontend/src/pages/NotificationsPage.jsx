import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendChallenges, friends as friendsApi, notifications as notificationsApi } from '../services/api';
import { useSession } from '../hooks/useSession.jsx';
import { useUnreadNotifications } from '../hooks/useNotifications.jsx';
import { useToast } from '../components/ToastProvider';
import Loader from '../components/Loader';

// One centre for everything someone else did TO you: friend requests, shared
// challenge invitations, and the acceptance notices that follow. The phone
// header's bell and the sidebar item both point here.
//
// Friends themselves live on the profile's Friends tab, so this page stays a
// feed of events. Requests are still actionable here because answering them is
// the reason the bell lit up.

const ICONS = {
  friend_request: 'person_add',
  friend_accepted: 'groups',
  challenge_invite: 'emoji_events',
  challenge_accepted: 'local_fire_department',
  challenge_declined: 'close',
};

function timeAgo(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function NotificationsPage() {
  const { isLoggedIn, username } = useSession();
  const { refresh: refreshBadge } = useUnreadNotifications();
  const toast = useToast();

  const [feed, setFeed] = useState({ loading: true, items: [], unread: 0 });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await notificationsApi.list();
      setFeed({
        loading: false,
        items: data.items || [],
        unread: Number(data.unread) || 0,
      });
    } catch (err) {
      setFeed((current) => ({ ...current, loading: false }));
      setError('Could not load your notifications.');
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn, load]);

  // Runs one action, then reloads the feed and the badge together, so an
  // accepted request cannot leave the bell disagreeing with the list.
  async function run(key, action, success) {
    if (busy) return false;
    setBusy(key);
    setError('');
    try {
      await action();
      await load();
      await refreshBadge();
      if (success) toast(success);
      return true;
    } catch (err) {
      setError(err && err.status === 404
        ? 'That request is no longer available.'
        : 'That action could not be completed.');
      return false;
    } finally {
      setBusy('');
    }
  }

  const acceptFriend = (friendshipId) => run(
    `accept-${friendshipId}`,
    () => friendsApi.accept(friendshipId),
    'Friend request accepted'
  );

  const declineFriend = (friendshipId) => run(
    `decline-${friendshipId}`,
    () => friendsApi.decline(friendshipId),
    'Friend request declined'
  );

  const respondChallenge = (challengeId, action) => run(
    `${action}-${challengeId}`,
    () => friendChallenges.respond(challengeId, action),
    action === 'accept' ? 'Challenge joined' : 'Invitation declined'
  );

  const markAllRead = () => run('read-all', () => notificationsApi.readAll());

  async function openItem(item) {
    if (!item.read) {
      try {
        await notificationsApi.read(item.id);
        setFeed((current) => ({
          ...current,
          unread: Math.max(0, current.unread - 1),
          items: current.items.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)),
        }));
        refreshBadge();
      } catch (err) {
        // Opening the destination matters more than the read receipt.
      }
    }
  }

  // Session unknown: wait rather than flash the sign-in gate at a signed-in
  // reader. The gate below must come BEFORE the feed's loading branch, because
  // a guest never starts a feed request.
  if (isLoggedIn === null) {
    return (
      <>
        <div className="page-header">
          <h1>Notifications</h1>
          <p>Friend requests and challenge invitations</p>
        </div>
        <Loader variant="inline" label="Loading notifications" />
      </>
    );
  }

  if (isLoggedIn === false) {
    return (
      <>
        <div className="page-header">
          <h1>Notifications</h1>
          <p>Friend requests and challenge invitations</p>
        </div>
        <div className="gate-notice">
          <span className="gate-icon material-symbols-rounded" aria-hidden="true">lock</span>
          <div className="gate-body">
            <h2 className="gate-title">Sign in to see your notifications</h2>
            <p className="gate-text">
              Friend requests and shared challenge updates live on your account, so this tab needs one.
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

  if (feed.loading) {
    return (
      <>
        <div className="page-header">
          <h1>Notifications</h1>
          <p>Friend requests and challenge invitations</p>
        </div>
        <Loader variant="inline" label="Loading notifications" />
      </>
    );
  }

  return (
    <>
      <div className="page-header page-header-with-action">
        <div>
          <h1>Notifications</h1>
          <p>Friend requests, challenge invitations, and recent activity</p>
        </div>
        <div className="notif-toolbar">
          {feed.unread > 0 && (
            <span className="notif-count-pill">{feed.unread} unread</span>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={markAllRead}
            disabled={busy === 'read-all' || feed.unread === 0}
          >
            Mark all read
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-alert" role="alert">
          <span className="material-symbols-rounded">error</span>
          {error}
        </div>
      )}

      {feed.items.length === 0 ? (
        <div className="notif-empty">
          <span className="notif-empty-icon material-symbols-rounded" aria-hidden="true">notifications</span>
          <strong>Nothing here yet.</strong>
          <p>
            Requests and challenge invitations will show up here.{' '}
            <Link className="notif-link" to={username ? `/u/${username}` : '/account'}>
              Find friends on your profile
            </Link>.
          </p>
        </div>
      ) : (
        <div className="notif-list">
          {feed.items.map((item) => {
            const isFriendRequest = item.type === 'friend_request' && item.data.friendshipId;
            const isChallengeInvite = item.type === 'challenge_invite' && item.data.challengeId;
            return (
              <article className={`notif-item${item.read ? '' : ' is-unread'}`} key={item.id}>
                <span className="notif-icon material-symbols-rounded" aria-hidden="true">
                  {ICONS[item.type] || 'notifications'}
                </span>

                <div className="notif-body">
                  <div className="notif-title">
                    {item.title}
                    {!item.read && <span className="notif-dot" aria-label="Unread" />}
                  </div>
                  <p className="notif-text">{item.body}</p>

                  <div className="notif-meta">
                    <span>{timeAgo(item.createdAt)}</span>
                    {item.link && (
                      <Link
                        className="notif-link"
                        to={item.link}
                        onClick={() => openItem(item)}
                      >
                        View
                      </Link>
                    )}
                  </div>

                  {(isFriendRequest || isChallengeInvite) && (
                    <div className="notif-actions">
                      {isFriendRequest ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy === `accept-${item.data.friendshipId}`}
                            onClick={() => acceptFriend(item.data.friendshipId)}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={busy === `decline-${item.data.friendshipId}`}
                            onClick={() => declineFriend(item.data.friendshipId)}
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy === `accept-${item.data.challengeId}`}
                            onClick={() => respondChallenge(item.data.challengeId, 'accept')}
                          >
                            Accept challenge
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={busy === `decline-${item.data.challengeId}`}
                            onClick={() => respondChallenge(item.data.challengeId, 'decline')}
                          >
                            Decline
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
