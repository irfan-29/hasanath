const ContactMessage = require("../models/ContactMessage.js");
const User = require("../models/User.js");
const appNotifications = require("./appNotifications.js");
const { displayNameFor } = require("../utils/displayName.js");

const MAX_MESSAGE = 2000;
const MAX_SUBJECT = 120;

function present(doc) {
    const raw = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
    const user = raw.user && raw.user._id ? raw.user : null;
    return {
        id: String(raw._id || ""),
        user: user
            ? {
                id: String(user._id),
                username: user.username || "",
                name: user.name || "",
                displayName: displayNameFor(user),
                email: user.email || "",
                avatarUrl: user.avatarUrl || ""
            }
            : null,
        fromName: raw.fromName || "",
        fromEmail: raw.fromEmail || "",
        subject: raw.subject || "",
        message: raw.message || "",
        status: raw.status || "new",
        adminReply: raw.adminReply || "",
        repliedAt: raw.repliedAt || null,
        createdAt: raw.createdAt || null
    };
}

async function send(user, { subject = "", message = "" } = {}) {
    const text = String(message || "").trim().slice(0, MAX_MESSAGE);
    if (text.length < 5) return { error: "too-short" };
    const title = String(subject || "").trim().slice(0, MAX_SUBJECT);
    const doc = await ContactMessage.create({
        user: user._id,
        fromName: displayNameFor(user),
        fromEmail: user.email || "",
        subject: title,
        message: text
    });
    return { message: present(doc) };
}

async function listForAdmin({ status = "", page = 1, limit = 50 } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const filter = {};
    if (status && ["new", "read", "replied", "resolved"].includes(status)) filter.status = status;
    const [docs, total] = await Promise.all([
        ContactMessage.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate("user", "username name email avatarUrl")
            .lean(),
        ContactMessage.countDocuments(filter)
    ]);
    return {
        messages: docs.map(present),
        total,
        page: safePage,
        pages: Math.max(1, Math.ceil(total / safeLimit))
    };
}

async function listForUser(userId) {
    const docs = await ContactMessage.find({ user: userId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .lean();
    return { messages: docs.map(present) };
}

async function reply(id, adminUser, { reply = "", status = "replied" } = {}) {
    if (!id || !/^[a-f\d]{24}$/i.test(String(id))) return { error: "invalid" };
    const text = String(reply || "").trim().slice(0, 2000);
    if (text.length < 2) return { error: "too-short" };
    const doc = await ContactMessage.findById(id);
    if (!doc) return { error: "not-found" };
    doc.adminReply = text;
    doc.repliedBy = adminUser._id;
    doc.repliedAt = new Date();
    doc.status = ["resolved", "replied", "read"].includes(status) ? status : "replied";
    await doc.save();
    // Deliver the reply in the user's notification centre.
    await appNotifications.push({
        userId: doc.user,
        type: "admin_reply",
        title: "Admin reply",
        body: text,
        link: "/account#contact-admin",
        data: { contactMessageId: String(doc._id) }
    });
    return { message: present(doc) };
}

async function updateStatus(id, status) {
    if (!id || !/^[a-f\d]{24}$/i.test(String(id))) return { error: "invalid" };
    if (!["new", "read", "replied", "resolved"].includes(status)) return { error: "invalid-status" };
    const doc = await ContactMessage.findById(id);
    if (!doc) return { error: "not-found" };
    doc.status = status;
    await doc.save();
    return { message: present(doc) };
}

module.exports = { send, listForAdmin, listForUser, reply, updateStatus, present };