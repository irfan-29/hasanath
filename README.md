# Hasanath — Pray · Track · Grow

Hasanath is a personal Islamic companion: a salah tracker that grew into a
quiet place to read Qur'an, follow hadith, keep daily dhikr and duas, build
habits and challenges, give charity, and share reflections with friends.

- **Motto:** Pray · Track · Grow
- **Production web:** <https://hasanath.app>
- **Production API:** <https://hasanath-api.vercel.app>
- **Repo/package name:** `track-my-salah` / `salah-tracker`
- **Android package:** `app.hasanath`

This file is the **product requirements and operating overview**. The
implementation details an AI agent needs live in the project skill at
[`.opencode/skills/salah-tracker/SKILL.md`](.opencode/skills/salah-tracker/SKILL.md).

---

## 1. Where the app came from

1. It started as a small **Salah tracker**: log the five daily prayers, see a
   ring, keep a streak.
2. Qur'an reading, hadith bookmarks, prayer timings, qibla, charity, personal
   challenges, stats, posts and friends were added around that core.
3. The original pages were server-rendered EJS. The app is now a **React 18 +
   Vite SPA** (`frontend/`) on a **Node/Express + MongoDB** API (`api/`).
4. A native **Android WebView wrapper** (`src/app/hasanath`, `res/`,
   `AndroidManifest.xml`) and a **PWA** (`public/manifest.webmanifest`,
   `public/sw.js`) ship the same web app to phones.
5. The name **Hasanath** (good deeds) reflects the wider scope; the motto is now
   **Pray · Track · Grow**.

The golden rule from day one still applies: **consistency over perfection**.
The app should feel calm, private, ad-free, and quick to use one-handed.

### Milestones in the repo history (212 commits)

- **Early:** the first Salah tracker, prayer timings, navbar iterations, special
  days and the Hijri calendar.
- **Qur'an:** surah index/reader, reciter memory, last-read, translations, the
  floating audio dock and its later fixes.
- **Settings:** theme/accent, fonts, translation, location, Telegram and
  notification preferences.
- **Social:** posts and video posts, profiles, friends, challenges,
  notifications, moderation.
- **Admin and security:** admin portal, moderation queue, broadcasts, banners,
  security fixes, password/username compatibility.
- **Current era:** unified responsive design revamp, PWA, Android WebView
  wrapper with in-app updates, Phone Notifications on Android, and the recent
  Salah/banner UX work.

---

## 2. Product requirements

These are the requirements the product is expected to satisfy. Treat them as a
living spec; update this file when a requirement changes.

### 2.1 Identity and principles

- [x] Name the app **Hasanath**; show the motto **Pray · Track · Grow** in the
  sidebar brand and landing footer.
- [x] No ads, no third-party analytics, no selling data.
- [x] Mobile-first: the phone layout is the primary experience; desktop is a
  wider version of it.
- [x] Work for a signed-in account and, where sensible, for a guest.
- [x] Keep the visual language calm: one accent colour, soft glass chrome,
  generous spacing, no noisy badges.
- [x] All dates shown to the user are **local calendar days**, never UTC slices.

### 2.2 Salah tracker (core)

- [x] Show Fajr, Zuhur, Asar, Magrib, Isha for a chosen day.
- [x] Statuses: **In Jamath**, **On Time**, **Late**, **Not Prayed**, **Others**,
  and **Not logged** (clear the entry).
- [x] Status values are chosen from a **plain coloured text row with an inline
  chevron**, not a bordered pill/button; the chevron aligns at the row's right
  edge like the date selector.
- [x] **Others counts as logged.** It is a real status, not a synonym for "Not
  logged"; the ring and `n of 5 logged` badge include it.
- [x] Logging writes immediately; clearing removes the entry.
- [x] Keep legacy rows readable. Older data may store `others` (lowercase) or a
  long English day label; both must keep working.
- [x] Show a progress ring and a per-day logged count.
- [x] Date navigation must not shift the day for users east/west of UTC.

