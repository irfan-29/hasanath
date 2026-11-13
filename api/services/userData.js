// Single place that answers "where does this user's data live right now?".
//
// Every read and write in the app goes through here, so route handlers stay
// unaware of whether the visitor is signed in. Signed-in users hit MongoDB;
// anonymous visitors hit the signed cookie, and their work merges into the
// account when they log in.

const { readGuest, writeGuest, clearGuest } = require("../utils/guestStore.js");
const {
  isoDay,
  computeStreak,
  bestRunFrom,
  isRealDay,
  recentDays,
  validateChallengeDates,
  validateChallengeEnd,
  challengeStatus,
  challengeWindow,
  daysRemaining
} = require("../utils/challengeDays.js");
// Imported rather than passed in: clearAudioProgress is the first function in
// this file that needs to reach the collection directly. Every other write goes
// through the already-loaded req.user and .save(), but an $unset cannot - which
// is the point of using it. models/User.js depends only on mongoose and
// passport-local-mongoose, so there is no cycle back into here.
const User = require("../models/User.js");
const prayerTimes = require("./prayerTimes.js");

// --- Settings ---------------------------------------------------------------

const SETTINGS_FIELDS = [
  "defaultHome",
  "location",
  "locationLat",
  "locationLng",
  "locationTimezone",
  "calculationMethod",
  "asrSchool",
  "timeFormat",
  "favoriteReciter",
  "favoriteFont",
  "favoriteEdition",
  "primaryTranslation",
  "theme",
  "accent",
  "audioProgress",
  // Interface typography: the app-wide font family plus a scale for regular
  // (Latin and translated) text and a separate scale for the Arabic mushaf
  // text. Percent values, 100 meaning exactly today's sizes.
  "appFont",
  "appFontSize",
  "quranFontSize"
];

// Kept in sync with DEFAULT_TRANSLATION in api/app.js: a guest (or a brand-new
// account) still gets a readable translation instead of a blank page.
const DEFAULT_EDITION = "eng-abdullahyusufal:English:Abdullah Yusuf Ali";

// The accent palettes the stylesheet defines. Stored as an id so the stored
// preference is a name, not a colour: changing a palette later updates every
// account wearing it, and an unknown id simply falls back to the default.
const ACCENT_IDS = ["green", "blue", "violet", "gold", "rose", "ocean"];

function defaults() {
  return {
    defaultHome: "quran",
    // No location default: a new account has not picked a place, and the
    // timings page invites the reader to choose one instead of guessing.
    // The coordinate fields stay absent until a place is actually picked. A
    // default there would make every legacy "Salem" record look like it has
    // Coimbatore's coordinates, which resolveLocation would then prefer over
    // the legacy name map.
    calculationMethod: prayerTimes.DEFAULT_METHOD,
    asrSchool: 0,
    timeFormat: prayerTimes.DEFAULT_TIME_FORMAT,
    favoriteReciter: 1,
    favoriteFont: "QPC-Hafs",
    theme: "light",
    accent: "green",
    favoriteEdition: [DEFAULT_EDITION],
    primaryTranslation: DEFAULT_EDITION,
    appFont: "default",
    appFontSize: 100,
    quranFontSize: 100
  };
}

async function getSettings(req) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    const stored = req.user.settings ? req.user.toObject().settings : null;
    return { ...defaults(), ...(stored || {}) };
  }
  return { ...defaults(), ...(readGuest(req).settings || {}) };
}

