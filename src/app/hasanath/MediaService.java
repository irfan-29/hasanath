package app.hasanath;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONObject;

/**
 * Keeps Qur'an recitation playing with the screen off and shows it on the lock
 * screen, notification shade, headphones and Bluetooth/car controls.
 *
 * The audio itself still plays inside the WebView. This service owns the
 * system-facing side: a MediaSession, a media-style notification, and the
 * foreground status that stops Android from killing playback in the
 * background. Button presses are handed back to the web player through
 * {@link Listener}.
 */
public class MediaService extends Service {

    interface Listener { void onMediaAction(String action, long valueMs); }

    static final String CHANNEL_ID = "playback";
    static final int NOTIFICATION_ID = 1001;
    static final String ACTION_PLAY = "app.hasanath.PLAY";
    static final String ACTION_PAUSE = "app.hasanath.PAUSE";
    static final String ACTION_PREV = "app.hasanath.PREV";
    static final String ACTION_NEXT = "app.hasanath.NEXT";
    static final String ACTION_CLOSE = "app.hasanath.CLOSE";

    static Listener listener;
    static MediaService instance;

    // Latest state reported by the web player.
    static String title = "Qur'an recitation";
    static String artist = "";
    static boolean playing;
    static long positionMs, durationMs;
    static boolean canPrev, canNext;
    // Set when the user closes the notification, so a late "paused" update
    // from the page does not bring it straight back.
    static boolean dismissed;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private Bitmap artwork;

    /** Called on the UI thread with the JSON the web player sends. */
    static void update(Context ctx, String json) {
        try {
            JSONObject j = new JSONObject(json);
            String state = j.optString("state", "none");
            if ("none".equals(state)) {
                dismissed = false;
                ctx.stopService(new Intent(ctx, MediaService.class));
                return;
            }
            title = j.optString("title", title);
            artist = j.optString("artist", "");
            playing = "playing".equals(state);
            positionMs = j.optLong("positionMs", 0);
            durationMs = j.optLong("durationMs", 0);
            canPrev = j.optBoolean("canPrev", false);
            canNext = j.optBoolean("canNext", false);

            if (playing) dismissed = false;
            if (dismissed) return;

            if (instance != null) {
                instance.refresh();
            } else if (playing) {
                Intent i = new Intent(ctx, MediaService.class);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
                else ctx.startService(i);
            }
        } catch (Exception e) {
            // A malformed update or a background-start restriction must never
            // crash the app; playback simply continues without the notification.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Qur'an playback", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows the recitation that is playing, with controls");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }

        artwork = BitmapFactory.decodeResource(getResources(), R.drawable.artwork);

        session = new MediaSession(this, "Hasanath");
        session.setSessionActivity(openAppIntent());
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play", 0); }
            @Override public void onPause() { send("pause", 0); }
            @Override public void onStop() { send("pause", 0); }
            @Override public void onSkipToPrevious() { send("previoustrack", 0); }
            @Override public void onSkipToNext() { send("nexttrack", 0); }
            @Override public void onSeekTo(long pos) {
                positionMs = pos;
                send("seekto", pos);
                refresh();
            }
            @Override public void onFastForward() { send("seekforward", 0); }
            @Override public void onRewind() { send("seekbackward", 0); }
        });
        session.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Hasanath:playback");
        wakeLock.setReferenceCounted(false);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Hasanath:playback");
            wifiLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PLAY.equals(action)) send("play", 0);
        else if (ACTION_PAUSE.equals(action)) send("pause", 0);
        else if (ACTION_PREV.equals(action)) send("previoustrack", 0);
        else if (ACTION_NEXT.equals(action)) send("nexttrack", 0);
        else if (ACTION_CLOSE.equals(action)) {
            send("pause", 0);
            dismissed = true;
            refresh();   // startForeground must still be honoured before stopping
            stopSelf();
            return START_NOT_STICKY;
        }
        refresh();
        return START_NOT_STICKY;
    }

    void send(String action, long valueMs) {
        if (listener != null) listener.onMediaAction(action, valueMs);
    }

    void refresh() {
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, "Hasanath")
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP | PlaybackState.ACTION_FAST_FORWARD
            | PlaybackState.ACTION_REWIND;
        if (canPrev) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        if (canNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                positionMs, playing ? 1f : 0f, SystemClock.elapsedRealtime())
            .build());

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_hasanath)
         .setContentTitle(title)
         .setContentText(artist)
         .setLargeIcon(artwork)
         .setContentIntent(openAppIntent())
         .setDeleteIntent(serviceIntent(ACTION_CLOSE))
         .setVisibility(Notification.VISIBILITY_PUBLIC)
         .setOnlyAlertOnce(true)
         .setShowWhen(false)
         .setOngoing(true);

        int idx = 0;
        int[] compact;
        if (canPrev) {
            b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous,
                "Previous surah", serviceIntent(ACTION_PREV)).build());
            idx++;
        }
        int playIdx = idx;
        b.addAction(new Notification.Action.Builder(
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
            playing ? "Pause" : "Play", serviceIntent(playing ? ACTION_PAUSE : ACTION_PLAY)).build());
        idx++;
        if (canNext) {
            b.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next,
                "Next surah", serviceIntent(ACTION_NEXT)).build());
            idx++;
        }
        b.addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,
            "Close", serviceIntent(ACTION_CLOSE)).build());

        if (canPrev && canNext) compact = new int[] {0, 1, 2};
        else if (canPrev || canNext) compact = new int[] {0, 1};
        else compact = new int[] {playIdx};

        b.setStyle(new Notification.MediaStyle()
            .setMediaSession(session.getSessionToken())
            .setShowActionsInCompactView(compact));

        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            // Android may refuse foreground status from the background; still
            // show the controls as a normal notification.
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
        }
        // Stays in the foreground while paused too (as Chrome does): Android 12+
        // may refuse to re-enter the foreground from the lock screen, which
        // would leave a resumed recitation open to being killed. The Close
        // action is how the user dismisses it.

        if (playing) {
            if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } else {
            if (wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        }
    }

    private PendingIntent serviceIntent(String action) {
        Intent i = new Intent(this, MediaService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(this, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping Hasanath out of Recents destroys the WebView that was playing.
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        if (session != null) { session.setActive(false); session.release(); }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