### 2.3 Qur'an

- [x] 114-surah index with search and "Continue reading" that reopens each of
  the five recent surahs at its last verse; a surah read only in list view
  shows its name alone.
- [x] Reader with Arabic, multiple translations, ayah deep links (`?ayah=`),
  list and single-ayah views (previous/next ayah), previous/next surah,
  share/copy, bookmark.
- [x] Audio playback with reciter choice, loop, speed, sleep timer, resume
  position, media-session/lock-screen controls, and an Android bridge.
- [x] Favourites/bookmarks (up to 300).
- [x] **Ayah of the Day** card plus a transient random ayah.
- [x] Never lose the audio element on navigation (provider sits above routes).

### 2.4 Hadith

- [x] Collection grid, section chips, paginated reader, language switch,
  search/jump by number, share/copy, bookmarks (up to 300).
- [x] Sign-in gate for bookmarks; reading remains available.

### 2.5 Prayer timings, qibla, calendar

- [x] City search, saved location, calculation method, Asr school, time format.
- [x] Five daily times and the next prayer, timezone-aware.
- [x] Qibla bearing/distance with GPS or saved coordinates and a compass
  permission gesture on iOS.
- [x] Hijri/Gregorian month calendar plus special Islamic days.

### 2.6 Challenges and charity

- [x] Personal challenges with presets (10/30/90 days), streaks, check-ins,
  rename/delete.
- [x] Daily Qur'an reading challenge counted from distinct ayahs opened in the
  single-ayah reader; progress resets each day and never inflates on re-reads.
- [x] Friend challenges: invite up to 20 friends, shared start/end dates,
  per-participant streaks, leaderboard without exposing private history.
- [x] Charity targets with daily/weekly/monthly/yearly periods, progress, and
  donations that can be added, edited or removed.
- [x] All personal data lives on the signed-in account; guests get a limited
  local store that merges on sign-up.

### 2.7 Social

- [x] Feed of reflections, optional YouTube video posts, likes, reports.
- [x] Public profile at `/u/:username`, friend requests/accept/decline/remove,
  people search, suggestions.
- [x] Blocking hides posts, profile and friend graph in both directions locally.
- [x] First posts are held for review; reported posts are hidden after 3 open
  reports; admins can approve/reject. No auto-publish for reported posts.
- [x] Notifications for friend requests, challenge invites, likes and admin
  broadcasts; 60-day retention.

### 2.8 Stats

- [x] Salah report: good/late/missed/other by prayer, active days, perfect days,
  streaks, daily bars.
- [x] Challenge and charity reports with independent time ranges.
- [x] "Others" appears as its own stats bucket, not as missed.
- [x] Ranges: salah 7–365 days, challenges up to 90 days, charity 3–12 months.

### 2.9 Account and settings

- [x] Email + password account. Sign-up creates nothing until a 6-digit email
  code is verified. Login accepts email **or** username.
- [x] Username rules: 3–30 chars, lowercase `[a-z0-9._]`, no leading/trailing
  separator, reserved names blocked, unique.
- [x] Optional **display name** (≤50 chars, not unique) shown first on the
  profile, feed, friend lists, challenge views and account menu, with the unique
  `@username` beside it. Clearing it falls back to the username. It can be
  changed without re-entering the password; changing the username still needs
  the current password.
- [x] Password: at least 8 characters; change requires the current password.
- [x] Avatar upload/crop (JPEG/PNG/WebP, max 4 MB, stored in Vercel Blob) with
  initials fallback.
- [x] Theme, six accents, app font, app/Qur'an text size, default home page,
  Qur'an font/reciter/translation, location, calculation method, Asr school,
  time format, Telegram notifications.
- [x] Password-confirmed account deletion; blocked-account undo.
- [x] **Contact admin** from the Account page: send an in-app message (stored,
  answered by an admin) or open the phone's mail app addressed to the project
  inbox with the user's details in the body. Replies arrive as notifications
  and the message history sits behind a collapsed “Your messages” row.
