# Backend reference (`api/`)

Covers the Express API, auth, routes, models, services, exact limits and the
behaviour that is easy to break. Source of truth is the code; this file is the
map.

## 1. Startup and middleware

Entry point: `api/app.js`.

Order:

1. `dotenv` loads `.env`.
2. `express.json({ verify })` keeps `req.rawBody` for QStash signatures.
3. `body-parser.urlencoded` for form posts.
4. Mongo `strictQuery`.
5. Boot aborts without `MONGO_URI` (`app.js:98`). In production it also aborts
   without `COOKIE_SECRET` / `SESSION_SECRET`; development uses a warning
   fallback.
6. `ensureDb()` caches one connection promise; each request awaits it with an
   **8 second** timeout and gets JSON `503 database-unavailable` on timeout.
7. `cookieParser(COOKIE_SECRET)` → `trust proxy 1` → DB gate →
   `express-session` (Mongo store sharing the mongoose client, collection
   `sessions`, **30 day** TTL, native auto-remove) → Passport
   init/session → `userData.attachResponse` (exposes `res` to guest helpers).
8. Routes, then the 404/redirect tail, then the JSON error middleware.

Session cookie: **30 days**, `httpOnly`, `sameSite=lax`, `secure:auto` when
`NODE_ENV=production`.

No CORS, no helmet, no API static hosting. `public/` is served by the frontend
project; the API deliberately does not duplicate it.

`module.exports = serverless(app)` for Vercel; `app.listen(PORT || 3000)` runs
locally. Local API port: **3000**.

Tail behaviour:

- `/api/*` unknown → `404 {error:"not-found",path}`.
- non-GET/HEAD unknown → `405` JSON.
- every other GET/HEAD → `302` to `FRONTEND_URL + originalUrl`
  (`FRONTEND_URL` defaults to the production web host, or
  `http://localhost:5173` in development).
- `/.well-known/assetlinks.json` is served directly for Android App Links.
- final error middleware always returns JSON; 500 hides details as
  `server-error`.

Every async route is wrapped by `wrapAsyncHandler` so throws reach that error
middleware.

## 2. Auth and sessions

Files: `api/middleware/auth.js`, `api/utils/password.js`,
`api/utils/username.js`, `api/utils/guestStore.js`, routes in `api/app.js`.

- **Passport local-mongoose v9.** Login field is **email**; the client may type a
  username, which `resolveLoginIdentifier` maps to the email.
- **Passwords:** PBKDF2-SHA256, **25,000 iterations**, 512-byte key, 32-byte
  salt. `scripts/verify-password-compat.js` proves compatibility with the
  plugin after upgrades. Minimum length **8**.
- **Signup is OTP-gated.** `POST /api/auth/register` validates email, password
  and confirmation, then stores a `pendingSignup` in the session:
  PBKDF2 hash/salt, SHA-256 OTP hash, **10 minute** expiry, 0 attempts,
  `sentAt`. **No User document exists until verification.**
- **OTP:** 6-digit CSPRNG, hashed, constant-time compare; **5 attempts** then
  the pending signup is discarded; resend cooldown **30 seconds** and resets
  attempts. Register/resend/forgot are rate-limited by IP and recipient.
- **Verify** creates the user with an auto username, `emailVerifiedAt`, merges
  guest data, logs in, clears the guest cookie.
- **Login** accepts email or username, returns generic `invalid-credentials`,
  and clears the guest cookie only after `req.logIn` succeeds.
- **Admin login** (`POST /api/admin/login`) authenticates then refuses
  non-admins **before** creating a session.
- **Password reset:** `POST /api/auth/forgot` always answers `{ok:true}` (no
  account enumeration). Code is valid **10 minutes / 5 attempts**. `POST
  /api/auth/reset` validates the new password first, then the code, sets it and
  signs the user in.
- **Logout** destroys the session (not just the cookie).
- **Usernames** (`utils/username.js`): lowercase, strip `@…`/`+…`, collapse
  `[._-]+` to `.`, strip invalid chars, max **30**. Valid = **3–30** chars
  `[a-z0-9._]`, no leading/trailing separator, reserved names blocked
  (`admin`, `api`, `settings`, `posts`, `u`, …). Allocation appends `2…50`,
  fallback stem `member`. Unique sparse index.
- **Change username** needs the current password and rejects reserved, invalid
  or taken names; a no-op change is allowed. **Change password** needs the
  current password, **≥8**, confirmation, and must differ.
