const mongoose = require("mongoose");
// v9 ships as a transpiled ES module, so the plugin function lives on the
// default export rather than the module object.
const passportLocalMongoose = require("passport-local-mongoose").default;

// Per-user copies of the data that used to live in global collections.
// Embedded subdocuments keep a user's whole record in one document, matching
// the approach used in the class-irfan project.
const salahEntrySchema = new mongoose.Schema({
    date: String,
    name: String,
    value: String
}, { _id: false });

const donationSchema = new mongoose.Schema({
    amount: { type: Number, required: true, min: [0.01, "Donations must be greater than zero"] },
    // ISO YYYY-MM-DD. A donation is attached to a calendar day because charity
    // targets recur: daily / weekly / monthly / yearly totals are built by
    // filtering on this key.
    date: { type: String, required: true },
    note: { type: String, default: "", trim: true }
}, { _id: false });

const charitySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    // A recurring target. The matching donations are summed only inside the
    // day / week / month / year a charity is viewed in, so progress resets the
    // way the user chose while lifetime totals remain on the donations.
    targetAmount: { type: Number, required: true, min: 0 },
    period: {
        type: String,
        enum: ["daily", "weekly", "monthly", "yearly"],
        default: "monthly"
    },
    donations: [donationSchema],
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const challengeSchema = new mongoose.Schema({
    challenge: String,
    currentStreak: Number,
    maxStreak: Number,
    // The window the challenge is meant to be checked in. ISO YYYY-MM-DD so
    // they compare directly with `history`. Challenges created before dates
    // existed have neither field and keep the old rolling-week behaviour.
    startDate: String,
    endDate: String,
    // ISO dates the challenge was checked in on. Streak counts are enough for
    // the tracker list, but the stats report needs actual days to plot, so
    // every future check-in records its date here.
    history: [String],
    // A one-time task is a single checkbox, not a streak. When completed it
    // leaves the active list and sits under Completed on the challenges page.
    oneTime: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
    // How the challenge is checked in. "manual" is the checkbox every row used
    // before this field existed, so a missing value must keep behaving that
    // way. "quran" is counted from the reader: each ayah opened in the
    // single-ayah view is one unit of progress towards `dailyTarget`.
    kind: { type: String, enum: ["manual", "quran"], default: "manual" },
    // Ayahs per day for a reading challenge (1-50). Ignored by manual rows.
    dailyTarget: Number,
    // The day the running progress belongs to, plus the exact ayahs read on it
    // ("2:255"). The list is dropped lazily when the day changes; it exists so
    // re-reading the same verse cannot inflate the count, and so a check-in can
    // be attributed to actual verses instead of a bare number.
    progressDate: String,
    progressAyahs: [String]
}, { _id: true });

const settingsSchema = new mongoose.Schema({
    defaultHome: { type: String, default: "quran" },
    // The displayed place name. Prayer times are computed from the coordinates
    // below, so this is a label, not a lookup key. No default: a new account
    // has not chosen a place yet, and the timings page asks for one.
    location: String,
    // Deliberately no defaults: a schema default here would hydrate Coimbatore's
    // coordinates onto a record whose saved city is "Salem", and the coordinate
    // branch in prayerTimes.resolveLocation would then win over the legacy name
    // map. Absent means "resolve the label", which is what old accounts need.
    locationLat: Number,
    locationLng: Number,
    // IANA zone of the chosen place; keeps "today" correct for readers far from
    // the server's clock.
    locationTimezone: String,
    // Aladhan calculation method id (see api/services/prayerTimes.js) and Asr
    // shadow school: 0 standard, 1 Hanafi.
    calculationMethod: { type: Number, default: 3 },
    asrSchool: { type: Number, default: 0 },
    // "12h" or "24h"; changes presentation only, never the stored times.
    timeFormat: { type: String, default: "12h" },
    favoriteReciter: { type: Number, default: 1 },
    favoriteFont: String,
    favoriteEdition: [String],
    primaryTranslation: String,
    theme: { type: String, default: "light" },
    // Accent palette id (green/blue/violet/gold/rose/ocean). Stored as an id,
    // never as a colour, so the palette lives in the stylesheet and a future
    // tweak reaches every account that picked it.
    accent: { type: String, default: "green" },
    // Interface typography (App Font / App Text Size / Quran Text Size).
    // Explicit so Mongoose strict mode does not silently discard the fields
    // on user.settings writes the way it does unknown keys.
    appFont: { type: String, default: "default" },
    appFontSize: { type: Number, default: 100 },
    quranFontSize: { type: Number, default: 100 },
    audioProgress: {
        surahNo: Number,
        surahName: String,
        time: Number
    }
}, { _id: false });

