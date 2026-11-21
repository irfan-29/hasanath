---
name: Hasanath / Salah Tracker
description: Use for any work in the Hasanath (formerly Salah Tracker) repository — React/Vite frontend, Express/Mongo API, auth and OTP, Salah/Qur'an/hadith/charity/challenges/posts/friends, admin banners and broadcasts, prayer-time and Ayah-of-the-Day integrations, shared CSS, PWA and Android WebView, Vercel/QStash deployment, or debugging this app.
---

# Hasanath — agent guide

Hasanath is a mobile-first Islamic companion: Salah tracker, Qur'an and hadith
reader, prayer tools, challenges, charity, stats, and a small social layer.
Motto: **Pray · Track · Grow**. This skill is the agent's entry point; load only
the reference file you need so the context window stays small.

## Repo at a glance

```
salah-tracker/
├── api/                     Express API (entry: api/app.js)
│   ├── models/              Mongoose models
│   ├── services/            Domain logic
│   ├── middleware/          Auth + rate limits
│   ├── utils/               Password, caches, QStash, guests, Qur'an, Telegram
│   └── app.js               ~3,900 lines: middleware, every route, helpers
├── frontend/                React 18 + Vite SPA
│   ├── src/App.jsx          Route map + shell providers
│   ├── src/pages/           One file per page
│   ├── src/components/      Shell, player, admin panels, shared UI
│   ├── src/hooks/           Session, favourites, notifications, share
│   ├── src/services/        api.js, accent, typography
│   └── src/styles/          base.css (generated) + shell.css
├── public/                  Shared assets: CSS canonical, fonts, icons, PWA, APK
├── scripts/                 Build gates, CSS sync, QStash, maintenance
├── docs/                    Android release notes
├── src/, res/               Native Android WebView wrapper
├── README.md                Product requirements and limits
└── .env.example             Every environment variable, documented
```

## Reading order

| Need | Read |
| --- | --- |
| Product intent, feature list, user limits, setup | Repo-root `README.md` |
| API routes, auth, models, services, exact limits | `references/backend.md` |
| React routes, providers, pages, audio, styling, PWA | `references/frontend.md` |
| Env vars, external APIs, deploy, Android, scripts | `references/operations.md` |

Do not read all three references by default. Pick the one that matches the
task, then open only the specific source files it points to.

## Stack and commands

- Node **24.x**, Express 4, Mongoose 8/MongoDB Atlas, Passport local, React 18,
  Vite 5, React Router 6. Plain CSS, no UI framework.
- API: `node api/app.js` (`npm run dev` uses nodemon). Port **3000**.
- Web: `npm run frontend:dev` (Vite, port **5173**, proxies `/api` to 3000).
- Both: `npm run dev:all`.
- Production build gate:
  `npm run frontend:build` → sync CSS → `check-react-imports` →
  `check-classnames` → `vite build`.
- If you touch CSS, edit **`public/css/styles.css`** only, then run
  `npm run frontend:sync-css` (or the full build). Never edit
  `frontend/src/styles/base.css`.

## Golden rules (do not break)

1. **Dates:** use `localDateKey()` from `frontend/src/utils/date.js` for a
   user's day. Never `toISOString().slice(0,10)`. The API accepts ISO
   `YYYY-MM-DD` **and** legacy long labels such as `Sunday, Oct 11, 2026`;
   writes normalize to ISO.
2. **Salah statuses:** `In Jamath`, `On Time`, `Late`, `Not Prayed`, `others`
   (displayed “Others”), and empty for “Not logged”. **Others counts as
   logged** and stays its own stats bucket. Keep the legacy lowercase `others`
   value; do not rename it to `other`.
3. **Status rows are plain text + chevron**, not bordered pills. Chevron aligns
   at the row's right edge, matching the date selector.
4. **Post model name is `Posts`** (plural). Missing `status` means
   **published**; legacy posts must not be rewritten.
5. **No CORS.** The frontend proxies `/api` so `connect.sid` and `salah_guest`
   stay first-party. Keep `frontend/vercel.json` rewrite order: `/api` first,
   SPA catch-all second.
6. **Banners:** exactly one active banner per kind (`otb`, `sticky`) is a
   server-enforced rule. Turning on another must warn and switch the old one
   off. Sticky dismissal key is `id:revision`; retrigger clears `BannerView`
   rows for popups and bumps `revision` for both.
7. **Sticky bar layout:** `--sticky-banner-height` is measured from the bar.
   Never set the bar's `min-height` to that same variable (feedback loop — the
   bar could not shrink after collapsing “view fully”). Add its height **on top
   of** existing bottom space, including the audio dock.
8. **Guest store:** signed `salah_guest` cookie, ~3.8 KB, sanitize/clamp on
   every read. Guest data wins when merged into an account. Keep merge caps
   (100 challenges / 400 Salah rows).
9. **Rate limits are Mongo-backed** so Vercel cold starts cannot reset them.
   Keep `requireLogin` before account-keyed post limiters.