// Merge-and-set so a partial update never wipes unrelated preferences.
async function updateSettings(req, patch) {
  const clean = {};
  for (const key of SETTINGS_FIELDS) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }

  // The text-size scales are stored as whole percents and clamped to the same
  // range the settings page offers, so a hand-built request cannot set a 2px
  // root font (nothing readable) either by accident or on purpose. A value
  // that does not survive clamping is dropped outright rather than written as
  // undefined into settings.
  for (const key of ["appFontSize", "quranFontSize"]) {
    if (clean[key] !== undefined) {
      const n = Math.round(Number(clean[key]));
      if (Number.isFinite(n)) clean[key] = Math.min(150, Math.max(80, n));
      else delete clean[key];
    }
  }
  if (clean.appFont !== undefined) clean.appFont = String(clean.appFont).slice(0, 24);
  // Accent is an id from a closed set, not free text: an unknown value is
  // dropped rather than written, so a hand-built request cannot leave the
  // account pointing at a palette that does not exist.
  if (clean.accent !== undefined && !ACCENT_IDS.includes(String(clean.accent))) {
    delete clean.accent;
  }

  // Prayer-time settings. Coordinates are what the times are computed from, so
  // they are bounded to real latitudes/longitudes and written as a pair - a
  // half-updated pair would point at the wrong place. The method must be one
  // Aladhan actually publishes; the Asr school is only ever 0 or 1.
  if (clean.locationLat !== undefined || clean.locationLng !== undefined) {
    // null/"" means "not picked yet" and must clear the pair rather than
    // becoming 0,0 - Number(null) is 0.
    const rawLat = clean.locationLat;
    const rawLng = clean.locationLng;
    const present = (value) => value !== undefined && value !== null && value !== "";
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (present(rawLat) && present(rawLng)
        && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      clean.locationLat = lat;
      clean.locationLng = lng;
    } else {
      delete clean.locationLat;
      delete clean.locationLng;
    }
  }
  if (clean.location !== undefined) {
    clean.location = String(clean.location).slice(0, 120).trim();
  }
  if (clean.locationTimezone !== undefined) {
    const zone = String(clean.locationTimezone).slice(0, 64);
    // Shape check only; an unknown zone simply falls back in prayerTimes.
    clean.locationTimezone = /^[A-Za-z0-9_+\/-]+$/.test(zone) ? zone : "";
  }
  if (clean.calculationMethod !== undefined) {
    const method = Number(clean.calculationMethod);
    if (prayerTimes.METHOD_IDS.includes(method)) clean.calculationMethod = method;
    else delete clean.calculationMethod;
  }
  if (clean.asrSchool !== undefined) {
    clean.asrSchool = prayerTimes.schoolId(clean.asrSchool);
  }
  if (clean.timeFormat !== undefined) {
    const format = String(clean.timeFormat);
    if (prayerTimes.TIME_FORMAT_IDS.includes(format)) clean.timeFormat = format;
    else delete clean.timeFormat;
  }

  if (!Object.keys(clean).length) return getSettings(req);

  if (req.isAuthenticated && req.isAuthenticated()) {
    const user = req.user;
    user.settings = user.settings || {};
    for (const [key, value] of Object.entries(clean)) user.settings[key] = value;
    await user.save();
  } else {
    const guest = readGuest(req);
    guest.settings = { ...(guest.settings || {}), ...clean };
    writeGuest(req, res_of(req), guest);
  }
  return getSettings(req);
}

// The guest store needs `res` to set the cookie, but callers only hand us
// `req`. Cache it once per request in middleware instead of threading it
// through every signature.
function res_of(req) {
  if (!req._salahRes) throw new Error("guest cookie: response not attached");
  return req._salahRes;
}

function attachResponse(req, res, next) {
  req._salahRes = res;
  next();
}

// --- Last read surahs -------------------------------------------------------

async function getLastReadSurahs(req) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.lastReadSurahs || [];
  }
  return readGuest(req).lastReadSurahs || [];
}

async function recordSurahRead(req, surahNo) {
  const value = String(surahNo);
  if (req.isAuthenticated && req.isAuthenticated()) {
    req.user.pushLastReadSurah(value);
    await req.user.save();
    return req.user.lastReadSurahs;
  }
  const guest = readGuest(req);
  guest.lastReadSurahs = [value, ...guest.lastReadSurahs.filter((n) => n !== value)].slice(0, 5);
  writeGuest(req, res_of(req), guest);
  return guest.lastReadSurahs;
}

// Playback progress only. This deliberately does NOT touch lastReadSurahs:
// that list records that a surah was opened in the reader, so listening to a
// surah from the audio tab must not push it into "Continue reading". The
// reader's POST /api/quran/surah route is what calls recordSurahRead. When this
// saved both, resuming an unfinished recitation would silently rewrite the
// reading history - which is why the two writes are separate again. One save
// per call is back, and a remote-Mongo 400ms is still cheaper than letting an
// audio action rewrite what the user read.
async function recordAudioProgress(req, { surahNo, surahName, time }) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        req.user.settings = req.user.settings || {};
        req.user.settings.audioProgress = { surahNo, surahName, time };
        await req.user.save();
        return;
    }
    const guest = readGuest(req);
    guest.settings = { ...(guest.settings || {}), audioProgress: { surahNo, surahName, time } };
    writeGuest(req, res_of(req), guest);
}

