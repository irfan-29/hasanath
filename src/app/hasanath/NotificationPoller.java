package app.hasanath;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Brings Hasanath's in-app notifications (friend requests, challenge invites,
 * announcements) to the phone's notification shade.
 *
 * Android runs this roughly every 15 minutes when there is a network (less
 * often in deep battery saving). It reads /api/notifications as the signed-in
 * user and posts anything new and unread. No server changes are involved: the
 * same list feeds the bell in the app. While the app is open on screen nothing
 * is posted, since the bell already shows it.
 */
public class NotificationPoller extends JobService {

    static final int JOB_ID = 4242;
    static final String PREF_SEEN = "notifySeenAt";   // newest createdAt already handled (ISO)

    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, NotificationPoller.class))
            .setPeriodic(15 * 60 * 1000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build();
        try { js.schedule(job); } catch (Exception ignored) { }
    }

    static String nowIso() {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new java.util.Date());
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context c = getApplicationContext();
        new Thread(new Runnable() { public void run() {
            try { check(c); } finally { jobFinished(params, false); }
        }}).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    static void check(Context c) {
        // Keep prayer timings fresh too, at most twice a day.
        long refreshed = Notifier.prefs(c).getLong(PrayerReminders.PREF_REFRESHED, 0);
        if (System.currentTimeMillis() - refreshed > 12 * 60 * 60 * 1000L) PrayerReminders.refreshNow(c);
        AyahReminder.sendIfDue(c);

        JSONObject s = Notifier.settings(c);
        boolean social = s.optBoolean("social", true), announce = s.optBoolean("announcements", true);
        if (!social && !announce) return;

        JSONObject res = Net.getJson(c, "/api/notifications");
        if (res == null) return;                    // signed out or offline
        JSONArray items = res.optJSONArray("items");
        if (items == null) return;

        String seen = Notifier.prefs(c).getString(PREF_SEEN, "");
        boolean firstRun = seen.isEmpty();
        // On the first check the baseline is "now", so an account with no
        // notifications yet still gets its first real one.
        String newest = firstRun ? nowIso() : seen;
        boolean onScreen = MainActivity.visible;

        for (int i = items.length() - 1; i >= 0; i--) {       // oldest first
            JSONObject n = items.optJSONObject(i);
            if (n == null) continue;
            String created = n.optString("createdAt", "");
            if (created.compareTo(newest) > 0) newest = created;
            // First run sets the baseline: nobody wants fifty old alerts at once.
            if (firstRun || onScreen) continue;
            if (created.compareTo(seen) <= 0 || n.optBoolean("read", false)) continue;

            String type = n.optString("type", "");
            boolean isAnnouncement = "admin_announcement".equals(type);
            if (isAnnouncement ? !announce : !social) continue;

            String title = n.optString("title", "Hasanath");
            String body = n.optString("body", "");
            String link = n.optString("link", "/notifications");
            String action = null, actionPath = null;
            if ("friend_request".equals(type) || "challenge_invite".equals(type)) {
                action = "Open"; actionPath = "/notifications";
            }
            Notifier.post(c, 5000 + (n.optString("id", created).hashCode() & 0xfff),
                isAnnouncement ? Notifier.CH_ANNOUNCE : Notifier.CH_SOCIAL,
                title, body, link.isEmpty() ? "/notifications" : link, action, actionPath);
        }
        if (!newest.equals(seen)) Notifier.prefs(c).edit().putString(PREF_SEEN, newest).apply();
    }
}