const userSchema = new mongoose.Schema({
    // Friendly display name, chosen on the Account page. Optional: reads fall
    // back to `username` through api/utils/displayName.js. This is presentation
    // only - the public handle and the login email are separate fields.
    name: { type: String, trim: true, maxlength: 50 },
    // When the account was created. Legacy accounts have no value here; the
    // admin report falls back to the ObjectId timestamp rather than backfilling.
    createdAt: { type: Date, default: Date.now },
    // Last time the shell booted for this account. Written at most once every
    // few minutes by /api/app/meta, which is what the admin "active users"
    // figures are based on.
    lastSeenAt: { type: Date, default: null, index: true },
    // Public handle, derived from the email local-part at signup and used in
    // /u/<username>. Unique because two people may share a local-part across
    // different providers (irfan@gmail.com vs irfan@yahoo.com) - the collision
    // is resolved with a numeric suffix by api/utils/username.js.
    // sparse so an account that predates this field does not collide with
    // every other account at the single null value.
    username: { type: String, unique: true, sparse: true },
    // Portal administrator. ADMIN_EMAILS addresses are always admins; this
    // column is how an existing admin hands the same access to another account
    // without a redeploy. Revoking it takes effect on the target's next request
    // because deserializeUser reloads the document from Mongo every time.
    isAdmin: { type: Boolean, default: false, index: true },
    // Profile photo. avatarUrl is what every view renders; avatarPath is the
    // blob pathname in Vercel Blob, kept only so the file can be deleted when
    // it is replaced or the account goes away. Both are absent on an account
    // that never uploaded one, which is what the letter fallback keys off.
    avatarUrl: String,
    avatarPath: String,
    // Set once the emailed OTP is confirmed. Signup does not create a User at
    // all until then, so this is a backstop rather than the primary gate.
    emailVerifiedAt: Date,
    // When this person agreed to the Terms of Use and the Privacy Policy on
    // the sign-up form. Accounts created before the form asked have no value.
    termsAcceptedAt: Date,
    phone: String,
    // The five most recent surahs, newest first. Each entry is one string:
    // "2:255" when the reader left an exact verse, or "2" when they only
    // opened the surah in the list view. One array is enough for both the
    // history order and each surah's position, so no parallel position list
    // or global "last ayah" field is stored.
    lastReadSurahs: [String],
    // Ayahs the user has starred. Stored as { surahNo, ayahNo } rather than the
    // text itself: the text is served from the same cached upstream the reader
    // uses, so copying it would freeze one translation per favourite and make
    // changing edition pointless.
    favoriteAyahs: [{
        surahNo: { type: Number, required: true },
        ayahNo: { type: Number, required: true },
        addedAt: { type: Date, default: Date.now }
    }],
    bookmarkHadiths: [{
        collection: { type: String, required: true },
        number: { type: Number, required: true },
        addedAt: { type: Date, default: Date.now }
    }],
    challenges: [challengeSchema],
    charities: [charitySchema],
    salahLog: [salahEntrySchema],
    settings: { type: settingsSchema, default: () => ({}) },
    // Accounts this person has blocked. Blocking is one-directional and local:
    // it hides their posts from this viewer's feed and profile, and prevents
    // liking those posts. The other account is untouched and is not told.
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Set by an admin (Admin > Users). A suspended account cannot sign in, is
    // signed out everywhere, and its posts are hidden until it is restored.
    // Nothing is deleted, so a suspension can be undone.
    suspended: { type: Boolean, default: false },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: "", trim: true, maxlength: 300 },
    // Chat the app-level Hasanath bot should notify. Never a bot token:
    // one shared bot, many subscribers.
    telegramChatId: String,
    // Notification preferences. Time-based ones are evaluated in the user's own
    // timezone because Vercel cron is always UTC.
    telegram: {
        enabled: { type: Boolean, default: false },
        timezone: { type: String, default: "UTC" },
        events: {
            challenges: { type: Boolean, default: true },
            salahTracker: { type: Boolean, default: false },
            newPost: { type: Boolean, default: false },
            salahTimings: { type: Boolean, default: false },
            ayahOfTheDay: { type: Boolean, default: true }
        },
        times: {
            // HH:MM in the user's timezone. Only the two daily, time-based
            // modules take a time; challenges / salah log / new post are
            // event-driven and fire the moment the action happens.
            ayahOfTheDay: { type: String, default: "05:30" },
            salahTimings: { type: String, default: "05:00" }
        },
        // Date keys ("YYYY-MM-DD") of the last time each scheduled event fired,
        // so a due-check never sends the same day's message twice.
        lastSent: {
            ayahOfTheDay: String,
            salahTimings: String
        }
    },
    claimsMigratedAt: Date
});