// The counterpart to the write above, and the half that was missing.
//
// Closing the player used to clear only in-memory React state. The `pause()`
// that close() performs then fired the same handler that saves the position, so
// dismissing the bar wrote the track straight back and the next page load
// restored it. Without a way to clear it server-side the bar could never stay
// dismissed.
//
// It deliberately does NOT touch lastReadSurahs. That list records that a surah
// was opened, which stays true after the player is closed - only the playback
// cursor is being forgotten.
async function clearAudioProgress(req) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        // Explicit $unset rather than assigning undefined and calling save().
        // audioProgress is a nested schema path, not Mixed, so change tracking
        // is *supposed* to emit a $unset for it - but whether assigning
        // `undefined` marks that path dirty is version-dependent behaviour, and
        // the failure mode is silent: save() resolves ok and the field remains.
        // An explicit operator cannot get that wrong.
        await User.updateOne(
            { _id: req.user._id },
            { $unset: { "settings.audioProgress": "" } }
        );
        // Keep the in-memory doc consistent so a later read in the same request
        // does not resurrect the cleared value.
        if (req.user.settings) delete req.user.settings.audioProgress;
        return;
    }
    const guest = readGuest(req);
    if (!guest.settings || !guest.settings.audioProgress) return;
    // Spread omits the key entirely rather than writing `audioProgress:
    // undefined` into the cookie, which would serialise as a null and be
    // truthy enough for the restore path to try to use it.
    const { audioProgress, ...rest } = guest.settings;
    guest.settings = rest;
    writeGuest(req, res_of(req), guest);
}

// --- Challenges -------------------------------------------------------------
//
// A challenge history is capped rather than made unbounded: seven hundred
// dated check-ins is enough for weekly reports, and the embedded user document
// cannot be allowed to grow without limit.
const MAX_CHALLENGE_HISTORY = 730;

// Serialise a personal challenge the same way a shared one is serialised: the
// raw record plus the window state and the two fields the check-in card
// derives from its history.
function presentChallenge(challenge, today) {
  const raw = challenge && typeof challenge.toObject === "function"
    ? challenge.toObject()
    : { ...challenge };
  const history = (raw.history || []).filter(Boolean);
  const startDate = raw.startDate || "";
  const endDate = raw.endDate || "";
  const status = challengeStatus(today, startDate, endDate);
  // A finished challenge keeps the streak it ended with. Anchoring at today
  // would read zero as soon as the window closed.
  const anchor = status === "ended" && endDate ? endDate : today;
  // Only dated challenges recompute from history. A legacy row has no start
  // date; giving it an end date later must not replace its saved counter with
  // zero from an empty history. Undated rows keep the counter they stored.
  const dated = Boolean(startDate);
  return {
    ...raw,
    startDate,
    endDate,
    status,
    daysRemaining: daysRemaining(today, endDate),
    checkedInToday: history.includes(today),
    currentStreak: raw.oneTime
      ? 0
      : (dated ? computeStreak(history, anchor) : Number(raw.currentStreak) || 0),
    recentDays: raw.oneTime ? [] : recentDays({ history }, today, { startDate, endDate })
  };
}

