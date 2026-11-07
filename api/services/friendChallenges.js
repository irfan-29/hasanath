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
// A check-in can be logged for today or any of the six days before it. That is
// long enough to recover a forgotten evening, short enough that a shared
// leaderboard still measures the week everyone is actually living in.
const BACKFILL_DAYS = 7;

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

function laterDay(a, b) {
    return a > b ? a : b;
}

function isRealDay(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// The days a check-in may name: never before joining, never before the rolling
// week, never the future.
function checkinWindow(joinedOn, today) {
    return {
        start: laterDay(joinedOn, shiftDay(today, -(BACKFILL_DAYS - 1))),
        end: today
    };
}

// Yesterday through the start of the window, oldest first, for the client's
// "missed a day" strip. Today has its own check-in button.
function recentDays(participant, today) {
    const history = new Set(participant.history || []);
    const { start } = checkinWindow(participant.joinedOn, today);
    const days = [];
    let cursor = shiftDay(today, -1);
    while (cursor >= start) {
        days.push({ key: cursor, checked: history.has(cursor) });
        cursor = shiftDay(cursor, -1);
    }
    return days.reverse();
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
        const joinedOn = entry.respondedAt
            ? isoDay(new Date(entry.respondedAt))
            : isoDay(raw.createdAt ? new Date(raw.createdAt) : new Date());
        return {
            id: String(user._id),
            username: user.username || "",
            status: entry.status,
            currentStreak: Number(entry.currentStreak) || 0,
            maxStreak: Number(entry.maxStreak) || 0,
            checkedInToday: (entry.history || []).includes(today),
            lastUpdated: entry.lastUpdated || "",
            joinedOn,
            history: (entry.history || []).filter(Boolean),
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
                checkedInToday: you.checkedInToday,
                // Only your own history leaves the server; the leaderboard below
                // strips it so nobody can read a friend's private days.
                history: you.history,
                recentDays: recentDays(you, today)
            }
            : null,
        leaderboard: accepted.map(({ history, joinedOn, ...entry }, index) => ({
            ...entry,
            rank: index + 1
        })),
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
    if (!isRealDay(key)) return { error: "invalid-date" };

    const participant = challenge.participants.find(
        (entry) => String(entry.user) === String(viewer._id)
    );
    // Dates are validated against the server's day, so a client clock cannot
    // open the future or rewrite an old week. Backfilling is allowed only back
    // to the day this person joined and inside the rolling window.
    const joinedOn = participant.respondedAt
        ? isoDay(new Date(participant.respondedAt))
        : isoDay(challenge.createdAt ? new Date(challenge.createdAt) : new Date());
    const range = checkinWindow(joinedOn, today);
    if (key < range.start || key > range.end) return { error: "invalid-date" };

    const history = Array.from(participant.history || []).filter(Boolean);
    const checkedIn = !history.includes(key);
    participant.history = checkedIn
        ? Array.from(new Set([key, ...history])).sort((a, b) => b.localeCompare(a)).slice(0, MAX_HISTORY)
        : history.filter((entry) => entry !== key);

    const streak = computeStreak(participant.history, today);
    participant.currentStreak = streak;
    participant.maxStreak = Math.max(Number(participant.maxStreak) || 0, streak);
    participant.lastUpdated = displayLabel(key);
    await challenge.save();

    const doc = await populated(challenge._id);
    return { ok: true, checkedIn, challenge: present(doc, viewer._id) };
}

// Only the creator edits a challenge. Adding a friend who accepted after the
// challenge started is the main reason to edit: participants are copied into
// the document at creation, so a new friendship does not join by itself.
async function updateChallenge(viewer, challengeId, { name, friends } = {}) {
    const challenge = await FriendChallenge.findOne({
        _id: challengeId,
        creator: viewer._id
    });
    if (!challenge) return { error: "not-found" };

    if (name !== undefined) {
        const cleanName = String(name || "").trim().slice(0, 80);
        if (!cleanName) return { error: "invalid-name" };
        challenge.name = cleanName;
    }

    const usernames = Array.from(new Set(
        (Array.isArray(friends) ? friends : [])
            .map((entry) => String(entry || "").trim().toLowerCase())
            .filter(Boolean)
    )).slice(0, MAX_FRIENDS);

    // Only new people can be invited: re-sending an invitation to someone
    // already in the challenge (including a decline) would duplicate the row or
    // reopen an answer they already gave.
    const existing = new Set(challenge.participants.map((entry) => String(entry.user)));
    const remaining = Math.max(0, MAX_FRIENDS - challenge.participants.length);

    const users = usernames.length
        ? await User.find({ username: { $in: usernames } })
            .select("username name telegram telegramChatId")
            .lean()
        : [];
    const keys = users.map((user) => Friendship.keyFor(viewer._id, user._id));
    const acceptedRows = keys.length
        ? await Friendship.find({ status: "accepted", key: { $in: keys } }).select("key").lean()
        : [];
    const friendKeys = new Set(acceptedRows.map((row) => row.key));
    const byUsername = new Map(users.map((user) => [user.username, user]));

    const invited = [];
    for (const username of usernames) {
        if (invited.length >= remaining) break;
        const user = byUsername.get(username);
        if (!user) continue;
        if (String(user._id) === String(viewer._id)) continue;
        if (existing.has(String(user._id))) continue;
        if (!friendKeys.has(Friendship.keyFor(viewer._id, user._id))) continue;
        invited.push(user);
        existing.add(String(user._id));
    }

    for (const user of invited) {
        challenge.participants.push({ user: user._id, status: "pending" });
    }
    await challenge.save();

    for (const user of invited) {
        await appNotifications.push({
            userId: user._id,
            type: "challenge_invite",
            actor: viewer,
            title: "Challenge invitation",
            body: `${viewer.username || "Someone"} invited you to "${challenge.name}".`,
            link: "/challenges",
            data: { challengeId: String(challenge._id), challengeName: challenge.name }
        });

        notify.safeDeliver(
            user,
            `<b>Hasanath</b> — Challenge invitation\n\n`
            + `${notify.escapeHtml(viewer.username || "Someone")} invited you to `
            + `<b>${notify.escapeHtml(challenge.name)}</b>.\nOpen Hasanath to accept.`
        ).catch(() => {});
    }

    const doc = await populated(challenge._id);
    return {
        challenge: present(doc, viewer._id),
        invited: invited.map((user) => user.username)
    };
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
    checkinWindow,
    recentDays,
    present,
    listChallenges,
    createChallenge,
    respond,
    updateChallenge,
    toggleCheckin,
    removeOrLeave
};