// Field names are configured on the PLUGIN, not on createStrategy() - in v9
// createStrategy() takes no arguments and reads these closure options. The
// plugin adds `email` (unique), `hash` and `salt`; hash/salt are select:false.
userSchema.plugin(passportLocalMongoose, {
    usernameField: "email",
    passwordField: "password",
    usernameLowerCase: true
});

userSchema.pre("save", function (next) {
    if (this.isModified("email") && this.email) this.email = this.email.trim().toLowerCase();
    // Usernames are compared case-insensitively everywhere, so normalise on the
    // way in rather than relying on every reader to remember to lower-case.
    if (this.isModified("username") && this.username) {
        this.username = this.username.trim().toLowerCase();
    }
    if (!this.settings) this.settings = {};
    next();
});

// Favourites are capped for the same reason as last-read: unbounded growth on a
// single user document eventually hits the 16MB document limit.
const MAX_FAVORITE_AYAHS = 300;

// Star or unstar an ayah. Returns true when it ended up favourited, so the
// caller can answer the click without re-reading the array.
userSchema.methods.toggleFavoriteAyah = function (surahNo, ayahNo) {
    const s = Number(surahNo);
    const a = Number(ayahNo);
    const list = Array.from(this.favoriteAyahs || []);
    const index = list.findIndex((f) => Number(f.surahNo) === s && Number(f.ayahNo) === a);

    if (index !== -1) {
        list.splice(index, 1);
        this.favoriteAyahs = list;
        return false;
    }

    // Newest first, so the favourites list reads in the order things were added.
    this.favoriteAyahs = [{ surahNo: s, ayahNo: a, addedAt: new Date() }, ...list].slice(0, MAX_FAVORITE_AYAHS);
    return true;
};

userSchema.methods.isFavoriteAyah = function (surahNo, ayahNo) {
    const s = Number(surahNo);
    const a = Number(ayahNo);
    return Array.from(this.favoriteAyahs || []).some((f) => Number(f.surahNo) === s && Number(f.ayahNo) === a);
};

// Hadith bookmarks follow the same pattern: coordinates only ({ collection,
// number }), capped, newest first.
const MAX_BOOKMARK_HADITHS = 300;

userSchema.methods.toggleHadithBookmark = function (collection, number) {
    const c = String(collection);
    const n = Number(number);
    const list = Array.from(this.bookmarkHadiths || []);
    const index = list.findIndex((f) => f.collection === c && Number(f.number) === n);

    if (index !== -1) {
        list.splice(index, 1);
        this.bookmarkHadiths = list;
        return false;
    }

    this.bookmarkHadiths = [{ collection: c, number: n, addedAt: new Date() }, ...list].slice(0, MAX_BOOKMARK_HADITHS);
    return true;
};

userSchema.methods.isHadithBookmarked = function (collection, number) {
    const c = String(collection);
    const n = Number(number);
    return Array.from(this.bookmarkHadiths || []).some((f) => f.collection === c && Number(f.number) === n);
};

module.exports = mongoose.model("User", userSchema);
module.exports.MAX_FAVORITE_AYAHS = MAX_FAVORITE_AYAHS;
module.exports.challengeSchema = challengeSchema;
module.exports.charitySchema = charitySchema;
module.exports.donationSchema = donationSchema;
module.exports.salahEntrySchema = salahEntrySchema;
module.exports.settingsSchema = settingsSchema;