// A personal challenge's `_id` is an ObjectId, whose hex form starts with the
// creation timestamp, so it doubles as a creation sort key with no extra field.
// Shared challenges sort on `createdAt`; this keeps both tabs newest-first.
function newestFirst(challenges) {
  const list = Array.from(challenges || []);
  if (!list.some((challenge) => challenge && challenge._id)) return list;
  return list
    .map((challenge, index) => ({
      challenge,
      index,
      key: challenge && challenge._id ? String(challenge._id) : ""
    }))
    .sort((a, b) => {
      if (a.key && b.key) return b.key.localeCompare(a.key);
      if (a.key) return -1;
      if (b.key) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.challenge);
}

function presentChallenges(challenges, today) {
  return newestFirst(challenges).map((challenge) => presentChallenge(challenge, today));
}

async function listChallenges(req) {
  const challenges = (req.isAuthenticated && req.isAuthenticated())
    ? (req.user.challenges || [])
    : (readGuest(req).challenges || []);
  return presentChallenges(challenges, isoDay());
}

async function addChallenge(req, challenge, opts = {}) {
  const oneTime = Boolean(opts.oneTime);
  // One-time tasks are a checkbox, not a streak, so they never get a window.
  let window = { startDate: "", endDate: "" };
  if (!oneTime) {
    const validated = validateChallengeDates(opts, isoDay());
    if (validated.error) return { error: validated.error };
    window = validated;
  }
  const record = {
    challenge,
    currentStreak: 0,
    maxStreak: 0,
    oneTime,
    completed: false,
    history: [],
    ...window
  };
  // Insert at the head so the list is newest-first even before a reload, and so
  // a guest cookie (whose entries have no id to sort on) keeps that order.
  if (req.isAuthenticated && req.isAuthenticated()) {
    req.user.challenges.unshift(record);
    await req.user.save();
    return req.user.challenges;
  }
  const guest = readGuest(req);
  guest.challenges.unshift(record);
  writeGuest(req, res_of(req), guest);
  return guest.challenges;
}

// Renaming and re-windowing share one path. The start date is deliberately not
// editable: check-ins already sit inside it, so moving it would leave history
// outside the challenge's own dates. The end date can move forward, or be
// cleared to make the challenge open-ended.
async function updateChallenge(req, id, changes = {}) {
  const authenticated = Boolean(req.isAuthenticated && req.isAuthenticated());
  // Hold the guest document for the whole call so the write persists the same
  // object that the edit mutated.
  const guest = authenticated ? null : readGuest(req);
  const source = authenticated ? req.user.challenges : (guest.challenges || []);
  const item = authenticated
    ? source.id(id)
    : source.find((entry) => String(entry._id) === String(id));
  if (!item) return { error: "not-found" };

  const name = changes.challenge === undefined ? undefined : String(changes.challenge || "").trim();
  if (name !== undefined && !name) return { error: "invalid" };

  let endDate;
  if (changes.endDate !== undefined || changes.noEnd) {
    // A one-time task is a checkbox, not a window.
    if (item.oneTime) return { error: "not-supported" };
    const checked = validateChallengeEnd({
      startDate: item.startDate,
      endDate: changes.endDate,
      noEnd: Boolean(changes.noEnd)
    }, isoDay());
    if (checked.error) return { error: checked.error };
    endDate = checked.endDate;
  }

  if (name !== undefined) item.challenge = name;
  if (endDate !== undefined) item.endDate = endDate;

  if (authenticated) await req.user.save();
  else writeGuest(req, res_of(req), guest);
  return { challenge: presentChallenge(item, isoDay()) };
}

async function deleteChallenge(req, id) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    const item = req.user.challenges.id(id);
    if (!item) return false;
    item.deleteOne();
    await req.user.save();
    return true;
  }
  const guest = readGuest(req);
  const before = guest.challenges.length;
  guest.challenges = guest.challenges.filter((c) => String(c._id) !== String(id));
  if (guest.challenges.length === before) return false;
  writeGuest(req, res_of(req), guest);
  return true;
}

// Keep one dated record per challenge/day in a newest-first list. A date that
// arrives twice means the same day was re-checked/re-unchecked, so replace it
// rather than letting the chart double-count it.
function mergeChallengeHistory(challenge, completed, dateKey) {
    if (!dateKey) return;
    const history = Array.from(challenge.history || []).filter(Boolean);
    const filtered = history.filter((date) => date !== dateKey);
    challenge.history = completed
        ? [dateKey, ...filtered].slice(0, MAX_CHALLENGE_HISTORY)
        : filtered;
}

