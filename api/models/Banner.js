const mongoose = require("mongoose");

// An announcement rendered by the shell.
//
//   otb    - a one-time popup. Each signed-in account sees it until it has been
//            acknowledged once (see BannerView), which is what lets an admin
//            announce a new feature without permanently covering the app.
//   sticky - a thin bar pinned to the top or bottom of the viewport, e.g. the
//            Android app download prompt. Sticky bars are not tracked per user;
//            they are meant to be dismissible in the browser and removable by
//            the admin when the campaign ends.
//
// `active` is the only scheduling an admin needs today: create the banner as
// inactive to stage it, then flip it on. The optional window keeps a scheduled
// end possible without a background job.
const bannerSchema = new mongoose.Schema({
    kind: {
        type: String,
        required: true,
        enum: ["otb", "sticky"],
        default: "otb",
        index: true
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", trim: true, maxlength: 600 },
    // Optional call to action. The URL is validated in the admin route so an
    // `javascript:` link can never reach an anchor.
    ctaLabel: { type: String, default: "", trim: true, maxlength: 40 },
    ctaUrl: { type: String, default: "", trim: true, maxlength: 500 },
    // Sticky bars only. OTB is always a centred dialog.
    position: {
        type: String,
        enum: ["top", "bottom"],
        default: "top"
    },
    active: { type: Boolean, default: false, index: true },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

// The delivery query: active banners of one kind, inside their window.
bannerSchema.index({ kind: 1, active: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model("Banner", bannerSchema);
