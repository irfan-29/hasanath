const fetch = require("node-fetch");
const { readCache, writeCache } = require("./cacheStore");

// Surah text and translations are immutable, but every page view was re-fetching
// them from two upstreams. On Vercel that stack of sequential external calls is
// what pushed /surah/:no past the 10s invocation limit. Cache them in Mongo
// instead, with a bounded timeout so a slow upstream degrades instead of
// hanging the function.
const FETCH_TIMEOUT_MS = 5000;

// Per-instance memo so a warm function doesn't hit Mongo either.
const memo = new Map();
const MEMO_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchJson(url, { followRedirects = true } = {}) {
    const res = await fetch(url, {
        timeout: FETCH_TIMEOUT_MS,
        follow: followRedirects ? 5 : 0
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}

async function cachedJson(url, opts = {}) {
    const key = url;

    const hot = memo.get(key);
    if (hot && Date.now() - hot.at < MEMO_TTL_MS) return hot.value;

    try {
        const hit = await readCache(key);
        if (hit) {
            memo.set(key, { value: hit, at: Date.now() });
            return hit;
        }
    } catch (err) {
        // Cache unavailable (e.g. slow start-up) - fall through to the network.
        console.error("quranCache: read failed -", err.message);
    }

    const value = await fetchJson(url, opts);

    memo.set(key, { value, at: Date.now() });
    try {
        await writeCache(key, value);
    } catch (err) {
        console.error("quranCache: write failed -", err.message);
    }
    return value;
}

// Best-effort variant: returns null instead of throwing, for callers that can
// still render something useful without the data.
async function cachedJsonOrNull(url, opts = {}) {
    try {
        return await cachedJson(url, opts);
    } catch (err) {
        console.error("quranCache: fetch failed -", url, err.message);
        return null;
    }
}

module.exports = { cachedJson, cachedJsonOrNull, FETCH_TIMEOUT_MS };