// Apply a day's checkboxes: increment the ticked ones, reset the rest.
// `historyDate` (ISO YYYY-MM-DD, optional) records the completion on the
// challenge itself, so the stats page can plot actual days later without
// having to infer them from a streak number.
async function applyStreakUpdate(req, { completedIds, historyDate, reopenId }) {
  const ids = (completedIds || []).map(String);
  const reopen = reopenId ? String(reopenId) : null;

  if (req.isAuthenticated && req.isAuthenticated()) {
    for (const challenge of req.user.challenges) {
      const cid = String(challenge._id);
      if (challenge.oneTime) {
        if (reopen && reopen === cid) {
          challenge.completed = false;
          mergeChallengeHistory(challenge, false, historyDate);
          continue;
        }
        if (ids.includes(cid)) {
          challenge.completed = true;
          mergeChallengeHistory(challenge, true, historyDate);
        }
        challenge.currentStreak = 0;
        challenge.maxStreak = 0;
        continue;
      }
      const done = ids.includes(cid);
      if (done) {
        challenge.currentStreak = (challenge.currentStreak || 0) + 1;
        if (challenge.currentStreak > (challenge.maxStreak || 0)) {
          challenge.maxStreak = challenge.currentStreak;
        }
      } else {
        challenge.currentStreak = 0;
      }
      mergeChallengeHistory(challenge, done, historyDate);
    }
    await req.user.save();
    return req.user.challenges;
  }

  const guest = readGuest(req);
  for (const challenge of guest.challenges) {
    const cid = String(challenge._id);
    if (challenge.oneTime) {
      if (reopen && reopen === cid) {
        challenge.completed = false;
        mergeChallengeHistory(challenge, false, historyDate);
        continue;
      }
      if (ids.includes(cid)) {
        challenge.completed = true;
        mergeChallengeHistory(challenge, true, historyDate);
      }
      challenge.currentStreak = 0;
      challenge.maxStreak = 0;
      continue;
    }
    const done = ids.includes(cid);
    if (done) {
      challenge.currentStreak = (challenge.currentStreak || 0) + 1;
      if (challenge.currentStreak > (challenge.maxStreak || 0)) {
        challenge.maxStreak = challenge.currentStreak;
      }
    } else {
      challenge.currentStreak = 0;
    }
    mergeChallengeHistory(challenge, done, historyDate);
  }
  writeGuest(req, res_of(req), guest);
  return guest.challenges;
}

// Toggle one personal challenge's check-in for a single day. Unlike
// applyStreakUpdate this never touches the other challenges and never rewrites
// a day outside the rolling week: the streak is recomputed from the dated
// history, which is the same rule the shared challenges follow.
function toggleChallengeOnDay(challenge, key, today) {
  if (challenge.oneTime) {
    challenge.completed = !challenge.completed;
    // A one-time task keeps at most the day it was completed. Reopening clears
    // it, so re-completing later cannot leave a stale past date behind.
    challenge.history = challenge.completed ? [today] : [];
    return { ok: true, checkedIn: Boolean(challenge.completed) };
  }

  const history = Array.from(challenge.history || []).filter(Boolean);
  const checkedIn = !history.includes(key);
  challenge.history = checkedIn
    ? Array.from(new Set([key, ...history]))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_CHALLENGE_HISTORY)
    : history.filter((entry) => entry !== key);

  // A finished challenge can still be repaired inside the last week, and its
  // streak must be read at the end date rather than at today.
  const status = challengeStatus(today, challenge.startDate, challenge.endDate);
  const anchor = status === "ended" && challenge.endDate ? challenge.endDate : today;
  challenge.currentStreak = computeStreak(challenge.history, anchor);
  const best = bestRunFrom(challenge.history);
  challenge.maxStreak = best.best;
  return { ok: true, checkedIn };
}

async function toggleChallengeCheckin(req, id, { date } = {}) {
  const today = isoDay();
  const key = String(date || today);
  if (!isRealDay(key)) return { error: "invalid-date" };

  if (req.isAuthenticated && req.isAuthenticated()) {
    const challenge = req.user.challenges.id(id);
    if (!challenge) return { error: "not-found" };
    if (!challenge.oneTime) {
      const range = challengeWindow(today, challenge.startDate, challenge.endDate);
      if (key < range.start || key > range.end) return { error: "invalid-date" };
    }
    const result = toggleChallengeOnDay(challenge, key, today);
    await req.user.save();
    return {
      ...result,
      challenge: presentChallenge(challenge, today),
      challenges: presentChallenges(req.user.challenges, today)
    };
  }

  const guest = readGuest(req);
  const challenge = (guest.challenges || [])
    .find((entry) => String(entry._id) === String(id));
  if (!challenge) return { error: "not-found" };
  if (!challenge.oneTime) {
    const range = challengeWindow(today, challenge.startDate, challenge.endDate);
    if (key < range.start || key > range.end) return { error: "invalid-date" };
  }
  const result = toggleChallengeOnDay(challenge, key, today);
  writeGuest(req, res_of(req), guest);
  return {
    ...result,
    challenge: presentChallenge(challenge, today),
    challenges: presentChallenges(guest.challenges, today)
  };
}

