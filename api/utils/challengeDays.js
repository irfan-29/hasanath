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

// Yesterday through the start of the window, oldest first, for the client's
// "catch up on the week" strip. Today has its own check-in button.
function recentDays(participant, today) {
    const history = new Set(participant.history || []);
    const { start } = checkinWindow(today);
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

module.exports = {
    BACKFILL_DAYS,
    isoDay,
    shiftDay,
    computeStreak,
    bestRunFrom,
    isRealDay,
    checkinWindow,
    recentDays,
    displayLabel
};
