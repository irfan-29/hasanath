const mongoose = require("mongoose");

// The single document holding every adjustable limit.
//
// `values` maps a limit's key to either a number or null:
//   null   - the limit is off (no limit / no wait)
//   number - the limit is on, and the number is what it says; 0 means zero
// There is deliberately no magic number for "unlimited". The keys, ranges and
// defaults live in services/limits.js; this model only stores what was chosen.
const appLimitSchema = new mongoose.Schema({
    // Fixed id so there is exactly one document and it can be upserted safely.
    _id: { type: String, default: "limits" },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Tell the admins when signups reach this share of a signup cap.
    thresholdPercent: { type: Number, default: 80, min: 0, max: 100 },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: "" }
}, { minimize: false });

module.exports = mongoose.model("AppLimit", appLimitSchema);
