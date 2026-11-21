# Operations, configuration and integrations

Repo-level details: environment variables, external services and their limits,
deployment, Android/PWA, scripts, and security. Never copy secret values from
`.env` into this file.

## 1. Stack and scripts

- Node **24.x** (root and frontend `package.json`).
- Root: Express 4 API, Mongoose 8, Passport local, `express-session` +
  `connect-mongo`, `express-rate-limit`, `serverless-http`, `@vercel/blob`,
  `@upstash/qstash`, `nodemailer`, `resend`, `multer`, `cheerio`.
- Frontend: React 18, Vite 5, React Router 6, `react-easy-crop`.
- Native Android WebView wrapper (Java), not Capacitor.

Root scripts (`package.json`):

| Script | Purpose |
| --- | --- |
| `start` | `node api/app.js` |
| `dev` | nodemon API (port 3000) |
| `build` | no-op for the API |
| `test` | exits 1; no test suite |
| `frontend:dev` | Vite (port 5173) |
| `frontend:build` | sync CSS → checks → Vite build |
| `frontend:sync-css` | copy canonical CSS to `frontend/src/styles/base.css` |
| `install:all` | root + frontend installs |
| `dev:all` | API + Vite concurrently |
| `qstash:schedule` | create/status/delete the QStash sweep |
| `check:secrets` | scan tracked files for leaked credentials |
| `verify:passwords` | prove PBKDF2 matches passport-local-mongoose |
| `backfill:usernames` | assign usernames to legacy accounts (dry run default) |
| `cache:compress` | Mongo Qur'an cache maintenance |
| `check:email` | send a real OTP through the configured transport |

Frontend scripts (`frontend/package.json`):

| Script | Purpose |
| --- | --- |
| `dev` | Vite dev server |
| `build` | sync CSS → `check-react-imports` → `check-classnames` → `vite build` |
| `preview` | preview the production build |

## 2. Environment variables (`.env.example`)

Copy `.env.example` to `.env` for local development; set the same names in the
Vercel projects for production. Values below are behaviour, not secrets.

### Auth and sessions
| Variable | Required | Behaviour |
| --- | --- | --- |
| `COOKIE_SECRET` | Production | Signs session and guest cookies. 48 random bytes hex recommended. Dev fallback warns. |
| `SESSION_SECRET` | Production | Session signing secret. |
| `FRONTEND_URL` | Recommended | Canonical web origin used to redirect non-API GETs. Defaults to `https://hasanath.vercel.app` in production, `http://localhost:5173` in dev. Must not be an old redirecting domain. |

### Admin
| Variable | Required | Behaviour |
| --- | --- | --- |
| `ADMIN_EMAILS` | Optional | Comma-separated root admin emails. Cannot be revoked in the portal. Blank = no root admins; portal grants still work. |

### Telegram
| Variable | Required | Behaviour |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Optional | One shared app bot from @BotFather. Users only supply their chat ID. |

### Email / OTP
| Variable | Required | Behaviour |
| --- | --- | --- |
| `EMAIL_PROVIDER` | Optional | `gmail`, `resend`, or `auto` (default; Gmail when an app password exists, else Resend). |
| `GMAIL_USER` | Gmail | Exact Gmail address authenticated. |
| `GMAIL_APP_PASSWORD` | Gmail | Requires 2FA + App Password; spaces stripped. Consumer Gmail ≈ **500 messages/day**; no SPF/DKIM, so OTP may hit spam. |
| `GMAIL_FROM_NAME` | Optional | Sender display name; default `Salah Tracker`. |
| `RESEND_API_KEY` | Resend | Resend API key. |
| `RESEND_FROM` | Resend | Must be a verified domain. `onboarding@resend.dev` only delivers to the account's own inbox. |
| `OTP_DEV_ECHO` | Dev only | Prints OTPs to the log when no transport is configured. Also gated on `NODE_ENV`; **never enable in production**. |

### Storage
| Variable | Required | Behaviour |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Optional | Vercel Blob token for avatars. Absent → upload route returns 503 and avatars fall back to initials. Hobby: **1 GB storage / 10 GB transfer per month**. Public unique URLs, 1-year cache. |

### Database
| Variable | Required | Behaviour |
| --- | --- | --- |
| `MONGO_URI` | **Yes** | MongoDB Atlas URI including the database name. The app refuses to boot without it; there is deliberately no fallback. Rotate the password — a real credential was committed historically. |