- **Account deletion** requires the password. It deletes the user's reports
  (as reporter or post author), own posts, pulls likes/blocks from others,
  friendships, created friend-challenges, pulls the user from other challenges,
  notifications and the avatar blob, then destroys the session and user.
  **No export endpoint.**
- **Guest cookie** `salah_guest`: signed, httpOnly, lax, **30 days**, budget
  **3,800 bytes**. Stores last-read (5), challenges (25), Salah entries (60),
  settings and Telegram chat id. Sanitized/clamped on every read. Guest data
  wins on merge; merge caps are **100 challenges / 400 Salah rows / 5
  last-read**.

## 3. Route map

Grouped by area. All paths are under `/api`.

### System and meta
- `GET /session` — current session summary.
- `GET /app/meta` — boot payload: session, theme, accent, default home,
  `homePath`, font sizes, banners. `Cache-Control: no-store`. Throttles
  `lastSeenAt` to once per **5 minutes**.
- `GET /due-notifications` — runs the notification scheduler for this user.
- `POST /qstash/sweep` — signed scheduler entry point.
- `GET /surah-audio/:surahNo` — audio URL resolution; legacy
  `GET /quran/audio`.

### Auth
- `POST /auth/register|resend|verify|login|forgot|reset|logout`
- `POST /admin/login`

### Qur'an
- `GET /quran/index|random-ayah|surah/:surahNo|reciters|progress|favourites`
- `POST /quran/reciter`, `POST /quran/progress`,
  `POST /quran/favourites/toggle`
- `DELETE /quran/progress`
- `GET /quran/audio` (plus legacy non-API `/quran/audio`)

### Salah
- `GET /salah?date=` — both ISO and legacy long labels accepted.
- `POST /salah` — log a status.
- `DELETE /salah` — clear an entry (“Not logged”).

### Personal challenges
- `GET /challenges`, `POST /challenges`
- `POST /challenges/streaks`
- `POST /challenges/:id/checkin`
- `POST /challenges/:id`, `DELETE /challenges/:id`

### Charity
- `GET /charity`, `POST /charity`
- `PATCH /charity/:id`, `DELETE /charity/:id`
- `POST /charity/:id/donate`
- `PATCH /charity/:id/donation/:index`,
  `DELETE /charity/:id/donation/:index`

### Stats
- `GET /stats?days=&challengeDays=&charityMonths=`

### Posts, profiles, blocks
- `GET /posts`, `POST /posts`
- `GET /posts/:id`, `PATCH /posts/:id`, `DELETE /posts/:id`
- `POST /posts/:id/like`, `POST /posts/:id/report`
- `GET /account/blocks`
- `POST /users/:id/block`, `DELETE /users/:id/block`
- `GET /u/:username` — public profile, posts, relationship, friends.

### Friends
- `GET /friends`, `GET /friends/suggestions`
- `GET /users/search`
- `POST /friends/requests`
- `POST /friends/requests/:id/accept|decline`
- `DELETE /friends/:username`

### Notifications
- `GET /notifications`, `GET /notifications/count`
- `POST /notifications/read-all`, `POST /notifications/:id/read`

### Friend challenges
- `GET /friend-challenges`, `POST /friend-challenges`
- `POST /friend-challenges/:id/respond|checkin`
- `PATCH /friend-challenges/:id`, `DELETE /friend-challenges/:id`

### Account and settings
- `GET /account` — raw `name` plus the resolved `displayName`.
- `POST /settings/username`, `POST /account/password`,
  `POST /account/display-name` (no password; empty clears the name),
  `POST /account/avatar`, `DELETE /account/avatar`, `DELETE /account`
- `GET /settings`, `POST /settings`

### Telegram
- `POST /telegram/setup-code|chat-id|test|prefs`

### Locations, timings, calendar, editions
- `GET /locations/search`
- `GET /salah-timings`
- `GET /calendar`
- `GET /editions`, `GET /editions/previews`

### Hadith
- `GET /hadiths/bookmarks`, `POST /hadiths/bookmarks/toggle`
- `GET /hadiths/collections`
- `GET /hadiths/:collection/find`
- `GET /hadiths/:collection`
- `GET /hadiths/:collection/section/:sectionId`

### Admin (all require login + admin unless noted)
- `GET /admin/moderation`
- `POST /admin/posts/:id/approve|reject`
- CRUD `/admin/banners`, `POST /admin/banners/:id/retrigger`
- `GET /admin/broadcasts`, `POST /admin/broadcasts`
- `GET /admin/users`, `PATCH /admin/users/:id`
- `GET /admin/stats`
- `POST /banners/:id/seen` — **any signed-in user**, not admin.

