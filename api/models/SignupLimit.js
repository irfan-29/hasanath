const mongoose = require("mongoose");

// A single document holds the signup caps an admin can set to keep a launch
// from overwhelming the server. Missing document means "no cap" (unlimited),
// so accounts created before this feature existed are unaffected.
const signupLimitSchema = new mongoose.Schema({
    // 0 or null means unlimited.
    dailyLimit: { type: Number, default: 0, min: 0 },
    weeklyLimit: { type: Number, default: 0, min: 0 },
    // Percentage of a limit at which admins are notified that signups are
    // nearing the cap (1-100). 0 disables the warning.
    thresholdPercent: { type: Number, default: 80, min: 0, max: 100 },
    // Whether the caps are enforced at all. Lets an admin disable them
    // without losing the configured values.
    enabled: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, default: "" }
}, { _id: true });

// Singleton accessor: there is at most one document. Create the default on
// first read so the admin portal always has something to edit.
signupLimitSchema.statics.getSingleton = async function () {
    let doc = await this.findOne();
    if (!doc) doc = await this.create({});
    return doc;
};

module.exports = mongoose.model("SignupLimit", signupLimitSchema);
module.exports.schema = signupLimitSchema;
