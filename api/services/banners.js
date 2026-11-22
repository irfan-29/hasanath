// Delivery and acknowledgement of admin-authored banners.
//
// A banner is read on the app boot payload, so these helpers are deliberately
// small: one query for the sticky bar, and at most two for the next one-time
// popup. Nothing here writes on a normal page load; a row is created only when
// the reader acknowledges the popup.

const Banner = require("../models/Banner.js");
const BannerView = require("../models/BannerView.js");
const { interpolateUser } = require("../utils/displayName.js");

const OBJECT_ID = /^[a-f\d]{24}$/i;

// `viewer` is optional. When it is passed, ${user} is resolved for that person
// (pass null for a guest, who gets the friendly fallback). The admin portal
// calls present() without a viewer so the editor keeps showing the template.
function present(banner, viewer) {
    if (!banner) return null;
    const raw = typeof banner.toObject === "function" ? banner.toObject() : banner;
    const personalize = viewer !== undefined;
    const title = raw.title || "";
    const body = raw.body || "";
    const ctaLabel = raw.ctaLabel || "";
    return {
        id: String(raw._id || ""),
        kind: raw.kind,
        title: personalize ? interpolateUser(title, viewer) : title,
        body: personalize ? interpolateUser(body, viewer) : body,
        ctaLabel: personalize ? interpolateUser(ctaLabel, viewer) : ctaLabel,
        ctaUrl: raw.ctaUrl || "",
        position: raw.position === "bottom" ? "bottom" : "top",
        revision: Number(raw.revision) || 0,
        createdAt: raw.createdAt || null
    };
}

function liveFilter(now = new Date()) {
    return {
        active: true,
        startsAt: { $lte: now },
        $or: [{ endsAt: null }, { endsAt: { $gt: now } }]
    };
}

// The shell's boot payload. A guest gets the sticky bar only: a one-time popup
// belongs to an account, because "seen once" has nowhere durable to live for a
// visitor who has not signed in. `user` may be a User document or null.
async function deliverFor(user) {
    const userId = user && user._id ? user._id : null;
    const now = new Date();
    const sticky = await Banner.find({ ...liveFilter(now), kind: "sticky" })
        .sort({ createdAt: -1, _id: -1 })
        .limit(1)
        .lean();

    let otb = null;
    if (userId) {
        const seen = await BannerView.find({ user: userId }).distinct("banner");
        otb = await Banner.findOne({
            ...liveFilter(now),
            kind: "otb",
            _id: { $nin: seen }
        })
            .sort({ createdAt: 1, _id: 1 })
            .lean();
    }

    return {
        sticky: sticky.map((banner) => present(banner, user)),
        otb: present(otb, user)
    };
}

// Idempotent: the unique index turns a repeated close, or two open tabs, into
// one row. `upsert` keeps the first acknowledgement time rather than moving it.
async function markSeen(bannerId, userId) {
    if (!userId || !OBJECT_ID.test(String(bannerId))) return false;
    const banner = await Banner.findOne({ _id: bannerId, kind: "otb" }).select("_id").lean();
    if (!banner) return false;

    await BannerView.updateOne(
        { banner: banner._id, user: userId },
        { $setOnInsert: { banner: banner._id, user: userId, seenAt: new Date() } },
        { upsert: true }
    );
    return true;
}

// View counts for the admin list. One aggregation rather than a query per row.
async function seenCounts(bannerIds) {
    if (!Array.isArray(bannerIds) || bannerIds.length === 0) return new Map();
    const rows = await BannerView.aggregate([
        { $match: { banner: { $in: bannerIds } } },
        { $group: { _id: "$banner", count: { $sum: 1 } } }
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
}

module.exports = {
    present,
    liveFilter,
    deliverFor,
    markSeen,
    seenCounts
};
