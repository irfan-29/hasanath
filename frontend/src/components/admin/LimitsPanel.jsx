import { useCallback, useEffect, useMemo, useState } from 'react';
import { admin } from '../../services/api';
import { useToast } from '../ToastProvider';
import { useConfirm } from '../ConfirmProvider';
import Loader from '../Loader';

// Limits: how many people may sign up, and how people may post.
//
// Every limit is a switch plus a number. Off means there is no limit. On means
// the number applies exactly as written, so 0 is zero: a signup cap of 0 closes
// signups. Nothing here uses a special number to mean "unlimited".
//
// The list of limits (labels, units, ranges, defaults) comes from the server,
// which is also what validates a save, so this page and the rules it edits
// cannot drift apart. Adding a limit on the server makes it appear here.

const GROUPS = [
  {
    id: 'signups',
    title: 'Signups',
    icon: 'person_add',
    hint: 'How many new accounts can be created. Useful at launch, so a sudden rush cannot overwhelm the app.',
  },
  {
    id: 'posts',
    title: 'Posts',
    icon: 'edit_note',
    hint: 'How often people can post, and when a new account may start. Admins are never limited.',
  },
];

function plural(count, word) {
  // "accounts" -> "account", "hours" -> "hour" for exactly one.
  return count === 1 && word.endsWith('s') ? word.slice(0, -1) : word;
}

// What a row's current choice means, in a sentence.
function summary(def, row) {
  if (!row.on) return def.offText;
  const value = Number(row.text);
  if (row.text.trim() === '' || !Number.isInteger(value)) return 'Enter a whole number';
  if (def.kind === 'cap') {
    if (value === 0) return `${def.zeroText} (0 allowed)`;
    return `Up to ${value} ${plural(value, def.unit)}${def.per ? ` a ${def.per}` : ''}`;
  }
  return `${value} ${plural(value, def.unit)}`;
}

function problem(def, row) {
  if (!row.on) return '';
  const value = Number(row.text);
  if (row.text.trim() === '' || !Number.isInteger(value)) return 'Enter a whole number.';
  if (value < def.min) return def.min === 1 ? 'Use 1 or more, or switch this off for none.' : `Use ${def.min} or more.`;
  if (value > def.max) return `Use ${def.max} or less.`;
  return '';
}

function rowsFrom(definitions, values) {
  const rows = {};
  definitions.forEach((def) => {
    const value = values[def.key];
    const on = value !== null && value !== undefined;
    // An off row remembers a sensible number for when it is switched on.
    const fallback = def.default !== null && def.default !== undefined ? def.default : Math.max(def.min, 1);
    rows[def.key] = { on, text: String(on ? value : fallback) };
  });
  return rows;
}

function valueOf(row) {
  return row.on ? Number(row.text) : null;
}

