// Adjustable limits: signups and posting.
//
// One list (LIMITS) describes every limit: its key, what it counts, the range
// it accepts and its default. The admin page is drawn from this list and the
// server validates against it, so adding a limit is one entry here plus the
// place that enforces it.
//
// A limit's value is null (off) or a number (on). 0 means zero: a cap of 0
// lets nothing through. "No limit" is never written as a number.

const mongoose = require("mongoose");
const AppLimit = require("../models/AppLimit.js");
const User = require("../models/User.js");
const Posts = require("../models/Post.js");
const AppNotification = require("../models/AppNotification.js");

// kind "cap":  a count that may not be exceeded. 0 is allowed and closes the
//              thing being counted.
// kind "wait": a duration. Off means no wait, so the smallest "on" value is 1.
const LIMITS = [
    {
        key: "signupsPerDay", group: "signups", kind: "cap",
        label: "New accounts per day", unit: "accounts", per: "day",
        min: 0, max: 100000, default: null,
        offText: "No daily limit", zeroText: "Signups are closed"
    },
    {
        key: "signupsPerWeek", group: "signups", kind: "cap",
        label: "New accounts per week", unit: "accounts", per: "week",
        min: 0, max: 1000000, default: null,
        offText: "No weekly limit", zeroText: "Signups are closed"
    },
    {
        key: "postsPerUserPerHour", group: "posts", kind: "cap",
        label: "Posts per person per hour", unit: "posts", per: "hour",
        min: 0, max: 1000, default: 5,
        offText: "No hourly limit", zeroText: "Nobody can post"
    },
    {
        key: "postGapSeconds", group: "posts", kind: "wait",
        label: "Gap between one person's posts", unit: "seconds",
        min: 1, max: 86400, default: 60,
        offText: "No gap"
    },
    {
        key: "postsPerDayApp", group: "posts", kind: "cap",
        label: "Posts per day, whole app", unit: "posts", per: "day",
        min: 0, max: 1000000, default: null,
        offText: "No daily limit", zeroText: "Posting is closed"
    },
    {
        key: "newAccountWaitHours", group: "posts", kind: "wait",
        label: "New account waits before posting", unit: "hours",
        min: 1, max: 720, default: 24,
        offText: "New accounts can post straight away"
    },
    {
        key: "broadcastAccountAgeDays", group: "posts", kind: "wait",
        label: "Account age before posts go to Telegram", unit: "days",
        min: 1, max: 365, default: 7,
        offText: "Every account's posts are broadcast"
    }
];

const BY_KEY = new Map(LIMITS.map((limit) => [limit.key, limit]));

// ---- Time: days and weeks are counted in India time ------------------------
//
// The server runs in UTC. Counting "today" there would reset the daily limits
// at 5:30 in the morning for the people the app is built for. India has no
// daylight saving, so a fixed offset is exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(now = new Date()) {
    const shifted = now.getTime() + IST_OFFSET_MS;
    return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

// Weeks start on Monday.
function startOfWeek(now = new Date()) {
    const day = startOfDay(now);
    const weekday = new Date(day.getTime() + IST_OFFSET_MS).getUTCDay();   // 0 = Sunday
    return new Date(day.getTime() - ((weekday + 6) % 7) * DAY_MS);
}

// ---- Counting ---------------------------------------------------------------
//
// Every MongoDB id carries its creation time, so "created since X" is a range
// on _id. That is exact for every account and post, uses the index every
// collection already has, and does not depend on a createdAt field being set.
function idAt(date) {
    return mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

function countSince(Model, since) {
    return Model.countDocuments({ _id: { $gte: idAt(since) } });
}

async function usage() {
    const day = startOfDay();
    const week = startOfWeek();
    const [signupsToday, signupsThisWeek, postsToday] = await Promise.all([
        countSince(User, day), countSince(User, week), countSince(Posts, day)
    ]);
    return {
        signupsToday, signupsThisWeek, postsToday,
        dayResetsAt: new Date(day.getTime() + DAY_MS).toISOString(),
        weekResetsAt: new Date(week.getTime() + 7 * DAY_MS).toISOString()
    };
}

// ---- Reading and writing ----------------------------------------------------

function withDefaults(stored) {
    const values = {};
    for (const limit of LIMITS) {
        const has = stored && Object.prototype.hasOwnProperty.call(stored, limit.key);
        values[limit.key] = has ? normalise(limit, stored[limit.key]) : limit.default;
    }
    return values;
}

// A stored value that is no longer valid (the range changed, or it was edited
// by hand) falls back to the default instead of being enforced as written.
function normalise(limit, value) {
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < limit.min || number > limit.max) return limit.default;
    return number;
}

