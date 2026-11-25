package app.hasanath;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * Ayah of the Day as a phone notification, at the time the user chooses.
 *
 * The same idea as the Telegram schedule, but on the phone: at the chosen time
 * the app fetches today's ayah from /api/quran (in the user's own primary
 * translation, exactly as the Quran page shows it) and posts it. It is sent at
 * most once a day. If the phone is offline at that moment, the background
 * check and the next app launch both try again, so a missed morning is caught
 * up as soon as there is a connection.
 */
public class AyahReminder {

    static final String PREF_SENT = "ayahSentOn";      // yyyy-MM-dd of the last day it was shown
    static final int RC_ALARM = 2998;
    static final int NOTIFICATION_ID = 4900;
    static final String ACTION = "app.hasanath.AYAH_FIRE";

    static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** Today's send time on the phone's own clock, from "HH:mm". */
    static Calendar timeToday(Context c) {
        String hhmm = Notifier.settings(c).optString("ayahTime", "05:30");
        int h = 5, m = 30;
        try {
            String[] p = hhmm.split(":");
            h = Math.max(0, Math.min(23, Integer.parseInt(p[0])));
            m = Math.max(0, Math.min(59, Integer.parseInt(p[1])));
        } catch (Exception ignored) { }
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, h);
        cal.set(Calendar.MINUTE, m);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal;
    }

    /** Set (or clear) the alarm for the next send time. */
    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, RC_ALARM,
            new Intent(c, Receiver.class).setAction(ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!Notifier.settings(c).optBoolean("ayah", true)) return;
        Calendar next = timeToday(c);
        boolean sentToday = todayKey().equals(Notifier.prefs(c).getString(PREF_SENT, ""));
        if (sentToday || next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_MONTH, 1);
        PrayerReminders.setAlarm(c, next.getTimeInMillis(), pi);
    }

    /**
     * Send today's ayah if it is due and has not been sent yet. Runs off the
     * main thread; safe to call from the alarm, the background check and app launch.
     */
    static synchronized void sendIfDue(Context c) {
        try {
            if (!Notifier.settings(c).optBoolean("ayah", true)) return;
            String today = todayKey();
            if (today.equals(Notifier.prefs(c).getString(PREF_SENT, ""))) return;
            if (System.currentTimeMillis() < timeToday(c).getTimeInMillis()) return;

            JSONObject res = Net.getJson(c, "/api/quran");
            JSONObject a = res == null ? null : res.optJSONObject("ayahOfTheDay");
            if (a == null) return;                       // offline, or not ready yet: try again later
            String arabic = a.optString("arabicText", "").trim();
            String translation = a.optString("translationText", "").trim();
            if (arabic.isEmpty() && translation.isEmpty()) return;

            String surah = a.optString("surahName", "");
            String ref = (surah.isEmpty() ? "Surah " + a.optInt("surahNo") : surah) + " " + a.optInt("surahNo") + ":" + a.optInt("ayahNo");
            StringBuilder body = new StringBuilder();
            if (!arabic.isEmpty()) body.append(arabic);
            if (!translation.isEmpty()) { if (body.length() > 0) body.append("\n\n"); body.append(translation); }
            String label = a.optString("translationLabel", "").trim();
            body.append("\n\n").append(ref);
            if (!label.isEmpty()) body.append(" · ").append(label);

            Notifier.post(c, NOTIFICATION_ID, Notifier.CH_AYAH, "Ayah of the Day",
                body.toString(), "/quran", "Open Quran", "/quran");
            Notifier.prefs(c).edit().putString(PREF_SENT, today).apply();
        } catch (Exception e) {
            // Never let a malformed response stop the other reminders.
        } finally {
            schedule(c);
        }
    }

    public static class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            final PendingResult pending = goAsync();
            final Context app = c.getApplicationContext();
            new Thread(new Runnable() { public void run() {
                try { sendIfDue(app); } finally { pending.finish(); }
            }}).start();
        }
    }
}
