import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPPORT_EMAIL } from '../utils/contact';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { api, account, posts as postsApi, contact, ApiError } from '../services/api';
import { useSession } from '../hooks/useSession.jsx';
import { useToast } from '../components/ToastProvider';
import Loader from '../components/Loader';
import Avatar from '../components/Avatar';
import AvatarUploader from '../components/AvatarUploader';
import FormSelect from '../components/FormSelect';

// Map the username route's error codes to plain sentences - the raw codes
// ("taken", "invalid-username") are for programs, not for people.
const USERNAME_ERRORS = {
  taken: 'That username is already in use. Try another.',
  'invalid-username': 'Usernames are 3-30 letters, numbers, dots or underscores.',
  reserved: 'That username is reserved. Try another.',
  'wrong-password': 'That password is not correct.'
};

// The password route answers with the same short codes the signup form uses,
// so the sentences stay consistent with the rest of the auth screens.
const PASSWORD_ERRORS = {
  'password-required': 'Enter your current password.',
  'wrong-password': 'That current password is not correct.',
  'weak-password': 'Your new password must be at least 8 characters.',
  mismatch: 'The new passwords do not match.',
  'same-password': 'Choose a password different from your current one.'
};

// Markup mirrors views/account.ejs (.account-card, .account-avatar,
// .account-handle, .username-input, .tg-hint).
export default function AccountPage() {
  const [state, setState] = useState({ loading: true, data: null });
  const [username, setUsername] = useState('');
  // The handle reads as text until the pencil opens it - an account's identity
  // is not something a stray tap should change.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The friendly display name is optional, not unique, and safe to edit without
  // re-proving the password. Kept separate from the unique @username.
  const [displayName, setDisplayName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  // Changing the handle asks for the password first, in its own small modal -
  // the same re-proof account deletion demands.
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // Password change lives in its own modal with its own three fields, so a
  // half-typed handle change cannot be submitted alongside it.
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  // The picked file only exists to feed the cropper. Nothing is uploaded until
  // the crop modal says so, and cancelling simply drops it.
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef(null);
  // Accounts this person has blocked. Loaded alongside the profile; the block
  // menu lives on every post, so the undo lives here.
  const [blocked, setBlocked] = useState([]);
  const [blockedBusy, setBlockedBusy] = useState('');
  // Contact the admin: an in-app message or an email opened in the visitor's
  // mail app. The replies come back as notifications and are listed here.
  const [contactMethod, setContactMethod] = useState('message');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState('');
  const [contactMessages, setContactMessages] = useState([]);
  const [contactMessagesOpen, setContactMessagesOpen] = useState(false);
  const [contactMessagesLoading, setContactMessagesLoading] = useState(false);
  const [contactMessagesLoaded, setContactMessagesLoaded] = useState(false);
  const { refresh } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(async () => {
    try {
      const data = await api.get('/account');
      setState({ loading: false, data });
      setUsername(data.username || '');
      setDisplayName(data.name || '');
    } catch (err) {
      setState({ loading: false, data: null });
    }

    try {
      const data = await postsApi.blocks();
      setBlocked(data.users || []);
    } catch (err) {
      // The rest of the account page still works without this list.
      setBlocked([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A reply notification links here; open the message list and scroll to it.
  useEffect(() => {
    if (location.hash !== '#contact-admin') return;
    toggleContactMessages(true);
    document.getElementById('contact-admin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  async function unblock(person) {
    if (blockedBusy) return;
    setBlockedBusy(person.id);
    try {
      await postsApi.unblock(person.id);
      setBlocked((current) => current.filter((entry) => entry.id !== person.id));
      toast(`Unblocked ${person.displayName || (person.username ? '@' + person.username : person.name || 'that account')}`);
    } catch (err) {
      toast('Could not unblock that account.', { kind: 'error' });
    } finally {
      setBlockedBusy('');
    }
  }

  async function sendContact(event) {
    event.preventDefault();
    if (contactBusy) return;
    const message = contactMessage.trim();
    if (message.length < 5) {
      setContactError('Write at least a few words so the admin can help.');
      return;
    }
    if (contactMethod === 'email') {
      const subject = (contactSubject.trim() || 'Hasanath feedback').slice(0, 120);
      const body = [
        message,
        '',
        `From: ${state.data && state.data.email ? state.data.email : ''}`,
        `Account: ${state.data && state.data.username ? '@' + state.data.username : ''}`,
      ].join('\n');
      const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
      setContactSubject('');
      setContactMessage('');
      toast('Opening your mail app…');
      return;
    }
    setContactBusy(true);
    setContactError('');
    try {
      const result = await contact.send({ subject: contactSubject.trim(), message });
      setContactMessages((current) => [result.message, ...current]);
      setContactMessagesLoaded(true);
      setContactMessagesOpen(true);
      setContactSubject('');
      setContactMessage('');
      toast('Message sent to the admin. You will get a reply in your notifications.');
    } catch (err) {
      setContactError((err.body && err.body.error) === 'too-short'
        ? 'Write at least a few words so the admin can help.'
        : 'Could not send that message. Try again.');
    } finally {
      setContactBusy(false);
    }
  }

  async function toggleContactMessages(forceOpen = false) {
    if (contactMessagesOpen && !forceOpen) {
      setContactMessagesOpen(false);
      return;
    }
    setContactMessagesOpen(true);
    if (contactMessagesLoaded) return;
    setContactMessagesLoading(true);
    try {
      const data = await contact.mine();
      setContactMessages(data.messages || []);
    } catch (err) {
      setContactMessages([]);
    } finally {
      setContactMessagesLoaded(true);
      setContactMessagesLoading(false);
    }
  }

  const closeEditor = () => {
    // Throw away the draft: the field shows the name the server has again.
    setEditing(false);
    setError('');
  };

  // The pencil only opens the field; the password modal appears when the
  // visitor commits to the change. A name identical to the saved one is not
  // a change and never reaches the password step.
  function requestSave() {
    if (!username.trim() || unchanged) return;
    setError('');
    setPassword('');
    setPasswordOpen(true);
  }

  async function save(event) {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/settings/username', { username, password });
      await load();
      await refresh();
      setPasswordOpen(false);
      setEditing(false);
      setPassword('');
      toast('Username updated');
    } catch (err) {
      const code = err instanceof ApiError && err.body?.error;
      if (code === 'wrong-password') {
        // Keep the modal open; the sentence replaces the generic one.
        setDeleteError(USERNAME_ERRORS[code]);
      } else {
        setError(USERNAME_ERRORS[code] || 'Could not update your username.');
        setPasswordOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  const closeDelete = () => {
    setDeleteOpen(false);
    setPassword('');
    setDeleteError('');
  };

  function requestNameSave() {
    if (nameSaving) return;
    setNameError('');
    saveDisplayName();
  }

  async function saveDisplayName() {
    if (nameSaving) return;
    setNameSaving(true);
    setNameError('');
    try {
      const result = await api.post('/account/display-name', { name: displayName });
      setState((current) => (current.data
        ? {
          ...current,
          data: {
            ...current.data,
            name: result.name || '',
            displayName: result.displayName || result.name || current.data.username
          }
        }
        : current));
      setDisplayName(result.name || '');
      setNameEditing(false);
      // The navbar reads the session copy, so refresh it immediately.
      await refresh();
      toast('Display name updated');
    } catch (err) {
      setNameError(err instanceof ApiError && err.body?.error === 'invalid-name'
        ? 'Choose a name with at least one visible character.'
        : 'Could not update your display name.');
    } finally {
      setNameSaving(false);
    }
  }

  function cancelNameEdit() {
    setNameEditing(false);
    setNameError('');
    setDisplayName((state.data && state.data.name) || '');
  }

  async function deleteAccount(event) {
    event.preventDefault();
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete('/account', { password });
      // The session record is destroyed server-side; drop the cached copy and
      // land on the public landing page.
      await refresh();
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'wrong-password') {
        setDeleteError('That password is not correct.');
      } else if (err instanceof ApiError && err.body?.error === 'password-required') {
        setDeleteError('Enter your password to continue.');
      } else {
        setDeleteError('Could not delete the account. Try again.');
      }
      setDeleting(false);
    }
  }

  const closePassword = () => {
    setPwOpen(false);
    setPwCurrent('');
    setPwNew('');
    setPwConfirm('');
    setPwError('');
  };

  async function savePassword(event) {
    event.preventDefault();
    if (pwSaving) return;
    setPwSaving(true);
    setPwError('');
    try {
      await api.post('/account/password', {
        currentPassword: pwCurrent,
        password: pwNew,
        cpassword: pwConfirm
      });
      closePassword();
      toast('Password updated. Other devices have been signed out.');
    } catch (err) {
      const code = err instanceof ApiError && err.body?.error;
      setPwError(PASSWORD_ERRORS[code] || 'Could not change your password.');
    } finally {
      setPwSaving(false);
    }
  }

  // Pick the source file, then hand it to the cropper. Only the cropped result
  // is uploaded, so an enormous original costs nothing on the wire.
  function pickAvatar(event) {
    const file = event.target.files && event.target.files[0];
    // Reset first so picking the same file again still fires onChange.
    event.target.value = '';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      toast('Choose an image file.', { kind: 'error' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast('That image is too large. Pick one under 15MB.', { kind: 'error' });
      return;
    }
    setAvatarFile(file);
  }

  async function avatarUploaded(url) {
    setAvatarFile(null);
    setState((current) => (current.data
      ? { ...current, data: { ...current.data, avatarUrl: url } }
      : current));
    // The navbar and every other screen read the session copy, so refresh it
    // rather than waiting for the next full page load.
    await refresh();
    toast('Profile photo updated');
  }

  async function removeAvatar() {
    if (avatarBusy) return;
    setAvatarBusy(true);
    try {
      await account.removeAvatar();
      setState((current) => (current.data
        ? { ...current, data: { ...current.data, avatarUrl: null } }
        : current));
      await refresh();
      toast('Profile photo removed');
    } catch (err) {
      toast('Could not remove your photo. Try again.', { kind: 'error' });
    } finally {
      setAvatarBusy(false);
    }
  }

  if (state.loading) return <Loader variant="page" label="Loading account" />;
  if (!state.data) {
    return <><div className="page-header"><h1>Account</h1></div>
      <div className="container1"><p className="post-empty">Sign in to view your account.</p></div></>;
  }

  const d = state.data;
  // The name as the server has it. Editing works on a copy: cancelling throws
  // the copy away, and a name that matches the saved one is not a change.
  const savedUsername = d.username || '';
  const unchanged = username.trim().toLowerCase() === savedUsername.toLowerCase();
  const savedName = d.name || '';
  const nameUnchanged = displayName.trim() === savedName.trim();

  return (
    <>
      <div className="page-header">
        <h1>Account</h1>
        <p>Your identity in Hasanath</p>
      </div>

      {error && (
        <div className="auth-alert" role="alert">
          <span className="material-symbols-rounded">error</span>
          {error}
        </div>
      )}

      <section className="account-card">
        <Avatar className="account-avatar" src={d.avatarUrl} name={d.displayName} />
        <div className="account-body">
          <div className="account-handle">{d.displayName}</div>
          <div className="account-sub">
            {d.username ? (
              <a href={`/u/${d.username}`} target="_blank" rel="noreferrer">@{d.username}</a>
            ) : (
              'No username yet - set one below to get a shareable profile link.'
            )}
          </div>
          <div className="account-photo-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => avatarInputRef.current && avatarInputRef.current.click()}
              disabled={avatarBusy}
            >
              <span className="material-symbols-rounded" aria-hidden="true">photo_camera</span>
              {d.avatarUrl ? 'Change photo' : 'Add photo'}
            </button>
            {d.avatarUrl && (
              <button
                type="button"
                className="btn btn-danger-outline btn-sm"
                onClick={removeAvatar}
                disabled={avatarBusy}
              >
                <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                Remove
              </button>
            )}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={pickAvatar}
            />
          </div>
        </div>
      </section>

      <section className="account-card">
        <div className="account-field">
          <label className="account-label" htmlFor="inputDisplayName">Display name</label>
          <p className="account-hint">
            The name Hasanath greets you with and shows on your profile. It does
            not have to be unique, and announcements can address you by it. Leave
            it empty to use your @username.
          </p>
          <div className={`username-input${nameEditing ? ' username-input-editing' : ''}`}>
            <input className="form-control display-name-input" type="text" name="displayName" id="inputDisplayName"
                   value={displayName} placeholder={d.username || 'Your name'}
                   maxLength={50} autoComplete="name"
                   readOnly={!nameEditing}
                   onChange={(e) => { setDisplayName(e.target.value); setNameError(''); }} />
            {nameEditing ? (
              <>
                <button type="button" className="btn btn-primary" onClick={requestNameSave}
                        disabled={nameSaving || nameUnchanged}>
                  <span className="material-symbols-rounded">check</span>
                  {nameSaving ? 'Saving…' : 'Update'}
                </button>
                <button type="button" className="btn btn-outline" onClick={cancelNameEdit}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="fav-btn username-edit" aria-label="Edit display name" title="Edit display name"
                      onClick={() => { setNameEditing(true); setNameError(''); }}>
                <span className="material-symbols-rounded">edit</span>
              </button>
            )}
          </div>
          {nameError && (
            <p className="account-hint account-field-error" role="alert">{nameError}</p>
          )}
        </div>
      </section>

      <section className="account-card">
        <div className="account-field">
          <label className="account-label" htmlFor="inputUsername">Username</label>
          <p className="account-hint">
            This is your unique public handle. It appears on your posts and is how
            people find you at <code>/u/&lt;username&gt;</code>. Changing it breaks
            links people have already shared. Your display name above is the part
            that does not need to be unique.
          </p>
          <div className={`username-input${editing ? ' username-input-editing' : ''}`}>
            <input className="form-control" type="text" name="username" id="inputUsername"
                   value={username} placeholder="your-name"
                   pattern="[a-zA-Z0-9._]{3,30}" maxLength={30}
                   autoComplete="off" autoCapitalize="none" spellCheck="false"
                   readOnly={!editing}
                   onChange={(e) => { setUsername(e.target.value); setError(''); }} />
            {editing ? (
              <>
                <button type="button" className="btn btn-primary" onClick={requestSave}
                        disabled={saving || !username.trim() || unchanged}>
                  <span className="material-symbols-rounded">check</span>
                  Update
                </button>
                <button type="button" className="btn btn-outline"
                        onClick={() => { closeEditor(); setUsername(d.username || ''); }}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="fav-btn username-edit" aria-label="Edit username" title="Edit username"
                      onClick={() => { setEditing(true); }}>
                <span className="material-symbols-rounded">edit</span>
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="account-card">
        <div className="account-field">
          <label className="account-label">Email address</label>
          <p className="account-hint">
            {d.verified ? (
              <span className="account-verified">
                <span className="material-symbols-rounded">verified</span> Verified
              </span>
            ) : (
              <span className="account-unverified">
                <span className="material-symbols-rounded">info</span> Not verified
              </span>
            )}
            {d.verified ? '' : ' — this address predates email verification.'}
          </p>
          <div className="account-value">{d.email}</div>
          <p className="account-hint">
            Your email is only used to sign in and to receive verification codes. It is
            never shown on your posts or your public profile.
          </p>
        </div>
      </section>

      <section className="account-card">
        <div className="account-field">
          <label className="account-label">Password</label>
          <p className="account-hint">
            Used to sign in. Changing it keeps you signed in on this device, and you
            will need the new one next time.
          </p>
          <button type="button" className="btn btn-outline" onClick={() => {
            setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwError(''); setPwOpen(true);
          }}>
            <span className="material-symbols-rounded">lock</span>
            Change password
          </button>
        </div>
      </section>

      <section className="account-card">
        <div className="account-field">
          <label className="account-label">Blocked accounts</label>
          <p className="account-hint">
            Blocking hides someone's posts from your feed and profile. They are not
            told, and blocking someone also ends any friendship with them. You can
            undo it here at any time.
          </p>
          {blocked.length === 0 ? (
            <div className="account-value">You have not blocked anyone.</div>
          ) : (
            <ul className="blocked-list">
              {blocked.map((person) => (
                <li className="blocked-row" key={person.id}>
                  <Avatar
                    className="blocked-avatar"
                    src={person.avatarUrl}
                    name={person.displayName || person.username || person.name || '?'}
                  />
                  <span className="blocked-name">
                    {person.displayName || person.username || person.name || 'Account'}
                    {person.username && (person.displayName || person.name) !== person.username
                      ? ` (@${person.username})`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={blockedBusy === person.id}
                    onClick={() => unblock(person)}
                  >
                    {blockedBusy === person.id ? 'Unblocking…' : 'Unblock'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="account-card" id="contact-admin">
        <div className="account-field">
          <label className="account-label">Contact admin</label>
          <p className="account-hint">
            Send a question or suggestion. Choose an in-app message for a reply in
            your notifications, or email the team directly.
          </p>
          {contactError && (
            <div className="auth-alert" role="alert">
              <span className="material-symbols-rounded">error</span>
              {contactError}
            </div>
          )}
          <form onSubmit={sendContact} className="admin-form">
            <FormSelect
              id="contact-method"
              label="How to reach us"
              value={contactMethod}
              options={[
                { value: 'message', label: 'In-app message' },
                { value: 'email', label: `Email (${SUPPORT_EMAIL})` },
              ]}
              onChange={(value) => { setContactMethod(value); setContactError(''); }}
            />
            <label className="admin-field">
              <span className="account-label">Subject (optional)</span>
              <input
                className="form-control"
                type="text"
                maxLength={120}
                value={contactSubject}
                onChange={(event) => setContactSubject(event.target.value)}
                placeholder="Suggestion or question"
              />
            </label>
            <label className="admin-field">
              <span className="account-label">Message</span>
              <textarea
                className="form-control admin-textarea"
                rows={5}
                maxLength={2000}
                value={contactMessage}
                onChange={(event) => setContactMessage(event.target.value)}
                placeholder="Tell the admin what you need."
                required
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={contactBusy}>
              {contactBusy ? 'Sending…' : contactMethod === 'email' ? 'Open mail app' : 'Send message'}
            </button>
          </form>

          <div style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="challenge-completed-toggle"
              aria-expanded={contactMessagesOpen}
              aria-label={contactMessagesOpen ? 'Hide your messages' : 'Show your messages'}
              onClick={() => toggleContactMessages()}
            >
              <span>Your messages</span>
              <span className="material-symbols-rounded" aria-hidden="true">
                {contactMessagesOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {contactMessagesOpen && (
              <div style={{ marginTop: '0.75rem' }}>
                {contactMessagesLoading ? (
                  <Loader variant="page" label="Loading messages" />
                ) : contactMessages.length === 0 ? (
                  <p className="post-empty">No messages yet.</p>
                ) : (
                  contactMessages.map((item) => (
                    <article key={item.id} className="moderation-item">
                      <div className="moderation-meta">
                        <span>{new Date(item.createdAt).toLocaleString()} · {item.status}</span>
                      </div>
                      <p className="post-content" style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>
                      {item.adminReply && (
                        <div className="admin-preview">
                          <strong>Admin reply:</strong> {item.adminReply}
                          <div className="account-hint">{item.repliedAt ? new Date(item.repliedAt).toLocaleString() : ''}</div>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="account-danger">
        <h3><span className="material-symbols-rounded">delete_forever</span> Delete account</h3>
        <p>
          This erases everything - your salah record, challenges, charity goals and
          donations, posts, and this very account. It cannot be undone and it cannot
          be recovered.
        </p>
        <button type="button" className="btn btn-danger-outline" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </button>
      </section>

      {passwordOpen && (
        <div className="confirm-overlay" role="presentation">
          <form className="confirm-card" role="alertdialog" aria-modal="true" aria-label="Confirm username change"
                onSubmit={save} onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-title">Change your username?</h3>
            <p className="confirm-message">
              <strong>{d.username || 'your current handle'}</strong> becomes{' '}
              <strong>{username.trim()}</strong>. Links shared under the old name stop
              working. Confirm your password to continue.
            </p>
            <input
              className="form-control"
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              placeholder="Your password"
              autoFocus
              onChange={(e) => { setPassword(e.target.value); setDeleteError(''); }}
              style={{ marginTop: '0.9rem' }}
            />
            {deleteError && (
              <p className="confirm-message" role="alert" style={{ color: 'var(--color-danger)' }}>
                {deleteError}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline" onClick={() => { setPasswordOpen(false); setPassword(''); setDeleteError(''); }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || !password}>
                {saving ? 'Saving…' : 'Update'}
              </button>
            </div>
          </form>
        </div>
      )}

      {pwOpen && (
        <div className="confirm-overlay" role="presentation">
          <form className="confirm-card" role="alertdialog" aria-modal="true" aria-label="Change password"
                onSubmit={savePassword} onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-title">Change your password</h3>
            <p className="confirm-message">
              Confirm the password you use now, then choose a new one. At least 8
              characters.
            </p>
            <input
              className="form-control"
              type="password"
              name="currentPassword"
              value={pwCurrent}
              autoComplete="current-password"
              placeholder="Current password"
              autoFocus
              onChange={(e) => { setPwCurrent(e.target.value); setPwError(''); }}
              style={{ marginTop: '0.9rem' }}
            />
            <input
              className="form-control"
              type="password"
              name="password"
              value={pwNew}
              autoComplete="new-password"
              placeholder="New password"
              onChange={(e) => { setPwNew(e.target.value); setPwError(''); }}
              style={{ marginTop: '0.6rem' }}
            />
            <input
              className="form-control"
              type="password"
              name="cpassword"
              value={pwConfirm}
              autoComplete="new-password"
              placeholder="Confirm new password"
              onChange={(e) => { setPwConfirm(e.target.value); setPwError(''); }}
              style={{ marginTop: '0.6rem' }}
            />
            {pwError && (
              <p className="confirm-message" role="alert" style={{ color: 'var(--color-danger)' }}>
                {pwError}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline" onClick={closePassword}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={pwSaving || !pwCurrent || pwNew.length < 8 || !pwConfirm}>
                {pwSaving ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteOpen && (
        <div className="confirm-overlay" role="presentation">
          <form className="confirm-card" role="alertdialog" aria-modal="true" aria-label="Delete account"
                onSubmit={deleteAccount} onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-title">Delete your account?</h3>
            <p className="confirm-message">
              Everything goes - salah history, challenges, charity, posts. Confirm your
              password to prove it is you.
            </p>
            <input
              className="form-control"
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              placeholder="Your password"
              autoFocus
              onChange={(e) => { setPassword(e.target.value); setDeleteError(''); }}
              style={{ marginTop: '0.9rem' }}
            />
            {deleteError && (
              <p className="confirm-message" role="alert" style={{ color: 'var(--color-danger)' }}>
                {deleteError}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-outline" onClick={closeDelete}>Cancel</button>
              <button type="submit" className="btn btn-danger" disabled={deleting || !password}>
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </form>
        </div>
      )}

      {avatarFile && (
        <AvatarUploader
          file={avatarFile}
          onCancel={() => setAvatarFile(null)}
          onUploaded={avatarUploaded}
        />
      )}

      {/* Where to read what the app does with your information, its rules,
          and where its content comes from. */}
      <p className="account-legal">
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Use</Link>
        <Link to="/credits">Sources and credits</Link>
      </p>
    </>
  );
}
