// Prayer times for any place on earth.
//
// The page used to scrape IslamicFinder's widget, which only knew the five city
// ids hard-coded in api/app.js. Aladhan computes the times itself from
// coordinates and a calculation method, so the same code serves every city,
// every method, and the notification scheduler.
//
// Location search uses Open-Meteo's geocoder (no key, returns coordinates and
// IANA timezone). Both upstreams are cached through `cachedJsonOrNull`, so a
// repeat view for the same place, day and method never leaves the process.

const { cachedJsonOrNull } = require("../utils/quranCache.js");

// Aladhan method ids. Id 6 does not exist upstream; the rest are the standard
// published conventions. Kept in the order Aladhan documents them.
// `label` is the full published name shown in settings and the open menu;
// `short` is what the compact timings row has room for. Both live here so the
// two surfaces can never drift apart.
const METHODS = [
    { id: 0, label: "Shia Ithna-Ashari", short: "Shia Ithna-Ashari" },
    { id: 1, label: "University of Islamic Sciences, Karachi", short: "Karachi" },
    { id: 2, label: "Islamic Society of North America (ISNA)", short: "ISNA" },
    { id: 3, label: "Muslim World League (MWL)", short: "Muslim World League" },
    { id: 4, label: "Umm Al-Qura University, Makkah", short: "Umm Al-Qura" },
    { id: 5, label: "Egyptian General Authority of Survey", short: "Egyptian" },
    { id: 7, label: "Institute of Geophysics, University of Tehran", short: "Tehran" },
    { id: 8, label: "Gulf Region", short: "Gulf Region" },
    { id: 9, label: "Kuwait", short: "Kuwait" },
    { id: 10, label: "Qatar", short: "Qatar" },
    { id: 11, label: "Majlis Ugama Islam Singapura", short: "Singapore" },
    { id: 12, label: "Union des Organisations Islamiques de France", short: "France" },
    { id: 13, label: "Presidency of Religious Affairs, Turkey", short: "Turkey" },
    { id: 14, label: "Spiritual Administration of Muslims of Russia", short: "Russia" },
    { id: 15, label: "Moonsighting Committee", short: "Moonsighting" },
    { id: 16, label: "Dubai", short: "Dubai" },
    { id: 17, label: "Jabatan Kemajuan Islam Malaysia (JAKIM)", short: "Malaysia" },
    { id: 18, label: "Tunisia", short: "Tunisia" },
    { id: 19, label: "Algeria", short: "Algeria" },
    { id: 20, label: "Kementerian Agama Republik Indonesia", short: "Indonesia" },
    { id: 21, label: "Morocco", short: "Morocco" },
    { id: 22, label: "Comunidade Islâmica de Lisboa", short: "Lisbon" },
    { id: 23, label: "Ministry of Awqaf, Jordan", short: "Jordan" }
];
const METHOD_IDS = METHODS.map((entry) => entry.id);
// The Muslim World League convention. It is the most widely followed outside
// the countries that publish their own, so it is the least surprising starting
// point; the reader can still switch it on either settings surface.
const DEFAULT_METHOD = 3;

// 0 is the standard (Shafi, Maliki, Hanbali) shadow calculation; 1 is Hanafi.
const ASR_SCHOOLS = [
    { value: 0, label: "Standard (Shafi, Maliki, Hanbali)", short: "Standard" },
    { value: 1, label: "Hanafi", short: "Hanafi" }
];

// How a clock time is displayed. Stored as an id so the setting names the
// presentation, not a format string; 24-hour is the default because that is
// what the page has always shown.
const TIME_FORMATS = [
    { value: "24h", label: "24-hour", sample: "18:05" },
    { value: "12h", label: "12-hour", sample: "6:05 PM" }
];
const TIME_FORMAT_IDS = TIME_FORMATS.map((entry) => entry.value);
const DEFAULT_TIME_FORMAT = "24h";

