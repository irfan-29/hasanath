const mongoose = require("mongoose");

// Early access (temporary, for the period before the public launch).
//
// While signups are capped or closed on the Limits page, an email address on
// this list may still sign up. An admin adds the address (Admin > Limits), the
// person is emailed that they can register, and the signup checks let that one
// address through. When the app opens to everyone, lift the signup limits and
// this list simply stops mattering; see docs/developer-notes.md for removing it.
const earlyAccessSchema = new mongoose.Schema({
    // Lower-cased; one entry per address.
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // When the invitation email was last sent, and whether it went out.
    invitedAt: { type: Date, default: null },
    emailSent: { type: Boolean, default: false },
    // Set when an account is created with this address.
    signedUpAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("EarlyAccess", earlyAccessSchema);
