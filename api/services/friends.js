// Friendships: requests, acceptance, the friend list, and public search.
//
// A request only becomes a friendship after the recipient accepts it, and the
// row is deleted outright on decline so the pair can try again later. Every
// operation is addressed by the signed-in user's own id; nothing here trusts a
// user id from the request body.

const Friendship = require("../models/Friendship.js");
const User = require("../models/User.js");
const usernameUtil = require("../utils/username.js");
const appNotifications = require("./appNotifications.js");
const notify = require("./notifications.js");

function publicSummary(user) {
    return {
        id: String(user._id),
        username: user.username || "",
        name: user.name || ""
    };
}

async function findUser(rawUsername) {
    // The same sanitiser the signup path uses, so lookups and stored handles
    // can never disagree about dots/case.
    const handle = usernameUtil.sanitize(String(rawUsername || ""));
    if (!handle) return null;
    // telegram fields are selected because the push below needs them.
    return User.findOne({ username: handle }).select("username name telegram telegramChatId");
}

async function relationship(viewerId, targetId) {
    if (!viewerId || !targetId) return { state: "none" };
    if (String(viewerId) === String(targetId)) return { state: "self" };

    const row = await Friendship.findOne({ key: Friendship.keyFor(viewerId, targetId) }).lean();
    if (!row) return { state: "none" };

    if (row.status === "accepted") {
        return {
            state: "friends",
            friendshipId: String(row._id),
            since: row.respondedAt || row.createdAt
        };
    }

    return {
        state: String(row.requester) === String(viewerId) ? "outgoing" : "incoming",
        friendshipId: String(row._id),
        requestedAt: row.createdAt
    };
}

async function sendRequest(viewer, rawUsername) {
    const target = await findUser(rawUsername);
    if (!target) return { error: "not-found" };
    if (String(target._id) === String(viewer._id)) return { error: "self" };

    const key = Friendship.keyFor(viewer._id, target._id);
    const existing = await Friendship.findOne({ key });
    if (existing) {
        if (existing.status === "accepted") return { error: "already-friends" };
        if (String(existing.requester) === String(viewer._id)) return { error: "already-requested" };
        return { error: "incoming-exists", friendshipId: String(existing._id) };
    }

    let friendship;
    try {
        friendship = await Friendship.create({
            key,
            requester: viewer._id,
            recipient: target._id
        });
    } catch (err) {
        // Lost a race with a simultaneous request in the other direction.
        if (err && err.code === 11000) return { error: "already-requested" };
        throw err;
    }

    await appNotifications.push({
        userId: target._id,
        type: "friend_request",
        actor: viewer,
        title: "New friend request",
        body: `${viewer.username || "Someone"} sent you a friend request.`,
        link: `/u/${viewer.username || ""}`,
        data: { friendshipId: String(friendship._id) }
    });

    // A push, not a broadcast: only the recipient, and only when they have
    // connected Telegram. A failure must never fail the request itself.
    notify.safeDeliver(
        target,
        `<b>Hasanath</b> — Friend request\n\n`
        + `${notify.escapeHtml(viewer.username || "Someone")} sent you a friend request.\n`
        + `Open: /u/${viewer.username || ""}`
    ).catch(() => {});

    return { friendship };
}

async function respond(viewer, friendshipId, action) {
    if (!friendshipId || (action !== "accept" && action !== "decline")) {
        return { error: "invalid" };
    }

    const friendship = await Friendship.findOne({
        _id: friendshipId,
        recipient: viewer._id,
        status: "pending"
    });
    if (!friendship) return { error: "not-found" };

    if (action === "decline") {
        await friendship.deleteOne();
        await appNotifications.removeRelated(viewer._id, {
            type: "friend_request",
            "data.friendshipId": String(friendship._id)
        });
        return { ok: true, declined: true };
    }

    friendship.status = "accepted";
    friendship.respondedAt = new Date();
    await friendship.save();

    // The request is resolved; its row in the recipient's centre would only
    // offer buttons that can no longer do anything.
    await appNotifications.removeRelated(viewer._id, {
        type: "friend_request",
        "data.friendshipId": String(friendship._id)
    });

    const requester = await User.findById(friendship.requester).select("username name");
    if (requester) {
        await appNotifications.push({
            userId: requester._id,
            type: "friend_accepted",
            actor: viewer,
            title: "Friend request accepted",
            body: `${viewer.username || "Someone"} accepted your friend request.`,
            link: `/u/${viewer.username || ""}`,
            data: { friendshipId: String(friendship._id) }
        });
    }

    return {
        ok: true,
        friendship,
        friend: requester ? publicSummary(requester) : null
    };
}

async function listFriends(userId) {
    if (!userId) return [];
    const rows = await Friendship.find({
        status: "accepted",
        $or: [{ requester: userId }, { recipient: userId }]
    }).sort({ respondedAt: -1, createdAt: -1 }).lean();

    if (!rows.length) return [];

    const otherIds = rows.map((row) => (
        String(row.requester) === String(userId) ? row.recipient : row.requester
    ));
    const users = await User.find({ _id: { $in: otherIds } }).select("username name").lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));

    return rows
        .map((row, index) => {
            const other = byId.get(String(otherIds[index]));
            if (!other) return null;
            return {
                ...publicSummary(other),
                since: row.respondedAt || row.createdAt
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.username.localeCompare(b.username));
}

async function pendingList(userId, field) {
    const filter = field === "recipient"
        ? { recipient: userId, status: "pending" }
        : { requester: userId, status: "pending" };

    const rows = await Friendship.find(filter).sort({ createdAt: -1 }).lean();
    if (!rows.length) return [];

    const otherIds = rows.map((row) => row[field === "recipient" ? "requester" : "recipient"]);
    const users = await User.find({ _id: { $in: otherIds } }).select("username name").lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));

    return rows
        .map((row, index) => {
            const other = byId.get(String(otherIds[index]));
            if (!other) return null;
            return {
                friendshipId: String(row._id),
                ...publicSummary(other),
                requestedAt: row.createdAt
            };
        })
        .filter(Boolean);
}

