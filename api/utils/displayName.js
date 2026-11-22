// Display names.
//
// `User.name` is the friendly name a person chooses for themselves. It is not
// the account's identity: `username` stays the public handle used in /u/<name>,
// and `email` stays the login. Everything that greets a person or labels their
// own content should use this helper instead of reading either field directly.
//
// A name is optional. Accounts created before the field existed, and people who
// have not chosen one, fall back to the username (then the email local-part) so
// a label is never blank.

const MAX_NAME_LENGTH = 50;

// Keep the stored value predictable: one line, no control characters, no runs
// of whitespace. Emoji and non-Latin scripts are left alone.
function cleanName(value) {
    return String(value == null ? "" : value)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_NAME_LENGTH);
}

// The name to show for a user document, a lean object, or null (a guest).
function displayNameFor(user) {
    if (!user) return "friend";

    const name = cleanName(user.name);
    if (name) return name;

    const username = String(user.username || "").trim();
    if (username) return username;

    const email = String(user.email || "").trim();
    if (email.includes("@")) return email.split("@")[0] || "friend";

    return "friend";
}

// Replace the admin-authored ${user} placeholder. Use a replacer function so a
// name containing "$&" or "$1" is inserted literally rather than treated as a
// replacement pattern.
function interpolateUser(text, user) {
    const raw = String(text == null ? "" : text);
    if (!raw.includes("${user}")) return raw;
    return raw.replace(/\$\{user\}/g, () => displayNameFor(user));
}

module.exports = {
    MAX_NAME_LENGTH,
    cleanName,
    displayNameFor,
    interpolateUser
};
