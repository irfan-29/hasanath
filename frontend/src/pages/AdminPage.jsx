import { useSearchParams } from 'react-router-dom';
import { useSession } from '../hooks/useSession.jsx';
import AdminLogin from '../components/admin/AdminLogin';
import OverviewPanel from '../components/admin/OverviewPanel';
import ModerationPanel from '../components/admin/ModerationPanel';
import BroadcastPanel from '../components/admin/BroadcastPanel';
import BannersPanel from '../components/admin/BannersPanel';
import UsersPanel from '../components/admin/UsersPanel';
import ContactMessagesPanel from '../components/admin/ContactMessagesPanel';
import LimitsPanel from '../components/admin/LimitsPanel';

// The admin portal.
//
// This route is deliberately unlisted: only an administrator sees an Admin link
// anywhere in the app. Typing /admin shows the portal to an admin and the
// portal's own sign-in card to everyone else, which is also the way to reach it
// on a device where nobody is signed in.
//
// Tabs are held in the query string (?tab=users) so a section can be linked or
// refreshed without losing its place.

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'moderation', label: 'Moderation', icon: 'checklist_rtl' },
  { id: 'broadcast', label: 'Broadcast', icon: 'campaign' },
  { id: 'banners', label: 'Banners', icon: 'web_asset' },
  { id: 'users', label: 'Users', icon: 'group' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
  { id: 'limits', label: 'Limits', icon: 'speed' },
];

export default function AdminPage() {
  const { isAdmin } = useSession();
  const [params, setParams] = useSearchParams();

  // Signed in without an admin address, or not signed in at all: the page has
  // nothing to show. The login card is the only visible part of the portal for
  // these visitors, and no navigation item points them here.
  if (!isAdmin) return <AdminLogin />;

  const requested = params.get('tab');
  const tab = TABS.some((item) => item.id === requested) ? requested : 'overview';

  function select(id) {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  }

  return (
    <>
      <div className="page-header admin-header">
        <h1>Admin</h1>
        <p>Moderation, announcements and account activity</p>
      </div>

      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`admin-tab${tab === item.id ? ' is-active' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => select(item.id)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="admin-panels">
        {tab === 'overview' && <OverviewPanel onNavigate={select} />}
        {tab === 'moderation' && <ModerationPanel />}
        {tab === 'broadcast' && <BroadcastPanel />}
        {tab === 'banners' && <BannersPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'messages' && <ContactMessagesPanel />}
        {tab === 'limits' && <LimitsPanel />}
      </div>
    </>
  );
}
