const mongoose = require("mongoose");

// An admin announcement sent to every account.
//
// The notification centre is per-user, so a broadcast fans out into
// AppNotification rows. This document is the sent record: what was said, who
// sent it and how many inboxes received it, kept after the notification TTL has
// expired so the admin page can show history.
const broadcastSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", trim: true, maxlength: 1200 },
    // Optional app route or absolute URL the notification row opens.
    link: { type: String, default: "", trim: true, maxlength: 500 },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recipients: { type: Number, default: 0 }
}, { timestamps: true });

broadcastSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Broadcast", broadcastSchema);