- [x] Android-only **Phone Notifications**: prayer reminders (at time / 10
  minutes before / both), friend and announcement alerts, notification
  permission and exact-alarm prompts. These settings live on the phone, not the
  server.
- [ ] Account data export (not implemented).

### 2.10 Announcements and admin

- [x] **One-time popup (OTB):** shown once per signed-in account until closed;
  counts as `seenCount/totalUsers closed it` (for example `4/7 closed it`).
- [x] **Sticky bar:** top or bottom, dismissible in the browser; long messages
  can be expanded with "Show the full announcement" and collapsed again.
- [x] **Only one popup and one sticky bar may be live at a time.** Turning on a
  second one asks for confirmation and turns the previous one off.
- [x] **Retrigger** an already-live campaign: popups clear acknowledgements,
  sticky bars bump a revision so dismissed bars reappear.
- [x] Sticky bars must never hide the last content on any page. Reserve their
  measured height on top of the page's normal bottom space, including when the
  audio dock is open, at desktop, tablet and phone widths.
- [x] Admin portal (unlisted at `/admin`): overview, moderation, broadcasts,
  banners, users. `ADMIN_EMAILS` are root admins; portal-granted admins can be
  revoked; you cannot revoke yourself.
- [x] Broadcasts to all users (title 120, body 1200, link 500), recorded even
  after notifications expire.
- [x] `${user}` placeholder in broadcast and banner title/body/CTA: resolved per
  recipient at delivery (broadcast) or per reader on `/api/app/meta` (banner),
  for example `Assalamu Alaikum ${user}, …`. Stored history and the admin editor
  keep the raw template; the admin form shows a sample preview.

### 2.11 Landing, PWA and Android

- [x] Marketing landing page with live preview, Ayah of the Day, theme/accent
  pickers, and Google Play-style "Get the app" APK link.
- [x] Installable PWA: manifest, offline shell, network-first navigation,
  cache-first assets, never cache `/api/*` or personal data.
- [x] Android app: native WebView, app links, in-app updater, prayer polling,
  media notification, splash themes.
- [x] Android 1.8 is published: versionCode 9 / versionName 1.8, the signed APK
  lives at `public/android/Hasanath-1.8.apk`, `version.json` and the landing
  buttons point at it, and the Settings page exposes Phone Notifications inside
  the app.

### 2.12 Non-functional requirements

- [x] Responsive at 1024/768/600 px and landing-specific widths; respect
  safe-area insets.
- [x] Keyboard/screen-reader support: semantic tabs, labelled dialogs, Escape
  dismissal, focus return, `aria-live` toasts, reduced-motion rules, RTL for
  Arabic/Urdu.
- [x] No CORS: the frontend proxies `/api` so session and guest cookies stay
  first-party.
- [x] Mongo-backed rate limits so Vercel cold starts cannot reset them.
- [x] Server caches for Quran/hadith and a Mongo cache for slow upstreams.
- [x] Production build gates: CSS sync, hook-import check, class-name check,
  Vite build.
- [ ] Automated unit/integration tests (none yet; build checks only).

### 2.13 Dhikr & Dua

- [x] `/dhikr` page with Dhikr and Duas sections, available to guests and
  signed-in users. Dhikr works fully offline; the dua collection downloads once
  per language and is then served from the service-worker asset cache.
- [x] Dhikr counter: presets (SubhanAllah, Alhamdulillah, Allahu Akbar, tahlil,
  istighfar, salawat) or a free count, a single tap target, target progress, and
  a per-day count persisted in `localStorage` (`hasanath-dhikr`). The day rolls
  over with `localDateKey()`.
- [x] Duas: 743 unique duas from the Masnun Dua (Hisnul Muslim) dataset, with
  English, Tamil, Malayalam and Urdu translations, 44 category chips, search,
  Arabic + transliteration + translation + source, copy, and 30-per-page
  "Show more". The chosen language is remembered in `hasanath-dua-lang`.
  Arabic follows the user's Qur'an Font setting (`favoriteFont`, default
  `QPC-Hafs`).
