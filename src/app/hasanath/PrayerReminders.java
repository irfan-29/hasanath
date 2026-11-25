package app.hasanath;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Prayer-time reminders, scheduled on the phone.
 *
 * Today's and tomorrow's timings are fetched from /api/salah-timings (the same
 * location, method and Asr school the user picked in the app) and stored. Each
 * enabled prayer gets an alarm; when it fires, the reminder is shown. The list
 * is refreshed whenever the app opens, after a settings change, once a night,
 * after a reboot or time-zone change, and by the background check, so it never
 * runs dry. If a refresh fails (offline) the stored timings keep working.
 */
public class PrayerReminders {

    static final String PREF_TIMINGS = "prayerTimings";      // {timezone, days:[{date, times:{Fajr:"04:58 AM",...}}]}
    static final String PREF_REFRESHED = "prayerRefreshedAt";
    static final String PREF_NEEDS_LOCATION = "prayerNeedsLocation";
    static final String PREF_NEXT = "prayerNextLabel";
    static final String PREF_ALARMS = "prayerAlarmCount";
    static final int MAX_ALARMS = 12;
    static final int RC_BASE = 3000;
    static final int RC_REFRESH = 2999;
    static final long LATE_LIMIT_MS = 20 * 60 * 1000;

    static final String ACTION_FIRE = "app.hasanath.PRAYER_FIRE";
    static final String ACTION_REFRESH = "app.hasanath.PRAYER_REFRESH";

    // ---- Fetching -----------------------------------------------------------

    /** Fetch fresh timings in the background, then reschedule. Safe to call often. */
    static void refreshAsync(final Context ctx) {
        final Context c = ctx.getApplicationContext();
        new Thread(new Runnable() { public void run() {
            refreshNow(c);
        }}).start();
    }

    static synchronized void refreshNow(Context c) {
        try {
            JSONObject today = Net.getJson(c, "/api/salah-timings");
            if (today == null) { schedule(c); return; }
            if (today.optBoolean("needsLocation", false)) {
                Notifier.prefs(c).edit().putBoolean(PREF_NEEDS_LOCATION, true)
                    .remove(PREF_TIMINGS).apply();
                schedule(c);
                return;
            }
            String tz = today.optString("timezone", TimeZone.getDefault().getID());
            String dateKey = today.optString("dateKey", "");
            JSONArray days = new JSONArray();
            JSONObject d0 = dayFrom(today);
            if (d0 != null) days.put(d0);

            String tomorrow = nextDay(dateKey, tz);
            if (tomorrow != null) {
                JSONObject t = Net.getJson(c, "/api/salah-timings?date=" + tomorrow);
                JSONObject d1 = t == null ? null : dayFrom(t);
                if (d1 != null) days.put(d1);
            }
            if (days.length() == 0) { schedule(c); return; }

            JSONObject store = new JSONObject();
            store.put("timezone", tz);
            store.put("days", days);
            Notifier.prefs(c).edit()
                .putString(PREF_TIMINGS, store.toString())
                .putBoolean(PREF_NEEDS_LOCATION, false)
                .putLong(PREF_REFRESHED, System.currentTimeMillis())
                .apply();
        } catch (Exception e) {
            // Offline or a server hiccup: keep the timings we already have.
        }
        schedule(c);
    }

    static JSONObject dayFrom(JSONObject payload) throws Exception {
        JSONObject details = payload.optJSONObject("details");
        if (details == null) return null;
        JSONArray list = details.optJSONArray("prayerTimes");
        if (list == null) return null;
        JSONObject times = new JSONObject();
        for (int i = 0; i < list.length(); i++) {
            JSONObject p = list.getJSONObject(i);
            times.put(p.optString("timeType"), p.optString("time"));
        }
        JSONObject day = new JSONObject();
        day.put("date", details.optString("dateKey", payload.optString("dateKey")));
        day.put("times", times);
        return day;
    }

