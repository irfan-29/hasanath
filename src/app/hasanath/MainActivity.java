package app.hasanath;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.app.AlertDialog;
import android.content.pm.verify.domain.DomainVerificationManager;
import android.content.pm.verify.domain.DomainVerificationUserState;
import android.provider.Settings;
import java.util.Map;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.graphics.Typeface;
import android.content.res.ColorStateList;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Toast;

/**
 * Hasanath for Android: a full-screen shell around the Hasanath web app.
 * Pages from the app's own hosts open inside; every other link (YouTube,
 * Telegram, mail...) opens in the app that normally handles it.
 */
public class MainActivity extends Activity {

    static final String START_URL = "https://hasanath.app/";
    static final String[] APP_HOSTS = {
        "hasanath.app", "www.hasanath.app",
        "hasanath.vercel.app", "salah-tracker-umi-apps.vercel.app", "hasanath-api.vercel.app"
    };
    // Earlier addresses of the site. They all redirect to hasanath.app now;
    // links to them are opened on the new address directly, so the app never
    // waits on a redirect and always uses the one set of cookies.
    static final String[] OLD_HOSTS = {
        "www.hasanath.app", "hasanath.vercel.app", "salah-tracker-umi-apps.vercel.app"
    };
    static final String API_HOST = "hasanath-api.vercel.app";
    static final String DEFAULT_BAR_COLOR = "#0f302c";
    // Accent ids and colours from Settings -> Theme. Must match the
    // --accent-fill-1 values in frontend/src/styles/base.css and the launch
    // themes in res/values*/styles.xml.
    static final String[] ACCENT_IDS =    {"green",   "blue",    "violet",  "gold",    "rose",    "ocean"};
    static final String[] ACCENT_COLORS = {"#0d9488", "#2563eb", "#7c3aed", "#b45309", "#be123c", "#0e7490"};
    static final int[] ACCENT_THEMES = {
        R.style.Theme_Hasanath, R.style.Theme_Hasanath_Blue, R.style.Theme_Hasanath_Violet,
        R.style.Theme_Hasanath_Gold, R.style.Theme_Hasanath_Rose, R.style.Theme_Hasanath_Ocean
    };
    /** True while the app is on screen; background alerts skip what the bell already shows. */
    static volatile boolean visible;

    static String savedAccentColor(android.content.Context c) {
        String id = c.getSharedPreferences("hasanath", MODE_PRIVATE).getString("accent", "green");
        return ACCENT_COLORS[accentIndex(id)];
    }

    /** The user's accent colour, remembered from their last session. */
    String SPLASH_COLOR = "#0d9488";

    static int accentIndex(String id) {
        for (int i = 0; i < ACCENT_IDS.length; i++) if (ACCENT_IDS[i].equals(id)) return i;
        return 0;
    }

    /**
     * Called by the page whenever the accent changes. Remembered so the next
     * launch opens straight in this colour; on Android 13+ the system splash
     * is switched too, so even the first frame matches.
     */
    void rememberAccent(String id) {
        int i = accentIndex(id);
        if (!ACCENT_IDS[i].equals(id)) return;   // unknown id: ignore
        SharedPreferences prefs = getSharedPreferences("hasanath", MODE_PRIVATE);
        if (id.equals(prefs.getString("accent", "green"))) return;
        prefs.edit().putString("accent", id).apply();
        if (Build.VERSION.SDK_INT >= 33) {
            try { getSplashScreen().setSplashScreenTheme(ACCENT_THEMES[i]); } catch (Exception e) { /* older OEM builds */ }
        }
    }
    static final int FILE_CHOOSER_REQUEST = 41;

    private WebView webView;
    private volatile boolean dhikrKeys;
    private String geoOrigin;
    private android.webkit.GeolocationPermissions.Callback geoCallback;
    private View splash;
    private long splashShownAt;
    private boolean splashHiding;
    private String pendingTop, pendingBottom;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Start in the user's accent theme (window background and bars) before
        // anything is drawn.
        int accent = accentIndex(getSharedPreferences("hasanath", MODE_PRIVATE).getString("accent", "green"));
        SPLASH_COLOR = ACCENT_COLORS[accent];
        setTheme(ACCENT_THEMES[accent]);
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        // Until the page reports its own header/footer colours (see BAR_SYNC_JS).
        applyBarColors(SPLASH_COLOR, SPLASH_COLOR);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f8fafc"));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        showSplash();
        Updater.cleanup(this);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " HasanathAndroid/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new Bridge(), "HasanathAndroid");
        webView.setWebViewClient(new AppClient());
        webView.setWebChromeClient(new AppChrome());

