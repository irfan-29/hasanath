// --- Shared immutable-JSON cache ---------------------------------------------
// Quran surahs, editions and hadith sections are immutable, but their upstreams
// only publish whole files (Bukhari's Arabic edition alone is ~9 MB), so each
// document is fetched once and kept in Mongo. The Quran and hadith modules both
// read and write through this file so there is exactly one document shape,
// one set of indexes and one encoding path.
//
// Values are stored gzipped (`gz`). Storing the same JSON 4-6x smaller on the
// wire costs roughly half the CPU of decoding the equivalent BSON Mixed
// object, and keeps the collection inside the free Atlas tier. Documents
// written before compression have a plain `value`; the read path still serves
// those, so deploying this is not a migration cliff.

const zlib = require("zlib");
const { promisify } = require("util");
const mongoose = require("mongoose");

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Gzipping a tiny document costs more in header bytes than it saves, so those
// stay as plain `value`. Everything users actually read is far above this.
const GZIP_MIN_BYTES = 512;

// Immutable upstreams never expire: the text cannot change, and the old 30-day
// TTL was purging hadith/Quran documents and then rebuilding them in English
// only, silently downgrading Urdu and Tamil readers. Mutable data (prayer
// times, geocoding) keeps a bounded lifetime.
const IMMUTABLE_HOSTS = new Set([
    "quranapi.pages.dev",
    "cdn.jsdelivr.net"
]);
const MUTABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const cacheSchema = new mongoose.Schema({
    key: { type: String, required: true },
    gz: Buffer,
    value: mongoose.Schema.Types.Mixed, // legacy, uncompressed documents
    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null } // null = never
}, { _id: false, versionKey: false });

// Every read is a point lookup by key; without this index it was a collection
// scan over ~1,750 documents (~38 ms server-side, several hundred ms from a
// remote client).
cacheSchema.index({ key: 1 }, { unique: true });
// Partial TTL: only documents that opted in by setting `expiresAt` are removed.
cacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Cache = mongoose.models.QuranCache
    || mongoose.model("QuranCache", cacheSchema);

function expiresAtFor(key) {
    // Only real HTTP(S) keys can be mutable. Hadith keys look like
    // "hadith:bukhari:eng:sec:1", which the URL parser accepts as a scheme
    // with no host - those are immutable text.
    if (!/^https?:\/\//i.test(key)) return null;

    let host;
    try {
        host = new URL(key).host;
    } catch (err) {
        return null;
    }
    return IMMUTABLE_HOSTS.has(host) ? null : new Date(Date.now() + MUTABLE_TTL_MS);
}

// Used by the migration script and by tests; the runtime never changes keys.
function encodeValue(value) {
    const json = JSON.stringify(value);
    const raw = Buffer.from(json);
    if (raw.length < GZIP_MIN_BYTES) return { value, gz: null };
    return { gz: zlib.gzipSync(raw), value: null };
}

// `.lean()` gives back whatever the driver decoded: Buffer for a Mongoose
// Buffer path in some versions, BSON Binary in others (Mongoose skips casting
// in lean mode). Normalise both before gunzip.
function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value && typeof value.value === "function") return Buffer.from(value.value(true));
    if (value && value.buffer) return Buffer.from(value.buffer);
    return Buffer.from(value);
}

async function readCache(key) {
    const hit = await Cache.findOne({ key }).lean();
    if (!hit) return null;
    if (!hit.gz) return hit.value === undefined ? null : hit.value;
    try {
        return JSON.parse((await gunzip(asBuffer(hit.gz))).toString("utf8"));
    } catch (err) {
        console.error("cacheStore: corrupt document -", key, err.message);
        return null;
    }
}

async function writeCache(key, value, { expiresAt } = {}) {
    const raw = Buffer.from(JSON.stringify(value));
    const compressed = raw.length >= GZIP_MIN_BYTES ? await gzip(raw) : null;
    const expires = expiresAt !== undefined ? expiresAt : expiresAtFor(key);

    await Cache.updateOne(
        { key },
        {
            $set: compressed
                ? { gz: compressed, fetchedAt: new Date(), expiresAt: expires }
                : { value, fetchedAt: new Date(), expiresAt: expires },
            ...(compressed ? { $unset: { value: "" } } : { $unset: { gz: "" } })
        },
        { upsert: true }
    );
}

module.exports = {
    readCache,
    writeCache,
    encodeValue,
    expiresAtFor,
    GZIP_MIN_BYTES,
    MUTABLE_TTL_MS
};
