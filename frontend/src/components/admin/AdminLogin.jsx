import { useState } from 'react';
import { Link } from 'react-router-dom';
import { admin } from '../../services/api';
import { useSession } from '../../hooks/useSession.jsx';

// The only thing `/admin` shows to someone who is not an administrator.
//
// It is reached by typing the URL: no navigation item points here for an
// ordinary account. The form posts to /api/admin/login, which authenticates
// first and only creates a session for an administrator, so a normal sign-in
// cannot be left half-done by a visit to this page.

export default function AdminLogin() {
  const { isLoggedIn, username, refresh } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      await admin.login(identifier, password);
      // The shell owns `isAdmin`; refresh replaces the boot payload in place so
      // the portal paints without a full reload.
      const data = await refresh();
      if (!data || !data.session || !data.session.isAdmin) {
        setError('The session could not be verified. Reload the page and try again.');
      }
    } catch (err) {
      const code = err.body && err.body.error;
      if (code === 'not-admin') {
        setError('That account does not have administrator access.');
      } else if (code === 'rate-limited') {
        const seconds = Number(err.body.retryAfter) || 0;
        const minutes = Math.max(1, Math.ceil(seconds / 60));
        setError(`Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      } else if (code === 'invalid-credentials') {
        setError('Invalid email, username or password.');
      } else {
        setError('Could not sign you in.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <div className="account-card admin-login-card">
        <span className="admin-login-icon material-symbols-rounded" aria-hidden="true">
          admin_panel_settings
        </span>
        <h1 className="admin-login-title">Admin sign in</h1>
        <p className="account-hint">
          Sign in with an account that has administrator access.
        </p>

        {error && (
          <div className="auth-alert" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </div>
        )}

        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">
            <span className="account-label">Email or username</span>
            <input
              className="form-control"
              type="text"
              autoComplete="username"
              placeholder="you@example.com"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              required
            />
          </label>

          <label className="admin-field">
            <span className="account-label">Password</span>
            <input
              className="form-control"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <button type="submit" className="btn btn-primary admin-submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in to admin'}
          </button>
        </form>

        <p className="account-hint admin-login-foot">
          {isLoggedIn && username
            ? <>Signed in as @{username}. <Link to="/">Back to the app</Link></>
            : <Link to="/">Back to the app</Link>}
        </p>
      </div>
    </div>
  );
}