// The limits before this page existed: a daily and a weekly signup cap where
// 0 meant "no limit" and one switch turned both off. Read once, the first time
// the new document is created, so the caps already chosen carry over.
async function legacySignupValues() {
    try {
        const old = await mongoose.connection.collection("signuplimits").findOne({});
        if (!old) return null;
        const on = old.enabled !== false;
        const cap = (value) => (on && Number(value) > 0 ? Math.floor(Number(value)) : null);
        return {
            values: { signupsPerDay: cap(old.dailyLimit), signupsPerWeek: cap(old.weeklyLimit) },
            thresholdPercent: Number.isFinite(Number(old.thresholdPercent)) ? Number(old.thresholdPercent) : 80
        };
    } catch (err) {
        return null;
    }
}

async function loadDocument() {
    let doc = await AppLimit.findById("limits").lean();
    if (!doc) {
        const legacy = await legacySignupValues();
        const fresh = { values: legacy ? legacy.values : {}, thresholdPercent: legacy ? legacy.thresholdPercent : 80 };
        doc = await AppLimit.findOneAndUpdate(
            { _id: "limits" }, { $setOnInsert: fresh }, { upsert: true, new: true, lean: true }
        );
    }
    return doc;
}

// The settings are read on every signup and every post. They change rarely,
// so they are kept in memory for a short while: a change made on the admin
// page is live on this server at once and on the others within CACHE_MS.
const CACHE_MS = 30 * 1000;
let cache = null;

async function settings() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    const doc = await loadDocument();
    const data = {
        values: withDefaults(doc.values),
        thresholdPercent: Number.isFinite(Number(doc.thresholdPercent)) ? Number(doc.thresholdPercent) : 80,
        updatedAt: doc.updatedAt || null,
        updatedBy: doc.updatedBy || ""
    };
    cache = { at: Date.now(), data };
    return data;
}

// One limit's value: null when off, otherwise the number.
async function get(key) {
    return (await settings()).values[key];
}

class LimitError extends Error {
    constructor(key, message) {
        super(message);
        this.key = key;
    }
}

// Save a partial set of values. Anything out of range is refused outright
// rather than quietly corrected, so the page can say which field is wrong.
async function update(input, updatedBy) {
    const incoming = input && typeof input.values === "object" && input.values ? input.values : {};
    const set = { updatedAt: new Date(), updatedBy: String(updatedBy || "") };

    for (const key of Object.keys(incoming)) {
        const limit = BY_KEY.get(key);
        if (!limit) throw new LimitError(key, "unknown limit");
        const value = incoming[key];
        if (value === null) { set["values." + key] = null; continue; }
        if (typeof value !== "number" || !Number.isInteger(value) || value < limit.min || value > limit.max) {
            throw new LimitError(key, "out of range");
        }
        set["values." + key] = value;
    }

    if (input && input.thresholdPercent !== undefined) {
        const pct = Number(input.thresholdPercent);
        if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new LimitError("thresholdPercent", "out of range");
        set.thresholdPercent = pct;
    }

    await loadDocument();   // make sure the document (and any carried-over caps) exists first
    await AppLimit.updateOne({ _id: "limits" }, { $set: set });
    cache = null;
    return settings();
}

// Everything the admin page needs in one answer.
async function describe() {
    const [current, used] = await Promise.all([settings(), usage()]);
    return {
        definitions: LIMITS.map((limit) => ({ ...limit })),
        values: current.values,
        thresholdPercent: current.thresholdPercent,
        updatedAt: current.updatedAt,
        updatedBy: current.updatedBy,
        usage: used,
        timezone: "India time (IST)"
    };
}

// ---- Signups ----------------------------------------------------------------

