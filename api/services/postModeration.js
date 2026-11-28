// Post visibility, who may post, and the tiny admin check.
//
// The feed, the permalink, a profile and the admin queue all have to agree about
// what a visitor may see. Keeping that rule in one place is what stops a pending
// post from leaking through a route that forgot to add `status: "published"`.

const Posts = require("../models/Post.js");

// A brand-new account cannot post for its first day. This replaces the old
// "hold the first posts for review" scheme: nothing is saved that cannot be
// shown, there is no review timer to release, and no count of earlier posts to
// run on every new one. Most spam accounts post within minutes of signing up
// and never come back, so a plain waiting period stops them at the door.
const POSTING_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

// A new post is announced to every Telegram subscriber. That reach is earned
// more slowly than the right to post: an account must be a week old before its
// posts are broadcast. Younger accounts' posts still appear in the feed.
const BROADCAST_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Distinct reporters needed before a post is pulled from the feed pending
// review. Counting distinct accounts (the model has a unique index on
// post+reporter) keeps one person from hiding a post alone.
const REPORT_HIDE_THRESHOLD = 3;

const REPORT_REASONS = ["spam", "harassment", "misinformation", "other"];

// Comma-separated addresses in ADMIN_EMAILS. Reading it per call (rather than
// caching at boot) means a Vercel environment change takes effect without a code
// change, and an unset value simply means "no admins" rather than an error.
//
// These addresses are the root administrators: they are always admins, and the
// portal cannot take that away. An account can also be granted admin access
// from the portal (User.isAdmin), which is what makes the feature usable
// without editing the deployment environment for every new moderator.
function adminEmails() {
    return String(process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function isEnvAdmin(user) {
    const email = user && user.email ? String(user.email).toLowerCase() : "";
    return Boolean(email) && adminEmails().includes(email);
}

function isAdmin(user) {
    if (!user) return false;
    return Boolean(user.isAdmin) || isEnvAdmin(user);
}

function idOf(value) {
    return value && value._id ? String(value._id) : String(value || "");
}

function blockedIds(viewer) {
    if (!viewer || !Array.isArray(viewer.blockedUsers)) return [];
    return viewer.blockedUsers.map(idOf).filter(Boolean);
}

function isBlocked(viewer, authorId) {
    if (!viewer || !authorId) return false;
    const target = idOf(authorId);
    return blockedIds(viewer).includes(target);
}

// Filter for the public feed: published posts, plus the viewer's own posts that
// reports have hidden (so the author can see why one is missing), never a
// blocked author's posts.
// A missing status is an old post and counts as published.
function visibleFilter(viewer) {
    const or = [{ status: { $nin: ["pending", "rejected"] } }];
    if (viewer && viewer._id) or.push({ status: "pending", author: viewer._id });

    const filter = { $or: or };
    const blocked = blockedIds(viewer);
    if (blocked.length) filter.author = { $nin: blocked };
    // Posts by a suspended account are hidden from everyone but admins.
    if (!isAdmin(viewer)) filter.authorSuspended = { $ne: true };
    return filter;
}

// One-post check used by the permalink and the like route. Admins may open a
// pending post from the queue; nobody may open a rejected one.
function canView(post, viewer) {
    if (!post) return false;
    const authorId = idOf(post.author);

    if (isAdmin(viewer)) return true;
    if (isBlocked(viewer, authorId)) return false;
    if (post.authorSuspended) return false;
    if (post.status === "rejected") return false;
    if (post.status === "pending") {
        return Boolean(viewer && viewer._id && authorId && String(viewer._id) === authorId);
    }
    return true;
}

// When the account was created, read from its id. Every MongoDB id carries
// its creation time, so this works for every account, including old ones that
// were saved before the createdAt field existed (for which Mongoose would
// otherwise fill in "now" and make a years-old account look new).
function accountCreatedAt(user) {
    try {
        const id = user && user._id;
        if (id && typeof id.getTimestamp === "function") return id.getTimestamp();
    } catch (err) { /* not an ObjectId */ }
    return null;
}

// null when the account may post right now; otherwise the moment it will be
// allowed to. Admins are never made to wait: they post the announcements.
// `minAgeMs` comes from the Limits page (services/limits.js); 0 means the wait
// is switched off. The constant is only the fallback for a caller without it.
function canPostAt(user, minAgeMs = POSTING_MIN_ACCOUNT_AGE_MS) {
    if (!user || isAdmin(user) || !minAgeMs) return null;
    const created = accountCreatedAt(user);
    if (!created) return null;
    const allowedAt = new Date(created.getTime() + minAgeMs);
    return allowedAt.getTime() > Date.now() ? allowedAt : null;
}

function mayBroadcast(user, minAgeMs = BROADCAST_MIN_ACCOUNT_AGE_MS) {
    if (!user) return false;
    if (isAdmin(user) || !minAgeMs) return true;
    const created = accountCreatedAt(user);
    if (!created) return true;
    return Date.now() - created.getTime() >= minAgeMs;
}

// One-off tidy-up for the change away from review holds: any post still
// waiting under the old scheme is published, so nothing is left stuck with no
// timer to release it. Runs once per server instance, on the first feed read,
// and is a no-op once there are none left. Safe to delete after a few weeks.
let legacyHoldsReleased = null;
function releaseLegacyHolds() {
    if (!legacyHoldsReleased) {
        legacyHoldsReleased = Posts.updateMany(
            { status: "pending", statusReason: "review" },
            { $set: { status: "published", statusReason: "" } }
        ).then(function(result){ return result.modifiedCount || 0; })
         .catch(function(err){
             console.error("releaseLegacyHolds:", err.message);
             legacyHoldsReleased = null;   // try again on a later request
             return 0;
         });
    }
    return legacyHoldsReleased;
}

module.exports = {
    POSTING_MIN_ACCOUNT_AGE_MS,
    BROADCAST_MIN_ACCOUNT_AGE_MS,
    REPORT_HIDE_THRESHOLD,
    REPORT_REASONS,
    adminEmails,
    isEnvAdmin,
    isAdmin,
    isBlocked,
    visibleFilter,
    canView,
    accountCreatedAt,
    canPostAt,
    mayBroadcast,
    releaseLegacyHolds
};
