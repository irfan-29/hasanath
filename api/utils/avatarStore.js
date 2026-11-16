// Profile-photo storage on Vercel Blob.
//
// Firebase Storage now requires the Blaze plan just to create a bucket, so
// Blob is the free option that fits this deployment: Hobby includes 1GB of
// storage and 10GB of transfer a month, with no card. The token comes from a
// Blob store created in the Vercel project and is injected as
// BLOB_READ_WRITE_TOKEN. Without it the app still boots - isConfigured() is
// false, the upload route answers 503, and every avatar keeps the letter
// fallback.

const crypto = require("crypto");
const { put, del } = require("@vercel/blob");

const MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
};

function token() {
    return process.env.BLOB_READ_WRITE_TOKEN || "";
}

function isConfigured() {
    return Boolean(token());
}

function extensionFor(mimeType) {
    return MIME_EXTENSIONS[String(mimeType || "").toLowerCase()] || null;
}

// Upload one already-cropped square. The caller owns validation; this only
// rejects a type it has no extension for.
async function uploadAvatar({ buffer, mimetype, userId }) {
    const readWriteToken = token();
    if (!readWriteToken) return { error: "storage-not-configured" };
    if (!buffer || !buffer.length) return { error: "no-file" };

    const extension = extensionFor(mimetype);
    if (!extension) return { error: "invalid-type" };

    // A new path per upload rather than overwriting the old one: blob URLs are
    // cached for a year, so replacing the bytes in place would keep showing the
    // previous photo. addRandomSuffix makes the URL unique even if two uploads
    // land in the same millisecond.
    const pathname = `avatars/${String(userId)}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${extension}`;

    try {
        const blob = await put(pathname, buffer, {
            access: "public",
            contentType: mimetype,
            addRandomSuffix: true,
            cacheControlMaxAge: 60 * 60 * 24 * 365,
            token: readWriteToken
        });
        return { path: blob.pathname, url: blob.url };
    } catch (err) {
        console.error("avatarStore: upload failed:", err.message);
        return { error: "upload-failed" };
    }
}

// Best effort. A leftover blob costs a few kilobytes; failing the request that
// replaced it would be worse.
async function deleteAvatar(pathname) {
    if (!pathname) return;
    const readWriteToken = token();
    if (!readWriteToken) return;

    try {
        await del(pathname, { token: readWriteToken });
    } catch (err) {
        console.error("avatarStore: delete failed:", err.message);
    }
}

module.exports = {
    isConfigured,
    extensionFor,
    uploadAvatar,
    deleteAvatar
};