// --- Charity ---------------------------------------------------------------
//
// A charity has a recurring target and a list of dated donations. The target
// is evaluated against the current window (day / week / month / year) so "£50 a
// month" means the current calendar month, while lifetime totals stay visible.
const CHARITY_PERIODS = ["daily", "weekly", "monthly", "yearly"];

const CHARITY_PERIOD_LABELS = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
  yearly: "This year"
};

// Boundaries are local dates, matching the ISO keys salah log and donations
// use. `midnight` forces start/end comparisons into separate day boundary
// rather than relying on the caller having passed a parseable date string.
function shiftDate(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function periodBounds(period, referenceDate) {
  const date = referenceDate ? new Date(referenceDate) : new Date();
  const start = new Date(date.getTime());
  const end = new Date(date.getTime());

  if (period === "daily") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (period === "weekly") {
    // ISO week: Monday is the first day. The +6 so a Sunday stays in the week
    // that ends on Sunday, which reads more familiarly than week-of-year.
    const weekday = (date.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);
    start.setHours(0, 0, 0, 0);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (period === "monthly") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    // yearly
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end, startKey: isoDateKey(start), endKey: isoDateKey(end) };
}

function presentCharity(charity, referenceDateKey) {
  const raw = charity && typeof charity.toObject === "function"
    ? charity.toObject()
    : { ...charity };
  const target = Number(raw.targetAmount) || 0;
  const donations = Array.isArray(raw.donations) ? raw.donations : [];
  const reference = referenceDateKey || isoDateKey(new Date());
  const bounds = periodBounds(raw.period || "monthly", `${reference}T12:00:00`);

  const donated = donations
    .filter((donation) => {
      const date = String(donation.date || "");
      return date >= bounds.startKey && date <= bounds.endKey;
    })
    .reduce((total, donation) => total + (Number(donation.amount) || 0), 0);

  const lifetime = donations.reduce((total, donation) => total + (Number(donation.amount) || 0), 0);
  const remaining = Math.max(target - donated, 0);
  const percent = target > 0 ? Math.min((donated / target) * 100, 100) : 0;

  return {
    id: String(raw._id || ""),
    name: raw.name || "",
    period: raw.period || "monthly",
    periodLabel: CHARITY_PERIOD_LABELS[raw.period] || "",
    targetAmount: target,
    donations: donations.map((donation) => ({
      amount: Number(donation.amount) || 0,
      date: donation.date,
      note: donation.note || ""
    })),
    lifeTime: {
      given: lifetime,
      donations: donations.length
    },
    // Current window progress. `periodStart` / `periodEnd` are exposed so the
    // client can render an unambiguous "today / this week..." label.
    progress: {
      donated,
      remaining,
      percent,
      target,
      start: bounds.startKey,
      end: bounds.endKey,
      reference: CHARITY_PERIOD_LABELS[raw.period] || ""
    }
  };
}

async function listCharities(req, referenceDateKey) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return [];
  // Newest first, like challenges and friends' challenges, so adding a target
  // puts it at the top instead of the bottom.
  return newestFirst(req.user.charities || [])
    .map((charity) => presentCharity(charity, referenceDateKey));
}

async function addCharity(req, { name, targetAmount, period }) {
  const cleanName = String(name || "").trim();
  const amount = Number(targetAmount);
  const cleanPeriod = String(period || "monthly").trim().toLowerCase();

  if (!cleanName || !Number.isFinite(amount) || amount <= 0
      || !CHARITY_PERIODS.includes(cleanPeriod)) {
    return null;
  }
  if (!req.isAuthenticated || !req.isAuthenticated()) return { loginRequired: true };

  const existing = (req.user.charities || []).find((charity) => charity.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) return { duplicate: true };

  req.user.charities.unshift({
    name: cleanName,
    targetAmount: amount,
    period: cleanPeriod,
    donations: []
  });
  await req.user.save();
  const added = req.user.charities[0];
  return presentCharity(added);
}

