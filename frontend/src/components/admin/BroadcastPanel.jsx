import { useCallback, useEffect, useState } from 'react';
import { admin } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import { previewUserPlaceholder } from '../../utils/personalization';
import Loader from '../Loader';

// Compose one message and put it in every account's notification centre.
//
// There is no undo: the row is already in each inbox and the bell badge has
// already moved. The confirm dialog spells that out before the request is sent.

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function BroadcastPanel() {
  const toast = useToast();
  const ask = useConfirm();
  const [form, setForm] = useState({ title: '', body: '', link: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState({ loading: true, items: [] });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await admin.broadcasts();
      setState({ loading: false, items: data.items || [] });
    } catch (err) {
      setState({ loading: false, items: [] });
      setError('Could not load the broadcast history.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const ok = await ask({
      title: 'Send to every account?',
      message: 'This adds a notification to every account\'s inbox. It cannot be recalled.',
      confirmLabel: 'Send broadcast',
    });
    if (!ok) return;

    setBusy(true);
    setError('');
    try {
      const result = await admin.sendBroadcast({
        title: form.title,
        body: form.body,
        link: form.link,
      });
      toast(`Sent to ${Number(result.recipients || 0).toLocaleString()} account${result.recipients === 1 ? '' : 's'}`);
      setForm({ title: '', body: '', link: '' });
      await load();
    } catch (err) {
      setError((err.body && err.body.error) || 'Could not send that broadcast.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="account-card">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">campaign</span>
          New broadcast
        </h3>
        <p className="account-hint">
          Appears in the notification centre for every registered account. Use
          the one-time banner for a feature announcement that should interrupt
          the app, or the sticky bar for a link that should stay visible.
          Write <code>{'${user}'}</code> anywhere to address each person by
          their display name, for example “Assalamu Alaikum {'${user}'}, …”.
        </p>

        {error && (
          <div className="auth-alert" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </div>
        )}

        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">
            <span className="account-label">Title</span>
            <input
              className="form-control"
              type="text"
              maxLength={120}
              placeholder="New: Quran bookmarks are here"
              value={form.title}
              onChange={(event) => update('title', event.target.value)}
              required
            />
          </label>

          <label className="admin-field">
            <span className="account-label">Message</span>
            <textarea
              className="form-control admin-textarea"
              rows={5}
              maxLength={1200}
              placeholder="Tell people what changed and how to find it."
              value={form.body}
              onChange={(event) => update('body', event.target.value)}
              required
            />
            <span className="account-hint admin-counter">{form.body.length}/1200</span>
            {form.body.includes('${user}') && (
              <p className="admin-preview" aria-label="Message preview">
                {previewUserPlaceholder(form.body)}
              </p>
            )}
          </label>

          <label className="admin-field">
            <span className="account-label">Open when tapped (optional)</span>
            <input
              className="form-control"
              type="text"
              maxLength={500}
              placeholder="/quran or https://example.com"
              value={form.link}
              onChange={(event) => update('link', event.target.value)}
            />
          </label>

          <div className="moderation-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !form.title.trim() || !form.body.trim()}>
              <span className="material-symbols-rounded" aria-hidden="true">send</span>
              {busy ? 'Sending…' : 'Send to everyone'}
            </button>
          </div>
        </form>
      </section>

      <section className="account-card admin-section">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">history</span>
          Sent broadcasts
        </h3>

        {state.loading ? (
          <Loader variant="inline" label="Loading history" />
        ) : state.items.length === 0 ? (
          <p className="post-empty">Nothing has been sent.</p>
        ) : (
          state.items.map((item) => (
            <article className="moderation-item" key={item.id}>
              <div className="moderation-meta">
                <span className="moderation-author">{item.title}</span>
                <span>{when(item.createdAt)}</span>
                <span>{Number(item.recipients || 0).toLocaleString()} recipients</span>
              </div>
              <p className="post-content">{item.body}</p>
              {item.link && <p className="post-reference">{item.link}</p>}
            </article>
          ))
        )}
      </section>
    </>
  );
}
