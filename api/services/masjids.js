// Masjids near a place, from two sources that are asked together and merged.
//
// 1. masjidnear.me: a masjid directory with good coverage in India, including
//    small neighbourhood masjids, each with a Google Maps place id. Its
//    developer page (https://api.masjidnear.me) invites developers to read its
//    database. That page documents /v1/masjids/search?lat=..&lng=..&rad=..,
//    which was not answering when this was written (November 2026), so the
//    address its own site uses is called instead: /v1/masjids/{lat}/{lng}/
//    {radius}/{n}. If the documented form starts working, fetchDirectory() is
//    the one place to change.
//    It is still someone else's free service, so it is asked rarely (answers
//    are kept for 12 hours per area), never relied on (if it is slow or gone,
//    the page still works from the second source), and can be switched off
//    without a code change (MASJIDNEAR_API=off).
//
// 2. OpenStreetMap: a free, community-maintained map of the world, read
//    through its Overpass service. No key and no bill, but a masjid appears
//    only if someone has added it to the map.
//
// Both are shared services, so results are cached in memory by map cell and
// requests carry a contact address.

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];
const USER_AGENT = "Hasanath/1.0 (https://hasanath.app; support@hasanath.app)";
const REQUEST_TIMEOUT_MS = 9000;

// The directory. MASJIDNEAR_API may hold another base address, or "off".
const MASJIDNEAR_BASE = String(process.env.MASJIDNEAR_API || "https://api.masjidnear.me/v1").replace(/\/+$/, "");
const MASJIDNEAR_ENABLED = MASJIDNEAR_BASE.toLowerCase() !== "off";
const MASJIDNEAR_TIMEOUT_MS = 8000;
// The last path segment the directory's own site sends with every request.
const MASJIDNEAR_PAGE = 12;

// The distances the page may ask for, in metres. Anything else falls back to
// the default, so the cache cannot be filled with arbitrary sizes.
const RADII = [2000, 5000, 10000];
const DEFAULT_RADIUS = 5000;
const MAX_RADIUS = RADII[RADII.length - 1];
const MAX_RESULTS = 120;

// One cache entry per map cell (three decimal places: about 110 m). Each holds
// every masjid within the largest radius of the cell's centre, plus a margin
// so a point anywhere in the cell is still fully covered.
const CELL_MARGIN_M = 200;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();

function toRadians(deg) { return (deg * Math.PI) / 180; }

// Distance between two points on the earth, in metres.
function distanceBetween(lat1, lng1, lat2, lng2) {
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validCoordinates(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
        !(lat === 0 && lng === 0);
}

function radiusOf(value) {
    const asked = Number(value);
    return RADII.includes(asked) ? asked : DEFAULT_RADIUS;
}

function overpassQuery(lat, lng, radius) {
    const around = "(around:" + radius + "," + lat + "," + lng + ")";
    return "[out:json][timeout:20];" +
        "nwr[\"amenity\"=\"place_of_worship\"][\"religion\"=\"muslim\"]" + around + ";" +
        "out center tags 200;";
}

// The map's own name for the place, preferring the local name, then English.
function nameOf(tags) {
    const name = tags.name || tags["name:en"] || tags["official_name"] || tags["name:ar"] || tags["name:ur"] || "";
    return String(name).trim().slice(0, 120);
}

function addressOf(tags) {
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const area = tags["addr:suburb"] || tags["addr:neighbourhood"] || tags["addr:city"] || tags["addr:district"] || "";
    const parts = [street, area].map((part) => String(part || "").trim()).filter(Boolean);
    const full = tags["addr:full"] ? String(tags["addr:full"]).trim() : "";
    return (parts.length ? parts.join(", ") : full).slice(0, 160);
}

// Turn Overpass's elements into plain places. A building mapped as an outline
// arrives with a "center"; a point arrives with its own coordinates.
function placesFrom(elements) {
    const places = [];
    for (const el of Array.isArray(elements) ? elements : []) {
        const lat = Number(el.lat !== undefined ? el.lat : el.center && el.center.lat);
        const lng = Number(el.lon !== undefined ? el.lon : el.center && el.center.lon);
        if (!validCoordinates(lat, lng)) continue;
        const tags = el.tags || {};
        places.push({
            id: String(el.type || "n") + String(el.id || ""),
            name: nameOf(tags),
            address: addressOf(tags),
            phone: String(tags.phone || tags["contact:phone"] || "").trim().slice(0, 40),
            latitude: lat,
            longitude: lng
        });
    }
    return places;
}

async function fetchOverpass(query) {
    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
                body: "data=" + encodeURIComponent(query),
                signal: controller.signal
            });
            if (!response.ok) throw new Error("overpass " + response.status);
            const data = await response.json();
            return data.elements || [];
        } catch (err) {
            lastError = err;      // try the next mirror
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError || new Error("overpass unavailable");
}

