const mongoose = require("mongoose");

// One row per pair of people, in either direction.
//
// The relationship is directional (who asked) but the pair is unique, so the
// same two accounts can never accumulate a second request by swapping turns.
// `key` carries that uniqueness as a single indexed string rather than a
// compound index over two ids, which keeps the duplicate check independent of
// who asked first.
const friendshipSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // A declined request is deleted rather than stored: the pair is free to try
    // again later, and no "declined" tombstone sits between them.
    status: { type: String, enum: ["pending", "accepted"], default: "pending" },
    createdAt: { type: Date, default: Date.now },
    respondedAt: Date
});

friendshipSchema.statics.keyFor = function keyFor(a, b) {
    const ids = [String(a), String(b)].sort();
    return `${ids[0]}:${ids[1]}`;
};

module.exports = mongoose.model("Friendship", friendshipSchema);
