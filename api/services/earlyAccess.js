// Early access: the short list of email addresses allowed to sign up while
// signups are capped or closed. Temporary; see models/EarlyAccess.js.

const EarlyAccess = require("../models/EarlyAccess.js");
const User = require("../models/User.js");
const emailService = require("./email.js");
const { compose, escapeHtml, siteUrl } = require("./emailTemplate.js");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LIST = 500;

function clean(email) {
    return String(email || "").trim().toLowerCase();
}

// The address the invitation links to.
function signupUrl() {
    return siteUrl() + "/register";
}

function invitation(email) {
    return compose({
        subject: "Your early access to Hasanath",
        lines: [
            "You have been given early access to Hasanath: a quiet, ad-free place to track your salah, read the Qur’an, keep your dhikr and grow with friends."
        ],
        button: { label: "Create your account", url: signupUrl() },
        after: [{
            text: "Please sign up with this email address (" + email + "). Early access is tied to it.",
            html: "Please sign up with this email address (<strong>" + escapeHtml(email) + "</strong>). Early access is tied to it."
        }],
        note: "If you did not ask for this, you can ignore this email."
    });
}

// Is this address on the list? Used by the signup checks.
async function isInvited(email) {
    const address = clean(email);
    if (!address) return false;
    return Boolean(await EarlyAccess.exists({ email: address }));
}

// Add an address (or invite it again if it is already there) and email it.
// Returns { entry, emailed } or { error }.
async function invite(email, admin) {
    const address = clean(email);
    if (!EMAIL_PATTERN.test(address) || address.length > 254) return { error: "invalid-email" };
    if (await User.exists({ email: address })) return { error: "already-registered" };

    let entry = await EarlyAccess.findOne({ email: address });
    if (!entry) {
        if ((await EarlyAccess.estimatedDocumentCount()) >= MAX_LIST) return { error: "list-full" };
        entry = new EarlyAccess({ email: address, addedBy: admin && admin._id ? admin._id : null });
    }

    const message = invitation(address);
    let emailed = false;
    try {
        const result = await emailService.sendEmail({ to: address, ...message });
        emailed = Boolean(result && result.ok);
    } catch (err) {
        console.error("early access: could not email", address, "-", err.message);
    }
    entry.invitedAt = new Date();
    entry.emailSent = emailed;
    await entry.save();
    return { entry: present(entry), emailed };
}

async function remove(id) {
    const result = await EarlyAccess.deleteOne({ _id: id });
    return result.deletedCount > 0;
}

// Recorded when an account is created, so the list shows who has used theirs.
async function markSignedUp(email) {
    const address = clean(email);
    if (!address) return;
    await EarlyAccess.updateOne({ email: address, signedUpAt: null }, { $set: { signedUpAt: new Date() } });
}

function present(entry) {
    return {
        id: String(entry._id),
        email: entry.email,
        addedAt: entry.createdAt || null,
        invitedAt: entry.invitedAt || null,
        emailSent: Boolean(entry.emailSent),
        signedUpAt: entry.signedUpAt || null
    };
}

// Newest first.
async function list() {
    const rows = await EarlyAccess.find({}).sort({ createdAt: -1 }).limit(MAX_LIST).lean();
    return rows.map(present);
}

module.exports = { isInvited, invite, remove, markSignedUp, list, _invitation: invitation, _clean: clean };
