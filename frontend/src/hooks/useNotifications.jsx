import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { useSession } from './useSession.jsx';

// The unread notification count, shared by the phone header and the sidebar.
//
// Both places render the same badge, so the count lives in one provider instead
// of being fetched twice and drifting. It polls while the app is open, refreshes
// on every route change (so returning from the Notifications tab updates it
// immediately), and on window focus.
const NotificationContext = createContext({
  unread: 0,
  refresh: () => Promise.resolve(null),
});

export function NotificationProvider({ children }) {
  const { isLoggedIn } = useSession();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!isLoggedIn) {
      setUnread(0);
      return 0;
    }
    try {
      const data = await api.get('/notifications/count');
      const next = Number(data && data.unread) || 0;
      setUnread(next);
      return next;
    } catch (err) {
      // A failed poll leaves the last known count alone: a network blip should
      // not make unread work look read.
      return null;
    }
  }, [isLoggedIn]);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const timer = window.setInterval(refresh, 45 * 1000);
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [isLoggedIn, refresh]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useUnreadNotifications() {
  const value = useContext(NotificationContext);
  return value;
}
