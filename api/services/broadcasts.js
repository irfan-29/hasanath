// Fan a single admin announcement out to every account's notification centre.
//
// The in-app notification list is per-user, so a broadcast is written as one
// AppNotification row per recipient. Rows are inserted in batches with a cursor
// so a large user collection does not have to fit in memory. The Broadcast
// document remains afterwards as the admin-facing history record, even after
// the notification TTL has cleared the inbox rows.

const User = require("../models/User.js");
const AppNotification = require("../models/AppNotification.js");
const Broadcast = require("../models/Broadcast.js");

const BATCH_SIZE = 500;

async function send({ title, body = "", link = "", admin }) {
    const broadcast = await Broadcast.create({
        title,
        body,
        link,
        sentBy: admin ? admin._id : null,
        recipients: 0
    });

    let recipients = 0;
    let batch = [];

    const flush = async () => {
        if (batch.length === 0) return;
        await AppNotification.insertMany(batch, { ordered: false });
        recipients += batch.length;
        batch = [];
    };

    // Project only the id: a broadcast needs no profile data, and an unbounded
    // .find() would hydrate every user document for nothing.
    const cursor = User.find({}, "_id").lean().cursor();
    for await (const user of cursor) {
        batch.push({
            user: user._id,
            type: "admin_announcement",
            title,
            body,
            link,
            data: { broadcastId: String(broadcast._id) }
        });
        if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    broadcast.recipients = recipients;
    await broadcast.save();

    return { broadcast, recipients };
}

function present(doc) {
    const raw = typeof doc.toObject === "function" ? doc.toObject() : doc;
    return {
        id: String(raw._id || ""),
        title: raw.title || "",
        body: raw.body || "",
        link: raw.link || "",
        recipients: Number(raw.recipients) || 0,
        createdAt: raw.createdAt || null
    };
}

module.exports = { send, present };