// "PRMR+H27, Venkatesh nagar, Hosur" -> "Venkatesh nagar, Hosur". The leading
// plus code is a map reference, not something a person reads as an address.
function readableAddress(text) {
    return String(text || "").replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4},?\s*/i, "").trim().slice(0, 160);
}

// Turn the directory's records into the same plain places as placesFrom().
// Coordinates arrive as [longitude, latitude]. Entries its own users have
// flagged as not a masjid are left out.
function placesFromDirectory(records) {
    const places = [];
    for (const record of Array.isArray(records) ? records : []) {
        if (!record || record.notMasjid === true) continue;
        const point = record.masjidLocation && record.masjidLocation.coordinates;
        const lng = Number(point && point[0]);
        const lat = Number(point && point[1]);
        if (!validCoordinates(lat, lng)) continue;
        const address = record.masjidAddress || {};
        const timings = record.masjidTimings || {};
        places.push({
            id: "d" + String(record._id || lat + "," + lng),
            name: String(record.masjidName || "").trim().slice(0, 120),
            address: readableAddress(address.description),
            phone: String(address.phone || "").trim().slice(0, 40),
            placeId: String(address.googlePlaceId || "").trim().slice(0, 120),
            jumuah: String(timings.jumah || "").trim().slice(0, 20),
            latitude: lat,
            longitude: lng
        });
    }
    return places;
}

async function fetchDirectory(lat, lng, radius) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MASJIDNEAR_TIMEOUT_MS);
    try {
        const url = MASJIDNEAR_BASE + "/masjids/" + lat + "/" + lng + "/" + radius + "/" + MASJIDNEAR_PAGE;
        const response = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": USER_AGENT }, signal: controller.signal });
        if (!response.ok) throw new Error("directory " + response.status);
        return placesFromDirectory(await response.json());
    } finally {
        clearTimeout(timer);
    }
}

// The directory answers with at most about twenty masjids, the ones nearest
// the point asked about, however large the distance asked for. One question
// from the centre is therefore enough for 2 km, but for 5 km and 10 km it
// would return the same twenty. So a wider search asks from several points
// spread over the area, each for its own neighbourhood, and the answers are
// put together.
//
//   2 km:  the centre
//   5 km:  the centre, and four points 3 km out (north, east, south, west)
//   10 km: those, and four more 7.5 km out on the diagonals, with the first
//          ring moved to 4 km
//
// Each point's answer is remembered on its own, so two people a few streets
// apart share most of them.
const SAMPLE_RADIUS_M = 3500;

function offsetPoint(lat, lng, metres, bearingDeg) {
    const bearing = toRadians(bearingDeg);
    const dLat = (metres * Math.cos(bearing)) / 111320;
    const dLng = (metres * Math.sin(bearing)) / (111320 * Math.cos(toRadians(lat)));
    return { lat: lat + dLat, lng: lng + dLng };
}

function samplePoints(lat, lng, within) {
    const points = [{ lat, lng, radius: Math.min(within, SAMPLE_RADIUS_M) }];
    if (within <= 2000) return points;
    const ring = (metres, bearings) => bearings.forEach((bearing) => {
        points.push({ ...offsetPoint(lat, lng, metres, bearing), radius: SAMPLE_RADIUS_M });
    });
    if (within <= 5000) {
        ring(3000, [0, 90, 180, 270]);
    } else {
        ring(4000, [0, 90, 180, 270]);
        ring(7500, [45, 135, 225, 315]);
    }
    return points;
}

// The directory's answer for one point, from memory when fresh. A failure is
// remembered for a few minutes, so a directory that is down is not asked again
// on every page view.
const DIRECTORY_FAIL_TTL_MS = 5 * 60 * 1000;
const directoryCache = new Map();

async function directoryAt(lat, lng, radius) {
    const cell = cellOf(lat, lng);
    const key = cell.lat + "," + cell.lng + "," + radius;
    const hit = directoryCache.get(key);
    if (hit && Date.now() - hit.at < (hit.failed ? DIRECTORY_FAIL_TTL_MS : CACHE_TTL_MS)) return hit;

    const entry = { at: Date.now(), places: [], failed: false };
    try {
        entry.places = await fetchDirectory(cell.lat, cell.lng, radius + CELL_MARGIN_M);
    } catch (err) {
        entry.failed = true;
        console.error("masjids: directory unavailable -", err.message);
    }
    if (directoryCache.size >= CACHE_MAX * 4) directoryCache.delete(directoryCache.keys().next().value);
    directoryCache.set(key, entry);
    return entry;
}