### Scheduler (Upstash QStash)
| Variable | Required | Behaviour |
| --- | --- | --- |
| `QSTASH_TOKEN` | For sweeps | QStash token. |
| `QSTASH_URL` | For sweeps | Region-specific API URL, e.g. `https://qstash-us-east-1.upstash.io`. The global endpoint rejects a regional token. |
| `QSTASH_CURRENT_SIGNING_KEY` | For sweeps | Signature verification. |
| `QSTASH_NEXT_SIGNING_KEY` | For sweeps | Key rotation. |
| `QSTASH_APP_URL` | For sweeps | Public base URL; builds the destination and is checked in the signature URL claim. Must match exactly. |
| `QSTASH_SWEEP_CRON` | Optional | Default `*/10 * * * *`. Cost math in the file: `*/10` ≈ 144/day typical, 288/day worst (29% of the 1,000/day free tier); `*/15` 96/192; `*/5` 288/576. Never finer than `*/5` without redoing the math. |

### Frontend-only
| Variable | Default | Behaviour |
| --- | --- | --- |
| `VITE_UMI_APPS_URL` | `https://umiapps.vercel.app` | Studio link on the landing page. |
| `BACKEND_ORIGIN` | `http://localhost:3000` | Vite dev proxy target for `/api`. |

### Dev-only
`OTP_DEV_ECHO` is the only flag that echoes secrets. The startup log reports
provider/configured/problem but never tokens or passwords.

## 3. Deployment

### API (repo root)
- `vercel.json`: `@vercel/node` builds `api/app.js`; all routes go to it.
- `serverless-http` exports `handler`; locally `app.listen(3000)`.
- Vercel Hobby constraints noted in the repo: ~**10 s** function invocation and
  a **4 MB** request body limit. No native sub-daily cron on Hobby, hence
  QStash.
- Fresh containers per invocation mean all counters/sessions/caches must live
  in Mongo, not memory.

### Frontend (`frontend/`)
- `frontend/vercel.json`: Vite build, `dist` output.
- Rewrites in this exact order:
  1. `/api/:path*` → `https://hasanath-api.vercel.app/api/:path*`
  2. `/:path*` → `/index.html`
- The order is load-bearing: if the SPA catch-all wins, API calls return HTML.
- The API destination must answer **directly**, not redirect; a redirect makes
  the follow-up cross-origin and breaks cookies.
- Same-origin proxy keeps `connect.sid` and `salah_guest` first-party; there is
  no CORS anywhere.
- Headers: `sw.js` no-store + `Service-Worker-Allowed: /`;
  `manifest.webmanifest` no-cache; `assetlinks.json` CORS `*`;
  `android/version.json` no-store; APKs `application/vnd.android.package-archive`
  + attachment.
- `frontend/vercel.md` explains all of this; keep it beside `vercel.json`
  because Vercel rejects comment keys in JSON.

### Recommended deploy order
1. Set env vars in both Vercel projects.
2. Deploy the API.
3. Deploy the frontend.
4. `npm run qstash:schedule -- create` once.
5. Verify `/api/app/meta`, login, OTP mail, and one QStash sweep.

## 4. Android wrapper

Files: `AndroidManifest.xml`, `build.sh`, `src/app/hasanath/`, `res/`,
`docs/android-releases.md`, `public/android/version.json`,

- Package `app.hasanath`; native Java WebView loading
  `https://hasanath.vercel.app/`; JS bridge `HasanathAndroid`; custom splash;
  file chooser; external links; saved session cookie for background requests.
- Manifest: `allowBackup=false`, `usesCleartextTraffic=false`, `SingleTask`
  activity, portrait/orientation config. Permissions: INTERNET, network state,
  foreground/media playback service, wake lock, notifications, request install
  packages, boot completed, exact alarm.
- Receivers: updater result; prayer-reminder rescheduling on boot/time/
  timezone/app update/exact-alarm permission.
- Services: `NotificationPoller` (JobService, ~15 min) and `MediaService`.
- App Links: `autoVerify` for `hasanath.vercel.app`; the API host is restricted
  to `/post/`, `/u/`, `/surah`, `/posts`, `/quran`, `/salah`, `/challenges`;
  `hasanath.app`/`www` are declared but not yet auto-verified.
- `public/.well-known/assetlinks.json` and a direct API route serve the
  fingerprint.
- `res/`: adaptive launcher icon, legacy mipmaps, white notification icon in
  all densities, splash logo/artwork, six accent splash themes, Android 12
  splash API, `app_name` = Hasanath.
