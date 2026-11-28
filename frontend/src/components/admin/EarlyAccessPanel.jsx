import { useCallback, useEffect, useState } from 'react';
import { admin } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import Loader from '../Loader';

// Early access (temporary, until the public launch).
//
// While signups are capped or closed above, the addresses listed here may
// still sign up. Adding an address emails that person an invitation with the
// signup link; adding it again sends the invitation again. When the app opens
// to everyone, switch the signup limits off and this list stops mattering.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const ERRORS = {
  'invalid-email': 'That does not look like an email address.',
  'already-registered': 'That address already has an account, so it does not need early access.',
  'list-full': 'The early-access list is full. Remove some addresses first.',
};

export default function EarlyAccessPanel() {
  const toast = useToast();
  const ask = useConfirm();
  const [entries, setEntries] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await admin.earlyAccess();
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
      setError('Could not load the early-access list.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function invite(address) {
    setBusy(true);
    setError('');
    try {
      const data = await admin.addEarlyAccess(address);
      setEntries(data.entries || []);
      setEmail('');
      if (data.emailed) toast(`Invitation sent to ${data.entry.email}`);
      else toast(`${data.entry.email} was added, but the email could not be sent`, { kind: 'error' });
    } catch (err) {
      const code = err.body && err.body.error;
      setError(ERRORS[code] || 'Could not add that address.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setError(ERRORS['invalid-email']);
      return;
    }
    invite(address);
  }

  async function remove(entry) {
    const ok = await ask({
      title: `Remove ${entry.email}?`,
      message: entry.signedUpAt
        ? 'They have already signed up, so this only tidies the list. Their account is not affected.'
        : 'They will no longer be able to sign up while signups are limited.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const data = await admin.removeEarlyAccess(entry.id);
      setEntries(data.entries || []);
      toast('Removed', { kind: 'delete' });
    } catch {
      setError('Could not remove that address.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-card">
      <h3 className="moderation-title">
        <span className="material-symbols-rounded" aria-hidden="true">mail</span>
        Early access
        {entries && <span className="moderation-count">{entries.length}</span>}
      </h3>
      <p className="account-hint">
        While signups are limited or closed, the addresses here can still sign up. Adding one
        emails that person an invitation with the signup link. They must register with the same
        address. This is for the period before launch: once signups are open to everyone, the
        list has no effect.
      </p>

      <form className="admin-search" onSubmit={submit} noValidate>
        <input
          type="email"
          className="form-control"
          placeholder="name@example.com"
          aria-label="Email address to give early access"
          autoComplete="off"
          value={email}
          onChange={(event) => { setEmail(event.target.value); setError(''); }}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Give early access'}
        </button>
      </form>
      {error && <div className="admin-limit-error" role="alert">{error}</div>}

      {entries === null ? (
        <Loader variant="inline" label="Loading the list" />
      ) : entries.length === 0 ? (
        <p className="account-hint">Nobody has been given early access yet.</p>
      ) : (
        <ul className="early-list">
          {entries.map((entry) => (
            <li className="early-item" key={entry.id}>
              <div className="early-item-text">
                <span className="early-item-email">{entry.email}</span>
                <span className="early-item-meta">
                  {entry.signedUpAt
                    ? `Signed up ${when(entry.signedUpAt)}`
                    : entry.emailSent
                      ? `Invited ${when(entry.invitedAt)} · not signed up yet`
                      : `Added ${when(entry.addedAt)} · the invitation email was not sent`}
                </span>
              </div>
              <div className="early-item-actions">
                {entry.signedUpAt ? (
                  <span className="admin-status is-live">Signed up</span>
                ) : (
                  <button type="button" className="admin-role-btn" disabled={busy} onClick={() => invite(entry.email)}>
                    Send again
                  </button>
                )}
                <button type="button" className="admin-role-btn" disabled={busy} onClick={() => remove(entry)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
