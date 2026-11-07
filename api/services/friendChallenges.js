// Challenges shared between friends, and the leaderboard they produce.
//
// A check-in is a dated history entry, not a counter. The streak is recomputed
// from the history after every change, so unchecking a day cannot leave a
// number that no longer matches the record - the same reason the personal
// challenge history stores dates.

const FriendChallenge = require("../models/FriendChallenge.js");
const User = require("../models/User.js");
const Friendship = require("../models/Friendship.js");
const appNotifications = require("./appNotifications.js");
const notify = require("./notifications.js");

const MAX_FRIENDS = 20;
const MAX_HISTORY = 730;

// The server's calendar day. The personal tracker already resolves "today" this
// way, so both streak systems agree on when a day ends.
function isoDay(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function shiftDay(key, days) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12);
    date.setDate(date.getDate() + days);
    return isoDay(date);
}

// A streak is the run ending today, or ending yesterday while today is still in
// progress, so an unfinished day does not read as a broken streak.
function computeStreak(history, today) {
    const days = new Set((history || []).filter(Boolean));
    let cursor = days.has(today) ? today : shiftDay(today, -1);
    if (!days.has(cursor)) return 0;

    let count = 0;
    while (days.has(cursor)) {
        count += 1;
        cursor = shiftDay(cursor, -1);
    }
    return count;
}

function displayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", {
        weekday: "long", month: "short", day: "2-digit", year: "numeric"
    });
}

// `doc` is expected to have creator and participants.user populated with at
// least `username`.
function present(doc, viewerId) {
    const raw = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
    const today = isoDay();
    const viewer = String(viewerId);

    const participants = (raw.participants || []).map((entry) => {
        const user = entry.user && entry.user._id ? entry.user : { _id: entry.user, username: "" };
        return {
            id: String(user._id),
            username: user.username || "",
            status: entry.status,
            currentStreak: Number(entry.currentStreak) || 0,
            maxStreak: Number(entry.maxStreak) || 0,
            checkedInToday: (entry.history || []).includes(today),
            lastUpdated: entry.lastUpdated || "",
            isYou: String(user._id) === viewer
        };
    });

    const you = participants.find((entry) => entry.isYou) || null;
    // Declined participants are hidden from everyone still in the challenge:
    // their answer is between them and the creator.
    const accepted = participants
        .filter((entry) => entry.status === "accepted")
        .sort((a, b) => (
            (b.currentStreak - a.currentStreak)
            || (b.maxStreak - a.maxStreak)
            || a.username.localeCompare(b.username)
        ));

    const creator = raw.creator && raw.creator._id
        ? raw.creator
        : { _id: raw.creator, username: "" };

    return {
        id: String(raw._id),
        name: raw.name || "",
        creator: { id: String(creator._id || ""), username: creator.username || "" },
        createdAt: raw.createdAt,
        me: you
            ? {
                status: you.status,
                currentStreak: you.currentStreak,
                maxStreak: you.maxStreak,
                checkedInToday: you.checkedInToday
            }
            : null,
        leaderboard: accepted.map((entry, index) => ({ ...entry, rank: index + 1 })),
        invited: participants
            .filter((entry) => entry.status === "pending")
            .map((entry) => ({ id: entry.id, username: entry.username, isYou: entry.isYou })),
        participantCount: accepted.length
    };
}

function populated(id) {
    return FriendChallenge.findById(id)
        .populate("creator", "username")
        .populate("participants.user", "username");
}

async function listChallenges(viewerId) {
    if (!viewerId) return [];
    const docs = await FriendChallenge.find({
        participants: {
            $elemMatch: { user: viewerId, status: { $in: ["pending", "accepted"] } }
        }
    })
        .populate("creator", "username")
        .populate("participants.user", "username")
        .sort({ createdAt: -1 });

    return docs.map((doc) => present(doc, viewerId));
}

