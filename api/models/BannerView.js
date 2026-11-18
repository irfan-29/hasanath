const mongoose = require("mongoose");

// One row per account per one-time banner.
//
// The banner document deliberately does not carry a `seenBy` array: that array
// would grow without bound on a popular announcement and would be rewritten on
// every dismissal. A separate collection with a unique compound index makes the
// acknowledgement idempotent and keeps the count cheap.
const bannerViewSchema = new mongoose.Schema({
    banner: { type: mongoose.Schema.Types.ObjectId, ref: "Banner", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    seenAt: { type: Date, default: Date.now }
});

// A double-tap or a retried request must not create a second row.
bannerViewSchema.index({ banner: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("BannerView", bannerViewSchema);