// { allowed: true } or { allowed: false, error } where error is one of
// "signups-closed", "signup-daily-limit", "signup-weekly-limit".
async function checkSignupAllowed() {
    const { values, thresholdPercent } = await settings();
    const daily = values.signupsPerDay;
    const weekly = values.signupsPerWeek;
    if (daily === null && weekly === null) return { allowed: true };
    if (daily === 0 || weekly === 0) return { allowed: false, error: "signups-closed" };

    const [today, thisWeek] = await Promise.all([
        daily === null ? 0 : countSince(User, startOfDay()),
        weekly === null ? 0 : countSince(User, startOfWeek())
    ]);
    if (daily !== null && today >= daily) return { allowed: false, error: "signup-daily-limit" };
    if (weekly !== null && thisWeek >= weekly) return { allowed: false, error: "signup-weekly-limit" };

    // Never let a failed warning stop a signup that is allowed.
    warnAdmins(thresholdPercent, [
        { kind: "daily", count: today, limit: daily },
        { kind: "weekly", count: thisWeek, limit: weekly }
    ]).catch((err) => console.error("signup limit warning:", err.message));

    return { allowed: true };
}

// Tell the admins once a day when signups pass the warning share of a cap.
async function warnAdmins(thresholdPercent, checks) {
    if (!thresholdPercent) return;
    const due = checks
        .filter((check) => check.limit !== null && check.limit > 0)
        .map((check) => ({ ...check, pct: (check.count / check.limit) * 100 }))
        .filter((check) => check.pct >= thresholdPercent && check.pct < 100);
    if (!due.length) return;

    const admins = await User.find({ isAdmin: true }).select("_id email telegram telegramChatId").lean();
    if (!admins.length) return;
    const notify = require("./notifications.js");
    const emailService = require("./email.js");
    const today = startOfDay();

    for (const check of due) {
        const key = "signup-limit-" + check.kind + "-" + today.toISOString().slice(0, 10);
        const already = await AppNotification.findOne({ type: "admin_announcement", "data.key": key }).lean();
        if (already) continue;

        const title = "Signup " + check.kind + " limit nearing";
        const body = check.count + " of " + check.limit + " " + check.kind + " signups used (" + Math.round(check.pct) + "%).";
        for (const admin of admins) {
            await AppNotification.create({
                user: admin._id, type: "admin_announcement", title, body,
                link: "/admin?tab=limits", data: { key }
            });
            notify.safeDeliver(admin, "<b>Hasanath</b> — " + title + "\n\n" + body + "\n\nOpen: /admin?tab=limits").catch(() => {});
            if (admin.email) {
                emailService.sendEmail({
                    to: admin.email, subject: title,
                    text: body + "\n\nOpen the admin portal: /admin?tab=limits",
                    html: "<p>" + body + "</p><p><a href=\"/admin?tab=limits\">Open the admin portal</a></p>"
                }).catch(() => {});
            }
        }
    }
}

// ---- Posting ----------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

// The waits, in milliseconds; 0 when the wait is off.
async function postingWaits() {
    const { values } = await settings();
    return {
        newAccountMs: values.newAccountWaitHours === null ? 0 : values.newAccountWaitHours * HOUR_MS,
        broadcastMs: values.broadcastAccountAgeDays === null ? 0 : values.broadcastAccountAgeDays * DAY_MS
    };
}

// Checks that apply to someone about to post, beyond their account's age and
// their hourly allowance (which the rate limiter keeps). Returns null when the
// post may go ahead, or { status, body } to send back.
async function checkPostAllowed(userId) {
    const { values } = await settings();

    if (values.postsPerUserPerHour === 0 || values.postsPerDayApp === 0) {
        return { status: 403, body: { error: "posting-closed" } };
    }

    if (values.postsPerDayApp !== null) {
        const today = await countSince(Posts, startOfDay());
        if (today >= values.postsPerDayApp) {
            return { status: 429, body: { error: "posts-daily-limit" } };
        }
    }

    if (values.postGapSeconds !== null) {
        const last = await Posts.findOne({ author: userId }).sort({ _id: -1 }).select("_id").lean();
        if (last) {
            const waited = Date.now() - last._id.getTimestamp().getTime();
            const gap = values.postGapSeconds * 1000;
            if (waited < gap) {
                return { status: 429, body: { error: "rate-limited", scope: "post-gap", retryAfter: Math.ceil((gap - waited) / 1000) } };
            }
        }
    }
    return null;
}

module.exports = {
    LIMITS,
    LimitError,
    startOfDay,
    startOfWeek,
    usage,
    settings,
    get,
    update,
    describe,
    checkSignupAllowed,
    postingWaits,
    checkPostAllowed,
    // Exposed for tests.
    _reset() { cache = null; }
};
