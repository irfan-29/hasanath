// Masjids near a place, from OpenStreetMap.
//
// OpenStreetMap is a free, community-maintained map of the world. Its Overpass
// service answers questions like "places of worship tagged as Muslim within
// 5 km of this point" without an API key or a bill, which is why it is used
// here rather than a paid places API. The trade-off is coverage: a masjid
// appears only if someone has added it to the map.
//
// Overpass is a shared, donated service, so this module is careful with it:
// results are kept in memory by map cell, one request serves every radius the
// page offers, and requests carry a contact address as its usage policy asks.

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];
const USER_AGENT = "Hasanath/1.0 (https://hasanath.app; support@hasanath.app)";
const REQUEST_TIMEOUT_MS = 9000;

// The distances the page may ask for, in metres. Anything else falls back to
// the default, so the cache cannot be filled with arbitrary sizes.
const RADII = [2000, 5000, 10000];
const DEFAULT_RADIUS = 5000;
const MAX_RADIUS = RADII[RADII.length - 1];
const MAX_RESULTS = 40;

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

// The same building is sometimes on the map twice (as a point and as an
// outline). Keep the first of any two with the same name within 60 m, and of
// any two unnamed ones within 25 m.
function withoutDuplicates(sorted) {
    const kept = [];
    for (const place of sorted) {
        const twin = kept.some((other) => {
            const gap = distanceBetween(place.latitude, place.longitude, other.latitude, other.longitude);
            const sameName = place.name && other.name && place.name.toLowerCase() === other.name.toLowerCase();
            return sameName ? gap < 60 : (!place.name || !other.name) && gap < 25;
        });
        if (!twin) kept.push(place);
    }
    return kept;
}

// Masjids within `radius` metres of (lat, lng), nearest first.
async function nearby(lat, lng, radius) {
    const within = radiusOf(radius);
    const places = await placesNear(lat, lng);
    const measured = places
        .map((place) => ({ ...place, distance: Math.round(distanceBetween(lat, lng, place.latitude, place.longitude)) }))
        .filter((place) => place.distance <= within)
        .sort((a, b) => a.distance - b.distance);
    return withoutDuplicates(measured).slice(0, MAX_RESULTS);
}

module.exports = {
    RADII,
    DEFAULT_RADIUS,
    validCoordinates,
    radiusOf,
    nearby,
    // Exposed for tests.
    _placesFrom: placesFrom,
    _withoutDuplicates: withoutDuplicates,
    _distanceBetween: distanceBetween,
    _reset() { cache.clear(); }
};
