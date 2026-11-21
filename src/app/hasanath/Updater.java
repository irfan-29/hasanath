package app.hasanath;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * In-app updates for the sideloaded APK.
 *
 * The app reads a small JSON file from the website. When it lists a newer
 * versionCode, the user is offered the update; the APK is downloaded, its
 * SHA-256 checked against the JSON, and handed to Android's own installer.
 * Android then shows its standard "Update this app?" screen and refuses any
 * APK not signed with the same key as the installed app, so a tampered file
 * cannot replace Hasanath.
 *
 *   https://hasanath.vercel.app/android/version.json
 *   {
 *     "versionCode": 5, "versionName": "1.4",
 *     "apkUrl": "https://hasanath.vercel.app/android/Hasanath-1.4.apk",
 *     "sha256": "<hex>",
 *     "notes": "What changed, shown in the update dialog",
 *     "minSupportedVersionCode": 1
 *   }
 * Versions below minSupportedVersionCode get the dialog without "Later".
 */
public class Updater {

    static final String VERSION_URL = "https://hasanath.vercel.app/android/version.json";
    static final long AUTO_CHECK_EVERY_MS = 6L * 60 * 60 * 1000;

    private static JSONObject pending;   // update waiting for "Install unknown apps"
    private static boolean busy;

    static final Handler ui = new Handler(Looper.getMainLooper());