// Every masjid the directory knows within `within` metres, gathered from the
// sample points. The centre is asked first: if the directory is down there is
// no point asking it eight more times. The rest are asked three at a time, to
// be a light guest.
async function directoryNear(lat, lng, within) {
    if (!MASJIDNEAR_ENABLED) return [];
    const points = samplePoints(lat, lng, within);
    const centre = await directoryAt(points[0].lat, points[0].lng, points[0].radius);
    if (centre.failed) return [];

    const found = new Map(centre.places.map((place) => [place.id, place]));
    const rest = points.slice(1);
    for (let i = 0; i < rest.length; i += 3) {
        const answers = await Promise.all(rest.slice(i, i + 3).map((point) => directoryAt(point.lat, point.lng, point.radius)));
        for (const answer of answers) {
            for (const place of answer.places) if (!found.has(place.id)) found.set(place.id, place);
        }
    }
    return Array.from(found.values());
}

function cellOf(lat, lng) {
    const round = (value) => Math.round(value * 1000) / 1000;
    return { lat: round(lat), lng: round(lng) };
}

// Every masjid around the cell that contains (lat, lng), from memory when fresh.
async function placesNear(lat, lng) {
    const cell = cellOf(lat, lng);
    const key = cell.lat + "," + cell.lng;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

    const elements = await fetchOverpass(overpassQuery(cell.lat, cell.lng, MAX_RADIUS + CELL_MARGIN_M));
    const places = placesFrom(elements);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);   // drop the oldest
    cache.set(key, { at: Date.now(), places });
    return places;
}

// The same building often arrives more than once: from both sources, or on the
// map as both a point and an outline. Two entries within 45 m of each other,
// or with the same name within 80 m, are one masjid. The list is walked
// nearest first with directory entries ahead of map entries at equal distance,
// and the first of each group is kept, borrowing what the other knows (a name,
// an address, a phone number) where it has none.
function withoutDuplicates(sorted) {
    const kept = [];
    for (const place of sorted) {
        const twin = kept.find((other) => {
            const gap = distanceBetween(place.latitude, place.longitude, other.latitude, other.longitude);
            const sameName = place.name && other.name && place.name.toLowerCase() === other.name.toLowerCase();
            return gap < 45 || (sameName && gap < 80);
        });
        if (!twin) { kept.push({ ...place }); continue; }
        if (!twin.name && place.name) twin.name = place.name;
        if (!twin.address && place.address) twin.address = place.address;
        if (!twin.phone && place.phone) twin.phone = place.phone;
        if (!twin.placeId && place.placeId) twin.placeId = place.placeId;
        if (!twin.jumuah && place.jumuah) twin.jumuah = place.jumuah;
    }
    return kept;
}

// Masjids within `radius` metres of (lat, lng), nearest first, from both
// sources. Either may fail without failing the search; only when the map
// service fails and the directory has nothing is the error passed on.
async function nearby(lat, lng, radius) {
    const within = radiusOf(radius);
    const [fromDirectory, fromMap] = await Promise.all([
        directoryNear(lat, lng, within),
        placesNear(lat, lng).catch((err) => ({ error: err }))
    ]);
    if (fromMap.error && !fromDirectory.length) throw fromMap.error;

    const measure = (place) => ({ ...place, distance: Math.round(distanceBetween(lat, lng, place.latitude, place.longitude)) });
    const merged = fromDirectory.map(measure)
        .concat((fromMap.error ? [] : fromMap).map(measure))
        .filter((place) => place.distance <= within)
        .sort((a, b) => a.distance - b.distance || (a.placeId ? -1 : 1));
    return withoutDuplicates(merged).slice(0, MAX_RESULTS);
}

module.exports = {
    RADII,
    DEFAULT_RADIUS,
    validCoordinates,
    radiusOf,
    nearby,
    // Exposed for tests.
    _placesFrom: placesFrom,
    _placesFromDirectory: placesFromDirectory,
    _samplePoints: samplePoints,
    _withoutDuplicates: withoutDuplicates,
    _distanceBetween: distanceBetween,
    _reset() { cache.clear(); directoryCache.clear(); }
};