// The five cities the old picker shipped. Their saved names still resolve
// without a geocoding request, so existing accounts do not have to re-pick.
// A new account has no place at all until the reader picks one, so no times
// are ever calculated for a city they never chose.
const LEGACY_LOCATIONS = {
    Coimbatore: { latitude: 11.0018, longitude: 76.9628, timezone: "Asia/Kolkata" },
    Hosur: { latitude: 12.7369, longitude: 77.6837, timezone: "Asia/Kolkata" },
    Salem: { latitude: 11.6643, longitude: 78.1462, timezone: "Asia/Kolkata" },
    Ramanathapuram: { latitude: 9.3639, longitude: 78.8392, timezone: "Asia/Kolkata" },
    Bengaluru: { latitude: 12.9716, longitude: 77.5946, timezone: "Asia/Kolkata" }
};

function methodId(value) {
    const id = Number(value);
    return METHOD_IDS.includes(id) ? id : DEFAULT_METHOD;
}

function schoolId(value) {
    return Number(value) === 1 ? 1 : 0;
}

function timeFormatId(value) {
    return TIME_FORMAT_IDS.includes(String(value)) ? String(value) : DEFAULT_TIME_FORMAT;
}

// Aladhan answers with 24-hour "HH:MM" (sometimes with a zone suffix). Keep
// that as the canonical value and only change the presentation here, so the
// same stored time can be shown either way and the cache never holds a
// formatted copy.
function formatClock(value, timeFormat) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
    if (!match) return String(value || "");
    const hours = Number(match[1]) % 24;
    const minutes = match[2];
    if (timeFormatId(timeFormat) !== "12h") {
        return `${String(hours).padStart(2, "0")}:${minutes}`;
    }
    const suffix = hours >= 12 ? "PM" : "AM";
    const display = hours % 12 === 0 ? 12 : hours % 12;
    return `${display}:${minutes} ${suffix}`;
}

function hasCoordinates(location = {}) {
    const rawLat = location.latitude;
    const rawLng = location.longitude;
    // null/"" is "not set", not the coordinate zero: Number(null) is 0, which
    // would otherwise put a reader with no saved place on Null Island.
    if (rawLat === null || rawLat === undefined || rawLat === ""
        || rawLng === null || rawLng === undefined || rawLng === "") {
        return false;
    }
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180;
}

