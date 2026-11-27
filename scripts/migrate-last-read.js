// Collapses the old last-read fields into one string array.
//
//   npm run migrate:last-read          # dry run - reports the plan only
//   npm run migrate:last-read -- --apply
//
// Before this, a user document stored the same reading history three ways:
//
//   lastReadSurahs: ["2", "36"]            the five surahs, order only
//   lastReadAyahs:  [{ surahNo, ayahNo }]  one position per surah
//   lastReadAyah:   { surahNo, ayahNo }    the single most recent position
//
// The reader now keeps one array where each entry is either "2:255" (an exact
// verse) or "2" (the surah was only opened in list view). This script rewrites
// existing accounts to that form and unsets the two old fields.
//
// Idempotent: an account already in the new shape is left alone, so it is safe
// to re-run.

require("dotenv").config();

const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const MAX_LAST_READ = 5;
const MAX_AYAHS = 286;

function validSurah(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 114 ? n : null;
}

function validAyah(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= MAX_AYAHS ? n : null;
}

function buildHistory(doc) {
    // Positions written by the old per-surah list, plus the global position as
    // a fallback for accounts that predate even that list.
    const positions = new Map();
    for (const entry of Array.isArray(doc.lastReadAyahs) ? doc.lastReadAyahs : []) {
        if (!entry || typeof entry !== "object") continue;
        const surahNo = validSurah(entry.surahNo);
        const ayahNo = validAyah(entry.ayahNo);
        if (surahNo && ayahNo) positions.set(surahNo, ayahNo);
    }
    if (doc.lastReadAyah && typeof doc.lastReadAyah === "object") {
        const surahNo = validSurah(doc.lastReadAyah.surahNo);
        const ayahNo = validAyah(doc.lastReadAyah.ayahNo);
        if (surahNo && ayahNo && !positions.has(surahNo)) positions.set(surahNo, ayahNo);
    }

    const out = [];
    const seen = new Set();
    const add = (surahNo, ayahNo) => {
        if (!surahNo || seen.has(surahNo)) return;
        seen.add(surahNo);
        out.push(`${surahNo}:${ayahNo || 1}`);
    };

    for (const entry of Array.isArray(doc.lastReadSurahs) ? doc.lastReadSurahs : []) {
        const [surahPart, ayahPart] = String(entry).split(":");
        const surahNo = validSurah(surahPart);
        if (!surahNo) continue;
        const ayahNo = ayahPart !== undefined ? validAyah(ayahPart) : positions.get(surahNo);
        add(surahNo, ayahNo);
        if (out.length >= MAX_LAST_READ) break;
    }

    // An account with only the global position still gets one history entry.
    if (!out.length) {
        for (const [surahNo, ayahNo] of positions) {
            add(surahNo, ayahNo);
            break;
        }
    }

    return out;
}

function needsMigration(doc) {
    if (doc.lastReadAyah !== undefined || doc.lastReadAyahs !== undefined) return true;
    const history = Array.isArray(doc.lastReadSurahs) ? doc.lastReadSurahs : [];
    return history.some((entry) => !/^\d{1,3}:\d{1,3}$/.test(String(entry)));
}

(async () => {
    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is not set.");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    const users = mongoose.connection.collection("users");

    const all = await users.find({}).sort({ _id: 1 }).toArray();
    console.log(`accounts: ${all.length}  mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

    let changed = 0;
    for (const doc of all) {
        if (!needsMigration(doc)) continue;
        const before = JSON.stringify(doc.lastReadSurahs || []);
        const after = buildHistory(doc);
        changed += 1;
        console.log(`${doc.email || doc.username || doc._id}: ${before} -> ${JSON.stringify(after)}`);

        if (APPLY) {
            await users.updateOne(
                { _id: doc._id },
                {
                    $set: { lastReadSurahs: after },
                    $unset: { lastReadAyah: "", lastReadAyahs: "" }
                }
            );
        }
    }

    console.log(`\n${changed} account(s) ${APPLY ? "updated" : "would be updated"}.`);
    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err.message);
    try { await mongoose.disconnect(); } catch (e) { /* already closed */ }
    process.exit(1);
});
