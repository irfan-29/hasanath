import { useCallback, useEffect, useState } from 'react';
import { admin } from '../../services/api';
import { useToast } from '../ToastProvider';
import Loader from '../Loader';

// Launch protection: cap how many accounts can be created per day/week so a
// sudden spike cannot take the server down. Admins can tune or disable the
// caps here; a 0 means "no cap".
export default function LimitsPanel() {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, limits: null, counts: null, error: '' });
  const [form, setForm] = useState({ dailyLimit: 0, weeklyLimit: 0, thresholdPercent: 80, enabled: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await admin.signupLimits();
      setState({ loading: false, limits: data.limits, counts: data.counts, error: '' });
      setForm({
        dailyLimit: Number(data.limits.dailyLimit) || 0,
        weeklyLimit: Number(data.limits.weeklyLimit) || 0,
        thresholdPercent: Number(data.limits.thresholdPercent) || 0,
        enabled: Boolean(data.limits.enabled),
      });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: 'Could not load the signup limits.' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await admin.updateSignupLimits(form);
      setState((current) => ({ ...current, limits: data.limits, counts: data.counts }));
      setForm({
        dailyLimit: Number(data.limits.dailyLimit) || 0,
        weeklyLimit: Number(data.limits.weeklyLimit) || 0,
        thresholdPercent: Number(data.limits.thresholdPercent) || 0,
        enabled: Boolean(data.limits.enabled),
      });
      toast('Signup limits saved');
    } catch (err) {
      toast('Could not save the signup limits', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <Loader variant="inline" label="Loading signup limits" />;

  const counts = state.counts || { daily: 0, weekly: 0 };
  const limits = state.limits || {};

  return (
    <div className="container1 is-flat admin-limits">
      <div className="card-header">
        <h3>Signup limits</h3>
        <span className="badge badge-primary">{limits.enabled ? 'Enforced' : 'Disabled'}</span>
      </div>

      {state.error && <p className="post-empty">{state.error}</p>}

      <div className="admin-limits-counts">
        <div>
          <span className="admin-limits-count-label">Today</span>
          <strong>{counts.daily}</strong>
          {limits.dailyLimit > 0 && <span className="admin-limits-count-of"> / {limits.dailyLimit}</span>}
        </div>
        <div>
          <span className="admin-limits-count-label">This week</span>
          <strong>{counts.weekly}</strong>
          {limits.weeklyLimit > 0 && <span className="admin-limits-count-of"> / {limits.weeklyLimit}</span>}
        </div>
      </div>

      <form className="admin-limits-form" onSubmit={save}>
        <label className="form-floating">
          <input
            type="number"
            min="0"
            className="form-control"
            value={form.dailyLimit}
            onChange={(e) => setForm((f) => ({ ...f, dailyLimit: Number(e.target.value) || 0 }))}
          />
          <span>Daily limit (0 = unlimited)</span>
        </label>
        <label className="form-floating">
          <input
            type="number"
            min="0"
            className="form-control"
            value={form.weeklyLimit}
            onChange={(e) => setForm((f) => ({ ...f, weeklyLimit: Number(e.target.value) || 0 }))}
          />
          <span>Weekly limit (0 = unlimited)</span>
        </label>
        <label className="form-floating">
          <input
            type="number"
            min="0"
            max="100"
            className="form-control"
            value={form.thresholdPercent}
            onChange={(e) => setForm((f) => ({ ...f, thresholdPercent: Number(e.target.value) || 0 }))}
          />
          <span>Warning threshold (%)</span>
        </label>
        <label className="admin-limits-toggle">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <span>Enforce limits</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save limits'}
        </button>
      </form>

      <p className="admin-limits-hint">
        When a limit is reached new signups are paused and the visitor sees a
        "temporarily paused" message. Admins are notified in-app, by email and
        via Telegram (if connected) once usage crosses the warning threshold.
      </p>
    </div>
  );
}