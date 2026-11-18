const mongoose = require("mongoose");

// A feed post.
//
// `status` is the moderation state, and it is what keeps a brand-new account's
// posts from reaching every Telegram subscriber on the first attempt:
//
//   published - visible in the feed, and a candidate for the new-post broadcast
//   pending   - visible only to its author until it is approved (or its hold
//               expires, see api/services/postModeration.js)
//   rejected  - hidden from everyone; only kept so reports and the admin queue
//               still have something to point at
//
// Posts created before moderation existed have no status at all. Queries treat
// a missing value as published (see postModeration.visibleFilter), so no
// migration is needed.
const postSchema = new mongoose.Schema({
    // Posts stay public (everyone can read the feed) but we remember who wrote
    // them, so the UI can attribute them.
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: "" },
    content: String,
    reference: String,
    postedDate: String,
    isVideo: Boolean,
    // Stored as ids rather than a counter so a person can like once and unlike
    // later. The list itself is never sent to the browser; presentPost() turns
    // it into a count plus a per-viewer flag.
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    status: {
        type: String,
        enum: ["published", "pending", "rejected"],
        default: "published",
        index: true
    },
    // Why the post is pending: "review" (new account) or "reported" (the report
    // threshold was reached). The two differ in what happens next: a review
    // hold expires on its own, a reported post waits for a person.
    statusReason: { type: String, default: "" },
    // When a review-held post becomes public on its own. Null for a reported
    // post, which stays hidden until an admin acts.
    autoPublishAt: { type: Date, default: null },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
});

// The feed reads published rows; the release sweep reads pending rows whose
// hold has expired. This index serves both.
postSchema.index({ status: 1, autoPublishAt: 1 });

// The model is still named "Posts": the collection and the notification
// service's `mongoose.models.Posts` lookup both depend on it.
module.exports = mongoose.model("Posts", postSchema);
