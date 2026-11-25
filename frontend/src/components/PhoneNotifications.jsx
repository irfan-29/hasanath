import { useCallback, useEffect, useState } from 'react';

// Phone notifications, shown only inside the Hasanath Android app.
//
// The settings live on the phone, not on the server: prayer reminders are
// alarms the app schedules itself (they fire on the minute, even offline), and
// friend / announcement alerts come from the app checking the in-app
// notification list in the background. So this panel talks to the native
// bridge (window.HasanathAndroid) instead of the API, and renders nothing in a
// browser, where none of it applies.

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const TIMINGS = [
  { value: 'at', label: 'At prayer time' },
  { value: 'before', label: '10 minutes before' },
  { value: 'both', label: '10 minutes before and at prayer time' },
];

function bridge() {
  const b = typeof window !== 'undefined' ? window.HasanathAndroid : null;
  return b && typeof b.getNotificationSettings === 'function' ? b : null;
}

function read(b) {
  try {
    return JSON.parse(b.getNotificationSettings());
  } catch (err) {
    return null;
  }
}

export default function PhoneNotifications({ toast }) {
  const b = bridge();
  const [state, setState] = useState(() => (b ? read(b) : null));

  // Permissions can change in Android's own settings while the app is in the
  // background, so re-read whenever the page becomes visible again.
  const reload = useCallback(() => { if (b) setState(read(b)); }, [b]);
  useEffect(() => {
    if (!b) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [b, reload]);

  if (!b || !state) return null;
  const s = state.settings;

  const save = (patch) => {
    const next = { ...s, ...patch };
    try {
      b.setNotificationSettings(JSON.stringify(next));
    } catch (err) {
      if (toast) toast("Couldn't save notification settings", { kind: 'delete' });
      return;
    }
    reload();
    if (toast) toast('Notification settings updated');
  };

  const togglePrayer = (name) => save({ prayers: { ...s.prayers, [name]: !s.prayers[name] } });

  return (
    <>
      <div className="form-section-title">Phone Notifications</div>

      {!state.permission && (
        <div className="wa-status wa-status-bad">
          <span className="material-symbols-rounded">notifications_off</span>
          Notifications are turned off for Hasanath on this phone.{' '}
          <button type="button" className="btn btn-outline btn-sm"
                  onClick={() => { b.requestNotificationPermission(); setTimeout(reload, 1500); }}>
            Turn on
          </button>
        </div>
      )}

      <div className="tg-row tg-row-head">
        <div>
          <div className="tg-title">Prayer reminders</div>
          <div className="tg-sub">On the minute, from your Salah Timings location. Works offline.</div>
        </div>
        <label className="tg-switch">
          <input type="checkbox" checked={s.prayer} onChange={(e) => save({ prayer: e.target.checked })} />
          <span className="tg-slider"></span>
        </label>
      </div>

      {s.prayer && (
        <div className="tg-modules">
          <div className="tg-title tg-title-sm">Remind me for</div>
          {PRAYERS.map((name) => (
            <div className="tg-module" key={name}>
              <label className="tg-row tg-row-module">
                <input type="checkbox" checked={Boolean(s.prayers[name])} onChange={() => togglePrayer(name)} />
                <span className="tg-check material-symbols-rounded" aria-hidden="true"></span>
                <span><strong>{name}</strong></span>
              </label>
            </div>
          ))}

          <div className="tg-title tg-title-sm">When</div>
          {TIMINGS.map((opt) => (
            <div className="tg-module" key={opt.value}>
              <label className="tg-row tg-row-module">
                <input type="radio" name="prayer-timing" checked={s.timing === opt.value}
                       onChange={() => save({ timing: opt.value })} />
                <span className="tg-check material-symbols-rounded" aria-hidden="true"></span>
                <span><strong>{opt.label}</strong></span>
              </label>
            </div>
          ))}

          {!state.exactAlarms && (
            <div className="wa-status wa-status-bad">
              <span className="material-symbols-rounded">schedule</span>
              Reminders may arrive a few minutes late.{' '}
              <button type="button" className="btn btn-outline btn-sm"
                      onClick={() => b.requestExactAlarms()}>
                Allow exact timing
              </button>
            </div>
          )}

          {state.nextReminder && (
            <div className="wa-status wa-status-ok">
              <span className="material-symbols-rounded">alarm</span>
              Next reminder: {state.nextReminder}
            </div>
          )}
          {state.needsLocation && (
            <div className="wa-status wa-status-bad">
              <span className="material-symbols-rounded">location_off</span>
              Choose your location in Salah Timings to get prayer reminders.
            </div>
          )}
        </div>
      )}

      <div className="tg-row tg-row-head">
        <div>
          <div className="tg-title">Friends &amp; challenges</div>
          <div className="tg-sub">Friend requests, challenge invites and replies. May take up to 15 minutes.</div>
        </div>
        <label className="tg-switch">
          <input type="checkbox" checked={s.social} onChange={(e) => save({ social: e.target.checked })} />
          <span className="tg-slider"></span>
        </label>
      </div>

      {/* Ayah of the Day at a chosen time: needs app 1.9+, which reports `ayah` in its settings. */}
      {typeof s.ayah === 'boolean' && (
        <>
          <div className="tg-row tg-row-head">
            <div>
              <div className="tg-title">Ayah of the Day</div>
              <div className="tg-sub">One ayah a day in your translation, at the time you choose</div>
            </div>
            <label className="tg-switch">
              <input type="checkbox" checked={s.ayah} onChange={(e) => save({ ayah: e.target.checked })} />
              <span className="tg-slider"></span>
            </label>
          </div>
          {s.ayah && (
            <div className="tg-modules">
              <div className="form-floating tg-time">
                <input className="form-control" type="time" id="phone-ayah-time" value={s.ayahTime || '05:30'}
                       onChange={(e) => { if (e.target.value) save({ ayahTime: e.target.value }); }} />
                <label htmlFor="phone-ayah-time">Send at</label>
              </div>
            </div>
          )}
        </>
      )}

      <div className="tg-row tg-row-head">
        <div>
          <div className="tg-title">Announcements</div>
          <div className="tg-sub">News and updates from Hasanath</div>
        </div>
        <label className="tg-switch">
          <input type="checkbox" checked={s.announcements} onChange={(e) => save({ announcements: e.target.checked })} />
          <span className="tg-slider"></span>
        </label>
      </div>

      <div className="wa-test-form tg-panel">
        <button type="button" className="btn btn-outline" onClick={() => b.testNotification()}>
          <span className="material-symbols-rounded">notifications_active</span>
          Send a test notification
        </button>
        <button type="button" className="btn btn-outline" onClick={() => b.openSystemNotificationSettings()}>
          <span className="material-symbols-rounded">settings</span>
          Phone settings
        </button>
      </div>
    </>
  );
}
