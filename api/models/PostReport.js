const mongoose = require("mongoose");

// One row per (post, reporter). The unique key is what makes "report" safe to
// press twice and what stops one account from reaching the hide threshold on
// its own: counting distinct reporters means a single person cannot bury a post
// by clicking the button repeatedly.
const postReportSchema = new mongoose.Schema({
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Posts", required: true, index: true },
    // Copied at report time so the queue still knows who wrote the post even if
    // the post is deleted later. A denormalised id is cheaper than a populate
    // on every admin read.
    postAuthor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
        type: String,
        enum: ["spam", "harassment", "misinformation", "other"],
        required: true
    },
    // Optional free text. Capped so one report cannot bloat a document.
    note: { type: String, default: "", maxlength: 500 },
    // open      - still counted toward the hide threshold
    // dismissed - an admin reviewed the post and kept it
    // actioned  - an admin removed the post
    status: { type: String, enum: ["open", "dismissed", "actioned"], default: "open", index: true },
    createdAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null }
});

postReportSchema.index({ post: 1, reporter: 1 }, { unique: true });
postReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PostReport", postReportSchema);