// Only the editable fields can change; donation rows are never overwritten by
// a client-supplied `donations` array. That would let someone silently rewrite
// their giving history.
async function updateCharity(req, id, patch = {}) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return null;
  const charity = req.user.charities.id(id);
  if (!charity) return null;

  if (patch.name !== undefined) {
    const cleanName = String(patch.name || "").trim();
    if (!cleanName) return { invalid: true };
    charity.name = cleanName;
  }
  if (patch.targetAmount !== undefined) {
    const amount = Number(patch.targetAmount);
    if (!Number.isFinite(amount) || amount <= 0) return { invalid: true };
    charity.targetAmount = amount;
  }
  if (patch.period !== undefined) {
    const cleanPeriod = String(patch.period || "").trim().toLowerCase();
    if (!CHARITY_PERIODS.includes(cleanPeriod)) return { invalid: true };
    charity.period = cleanPeriod;
  }

  await req.user.save();
  return presentCharity(charity);
}

async function deleteCharity(req, id) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return false;
  const charity = req.user.charities.id(id);
  if (!charity) return false;
  charity.deleteOne();
  await req.user.save();
  return true;
}

// A donation is just a dated amount against the charity's target. Note is
// optional. The returned object re-presents the charity with the same progress
// pipeline, so no route has to recalculate percentages on its own.
async function addDonation(req, id, { amount, date, note } = {}) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return null;

  const value = Number(amount);
  const isoDate = normaliseSalahDate(date);
  if (!Number.isFinite(value) || value <= 0 || !isoDate) return { invalid: true };

  const charity = req.user.charities.id(id);
  if (!charity) return { notFound: true };

  charity.donations.push({
    amount: value,
    date: isoDate,
    note: String(note || "").trim().slice(0, 180)
  });
  await req.user.save();
  return presentCharity(charity, isoDate);
}

// Edit a donation in place. The index is the position in the stored array,
// which is the order the client received it in; donations carry no ids of
// their own, so the position is the handle.
async function updateDonation(req, id, index, { amount, date, note } = {}) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return null;
  const charity = req.user.charities.id(id);
  if (!charity) return { notFound: true };

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= charity.donations.length) return { notFound: true };

  const value = Number(amount);
  const isoDate = normaliseSalahDate(date);
  if (!Number.isFinite(value) || value <= 0 || !isoDate) return { invalid: true };

  charity.donations[i].amount = value;
  charity.donations[i].date = isoDate;
  charity.donations[i].note = String(note || "").trim().slice(0, 180);
  await req.user.save();
  return presentCharity(charity, isoDate);
}

async function deleteDonation(req, id, index) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return null;
  const charity = req.user.charities.id(id);
  if (!charity) return { notFound: true };

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= charity.donations.length) return { notFound: true };

  charity.donations.splice(i, 1);
  await req.user.save();
  return presentCharity(charity);
}

// --- Salah log --------------------------------------------------------------

// Salah entries have been stored under two different date formats: the React
// client writes ISO (2026-10-17), while the original EJS page wrote the
// long-form label (Sunday, Oct 11, 2026). Both are still in users' logs.
//
// Anything that SELECTED entries by comparing against the long-form label
// therefore matched only the legacy rows and silently dropped every row the
// React app had written - the page looked empty while saving worked fine.
// Match on the ISO key, and keep accepting the legacy label so historical
// entries stay visible.
const SALAH_DATE_OPTS = {
  weekday: "long", month: "short", day: "2-digit", year: "numeric",
};

function isoDateKey(date) {
  // Local calendar day, not UTC: the server's own zone is what "today" means
  // here, and toISOString() would roll back across the date line.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function longDateLabel(date) {
  return date.toLocaleDateString("en-US", SALAH_DATE_OPTS);
}

