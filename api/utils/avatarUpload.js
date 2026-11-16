// Multipart parsing for the profile-photo route.
//
// Memory storage on purpose: the client already crops and re-encodes to a
// 512px JPEG, so there is no large file to spool to disk, and Vercel's
// filesystem is read-only anyway. The 4MB ceiling matches Vercel's own request
// body limit rather than being the first place an upload dies.

const multer = require("multer");

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter(req, file, cb) {
        if (ALLOWED.has(String(file.mimetype || "").toLowerCase())) return cb(null, true);
        const err = new Error("invalid-type");
        err.code = "INVALID_TYPE";
        cb(err);
    }
});

// Express middleware so the route reads like every other one. Multer's errors
// become the short codes the account page already translates, instead of
// escaping to the generic 500 handler.
function singleAvatar(req, res, next) {
    upload.single("file")(req, res, (err) => {
        if (!err) return next();
        if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "too-large" });
        if (err.code === "INVALID_TYPE") return res.status(400).json({ error: "invalid-type" });
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: "invalid-upload" });
        }
        return next(err);
    });
}

module.exports = { singleAvatar, MAX_BYTES, ALLOWED };