export default function LimitsPanel() {
  const toast = useToast();
  const ask = useConfirm();
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [rows, setRows] = useState({});
  const [warn, setWarn] = useState({ on: true, text: '80' });
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data) => {
    setState({ loading: false, data, error: '' });
    setRows(rowsFrom(data.definitions, data.values));
    const pct = Number(data.thresholdPercent) || 0;
    setWarn({ on: pct > 0, text: String(pct > 0 ? pct : 80) });
  }, []);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      apply(await admin.limits());
    } catch (err) {
      setState({ loading: false, data: null, error: 'Could not load the limits.' });
    }
  }, [apply]);

  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const definitions = data ? data.definitions : [];

  const warnProblem = useMemo(() => {
    if (!warn.on) return '';
    const value = Number(warn.text);
    if (warn.text.trim() === '' || !Number.isInteger(value) || value < 1 || value > 100) return 'Use a whole number from 1 to 100.';
    return '';
  }, [warn]);

  const dirty = useMemo(() => {
    if (!data) return false;
    const changed = definitions.some((def) => rows[def.key] && valueOf(rows[def.key]) !== data.values[def.key]);
    const pct = warn.on ? Number(warn.text) : 0;
    return changed || pct !== (Number(data.thresholdPercent) || 0);
  }, [data, definitions, rows, warn]);

  const invalid = definitions.some((def) => rows[def.key] && problem(def, rows[def.key])) || Boolean(warnProblem);

  const setRow = (key, patch) => setRows((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  async function save(event) {
    event.preventDefault();
    if (!data || invalid || !dirty) return;

    // A cap of 0 shuts something for everyone. Say so before it happens.
    const closing = definitions.filter((def) =>
      def.kind === 'cap' && valueOf(rows[def.key]) === 0 && data.values[def.key] !== 0);
    if (closing.length) {
      const closesSignups = closing.some((def) => def.group === 'signups');
      const ok = await ask({
        title: closesSignups ? 'Close signups?' : 'Stop all posting?',
        message: closesSignups
          ? 'A limit of 0 means nobody can create an account until you raise it or switch the limit off.'
          : 'A limit of 0 means nobody except admins can post until you raise it or switch the limit off.',
        confirmLabel: 'Save limits',
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const values = {};
      definitions.forEach((def) => { values[def.key] = valueOf(rows[def.key]); });
      apply(await admin.updateLimits({ values, thresholdPercent: warn.on ? Number(warn.text) : 0 }));
      toast('Limits saved');
    } catch (err) {
      toast('Could not save the limits', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <Loader variant="inline" label="Loading limits" />;
  if (!data) {
    return (
      <div className="auth-alert" role="alert">
        <span className="material-symbols-rounded">error</span>
        {state.error || 'Could not load the limits.'}
      </div>
    );
  }

  const usage = data.usage || {};
  // What has been used so far, for the limits that count something over time.
  const used = (def) => {
    const cap = rows[def.key] && rows[def.key].on ? Number(rows[def.key].text) : null;
    const of = Number.isInteger(cap) ? ` of ${cap}` : '';
    if (def.key === 'signupsPerDay') return `${usage.signupsToday || 0}${of} today`;
    if (def.key === 'signupsPerWeek') return `${usage.signupsThisWeek || 0}${of} this week`;
    if (def.key === 'postsPerDayApp') return `${usage.postsToday || 0}${of} today`;
    return '';
  };

  const changedAt = data.updatedAt ? new Date(data.updatedAt) : null;

  return (
    <form onSubmit={save} noValidate>
      {GROUPS.map((group) => (
        <section className="account-card" key={group.id}>
          <h3 className="moderation-title">
            <span className="material-symbols-rounded" aria-hidden="true">{group.icon}</span>
            {group.title}
          </h3>
          <p className="account-hint">{group.hint}</p>

          {definitions.filter((def) => def.group === group.id).map((def) => {
            const row = rows[def.key] || { on: false, text: '' };
            const error = problem(def, row);
            const usedText = used(def);
            const inputId = `limit-${def.key}`;
            return (
              <div className="admin-limit-row" key={def.key}>
                <div className="admin-limit-text">
                  <label className="tg-title" htmlFor={inputId}>{def.label}</label>
                  <div className="tg-sub">
                    {summary(def, row)}{usedText ? ` · ${usedText}` : ''}
                  </div>
                  {error && <div className="admin-limit-error" role="alert">{error}</div>}
                </div>
                <div className="admin-limit-control">
                  {row.on && (
                    <span className="admin-limit-input">
                      <input
                        id={inputId}
                        className="form-control"
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min={def.min}
                        max={def.max}
                        value={row.text}
                        aria-invalid={Boolean(error)}
                        onChange={(event) => setRow(def.key, { text: event.target.value })}
                      />
                      <span className="admin-limit-unit">{def.unit}</span>
                    </span>
                  )}
                  <label className="tg-switch">
                    <input
                      type="checkbox"
                      checked={row.on}
                      aria-label={`${def.label}: limit on`}
                      onChange={(event) => setRow(def.key, { on: event.target.checked })}
                    />
                    <span className="tg-slider"></span>
                  </label>
                </div>
              </div>
            );
          })}

          {group.id === 'signups' && (
            <div className="admin-limit-row">
              <div className="admin-limit-text">
                <label className="tg-title" htmlFor="limit-warn">Warn the admins before a cap is reached</label>
                <div className="tg-sub">
                  {warn.on
                    ? `Notifies admins in the app, by email and on Telegram at ${warn.text || '…'}% of a signup cap`
                    : 'No warning'}
                </div>
                {warnProblem && <div className="admin-limit-error" role="alert">{warnProblem}</div>}
              </div>
              <div className="admin-limit-control">
                {warn.on && (
                  <span className="admin-limit-input">
                    <input
                      id="limit-warn"
                      className="form-control"
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="1"
                      max="100"
                      value={warn.text}
                      aria-invalid={Boolean(warnProblem)}
                      onChange={(event) => setWarn((current) => ({ ...current, text: event.target.value }))}
                    />
                    <span className="admin-limit-unit">%</span>
                  </span>
                )}
                <label className="tg-switch">
                  <input
                    type="checkbox"
                    checked={warn.on}
                    aria-label="Warn the admins before a cap is reached"
                    onChange={(event) => setWarn((current) => ({ ...current, on: event.target.checked }))}
                  />
                  <span className="tg-slider"></span>
                </label>
              </div>
            </div>
          )}
        </section>
      ))}

      <div className="admin-limit-foot">
        <button type="submit" className="btn btn-primary" disabled={busy || invalid || !dirty}>
          {busy ? 'Saving…' : 'Save limits'}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn btn-outline" onClick={() => apply(data)}>
            Discard changes
          </button>
        )}
        <p className="account-hint">
          Days and weeks are counted in {data.timezone}: a day ends at midnight and a week starts on Monday.
          Changes take effect within half a minute.
          {changedAt && ` Last changed${data.updatedBy ? ` by ${data.updatedBy}` : ''} on ${changedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`}
        </p>
      </div>
    </form>
  );
}