// Resolves the ?date= query (or today) into both forms, so callers never have
// to think about which format a stored entry uses.
function resolveSalahDay(queryDate) {
  let date;
  if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
    date = new Date(`${queryDate}T12:00:00`);
    if (isNaN(date.getTime())) date = null;
  }
  const target = date || new Date();
  return {
    iso: isoDateKey(target),
    label: queryDate && !date ? null : longDateLabel(target),
    parsed: Boolean(date),
  };
}

function entriesForDay(entries, { iso, label }) {
  return (entries || []).filter(
    (e) => e.date === iso || (label && e.date === label)
  );
}

// Normalises an incoming date to ISO. Rejects anything else rather than storing
// a third format, which is how the two got out of hand in the first place.
function normaliseSalahDate(input) {
  const raw = String(input || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Accept the legacy long form on write, so an old client keeps working.
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return isoDateKey(parsed);
  return null;
}

async function listSalah(req) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.salahLog || [];
  }
  return readGuest(req).salahLog || [];
}

async function recordSalah(req, { date, name, value }) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    const existing = req.user.salahLog.find((e) => e.date === date && e.name === name);
    if (existing) {
      existing.value = value;
    } else {
      req.user.salahLog.push({ date, name, value });
    }
    await req.user.save();
    return req.user.salahLog;
  }
  const guest = readGuest(req);
  const existing = guest.salahLog.find((e) => e.date === date && e.name === name);
  if (existing) {
    existing.value = value;
  } else {
    guest.salahLog.push({ date, name, value });
  }
  writeGuest(req, res_of(req), guest);
  return guest.salahLog;
}

// --- Telegram ---------------------------------------------------------------

async function getTelegramChatId(req) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.telegramChatId || "";
  }
  return readGuest(req).telegramChatId || "";
}

async function setTelegramChatId(req, chatId) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    req.user.telegramChatId = chatId;
    await req.user.save();
    return;
  }
  const guest = readGuest(req);
  guest.telegramChatId = chatId;
  writeGuest(req, res_of(req), guest);
}

function clearGuestCookie(req, res) {
  clearGuest(req, res);
}

// Favourite ayahs are account-only. Unlike challenges or last-read, there is no
// guest equivalent: an anonymous reader has no durable store big enough for
// coordinates plus text, and a guest who signs in would find their stars gone
// with nothing to merge. The UI therefore prompts for a sign-in rather than
// offering a favourite that silently disappears.
function listFavourites(req) {
    if (!req.isAuthenticated || !req.isAuthenticated()) return [];
    return Array.from(req.user.favoriteAyahs || [])
        .map((f) => ({ surahNo: Number(f.surahNo), ayahNo: Number(f.ayahNo) }))
        .filter((f) => Number.isInteger(f.surahNo) && Number.isInteger(f.ayahNo));
}

async function toggleFavourite(req, { surahNo, ayahNo }) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return { ok: false, reason: "login-required", favorited: false };
    }
    const nowFavorited = req.user.toggleFavoriteAyah(surahNo, ayahNo);
    await req.user.save();
    return { ok: true, favorited: nowFavorited };
}

// Hadith bookmarks: same contract as toggleFavourite.
async function toggleHadithBookmark(req, { collection, number }) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
        return { ok: false, reason: "login-required", bookmarked: false };
    }
    const nowBookmarked = req.user.toggleHadithBookmark(collection, number);
    await req.user.save();
    return { ok: true, bookmarked: nowBookmarked };
}

module.exports = {
  attachResponse,
  getSettings,
  updateSettings,
  getLastReadSurahs,
  recordSurahRead,
  recordAudioProgress,
  clearAudioProgress,
  listChallenges,
  addChallenge,
  updateChallenge,
  deleteChallenge,
  applyStreakUpdate,
  toggleChallengeCheckin,
  listSalah,
  recordSalah,
  resolveSalahDay,
  entriesForDay,
  normaliseSalahDate,
  listCharities,
  addCharity,
  updateCharity,
  deleteCharity,
  updateDonation,
  deleteDonation,
  addDonation,
  CHARITY_PERIODS,
  CHARITY_PERIOD_LABELS,
  getTelegramChatId,
  setTelegramChatId,
  listFavourites,
  toggleFavourite,
  toggleHadithBookmark,
  clearGuestCookie,
  defaults
};