- `build.sh`: needs `ANDROID_JAR` API 34; aapt2, javac Java 8, d8/dalvik-exchange,
  zipalign. **Does not sign**; releases must use the same
  `hasanath-release.jks` key or Android rejects the update.
- In-app updates: app checks
  `https://hasanath.vercel.app/android/version.json` at most every **6 hours**,
  downloads over HTTPS, verifies SHA-256, hands to the installer.
- Phone Notifications: the Settings panel is Android-only and talks to the
  native bridge, not the API. Prayer reminders are native exact alarms from the
  Salah Timings location (on the minute, offline); friend/announcement alerts
  poll the in-app notification list in the background. The preferences live on
  the phone, and `frontend/src/services/api.js` calls
  `refreshPrayerReminders()` after `/settings` or `/auth/` writes.
- `version.json` fields: `versionCode`, `versionName`, `apkUrl`, `sha256`,
  `notes`, `minSupportedVersionCode` (forces update when raised).

### Release checklist
1. Raise `versionCode` (at least +1) and `versionName` in `AndroidManifest.xml`
   **and** `build.sh`.
2. Build and sign with the same key.
3. Copy the APK to `public/android/Hasanath-<version>.apk`.
4. Update `public/android/version.json` (`versionCode`, `versionName`,
   `apkUrl`, `sha256` from `sha256sum`, `notes`, `minSupportedVersionCode`).
5. Update `ANDROID_APP` at the top of `frontend/src/pages/LandingPage.jsx`
   (version, size, href). It is not read from `version.json`.
6. Commit and push.

**Current release:** versionCode **9** / versionName **1.8**.
`AndroidManifest.xml`, `build.sh`, `public/android/version.json`,
`public/android/Hasanath-1.8.apk` and `LandingPage.jsx` all agree. Keep those
five in sync for the next release.

## 5. PWA

- `public/manifest.webmanifest`: standalone; start/scope `/`; name
  “Hasanath — Qur'an, Salah & Good Deeds”; short name “Hasanath”; theme
  `#092b27`; background `#f8fafc`; 192/512 any + maskable; shortcuts `/salah`,
  `/quran`, `/salah-timings`.
- `public/sw.js` VERSION `v1`: precaches `/`, manifest and icon-192; deletes
  old `hasanath-*`; bypasses non-GET, Range, cross-origin, `/api/*`,
  `/.well-known/*`; network-first navigations with cached shell + 503 offline;
  cache-first `/assets/*`; stale-while-revalidate fonts/images/icons/css.
- Registered only in production, after `load`.
- Bump `VERSION` when caching rules change. No custom install/update prompt.

## 6. Scripts (`scripts/`)

| Script | Purpose |
| --- | --- |
| `backfill-usernames.js` | Assign usernames to legacy accounts; dry-run default, `--apply` to write; idempotent. |
| `build-icon-font.js` | Rebuild the Material Symbols Rounded subset from `icon-names.txt`; bump the versioned filename and `@font-face`/preload when adding icons. |
| `check-classnames.js` | Build gate: every React `className` must exist in app CSS or the Bootstrap/template snapshots. |
| `check-email.js` | Send a real OTP through the configured transport: `npm run check:email -- you@example.com`. |
| `check-react-imports.js` | Build gate: hooks used but not imported, hooks after early returns, unbound identifiers. |
| `check-secrets.js` | Scan tracked files for Mongo/Telegram/QStash/generic secrets. Run before commit. |
| `compress-cache.js` | One-off `qurancaches` cleanup: dedupe, unique key index, partial TTL, clear bad TTLs, gzip. `--dry-run`, `--rebuild`. |
| `qstash-schedule.js` | CLI `status|create|delete` for the sweep; `create` is an upsert. |
| `refresh-bootstrap-classes.js` | Regenerate the Bootstrap class allowlist after a version bump. |
| `seed-hadiths.js` | Warm the hadith cache from jsDelivr; idempotent. |
| `snapshot-template-classes.js` | Rebuild the legacy EJS class allowlist from a git ref. |
| `sync-frontend-css.js` | Copy `public/css/styles.css` → `frontend/src/styles/base.css`; runs in builds. |
| `verify-password-compat.js` | Prove the custom PBKDF2 matches passport-local-mongoose after upgrades. |

## 7. External services and free-tier limits

