import { useCallback, useEffect, useState } from 'react';
import { admin } from '../../services/api';
import { useToast } from '../ToastProvider';
import Loader from '../Loader';
import Avatar from '../Avatar';
import FormSelect from '../FormSelect';

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ContactMessagesPanel() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, messages: [], total: 0, pages: 1 });
  const [busyId, setBusyId] = useState('');
  const [replyDraft, setReplyDraft] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await admin.contactMessages({ status, page, limit: 25 });
      setState({
        loading: false,
        messages: data.messages || [],
        total: data.total || 0,
        pages: data.pages || 1,
      });
      setError('');
    } catch (err) {
      setState((current) => ({ ...current, loading: false, messages: [] }));
      setError('Could not load messages.');
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(message) {
    if (busyId) return;
    setBusyId(message.id);
    try {
      await admin.replyContactMessage(message.id, { status: 'read' });
      await load();
    } catch (err) {
      toast('Could not update that message.', { kind: 'error' });
    } finally {
      setBusyId('');
    }
  }

  async function sendReply(message) {
    const reply = (replyDraft[message.id] || '').trim();
    if (reply.length < 2) {
      toast('Write a reply first.', { kind: 'error' });
      return;
    }
    setBusyId(message.id);
    try {
      await admin.replyContactMessage(message.id, { reply, status: 'replied' });
      setReplyDraft((current) => ({ ...current, [message.id]: '' }));
      toast('Reply sent.');
      await load();
    } catch (err) {
      toast((err.body && err.body.error) || 'Could not send that reply.', { kind: 'error' });
    } finally {
      setBusyId('');
    }
  }

  async function resolve(message) {
    if (busyId) return;
    setBusyId(message.id);
    try {
      await admin.replyContactMessage(message.id, { status: 'resolved' });
      await load();
    } catch (err) {
      toast('Could not update that message.', { kind: 'error' });
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <section className="account-card">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">mail</span>
          Contact messages
          <span className="moderation-count">{Number(state.total).toLocaleString()}</span>
        </h3>
        <p className="account-hint">
          Messages visitors sent from their Account page. Reply here and the answer
          appears in their notification centre.
        </p>

        {error && (
          <div className="auth-alert" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </div>
        )}

        <div className="admin-form-row" style={{ marginTop: '0.75rem' }}>
          <FormSelect
            id="contact-status-filter"
            label="Status"
            value={status}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'new', label: 'New' },
              { value: 'read', label: 'Read' },
              { value: 'replied', label: 'Replied' },
              { value: 'resolved', label: 'Resolved' },
            ]}
            onChange={(value) => { setStatus(value); setPage(1); }}
          />
        </div>

        {state.loading ? (
          <Loader variant="page" label="Loading messages" />
        ) : state.messages.length === 0 ? (
          <p className="post-empty">No messages.</p>
        ) : (
          state.messages.map((message) => (
            <article className="moderation-item" key={message.id}>
              <div className="moderation-meta">
                <Avatar className="nav-avatar" src={message.user && message.user.avatarUrl} name={message.fromName || (message.user && message.user.username) || '?'} />
                <span className="moderation-author">
                  {message.fromName || (message.user && message.user.username) || 'Unknown'}
                </span>
                {message.user && message.user.username && (
                  <span>@{message.user.username}</span>
                )}
                {message.user && message.user.email && (
                  <span>{message.user.email}</span>
                )}
                <span>{when(message.createdAt)}</span>
                <span className="moderation-reason">{message.status}</span>
              </div>
              {message.subject && <p className="moderation-note" style={{ fontStyle: 'normal', fontWeight: 700 }}>{message.subject}</p>}
              <p className="post-content" style={{ whiteSpace: 'pre-wrap' }}>{message.message}</p>
              {message.adminReply && (
                <div className="admin-preview">
                  <strong>Reply:</strong> {message.adminReply}
                  <div className="account-hint">{when(message.repliedAt)}</div>
                </div>
              )}
              {message.status !== 'resolved' && (
                <>
                  <textarea
                    className="form-control admin-textarea"
                    rows={3}
                    placeholder="Reply to this message…"
                    value={replyDraft[message.id] || ''}
                    onChange={(event) => setReplyDraft((current) => ({ ...current, [message.id]: event.target.value }))}
                  />
                  <div className="moderation-actions">
                    {message.status === 'new' && (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => markRead(message)} disabled={busyId === message.id}>
                        Mark read
                      </button>
                    )}
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => sendReply(message)} disabled={busyId === message.id}>
                      {busyId === message.id ? 'Sending…' : 'Send reply'}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => resolve(message)} disabled={busyId === message.id}>
                      Resolve
                    </button>
                  </div>
                </>
              )}
            </article>
          ))
        )}

        {state.pages > 1 && (
          <div className="moderation-actions" style={{ justifyContent: 'center', marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span className="account-hint">Page {page} of {state.pages}</span>
            <button type="button" className="btn btn-outline btn-sm" disabled={page >= state.pages} onClick={() => setPage((p) => Math.min(state.pages, p + 1))}>
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}