import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { friends as friendsApi, posts as api } from '../services/api';
import { useUnreadNotifications } from '../hooks/useNotifications.jsx';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useSession } from '../hooks/useSession';
import Loader from '../components/Loader';
import NotFound from './NotFound';

// Reuses views/post-card.ejs's markup, which the shared stylesheet already
// styles. The card is factored out because the feed, a profile and a permalink
// all render it, and three copies is how they drift.
export function PostCard({ post, permalinkBase = '', canManage, onChanged, onDeleted }) {
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

  // Profile responses do not populate `author` (every post there belongs to the
  // profile owner), so that page passes an explicit canManage. Everywhere else
  // the post carries its populated author.
  const owned = canManage !== undefined
    ? canManage
    : Boolean(username && post.author && post.author.username === username);

  const handle = post.author && post.author.username ? post.author.username : null;
  const permalink = permalinkBase + '/post/' + post._id;
  const moreMenuId = `post-more-${post._id}`;

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

  // Instagram-style card order: author and posted date on top, media/content in
  // the middle, and every action together at the end. Putting the date where
  // the action row used to be keeps the top line balanced.
  const date = (
    <p className="post-date post-head-date">
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
          {owned && (
            <div className="post-more" ref={moreRef}>
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`post-card${post.isVideo ? ' post-card-video' : ''}`}>
      <div className="post-card-head">
        {handle ? (
          <Link className="post-author" to={`/u/${handle}`}>
            <span className="post-author-avatar" aria-hidden="true">{handle.charAt(0).toUpperCase()}</span>
            <span className="post-author-name">{handle}</span>
          </Link>
        ) : post.authorName ? (
          <span className="post-author post-author-anonymous">{post.authorName}</span>
        ) : null}

        {date}
      </div>

      {error && <p className="post-error" role="alert">{error}</p>}

      {post.isVideo ? (
        <>
          <div className="post-video-embed">
            <iframe src={`https://www.youtube.com/embed/${post.content}`} allowFullScreen title="Embedded video" />
          </div>
          {post.reference && <p className="post-reference">{post.reference}</p>}
          {actions}
        </>
      ) : (
        <>
          <p className="post-content">{post.content}</p>
          {post.reference && <p className="post-reference">Reference: {post.reference}</p>}
          {actions}
        </>
      )}
    </div>
  );
}

export function PostsPage() {
  const { isLoggedIn } = useSession();
  const [data, setData] = useState({ loading: true, posts: [], permalinkBase: '' });
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true }));
    try {
      const result = await api.list();
      setData({ loading: false, posts: result.posts || [], permalinkBase: result.permalinkBase || '' });
    } catch (err) {
      setData({ loading: false, posts: [], permalinkBase: '' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isLoggedIn) setFilter('all');
  }, [isLoggedIn]);

  const likedCount = data.posts.filter((post) => post.likedByMe).length;
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

      {data.loading ? <Loader variant="inline" label="Loading posts" /> : data.posts.length === 0 ? (
        <p className="post-empty">No posts yet.</p>
      ) : visiblePosts.length === 0 ? (
        <p className="post-empty">You have not liked any posts yet.</p>
      ) : (
        visiblePosts.map((post) => (
          <PostCard
            key={post._id}
            post={post}
            permalinkBase={data.permalinkBase}
            onChanged={(updated) => setData((d) => ({
              ...d,
              posts: d.posts.map((p) => (p._id === updated._id ? updated : p)),
            }))}
            onDeleted={(deleted) => setData((d) => ({
              ...d,
              posts: d.posts.filter((p) => p._id !== deleted._id),
            }))}
          />
        ))
      )}
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
      toast(editing ? 'Post updated' : 'Post shared');
    } catch (err) {
      if (err.status === 401) setError('Sign in to save this post.');
      else if (err.status === 403) setError('You can only edit your own posts.');
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
        <button type="button" className="btn btn-outline" style={{ marginLeft: '0.5rem' }} onClick={onClose}>Cancel</button>
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
              <span className="post-author-avatar" aria-hidden="true">{post.author.username.charAt(0).toUpperCase()}</span>
              <span className="post-author-name">{post.author.username}</span>
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

  const reload = useCallback(async () => {
    try {
      const data = await api.profile(username);
      setState({ loading: false, data });
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
    if (ownsProfile) loadPending();
  }, [ownsProfile, loadPending]);

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
      refreshBadge();
    } catch (err) {
      toast('Could not remove that friend.', { kind: 'error' });
    } finally {
      setFriendBusy(false);
    }
  }

  async function cancelRequest(entry) {
    const ok = await ask({
      title: `Cancel your request to ${entry.username}?`,
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

  const { owner, posts, permalinkBase, isOwner, friendship, friendCount, friends = [] } = state.data;
  const relationship = friendship ? friendship.state : 'none';
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
        <div className="profile-avatar" aria-hidden="true">{owner.username.charAt(0).toUpperCase()}</div>
        <div className="profile-meta">
          <h1 className="profile-handle">{owner.username}</h1>
          <p className="profile-stats">
            <strong>{posts.length}</strong> {posts.length === 1 ? 'post' : 'posts'}
            <span className="profile-stat-sep">·</span>
            <strong>{friendCount || 0}</strong> {(friendCount || 0) === 1 ? 'friend' : 'friends'}
            {isOwner && <span className="profile-badge">This is you</span>}
            {relationship === 'friends' && !isOwner && <span className="profile-badge">Friends</span>}
          </p>
        </div>
        <div className="profile-actions">
          {!isOwner && relationship === 'none' && (
            <button type="button" className="btn btn-primary" disabled={friendBusy} onClick={() => addFriend(owner.username)}>
              <span className="material-symbols-rounded icon-inline" aria-hidden="true">person_add</span>
              Add friend
            </button>
          )}
          {!isOwner && relationship === 'outgoing' && (
            <span className="profile-friend-state">Request sent</span>
          )}
          {!isOwner && relationship === 'incoming' && friendship && (
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
          {!isOwner && relationship === 'friends' && (
            <button type="button" className="btn btn-outline" disabled={friendBusy} onClick={() => removeFriend(owner.username)}>
              Remove friend
            </button>
          )}
        </div>
      </div>

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
          <span className="profile-tab-count">{posts.length}</span>
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
                  data: { ...s.data, posts: s.data.posts.filter((p) => p._id !== deleted._id) },
                } : s))}
              />
            ))
          )}
        </div>
      ) : (
        <div className="profile-panel profile-friends" role="tabpanel" id="profile-panel-friends" aria-labelledby="profile-tab-friends">
          {isOwner && (
            <>
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
                        <span className="friend-avatar" aria-hidden="true">
                          {entry.username.charAt(0).toUpperCase()}
                        </span>
                        <div className="friend-identity">
                          <Link className="friend-handle" to={`/u/${entry.username}`}>{entry.username}</Link>
                          {entry.name && <span className="friend-since">{entry.name}</span>}
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
                        <span className="friend-avatar" aria-hidden="true">
                          {entry.username.charAt(0).toUpperCase()}
                        </span>
                        <div className="friend-identity">
                          <Link className="friend-handle" to={`/u/${entry.username}`}>{entry.username}</Link>
                          <span className="friend-since">Wants to be friends</span>
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
                        <span className="friend-avatar" aria-hidden="true">
                          {entry.username.charAt(0).toUpperCase()}
                        </span>
                        <div className="friend-identity">
                          <Link className="friend-handle" to={`/u/${entry.username}`}>{entry.username}</Link>
                          <span className="friend-since">Request sent</span>
                        </div>
                        <button
                          type="button"
                          className="friend-remove"
                          title="Cancel request"
                          aria-label={`Cancel friend request to ${entry.username}`}
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
              {isOwner ? 'Your friends' : `${owner.username}'s friends`}
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
                    <span className="friend-avatar" aria-hidden="true">
                      {friend.username.charAt(0).toUpperCase()}
                    </span>
                    <div className="friend-identity">
                      <Link className="friend-handle" to={`/u/${friend.username}`}>{friend.username}</Link>
                      <span className="friend-since">
                        Friends since {new Date(friend.since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        className="friend-remove"
                        aria-label={`Remove ${friend.username}`}
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
  );
}