async function incomingRequests(userId) {
    return pendingList(userId, "recipient");
}

async function outgoingRequests(userId) {
    return pendingList(userId, "requester");
}

async function removeFriend(viewerId, rawUsername) {
    const target = await findUser(rawUsername);
    if (!target) return { error: "not-found" };

    const removed = await Friendship.findOneAndDelete({
        key: Friendship.keyFor(viewerId, target._id)
    });
    if (!removed) return { error: "not-found" };

    // Clear both sides' request rows: removing a friend or withdrawing a
    // pending request must not leave an actionable invite behind.
    await appNotifications.removeRelated(viewerId, {
        type: "friend_request",
        "data.friendshipId": String(removed._id)
    });
    await appNotifications.removeRelated(target._id, {
        type: "friend_request",
        "data.friendshipId": String(removed._id)
    });

    return { ok: true };
}

async function friendCount(userId) {
    if (!userId) return 0;
    return Friendship.countDocuments({
        status: "accepted",
        $or: [{ requester: userId }, { recipient: userId }]
    });
}

// People search for the "find friends" field. Usernames only, because that is
// the public handle; email addresses are never searchable.
async function search(viewerId, rawQuery, { limit = 8 } = {}) {
    const query = String(rawQuery || "").trim().toLowerCase();
    if (query.length < 2) return [];

    // Escaped so a typed "." cannot turn into a wildcard and match everyone.
    const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({
        _id: { $ne: viewerId },
        username: { $regex: safe, $options: "i" }
    }).select("username name").limit(limit).lean();

    if (!users.length) return [];

    const rows = await Friendship.find({
        key: { $in: users.map((user) => Friendship.keyFor(viewerId, user._id)) }
    }).lean();
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return users.map((user) => {
        const row = byKey.get(Friendship.keyFor(viewerId, user._id));
        let relation = "none";
        if (row) {
            if (row.status === "accepted") relation = "friends";
            else relation = String(row.requester) === String(viewerId) ? "outgoing" : "incoming";
        }
        return {
            ...publicSummary(user),
            relation,
            friendshipId: row ? String(row._id) : null
        };
    });
}

// "People you may know" for the friends tab. Friends of friends rank first
// (mutual count), then the newest accounts fill the row so a new user with no
// connections still sees someone. Anyone already a friend, or with a request
// pending in either direction, is left out - the row only ever offers a fresh
// Add.
async function suggestions(viewerId, { limit = 12 } = {}) {
    if (!viewerId) return [];

    const mine = await Friendship.find({
        $or: [{ requester: viewerId }, { recipient: viewerId }]
    }).select("requester recipient status").lean();

    const excluded = new Set([String(viewerId)]);
    const friendIds = [];
    for (const row of mine) {
        const other = String(row.requester) === String(viewerId)
            ? String(row.recipient)
            : String(row.requester);
        excluded.add(other);
        if (row.status === "accepted") friendIds.push(other);
    }
    const friendSet = new Set(friendIds);

    // One extra hop across accepted friendships gives each candidate a mutual
    // friend count without loading the whole graph.
    const mutuals = new Map();
    if (friendIds.length) {
        const secondHop = await Friendship.find({
            status: "accepted",
            $or: [{ requester: { $in: friendIds } }, { recipient: { $in: friendIds } }]
        }).select("requester recipient").lean();

        for (const row of secondHop) {
            for (const side of [row.requester, row.recipient]) {
                const id = String(side);
                if (friendSet.has(id) || excluded.has(id)) continue;
                mutuals.set(id, (mutuals.get(id) || 0) + 1);
            }
        }
    }

    const picked = [];
    if (mutuals.size) {
        const users = await User.find({ _id: { $in: [...mutuals.keys()] } })
            .select("username name").lean();
        users.sort((a, b) => (
            (mutuals.get(String(b._id)) || 0) - (mutuals.get(String(a._id)) || 0)
            || String(a.username).localeCompare(String(b.username))
        ));
        for (const user of users) {
            if (picked.length >= limit) break;
            picked.push({
                ...publicSummary(user),
                mutualCount: mutuals.get(String(user._id)) || 0
            });
            excluded.add(String(user._id));
        }
    }

    if (picked.length < limit) {
        // An ObjectId's hex form starts with its creation time, so descending
        // _id is newest-account order. No extra timestamp field needed.
        const users = await User.find({ _id: { $nin: [...excluded] } })
            .select("username name")
            .sort({ _id: -1 })
            .limit(limit - picked.length)
            .lean();
        for (const user of users) {
            picked.push({ ...publicSummary(user), mutualCount: 0 });
        }
    }

    return picked;
}

module.exports = {
    publicSummary,
    findUser,
    relationship,
    sendRequest,
    respond,
    listFriends,
    incomingRequests,
    outgoingRequests,
    removeFriend,
    friendCount,
    search,
    suggestions
};