10. **QStash** needs the raw request body (`req.rawBody`) and the configured
    `QSTASH_APP_URL` for signature verification. Do not parse before verify.
11. **Admin roots:** emails in `ADMIN_EMAILS` cannot be demoted. Nobody can
    demote themselves. Portal-granted admins live in `User.isAdmin`.
12. **`OTP_DEV_ECHO` is forbidden in production.** It only prints OTPs when
    `NODE_ENV` is `development` or `test`.
13. **Uploads:** 4 MB, one file, JPEG/PNG/WebP. Without
    `BLOB_READ_WRITE_TOKEN`, return 503 and fall back to initials.
14. **No secrets in source.** A Mongo password was committed historically; it
    must stay rotated. Run `npm run check:secrets` before committing.
15. **Android phone notifications live on the device**, not Mongo. Settings →
    Phone Notifications talks to `window.HasanathAndroid`
    (`get/setNotificationSettings`, `requestNotificationPermission`,
    `requestExactAlarms`). `services/api.js` calls
    `refreshPrayerReminders()` after `/settings` or `/auth/` writes so native
    alarms re-plan. Do not move this state to the server.
16. **Do not commit** unless the user asks. Report changed files and checks.

## Common workflows

### Add or change an API route
1. Read `references/backend.md` for the area and check `api/app.js` for a nearby
   route to copy.
2. Mount `requireLogin`/`requireAdmin` correctly; validate ObjectIds and clamp
   body fields.
3. Put queries in a service/model, not inline in `app.js`, when the logic is
   non-trivial.
4. Restart the API (nodemon does it automatically) and exercise the route with
   curl or the browser.
5. If the client calls it, add a typed helper in `frontend/src/services/api.js`.

### Add a page or component
1. Check the route map and provider nesting in `references/frontend.md`
   (`frontend/src/App.jsx`).
2. Reuse existing primitives (`Loader`, `FormSelect`, `ConfirmProvider`,
   `ToastProvider`, `Avatar`) and the page-header/gate patterns.
3. Add route entries to the correct place: auth routes outside the shell,
   shell routes inside `.main-content`.
4. New class names must exist in `public/css/styles.css` (or `shell.css`), or
   `check-classnames` will fail.
5. Run `npm run frontend:build`.

### Change styles
1. Edit `public/css/styles.css` (canonical, ~14.6k lines).
2. Follow the existing token/theme/accent structure; check both light and dark.
3. Run `npm run frontend:sync-css`, then `npm run frontend:build`.
4. Verify the affected page at desktop and 390 px.

### Work on banners
1. Read `references/backend.md` (banners service/routes) and
   `references/frontend.md` (AnnouncementBanner, BannersPanel).
2. Remember the one-live-per-kind rule and the `id:revision` dismissal key.
3. After changing the bar, test expand → collapse repeatedly; the measured
   height and page padding must return to the collapsed values.
4. Test with and without the audio dock, on `/salah` and `/posts`.

### Debug auth / sessions
- `GET /api/app/meta` is the boot payload (session, theme, accent, home,
  banners) and is `no-store`.
- Login accepts email or username; the account limiter keys on the resolved
  email.
- Signup creates no user until the OTP is verified; the pending signup lives in
  the session with a 10-minute expiry.
- `requireLogin` returns `401 {error:"login-required"}`; `requireAdmin` returns
  403.

## Verification checklist

```bash
node scripts/sync-frontend-css.js
node scripts/check-classnames.js
node scripts/check-react-imports.js
cd frontend && npm run build
```

Also useful:

```bash
npm run check:secrets
npm run verify:passwords
npm run check:email -- you@example.com
npm run qstash:schedule -- status
```

There is no automated test suite. State-changing work should be exercised
manually (API with curl, UI in a browser) and any temporary users/banners must
be removed afterwards.

## Environment essentials

- Required: `MONGO_URI`; in production also `COOKIE_SECRET`, `SESSION_SECRET`.
- Optional but needed for features: `ADMIN_EMAILS`, `TELEGRAM_BOT_TOKEN`,
  `GMAIL_*` or `RESEND_*`, `BLOB_READ_WRITE_TOKEN`, `QSTASH_*`.
- Limits/costs are documented in `.env.example` and
  `references/operations.md`: Gmail ~500/day, QStash 1,000 messages/day, Blob
  1 GB/10 GB, Vercel ~10 s and 4 MB request body.
- Default QStash sweep cron: `*/10 * * * *`, 1 retry (~144/day typical,
  288/day worst case).

## Current known issues

- Missing font files referenced by CSS: `dk-v2.woff2`, `dk-indopak.woff2`,
  `indopak-pdms.woff2`, `me-quran.woff2` are not in `public/fonts/`.
- Two OTB banners were active before the one-live rule and remain active until
  either is touched.
- No account export; no automated tests.
- Historical Mongo credential exposure — password must stay rotated.

When in doubt, prefer the existing pattern in the nearest file over a new
abstraction. This codebase values small, documented helpers and explicit
comments about *why* a rule exists.