- [x] The collection is generated by `scripts/build-duas.js` into
  `frontend/src/data/duas/` (source: https://github.com/islamicapi/masnun-dua,
  free for app use) and imported lazily by `services/duaData.js`, one Vite chunk
  per language. Do not edit the generated files by hand.
- [x] No backend route: the module must keep working with no network, so the
  dua data ships with the app rather than being fetched from a third-party API.

---

## 3. Feature map

| Route | What it is | Account required |
| --- | --- | --- |
| `/` | Landing page for guests; signed-in users redirect to their home | No |
| `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth cards | No |
| `/salah` | Salah tracker | Yes |
| `/quran`, `/surah/:surahNo` | Qur'an index, list/single-ayah reader, audio, bookmarks | No |
| `/hadith`, `/hadith/:collection` | Hadith collections and reader | No |
| `/dhikr` | Dhikr counter and dua collection (offline after first open) | No |
| `/challenges` | Personal and friend challenges | Yes |
| `/charity` | Charity targets and donations | Yes |
| `/stats` | Salah/challenge/charity report | Yes |
| `/posts`, `/post/:id`, `/u/:username` | Social feed and profiles | Yes for actions |
| `/notifications` | Event feed | Yes |
| `/salah-timings`, `/qibla`, `/calendar` | Prayer tools | No |
| `/settings`, `/account` | Preferences and identity | Yes |
| `/admin` | Admin portal (unlisted) | Admin |

---

## 4. User rules and limits (summary)

Full detail is in the skill reference. The numbers users can hit:

| Area | Rule |
| --- | --- |
| Login | 30 failed attempts/IP and 10 failed/account per 15 min |
| OTP email | 20/IP and 5/address per hour; code valid 10 min, 5 attempts, 30 s resend cooldown |
| Posts | 5/account and 10/IP per hour, plus 1/minute; report note ≤ 500 chars |
| Post moderation | First 3 published posts still get a 24 h review hold; 3 open reports hide a post |
| Avatar | 4 MB max; JPEG/PNG/WebP |
| Favourites / bookmarks | 300 each; last-read list 5 |
| Guest store | ~3.8 KB cookie; 25 challenges; 60 salah entries; merges with caps 100/400 |
| Friends | Search ≥ 2 chars; 8 results; 12 suggestions |
| Friend challenge | Name ≤ 80 chars; up to 20 participants; max span 3660 days |
| Banner | Title ≤ 120, body ≤ 600, CTA ≤ 40, URL ≤ 500; one live per kind |
| Broadcast | Title ≤ 120, body ≤ 1200, link ≤ 500; sent in 500-user batches |
| Telegram | Messages truncated at 4000 chars; setup code valid 15 min |
| Stats | Salah 7–365 days; challenges ≤ 90 days; charity 3–12 months |
| Hadith | 5–50 per page (default 25) |
| Retention | Sessions and guest cookies 30 days; app notifications 60 days |

---

## 5. Tech stack

- **API:** Node 24, Express 4, Mongoose 8/MongoDB Atlas, Passport
  (`passport-local-mongoose`), `express-session` + `connect-mongo`,
  `express-rate-limit` with a Mongo store.
- **Frontend:** React 18, Vite 5, React Router 6, `react-easy-crop`; plain CSS
  (one canonical stylesheet), self-hosted Material Symbols.
- **Jobs/email/storage:** Upstash QStash, Gmail SMTP or Resend, Vercel Blob.
- **Hosting:** Vercel (API as a serverless function, frontend as a Vite static
  site with an `/api` rewrite), MongoDB Atlas.
- **Clients:** PWA + native Android WebView wrapper.

---

## 6. Quick start

```bash
# 1. Install everything
npm run install:all

# 2. Copy the environment template and fill in MongoDB etc.
cp .env.example .env

