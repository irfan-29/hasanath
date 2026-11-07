const mongoose = require("mongoose");

// In-app notifications: the durable list behind the Notifications tab.
//
// This is deliberately separate from `user.telegram`, which is a delivery
// channel. A notification exists whether or not Telegram is connected, and its
// unread state is what drives the badge in the phone header and the sidebar.
const appNotificationSchema = new mongoose.Schema({
    // Recipient. Every query is scoped to this id - never to an id sent by the
    // browser.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
        type: String,
        required: true,
        enum: [
            "friend_request",
            "friend_accepted",
            "challenge_invite",
            "challenge_accepted",
            "challenge_declined"
        ]
    },
    // Who caused it. Copied rather than referenced so the row still reads
    // correctly if the account is renamed or removed.
    actor: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        username: String
    },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    // App route the row should open, e.g. /u/irfan or /challenges.
    link: { type: String, default: "" },
    // Ids the client needs to act on the row (friendshipId, challengeId).
    // Stored as strings so the same values round-trip without casting.
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

// The feed query and the unread badge query.
appNotificationSchema.index({ user: 1, createdAt: -1 });
appNotificationSchema.index({ user: 1, readAt: 1 });

// Notifications are a recent-activity list, not an archive. A TTL keeps one
// user's collection bounded without a cleanup job.
appNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

module.exports = mongoose.model("AppNotification", appNotificationSchema);