| Service | Used for | Notes / limits |
| --- | --- | --- |
| MongoDB Atlas | Users, posts, sessions, rate limits, `qurancaches`, everything | Required. Free tier is enough for a personal app. Password must stay rotated. |
| Vercel Blob | Avatars | Hobby **1 GB storage / 10 GB transfer per month**; 4 MB upload; public URLs; 1-year cache. |
| Upstash QStash | Scheduled `/api/qstash/sweep` | Free **1,000 messages/day**; retries are billed; **10** active schedules; 1 retry configured. Cron math above. |
| Gmail SMTP | Signup/reset OTP | ≈ **500 messages/day**; requires 2FA + App Password; spam risk without SPF/DKIM. |
| Resend | Alternative OTP mail | Better deliverability; requires a verified domain. |
| Telegram Bot API | User notifications | Shared bot; `sendMessage`/`getMe`; hard limit 4,096 chars, app truncates at 4,000. |
| `quranapi.pages.dev` | Surah metadata/text/audio/reciters | Timeout 5 s; cached in Mongo. |
| `cdn.jsdelivr.net` (`fawazahmed0/quran-api`) | Qur'an translations/edition catalogue | Immutable hosts cached indefinitely. |
| `cdn.jsdelivr.net` (`fawazahmed0/hadith-api`) | Hadith editions | Timeout 30 s; cache warmed by `seed-hadiths`. |
| `api.aladhan.com` | Prayer timings, Hijri conversions | No key. |
| `geocoding-api.open-meteo.com` | City search | Server-side, no key. |
| `api.bigdatacloud.net` | Client reverse geocode | Browser-side, no key. |
| `www.islamicfinder.org` | Special Islamic days | Scraped with browser UA/Referer; 6 s timeout. |
| Google Fonts | Build-time Material Symbols subset | Runtime fonts are self-hosted (`public/fonts`). |
| YouTube | Embedded video posts | `youtube.com/embed`, `youtu.be` links. |

No Redis is used despite `@upstash/redis` being installed.

## 8. Security and privacy

- `.gitignore` excludes `node_modules/`, `.env`, `.env.local`, logs,
  `frontend/dist`, `frontend/node_modules`, `frontend/.vite`,
  `__mobile-preview.html`.
- **Historical exposure:** a real Atlas password lived in `api/app.js` in a
  public repo. Rotate it; deleting it from the tree does not remove git
  history. `check-secrets` says the same.
- Secrets policy: no hard-coded `MONGO_URI` fallback; production requires
  cookie/session secrets; startup email summary never prints tokens/passwords;
  `ADMIN_EMAILS` are roots; `OTP_DEV_ECHO` forbidden in production.
- Session: Mongo-backed 30 days, httpOnly, lax, secure-auto in production,
  `trust proxy 1`; logout destroys the session.
- Guest cookie: signed `salah_guest`, ~3.8 KB, whitelist/sanitize every field,
  merged into the account on login.
- Uploads: multer memory, 4 MB, one file, JPEG/PNG/WebP; client crops 512 px;
  public Blob URL; 503 without a token.
- URL validation: admin banner/broadcast links allow only `/` paths (not `//`)
  or `http(s)://`; `javascript:` is rejected (`cleanAdminUrl`).
- Rate limits are Mongo-backed so cold starts cannot reset them.
- Android: cleartext disabled, backups disabled, App Links verified, receivers/
  services not exported.

## 9. Other operational details

- **Fonts:** `public/fonts/` ships QPC Hafs, QPC Nastaleeq, Indopak Nastaleeq
  and versioned Material Symbols. The stylesheet also references
  `dk-v2.woff2`, `dk-indopak.woff2`, `indopak-pdms.woff2` and
  `me-quran.woff2`, which are **missing**. Either add them or remove the unused
  `@font-face` blocks.
- **Icon font:** subset from `scripts/icon-names.txt`; versioned filenames avoid
  stale caching; update the preload/`@font-face` when rebuilding.
- **Mongo cache:** values gzipped at ≥512 bytes; unique `key` index + partial
  `expiresAt` TTL; `scripts/compress-cache.js` for maintenance.
- **Passwords:** PBKDF2-SHA256, 25,000 iterations, 512-byte key, 32-byte salt;
  verify after dependency upgrades.
- **Usernames:** unique sparse, lowercase `[a-z0-9._]`, 3–30, reserved list,
  numeric suffix allocation; `backfill-usernames` for legacy accounts.
- **Email diagnostics:** `npm run check:email -- <address>`; startup log reports
  provider/configured/problem only.
- **Vercel body limit** is why uploads cap at 4 MB; keep it in mind for any new
  file upload.
