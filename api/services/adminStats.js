// The numbers behind the admin overview.
//
// "New" counts are based on the ObjectId timestamp rather than User.createdAt:
// accounts that predate that field still have a creation time encoded in their
// _id, so the report is honest for the whole collection without a migration.
// "Active" counts use lastSeenAt, which only exists from the day this portal
// shipped - legacy accounts join the number the next time they open the app.

const mongoose = require("mongoose");
const User = require("../models/User.js");
const Posts = require("../models/Post.js");
const PostReport = require("../models/PostReport.js");
const Banner = require("../models/Banner.js");
const BannerView = require("../models/BannerView.js");
const Broadcast = require("../models/Broadcast.js");

const DAY = 24 * 60 * 60 * 1000;
const TIMELINE_DAYS = 14;

function startOfDay(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function idSince(date) {
    return mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

function isoDay(date) {
    return date.toISOString().slice(0, 10);
}

function dayKeys(days) {
    const today = startOfDay();
    const out = [];
    for (let index = days - 1; index >= 0; index -= 1) {
        out.push(isoDay(new Date(today.getTime() - index * DAY)));
    }
    return out;
}

// Aggregation groups ObjectId-created documents into UTC days. Kept as one
// helper because signups, posts and last-seen activity all want the same shape.
async function dailyFromObjectIds(Model, since) {
    return Model.aggregate([
        { $match: { _id: { $gte: idSince(since) } } },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$_id" } } },
                count: { $sum: 1 }
            }
        }
    ]);
}

async function overview() {
    const now = new Date();
    const today = startOfDay(now);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
    const timelineStart = new Date(today.getTime() - (TIMELINE_DAYS - 1) * DAY);

    const [
        totalUsers,
        newToday,
        new7d,
        new30d,
        activeToday,
        active7d,
        active30d,
        totalPosts,
        posts7d,
        pendingPosts,
        openReports,
        otbActive,
        stickyActive,
        otbViews,
        broadcastCount,
        latestBroadcast,
        userDays,
        postDays,
        activeDays
    ] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ _id: { $gte: idSince(today) } }),
        User.countDocuments({ _id: { $gte: idSince(sevenDaysAgo) } }),
        User.countDocuments({ _id: { $gte: idSince(thirtyDaysAgo) } }),
        User.countDocuments({ lastSeenAt: { $gte: today } }),
        User.countDocuments({ lastSeenAt: { $gte: sevenDaysAgo } }),
        User.countDocuments({ lastSeenAt: { $gte: thirtyDaysAgo } }),
        Posts.countDocuments({}),
        Posts.countDocuments({ _id: { $gte: idSince(sevenDaysAgo) } }),
        Posts.countDocuments({ status: "pending" }),
        PostReport.countDocuments({ status: "open" }),
        Banner.countDocuments({ kind: "otb", active: true }),
        Banner.countDocuments({ kind: "sticky", active: true }),
        BannerView.countDocuments({}),
        Broadcast.countDocuments({}),
        Broadcast.findOne({}).sort({ createdAt: -1 }).lean(),
        dailyFromObjectIds(User, timelineStart),
        dailyFromObjectIds(Posts, timelineStart),
        User.aggregate([
            { $match: { lastSeenAt: { $gte: timelineStart } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$lastSeenAt" } },
                    count: { $sum: 1 }
                }
            }
        ])
    ]);

    const byDay = (rows) => new Map(rows.map((row) => [row._id, row.count]));
    const signups = byDay(userDays);
    const posts = byDay(postDays);
    const active = byDay(activeDays);
    const timeline = dayKeys(TIMELINE_DAYS).map((date) => ({
        date,
        signups: signups.get(date) || 0,
        posts: posts.get(date) || 0,
        active: active.get(date) || 0
    }));

    return {
        users: { total: totalUsers, newToday, new7d, new30d, activeToday, active7d, active30d },
        posts: { total: totalPosts, last7d: posts7d, pending: pendingPosts },
        reports: { open: openReports },
        banners: { otbActive, stickyActive, otbViews },
        broadcasts: {
            count: broadcastCount,
            lastAt: latestBroadcast ? latestBroadcast.createdAt : null,
            lastTitle: latestBroadcast ? latestBroadcast.title || "" : ""
        },
        timeline
    };
}

module.exports = { overview };