        // Lock-screen / notification controls -> the web player.
        MediaService.listener = new MediaService.Listener() {
            @Override public void onMediaAction(final String action, final long valueMs) {
                runOnUiThread(new Runnable() { public void run() {
                    if (webView == null) return;
                    webView.evaluateJavascript("(window.__hsMediaAction||window.__hasanathMedia||function(){})('"
                        + action + "'," + valueMs + ")", null);
                }});
            }
        };

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            String openPath = getIntent() != null ? getIntent().getStringExtra(Notifier.EXTRA_OPEN) : null;
            Uri data = getIntent() != null ? toAppUri(getIntent().getData()) : null;
            if (openPath != null && openPath.startsWith("/")) webView.loadUrl(Net.origin() + openPath);
            else webView.loadUrl(data != null && isAppHost(data) ? data.toString() : START_URL);
        }
    }

    /**
     * Links on the site's earlier addresses, and older share links on the API
     * host, only redirect to the app. Rewrite them straight to the app's own
     * address (skipping the redirect); genuine /api calls are left alone.
     */
    static Uri toAppUri(Uri uri) {
        if (uri == null || uri.getHost() == null) return uri;
        boolean old = false;
        for (String h : OLD_HOSTS) if (h.equalsIgnoreCase(uri.getHost())) old = true;
        if (!old) {
            if (!API_HOST.equalsIgnoreCase(uri.getHost())) return uri;
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (path.startsWith("/api")) return uri;
        }
        Uri start = Uri.parse(START_URL);
        return uri.buildUpon().authority(start.getAuthority()).build();
    }

    static boolean isAppHost(Uri uri) {
        if (uri == null || uri.getHost() == null) return false;
        if (!"https".equals(uri.getScheme())) return false;
        for (String h : APP_HOSTS) if (h.equalsIgnoreCase(uri.getHost())) return true;
        return false;
    }

    void openExternally(Uri uri) {
        try {
            Intent i;
            if ("intent".equals(uri.getScheme())) {
                i = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app found to open this link", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Could not open this link", Toast.LENGTH_SHORT).show();
        }
    }

    class AppClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            Uri app = toAppUri(uri);
            if (app != uri) { view.loadUrl(app.toString()); return true; }
            if (isAppHost(uri)) return false;
            openExternally(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            // A fresh page never inherits eyes-closed mode from the one before it.
            dhikrKeys = false;
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            pollReady();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // The web app prefers navigator.share; WebView has none, so route it
            // to Android's share sheet.
            view.evaluateJavascript(
                "if(window.HasanathAndroid&&!navigator.share){navigator.share=function(d){d=d||{};"
              + "HasanathAndroid.share(d.title||'',d.url||d.text||location.href);return Promise.resolve();};}",
                null);
            view.evaluateJavascript(BAR_SYNC_JS, null);
            view.evaluateJavascript(MEDIA_JS, null);
            view.evaluateJavascript(pullRefreshJs(), null);
            CookieManager.getInstance().flush();
            saveSessionCookie();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) {
                hideSplash();
                view.loadDataWithBaseURL(null,
                    "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
                  + "<body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;"
                  + "min-height:100vh;margin:0;background:#f8fafc;color:#334155;text-align:center'><div>"
                  + "<h2 style='color:#0d9488'>Can't reach Hasanath</h2>"
                  + "<p>Check your internet connection, then try again.</p>"
                  + "<button onclick='HasanathAndroid.retry()' style='background:#0d9488;color:#fff;border:0;"
                  + "border-radius:8px;padding:12px 24px;font-size:16px'>Try again</button></div></body>",
                    "text/html", "utf-8", null);
            }
        }
    }

    class AppChrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customViewCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setVisibility(View.GONE);
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            webView.setVisibility(View.VISIBLE);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            webView.evaluateJavascript("window.__hsSync&&window.__hsSync()", null);
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }

        // "Use my current location": the page asks the WebView, the WebView asks
        // here, and Android's own permission prompt is shown the first time.
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
            if (!isAppHost(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            geoOrigin = origin;
            geoCallback = callback;
            requestPermissions(new String[] { android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION }, 21);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }

    class Bridge {
        @JavascriptInterface
        public void share(final String title, final String url) {
            runOnUiThread(new Runnable() { public void run() {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT, title);
                send.putExtra(Intent.EXTRA_TEXT, url);
                startActivity(Intent.createChooser(send, "Share"));
            }});
        }

        @JavascriptInterface
        public void media(final String json) {
            runOnUiThread(new Runnable() { public void run() {
                if (json != null && json.contains("\"playing\"")) askNotificationPermissionOnce();
                MediaService.update(MainActivity.this, json);
            }});
        }

        @JavascriptInterface
        public void bars(final String top, final String bottom) {
            runOnUiThread(new Runnable() { public void run() {
                if (splash != null) { pendingTop = top; pendingBottom = bottom; return; }
                if (customView == null) applyBarColors(top, bottom);
            }});
        }

        /** For a "Check for updates" button in Settings: HasanathAndroid.checkForUpdates() */
        @JavascriptInterface
        public void checkForUpdates() {
            runOnUiThread(new Runnable() { public void run() { Updater.check(MainActivity.this, true); }});
        }

        /** e.g. to show "App version 1.4" in Settings */
        @JavascriptInterface
        public String appVersion() { return Updater.currentVersionName(MainActivity.this); }

        // ---- Phone notifications (Settings -> Phone Notifications) ----

        @JavascriptInterface
        public String getNotificationSettings() {
            try {
                org.json.JSONObject out = new org.json.JSONObject();
                out.put("settings", Notifier.settings(MainActivity.this));
                out.put("permission", Notifier.permissionGranted(MainActivity.this));
                out.put("exactAlarms", PrayerReminders.exactAllowed(MainActivity.this));
                SharedPreferences p = getSharedPreferences("hasanath", MODE_PRIVATE);
                out.put("nextReminder", p.getString(PrayerReminders.PREF_NEXT, ""));
                out.put("needsLocation", p.getBoolean(PrayerReminders.PREF_NEEDS_LOCATION, false));
                return out.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public void setNotificationSettings(String json) {
            try { Notifier.saveSettings(MainActivity.this, json); } catch (Exception ignored) { }
            final android.content.Context app = getApplicationContext();
            new Thread(new Runnable() { public void run() { PrayerReminders.schedule(app); }}).start();
        }

        @JavascriptInterface
        public void refreshPrayerReminders() {
            runOnUiThread(new Runnable() { public void run() {
                saveSessionCookie();
                // Give the save a moment to land before re-reading the timings.
                root.postDelayed(new Runnable() { public void run() {
                    PrayerReminders.refreshAsync(MainActivity.this);
                }}, 800);
            }});
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(new Runnable() { public void run() {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                        != PackageManager.PERMISSION_GRANTED && !getSharedPreferences("hasanath", MODE_PRIVATE)
                        .getBoolean("notifyPermDeniedTwice", false)) {
                    requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 9);
                } else {
                    openNotificationSettings();
                }
            }});
        }

        @JavascriptInterface
        public void requestExactAlarms() {
            runOnUiThread(new Runnable() { public void run() {
                if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) { openNotificationSettings(); }
                }
            }});
        }

        @JavascriptInterface
        public void openSystemNotificationSettings() {
            runOnUiThread(new Runnable() { public void run() { openNotificationSettings(); }});
        }

        @JavascriptInterface
        public void testNotification() {
            runOnUiThread(new Runnable() { public void run() {
                if (!Notifier.permissionGranted(MainActivity.this)) {
                    Toast.makeText(MainActivity.this, "Turn on notifications for Hasanath first", Toast.LENGTH_LONG).show();
                    requestNotificationPermission();
                    return;
                }
                Notifier.post(MainActivity.this, 4999, Notifier.CH_PRAYER, "It's time for Asr",
                    "This is a test. Your prayer reminders will look like this.", "/salah", "Log prayer", "/salah");
            }});
        }

        // ---- Dhikr counter ----

        @JavascriptInterface
        public void vibrate(final String kind) { buzz(String.valueOf(kind)); }

        @JavascriptInterface
        public void dhikrKeys(final boolean on) { dhikrKeys = on; }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() { public void run() {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }});
        }

        @JavascriptInterface
        public void accent(final String id) {
            runOnUiThread(new Runnable() { public void run() { rememberAccent(String.valueOf(id)); }});
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(new Runnable() { public void run() { webView.loadUrl(START_URL); }});
        }
    }

    /**
     * Lock-screen / notification player, without help from the website.
     *
     * Android WebView has no Media Session API, so the page's audio is invisible
     * to the system. This finds the recitation's audio element the moment it
     * starts playing (by wrapping HTMLMediaElement.play), reads the surah and
     * reciter from the player bar, and reports every change to MediaService.
     * Notification buttons come back through __hsMediaAction: play/pause/seek
     * act on the element, previous/next press the player bar's own buttons.
     * If the web app ships its own bridge (window.__hasanathMedia), this steps
     * aside and forwards to it instead.
     */
    static final String MEDIA_JS =
        "(function(){if(window.__hsMedia)return;window.__hsMedia=1;var A=null,last='';"
      + "function q(s){return document.querySelector(s);}"
      + "function txt(s){var e=q(s);return e?e.textContent.replace(/\\s+/g,' ').trim():'';}"
      + "function btn(l){return q('[aria-label=\"'+l+'\"]');}"
      + "function st(){if(!A||!(A.currentSrc||A.getAttribute('src')))return{state:'none'};"
      + "var p=btn('Previous surah'),n=btn('Next surah'),d=isFinite(A.duration)?A.duration:0;"
      + "return{state:A.paused?'paused':'playing',"
      + "title:txt('.global-audio-bar .surah-title')||txt('.surah-title')||\"Qur'an recitation\","
      + "artist:txt('.global-audio-bar .reciter-name')||txt('.reciter-name'),"
      + "positionMs:Math.round(A.currentTime*1000),durationMs:Math.round(d*1000),"
      + "canPrev:!!p&&!p.disabled,canNext:!!n&&!n.disabled};}"
      + "function send(force){if(window.__hasanathMedia)return;var s=st();"
      + "var k=[s.state,s.title,s.artist,s.canPrev,s.canNext,s.durationMs].join('|');"
      + "if(force||k!==last){last=k;try{HasanathAndroid.media(JSON.stringify(s));}catch(e){}}}"
      + "function attach(el){if(A===el)return;A=el;"
      + "['play','playing','pause','seeked','loadedmetadata','durationchange','ended','emptied','ratechange']"
      + ".forEach(function(e){el.addEventListener(e,function(){send(true);});});}"
      + "var op=HTMLMediaElement.prototype.play;"
      + "HTMLMediaElement.prototype.play=function(){if(this.tagName!=='VIDEO')attach(this);return op.apply(this,arguments);};"
      + "window.__hsMediaAction=function(a,v){"
      + "if(window.__hasanathMedia){window.__hasanathMedia(a,v);return;}if(!A)return;"
      + "if(a==='play'){var r=A.play();if(r&&r.catch)r.catch(function(){});}"
      + "else if(a==='pause'||a==='stop')A.pause();"
      + "else if(a==='previoustrack'){var b=btn('Previous surah');if(b&&!b.disabled)b.click();}"
      + "else if(a==='nexttrack'){var c=btn('Next surah');if(c&&!c.disabled)c.click();}"
      + "else if(a==='seekto')A.currentTime=Math.max(0,v/1000);"
      + "else if(a==='seekforward')A.currentTime=Math.min(isFinite(A.duration)?A.duration:1e9,A.currentTime+10);"
      + "else if(a==='seekbackward')A.currentTime=Math.max(0,A.currentTime-10);};"
      + "setInterval(function(){if(A)send(false);},1000);})();";

    /**
     * "Open supported links" turns on by itself only once Android has verified
     * the domains (it fetches /.well-known/assetlinks.json from each). Android
     * gives apps no way to switch it on directly, so if it is still off, offer
     * to take the user to the toggle - once, and never again after it works.
     */
    void checkLinkHandling() {
        if (Build.VERSION.SDK_INT < 31) return;
        try {
            DomainVerificationManager dvm = getSystemService(DomainVerificationManager.class);
            DomainVerificationUserState state = dvm.getDomainVerificationUserState(getPackageName());
            if (state == null) return;
            Map<String, Integer> hosts = state.getHostToStateMap();
            Integer main = hosts.get("hasanath.app");
            boolean ok = state.isLinkHandlingAllowed() && main != null
                && main != DomainVerificationUserState.DOMAIN_STATE_NONE;
            if (ok) return;
            final SharedPreferences prefs = getSharedPreferences("hasanath", MODE_PRIVATE);
            if (prefs.getBoolean("askedLinks", false)) return;
            prefs.edit().putBoolean("askedLinks", true).apply();
            new AlertDialog.Builder(this)
                .setTitle("Open Hasanath links here?")
                .setMessage("Turn on \"Open supported links\" so shared posts and surahs open in the app instead of the browser.")
                .setPositiveButton("Turn on", new android.content.DialogInterface.OnClickListener() {
                  public void onClick(android.content.DialogInterface d, int which) {
                    try {
                        startActivity(new Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS,
                            Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName())));
                    }
                  }
                })
                .setNegativeButton("Not now", null)
                .show();
        } catch (Exception e) {
            // Settings screens differ by manufacturer; never crash over this.
        }
    }

    /**
     * Paints the status bar and navigation bar with the colours actually on
     * screen at the very top and bottom of the page (the app header and the tab
     * bar), so they read as one surface instead of two strips. The header is
     * translucent glass, so its colour is composited over the page behind it.
     * Re-checked every second: cheap, and it follows theme changes and routes
     * without the web app needing to know about the Android shell.
     */
    static final String BAR_SYNC_JS =
        "(function(){if(window.__hsBars)return;window.__hsBars=1;"
      + "function rgb(s){var m=s&&s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;"
      + "var p=m[1].split(',').map(parseFloat);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}"
      + "function base(){var e=[document.body,document.documentElement];for(var i=0;i<e.length;i++){"
      + "var c=e[i]&&rgb(getComputedStyle(e[i]).backgroundColor);if(c&&c.a>0)return c;}return{r:255,g:255,b:255,a:1};}"
      + "function at(y){var el=document.elementFromPoint(innerWidth/2,y),L=[];"
      + "while(el&&el!==document.documentElement){var c=rgb(getComputedStyle(el).backgroundColor);"
      + "if(c&&c.a>0){L.push(c);if(c.a>=1)break;}el=el.parentElement;}"
      + "var o=(L.length&&L[L.length-1].a>=1)?L.pop():base();o={r:o.r,g:o.g,b:o.b};"
      + "for(var i=L.length-1;i>=0;i--){var l=L[i];o.r=l.r*l.a+o.r*(1-l.a);o.g=l.g*l.a+o.g*(1-l.a);o.b=l.b*l.a+o.b*(1-l.a);}"
      + "function h(v){v=Math.round(Math.max(0,Math.min(255,v))).toString(16);return v.length<2?'0'+v:v;}"
      + "return'#'+h(o.r)+h(o.g)+h(o.b);}"
      + "var last='',lastAcc='';function sync(){try{var t=at(1),b=at(innerHeight-1),k=t+b;"
      + "if(k!==last){last=k;HasanathAndroid.bars(t,b);}"
      + "var acc=document.documentElement.getAttribute('data-accent')||'green';"
      + "if(acc!==lastAcc&&document.getElementById('root')&&document.getElementById('root').childElementCount){"
      + "lastAcc=acc;HasanathAndroid.accent(acc);}}catch(e){}}"
      + "window.__hsSync=function(){last='';sync();};"
      + "sync();setInterval(sync,1000);addEventListener('resize',sync);})();";

    void applyBarColors(String top, String bottom) {
        try {
            int t = Color.parseColor(top), b = Color.parseColor(bottom);
            Window w = getWindow();
            w.setStatusBarColor(t);
            w.setNavigationBarColor(b);
            if (root != null) root.setBackgroundColor(b);
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility();
            // Dark icons on a light bar, light icons on a dark one.
            if (isLight(t)) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) {
                if (isLight(b)) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
            if (Build.VERSION.SDK_INT >= 28) w.setNavigationBarDividerColor(b);
        } catch (Exception e) {
            // Unparseable colour from the page: keep the current bars.
        }
    }

    static boolean isLight(int c) {
        double l = 0.2126 * Color.red(c) + 0.7152 * Color.green(c) + 0.0722 * Color.blue(c);
        return l > 160;
    }

    // ---- Launch screen -------------------------------------------------------
    //
    // Brand colour, the mosque mark and the name, shown from the first frame
    // until the web app has actually rendered (React has replaced its own boot
    // loader). On Android 12+ the system splash draws the same mark in the same
    // place, so the hand-over is seamless. A spinner only appears if loading
    // takes longer than a moment.

    void showSplash() {
        float dp = getResources().getDisplayMetrics().density;
        FrameLayout s = new FrameLayout(this);
        s.setBackgroundColor(Color.parseColor(SPLASH_COLOR));
        s.setClickable(true);   // swallow taps meant for the page underneath

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash_logo);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams((int) (240 * dp), (int) (240 * dp), Gravity.CENTER);
        s.addView(logo, lp);

        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView name = new TextView(this);
        name.setText("Hasanath");
        name.setTextColor(Color.WHITE);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        name.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        name.setLetterSpacing(0.01f);
        TextView tag = new TextView(this);
        tag.setText("Pray · Track · Grow");
        tag.setTextColor(Color.argb(210, 255, 255, 255));
        tag.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        tag.setPadding(0, (int) (4 * dp), 0, 0);
        words.addView(name);
        words.addView(tag);
        FrameLayout.LayoutParams wp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        s.addView(words, wp);

        // Centre the logo + name as ONE group. The logo starts at the exact
        // centre (where Android 12+'s system splash leaves it) and glides up
        // into place as the name fades in underneath.
        final ImageView fLogo = logo;
        final LinearLayout fWords = words;
        final float fdp = dp;
        words.post(new Runnable() { public void run() {
            float glyphH = 240 * fdp * 0.42f * 774f / 960f;   // visible mark inside the 240dp image
            float gap = 28 * fdp;
            float textH = fWords.getHeight();
            float total = glyphH + gap + textH;
            float logoY = -total / 2f + glyphH / 2f;
            float wordsY = total / 2f - textH / 2f;
            fWords.setTranslationY(wordsY + 8 * fdp);
            fLogo.animate().translationY(logoY).setDuration(420)
                .setInterpolator(new android.view.animation.DecelerateInterpolator(1.6f)).start();
            fWords.animate().alpha(1f).translationY(wordsY).setDuration(420).setStartDelay(120)
                .setInterpolator(new android.view.animation.DecelerateInterpolator(1.6f)).start();
        }});

        final ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(Color.argb(230, 255, 255, 255)));
        spinner.setVisibility(View.INVISIBLE);
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams((int) (32 * dp), (int) (32 * dp),
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        sp.bottomMargin = (int) (72 * dp);
        s.addView(spinner, sp);
        s.postDelayed(new Runnable() { public void run() {
            if (splash != null && !splashHiding) {
                spinner.setAlpha(0f);
                spinner.setVisibility(View.VISIBLE);
                spinner.animate().alpha(1f).setDuration(250).start();
            }
        }}, 1100);

        words.setAlpha(0f);

        root.addView(s, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = s;
        splashShownAt = SystemClockNow();
        // Never leave someone staring at the splash if the page misbehaves.
        s.postDelayed(new Runnable() { public void run() { hideSplash(); }}, 12000);
    }

    static long SystemClockNow() { return android.os.SystemClock.uptimeMillis(); }

    void pollReady() {
        if (splash == null || splashHiding) return;
        webView.evaluateJavascript(
            "(function(){var r=document.getElementById('root');"
          + "return !!r&&r.childElementCount>0&&!document.getElementById('boot-loader');})()",
            new ValueCallback<String>() { public void onReceiveValue(String v) {
                if ("true".equals(v)) hideSplash();
                else if (splash != null) root.postDelayed(new Runnable() { public void run() { pollReady(); }}, 150);
            }});
    }

    void hideSplash() {
        if (splash == null || splashHiding) return;
        splashHiding = true;
        // Keep the brand on screen for a beat even on a warm, instant load.
        long wait = Math.max(0, 700 - (SystemClockNow() - splashShownAt));
        final View s = splash;
        s.postDelayed(new Runnable() { public void run() {
            s.animate().alpha(0f).setDuration(260).withEndAction(new Runnable() { public void run() {
                root.removeView(s);
                splash = null;
                if (pendingTop != null) applyBarColors(pendingTop, pendingBottom);
                else applyBarColors(DEFAULT_BAR_COLOR, DEFAULT_BAR_COLOR);
                webView.evaluateJavascript("window.__hsSync&&window.__hsSync()", null);
                Updater.check(MainActivity.this, false);
                saveSessionCookie();
                Notifier.ensureChannels(MainActivity.this);
                PrayerReminders.refreshAsync(MainActivity.this);
                NotificationPoller.schedule(MainActivity.this);
                final android.content.Context appCtx = getApplicationContext();
                new Thread(new Runnable() { public void run() { AyahReminder.sendIfDue(appCtx); }}).start();
                root.postDelayed(new Runnable() { public void run() {
                    if (!isFinishing()) offerNotificationsOnce();
                }}, 1200);
                root.postDelayed(new Runnable() { public void run() {
                    if (!isFinishing()) checkLinkHandling();
                }}, 6000);
            }}).start();
        }}, wait);
    }

    private boolean askedNotifications;

    /** Android 13+: needed for the playback controls to appear in the shade. */
    void askNotificationPermissionOnce() {
        if (askedNotifications || Build.VERSION.SDK_INT < 33) return;
        askedNotifications = true;
        if (checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 7);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String openPath = intent.getStringExtra(Notifier.EXTRA_OPEN);
        if (openPath != null && openPath.startsWith("/")) { webView.loadUrl(Net.origin() + openPath); return; }
        Uri data = toAppUri(intent.getData());
        if (data != null && isAppHost(data)) webView.loadUrl(data.toString());
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Dhikr, eyes-closed mode: a volume key is one count, so the phone can be
        // held like a tasbih counter without finding the screen.
        if (dhikrKeys && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getRepeatCount() == 0) {
                webView.evaluateJavascript("window.__hasanathDhikr&&window.__hasanathDhikr()", null);
            }
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (customView != null) { new AppChrome().onHideCustomView(); return true; }
            if (webView.canGoBack()) { webView.goBack(); return true; }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        // Swallow the release too, so the volume slider never appears mid-dhikr.
        if (dhikrKeys && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) return true;
        return super.onKeyUp(keyCode, event);
    }

    /** Haptics for the dhikr counter: "tick" per count, "milestone" at each 33, "done" at the target. */
    void buzz(String kind) {
        try {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if ("done".equals(kind)) {
                long[] p = {0, 240, 120, 240, 120, 460};
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createWaveform(p, -1)); else v.vibrate(p, -1);
            } else if ("milestone".equals(kind)) {
                long[] p = {0, 70, 80, 70};
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createWaveform(p, -1)); else v.vibrate(p, -1);
            } else if (Build.VERSION.SDK_INT >= 29) {
                // The phone's own crisp "click", the same one its keyboard uses.
                v.vibrate(android.os.VibrationEffect.createPredefined(android.os.VibrationEffect.EFFECT_CLICK));
            } else if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(android.os.VibrationEffect.createOneShot(18, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(18);
            }
        } catch (Exception e) {
            // No vibrator, or blocked by battery saver: counting carries on.
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        webView.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        Updater.resume(this);
        // Coming back from Android settings (exact alarms, notification
        // permission) or after a day away: re-plan reminders.
        if (splash == null) PrayerReminders.refreshAsync(this);
    }

    private String pullJs;

    /** res/raw/pull_refresh.js: drag down at the top of the page to reload. */
    String pullRefreshJs() {
        if (pullJs != null) return pullJs;
        try {
            java.io.InputStream in = getResources().openRawResource(R.raw.pull_refresh);
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096]; int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            in.close();
            pullJs = new String(b.toByteArray(), "UTF-8");
        } catch (Exception e) { pullJs = ""; }
        return pullJs;
    }

    /**
     * Android 12+ holds back reminders by several minutes unless the app may
     * set exact alarms, and Android 14 denies that by default for apps from
     * outside the Play Store. Ask once, in plain words, when reminders are on.
     */
    void offerExactAlarmsOnce() {
        if (Build.VERSION.SDK_INT < 31 || PrayerReminders.exactAllowed(this)) return;
        if (!Notifier.settings(this).optBoolean("prayer", true)) return;
        final SharedPreferences prefs = getSharedPreferences("hasanath", MODE_PRIVATE);
        if (prefs.getBoolean("askedExactAlarms", false)) return;
        prefs.edit().putBoolean("askedExactAlarms", true).apply();
        new AlertDialog.Builder(this)
            .setTitle("On-time reminders")
            .setMessage("To remind you exactly at each prayer time, Hasanath needs the "
                + "\"Alarms & reminders\" permission. Without it, reminders can arrive "
                + "several minutes late.")
            .setPositiveButton("Allow", new android.content.DialogInterface.OnClickListener() {
                public void onClick(android.content.DialogInterface d, int w) {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) { openNotificationSettings(); }
                }
            })
            .setNegativeButton("Not now", null)
            .show();
    }

    void saveSessionCookie() {
        try {
            String cookie = CookieManager.getInstance().getCookie(Net.origin());
            getSharedPreferences("hasanath", MODE_PRIVATE).edit()
                .putString(Net.PREF_COOKIE, cookie == null ? "" : cookie).apply();
        } catch (Exception ignored) { }
    }

    void openNotificationSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 21) {
            boolean ok = false;
            for (int r : results) if (r == PackageManager.PERMISSION_GRANTED) ok = true;
            if (geoCallback != null) geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
            if (!ok) Toast.makeText(this, "Location is off for Hasanath. You can still search for your city.", Toast.LENGTH_LONG).show();
            return;
        }
        // Android stops showing its prompt after two refusals; from then on the
        // "Turn on" button goes straight to the app's notification settings.
        if (Build.VERSION.SDK_INT >= 33 && results.length > 0 && results[0] != PackageManager.PERMISSION_GRANTED
                && !shouldShowRequestPermissionRationale("android.permission.POST_NOTIFICATIONS")) {
            getSharedPreferences("hasanath", MODE_PRIVATE).edit().putBoolean("notifyPermDeniedTwice", true).apply();
        }
        webView.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))", null);
        if (requestCode == 8 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            root.postDelayed(new Runnable() { public void run() {
                if (!isFinishing()) offerExactAlarmsOnce();
            }}, 600);
        }
    }

    /** First launch: explain, then ask Android for notification permission (13+). */
    void offerNotificationsOnce() {
        final SharedPreferences prefs = getSharedPreferences("hasanath", MODE_PRIVATE);
        if (prefs.getBoolean("askedNotifyPerm", false) || Notifier.permissionGranted(this)) {
            // Notifications already settled: the only thing left to ask is timing.
            offerExactAlarmsOnce();
            return;
        }
        prefs.edit().putBoolean("askedNotifyPerm", true).apply();
        if (Build.VERSION.SDK_INT < 33) { offerExactAlarmsOnce(); return; }
        new AlertDialog.Builder(this)
            .setTitle("Prayer reminders")
            .setMessage("Get a notification at each prayer time, plus friend requests and challenge "
                + "invites. You can choose exactly which ones in Settings.")
            .setPositiveButton("Turn on", new android.content.DialogInterface.OnClickListener() {
                public void onClick(android.content.DialogInterface d, int w) {
                    askedNotifications = true;
                    requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 8);
                }
            })
            .setNegativeButton("Not now", null)
            .show();
    }

    @Override
    protected void onPause() {
        super.onPause();
        visible = false;
        saveSessionCookie();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        MediaService.listener = null;
        stopService(new Intent(this, MediaService.class));
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
