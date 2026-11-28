const mongoose = require("mongoose");

// Remembered answers for Masjids Nearby, shared by everyone.
//
// One document per area asked about: the key is the source, the map cell
// (latitude and longitude to three decimal places, about 110 m) and the
// distance. Two people in the same neighbourhood therefore share an entry, and
// someone who changes their location simply reads a different entry: there is
// nothing per-person to clear.
//
// MongoDB removes each document by itself when `expiresAt` passes, so the
// collection cannot grow without limit and a masjid added to the sources
// appears within the week.
const masjidCacheSchema = new mongoose.Schema({
    _id: String,
    places: { type: Array, default: [] },
    expiresAt: { type: Date, required: true }
}, { versionKey: false });

masjidCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("MasjidCache", masjidCacheSchema);
