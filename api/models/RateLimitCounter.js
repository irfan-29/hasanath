const mongoose = require("mongoose");

// One document per (limiter, key, window). The _id carries the window start so
// an increment is a single atomic upsert, and a TTL index removes the row when
// that window is over - no sweeper job needed.
const rateLimitCounterSchema = new mongoose.Schema({
    // "<prefix><key>:<windowStartMs>". The limiter prefix keeps two limiters
    // that happen to see the same key from counting each other's hits.
    _id: String,
    prefix: { type: String, required: true, index: true },
    hits: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
}, { versionKey: false });

rateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RateLimitCounter", rateLimitCounterSchema);