    static String nextDay(String dateKey, String tz) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone(tz));
            Calendar cal = Calendar.getInstance(TimeZone.getTimeZone(tz));
            cal.setTime(f.parse(dateKey));
            cal.add(Calendar.DAY_OF_MONTH, 1);
            return f.format(cal.getTime());
        } catch (Exception e) { return null; }
    }

    // ---- Scheduling ---------------------------------------------------------

    static class Event {
        long at; String prayer; String clock; boolean before; int minutes;
    }

    static final Pattern CLOCK = Pattern.compile("(\\d{1,2}):(\\d{2})\\s*([AaPp][Mm])?");

    /** "04:58 AM" or "16:58" on dateKey in tz -> epoch millis, or -1. */
    static long epochOf(String dateKey, String clock, String tz) {
        Matcher m = CLOCK.matcher(clock == null ? "" : clock);
        if (!m.find()) return -1;
        int h = Integer.parseInt(m.group(1)), min = Integer.parseInt(m.group(2));
        String ampm = m.group(3);
        if (ampm != null) {
            boolean pm = ampm.toLowerCase(Locale.US).equals("pm");
            if (h == 12) h = pm ? 12 : 0; else if (pm) h += 12;
        }
        try {
            String[] p = dateKey.split("-");
            Calendar cal = Calendar.getInstance(TimeZone.getTimeZone(tz));
            cal.clear();
            cal.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), h, min, 0);
            return cal.getTimeInMillis();
        } catch (Exception e) { return -1; }
    }

    static List<Event> upcoming(Context c) {
        List<Event> out = new ArrayList<>();
        JSONObject s = Notifier.settings(c);
        if (!s.optBoolean("prayer", true)) return out;
        String timing = s.optString("timing", "at");
        int before = s.optInt("beforeMin", 10);
        JSONObject enabled = s.optJSONObject("prayers");
        try {
            JSONObject store = new JSONObject(Notifier.prefs(c).getString(PREF_TIMINGS, "{}"));
            String tz = store.optString("timezone", TimeZone.getDefault().getID());
            JSONArray days = store.optJSONArray("days");
            if (days == null) return out;
            long now = System.currentTimeMillis();
            for (int i = 0; i < days.length(); i++) {
                JSONObject day = days.getJSONObject(i);
                JSONObject times = day.optJSONObject("times");
                if (times == null) continue;
                for (String name : Notifier.PRAYERS) {
                    if (enabled != null && !enabled.optBoolean(name, true)) continue;
                    String clock = times.optString(name, "");
                    long t = epochOf(day.optString("date"), clock, tz);
                    if (t < 0) continue;
                    if (!"before".equals(timing)) addIfFuture(out, now, t, name, clock, false, 0);
                    if (!"at".equals(timing)) addIfFuture(out, now, t - before * 60_000L, name, clock, true, before);
                }
            }
        } catch (Exception ignored) { }
        Collections.sort(out, new Comparator<Event>() {
            public int compare(Event a, Event b) { return Long.compare(a.at, b.at); }
        });
        return out.size() > MAX_ALARMS ? out.subList(0, MAX_ALARMS) : out;
    }

    static void addIfFuture(List<Event> out, long now, long at, String name, String clock, boolean before, int minutes) {
        if (at <= now + 5000) return;
        Event e = new Event();
        e.at = at; e.prayer = name; e.clock = clock; e.before = before; e.minutes = minutes;
        out.add(e);
    }

    static boolean exactAllowed(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am.canScheduleExactAlarms();
    }

    static void setAlarm(Context c, long at, PendingIntent pi) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (exactAllowed(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    /** Replace every pending reminder with the current list. */
    static synchronized void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        int previous = Notifier.prefs(c).getInt(PREF_ALARMS, MAX_ALARMS);
        for (int i = 0; i < Math.max(previous, MAX_ALARMS); i++) {
            PendingIntent old = PendingIntent.getBroadcast(c, RC_BASE + i,
                new Intent(c, Receiver.class).setAction(ACTION_FIRE),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (old != null) { am.cancel(old); old.cancel(); }
        }

        List<Event> events = upcoming(c);
        for (int i = 0; i < events.size(); i++) {
            Event e = events.get(i);
            Intent intent = new Intent(c, Receiver.class).setAction(ACTION_FIRE)
                .putExtra("prayer", e.prayer).putExtra("clock", e.clock)
                .putExtra("before", e.before).putExtra("minutes", e.minutes)
                .putExtra("at", e.at);
            PendingIntent pi = PendingIntent.getBroadcast(c, RC_BASE + i, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            setAlarm(c, e.at, pi);
        }

        String next = "";
        if (!events.isEmpty()) {
            Event e = events.get(0);
            SimpleDateFormat f = new SimpleDateFormat("EEE", Locale.getDefault());
            boolean today = android.text.format.DateUtils.isToday(e.at);
            next = e.prayer + (e.before ? " (" + e.minutes + " min before)" : "") + " · "
                + (today ? "today" : f.format(e.at)) + " " + e.clock;
        }
        Notifier.prefs(c).edit().putInt(PREF_ALARMS, events.size()).putString(PREF_NEXT, next).apply();

        // Nightly refresh, ~3 hours from now at the latest, so the list never runs out.
        long refreshAt = System.currentTimeMillis() + 3 * 60 * 60 * 1000L;
        if (!events.isEmpty()) refreshAt = Math.min(refreshAt, events.get(events.size() - 1).at + 60_000);
        PendingIntent refresh = PendingIntent.getBroadcast(c, RC_REFRESH,
            new Intent(c, Receiver.class).setAction(ACTION_REFRESH),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.set(AlarmManager.RTC, refreshAt, refresh);
        AyahReminder.schedule(c);
    }

    // ---- Receiving ----------------------------------------------------------

    /** Alarm, reboot, time and time-zone changes, and app updates all land here. */
    public static class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            String action = intent.getAction();
            if (ACTION_FIRE.equals(action)) {
                long at = intent.getLongExtra("at", 0);
                // A reminder held back past its moment (phone was off, deep
                // sleep) is no longer useful: "It's time for Fajr" at 9am.
                if (at > 0 && System.currentTimeMillis() - at > LATE_LIMIT_MS) return;
                String prayer = intent.getStringExtra("prayer");
                String clock = intent.getStringExtra("clock");
                boolean before = intent.getBooleanExtra("before", false);
                int minutes = intent.getIntExtra("minutes", 10);
                String title = before ? prayer + " in " + minutes + " minutes" : "It's time for " + prayer;
                String body = before ? prayer + " is at " + clock + ". Time to get ready."
                                     : prayer + " · " + clock;
                int id = 4000 + indexOf(prayer) * 2 + (before ? 1 : 0);
                Notifier.post(c, id, Notifier.CH_PRAYER, title, body, "/salah", "Log prayer", "/salah");
                // Keep the schedule topped up as reminders are used.
                final PendingResult pending = goAsync();
                final Context app = c.getApplicationContext();
                new Thread(new Runnable() { public void run() {
                    try { schedule(app); } finally { pending.finish(); }
                }}).start();
                return;
            }
            // Refresh alarm, BOOT_COMPLETED, TIME_SET, TIMEZONE_CHANGED, MY_PACKAGE_REPLACED.
            final PendingResult pending = goAsync();
            final Context app = c.getApplicationContext();
            new Thread(new Runnable() { public void run() {
                try {
                    refreshNow(app);
                    NotificationPoller.schedule(app);
                } finally { pending.finish(); }
            }}).start();
        }
    }

    static int indexOf(String prayer) {
        for (int i = 0; i < Notifier.PRAYERS.length; i++) if (Notifier.PRAYERS[i].equals(prayer)) return i;
        return 0;
    }
}
