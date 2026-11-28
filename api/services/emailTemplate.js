// The one look every email from Hasanath shares.
//
// Every message the app sends is built here, so they all open the same way
// (the logo, a heading, "Assalamu alaikum,"), read the same way, and close the
// same way (who it is from and how to reach support). A new email should call
// compose() and supply only its own words; it should not write its own HTML.
// The rules are also written down for people and tools in AGENTS.md.
//
//   compose({
//     subject: "Your early access to Hasanath",
//     heading: "Your early access to Hasanath",   // optional; defaults to the subject
//     lines:   ["First paragraph.", "Second paragraph."],
//     code:    "345444",                           // optional: a code, shown large
//     button:  { label: "Create your account", url: "https://..." },   // optional
//     after:   ["A paragraph after the code or button."],              // optional
//     note:    "If you did not ask for this, you can ignore this email."  // optional, small print
//   })  ->  { subject, text, html }
//
// A paragraph is normally a plain string, which is escaped. Where a word needs
// emphasis, pass { text, html } instead: `text` for the plain-text version and
// `html` for the HTML one. Anything placed in `html` must already be safe:
// use escapeHtml() on any value that came from a person.

const SUPPORT_EMAIL = "support@hasanath.app";
const GREETING = "Assalamu alaikum,";

// Email programs cannot show SVG, and they fetch pictures from the web, so the
// logo is the PNG the website already serves.
const LOGO_PATH = "/icons/icon-192.png";

// Colours are written out, not taken from the site's stylesheet: an email
// carries its own styles. They are the brand teal and its darker shade.
const TEAL = "#0d9488";
const TEAL_DEEP = "#0f766e";
const INK = "#1f2937";
const MUTED = "#6b7280";

function siteUrl() {
    return String(process.env.FRONTEND_URL || "https://hasanath.app").replace(/\/+$/, "");
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const textOf = (line) => (line && typeof line === "object" ? String(line.text || "") : String(line || ""));
const htmlOf = (line) => (line && typeof line === "object" ? String(line.html || escapeHtml(line.text)) : escapeHtml(line));

function compose({ subject, heading, lines = [], code, button, after = [], note } = {}) {
    const title = heading || subject || "Hasanath";
    const site = siteUrl();

    // ---- plain text: for mail programs that show no HTML, and for previews
    const text = [GREETING, ""];
    lines.forEach((line) => text.push(textOf(line), ""));
    if (code) text.push(String(code), "");
    if (button && button.url) text.push(button.label + ":", button.url, "");
    after.forEach((line) => text.push(textOf(line), ""));
    if (note) text.push(textOf(note), "");
    text.push("Hasanath", SUPPORT_EMAIL);

    // ---- HTML
    const paragraph = (line) => '<p style="margin:0 0 14px">' + htmlOf(line) + "</p>";
    const html = [
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:' + INK + ';font-size:15px;line-height:1.6">',
        // The logo and name, as a link home. A table keeps them on one line in every mail program.
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>',
        '<td style="vertical-align:middle"><a href="' + site + '" style="text-decoration:none"><img src="' + site + LOGO_PATH + '" width="44" height="44" alt="Hasanath" style="display:block;border:0;border-radius:11px"></a></td>',
        '<td style="vertical-align:middle;padding-left:12px"><a href="' + site + '" style="text-decoration:none;color:' + INK + ';font-size:18px;font-weight:800;letter-spacing:-0.01em">Hasanath</a></td>',
        "</tr></table>",
        '<h1 style="font-size:21px;line-height:1.3;margin:0 0 16px;color:' + TEAL_DEEP + '">' + escapeHtml(title) + "</h1>",
        paragraph(GREETING),
        lines.map(paragraph).join(""),
        code
            ? '<p style="margin:20px 0;font-size:30px;font-weight:800;letter-spacing:8px;color:' + INK + '">' + escapeHtml(code) + "</p>"
            : "",
        button && button.url
            ? '<p style="margin:24px 0"><a href="' + escapeHtml(button.url) + '" style="display:inline-block;padding:12px 24px;border-radius:999px;background:' + TEAL + ';color:#ffffff;text-decoration:none;font-weight:700">' + escapeHtml(button.label) + "</a></p>"
            : "",
        after.map(paragraph).join(""),
        note ? '<p style="margin:18px 0 0;color:' + MUTED + ';font-size:13px">' + htmlOf(note) + "</p>" : "",
        '<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:' + MUTED + ';font-size:13px">Hasanath &middot; <a href="mailto:' + SUPPORT_EMAIL + '" style="color:' + TEAL_DEEP + '">' + SUPPORT_EMAIL + "</a></p>",
        "</div>"
    ].join("");

    return { subject: subject || title, text: text.join("\n"), html };
}

module.exports = { compose, escapeHtml, siteUrl, SUPPORT_EMAIL, GREETING };
