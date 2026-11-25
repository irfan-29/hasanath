import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { friends as friendsApi, posts as api } from '../services/api';
import { useUnreadNotifications } from '../hooks/useNotifications.jsx';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useSession } from '../hooks/useSession';
import { personName, personHandle } from '../utils/personalization';
import FormSelect from '../components/FormSelect';
import Loader from '../components/Loader';
import Avatar from '../components/Avatar';
import NotFound from './NotFound';

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'misinformation', label: 'Misleading religious content' },
  { value: 'other', label: 'Something else' },
];


// Reuses views/post-card.ejs's markup, which the shared stylesheet already
// styles. The card is factored out because the feed, a profile and a permalink
// all render it, and three copies is how they drift.
export function PostCard({ post, permalinkBase = '', canManage, onChanged, onDeleted, onBlocked }) {
  const { username, isLoggedIn } = useSession();
  const navigate = useNavigate();
  const ask = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef(null);
  const moreButtonRef = useRef(null);
  // Report flow: a small dialog with a reason, not a browser prompt.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('spam');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [likeState, setLikeState] = useState({
    liked: Boolean(post.likedByMe),
    count: Number(post.likeCount) || 0,
    busy: false,
  });

  useEffect(() => {
    setLikeState({
      liked: Boolean(post.likedByMe),
      count: Number(post.likeCount) || 0,
      busy: false,
    });
  }, [post._id, post.likedByMe, post.likeCount]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOutside = (event) => {
      if (!moreRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // The report dialog is portalled to <body> below, so it is not trapped by the
  // post card's stacking context. While it is open the page behind it should
  // not scroll, and Escape closes it like every other dialog in the app.
  useEffect(() => {
    if (!reportOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape' && !reportBusy) setReportOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [reportOpen, reportBusy]);

  // Profile responses do not populate `author` (every post there belongs to the
  // profile owner), so that page passes an explicit canManage. Everywhere else
  // the post carries its populated author.
  const owned = canManage !== undefined
    ? canManage
    : Boolean(username && post.author && post.author.username === username);

  const handle = post.author && post.author.username ? post.author.username : null;
  // Instagram-style attribution: friendly display name first, unique @handle
  // second. Legacy/deleted authors fall back to the snapshot on the post.
  const authorName = post.author
    ? (post.author.name || post.author.username)
    : (post.authorName || null);
  const authorId = post.author
    ? String(post.author._id || post.author)
    : null;
  const permalink = permalinkBase + '/post/' + post._id;
  const moreMenuId = `post-more-${post._id}`;
  const reportFieldId = `post-report-${post._id}`;

  async function handleLike() {
    if (!isLoggedIn) {
      navigate('/login');
      return;
    }
    if (likeState.busy) return;

    const previous = likeState;
    const liked = !previous.liked;
    const count = Math.max(0, previous.count + (liked ? 1 : -1));
    setLikeState({ liked, count, busy: true });
    setError('');
    try {
      const result = await api.toggleLike(post._id);
      const resolved = {
        liked: Boolean(result.liked),
        count: Number(result.likeCount) || 0,
        busy: false,
      };
      setLikeState(resolved);
      if (onChanged) {
        onChanged({ ...post, likedByMe: resolved.liked, likeCount: resolved.count });
      }
    } catch (err) {
      setLikeState(previous);
      setError(err.status === 401 ? 'Sign in to like this post.' : 'Could not update your like.');
      if (err.status === 401) navigate('/login');
    }
  }

  async function handleDelete() {
    if (deleting) return;
    const ok = await ask({
      title: 'Delete this post?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;

    setDeleting(true);
    setError('');
    try {
      await api.remove(post._id);
      setRemoved(true);
      if (onDeleted) onDeleted(post);
      toast('Post deleted', { kind: 'delete' });
    } catch (err) {
      setError(err.status === 401 ? 'Sign in to delete this post.' : 'Could not delete that post.');
      setDeleting(false);
    }
  }

  async function handleBlock() {
    if (blocking) return;
    const target = handle || post.authorName || 'this account';
    const ok = await ask({
      title: `Block ${target}?`,
      message: 'Their posts will be hidden from your feed and profile. If you are friends, blocking also removes the friendship. They are not told, and you can unblock them later.',
      confirmLabel: 'Block',
      danger: true,
    });
    if (!ok) return;

    setBlocking(true);
    setError('');
    try {
      await api.block(authorId);
      toast(`Blocked ${target}`, { kind: 'delete' });
      if (onBlocked) onBlocked(authorId);
      else setRemoved(true);
    } catch (err) {
      setError('Could not block that account.');
      setBlocking(false);
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (reportBusy) return;
    setReportBusy(true);
    setReportError('');
    try {
      const result = await api.report(post._id, { reason: reportReason, note: reportNote });
      setReportOpen(false);
      setReportNote('');
      toast(
        result && result.hidden
          ? 'Report received - the post is hidden pending review.'
          : 'Report received. Thank you for flagging it.',
      );
    } catch (err) {
      if (err.status === 401) {
        setReportOpen(false);
        navigate('/login');
      } else {
        setReportError('Could not send that report. Please try again.');
      }
    } finally {
      setReportBusy(false);
    }
  }

  if (removed) return null;

  if (editing) {
    return (
      <PostForm
        post={post}
        onClose={() => setEditing(false)}
        onSaved={(updated) => {
          setEditing(false);
          if (onChanged) onChanged(updated);
        }}
      />
    );
  }

  // Card order: author line with the More menu on its right edge, then the
  // content, a quiet timestamp, and finally the Like/Share row.
  const date = (
    <p className="post-date post-card-date">
      <Link className="post-permalink" to={`/post/${post._id}`}>{post.postedDate}</Link>
    </p>
  );

  const actions = (
    <div className="post-card-footer">
      <div className="post-card-actions">
        <button
          type="button"
          className={`fav-btn post-like${likeState.liked ? ' is-active' : ''}`}
          aria-pressed={likeState.liked}
          aria-busy={likeState.busy}
          disabled={likeState.busy}
          aria-label={likeState.liked
            ? `Unlike this post${likeState.count ? `, ${likeState.count} likes` : ''}`
            : `Like this post${likeState.count ? `, ${likeState.count} likes` : ''}`}
          title={likeState.liked ? 'Unlike' : 'Like'}
          onClick={handleLike}
        >
          <span className="material-symbols-rounded">
            {likeState.liked ? 'favorite' : 'favorite_border'}
          </span>
          {likeState.count > 0 && <span className="post-like-count">{likeState.count}</span>}
        </button>
        <div className="post-action-group">
          <button type="button" className="post-share" data-share-url={permalink}
                  title="Copy link to this post" aria-label="Copy link to this post">
            <span className="material-symbols-rounded">share</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`post-card${post.isVideo ? ' post-card-video' : ''}`}>
      <div className="post-card-head">
        {handle ? (
          <Link className="post-author" to={`/u/${handle}`}>
            <Avatar className="post-author-avatar" src={post.author && post.author.avatarUrl} name={authorName || handle} />
            <span className="post-author-name">{authorName || handle}</span>
            {authorName && authorName !== handle && (
              <span className="post-author-handle">@{handle}</span>
            )}
          </Link>
        ) : post.authorName ? (
          <span className="post-author post-author-anonymous">{post.authorName}</span>
        ) : null}

        {isLoggedIn && (
          <div className="post-more post-head-more" ref={moreRef}>
            <button
              ref={moreButtonRef}
              type="button"
              className={`post-share post-more-btn${menuOpen ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? moreMenuId : undefined}
              title="More options"
              aria-label="More options"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="material-symbols-rounded">more_vert</span>
            </button>
            {menuOpen && (
              <div className="post-more-menu" id={moreMenuId} role="menu" aria-label="Post options">
                {owned ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setEditing(true);
                      }}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">edit</span>
                      Edit post
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      disabled={deleting}
                      onClick={() => {
                        setMenuOpen(false);
                        handleDelete();
                      }}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        {deleting ? 'hourglass_top' : 'delete'}
                      </span>
                      {deleting ? 'Deleting…' : 'Delete post'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setReportError('');
                        setReportOpen(true);
                      }}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">flag</span>
                      Report post
                    </button>
                    {authorId && (
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        disabled={blocking}
                        onClick={() => {
                          setMenuOpen(false);
                          handleBlock();
                        }}
                      >
                        <span className="material-symbols-rounded" aria-hidden="true">
                          {blocking ? 'hourglass_top' : 'block'}
                        </span>
                        {blocking ? 'Blocking…' : `Block ${handle || 'author'}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {post.status === 'pending' && (
        <p className="post-pending-note" role="status">
          <span className="material-symbols-rounded" aria-hidden="true">hourglass_top</span>
          {post.statusReason === 'reported'
            ? 'Hidden while a moderator reviews it. Only you can see it.'
            : 'Waiting for review. Only you can see it until it is approved.'}
        </p>
      )}

      {error && <p className="post-error" role="alert">{error}</p>}

      {post.isVideo ? (
        <>
          <div className="post-video-embed">
            <iframe src={`https://www.youtube.com/embed/${post.content}`} allowFullScreen title="Embedded video" />
          </div>
          {post.reference && <p className="post-reference">{post.reference}</p>}
          {date}
          {actions}
        </>
      ) : (
        <>
          <p className="post-content">{post.content}</p>
          {post.reference && <p className="post-reference">Reference: {post.reference}</p>}
          {date}
          {actions}
        </>
      )}

      {reportOpen && createPortal(
        <div className="confirm-overlay" role="presentation" onClick={() => !reportBusy && setReportOpen(false)}>
          <form className="confirm-card post-report-card" role="dialog" aria-modal="true" aria-label="Report this post"
                onSubmit={submitReport} onClick={(event) => event.stopPropagation()}>
            <h3 className="confirm-title">Report this post</h3>
            <p className="confirm-message">
              Reports are anonymous. If several people flag a post, it is hidden
              until a moderator looks at it.
            </p>

            <FormSelect
              id={reportFieldId}
              label="Reason"
              value={reportReason}
              options={REPORT_REASONS}
              onChange={setReportReason}
              disabled={reportBusy}
            />

            <label className="account-label" htmlFor={`${reportFieldId}-note`}>Anything else? (optional)</label>
            <textarea
              id={`${reportFieldId}-note`}
              className="form-control"
              rows={3}
              maxLength={500}
              value={reportNote}
              onChange={(event) => setReportNote(event.target.value)}
              disabled={reportBusy}
              placeholder="Add a short note for the moderator."
            />

            {reportError && <p className="post-error" role="alert">{reportError}</p>}

            <div className="confirm-actions">
              <button type="button" className="btn btn-outline" disabled={reportBusy}
                      onClick={() => setReportOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={reportBusy}>
                {reportBusy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}

// The end of a paged list. It loads the next page by itself when it scrolls
// near the screen, and stays a real button for keyboards, screen readers and
// any browser where the observer does not fire.
function LoadMore({ hasMore, busy, onMore }) {
  const ref = useRef(null);
  const onMoreRef = useRef(onMore);
  onMoreRef.current = onMore;

  useEffect(() => {
    const node = ref.current;
    if (!hasMore || busy || !node || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onMoreRef.current();
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, busy]);

  if (!hasMore) return null;
  return (
    <div className="post-more" ref={ref}>
      <button type="button" className="btn btn-outline btn-sm" onClick={onMore} disabled={busy}>
        {busy ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

// Adds a page to a list without ever showing a post twice.
function appendPosts(current, incoming) {
  const seen = new Set(current.map((post) => post._id));
  return current.concat((incoming || []).filter((post) => !seen.has(post._id)));
}

export function PostsPage() {
  const { isLoggedIn } = useSession();
  const [data, setData] = useState({ loading: true, posts: [], permalinkBase: '', hasMore: false, nextCursor: null, likedCount: 0 });
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [loadingMore, setLoadingMore] = useState(false);
  // Guards against a slow first page landing after the filter has changed.
  const requestRef = useRef(0);

  // The first page of the feed, or of the viewer's liked posts.
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setData((d) => ({ ...d, loading: true }));
    try {
      const result = await api.list({ liked: filter === 'liked' });
      if (request !== requestRef.current) return;
      setData((d) => ({
        loading: false,
        posts: result.posts || [],
        permalinkBase: result.permalinkBase || '',
        hasMore: Boolean(result.hasMore),
        nextCursor: result.nextCursor || null,
        likedCount: typeof result.likedCount === 'number' ? result.likedCount : d.likedCount,
      }));
    } catch (err) {
      if (request !== requestRef.current) return;
      setData((d) => ({ ...d, loading: false, posts: [], hasMore: false, nextCursor: null }));
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // The next page: everything older than the last post on screen.
  const loadMore = useCallback(async () => {
    if (loadingMore || !data.hasMore || !data.nextCursor) return;
    const request = requestRef.current;
    setLoadingMore(true);
    try {
      const result = await api.list({ before: data.nextCursor, liked: filter === 'liked' });
      if (request !== requestRef.current) return;
      setData((d) => ({
        ...d,
        posts: appendPosts(d.posts, result.posts),
        hasMore: Boolean(result.hasMore),
        nextCursor: result.nextCursor || null,
      }));
    } catch (err) {
      // Leave the button in place so the reader can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, data.hasMore, data.nextCursor, filter]);

  useEffect(() => {
    if (!isLoggedIn) setFilter('all');
  }, [isLoggedIn]);

  // The count comes from the server, since only one page of posts is loaded.
  const likedCount = data.likedCount;
  const visiblePosts = filter === 'liked'
    ? data.posts.filter((post) => post.likedByMe)
    : data.posts;

  return (
    <>
      <div className="page-header">
        <h1>Posts</h1>
        <p>Reflections, reminders, and videos</p>
      </div>

      <div className="post-actions">
        {/* One entry point. Text or video is chosen inside the form, so the
            page does not carry two buttons that open the same thing. */}
        <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>add</span>
          Add Post
        </button>

        {isLoggedIn && (
          <button
            type="button"
            className={`post-filter-toggle${filter === 'liked' ? ' is-active' : ''}`}
            aria-pressed={filter === 'liked'}
            aria-label={filter === 'liked' ? 'Show all posts' : 'Show liked posts'}
            title={filter === 'liked' ? 'Show all posts' : 'Show liked posts'}
            onClick={() => setFilter((current) => (current === 'liked' ? 'all' : 'liked'))}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              {filter === 'liked' ? 'favorite' : 'favorite_border'}
            </span>
            Liked
            <span className="post-filter-count">{likedCount}</span>
          </button>
        )}
      </div>

      {composing && (
        <PostForm
          onClose={() => setComposing(false)}
          onSaved={async () => { setComposing(false); await load(); }}
        />
      )}

      {data.loading ? <Loader variant="inline" label="Loading posts" /> : visiblePosts.length === 0 ? (
        // Liked posts are their own list now, so an empty one is "none liked",
        // not "no posts" - unless more liked posts are still waiting to load.
        <p className="post-empty">
          {filter === 'liked'
            ? (data.hasMore ? 'Load more to see your other liked posts.' : 'You have not liked any posts yet.')
            : 'No posts yet.'}
        </p>
      ) : (
        visiblePosts.map((post) => (
          <PostCard
            key={post._id}
            post={post}
            permalinkBase={data.permalinkBase}
            onChanged={(updated) => setData((d) => {
              const before = d.posts.find((p) => p._id === updated._id);
              const change = before ? Number(Boolean(updated.likedByMe)) - Number(Boolean(before.likedByMe)) : 0;
              return {
                ...d,
                posts: d.posts.map((p) => (p._id === updated._id ? updated : p)),
                likedCount: Math.max(0, d.likedCount + change),
              };
            })}
            onDeleted={(deleted) => setData((d) => ({
              ...d,
              posts: d.posts.filter((p) => p._id !== deleted._id),
              likedCount: Math.max(0, d.likedCount - (deleted.likedByMe ? 1 : 0)),
            }))}
            onBlocked={(authorId) => setData((d) => ({
              ...d,
              posts: d.posts.filter((p) => String(p.author?._id || p.author) !== String(authorId)),
            }))}
          />
        ))
      )}

      {!data.loading && <LoadMore hasMore={data.hasMore} busy={loadingMore} onMore={loadMore} />}
    </>
  );
}

// Seed the edit field with something a person recognises. Stored values are
// bare YouTube ids, but a legacy row may already hold a full URL.
function videoLink(content) {
  const value = String(content || '');
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://youtu.be/${value}`;
}

function PostForm({ post, onClose, onSaved }) {
  const editing = Boolean(post);
  const toast = useToast();
  const [isVideo, setIsVideo] = useState(post ? Boolean(post.isVideo) : false);
  const [link, setLink] = useState(post && post.isVideo ? videoLink(post.content) : '');
  const [content, setContent] = useState(post && !post.isVideo ? (post.content || '') : '');
  const [reference, setReference] = useState(post ? (post.reference || '') : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Accept the URL forms people actually paste. The stored value is only the
  // id, because the card builds `embed/<id>`; storing a full watch URL would
  // make the player request embed/https://... and fail.
  function extractId(raw) {
    const value = String(raw || '').trim();
    const match = value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)
      || value.match(/[?&]v=([A-Za-z0-9_-]{6,})/)
      || value.match(/\/embed\/([A-Za-z0-9_-]{6,})/)
      || value.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
    return match ? match[1] : value;
  }

  const canSave = isVideo ? Boolean(link.trim()) : Boolean(content.trim());

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        content: isVideo ? extractId(link) : content,
        reference,
        isVideo,
      };
      const result = editing ? await api.update(post._id, payload) : await api.create(payload);
      await onSaved(result && result.post);
      if (editing) toast('Post updated');
      else if (result && result.held) toast('Post shared - it will appear after review');
      else toast('Post shared');
    } catch (err) {
      if (err.status === 401) setError('Sign in to save this post.');
      else if (err.status === 403) setError('You can only edit your own posts.');
      else if (err.status === 429 && err.body?.error === 'rate-limited') {
        const minutes = Math.max(1, Math.ceil((Number(err.body.retryAfter) || 0) / 60));
        setError(`You are posting too often. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      }
      else setError(editing ? 'Could not save those changes.' : 'Could not save that post.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container1">
      <div className="card-header">
        <h3>{editing ? (isVideo ? 'Edit Video' : 'Edit Post') : 'New Post'}</h3>
      </div>

      {!editing && (
        <div className="post-compose-types" role="group" aria-label="Post type">
          <button type="button" className={`btn ${isVideo ? 'btn-outline' : 'btn-primary'}`}
                  onClick={() => setIsVideo(false)} aria-pressed={!isVideo}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>edit_note</span>
            Text
          </button>
          <button type="button" className={`btn ${isVideo ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setIsVideo(true)} aria-pressed={isVideo}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>videocam</span>
            Video
          </button>
        </div>
      )}

      {isVideo && (
        <div className="form-floating">
          <input className="form-control" type="url" value={link} onChange={(e) => setLink(e.target.value)}
                 placeholder="https://youtu.be/..." />
          <label>Video link</label>
        </div>
      )}

      {!isVideo && (
        <div className="form-floating">
          <textarea className="form-control" rows={4} value={content} onChange={(e) => setContent(e.target.value)}
                    placeholder="Write something…" />
          <label>Content</label>
        </div>
      )}

      <div className="form-floating">
        <input className="form-control" type="text" value={reference} onChange={(e) => setReference(e.target.value)}
               placeholder={isVideo ? 'Description' : 'Reference'} />
        <label>{isVideo ? 'Description' : 'Reference'}</label>
      </div>

      {error && <div className="auth-alert" role="alert"><span className="material-symbols-rounded">error</span>{error}</div>}

      <div className="new-task">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={saving || !canSave}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save'}
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export function PostPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, post: null, permalinkBase: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, post: null, permalinkBase: '' });
    api.one(id)
      .then((data) => { if (!cancelled) setState({ loading: false, post: data.post, permalinkBase: data.permalinkBase || '' }); })
      .catch(() => { if (!cancelled) setState({ loading: false, post: null, permalinkBase: '' }); });
    return () => { cancelled = true; };
  }, [id]);

  if (state.loading) return <Loader variant="page" label="Loading post" />;
  if (!state.post) return <NotFound />;

  const post = state.post;
  return (
    <>
      <div className="page-header">
        <h1>Post</h1>
        <p>
          {post.author && post.author.username ? (
            <Link className="post-author" to={`/u/${post.author.username}`}>
              <Avatar className="post-author-avatar" src={post.author.avatarUrl}
                      name={post.author.name || post.author.username} />
              <span className="post-author-name">{post.author.name || post.author.username}</span>
              {post.author.name && post.author.name !== post.author.username && (
                <span className="post-author-handle">@{post.author.username}</span>
              )}
            </Link>
          ) : post.authorName ? (
            <span className="post-author post-author-anonymous">{post.authorName}</span>
          ) : null}
        </p>
      </div>

      <PostCard
        post={post}
        permalinkBase={state.permalinkBase}
        onChanged={(updated) => setState((s) => ({ ...s, post: updated }))}
        onDeleted={() => navigate('/posts')}
        onBlocked={() => navigate('/posts')}
      />
      <p className="post-back"><Link to="/posts">&larr; Back to all posts</Link></p>
    </>
  );
}

export function ProfilePage() {
  const { username } = useParams();
  const { isLoggedIn } = useSession();
  const { refresh: refreshBadge } = useUnreadNotifications();
  const toast = useToast();
  const ask = useConfirm();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, data: null });
  // One flag for the friendship controls; the profile is re-read after every
  // action so the badge and the button can never disagree.
  const [friendBusy, setFriendBusy] = useState(false);
  const [tab, setTab] = useState('posts');
  // Friend requests are answered from the profile now, so pending lists are
  // fetched only when the viewer is looking at their own profile.
  const [pending, setPending] = useState({ incoming: [], outgoing: [] });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  // "People you may know" strip at the top of the owner's friends tab.
  const [suggestions, setSuggestions] = useState([]);

  const [loadingMore, setLoadingMore] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api.profile(username);
      // A re-read after a friend action brings back only the newest page.
      // Keep the older posts the reader had already loaded below it.
      setState((prev) => {
        const loaded = prev.data && Array.isArray(prev.data.posts) ? prev.data.posts : [];
        const fresh = data.posts || [];
        const oldest = fresh.length ? fresh[fresh.length - 1]._id : null;
        const older = oldest ? loaded.filter((post) => post._id < oldest) : [];
        if (!older.length) return { loading: false, data };
        return {
          loading: false,
          data: { ...data, posts: fresh.concat(older), hasMore: prev.data.hasMore, nextCursor: prev.data.nextCursor },
        };
      });
      return data;
    } catch (err) {
      setState({ loading: false, data: null });
      return null;
    }
  }, [username]);

  const loadPending = useCallback(async () => {
    try {
      const data = await friendsApi.list();
      setPending({ incoming: data.incoming || [], outgoing: data.outgoing || [] });
    } catch (err) {
      // The friend list on the profile is still usable without the pending rows.
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try {
      const data = await friendsApi.suggestions();
      setSuggestions(data.users || []);
    } catch (err) {
      // The row is an extra; the rest of the friends tab stands without it.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null });
    api.profile(username)
      .then((data) => { if (!cancelled) setState({ loading: false, data }); })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null }); });
    return () => { cancelled = true; };
  }, [username]);

  const ownsProfile = Boolean(state.data && state.data.isOwner && isLoggedIn);

  useEffect(() => {
    if (!ownsProfile) return;
    loadPending();
    loadSuggestions();
  }, [ownsProfile, loadPending, loadSuggestions]);

  async function addFriend(target) {
    if (!isLoggedIn) {
      navigate('/login');
      return;
    }
    setFriendBusy(true);
    try {
      await friendsApi.request(target);
      toast('Friend request sent');
      setResults((current) => (current || []).map((entry) => (
        entry.username === target ? { ...entry, relation: 'outgoing' } : entry
      )));
      // The card has served its purpose; leaving it would offer a second Add.
      setSuggestions((current) => current.filter((entry) => entry.username !== target));
      await reload();
      if (ownsProfile) await loadPending();
      refreshBadge();
    } catch (err) {
      toast(
        err && err.status === 404 ? 'That username could not be found.' : 'Could not send that request.',
        { kind: 'error' }
      );
    } finally {
      setFriendBusy(false);
    }
  }

  async function acceptFriend(friendshipId) {
    setFriendBusy(true);
    try {
      await friendsApi.accept(friendshipId);
      toast('Friend request accepted');
      setResults((current) => (current || []).map((entry) => (
        entry.friendshipId === friendshipId ? { ...entry, relation: 'friends' } : entry
      )));
      await reload();
      if (ownsProfile) await loadPending();
      refreshBadge();
    } catch (err) {
      toast('Could not accept that request.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  async function declineFriend(friendshipId) {
    setFriendBusy(true);
    try {
      await friendsApi.decline(friendshipId);
      toast('Friend request declined', { kind: 'delete' });
      setResults((current) => (current || []).map((entry) => (
        entry.friendshipId === friendshipId ? { ...entry, relation: 'none', friendshipId: null } : entry
      )));
      await reload();
      if (ownsProfile) await loadPending();
      // Declining deletes the row, so they are suggestible again.
      if (ownsProfile) await loadSuggestions();
      refreshBadge();
    } catch (err) {
      toast('Could not decline that request.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  async function removeFriend(target) {
    const ok = await ask({
      title: `Remove ${target}?`,
      message: 'You can send a new friend request later.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setFriendBusy(true);
    try {
      await friendsApi.remove(target);
      toast('Friend removed', { kind: 'delete' });
      setResults((current) => (current || []).map((entry) => (
        entry.username === target ? { ...entry, relation: 'none', friendshipId: null } : entry
      )));
      await reload();
      if (ownsProfile) await loadPending();
      // A removed friend is a candidate again.
      if (ownsProfile) await loadSuggestions();
      refreshBadge();
    } catch (err) {
      toast('Could not remove that friend.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  // Blocking is a viewer-side action, so it lives on the profile rather than
  // only on the account page. The server also deletes the friendship row; the
  // confirm text says so before the person commits, because that part cannot
  // be undone by unblocking.
  async function blockUser() {
    if (friendBusy || !state.data) return;
    const { owner, friendship: relation } = state.data;
    const target = owner.username || 'this account';
    const isFriend = relation && relation.state === 'friends';

    const ok = await ask({
      title: isFriend
        ? `Block @${target} and remove them as a friend?`
        : `Block @${target}?`,
      message: isFriend
        ? 'Blocking removes them from your friends and hides their posts and profile from you. They are not told, and unblocking will not restore the friendship.'
        : 'Their posts and profile will be hidden from you. They are not told, and you can unblock them later.',
      confirmLabel: 'Block',
      danger: true,
    });
    if (!ok) return;

    setFriendBusy(true);
    try {
      await api.block(owner.id);
      toast(`Blocked @${target}`, { kind: 'delete' });
      await reload();
    } catch (err) {
      toast('Could not block that account.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  async function unblockUser() {
    if (friendBusy || !state.data) return;
    const target = state.data.owner.username || 'that account';

    setFriendBusy(true);
    try {
      await api.unblock(state.data.owner.id);
      toast(`Unblocked @${target}`);
      await reload();
    } catch (err) {
      toast('Could not unblock that account.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  async function cancelRequest(entry) {
    const ok = await ask({
      title: `Cancel your request to ${personName(entry)}?`,
      message: 'They will no longer see it.',
      confirmLabel: 'Cancel request',
      danger: true,
    });
    if (!ok) return;
    setFriendBusy(true);
    try {
      await friendsApi.remove(entry.username);
      toast('Friend request cancelled', { kind: 'delete' });
      await reload();
      await loadPending();
      refreshBadge();
    } catch (err) {
      toast('Could not cancel that request.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  async function search(event) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await friendsApi.search(term);
      setResults(data.users || []);
    } catch (err) {
      setResults([]);
      toast('Could not search usernames.', { kind: 'error' });
    } finally {
      setSearching(false);
    }
  }

  if (state.loading) return <Loader variant="page" label="Loading profile" />;
  if (!state.data) return <NotFound />;

  const { owner, posts, permalinkBase, isOwner, blocked = false, friendship, friendCount, friends = [] } = state.data;
  // The profile's total, which is more than the posts loaded so far.
  const postCount = typeof state.data.postCount === 'number' ? state.data.postCount : posts.length;

  const loadMorePosts = async () => {
    if (loadingMore || !state.data.hasMore || !state.data.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.profile(username, { before: state.data.nextCursor });
      setState((s) => (s.data ? {
        ...s,
        data: { ...s.data, posts: appendPosts(s.data.posts, page.posts), hasMore: Boolean(page.hasMore), nextCursor: page.nextCursor || null },
      } : s));
    } catch (err) {
      // Leave the button in place so the reader can try again.
    } finally {
      setLoadingMore(false);
    }
  };
  const relationship = friendship ? friendship.state : 'none';
  const ownerName = owner.displayName || owner.name || owner.username;
  const shareUrl = (permalinkBase || '') + '/u/' + owner.username;

  return (
    <>
      <div className="profile-header">
        <button
          type="button"
          className="profile-share-btn"
          data-share-url={shareUrl}
          title="Share profile"
          aria-label="Share profile"
        >
          <span className="material-symbols-rounded" aria-hidden="true">share</span>
        </button>
        <Avatar className="profile-avatar" src={owner.avatarUrl} name={ownerName} />
        <div className="profile-meta">
          <h1 className="profile-handle">{ownerName}</h1>
          {/* Only when the friendly name is not just the handle again. */}
          {personHandle(owner) && (
            <p className="profile-handle-sub">{personHandle(owner)}</p>
          )}
          <p className="profile-stats">
            <strong>{postCount}</strong> {postCount === 1 ? 'post' : 'posts'}
            <span className="profile-stat-sep">·</span>
            <strong>{friendCount || 0}</strong> {(friendCount || 0) === 1 ? 'friend' : 'friends'}
            {isOwner && <span className="profile-badge">This is you</span>}
            {!isOwner && blocked && <span className="profile-badge profile-badge-blocked">Blocked</span>}
            {!isOwner && !blocked && relationship === 'friends' && <span className="profile-badge">Friends</span>}
          </p>
        </div>
        <div className="profile-actions">
          {!isOwner && !blocked && relationship === 'none' && (
            <button type="button" className="btn btn-primary" disabled={friendBusy} onClick={() => addFriend(owner.username)}>
              <span className="material-symbols-rounded icon-inline" aria-hidden="true">person_add</span>
              Add friend
            </button>
          )}
          {!isOwner && !blocked && relationship === 'outgoing' && (
            <span className="profile-friend-state">Request sent</span>
          )}
          {!isOwner && !blocked && relationship === 'incoming' && friendship && (
            <div className="profile-friend-actions">
              <button type="button" className="btn btn-primary" disabled={friendBusy}
                      onClick={() => acceptFriend(friendship.friendshipId)}>
                Accept
              </button>
              <button type="button" className="btn btn-outline" disabled={friendBusy}
                      onClick={() => declineFriend(friendship.friendshipId)}>
                Decline
              </button>
            </div>
          )}
          {!isOwner && !blocked && relationship === 'friends' && (
            <button type="button" className="btn btn-outline" disabled={friendBusy} onClick={() => removeFriend(owner.username)}>
              Remove friend
            </button>
          )}
          {!isOwner && blocked && (
            <button type="button" className="btn btn-outline" disabled={friendBusy} onClick={unblockUser}>
              Unblock
            </button>
          )}
          {!isOwner && !blocked && isLoggedIn && (
            <button type="button" className="btn btn-danger-outline" disabled={friendBusy} onClick={blockUser}>
              <span className="material-symbols-rounded icon-inline" aria-hidden="true">block</span>
              Block
            </button>
          )}
        </div>
      </div>

      {blocked ? (
        <div className="profile-blocked-panel">
          <span className="material-symbols-rounded" aria-hidden="true">block</span>
          <h2>You blocked {ownerName}{personHandle(owner) ? ` (${personHandle(owner)})` : ''}</h2>
          <p>Their posts and friend list are hidden from you. Unblock them to see this profile again.</p>
        </div>
      ) : (
        <>
          {/* The header above is rendered once and the navigator sits under it, so
              switching sections never redraws who you are looking at. */}
          <div className="profile-tabs" role="tablist" aria-label="Profile sections">
            <button
              type="button"
              role="tab"
              id="profile-tab-posts"
              aria-selected={tab === 'posts'}
              aria-controls="profile-panel-posts"
              className={`profile-tab${tab === 'posts' ? ' is-active' : ''}`}
              onClick={() => setTab('posts')}
            >
              <span className="material-symbols-rounded" aria-hidden="true">post</span>
              Posts
              <span className="profile-tab-count">{postCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="profile-tab-friends"
              aria-selected={tab === 'friends'}
              aria-controls="profile-panel-friends"
              className={`profile-tab${tab === 'friends' ? ' is-active' : ''}`}
              onClick={() => setTab('friends')}
            >
              <span className="material-symbols-rounded" aria-hidden="true">group</span>
              Friends
              <span className="profile-tab-count">{friendCount || 0}</span>
            </button>
          </div>

          {tab === 'posts' ? (
            <div className="profile-panel" role="tabpanel" id="profile-panel-posts" aria-labelledby="profile-tab-posts">
              {posts.length === 0 ? (
                <p className="post-empty">{isOwner ? 'You have not posted anything yet.' : 'This user has not posted anything yet.'}</p>
              ) : (
                posts.map((post) => (
                  <PostCard
                    key={post._id}
                    post={post}
                    permalinkBase={permalinkBase}
                    // The profile payload leaves `author` as an id, so ownership comes
                    // from the profile-level flag rather than from the post itself.
                    canManage={isOwner}
                    onChanged={(updated) => setState((s) => (s.data ? {
                      ...s,
                      data: { ...s.data, posts: s.data.posts.map((p) => (p._id === updated._id ? updated : p)) },
                    } : s))}
                    onDeleted={(deleted) => setState((s) => (s.data ? {
                      ...s,
                      data: {
                        ...s.data,
                        posts: s.data.posts.filter((p) => p._id !== deleted._id),
                        postCount: typeof s.data.postCount === 'number' ? Math.max(0, s.data.postCount - 1) : s.data.postCount,
                      },
                    } : s))}
                    onBlocked={() => setState((s) => (s.data ? {
                      ...s,
                      data: {
                        ...s.data,
                        // A block from a post card on this page is the same
                        // viewer-side state the header handles: drop the posts
                        // and friendship so the panel replaces the tabs, rather
                        // than leaving an empty profile with a live Block button.
                        blocked: true,
                        posts: [],
                        friends: [],
                        friendCount: 0,
                        friendship: { state: 'none' },
                      },
                    } : s))}
                  />
                ))
              )}
              <LoadMore hasMore={Boolean(state.data.hasMore)} busy={loadingMore} onMore={loadMorePosts} />
            </div>
          ) : (
            <div className="profile-panel profile-friends" role="tabpanel" id="profile-panel-friends" aria-labelledby="profile-tab-friends">
              {isOwner && (
                <>
                  {/* The same "people you may know" idea as Instagram: a row of
                      identity cards that scrolls sideways, each one offering the
                      single action that matters here - Add. */}
                  {suggestions.length > 0 && (
                    <section className="profile-friends-block" aria-label="Suggested friends">
                      <h3 className="profile-friends-title">Suggested for you</h3>
                      <div className="friend-suggestions-scroll">
                        {suggestions.map((entry) => (
                          <article className="friend-suggestion" key={entry.id}>
                            <Link
                              className="friend-suggestion-avatar"
                              to={`/u/${entry.username}`}
                              aria-label={`Open ${personName(entry)}’s profile`}
                            >
                              <Avatar className="avatar-fill" src={entry.avatarUrl} name={personName(entry)} />
                            </Link>
                            <Link className="friend-suggestion-handle" to={`/u/${entry.username}`}>
                              {personName(entry)}
                            </Link>
                            {personHandle(entry) && (
                              <span className="friend-suggestion-sub">{personHandle(entry)}</span>
                            )}
                            <span className="friend-suggestion-meta">
                              {entry.mutualCount > 0
                                ? `${entry.mutualCount} mutual friend${entry.mutualCount === 1 ? '' : 's'}`
                                : 'New here'}
                            </span>
                            <button
                              type="button"
                              className="friend-suggestion-add"
                              disabled={friendBusy}
                              onClick={() => addFriend(entry.username)}
                            >
                              Add
                            </button>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  <form className="friend-search" onSubmit={search}>
                    <input
                      className="form-control"
                      type="search"
                      value={query}
                      placeholder="Find by username"
                      aria-label="Find friends by username"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck="false"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <button type="submit" className="btn btn-primary" disabled={searching || query.trim().length < 2}>
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </form>

                  {results !== null && (
                    <div className="friend-result-list">
                      {results.length === 0 ? (
                        <p className="friend-empty">No usernames matched.</p>
                      ) : (
                        results.map((entry) => (
                          <div className="friend-result" key={entry.id}>
                            <Avatar className="friend-avatar" src={entry.avatarUrl} name={personName(entry)} />
                            <div className="friend-identity">
                              <Link className="friend-handle" to={`/u/${entry.username}`}>{personName(entry)}</Link>
                              {personHandle(entry) && <span className="friend-since">{personHandle(entry)}</span>}
                            </div>
                            <div className="friend-action">
                              {entry.relation === 'friends' && <span className="friend-relation">Friends</span>}
                              {entry.relation === 'outgoing' && <span className="friend-relation">Requested</span>}
                              {entry.relation === 'incoming' && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={friendBusy}
                                  onClick={() => acceptFriend(entry.friendshipId)}
                                >
                                  Accept
                                </button>
                              )}
                              {entry.relation === 'none' && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  disabled={friendBusy}
                                  onClick={() => addFriend(entry.username)}
                                >
                                  Add friend
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {pending.incoming.length > 0 && (
                    <section className="profile-friends-block">
                      <h3 className="profile-friends-title">Requests</h3>
                      <div className="friends-list">
                        {pending.incoming.map((entry) => (
                          <div className="friend-row" key={entry.friendshipId}>
                            <Avatar className="friend-avatar" src={entry.avatarUrl} name={personName(entry)} />
                            <div className="friend-identity">
                              <Link className="friend-handle" to={`/u/${entry.username}`}>{personName(entry)}</Link>
                              <span className="friend-since">{personHandle(entry) || 'Wants to be friends'}</span>
                            </div>
                            <div className="friend-action">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={friendBusy}
                                onClick={() => acceptFriend(entry.friendshipId)}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                disabled={friendBusy}
                                onClick={() => declineFriend(entry.friendshipId)}
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {pending.outgoing.length > 0 && (
                    <section className="profile-friends-block">
                      <h3 className="profile-friends-title">Sent requests</h3>
                      <div className="friends-list">
                        {pending.outgoing.map((entry) => (
                          <div className="friend-row" key={entry.friendshipId}>
                            <Avatar className="friend-avatar" src={entry.avatarUrl} name={personName(entry)} />
                            <div className="friend-identity">
                              <Link className="friend-handle" to={`/u/${entry.username}`}>{personName(entry)}</Link>
                              <span className="friend-since">{personHandle(entry) || 'Request sent'}</span>
                            </div>
                            <button
                              type="button"
                              className="friend-remove"
                              title="Cancel request"
                              aria-label={`Cancel friend request to ${personName(entry)}`}
                              disabled={friendBusy}
                              onClick={() => cancelRequest(entry)}
                            >
                              <span className="material-symbols-rounded" aria-hidden="true">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}

              <section className="profile-friends-block">
                <h3 className="profile-friends-title">
                  {isOwner ? 'Your friends' : `${ownerName}'s friends`}
                </h3>
                {friends.length === 0 ? (
                  <p className="friend-empty">
                    {isOwner
                      ? `No friends yet. Share /u/${owner.username} to get requests.`
                      : 'No friends yet.'}
                  </p>
                ) : (
                  <div className="friends-list">
                    {friends.map((friend) => (
                      <div className="friend-row" key={friend.id}>
                        <Avatar className="friend-avatar" src={friend.avatarUrl} name={personName(friend)} />
                        <div className="friend-identity">
                          <Link className="friend-handle" to={`/u/${friend.username}`}>{personName(friend)}</Link>
                          <span className="friend-since">
                            {personHandle(friend) && `${personHandle(friend)} · `}
                            Friends since {new Date(friend.since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                        {isOwner && (
                          <button
                            type="button"
                            className="friend-remove"
                            aria-label={`Remove ${personName(friend)}`}
                            title="Remove friend"
                            disabled={friendBusy}
                            onClick={() => removeFriend(friend.username)}
                          >
                            <span className="material-symbols-rounded" aria-hidden="true">close</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
