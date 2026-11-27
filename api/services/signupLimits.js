const SignupLimit = require("../models/SignupLimit.js");
const User = require("../models/User.js");
const AppNotification = require("../models/AppNotification.js");

function startOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function startOfWeek(date = new Date()) {
    const d = startOfDay(date);
    // Monday as the first day of the week.
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d;
}

async function countSignupsSince(since) {
    return User.countDocuments({ createdAt: { $gte: since } });
}

async function getLimits() {
    const doc = await SignupLimit.getSingleton();
    return {
        dailyLimit: Number(doc.dailyLimit) || 0,
        weeklyLimit: Number(doc.weeklyLimit) || 0,
        thresholdPercent: Number(doc.thresholdPercent) || 0,
        enabled: Boolean(doc.enabled),
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy || ""
    };
}

// Returns { allowed: boolean, reason: string|null, counts, limits }.
async function checkSignupAllowed() {
    const limits = await getLimits();
    if (!limits.enabled) {
        return { allowed: true, reason: null, counts: await counts(), limits };
    }

    const dailyCount = await countSignupsSince(startOfDay());
    const weeklyCount = await countSignupsSince(startOfWeek());

    if (limits.dailyLimit > 0 && dailyCount >= limits.dailyLimit) {
        return { allowed: false, reason: "daily-limit", counts: { daily: dailyCount, weekly: weeklyCount }, limits };
    }
    if (limits.weeklyLimit > 0 && weeklyCount >= limits.weeklyLimit) {
        return { allowed: false, reason: "weekly-limit", counts: { daily: dailyCount, weekly: weeklyCount }, limits };
    }

    // Notify admins when a limit is being approached.
    await maybeNotifyAdmins(limits, dailyCount, weeklyCount);

    return { allowed: true, reason: null, counts: { daily: dailyCount, weekly: weeklyCount }, limits };
}

async function counts() {
    return {
        daily: await countSignupsSince(startOfDay()),
        weekly: await countSignupsSince(startOfWeek())
    };
}

async function maybeNotifyAdmins(limits, dailyCount, weeklyCount) {
    if (!limits.thresholdPercent) return;
    const admins = await User.find({ isAdmin: true }).select("_id email telegram").lean();
    if (!admins.length) return;

    const notify = require("./notifications.js");
    const emailService = require("./email.js");

    const checks = [];
    if (limits.dailyLimit > 0) {
        const pct = (dailyCount / limits.dailyLimit) * 100;
        if (pct >= limits.thresholdPercent && pct < 100) {
            checks.push({ kind: "daily", count: dailyCount, limit: limits.dailyLimit, pct });
        }
    }
    if (limits.weeklyLimit > 0) {
        const pct = (weeklyCount / limits.weeklyLimit) * 100;
        if (pct >= limits.thresholdPercent && pct < 100) {
            checks.push({ kind: "weekly", count: weeklyCount, limit: limits.weeklyLimit, pct });
        }
    }
    if (!checks.length) return;

    // Avoid spamming: only notify once per kind per day by checking for an
    // existing unread notification with the same threshold key today.
    const today = startOfDay();
    for (const check of checks) {
        const key = `signup-limit-${check.kind}-${today.toISOString().slice(0, 10)}`;
        const already = await AppNotification.findOne({
            type: "admin_announcement",
            "data.key": key,
            createdAt: { $gte: today }
        }).lean();
        if (already) continue;

        const title = `Signup ${check.kind} limit nearing`;
        const body = `${check.count} of ${check.limit} ${check.kind} signups used (${Math.round(check.pct)}%).`;
        for (const admin of admins) {
            await AppNotification.create({
                user: admin._id,
                type: "admin_announcement",
                title,
                body,
                link: "/admin?tab=limits",
                data: { key }
            });
            // Push channel (Telegram) for admins who connected it. Never let
            // a delivery failure break the signup that triggered it.
            notify.safeDeliver(
                admin,
                `<b>Hasanath</b> — ${title}\n\n${body}\n\nOpen: /admin?tab=limits`
            ).catch(() => {});
            // Email as well, so an admin who is not on Telegram still hears
            // about it. Fire-and-forget: a transport failure must not break
            // the signup that triggered the warning.
            if (admin.email) {
                emailService.sendEmail({
                    to: admin.email,
                    subject: title,
                    text: `${body}\n\nOpen the admin portal: /admin?tab=limits`,
                    html: `<p>${body}</p><p><a href="/admin?tab=limits">Open the admin portal</a></p>`
                }).catch(() => {});
            }
        }
    }
}

async function updateLimits({ dailyLimit, weeklyLimit, thresholdPercent, enabled }, updatedBy) {
    const doc = await SignupLimit.getSingleton();
    if (dailyLimit !== undefined) doc.dailyLimit = Math.max(0, Number(dailyLimit) || 0);
    if (weeklyLimit !== undefined) doc.weeklyLimit = Math.max(0, Number(weeklyLimit) || 0);
    if (thresholdPercent !== undefined) doc.thresholdPercent = Math.min(100, Math.max(0, Number(thresholdPercent) || 0));
    if (enabled !== undefined) doc.enabled = Boolean(enabled);
    doc.updatedAt = new Date();
    doc.updatedBy = updatedBy || "";
    await doc.save();
    return getLimits();
}

module.exports = {
    getLimits,
    checkSignupAllowed,
    counts,
    updateLimits
};
module.exports.startOfDay = startOfDay;
module.exports.startOfWeek = startOfWeek;
module.exports.countSignupsSince = countSignupsSince;