// Calendar helpers shared by personal and friends' challenges.
//
// A check-in is a dated history entry, not a counter. Both systems recompute
// the streak from the history after every change, so unchecking a day cannot
// leave a number that no longer matches the record.
//
// The check-in window is deliberately rolling rather than tied to a join date:
// a person who starts using a challenge today still needs to repair the week
// they just lived.

// A check-in can be logged for today or any of the six days before it. That is
// long enough to recover a forgotten evening, short enough that a streak still
// measures the week everyone is actually living in.
const BACKFILL_DAYS = 7;

// The preset challenge lengths offered by both create forms. A custom window
// (an explicit end date) is the fourth option and is validated separately.
const PERIOD_DAYS = [10, 30, 90];

// A guard against a mistyped custom year producing a century-long card. Ten
// years is far beyond any habit this app tracks.
const MAX_CHALLENGE_DAYS = 3660;

// The server's calendar day, matching the personal tracker's day boundary.
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

/**
 * bestRunFrom(hist): continuous run (best, start, end) inside `hist`.
 *
 * Walks forward from the first day of each run, using the same YYYY-MM-DD
 * arithmetic as the streak so a run never depends on the host timezone.
 */
function bestRunFrom(hist) {
    const days = new Set((hist || []).filter(Boolean));
    let best = 0, start = null, end = null;
    for (const day of Array.from(days).sort()) {
        // Only open a run at its first day; every later day is walked below.
        if (days.has(shiftDay(day, -1))) continue;
        let length = 0, cursor = day, last = day;
        while (days.has(cursor)) {
            length += 1;
            last = cursor;
            cursor = shiftDay(cursor, 1);
        }
        if (length > best) { best = length; start = day; end = last; }
    }
    return { best, start, end };
}

function isRealDay(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// The days a check-in may name: never before the rolling week, never the
// future.
function checkinWindow(today) {
    return {
        start: shiftDay(today, -(BACKFILL_DAYS - 1)),
        end: today
    };
}

// Whole days from `startDate` to `endDate`, both ISO keys.
function daysBetween(startDate, endDate) {
    const start = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);
    return Math.round((end - start) / 86400000);
}

/**
 * validateChallengeDates({ startDate, period, endDate }, today)
 *
 * A challenge may start today, up to six days ago (the same days a check-in can
 * still repair), or any day in the future. The period is either one of
 * PERIOD_DAYS or "custom", in which case an explicit end date is required.
 * Returns { startDate, endDate } or { error }.
 */
function validateChallengeDates(input = {}, today = isoDay()) {
    const startDate = String(input.startDate || today);
    if (!isRealDay(startDate)) return { error: "invalid-start" };
    if (startDate < shiftDay(today, -(BACKFILL_DAYS - 1))) {
        return { error: "start-too-old" };
    }

    // An omitted period behaves like the old 30-day default, so a client that
    // has not been updated yet still creates a complete challenge.
    const period = String(input.period || (input.endDate ? "custom" : "30"));
    let endDate;

    if (period === "custom") {
        endDate = String(input.endDate || "");
        if (!isRealDay(endDate)) return { error: "invalid-end" };
        if (endDate < startDate) return { error: "end-before-start" };
    } else {
        const days = Number(period);
        if (!PERIOD_DAYS.includes(days)) return { error: "invalid-period" };
        endDate = shiftDay(startDate, days - 1);
    }

    if (daysBetween(startDate, endDate) > MAX_CHALLENGE_DAYS) {
        return { error: "period-too-long" };
    }
    return { startDate, endDate };
}

// Where a challenge is in its life today. An undated (legacy) challenge is
// always active, because it never promised a window.
function challengeStatus(today, startDate, endDate) {
    if (startDate && today < startDate) return "upcoming";
    if (endDate && today > endDate) return "ended";
    return "active";
}

// The days a check-in may name once the challenge window is applied: the
// rolling backfill week intersected with the challenge's own dates. When the
// two do not overlap (an upcoming challenge, or one that ended over a week ago)
// the returned range has start > end and every day is rejected.
function challengeWindow(today, startDate, endDate) {
    const rolling = checkinWindow(today);
    return {
        start: startDate && startDate > rolling.start ? startDate : rolling.start,
        end: endDate && endDate < rolling.end ? endDate : rolling.end
    };
}

// Whole challenge days left, counting today. Null when the challenge has no
// end date; 0 once it is over.
function daysRemaining(today, endDate) {
    if (!endDate) return null;
    if (today > endDate) return 0;
    return daysBetween(today, endDate) + 1;
}

// Yesterday through the start of the window, oldest first, for the client's
// "catch up on the week" strip. Today has its own check-in button. Days outside
// the challenge's own dates are omitted, so an upcoming challenge shows no
// strip and a finished one stops at its end date.
function recentDays(participant, today, { startDate, endDate } = {}) {
    const history = new Set(participant.history || []);
    const range = challengeWindow(today, startDate, endDate);
    const yesterday = shiftDay(today, -1);
    const cursor = endDate && endDate < yesterday ? endDate : yesterday;
    const days = [];
    let day = cursor;
    while (day >= range.start) {
        days.push({ key: day, checked: history.has(day) });
        day = shiftDay(day, -1);
    }
    return days.reverse();
}

function displayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", {
        weekday: "long", month: "short", day: "2-digit", year: "numeric"
    });
}

module.exports = {
    BACKFILL_DAYS,
    PERIOD_DAYS,
    MAX_CHALLENGE_DAYS,
    isoDay,
    shiftDay,
    daysBetween,
    computeStreak,
    bestRunFrom,
    isRealDay,
    validateChallengeDates,
    challengeStatus,
    challengeWindow,
    daysRemaining,
    checkinWindow,
    recentDays,
    displayLabel
};