// YYYY-MM-DD "today" in a place. A reader in Karachi opening the page at
// 00:30 must see that day, not the UTC one the server happens to be on.
function dateKeyInTimeZone(timeZone, date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat("en", {
            timeZone: timeZone || "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(date);
        const get = (type) => (parts.find((part) => part.type === type) || {}).value;
        const year = get("year");
        const month = get("month");
        const day = get("day");
        if (year && month && day) return `${year}-${month}-${day}`;
    } catch (err) {
        // Unknown IANA name - fall through to UTC.
    }
    return new Date().toISOString().slice(0, 10);
}

function isIsoDay(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

// Aladhan wants DD-MM-YYYY.
function aladhanDay(isoDay) {
    const [year, month, day] = isoDay.split("-");
    return `${day}-${month}-${year}`;
}

async function searchLocations(rawQuery, { limit = 6 } = {}) {
    const query = String(rawQuery || "").trim();
    if (query.length < 2) return [];

    const url = "https://geocoding-api.open-meteo.com/v1/search?name="
        + encodeURIComponent(query)
        + `&count=${limit}&language=en&format=json`;
    const data = await cachedJsonOrNull(url);
    const rows = (data && data.results) || [];

    return rows
        .map((row) => ({
            name: row.name || "",
            admin1: row.admin1 || "",
            country: row.country || "",
            // The one-line label the pickers show: "Salem, Tamil Nadu, India".
            label: [row.name, row.admin1, row.country].filter(Boolean).join(", "),
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            timezone: row.timezone || ""
        }))
        .filter((row) => hasCoordinates(row));
}

// Turns stored settings into coordinates. Coordinates win; then the five old
// city names; then a live lookup of whatever text was saved. Returns null when
// nothing has been chosen yet - the caller asks the reader for a place rather
// than inventing one.
async function resolveLocation(settings = {}) {
    const label = String(settings.location || "").trim();

    if (hasCoordinates({ latitude: settings.locationLat, longitude: settings.locationLng })) {
        return {
            label: label || "My location",
            latitude: Number(settings.locationLat),
            longitude: Number(settings.locationLng),
            timezone: settings.locationTimezone || ""
        };
    }

    if (LEGACY_LOCATIONS[label]) {
        return { label, ...LEGACY_LOCATIONS[label] };
    }

    if (label) {
        const found = await searchLocations(label, { limit: 1 });
        if (found.length) {
            return {
                label: found[0].label,
                latitude: found[0].latitude,
                longitude: found[0].longitude,
                timezone: found[0].timezone
            };
        }
    }

    return null;
}

function formatHijri(hijri) {
    if (!hijri) return "";
    const month = (hijri.month && (hijri.month.en || hijri.month.number)) || "";
    const parts = [hijri.day, month, hijri.year].filter(Boolean);
    if (!parts.length) return "";
    return `${parts.join(" ")}${hijri.year ? " AH" : ""}`;
}

// Fetches one day's times for a coordinate. Returns null rather than throwing
// when upstream is unavailable, so callers can show their own message.
async function fetchTimings({
    latitude,
    longitude,
    method,
    school,
    dateKey,
    timezone,
    timeFormat
}) {
    if (!hasCoordinates({ latitude, longitude })) return null;

    const day = isIsoDay(dateKey) ? dateKey : dateKeyInTimeZone(timezone);
    const format = timeFormatId(timeFormat);
    const url = "https://api.aladhan.com/v1/timings/"
        + aladhanDay(day)
        + `?latitude=${latitude}`
        + `&longitude=${longitude}`
        + `&method=${methodId(method)}`
        + `&school=${schoolId(school)}`;

    const payload = await cachedJsonOrNull(url);
    const data = payload && payload.data;
    if (!data || !data.timings) return null;

    const timings = data.timings;
    const order = [
        ["Fajr", timings.Fajr],
        ["Sunrise", timings.Sunrise],
        ["Dhuhr", timings.Dhuhr],
        ["Asr", timings.Asr],
        ["Maghrib", timings.Maghrib],
        ["Isha", timings.Isha]
    ];

    return {
        // Aladhan appends a zone abbreviation in some responses ("05:08 (IST)");
        // only the clock is ever displayed, in the reader's chosen convention.
        prayerTimes: order
            .filter(([, time]) => time)
            .map(([timeType, time]) => ({
                timeType,
                time: formatClock(time, format)
            })),
        // The ISO day these times belong to, so the client can keep its date
        // control in step with whichever day the server resolved.
        dateKey: day,
        date: (data.date && data.date.readable) || day,
        hijriDate: formatHijri(data.date && data.date.hijri),
        hijri: data.date && data.date.hijri
            ? {
                day: data.date.hijri.day,
                month: (data.date.hijri.month && data.date.hijri.month.en) || "",
                year: data.date.hijri.year
            }
            : null,
        timezone: (data.meta && data.meta.timezone) || timezone || "",
        methodName: (data.meta && data.meta.method && data.meta.method.name) || "",
        methodId: methodId(method),
        school: schoolId(school),
        timeFormat: format
    };
}

module.exports = {
    METHODS,
    METHOD_IDS,
    ASR_SCHOOLS,
    DEFAULT_METHOD,
    LEGACY_LOCATIONS,
    TIME_FORMATS,
    TIME_FORMAT_IDS,
    DEFAULT_TIME_FORMAT,
    methodId,
    schoolId,
    timeFormatId,
    formatClock,
    hasCoordinates,
    dateKeyInTimeZone,
    isIsoDay,
    searchLocations,
    resolveLocation,
    fetchTimings
};
