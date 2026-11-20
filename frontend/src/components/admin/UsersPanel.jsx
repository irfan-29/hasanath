import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admin } from '../../services/api';
import { useSession } from '../../hooks/useSession.jsx';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import Loader from '../Loader';

// Account search and activity. Every handle links to the ordinary profile for
// the content itself. The one write here is the admin flag, which lets a root
// administrator hand the portal to another account without a redeploy.

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function shortDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function UsersPanel() {
  const { username: viewer } = useSession();
  const toast = useToast();
  const ask = useConfirm();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, users: [], total: 0, pages: 1 });
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await admin.users({ q: query, page, limit: 25 });
      setState({
        loading: false,
        users: data.users || [],
        total: data.total || 0,
        pages: data.pages || 1,
      });
      setError('');
    } catch (err) {
      setState({ loading: false, users: [], total: 0, pages: 1 });
      setError('Could not load the user list.');
    }
  }, [query, page]);

  useEffect(() => {
    load();
  }, [load]);

  function submit(event) {
    event.preventDefault();
    setPage(1);
    setQuery(input.trim());
  }

  async function toggleAdmin(user) {
    if (busyId) return;
    const name = user.username ? `@${user.username}` : (user.email || 'this account');
    const granting = !user.isAdmin;

    const ok = await ask({
      title: granting ? `Make ${name} an admin?` : `Remove ${name}\u2019s admin access?`,
      message: granting
        ? 'They will be able to moderate posts, send broadcasts and manage banners across the site.'
        : 'They lose the portal immediately. You can grant it again from this table.',
      confirmLabel: granting ? 'Make admin' : 'Remove admin',
      danger: !granting,
    });
    if (!ok) return;

    setBusyId(user.id);
    setError('');
    try {
      await admin.setUserAdmin(user.id, granting);
      toast(granting ? `${name} is now an admin` : `${name} is no longer an admin`, granting ? undefined : { kind: 'delete' });
      await load();
    } catch (err) {
      const code = err.body && err.body.error;
      if (code === 'self') setError('You cannot change your own admin access.');
      else if (code === 'env-admin') setError('That account is configured in ADMIN_EMAILS; change the environment instead.');
      else setError('Could not change that account.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <section className="account-card">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">group</span>
          Users
          <span className="moderation-count">{Number(state.total).toLocaleString()}</span>
        </h3>
        <p className="account-hint">
          Search by username, name or email. &ldquo;Last active&rdquo; comes from
          the app boot and updates at most every five minutes. Access controls
          who can open this portal.
        </p>

        <form className="admin-search" onSubmit={submit}>
          <input
            className="form-control"
            type="search"
            placeholder="Search accounts"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm">
            <span className="material-symbols-rounded" aria-hidden="true">search</span>
            Search
          </button>
          {(input || query) && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => { setInput(''); setQuery(''); setPage(1); }}
            >
              Clear
            </button>
          )}
        </form>

        {error && (
          <div className="auth-alert" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </div>
        )}
      </section>

      <section className="account-card admin-section">
        {state.loading ? (
          <Loader variant="inline" label="Loading users" />
        ) : state.users.length === 0 ? (
          <p className="post-empty">No accounts match that search.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Last active</th>
                  <th>Posts</th>
                  <th>Access</th>
                  <th>Telegram</th>
                </tr>
              </thead>
              <tbody>
                {state.users.map((user) => (
                  <tr key={user.id}>
                    <td data-label="Account">
                      {user.username ? (
                        <Link className="admin-user-link" to={`/u/${user.username}`}>
                          @{user.username}
                        </Link>
                      ) : (
                        <span className="admin-user-link">No username</span>
                      )}
                      {user.name && <span className="admin-user-name">{user.name}</span>}
                    </td>
                    <td className="admin-cell-muted" data-label="Email">{user.email || '—'}</td>
                    <td className="admin-cell-muted" data-label="Joined">{when(user.joinedAt)}</td>
                    <td className="admin-cell-muted" data-label="Last active">{shortDate(user.lastSeenAt)}</td>
                    <td data-label="Posts">
                      {Number(user.posts).toLocaleString()}
                      {user.posts !== user.published && (
                        <span className="admin-cell-muted"> ({Number(user.published).toLocaleString()} live)</span>
                      )}
                    </td>
                    <td data-label="Access">
                      <div className="admin-role">
                        {user.envAdmin ? (
                          <span className="admin-status is-live">Site admin</span>
                        ) : user.isAdmin ? (
                          <span className="admin-status is-live">Admin</span>
                        ) : (
                          <span className="admin-status">Member</span>
                        )}

                        {!user.envAdmin && user.username !== viewer && (
                          <button
                            type="button"
                            className="admin-role-btn"
                            disabled={busyId === user.id}
                            onClick={() => toggleAdmin(user)}
                          >
                            {busyId === user.id
                              ? 'Saving…'
                              : user.isAdmin ? 'Remove admin' : 'Make admin'}
                          </button>
                        )}

                        {user.username === viewer && (
                          <span className="admin-role-note">You</span>
                        )}
                      </div>
                    </td>
                    <td className="admin-cell-muted" data-label="Telegram">{user.telegram ? 'On' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {state.pages > 1 && (
          <div className="admin-pager">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={page <= 1 || state.loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
              Previous
            </button>
            <span className="admin-pager-label">Page {page} of {state.pages}</span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={page >= state.pages || state.loading}
              onClick={() => setPage((current) => Math.min(state.pages, current + 1))}
            >
              Next
              <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
            </button>
          </div>
        )}
      </section>
    </>
  );
}