## 4. Permissions

- `requireLogin` → `401 {error:"login-required"}`, stores `returnTo` for GETs.
- `requireAdmin` → `403`; `postModeration.isAdmin`.
- Admin = email in comma-separated `ADMIN_EMAILS` (read per call) **or**
  `User.isAdmin` (portal grant). Env admins are roots and cannot be toggled.
  The portal cannot change your own flag.
- Ownership: post PATCH/DELETE compares `post.author` to the session user;
  friend-challenge edit/delete is creator-only; Salah/charity/challenges always
  go through `req.user`; notifications/banner views are scoped to
  `req.user._id`; block targets must be valid ObjectIds.
- Moderation visibility (`services/postModeration.js`): missing `status` =
  published; feed = published + own pending, minus blocked authors.
  `canView` = admins anything, blocked denied, rejected denied, pending only
  the author, otherwise visible. Admin queue sees all pending.
- Blocks are one-directional/local: hide posts/profile/friend graph and delete
  any friendship. Feed excludes posts by blocked authors.

## 5. Exact limits

| Area | Rule |
| --- | --- |
| Login | 15 min fixed window; **30 failures/IP**, **10 failures/account**; successful requests skipped |
| OTP send | 1 hour; **20/IP**, **5/email**; every request counts |
| OTP verify | **10 min** validity; **5 attempts**; **30 s** resend cooldown |
| Posts | 1 hour; **10/IP**, **5/account** (successful only); **1 post/minute/account** |
| Post content | Must be non-empty; no maximum length on content/reference |
| Reports | Note ≤ **500**; reasons `spam|harassment|misinformation|other` |
| Moderation | Hold until **3 published** posts; review hold **24 h**; **3 distinct open reports** hides a post; reported posts never auto-publish |
| Avatar upload | **4 MB**, 1 file, `image/jpeg|png|webp`; client crops 512 px; blob cache **1 year** |
| Guest store | **3,800 bytes**; 25 challenges; 60 Salah entries; 5 last-read; merge caps **100 / 400** |
| Favourites / hadith bookmarks | **300** each; last-read **5** |
| Challenge history | **730** entries; guest history 40 |
| Personal challenges | Backfill window **7 days**; presets **10/30/90**; max span **3660 days** |
| Friend challenge | Name ≤ **80**; max **20** participants |
| Friends | Search results **8**; suggestions **12**; query ≥ **2** chars |
| Admin users | Default **25**, max **100**/page |
| Notifications | List **50**; TTL **60 days** |
| Moderation queue | **100** posts / **200** reports |
| Banners | Title **120**, body **600**, CTA **40**, URL **500**; list **200** |
| Broadcasts | Title **120**, body **1200**, link **500**; list **100**; fan-out batches **500** |
| Telegram | Message truncated to **4,000** chars; setup code **15 min**, 6 chars, one-shot |
| Stats | Salah days clamped **7–365**; challenges ≤ **90**; charity **3–12** months |
| Hadith | `per` **5–50** (default 25); page ≥ 1 |
| Editions | Search **50**; previews **40** names; preview text **160** chars |
| Caches | Immutable upstream hosts never expire; mutable HTTP cache **30 days**; in-memory memo **10 min**; preview-miss retry **10 min**; sessions **30 d**; guest **30 d** |
| Fetch timeouts | Quran **5 s**; hadith **30 s**; IslamicFinder **6 s**; Telegram **8 s**; DB gate **8 s** |

## 6. Mongoose models

- **User** (`models/User.js`): embedded Salah log, charities + donations,
  personal challenges, settings, favourites/bookmarks, `blockedUsers`, Telegram
  prefs/`lastSent`, username/isAdmin/avatar/emailVerifiedAt/lastSeenAt. Plugin
  adds unique lowercase `email` + hidden hash/salt. Unique sparse `username`;
  optional **`name`** display name (≤50, trimmed, not unique; presentation only).
  Indexes `lastSeenAt`, `isAdmin`. Caps favourites/bookmarks 300, last-read 5.
- **AyahOfTheDay**: unique `date`; `surahNo`, `ayahNo`, `variants` Map keyed by
  edition, legacy top-level text, `resolvedAt`.
