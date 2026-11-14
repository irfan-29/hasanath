// One-off maintenance for the shared cache collection (qurancaches).
//
//   node scripts/compress-cache.js            # compress + index
//   node scripts/compress-cache.js --dry-run  # report only
//   node scripts/compress-cache.js --rebuild  # also reclaim disk space
//
// What it does, in order:
//   1. Deletes duplicate `key` documents (keeps the newest of each).
//   2. Creates the unique `key` index every cache read needs.
//   3. Replaces the old 30-day `fetchedAt` TTL with a partial `expiresAt` TTL,
//      so immutable Quran/hadith text is never purged (and never rebuilt in
//      English only).
//   4. Clears `expiresAt` on immutable text that an older version mistakenly
//      gave a TTL (any key starting "hadith:" parsed as a URL scheme).
//   5. Re-encodes existing `value` documents as gzip, 4-6x smaller on disk.
//   6. With --rebuild, copies the collection server-side, swaps it in and
//      drops the old one. WiredTiger does not shrink a collection in place, so
//      this is what makes the freed space show up in Atlas.
//
// Safe to re-run: already-compressed documents are skipped, index creation is
// idempotent, and the API reads both the old and new shapes throughout. The
// cached data is re-derivable from upstream, so the worst case of an
// interrupted rebuild is refetching a few pages.

require("dotenv").config();
const mongoose = require("mongoose");
const { encodeValue, expiresAtFor } = require("../api/utils/cacheStore");

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("MONGO_URI is not set - add it to .env first.");
    process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const REBUILD = process.argv.includes("--rebuild");
const MB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

async function ensureIndexes(target, { quiet = false } = {}) {
    const indexes = await target.indexes();
    const has = (name) => indexes.some((i) => i.name === name);

    if (!indexes.some((i) => i.key && i.key.key === 1)) {
        if (!quiet) console.log("Creating unique index key_1…");
        await target.createIndex({ key: 1 }, { unique: true, name: "key_1" });
    } else if (!quiet) {
        console.log("key index already present.");
    }

    if (has("fetchedAt_1")) {
        if (!quiet) console.log("Dropping old fetchedAt_1 TTL index…");
        await target.dropIndex("fetchedAt_1");
    }
    if (!has("expiresAt_1")) {
        if (!quiet) console.log("Creating partial TTL index expiresAt_1…");
        await target.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_1" });
    } else if (!quiet) {
        console.log("expiresAt_1 already present.");
    }
}

