import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { moderation } from '../../services/api';
import { useToast } from '../ToastProvider';
import Loader from '../Loader';

// The review queue, moved out of the old single-purpose admin page.
//
// The server gates every call with the admin check; this panel only decides what
// to draw. A non-admin never reaches it because AdminPage shows the sign-in card
// first.

const REASON_LABELS = {
  spam: 'Spam',
  harassment: 'Harassment',
  misinformation: 'Misleading content',
  other: 'Other',
};

export default function ModerationPanel() {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, posts: [], reports: [] });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await moderation.queue();
      setState({ loading: false, posts: data.posts || [], reports: data.reports || [] });
      setError('');
    } catch (err) {
      setState({ loading: false, posts: [], reports: [] });
      setError(err.status === 403 ? 'This account is not a moderator.' : 'Could not load the moderation queue.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(postId, action) {
    if (!postId || busy) return;
    const key = `${postId}:${action}`;
    setBusy(key);
    setError('');
    try {
      if (action === 'approve') await moderation.approve(postId);
      else await moderation.reject(postId);
      toast(action === 'approve' ? 'Post approved' : 'Post removed', {
        kind: action === 'approve' ? undefined : 'delete',
      });
      await load();
    } catch (err) {
      setError('Could not update that post.');
    } finally {
      setBusy('');
    }
  }

  if (state.loading) return <Loader variant="page" label="Loading the queue" />;

  return (
    <>
      {error && (
        <div className="auth-alert" role="alert">
          <span className="material-symbols-rounded">error</span>
          {error}
        </div>
      )}

      <section className="account-card">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">hourglass_top</span>
          Waiting for review
          <span className="moderation-count">{state.posts.length}</span>
        </h3>
        <p className="account-hint">
          A post that several people report is hidden until it is reviewed
          here. Approve to restore it, or reject to remove it.
        </p>

        {state.posts.length === 0 ? (
          <p className="post-empty">Nothing is waiting.</p>
        ) : (
          state.posts.map((post) => {
            // Name first, unique handle in brackets: two accounts can share a
            // display name, and a moderator acts on the account.
            const author = post.author && post.author.username ? post.author.username : '';
            const authorName = (post.author && post.author.name)
              || post.authorName
              || author
              || 'Unknown';
            return (
              <article className="moderation-item" key={post._id}>
                <div className="moderation-meta">
                  <span className="moderation-author">
                    {authorName}
                    {author && authorName !== author ? ` (@${author})` : ''}
                  </span>
                  <span>{post.postedDate}</span>
                  <span className="moderation-reason">
                    Reported
                  </span>
                </div>
                <p className="post-content">{post.content}</p>
                {post.reference && <p className="post-reference">{post.reference}</p>}
                {post.author && post.author.username && (
                  <Link className="moderation-link" to={`/u/${post.author.username}`}>
                    Open profile
                  </Link>
                )}
                <div className="moderation-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy === `${post._id}:approve` || busy === `${post._id}:reject`}
                    onClick={() => act(post._id, 'approve')}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">check</span>
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    disabled={busy === `${post._id}:approve` || busy === `${post._id}:reject`}
                    onClick={() => act(post._id, 'reject')}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                    Remove
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="account-card">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">flag</span>
          Open reports
          <span className="moderation-count">{state.reports.length}</span>
        </h3>
        <p className="account-hint">
          One row per report. Keeping a post dismisses its reports; removing
          it marks them actioned.
        </p>

        {state.reports.length === 0 ? (
          <p className="post-empty">No open reports.</p>
        ) : (
          state.reports.map((report) => (
            <article className="moderation-item" key={report.id}>
              <div className="moderation-meta">
                <span className="moderation-reason">{REASON_LABELS[report.reason] || report.reason}</span>
                <span>
                  reported by {report.reporter && report.reporter.username
                    ? `@${report.reporter.username}`
                    : 'a deleted account'}
                </span>
                {report.createdAt && (
                  <span>{new Date(report.createdAt).toLocaleDateString()}</span>
                )}
              </div>
              {report.note && <p className="moderation-note">“{report.note}”</p>}
              {report.post ? (
                <>
                  <p className="post-content">{report.post.content}</p>
                  <p className="account-hint">
                    by {report.post.authorName || 'unknown'} · {report.post.status}
                  </p>
                  <div className="moderation-actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={busy === `${report.post.id}:approve` || busy === `${report.post.id}:reject`}
                      onClick={() => act(report.post.id, 'approve')}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">check</span>
                      Keep post
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm"
                      disabled={busy === `${report.post.id}:approve` || busy === `${report.post.id}:reject`}
                      onClick={() => act(report.post.id, 'reject')}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                      Remove post
                    </button>
                  </div>
                </>
              ) : (
                <p className="account-hint">The post was deleted.</p>
              )}
            </article>
          ))
        )}
      </section>
    </>
  );
}
