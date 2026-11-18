// Account search for the admin Users tab.
//
// This answers "who is here and are they active", and every row links to the
// ordinary profile page for the content itself. The only write exposed here is
// the admin flag, which is handled by PATCH /api/admin/users/:id in app.js so
// the permission checks stay next to the other portal routes.

const User = require("../models/User.js");
const Posts = require("../models/Post.js");
const postModeration = require("./postModeration.js");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinedAt(user) {
    if (user.createdAt) return user.createdAt;
    // Legacy accounts have no top-level createdAt; their id still carries the
    // creation timestamp, so the column is never blank.
    if (user._id && typeof user._id.getTimestamp === "function") return user._id.getTimestamp();
    return null;
}

async function list({ query = "", page = 1, limit = DEFAULT_LIMIT } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const safePage = Math.max(Number(page) || 1, 1);
    const q = String(query || "").trim();

    const filter = q
        ? {
            $or: [
                { username: { $regex: escapeRegex(q), $options: "i" } },
                { name: { $regex: escapeRegex(q), $options: "i" } },
                { email: { $regex: escapeRegex(q), $options: "i" } }
            ]
        }
        : {};

    const [users, total] = await Promise.all([
        User.find(filter)
            .select("username name email avatarUrl createdAt lastSeenAt telegram.enabled isAdmin")
            .sort({ lastSeenAt: -1, _id: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .lean(),
        User.countDocuments(filter)
    ]);

    const ids = users.map((user) => user._id);
    const counts = ids.length
        ? await Posts.aggregate([
            { $match: { author: { $in: ids } } },
            {
                $group: {
                    _id: "$author",
                    posts: { $sum: 1 },
                    published: {
                        $sum: {
                            $cond: [
                                { $eq: [{ $ifNull: ["$status", "published"] }, "published"] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ])
        : [];
    const countByAuthor = new Map(counts.map((row) => [String(row._id), row]));

    return {
        users: users.map((user) => {
            const stats = countByAuthor.get(String(user._id)) || { posts: 0, published: 0 };
            return {
                id: String(user._id),
                username: user.username || "",
                name: user.name || "",
                email: user.email || "",
                avatarUrl: user.avatarUrl || "",
                telegram: Boolean(user.telegram && user.telegram.enabled),
                // envAdmin is the address in ADMIN_EMAILS. The portal shows
                // that row without a toggle: only the deployment can change it.
                isAdmin: Boolean(user.isAdmin),
                envAdmin: postModeration.isEnvAdmin(user),
                joinedAt: joinedAt(user),
                lastSeenAt: user.lastSeenAt || null,
                posts: stats.posts || 0,
                published: stats.published || 0
            };
        }),
        total,
        page: safePage,
        pages: Math.max(1, Math.ceil(total / safeLimit)),
        limit: safeLimit
    };
}

module.exports = { list };