# 3. Run API (port 3000) and Vite (port 5173) together
npm run dev:all
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to
`http://localhost:3000`, so cookies stay first-party exactly as in production.

Useful commands:

```bash
npm run frontend:build    # sync CSS, run checks, Vite build
npm run frontend:sync-css # public/css/styles.css -> frontend/src/styles/base.css
npm run check:secrets     # scan tracked files for leaked credentials
npm run check:email -- you@example.com
npm run qstash:schedule -- status   # create | delete
```

Never edit `frontend/src/styles/base.css` by hand; edit
`public/css/styles.css` and run the sync/build.

---

## 7. Deployment

- **API project (repo root):** `vercel.json` builds `api/app.js` with
  `@vercel/node`; `serverless-http` exposes `module.exports.handler`.
- **Frontend project (`frontend/`):** builds with Vite. `frontend/vercel.json`
  rewrites `/api/:path*` to the API host **first**, then `/:path*` to
  `index.html`. The order is load-bearing; see `frontend/vercel.md`.
- Set all variables from `.env.example` in the Vercel projects. `MONGO_URI`,
  `COOKIE_SECRET` and `SESSION_SECRET` are mandatory in production.
- QStash drives `POST /api/qstash/sweep`; register the schedule once after
  deploying (`npm run qstash:schedule -- create`).
- Android updates: follow [`docs/android-releases.md`](docs/android-releases.md).

---

## 8. Documentation map

The skill is registered automatically (`salah-tracker`). Mention `@salah-tracker`
to load it explicitly, or let the agent pick it for repo work. Its references are
split on purpose: only open the backend, frontend or operations file you need so
the context window stays small.

| File | Purpose |
| --- | --- |
| [`README.md`](README.md) | Product requirements, limits, setup, deployment (this file) |
| [`.opencode/skills/salah-tracker/SKILL.md`](.opencode/skills/salah-tracker/SKILL.md) | Agent entry point, invariants, workflows, verification |
| `.opencode/skills/salah-tracker/references/backend.md` | API, auth, routes, models, services, limits |
| `.opencode/skills/salah-tracker/references/frontend.md` | Routes, providers, pages, audio, styling, PWA |
| `.opencode/skills/salah-tracker/references/operations.md` | Env vars, external APIs, deploy, Android, scripts |
| [`docs/android-releases.md`](docs/android-releases.md) | APK release checklist |
| [`frontend/vercel.md`](frontend/vercel.md) | Why the API rewrite and its order matter |

Keep these current: change `README.md` when a requirement or limit changes, and
update the matching skill reference when the implementation changes. The code is
always the final source of truth.

---

## 9. Known issues / open items

1. **Font files referenced by CSS are missing.** `styles.css` declares
   `dk-v2.woff2`, `dk-indopak.woff2`, `indopak-pdms.woff2` and `me-quran.woff2`,
   but `public/fonts/` only has QPC Hafs, QPC Nastaleeq and Indopak Nastaleeq
   (plus the Material Symbols subset). Either add the files or remove the
   unused `@font-face` blocks.
2. **Two OTB banners can be active in existing data.** The server now enforces
   one active banner per kind on every new activation, but old rows (Fuu and
   New popup) were both active before that rule and remain so until touched.
3. **No automated tests.** The safety net is `check-react-imports`,
   `check-classnames`, `check-secrets`, `verify:passwords` and the Vite build.
4. **No account export.** Deletion exists and is password-confirmed; export is
   still a requirement.
5. **Historical credential exposure.** A real Mongo password was committed in
   the repo's past. It must stay rotated; removing it from the working tree does
   not remove it from git history.
6. **`OTP_DEV_ECHO` must never be enabled in production.** It prints codes to
   the log when no mail transport is configured.

---

## 10. Conventions that matter

- Use `localDateKey()` (frontend `src/utils/date.js`) for today keys; never
  `toISOString().slice(0, 10)` for a user's day.
- Keep legacy Salah date formats (`YYYY-MM-DD` **and** long English labels)
  readable; write new rows as ISO.
