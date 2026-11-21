package app.hasanath;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;

import org.json.JSONObject;

/**
 * Phone notifications: channels, user preferences and posting.
 *
 * Three channels, so people can also tune each one in Android's own settings:
 *   prayer        - prayer-time reminders (high importance, makes a sound)
 *   social        - friend requests, challenge invites and replies
 *   announcements - messages from the Hasanath admin portal
 */
public class Notifier {

    static final String CH_PRAYER = "prayer";
    static final String CH_SOCIAL = "social";
    static final String CH_ANNOUNCE = "announcements";
    static final String[] PRAYERS = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
    static final String EXTRA_OPEN = "app.hasanath.OPEN_PATH";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("hasanath", Context.MODE_PRIVATE);
    }

    /** User choices, with defaults: everything on, reminders at prayer time. */
    static JSONObject settings(Context c) {
        JSONObject s;
        try { s = new JSONObject(prefs(c).getString("notify", "{}")); }
        catch (Exception e) { s = new JSONObject(); }
        try {
            if (!s.has("prayer")) s.put("prayer", true);
            if (!s.has("timing")) s.put("timing", "at");
            if (!s.has("beforeMin")) s.put("beforeMin", 10);
            if (!s.has("social")) s.put("social", true);
            if (!s.has("announcements")) s.put("announcements", true);
            JSONObject p = s.optJSONObject("prayers");
            if (p == null) { p = new JSONObject(); s.put("prayers", p); }
            for (String name : PRAYERS) if (!p.has(name)) p.put(name, true);
        } catch (Exception ignored) { }
        return s;
    }

    static void saveSettings(Context c, String json) throws Exception {
        JSONObject in = new JSONObject(json);
        JSONObject out = settings(c);
        if (in.has("prayer")) out.put("prayer", in.optBoolean("prayer", true));
        String timing = in.optString("timing", out.optString("timing"));
        if ("at".equals(timing) || "before".equals(timing) || "both".equals(timing)) out.put("timing", timing);
        int before = in.optInt("beforeMin", out.optInt("beforeMin", 10));
        out.put("beforeMin", Math.max(1, Math.min(60, before)));
        if (in.has("social")) out.put("social", in.optBoolean("social", true));
        if (in.has("announcements")) out.put("announcements", in.optBoolean("announcements", true));
        JSONObject p = in.optJSONObject("prayers");
        if (p != null) {
            JSONObject cur = out.getJSONObject("prayers");
            for (String name : PRAYERS) if (p.has(name)) cur.put(name, p.optBoolean(name, true));
        }
        prefs(c).edit().putString("notify", out.toString()).apply();
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel prayer = new NotificationChannel(CH_PRAYER, "Prayer reminders",
            NotificationManager.IMPORTANCE_HIGH);
        prayer.setDescription("A reminder at each prayer time you choose in Settings");
        prayer.enableLights(true);
        prayer.setLightColor(Color.parseColor("#0d9488"));
        prayer.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel social = new NotificationChannel(CH_SOCIAL, "Friends & challenges",
            NotificationManager.IMPORTANCE_DEFAULT);
        social.setDescription("Friend requests, challenge invites and replies");
        NotificationChannel announce = new NotificationChannel(CH_ANNOUNCE, "Announcements",
            NotificationManager.IMPORTANCE_DEFAULT);
        announce.setDescription("News and updates from Hasanath");
        nm.createNotificationChannel(prayer);
        nm.createNotificationChannel(social);
        nm.createNotificationChannel(announce);
    }

    static boolean permissionGranted(Context c) {
        if (Build.VERSION.SDK_INT >= 33
            && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        return Build.VERSION.SDK_INT < 24 || nm.areNotificationsEnabled();
    }

    /** Opens the app at `path` (e.g. "/salah") when the notification is tapped. */
    static PendingIntent open(Context c, String path, int requestCode) {
        Intent i = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_OPEN, path == null || !path.startsWith("/") ? "/notifications" : path)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, requestCode, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void post(Context c, int id, String channel, String title, String body, String path,
                     String actionLabel, String actionPath) {
        ensureChannels(c);
        if (!permissionGranted(c)) return;
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(c, channel)
            : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_hasanath)
         .setColor(Color.parseColor(MainActivity.savedAccentColor(c)))
         .setContentTitle(title)
         .setContentText(body)
         .setStyle(new Notification.BigTextStyle().bigText(body))
         .setAutoCancel(true)
         .setContentIntent(open(c, path, id))
         .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(CH_PRAYER.equals(channel) ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT);
            b.setDefaults(Notification.DEFAULT_ALL);
        }
        if (CH_PRAYER.equals(channel)) b.setCategory(Notification.CATEGORY_REMINDER);
        else b.setCategory(Notification.CATEGORY_SOCIAL);
        if (actionLabel != null) {
            b.addAction(new Notification.Action.Builder(0, actionLabel, open(c, actionPath, id + 7)).build());
        }
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, b.build());
    }
}
