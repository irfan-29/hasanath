// Mongo-backed store for express-rate-limit.
//
// Vercel runs each invocation in a fresh container, so the default in-memory
// store gives every instance its own counters: an attacker could simply spread
// guesses across cold starts and never trip a limit. The app already holds a
// warm Mongo connection for sessions and user data, so the counters live there
// and every instance reads the same numbers.
//
// A fixed window makes the write a single atomic upsert: the window start is
// part of the document _id ("<prefix><key>:<startMs>"), so concurrent requests
// increment the same row without a read-modify-write race. The model's TTL
// index drops each row shortly after its window ends, so the collection stays
// proportional to active clients rather than total traffic.

const RateLimitCounter = require("../models/RateLimitCounter.js");

class MongoRateLimitStore {
    constructor(prefix) {
        this.prefix = String(prefix || "");
        // Replaced by init() with the limiter's real window.
        this.windowMs = 60 * 1000;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    // Fixed windows aligned to the epoch, like the memory store: every client
    // in the same window shares the same reset time instead of carrying a
    // sliding one that never quite expires.
    bucket(key, now = Date.now()) {
        const start = Math.floor(now / this.windowMs) * this.windowMs;
        return {
            id: `${this.prefix}${key}:${start}`,
            resetTime: new Date(start + this.windowMs)
        };
    }

    async increment(key) {
        const { id, resetTime } = this.bucket(key);
        const update = {
            $inc: { hits: 1 },
            $setOnInsert: { prefix: this.prefix, expiresAt: resetTime }
        };

        try {
            const doc = await RateLimitCounter.findOneAndUpdate({ _id: id }, update, {
                upsert: true,
                new: true
            }).lean();
            return { totalHits: doc.hits, resetTime };
        } catch (err) {
            // The first two requests of a window can race on the insert. One
            // wins; the loser retries the increment against the row that now
            // exists instead of failing the request.
            if (err && err.code === 11000) {
                const doc = await RateLimitCounter.findOneAndUpdate(
                    { _id: id },
                    { $inc: { hits: 1 } },
                    { new: true }
                ).lean();
                return { totalHits: doc ? doc.hits : 1, resetTime };
            }
            throw err;
        }
    }

    // Called by the limiter when skipSuccessfulRequests is on and the request
    // succeeded. The hit may belong to the previous window if the response
    // crossed a boundary, in which case the row is already gone and the $gt
    // guard leaves the new window's counter alone.
    async decrement(key) {
        const { id } = this.bucket(key);
        await RateLimitCounter.updateOne(
            { _id: id, hits: { $gt: 0 } },
            { $inc: { hits: -1 } }
        );
    }

    async resetKey(key) {
        const { id } = this.bucket(key);
        await RateLimitCounter.deleteOne({ _id: id });
    }

    async resetAll() {
        await RateLimitCounter.deleteMany({ prefix: this.prefix });
    }
}

module.exports = { MongoRateLimitStore };
