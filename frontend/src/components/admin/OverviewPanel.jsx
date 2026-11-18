import { useCallback, useEffect, useState } from 'react';
import { admin } from '../../services/api';
import Loader from '../Loader';

// The portal landing tab: the numbers an admin opens the page to see, plus a
// short trend so a spike in signups or reports is visible without a query.

function num(value) {
  return Number(value || 0).toLocaleString();
}

function when(value) {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'never';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function stat(label, value, hint) {
  return (
    <div className="admin-stat" key={label}>
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
      {hint && <span className="admin-stat-hint">{hint}</span>}
    </div>
  );
}

export default function OverviewPanel({ onNavigate }) {
  const [state, setState] = useState({ loading: true, data: null });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await admin.stats();
      setState({ loading: false, data });
      setError('');
    } catch (err) {
      setState({ loading: false, data: null });
      setError('Could not load the overview.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) return <Loader variant="page" label="Loading the overview" />;

  if (error || !state.data) {
    return (
      <div className="auth-alert" role="alert">
        <span className="material-symbols-rounded">error</span>
        {error || 'Could not load the overview.'}
      </div>
    );
  }

  const data = state.data;
  const maxDay = Math.max(
    1,
    ...data.timeline.map((day) => Math.max(day.signups, day.posts))
  );

  return (
    <>
      <div className="admin-stat-grid">
        {stat('Total accounts', num(data.users.total), `${num(data.users.active7d)} active this week`)}
        {stat('New today', num(data.users.newToday), `${num(data.users.new7d)} this week · ${num(data.users.new30d)} this month`)}
        {stat('Active today', num(data.users.activeToday), 'Seen in the app today')}
        {stat('Posts', num(data.posts.total), `${num(data.posts.last7d)} in the last 7 days`)}
        {stat('Waiting for review', num(data.posts.pending), 'Held or reported posts')}
        {stat('Open reports', num(data.reports.open), 'Report rows awaiting a decision')}
        {stat('One-time banner views', num(data.banners.otbViews), `${num(data.banners.otbActive)} active popup${data.banners.otbActive === 1 ? '' : 's'}`)}
        {stat('Sticky bars', num(data.banners.stickyActive), 'Live on the web app')}
      </div>

      <section className="account-card admin-section">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">trending_up</span>
          Last 14 days
        </h3>
        <p className="account-hint">
          New accounts and posts by day. Activity counts last seen, so legacy
          accounts appear from their next visit onward.
        </p>

        <div className="admin-chart" role="img" aria-label="New accounts and posts over the last 14 days">
          {data.timeline.map((day) => (
            <div className="admin-chart-day" key={day.date}>
              <div className="admin-chart-bars">
                <span
                  className="admin-chart-bar is-users"
                  style={{ height: `${Math.max(4, Math.round((day.signups / maxDay) * 100))}%` }}
                  title={`${day.signups} new account${day.signups === 1 ? '' : 's'}`}
                />
                <span
                  className="admin-chart-bar is-posts"
                  style={{ height: `${Math.max(4, Math.round((day.posts / maxDay) * 100))}%` }}
                  title={`${day.posts} post${day.posts === 1 ? '' : 's'}`}
                />
              </div>
              <span className="admin-chart-date">{day.date.slice(5)}</span>
            </div>
          ))}
        </div>

        <div className="admin-legend">
          <span><i className="admin-legend-dot is-users" /> New accounts</span>
          <span><i className="admin-legend-dot is-posts" /> Posts</span>
        </div>
      </section>

      <section className="account-card admin-section">
        <h3 className="moderation-title">
          <span className="material-symbols-rounded" aria-hidden="true">campaign</span>
          Announcements
        </h3>
        <p className="account-hint">
          {data.broadcasts.count === 0
            ? 'No broadcast has been sent yet.'
            : `${num(data.broadcasts.count)} broadcast${data.broadcasts.count === 1 ? '' : 's'} sent. Last: “${data.broadcasts.lastTitle}” on ${when(data.broadcasts.lastAt)}.`}
        </p>
        <div className="moderation-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('broadcast')}>
            <span className="material-symbols-rounded" aria-hidden="true">send</span>
            Send a broadcast
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('banners')}>
            <span className="material-symbols-rounded" aria-hidden="true">web_asset</span>
            Manage banners
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('users')}>
            <span className="material-symbols-rounded" aria-hidden="true">group</span>
            Browse users
          </button>
        </div>
      </section>
    </>
  );
}