- **Post** (model name **`Posts`**): author/authorName/content/reference/
  postedDate/isVideo/likedBy; `status` `published|pending|rejected` (default
  published); `statusReason` `review|reported`; `autoPublishAt`;
  reviewedAt/By. Indexes `{status,autoPublishAt}`, `status`.
- **PostReport**: post/postAuthor/reporter/reason/note ≤500/status
  `open|dismissed|actioned`; unique `{post,reporter}`; index
  `{status,createdAt}`.
- **Friendship**: unique directional-pair `key` = sorted ids;
  requester/recipient/status `pending|accepted`; declined rows are deleted.
- **FriendChallenge**: creator, shared start/end ISO dates, participants
  (status, current/max streak, history, bestStart/End, respondedAt); index
  `participants.user`.
- **AppNotification**: recipient, type enum, denormalized actor, title/body/
  link/data, readAt; indexes `{user,createdAt}`, `{user,readAt}`; TTL **60 days**.
- **Banner**: kind `otb|sticky`; title/body/CTA limits; position; `active`;
  `revision`; startsAt/endsAt; createdBy; indexes kind/active/window.
- **BannerView**: unique `{banner,user}`; idempotent acknowledgements.
- **Broadcast**: title/body/link/sentBy/recipients; timestamped history that
  outlives notification TTL.
- **RateLimitCounter**: `_id = prefix+key+windowStart`, hits, expiresAt; TTL
  **0** on `expiresAt`.

## 7. Services

- **userData** — one facade for auth vs guest: settings defaults/validation,
  last-read, audio progress, personal challenges/streaks, charity/donations,
  Salah log/date normalization, favourites/bookmarks, Telegram chat id, guest
  merge.
- **stats** — Salah/challenge/charity reports; normalizes legacy dates; clamps
  windows. “Others” goes to the `other` bucket, never `missed`.
- **prayerTimes** — Aladhan methods/schools/time formats, legacy 5-city map,
  Open-Meteo geocoding, timezone-aware date keys, timings fetch/format.
- **ayahOfDay** — per-edition daily ayah resolution/caching; read-only variant
  for the scheduler.
- **notifications** — preference shape, due detection, Telegram HTML escaping,
  message builders (Salah log, timings, new post, module previews), safe
  delivery, `lastSent`.
- **notifyScheduler** — per-user due check in the user's timezone; boot
  catch-up + bounded sweep; marks sent only after delivery.
- **friends** — request/accept/decline/remove, relationship state, list/search/
  suggestions, notifications, pushes.
- **friendChallenges** — create/respond/check-in/edit/leave with friendship
  verification, per-participant streaks, leaderboard privacy.
- **postModeration** — admin check, visibility filters, holds, report
  threshold, lazy `publishDue`.
- **banners** — live filtering, sticky/OTB delivery, idempotent mark-seen,
  view counts; `present(banner, viewer)` resolves `${user}` per reader while
  the admin view (no viewer) keeps the template.
- **broadcasts** — fan-out to all users in 500-row batches; history record
  stores the raw template while `${user}` is resolved per recipient's row.
- **email** — Gmail SMTP or Resend; OTP generation/hash/compare; dev echo
  gated on `OTP_DEV_ECHO` + `NODE_ENV` strictly `development|test`.
- **appNotifications** — push/list/unread/mark/remove; max 50.
- **adminUsers / adminStats** — paginated search + counts; overview timelines
  from ObjectId timestamps and `lastSeenAt`.
- **favourites** — coordinate validation (`1–114`, ayah ≤286 and ≤ real
  length), resolves texts.

## 8. External APIs called by the backend

- `https://quranapi.pages.dev/api/*` — surah index/text/audio/reciters.
- `https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/*` —
  translations and edition catalogue.
- `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/*` — hadith
  Arabic/English/Urdu/Tamil.
- `https://api.aladhan.com/v1/*` — prayer timings, Gregorian↔Hijri, current
  Hijri month/year.
- `https://geocoding-api.open-meteo.com/v1/search` — city search.
- `https://www.islamicfinder.org/specialislamicdays` — scraped special days.
- `https://api.telegram.org/bot<token>/*` — shared bot `sendMessage`, `getMe`.
- Gmail SMTP (`smtp.gmail.com:465`) or Resend — signup/reset OTP mail.
- Vercel Blob — avatars.
- Upstash QStash — signed scheduled sweeps.
- MongoDB Atlas via mongoose.

No Redis use is implemented despite `@upstash/redis` being a dependency.

## 9. Background jobs and schedulers