(async () => {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    const db = mongoose.connection.db;
    const ns = (name) => `${db.databaseName}.${name}`;
    const exists = async (name) => Boolean(await db.listCollections({ name }, { nameOnly: true }).next());

    // Recovery from a swap that was interrupted between its two renames.
    if (!(await exists("qurancaches")) && (await exists("qurancaches_rebuild"))) {
        console.log("Found an interrupted rebuild - restoring qurancaches_rebuild…");
        await db.admin().command({ renameCollection: ns("qurancaches_rebuild"), to: ns("qurancaches") });
        await ensureIndexes(db.collection("qurancaches"));
    }

    const col = db.collection("qurancaches");
    const before = await db.command({ collStats: "qurancaches" });
    console.log(`Collection: ${before.count} docs, ${MB(before.size)} uncompressed, ${MB(before.storageSize)} on disk${DRY_RUN ? " (dry run)" : ""}`);

    // --- 1. duplicates ------------------------------------------------------
    const dups = await col.aggregate([
        { $group: { _id: "$key", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
    ]).toArray();

    for (const { _id: key, count } of dups) {
        const docs = await col.find({ key }).sort({ fetchedAt: -1, _id: -1 }).toArray();
        const extra = docs.slice(1);
        console.log(`duplicate key (${count}x): ${key}`);
        for (const doc of extra) {
            console.log(`  deleting ${doc._id}`);
            if (!DRY_RUN) await col.deleteOne({ _id: doc._id });
        }
    }
    if (!dups.length) console.log("No duplicate keys.");

    // --- 2. indexes ---------------------------------------------------------
    if (!DRY_RUN) await ensureIndexes(col);

    // --- 3. expiry normalisation -------------------------------------------
    // Older code (and the first version of this script) gave hadith keys a TTL
    // because "hadith:..." parses as a URL scheme. Immutable documents must
    // have expiresAt: null so the TTL index ignores them.
    const ttlCursor = col.find({}, { projection: { key: 1, expiresAt: 1 } });
    let expiryFixed = 0;
    let ttlBatch = [];
    const flushTtl = async () => {
        if (!ttlBatch.length) return;
        if (!DRY_RUN) await col.bulkWrite(ttlBatch, { ordered: false });
        expiryFixed += ttlBatch.length;
        ttlBatch = [];
    };
    for await (const doc of ttlCursor) {
        const shouldExpire = expiresAtFor(doc.key) !== null;
        const doesExpire = doc.expiresAt != null;
        if (shouldExpire === doesExpire) continue;
        ttlBatch.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { expiresAt: expiresAtFor(doc.key) } }
            }
        });
        if (ttlBatch.length >= 200) await flushTtl();
    }
    await flushTtl();
    if (expiryFixed) console.log(`Normalised expiresAt on ${expiryFixed} docs (immutable text no longer expires).`);

    // --- 4. re-encode -------------------------------------------------------
    const cursor = col.find({ value: { $exists: true } }, {
        projection: { key: 1, value: 1, gz: 1, fetchedAt: 1 }
    });

    let converted = 0;
    let already = 0;
    let savedBytes = 0;
    let gzipDocs = 0;
    let batch = [];

    const flush = async () => {
        if (!batch.length) return;
        if (!DRY_RUN) await col.bulkWrite(batch, { ordered: false });
        converted += batch.length;
        batch = [];
        if (converted % 200 === 0) console.log(`  …${converted} converted`);
    };

    for await (const doc of cursor) {
        if (doc.gz) { already += 1; continue; }

        const encoded = encodeValue(doc.value);
        const beforeBytes = Buffer.byteLength(JSON.stringify(doc.value));
        const afterBytes = encoded.gz ? encoded.gz.length : beforeBytes;
        savedBytes += Math.max(0, beforeBytes - afterBytes);
        if (encoded.gz) gzipDocs += 1;

        batch.push({
            updateOne: {
                filter: { _id: doc._id },
                update: {
                    $set: encoded.gz
                        ? { gz: encoded.gz, expiresAt: expiresAtFor(doc.key) }
                        : { value: encoded.value, expiresAt: expiresAtFor(doc.key) },
                    $unset: encoded.gz ? { value: "" } : { gz: "" }
                }
            }
        });
        if (batch.length >= 50) await flush();
    }
    await flush();

    const after = await db.command({ collStats: "qurancaches" });
    console.log(`\nConverted ${converted} docs (${gzipDocs} gzipped), ${already} were already compressed.`);
    console.log(`JSON payload saved: ${MB(savedBytes)} (before dedupe of BSON overhead)`);
    console.log(`Collection after: ${after.count} docs, ${MB(after.size)} uncompressed, ${MB(after.storageSize)} on disk`);

    if (REBUILD && !DRY_RUN) {
        // WiredTiger keeps the space freed by smaller documents until it is
        // reused, so the on-disk figure only drops after a fresh copy.
        console.log("\nRebuilding the collection to reclaim disk space…");
        const total = await col.countDocuments({});
        await col.aggregate([{ $out: "qurancaches_rebuild" }]).toArray();
        const rebuilt = db.collection("qurancaches_rebuild");
        const copied = await rebuilt.countDocuments({});
        if (copied !== total) throw new Error(`copy mismatch: ${copied}/${total} documents`);
        await ensureIndexes(rebuilt, { quiet: true });

        await db.admin().command({ renameCollection: ns("qurancaches"), to: ns("qurancaches_old") });
        await db.admin().command({ renameCollection: ns("qurancaches_rebuild"), to: ns("qurancaches") });
        await db.collection("qurancaches_old").drop();

        const rebuiltStats = await db.command({ collStats: "qurancaches" });
        console.log(`Rebuilt: ${rebuiltStats.count} docs, ${MB(rebuiltStats.size)} uncompressed, ${MB(rebuiltStats.storageSize)} on disk`);
    }

    if (DRY_RUN) console.log("Dry run - nothing was written.");

    await mongoose.disconnect();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
