// Reading, writing and resolving in-app notifications.
//
// The service owns the shape the client sees, so the feed and the badge can
// never disagree about what "unread" means or which rows are actionable.

const AppNotification = require("../models/AppNotification.js");

const MAX_ITEMS = 50;
const OBJECT_ID = /^[a-f\d]{24}$/i;

function present(doc) {
    const raw = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
    const data = raw.data && typeof raw.data === "object" ? raw.data : {};

    // Which inline actions the row offers. Kept here rather than in the client
    // so a new actionable type only has to be taught once.
    let actions = [];
    if (raw.type === "friend_request" && data.friendshipId) actions = ["accept", "decline"];
    if (raw.type === "challenge_invite" && data.challengeId) actions = ["accept", "decline"];

    return {
        id: String(raw._id || ""),
        type: raw.type,
        title: raw.title || "",
        body: raw.body || "",
        link: raw.link || "",
        actor: raw.actor && raw.actor.username
            ? { id: raw.actor.id ? String(raw.actor.id) : "", username: raw.actor.username }
            : null,
        data,
        read: Boolean(raw.readAt),
        createdAt: raw.createdAt,
        actions
    };
}

async function push({ userId, type, actor, title, body = "", link = "", data = {} }) {
    if (!userId || !type || !title) return null;
    return AppNotification.create({
        user: userId,
        type,
        actor: actor
            ? { id: actor._id || actor.id, username: actor.username || "" }
            : undefined,
        title,
        body,
        link,
        data
    });
}

async function listFor(userId, { limit = MAX_ITEMS } = {}) {
    const items = await AppNotification.find({ user: userId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean();
    return items.map(present);
}

async function unreadCount(userId) {
    if (!userId) return 0;
    return AppNotification.countDocuments({ user: userId, readAt: null });
}

async function markRead(userId, id) {
    if (!userId || !id || !OBJECT_ID.test(String(id))) return false;
    const result = await AppNotification.updateOne(
        { _id: id, user: userId, readAt: null },
        { $set: { readAt: new Date() } }
    );
    return result.modifiedCount > 0;
}

async function markAllRead(userId) {
    if (!userId) return 0;
    const result = await AppNotification.updateMany(
        { user: userId, readAt: null },
        { $set: { readAt: new Date() } }
    );
    return result.modifiedCount || 0;
}

// Delete rows a completed action has made pointless. Without this, accepting a
// request left the original invite sitting in the centre with dead buttons.
async function removeRelated(userId, filter) {
    if (!userId) return;
    await AppNotification.deleteMany({ user: userId, ...filter });
}

async function removeForUser(userId) {
    if (!userId) return;
    await AppNotification.deleteMany({ user: userId });
}

module.exports = {
    present,
    push,
    listFor,
    unreadCount,
    markRead,
    markAllRead,
    removeRelated,
    removeForUser
};