- **QStash sweep** `POST /api/qstash/sweep`: 503 if unconfigured, 401 on a bad
  signature, 500 to trigger one retry. Default cron **`*/10 * * * *`**, 1
  retry (~144/day typical, 288/day worst case). Schedule name
  `salah-notify-sweep`, upserted by destination URL (`utils/qstash.js`,
  `scripts/qstash-schedule.js`).
- **Notification scheduler** `sweepAllUsers` limit **200 users/tick**;
  `runDueForUser` sends ayah/timings after the local time passes and stamps
  `lastSent`. Boot catch-up via `GET /api/due-notifications`.
- **postModeration.publishDue** runs lazily on feed, permalink, public profile
  and admin moderation reads. No cron; no broadcast on release.
- **Ayah of the day** is created lazily on `/api/quran/index`; no refresh cron.
- **Event notifications** are inline: streak updates, Salah save, new post
  (fan-out max **100** subscribers), friend request/challenge invites.
- No Vercel cron config in the repo; QStash is the only external clock.

## 10. Key payloads

### `GET /api/app/meta` (also documented in the frontend reference)

```
{
  session: { isLoggedIn, username, displayName, avatarUrl, isAdmin },
  theme, accent, defaultHome, homePath,
  appFont, appFontSize, quranFontSize,
  banners: { sticky: [presentBanner], otb: presentBanner | null }
}
```

`presentBanner` = `{ id, kind, title, body, ctaLabel, ctaUrl, position,
revision, createdAt }`. Title/body/CTA are personalised for the signed-in
reader; guests get `friend` for `${user}`. `Cache-Control: no-store`.

### `GET /api/salah?date=`

```
{
  date: "Sunday, Oct 11, 2026",   // display label for the resolved day
  isoDate: "2026-10-11",
  entries: [{ date, name, value }],
  canManage: true                 // signed-in only
}
```

The GET is public (guests see their cookie-backed entries) but `POST` and
`DELETE` require login. `POST` body = `{ date, name, value }`; `DELETE` body =
`{ date, name }`. Both return the refreshed `{ entries }`.

### `GET /api/stats?days=&challengeDays=&charityMonths=`

```
{
  generatedAt, days, challengeDays, charityMonths,
  salah: {
    summary, prayers: [{ prayer, good, late, missed, other, entries }],
    daily: [{ date, logged, good, late, missed }],
    streaks, activeDays, perfectDays, ...
  },
  challenges: { ... },
  charity: { months, goals, monthly, recent, summary }
}
```

“Others” increments `other`, never `missed`.

### `GET /api/admin/banners`

```
{
  items: [{
    id, kind, title, body, ctaLabel, ctaUrl, position, revision,
    active, startsAt, endsAt, seenCount, createdAt
  }],
  totalUsers: 7
}
```

The UI renders `seenCount/totalUsers closed it` for `kind === "otb"`.

### `POST /api/banners/:id/seen`

Signed-in only. Idempotent `{ok:true}`; inserts one `BannerView` per
`(banner, user)`.

## 11. Gotchas / do-not-break

- **Two Salah date formats** exist. Accept both; write ISO. Never compare only
  long labels.
- Ayah of the Day uses **UTC** date keys; Salah/challenges use **server-local**
  date keys; timings use the location timezone. Do not unify blindly.
- Route order matters: `/api/challenges/streaks` before `/:id`;
  `/api/hadiths/bookmarks` before `/:collection`.
- **Model name must stay `Posts`.** Missing `status` means published.
- Keep `req.rawBody` for QStash and verify against `QSTASH_APP_URL`.
- Rate-limiter order: `requireLogin` before account/gap limiters; OTP target
  resolver before the email limiter.
- Guest writes need `req._salahRes`; `updateSettings` drops unknown/undefined
  keys; keep coordinate writes atomic.
- Post `isVideo` is immutable after creation.
- Banner activation keeps one active row per kind; OTB `markSeen` is
  idempotent; retrigger clears views (OTB) or bumps `revision` (sticky).
- Friend challenges: only the creator edits; start date fixed after creation;
  check-ins are bounded to rolling 7 days ∩ challenge window; other
  participants' histories are never exposed.
- Account deletion must preserve like counts and clean blobs/reports/
  notifications; env admins cannot be demoted; self-demotion blocked.
- Read paths tolerate missing/legacy fields (no migrations). Keep fallbacks.
- `OTP_DEV_ECHO` must never be enabled in production.