    static long currentVersionCode(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) { return 0; }
    }

    static String currentVersionName(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; }
        catch (Exception e) { return ""; }
    }

    /** Clears a downloaded APK left behind by the previous update. */
    static void cleanup(Context c) {
        File f = new File(c.getCacheDir(), "update.apk");
        if (f.exists()) f.delete();
    }

    /** @param manual true when the user asked; shows "up to date" and skips the throttle. */
    static void check(final Activity a, final boolean manual) {
        final SharedPreferences prefs = a.getSharedPreferences("hasanath", Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (!manual && now - prefs.getLong("lastUpdateCheck", 0) < AUTO_CHECK_EVERY_MS) return;
        if (busy) return;
        prefs.edit().putLong("lastUpdateCheck", now).apply();

        new Thread(new Runnable() { public void run() {
            try {
                JSONObject info = new JSONObject(new String(fetch(VERSION_URL + "?t=" + System.currentTimeMillis()), "UTF-8"));
                final long latest = info.optLong("versionCode", 0);
                final long mine = currentVersionCode(a);
                final JSONObject finalInfo = info;
                ui.post(new Runnable() { public void run() {
                    if (a.isFinishing()) return;
                    if (latest > mine) offer(a, finalInfo, mine < finalInfo.optLong("minSupportedVersionCode", 0));
                    else if (manual) Toast.makeText(a, "Hasanath is up to date", Toast.LENGTH_SHORT).show();
                }});
            } catch (final Exception e) {
                if (manual) ui.post(new Runnable() { public void run() {
                    Toast.makeText(a, "Couldn't check for updates", Toast.LENGTH_SHORT).show();
                }});
            }
        }}).start();
    }

    static void offer(final Activity a, final JSONObject info, boolean mandatory) {
        String notes = info.optString("notes", "").trim();
        AlertDialog.Builder b = new AlertDialog.Builder(a)
            .setTitle("Update available")
            .setMessage("Hasanath " + info.optString("versionName", "") + " is ready to install."
                + (notes.isEmpty() ? "" : "\n\nWhat's new:\n" + notes))
            .setCancelable(!mandatory)
            .setPositiveButton("Update", new android.content.DialogInterface.OnClickListener() {
                public void onClick(android.content.DialogInterface d, int w) { start(a, info); }
            });
        if (!mandatory) b.setNegativeButton("Later", null);
        b.show();
    }

    static void start(final Activity a, final JSONObject info) {
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            pending = info;
            new AlertDialog.Builder(a)
                .setTitle("One-time permission")
                .setMessage("To update itself, Hasanath needs permission to install apps. "
                    + "Turn on \"Allow from this source\", then come back.")
                .setPositiveButton("Open settings", new android.content.DialogInterface.OnClickListener() {
                    public void onClick(android.content.DialogInterface d, int w) {
                        a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + a.getPackageName())));
                    }
                })
                .setNegativeButton("Cancel", new android.content.DialogInterface.OnClickListener() {
                    public void onClick(android.content.DialogInterface d, int w) { pending = null; }
                })
                .show();
            return;
        }
        download(a, info);
    }

    /** Call from onResume: continues an update once install permission is granted. */
    static void resume(Activity a) {
        if (pending == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) return;
        JSONObject info = pending;
        pending = null;
        download(a, info);
    }

    static void download(final Activity a, final JSONObject info) {
        final String apkUrl = info.optString("apkUrl", "");
        if (!apkUrl.startsWith("https://")) {
            Toast.makeText(a, "Update link is invalid", Toast.LENGTH_SHORT).show();
            return;
        }
        busy = true;

        float dp = a.getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding((int) (24 * dp), (int) (16 * dp), (int) (24 * dp), (int) (8 * dp));
        final ProgressBar bar = new ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(true);
        final TextView label = new TextView(a);
        label.setText("Downloading…");
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        label.setGravity(Gravity.END);
        box.addView(bar);
        box.addView(label);
        final AlertDialog dlg = new AlertDialog.Builder(a)
            .setTitle("Updating Hasanath")
            .setView(box)
            .setCancelable(false)
            .show();

        new Thread(new Runnable() { public void run() {
            File out = new File(a.getCacheDir(), "update.apk");
            try {
                HttpURLConnection c = open(apkUrl);
                final int total = c.getContentLength();
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                InputStream in = c.getInputStream();
                OutputStream os = new FileOutputStream(out);
                byte[] buf = new byte[16384];
                long done = 0; int n, lastPct = -1;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n); sha.update(buf, 0, n); done += n;
                    if (total > 0) {
                        final int pct = (int) (done * 100 / total);
                        if (pct != lastPct) {
                            lastPct = pct;
                            ui.post(new Runnable() { public void run() {
                                bar.setIndeterminate(false); bar.setProgress(pct); label.setText(pct + "%");
                            }});
                        }
                    }
                }
                os.close(); in.close(); c.disconnect();

                String expected = info.optString("sha256", "").trim().toLowerCase();
                if (!expected.isEmpty() && !expected.equals(hex(sha.digest()))) {
                    out.delete();
                    throw new Exception("checksum");
                }
                install(a, out);
                ui.post(new Runnable() { public void run() { dlg.dismiss(); busy = false; }});
            } catch (final Exception e) {
                out.delete();
                ui.post(new Runnable() { public void run() {
                    dlg.dismiss(); busy = false;
                    Toast.makeText(a, "checksum".equals(e.getMessage())
                        ? "Update file was damaged. Please try again."
                        : "Update download failed. Check your connection.", Toast.LENGTH_LONG).show();
                }});
            }
        }}).start();
    }

    static void install(Context c, File apk) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        params.setSize(apk.length());
        int id = pi.createSession(params);
        PackageInstaller.Session s = pi.openSession(id);
        try {
            OutputStream o = s.openWrite("hasanath.apk", 0, apk.length());
            InputStream i = new FileInputStream(apk);
            byte[] buf = new byte[65536]; int n;
            while ((n = i.read(buf)) > 0) o.write(buf, 0, n);
            i.close();
            s.fsync(o);
            o.close();
            Intent result = new Intent(c, ResultReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getBroadcast(c, id, result, flags).getIntentSender());
        } finally {
            s.close();
        }
    }

    /** Receives the installer's answer; shows Android's confirmation screen. */
    public static class ResultReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    c.startActivity(confirm);
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                Toast.makeText(c, status == PackageInstaller.STATUS_FAILURE_ABORTED
                    ? "Update cancelled"
                    : "Update could not be installed" + (msg != null ? ": " + msg : ""),
                    Toast.LENGTH_LONG).show();
            }
        }
    }

    static HttpURLConnection open(String url) throws Exception {
        // Follow redirects by hand so a GitHub Releases link (which hops hosts) works.
        for (int hop = 0; hop < 5; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String next = c.getHeaderField("Location");
                c.disconnect();
                if (next == null) break;
                url = new URL(new URL(url), next).toString();
                if (!url.startsWith("https://")) throw new Exception("insecure redirect");
                continue;
            }
            if (code != 200) { c.disconnect(); throw new Exception("HTTP " + code); }
            return c;
        }
        throw new Exception("too many redirects");
    }

    static byte[] fetch(String url) throws Exception {
        HttpURLConnection c = open(url);
        InputStream in = c.getInputStream();
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close(); c.disconnect();
        return b.toByteArray();
    }

    static String hex(byte[] d) {
        StringBuilder sb = new StringBuilder();
        for (byte x : d) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
