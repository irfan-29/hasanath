const mongoose = require("mongoose");

// A challenge shared between friends.
//
// Each participant carries their own streak, so the same challenge produces a
// leaderboard without every check-in rewriting anyone else's document. History
// is stored as dated keys: the streak is recomputed from it, which is what keeps
// an un-check from leaving a streak inflated.
const participantSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
    currentStreak: { type: Number, default: 0 },
    maxStreak: { type: Number, default: 0 },
    // ISO YYYY-MM-DD check-in days, newest first, capped in the service.
    history: [String],
    lastUpdated: String,
    respondedAt: Date
}, { _id: false });

const friendChallengeSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    participants: [participantSchema],
    createdAt: { type: Date, default: Date.now }
});

// "Challenges I am invited to or part of" is the only list query.
friendChallengeSchema.index({ "participants.user": 1 });

module.exports = mongoose.model("FriendChallenge", friendChallengeSchema);