- Missing post `status` means **published**; do not "fix" old posts.
- The Mongoose model name must stay `Posts`.
- Do not enable CORS; the same-origin `/api` rewrite is intentional.
- Do not edit `frontend/src/styles/base.css` directly.
- Banner activation must keep one active row per kind; sticky dismissal keys are
  `id:revision`.
- Android Phone Notification preferences live on the device through the native
  bridge, not in Mongo; `api.js` re-plans reminders after settings/auth writes.
- Guest data wins on merge into an account; keep it sanitized and size-capped.
- `username` is the unique identity and `/u/<handle>` route key. `name` is the
  optional, non-unique display name. Resolve labels with
  `api/utils/displayName.js` (`displayNameFor`, `interpolateUser`) and the
  client's `personName`/`personHandle`; never swap one for the other.
- Admin emails from `ADMIN_EMAILS` are roots and cannot be demoted in the
  portal; nobody can demote themselves.
- Icons come from a **subset font**. Add a new name to `scripts/icon-names.txt`
  and run `node scripts/build-icon-font.js`; bump the version suffix in the
  script, `public/css/styles.css` and `frontend/index.html`, then sync the CSS.
  An unlisted name paints as text (`REPLY`, `SELF_IMPROVEMENT`).
- Contact-admin replies are in-app notifications (`admin_reply` →
  `/account#contact-admin`), never email; the `mailto:` option only prepares a
  message in the user's own mail app.

---

## 11. Recent product decisions

- **Motto:** changed from `Track · Pray · Grow` to **`Pray · Track · Grow`** in
  the sidebar brand and the landing footer. Keep the `·` separators.
- **Salah status rows:** plain coloured text plus an inline down chevron, no
  bordered pill; the chevron aligns with the date selector at the row's right
  edge.
- **“Others”:** restored as a real status (`others`, displayed “Others”). It
  counts as logged in the ring/badge and stays a separate `other` stats bucket.
- **Banner exclusivity:** only one popup and one sticky bar may be live. The
  admin UI warns before switching and names the banner that will be turned off;
  the server enforces the same rule for every activation.
- **Retrigger:** a live campaign can be shown again without duplicating it.
  Popups clear `BannerView` rows; sticky bars bump `revision` (dismissal key
  `id:revision`).
- **Popup counts:** show `seenCount/totalUsers closed it` (e.g. `4/7 closed it`)
  rather than a bare count.
- **Long sticky messages:** an expand/collapse chevron appears only when text is
  actually clipped; expanding wraps the text and grows the bar.
- **Sticky clearance:** the measured bar height is added to the page's normal
  bottom space on every page, at desktop/tablet/phone widths, including when the
  audio dock is open. The bar's `min-height` is a fixed value, not the measured
  variable, so collapsing actually returns the page to its smaller size.
- **Local dates:** Salah, Charity and stats use `localDateKey()` so a user east
  or west of UTC does not lose or gain a day.
- **Display name vs username:** an optional, non-unique display name leads the
  profile, feed, friends and challenge labels; the unique `@username` stays
  beside it. The display name is editable without a password; the username is
  not. `${user}` in admin messages resolves to the same display-name fallback
  chain (`name` → `username` → email local-part → `friend`).
- **Dhikr & Dua:** kept server-free: the counter is localStorage-only and the
  content ships with the app, so the PWA and Android wrapper work offline. The
  dua collection is generated from the free Masnun Dua dataset by
  `scripts/build-duas.js`; each translation is a lazily imported Vite chunk
  cached by the service worker after its first open. The page reuses the
  Qur'an/hadith tab, chip and ayah-block patterns rather than introducing a
  parallel design.

---

## 12. Author

Built by **Mohammed Irfan U**. Personal project; no ads, no tracking.

## Developer notes

Every outside service the app uses, the settings each needs, and the things that are easy to forget are in [docs/developer-notes.md](docs/developer-notes.md).
