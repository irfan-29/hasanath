import { useCallback, useEffect, useState } from 'react';
import { admin } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import Loader from '../Loader';

// One-time popups and sticky bars.
//
// An OTB is acknowledged per account, so its row shows how many people have
// actually closed it. A sticky bar has no per-user read state; activating a new
// one switches the old one off so two bars cannot stack.

const EMPTY = {
  id: null,
  kind: 'otb',
  title: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  position: 'top',
  active: false,
};

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export default function BannersPanel() {
  const toast = useToast();
  const ask = useConfirm();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState({ loading: true, items: [] });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await admin.banners();
      setState({ loading: false, items: data.items || [] });
    } catch (err) {
      setState({ loading: false, items: [] });
      setError('Could not load the banners.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setForm(EMPTY);
    setError('');
  }

  function edit(item) {
    setForm({
      id: item.id,
      kind: item.kind,
      title: item.title || '',
      body: item.body || '',
      ctaLabel: item.ctaLabel || '',
      ctaUrl: item.ctaUrl || '',
      position: item.position || 'top',
      active: Boolean(item.active),
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const payload = {
      kind: form.kind,
      title: form.title,
      body: form.body,
      ctaLabel: form.ctaLabel,
      ctaUrl: form.ctaUrl,
      position: form.position,
      active: form.active,
    };

    setBusy('save');
    setError('');
    try {
      if (form.id) {
        await admin.updateBanner(form.id, payload);
        toast('Banner updated');
      } else {
        await admin.createBanner(payload);
        toast('Banner created');
      }
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError((err.body && err.body.error) || 'Could not save that banner.');
    } finally {
      setBusy('');
    }
  }

  async function toggle(item) {
    setBusy(`${item.id}:active`);
    setError('');
    try {
      await admin.updateBanner(item.id, { active: !item.active });
      toast(item.active ? 'Banner turned off' : 'Banner is live');
      await load();
    } catch (err) {
      setError('Could not change that banner.');
    } finally {
      setBusy('');
    }
  }

  async function remove(item) {
    const ok = await ask({
      title: 'Delete this banner?',
      message: item.kind === 'otb'
        ? 'The popup and its view history will be removed. Anyone who has not seen it will not see it again.'
        : 'The sticky bar will disappear from the app immediately.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    setBusy(`${item.id}:delete`);
    setError('');
    try {
      await admin.removeBanner(item.id);
      toast('Banner deleted', { kind: 'delete' });
      if (form.id === item.id) setForm(EMPTY);
      await load();
    } catch (err) {
      setError('Could not delete that banner.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <section className="account-card">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">web_asset</span>
          {form.id ? 'Edit banner' : 'New banner'}
        </h3>
        <p className="account-hint">
          A one-time banner is a popup shown once per signed-in account until it
          is closed. A sticky bar stays on screen at the top or bottom; a new
          active sticky bar replaces the previous one.
        </p>

        {error && (
          <div className="auth-alert" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </div>
        )}

        <form className="admin-form" onSubmit={submit}>
          <div className="admin-form-row">
            <label className="admin-field">
              <span className="account-label">Type</span>
              <select
                className="form-control"
                value={form.kind}
                onChange={(event) => update('kind', event.target.value)}
                disabled={Boolean(form.id)}
              >
                <option value="otb">One-time popup</option>
                <option value="sticky">Sticky bar</option>
              </select>
            </label>

            {form.kind === 'sticky' && (
              <label className="admin-field">
                <span className="account-label">Position</span>
                <select
                  className="form-control"
                  value={form.position}
                  onChange={(event) => update('position', event.target.value)}
                >
                  <option value="top">Top of the screen</option>
                  <option value="bottom">Bottom of the screen</option>
                </select>
              </label>
            )}
          </div>

          <label className="admin-field">
            <span className="account-label">Title</span>
            <input
              className="form-control"
              type="text"
              maxLength={120}
              placeholder={form.kind === 'otb' ? 'New feature: Quran bookmarks' : 'Get the Android app'}
              value={form.title}
              onChange={(event) => update('title', event.target.value)}
              required
            />
          </label>

          <label className="admin-field">
            <span className="account-label">Message</span>
            <textarea
              className="form-control admin-textarea"
              rows={4}
              maxLength={600}
              placeholder="A short sentence people can read at a glance."
              value={form.body}
              onChange={(event) => update('body', event.target.value)}
            />
            <span className="account-hint admin-counter">{form.body.length}/600</span>
          </label>

          <div className="admin-form-row">
            <label className="admin-field">
              <span className="account-label">Button label (optional)</span>
              <input
                className="form-control"
                type="text"
                maxLength={40}
                placeholder="Download"
                value={form.ctaLabel}
                onChange={(event) => update('ctaLabel', event.target.value)}
              />
            </label>

            <label className="admin-field">
              <span className="account-label">Button link (optional)</span>
              <input
                className="form-control"
                type="text"
                maxLength={500}
                placeholder="/quran or https://example.com"
                value={form.ctaUrl}
                onChange={(event) => update('ctaUrl', event.target.value)}
              />
            </label>
          </div>

          <label className="admin-check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => update('active', event.target.checked)}
            />
            <span>Make it live as soon as I save</span>
          </label>

          <div className="moderation-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'save' || !form.title.trim()}>
              <span className="material-symbols-rounded" aria-hidden="true">check</span>
              {busy === 'save' ? 'Saving…' : form.id ? 'Save changes' : 'Create banner'}
            </button>
            {form.id && (
              <button type="button" className="btn btn-outline btn-sm" onClick={reset}>
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="account-card admin-section">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">list</span>
          All banners
          <span className="moderation-count">{state.items.length}</span>
        </h3>

        {state.loading ? (
          <Loader variant="inline" label="Loading banners" />
        ) : state.items.length === 0 ? (
          <p className="post-empty">No banners yet.</p>
        ) : (
          state.items.map((item) => (
            <article className="moderation-item" key={item.id}>
              <div className="moderation-meta">
                <span className="moderation-reason">
                  {item.kind === 'otb' ? 'One-time popup' : `Sticky ${item.position}`}
                </span>
                <span className={`admin-status${item.active ? ' is-live' : ''}`}>
                  {item.active ? 'Live' : 'Off'}
                </span>
                <span>created {when(item.createdAt)}</span>
                {item.kind === 'otb' && (
                  <span>{Number(item.seenCount || 0).toLocaleString()} closed it</span>
                )}
              </div>
              <p className="moderation-author">{item.title}</p>
              {item.body && <p className="post-content">{item.body}</p>}
              {item.ctaLabel && (
                <p className="post-reference">
                  {item.ctaLabel}{item.ctaUrl ? ` → ${item.ctaUrl}` : ''}
                </p>
              )}
              <div className="moderation-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy === `${item.id}:active` || busy === `${item.id}:delete`}
                  onClick={() => edit(item)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">edit</span>
                  Edit
                </button>
                <button
                  type="button"
                  className={`btn ${item.active ? 'btn-outline' : 'btn-primary'} btn-sm`}
                  disabled={busy === `${item.id}:active` || busy === `${item.id}:delete`}
                  onClick={() => toggle(item)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    {item.active ? 'pause' : 'play_arrow'}
                  </span>
                  {item.active ? 'Turn off' : 'Turn on'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  disabled={busy === `${item.id}:active` || busy === `${item.id}:delete`}
                  onClick={() => remove(item)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}
