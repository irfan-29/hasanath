// Post visibility, review holds and the tiny admin check.
//
// The feed, the permalink, a profile and the admin queue all have to agree about
// what a visitor may see. Keeping that rule in one place is what stops a pending
// post from leaking through a route that forgot to add `status: "published"`.

const Posts = require("../models/Post.js");

// A post is held until its author has this many published posts behind them.
// Counting *published* posts, not attempts, is deliberate: otherwise a spammer
// could write four posts quickly, have the first three held, and watch the
// fourth publish with a broadcast.
const TRUSTED_POST_COUNT = 3;

// A held post becomes public by itself after a day. This is the fallback for a
// deployment with no admin configured: a legitimate new account is delayed, not
// silenced forever, and the hold still prevents an immediate blast to every
// subscriber.
const REVIEW_HOLD_MS = 24 * 60 * 60 * 1000;

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

// Filter for the public feed: published posts, plus the viewer's own pending
// posts (so the author can see what is waiting), never a blocked author's posts.
// A missing status is an old post and counts as published.
function visibleFilter(viewer) {
    const or = [{ status: { $nin: ["pending", "rejected"] } }];
    if (viewer && viewer._id) or.push({ status: "pending", author: viewer._id });

    const filter = { $or: or };
    const blocked = blockedIds(viewer);
    if (blocked.length) filter.author = { $nin: blocked };
    return filter;
}

// One-post check used by the permalink and the like route. Admins may open a
// pending post from the queue; nobody may open a rejected one.
function canView(post, viewer) {
    if (!post) return false;
    const authorId = idOf(post.author);

    if (isAdmin(viewer)) return true;
    if (isBlocked(viewer, authorId)) return false;
    if (post.status === "rejected") return false;
    if (post.status === "pending") {
        return Boolean(viewer && viewer._id && authorId && String(viewer._id) === authorId);
    }
    return true;
}

async function needsReview(authorId) {
    if (!authorId) return true;
    // Count everything that is or was publicly visible, including posts that
    // predate the status field (a missing status is an old, published post).
    // Counting only an exact `status: "published"` would treat every existing
    // account as brand new and hold its next post, even though it has years of
    // history behind it. Pending and rejected posts do not count, so a spammer
    // cannot earn trust with posts that were never shown.
    const published = await Posts.countDocuments({
        author: authorId,
        status: { $nin: ["pending", "rejected"] }
    });
    return published < TRUSTED_POST_COUNT;
}

// Release review holds whose day is up. Runs lazily on feed/profile/permalink
// reads, so it needs no scheduler and costs one indexed update. Deliberately
// does not broadcast: these posts were never announced, and a batched release
// should not become a second blast.
async function publishDue() {
    const now = new Date();
    const result = await Posts.updateMany(
        { status: "pending", statusReason: "review", autoPublishAt: { $lte: now } },
        { $set: { status: "published", autoPublishAt: null } }
    );
    return result.modifiedCount || 0;
}

module.exports = {
    TRUSTED_POST_COUNT,
    REVIEW_HOLD_MS,
    REPORT_HIDE_THRESHOLD,
    REPORT_REASONS,
    adminEmails,
    isEnvAdmin,
    isAdmin,
    isBlocked,
    visibleFilter,
    canView,
    needsReview,
    publishDue
};