async function createChallenge(viewer, { name, friends } = {}) {
    const cleanName = String(name || "").trim().slice(0, 80);
    if (!cleanName) return { error: "invalid-name" };

    const usernames = Array.from(new Set(
        (Array.isArray(friends) ? friends : [])
            .map((entry) => String(entry || "").trim().toLowerCase())
            .filter(Boolean)
    )).slice(0, MAX_FRIENDS);

    if (!usernames.length) return { error: "no-friends" };

    // Only accepted friends can be invited, and that is re-checked here: the
    // browser's friend list is convenience, not authority.
    const users = await User.find({ username: { $in: usernames } })
        .select("username name telegram telegramChatId")
        .lean();
    const keys = users.map((user) => Friendship.keyFor(viewer._id, user._id));
    const acceptedRows = await Friendship.find({ status: "accepted", key: { $in: keys } })
        .select("key")
        .lean();
    const friendKeys = new Set(acceptedRows.map((row) => row.key));
    const byUsername = new Map(users.map((user) => [user.username, user]));

    const invited = [];
    for (const username of usernames) {
        const user = byUsername.get(username);
        if (!user) continue;
        if (String(user._id) === String(viewer._id)) continue;
        if (!friendKeys.has(Friendship.keyFor(viewer._id, user._id))) continue;
        invited.push(user);
    }
    if (!invited.length) return { error: "no-friends" };

    const challenge = await FriendChallenge.create({
        name: cleanName,
        creator: viewer._id,
        participants: [
            { user: viewer._id, status: "accepted", respondedAt: new Date() },
            ...invited.map((user) => ({ user: user._id, status: "pending" }))
        ]
    });

    for (const user of invited) {
        await appNotifications.push({
            userId: user._id,
            type: "challenge_invite",
            actor: viewer,
            title: "Challenge invitation",
            body: `${viewer.username || "Someone"} invited you to "${cleanName}".`,
            link: "/challenges",
            data: { challengeId: String(challenge._id), challengeName: cleanName }
        });

        notify.safeDeliver(
            user,
            `<b>Hasanath</b> — Challenge invitation\n\n`
            + `${notify.escapeHtml(viewer.username || "Someone")} invited you to `
            + `<b>${notify.escapeHtml(cleanName)}</b>.\nOpen Hasanath to accept.`
        ).catch(() => {});
    }

    const doc = await populated(challenge._id);
    return { challenge: present(doc, viewer._id) };
}

async function respond(viewer, challengeId, action) {
    if (action !== "accept" && action !== "decline") return { error: "invalid-action" };

    const challenge = await FriendChallenge.findOne({
        _id: challengeId,
        participants: { $elemMatch: { user: viewer._id, status: "pending" } }
    });
    if (!challenge) return { error: "not-found" };

    const participant = challenge.participants.find(
        (entry) => String(entry.user) === String(viewer._id)
    );
    participant.status = action === "accept" ? "accepted" : "declined";
    participant.respondedAt = new Date();
    await challenge.save();

    // The invitation row is answered; leaving it would keep dead buttons.
    await appNotifications.removeRelated(viewer._id, {
        type: "challenge_invite",
        "data.challengeId": String(challenge._id)
    });

    if (String(challenge.creator) !== String(viewer._id)) {
        await appNotifications.push({
            userId: challenge.creator,
            type: action === "accept" ? "challenge_accepted" : "challenge_declined",
            actor: viewer,
            title: action === "accept" ? "Challenge accepted" : "Challenge declined",
            body: `${viewer.username || "Someone"} ${action === "accept" ? "joined" : "declined"} "${challenge.name}".`,
            link: "/challenges",
            data: { challengeId: String(challenge._id), challengeName: challenge.name }
        });
    }

    if (action === "decline") return { ok: true, declined: true };

    const doc = await populated(challenge._id);
    return { ok: true, challenge: present(doc, viewer._id) };
}

async function toggleCheckin(viewer, challengeId, { date } = {}) {
    const challenge = await FriendChallenge.findOne({
        _id: challengeId,
        participants: { $elemMatch: { user: viewer._id, status: "accepted" } }
    });
    if (!challenge) return { error: "not-found" };

    const today = isoDay();
    const key = String(date || today);
    // Today only. A shared leaderboard has to measure the same day for everyone,
    // and a client clock must not be able to backfill a streak.
    if (key !== today) return { error: "invalid-date" };

    const participant = challenge.participants.find(
        (entry) => String(entry.user) === String(viewer._id)
    );
    const history = Array.from(participant.history || []).filter(Boolean);
    const checkedIn = !history.includes(key);
    participant.history = checkedIn
        ? [key, ...history.filter((entry) => entry !== key)].slice(0, MAX_HISTORY)
        : history.filter((entry) => entry !== key);

    const streak = computeStreak(participant.history, today);
    participant.currentStreak = streak;
    participant.maxStreak = Math.max(Number(participant.maxStreak) || 0, streak);
    participant.lastUpdated = displayLabel(key);
    await challenge.save();

    const doc = await populated(challenge._id);
    return { ok: true, checkedIn, challenge: present(doc, viewer._id) };
}

// The creator removes the whole challenge; anyone else just leaves it. Their
// streak history goes with them, because the card is the record.
async function removeOrLeave(viewer, challengeId) {
    const challenge = await FriendChallenge.findOne({
        _id: challengeId,
        "participants.user": viewer._id
    });
    if (!challenge) return { error: "not-found" };

    await appNotifications.removeRelated(viewer._id, {
        type: "challenge_invite",
        "data.challengeId": String(challenge._id)
    });

    if (String(challenge.creator) === String(viewer._id)) {
        await FriendChallenge.deleteOne({ _id: challenge._id });
        return { ok: true, deleted: true };
    }

    challenge.participants = challenge.participants.filter(
        (entry) => String(entry.user) !== String(viewer._id)
    );
    await challenge.save();
    return { ok: true, left: true };
}

module.exports = {
    isoDay,
    computeStreak,
    present,
    listChallenges,
    createChallenge,
    respond,
    toggleCheckin,
    removeOrLeave
};
