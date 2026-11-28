# Working on Hasanath

Rules for anyone changing this code, whether a person or an AI assistant.
They exist so that work done months apart, by different hands, still looks
and behaves like one app. Read this file first. For how the app is deployed
and which outside services it uses, see `docs/developer-notes.md`.

## Emails

Every email the app sends must look and read the same way.

- **Build it with `compose()`** from `api/services/emailTemplate.js`. Never
  write an email's HTML by hand. `compose()` adds the logo, the heading, the
  greeting and the closing; you supply only the words.
- **It opens with "Assalamu alaikum,"** `compose()` adds this. Do not write
  another greeting ("Hi", "Hello", "Dear user").
- **The logo is at the top**, linked to the site. `compose()` adds it.
- **It closes with "Hasanath · support@hasanath.app"**. `compose()` adds it.
- **Words:** short, plain sentences. Say what happened and what to do. If the
  person may not have asked for the email, end with a `note` that says they
  can ignore it and what that means (for example "No account was created").
- **One action per email.** A code (`code`) or a button (`button`), not both.
- **Links are full addresses**, built from `siteUrl()`. A bare path such as
  `/admin` does not work in an email.
- **Subject:** say what it is. For a code, lead with the code
  ("345444 is your Hasanath verification code") so it can be read from the
  notification.
- **Anything that came from a person is escaped.** Plain strings passed to
  `compose()` are escaped for you. If you pass `{ text, html }` to add
  emphasis, run the value through `escapeHtml()` yourself.
- Send with `emailService.sendEmail({ to, ...compose({...}) })`.

Example:

```js
const { compose, siteUrl } = require("./emailTemplate.js");

await emailService.sendEmail({
    to: user.email,
    ...compose({
        subject: "Your friend joined your challenge",
        lines: ["Sara has joined “Read after Maghrib”."],
        button: { label: "Open the challenge", url: siteUrl() + "/challenges" },
        note: "You are receiving this because you created the challenge."
    })
});
```

The emails that exist today: the sign-up code and the password-reset code
(`api/services/email.js`), the early-access invitation
(`api/services/earlyAccess.js`) and the admins' signup-limit warning
(`api/services/limits.js`).

## Words the app uses

- Plain language. Write for someone who is not technical.
- Islamic terms are spelled as the app already spells them: salah, Qur’an,
  hadith, dhikr, dua, masjid, qibla, Jumu’ah. "Masjid", not "mosque", in
  anything a user reads.
- Nothing is labelled "new". The app's features are presented as equals.
- Do not announce a feature as "coming soon" unless the owner has decided it
  is coming.

## Design

- **One design for all modules.** A new module gets the same card, the same
  kind of picture and the same place in the lists as the existing ones (the
  landing page's module grid, the sidebar, the More sheet, the footer). Do
  not give one module a section or a treatment of its own.
- **Anything that moves must stand still** for readers who ask for less
  motion (`prefers-reduced-motion`), and must not be the only way to learn
  something.
- **Check both themes and a phone width** before calling a screen done.

## Styles

- Edit **`public/css/styles.css`**. `frontend/src/styles/base.css` is
  generated from it on every build and will be overwritten.
- **Class names must be unique.** The build fails if a class used in a
  component is missing from the stylesheet, but it cannot tell you that a
  "new" class name already exists and means something else. Search the
  stylesheet for the name before using it.
- **Icons** come from a subset of Material Symbols, listed in
  `scripts/icon-names.txt`. A name that is not in that list shows as text
  instead of a picture. To use a new icon, add its name to the list and run
  `node scripts/build-icon-font.js` (and follow the note in that script about
  the font's version number).

## Server

- **Limits** people can adjust live in `api/services/limits.js` and appear on
  Admin > Limits automatically. Add a limit there, not as a constant
  somewhere else.
- **Rate limits** live in `api/middleware/rateLimits.js`.
- **Never trust the browser.** Anything the page checks (a tick box, a limit,
  who may do what) is checked again on the server.
- **Messages shown for a sign-in or sign-up error** are listed twice and must
  match: `AUTH_MESSAGES` in `api/app.js` and `MESSAGES` in
  `frontend/src/pages/AuthPage.jsx`.
- **A new outside service** is recorded in three places: the table in
  `docs/developer-notes.md`, the Privacy Policy and the Sources and credits
  page (both in `frontend/src/pages/LegalPage.jsx`).
- **Secrets** (keys, passwords, the Android signing key) are never committed.
  A new setting is added to `.env.example` with a comment, without a value.

## Before you finish

```
node --check api/app.js
cd frontend && npm run build
```

Both must pass. The build also checks class names and regenerates the
stylesheet copy. If you changed what the app collects, or added an outside
service, update the Privacy Policy and its "Last updated" date.
