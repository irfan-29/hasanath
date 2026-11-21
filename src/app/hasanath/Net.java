package app.hasanath;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Background requests to the Hasanath API as the signed-in user.
 *
 * Background work runs without the WebView, so it borrows the session cookie
 * the WebView last held (saved by MainActivity each time a page loads). The
 * cookie stays in this app's private storage and is only ever sent to the
 * Hasanath host.
 */
public class Net {

    static final String PREF_COOKIE = "sessionCookie";

    static String origin() {
        String u = MainActivity.START_URL;
        return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
    }

    /** JSON body, or null on 401 / any failure. */
    static JSONObject getJson(Context c, String path) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(origin() + path).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "HasanathAndroid/" + Updater.currentVersionName(c));
            String cookie = Notifier.prefs(c).getString(PREF_COOKIE, "");
            if (!cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            if (conn.getResponseCode() != 200) return null;
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            in.close();
            return new JSONObject(new String(b.toByteArray(), "UTF-8"));
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
