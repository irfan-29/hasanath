import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import Loader from '../components/Loader';

// One component for login / register / verify, because they are three steps of
// one flow and splitting them meant duplicating the form markup and the error
// handling three times.
//
// Markup mirrors views/login.ejs and views/verify-email.ejs (.auth-wrap,
// .auth-card, .auth-alert, .form-floating) so the shared stylesheet applies.

const MESSAGES = {
  'invalid-email': 'Enter a valid email address.',
  'weak-password': 'Password must be at least 6 characters.',
  'mismatch': 'Passwords do not match.',
  duplicate: 'That email is already registered.',
  'invalid-credentials': 'Invalid email or password.',
  'invalid-code': 'That code is not correct.',
  expired: 'That code has expired. Please start again.',
  'no-pending': 'That request has expired. Please start again.',
  'too-many-attempts': 'Too many incorrect attempts. Please request a new code.',
  'email-not-sent': 'We could not send the email. Please try again shortly.',
  'same-password': 'Choose a password different from the current one.'
};

export default function AuthPage({ mode: initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode); // login | register | verify | forgot | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [params] = useSearchParams();

  const returnTo = params.get('returnTo') || null;

  function go(target, nextMode) {
    setMode(nextMode);
    setError('');
    window.history.replaceState(null, '', target);
  }

  function done() {
    if (returnTo) { window.location.href = returnTo; return; }
    // "/" is the one place that knows the user's configured home. Sending
    // everyone to /account ignored that setting and made sign-in feel like a
    // detour. A full load is deliberate: the shell reads /api/app/meta, and the
    // session cookie only exists on a real navigation the browser has accepted.
    window.location.href = '/';
  }

  async function submitLogin(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/auth/login', { email, password });
      done();
    } catch (err) {
      setError(MESSAGES[err.body?.error] || 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api.post('/auth/register', { email, password, cpassword: confirm });
      setVerifyEmail(result.email);
      setCode('');
      go('/verify-email', 'verify');
    } catch (err) {
      setError(MESSAGES[err.body?.error] || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/auth/verify', { code });
      done();
    } catch (err) {
      const left = err.body?.attemptsLeft;
      setError(MESSAGES[err.body?.error] || 'Could not verify that code.' +
        (left ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : ''));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true); setError('');
    try {
      // The reset screen resends through its own endpoint; the signup screen
      // uses the pending-signup one.
      if (mode === 'reset') await api.post('/auth/forgot', { email: verifyEmail });
      else await api.post('/auth/resend', {});
      setCooldown(30);
    } catch (err) {
      if (err.body?.wait) setCooldown(err.body.wait);
      else setError(MESSAGES[err.body?.error] || 'Could not send another code.');
    } finally {
      setBusy(false);
    }
  }

  // Step one of a reset: ask for the code. The server answers the same way for
  // unknown addresses, so the next screen always says "if that address has an
  // account" rather than confirming whether it does.
  async function submitForgot(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/auth/forgot', { email });
      setVerifyEmail(email);
      setCode('');
      setPassword('');
      setConfirm('');
      setCooldown(30);
      go('/reset-password', 'reset');
    } catch (err) {
      setError(MESSAGES[err.body?.error] || 'Could not send the reset code.');
    } finally {
      setBusy(false);
    }
  }

  // Step two: the code plus the new password. Success signs the reader in,
  // because owning the mailbox is the same proof the login form asks for.
  async function submitReset(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/auth/reset', { code, password, cpassword: confirm });
      done();
    } catch (err) {
      const left = err.body?.attemptsLeft;
      setError((MESSAGES[err.body?.error] || 'Could not set that password.') +
        (left ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo material-symbols-rounded">
            {mode === 'verify' ? 'mark_email_read' : mode === 'forgot' || mode === 'reset' ? 'lock_reset' : 'mosque'}
          </span>
          <h1 className="auth-title">
            {mode === 'verify' ? 'Check your email' : mode === 'forgot' || mode === 'reset' ? 'Reset password' : 'Hasanath'}
          </h1>
          <p className="auth-sub">
            {mode === 'login' ? 'Welcome back'
              : mode === 'register' ? 'Create your account'
              : mode === 'forgot' ? 'Enter your email and we will send a 6-digit code.'
              : mode === 'reset' ? (verifyEmail
                  ? <>If <strong>{verifyEmail}</strong> has an account, a code is on its way.</>
                  : 'Enter the code we emailed you, then choose a new password.')
              : <>We sent a 6-digit code to <strong>{verifyEmail}</strong></>}
          </p>
        </div>

        {error && (
          <div className="auth-alert" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={submitLogin} className="auth-form">
            <div className="form-floating">
              <input className="form-control" type="email" id="email" name="email" required
                     autoComplete="email" placeholder="you@example.com"
                     value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="email">Email address</label>
            </div>

            <div className="form-floating">
              <input className="form-control" type="password" id="password" name="password" required minLength={6}
                     autoComplete="current-password" placeholder="••••••••"
                     value={password} onChange={(e) => setPassword(e.target.value)} />
              <label htmlFor="password">Password</label>
            </div>

            <p className="auth-hint auth-forgot">
              <a href="/forgot-password" onClick={(e) => { e.preventDefault(); setError(''); go('/forgot-password', 'forgot'); }}>
                Forgot password?
              </a>
            </p>

            <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={submitRegister} className="auth-form">
            <div className="form-floating">
              <input className="form-control" type="email" id="email" name="email" required
                     autoComplete="email" placeholder="you@example.com"
                     value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="email">Email address</label>
            </div>
            <div className="form-floating">
              <input className="form-control" type="password" id="password" name="password" required minLength={6}
                     autoComplete="new-password" placeholder="••••••••"
                     value={password} onChange={(e) => setPassword(e.target.value)} />
              <label htmlFor="password">Password</label>
            </div>
            <div className="form-floating">
              <input className="form-control" type="password" id="cpassword" name="cpassword" required minLength={6}
                     autoComplete="new-password" placeholder="••••••••"
                     value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <label htmlFor="cpassword">Confirm password</label>
            </div>
            <p className="auth-hint">At least 6 characters.</p>
            <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>
        )}

        {mode === 'verify' && (
          <form onSubmit={submitVerify} className="auth-form">
            <div className="form-floating">
              <input className="form-control" type="text" id="code" name="code" required
                     inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus
                     autoComplete="one-time-code" placeholder="000000"
                     value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <label htmlFor="code">Verification code</label>
            </div>
            <p className="auth-hint">The code expires in 10 minutes.</p>
            <button type="submit" className="btn btn-primary auth-submit" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={submitForgot} className="auth-form">
            <div className="form-floating">
              <input className="form-control" type="email" id="forgot-email" name="email" required
                     autoComplete="email" placeholder="you@example.com" autoFocus
                     value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="forgot-email">Email address</label>
            </div>
            <p className="auth-hint">We will email a 6-digit code so you can choose a new password.</p>
            <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset code'}
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={submitReset} className="auth-form">
            <div className="form-floating">
              <input className="form-control" type="text" id="reset-code" name="code" required
                     inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus
                     autoComplete="one-time-code" placeholder="000000"
                     value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <label htmlFor="reset-code">Reset code</label>
            </div>
            <div className="form-floating">
              <input className="form-control" type="password" id="new-password" name="password" required minLength={6}
                     autoComplete="new-password" placeholder="••••••••"
                     value={password} onChange={(e) => setPassword(e.target.value)} />
              <label htmlFor="new-password">New password</label>
            </div>
            <div className="form-floating">
              <input className="form-control" type="password" id="confirm-password" name="cpassword" required minLength={6}
                     autoComplete="new-password" placeholder="••••••••"
                     value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <label htmlFor="confirm-password">Confirm new password</label>
            </div>
            <p className="auth-hint">At least 6 characters. The code expires in 10 minutes.</p>
            <button type="submit" className="btn btn-primary auth-submit" disabled={busy || code.length !== 6}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <>
            {verifyEmail && (
              <button type="button" className="auth-switch" style={{ background: 'none', border: 'none', cursor: cooldown ? 'not-allowed' : 'pointer' }}
                      onClick={resend} disabled={busy || cooldown > 0}>
                {cooldown > 0 ? `Send another code in ${cooldown}s` : "Didn't get it? Send another code"}
              </button>
            )}
            <p className="auth-switch">
              <a href="/forgot-password" onClick={(e) => { e.preventDefault(); setError(''); go('/forgot-password', 'forgot'); }}>
                Use a different email
              </a>
            </p>
          </>
        )}

        {mode === 'forgot' && (
          <p className="auth-switch">
            Remembered it? <a href="/login" onClick={(e) => { e.preventDefault(); setError(''); go('/login', 'login'); }}>Back to sign in</a>
          </p>
        )}

        {mode === 'verify' && (
          <>
            <button type="button" className="auth-switch" style={{ background: 'none', border: 'none', cursor: cooldown ? 'not-allowed' : 'pointer' }}
                    onClick={resend} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Send another code in ${cooldown}s` : "Didn't get it? Send another code"}
            </button>
            <p className="auth-switch">
              <a href="/register" onClick={(e) => { e.preventDefault(); go('/register', 'register'); }}>Use a different account</a>
            </p>
          </>
        )}

        {mode === 'login' && (
          <>
            <p className="auth-switch">New here? <a href="/register" onClick={(e) => { e.preventDefault(); go('/register', 'register'); }}>Create an account</a></p>
            <div className="auth-divider"><span>or</span></div>
            <Link className="auth-guest" to="/quran">Continue without an account</Link>
            <p className="auth-note">Your progress is kept in this browser and carried over the moment you sign in.</p>
          </>
        )}

        {mode === 'register' && (
          <p className="auth-switch">Already have an account? <a href="/login" onClick={(e) => { e.preventDefault(); go('/login', 'login'); }}>Sign in</a></p>
        )}
      </div>
    </div>
  );
}

export function LoginPage() { return <AuthPage mode="login" />; }
export function RegisterPage() { return <AuthPage mode="register" />; }
export function VerifyPage() { return <AuthPage mode="verify" />; }
export function ForgotPasswordPage() { return <AuthPage mode="forgot" />; }
export function ResetPasswordPage() { return <AuthPage mode="reset" />; }
