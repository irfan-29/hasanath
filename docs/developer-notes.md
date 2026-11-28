# Developer notes

A reference for running Hasanath: what it is built from, every outside service
it depends on, the settings each needs, and the things that are easy to forget.
Nothing secret is written here. Keys and passwords live only in Vercel's
environment variables and in your password manager.

Last reviewed: 28 November 2026.

## How the pieces fit

| Piece | What it is | Where it lives |
|---|---|---|
| Website | React + Vite, in `frontend/` | Vercel project **hasanath**, served at `https://hasanath.app` |
| API | Express, `api/app.js` | Vercel project **hasanath-api** (`hasanath-api.vercel.app`) |
| Database | MongoDB | MongoDB Atlas, free cluster in Mumbai |
| Domain and DNS | `hasanath.app` | Cloudflare (registrar and DNS) |
| Android app | A WebView shell around the website | Source in the repo root (`src/`, `res/`, `AndroidManifest.xml`, `build.sh`); the signed APK in `public/android/` |

The website sends every `/api/...` request on to the API project (a rewrite in
`frontend/vercel.json`), so the browser only ever talks to `hasanath.app`.

The older addresses `hasanath.vercel.app`, `salah-tracker-umi-apps.vercel.app`
and `www.hasanath.app` all redirect to `https://hasanath.app`.

## Accounts and what each is for

| Service | Used for | Remember |
|---|---|---|
| **Vercel** | Hosting the website and the API | Free Hobby plan: personal, non-commercial use only. A change to an environment variable applies only after a **redeploy**. |
| **MongoDB Atlas** | The database | Free cluster, 512 MB. A free cluster's region cannot be changed; moving means a new cluster and a copy. |
| **Cloudflare** | Domain registration and DNS | Auto-renew on, DNSSEC on, two-step login on. Renewal is about $14.20 a year plus GST and bank charges. |
| **Resend** | Sending OTP and notification emails from `no-reply@hasanath.app` | The domain is verified there. "Enable receiving" stays **off** (Zoho receives the mail). |
| **Zoho Mail** | The inbox `support@hasanath.app` | Free plan: web and phone app only. DMARC reports arrive here. |
| **Upstash QStash** | The timer that triggers Telegram reminders | Free tier is 1,000 messages a day; see the cost note in `.env.example` before changing the interval. |
| **Telegram (@BotFather)** | The bot that sends reminders and announcements | One shared bot; users supply their own chat id in Settings. |
| **Google Search Console** | Getting the site into Google and seeing search terms | Domain property, verified by a DNS record. Sitemap: `https://hasanath.app/sitemap.xml`. |
| **GitHub** | The code | The signing key, `.env` files and patch files must never be committed. |

## Outside services the code calls

None of these needs a key unless the table says so.

| Service | What it gives the app | Where in the code | Notes |
|---|---|---|---|
| `quranapi.pages.dev` | Surah text, audio and the list of reciters | `api/app.js`, `api/services/ayahOfDay.js` | Free, no key. |
| `fawazahmed0/quran-api` (through jsDelivr) | The translation editions: 492 editions in 98 languages | `api/app.js`, `api/services/ayahOfDay.js` | Free, no key. Pinned to version `@1`. |
| `fawazahmed0/hadith-api` (through jsDelivr) | The hadith collections | `api/utils/hadithStore.js` | Free, no key. Pinned to version `@1`. |
| AlAdhan (`api.aladhan.com`) | Prayer times, Hijri date and calendar | `api/services/prayerTimes.js`, `api/app.js` | Free, no key. |
| IslamicFinder | The list of special Islamic days | `api/utils/islamic-finder.js`, `api/app.js` | This reads a **web page**, not an API, so it is the most likely to break when that site changes its layout. |
| Open-Meteo geocoding | Searching for a city by name | `api/services/prayerTimes.js` | Free, no key. |
| BigDataCloud | Turning the phone's coordinates into a place name | `frontend/src/components/LocationPicker.jsx` | Called from the browser. Free, no key. |
| **masjidnear.me** | Masjids near a point (Masjids Nearby) | `api/services/masjids.js` | Offers its data to developers: <https://api.masjidnear.me>. See "Masjids Nearby" below. |
| OpenStreetMap Overpass | Masjids near a point, second source | `api/services/masjids.js` | Two servers are tried in turn. A shared, donated service: keep requests few. |
| OpenStreetMap tiles (with Leaflet) | The map on the Masjids Nearby page | `frontend/src/components/MasjidsMap.jsx` | Free for light use, with attribution. If traffic grows a lot, switch to a tile provider. |
| Google Maps links | Directions and place pages | `frontend/src/pages/MasjidsPage.jsx` | Plain links, no key. They open the Maps app on a phone. |
| Telegram Bot API | Sending reminders and announcements | `api/services/` | Needs `TELEGRAM_BOT_TOKEN`. |
| Upstash QStash | Calling the API on a schedule | `api/utils/qstash.js` | Needs the `QSTASH_...` settings. |
| Resend, or Gmail SMTP | Sending email | `api/services/email.js` | Chosen by `EMAIL_PROVIDER`. |
| Vercel Blob | Storing profile photos | `api/utils/avatarStore.js` | Needs `BLOB_READ_WRITE_TOKEN`; free tier is 1 GB. |
| Google Fonts, YouTube | Fonts; video posts | `frontend/` | Loaded by the browser. |

## Settings (environment variables)

All of these are set on the **hasanath-api** project in Vercel, for Production.
Names are case-sensitive and must match exactly. `.env.example` explains each
in more detail.

| Name | Needed | What it is |
|---|---|---|
| `MONGO_URI` | Yes | The Atlas connection string. The database name is the part after the last `/`; a wrong or missing name connects to an empty database and the app looks as if all data is gone. |
| `COOKIE_SECRET`, `SESSION_SECRET` | Yes | Long random strings that sign logins. Changing them signs everyone out. |
| `FRONTEND_URL` | Yes | `https://hasanath.app`. Used in share links and redirects. |
| `ADMIN_EMAILS` | Optional | Comma-separated emails that are always administrators. Others can be made admins from Admin > Users. |
| `EMAIL_PROVIDER` | Yes | `resend` (current) or `gmail`. |
| `RESEND_API_KEY` | With Resend | Starts with `re_`. The name must be exactly this. |
| `RESEND_FROM` | With Resend | `Hasanath <no-reply@hasanath.app>`. No quote marks. The address must be on the verified domain. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME` | With Gmail | Kept as a fallback. Ignored while `EMAIL_PROVIDER` is `resend`. |
| `TELEGRAM_BOT_TOKEN` | For Telegram | From @BotFather. |
| `QSTASH_TOKEN`, `QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_APP_URL`, `QSTASH_SWEEP_CRON` | For reminders | From the Upstash console. `QSTASH_APP_URL` is the **API's** address and must match exactly. |
| `BLOB_READ_WRITE_TOKEN` | For profile photos | Added by Vercel when a Blob store is connected. |
| `MASJIDNEAR_API` | Optional | Leave unset to use the masjid directory. Set to `off` to use OpenStreetMap alone. |
| `OTP_DEV_ECHO` | Never in production | Prints OTP codes to the log for local testing. |

The Vercel **function region** for hasanath-api is Mumbai (`bom1`), set in the
dashboard (Settings > Functions). It must stay in the same place as the
database: an API in one continent and a database in another makes every
request slower, not faster.

## DNS records at Cloudflare

Every record that has a proxy switch is set to **DNS only** (grey cloud).

| Purpose | Records |
|---|---|
| Website on Vercel | `CNAME @` and `CNAME www`, both to the Vercel address; two `TXT _vercel` ownership records |
| Sending email (Resend) | `TXT resend._domainkey` (DKIM); `CNAME send` and `CNAME rsend` |
| Receiving email (Zoho Mail) | Three `MX @` records; `TXT @` for SPF; a DKIM `TXT`; the Zoho verification `TXT` |
| Email policy | `TXT _dmarc`: `v=DMARC1; p=none; rua=mailto:support@hasanath.app` |
| Google Search Console | One `TXT @` verification record |

A domain may have only one SPF record on a given name. Resend's are on the
`send` and `rsend` subdomains, so they do not clash with Zoho's on `@`.

## Rules the app enforces

Most of these can be changed without touching code, at **Admin > Limits**.
Each limit is a switch plus a number: off means no limit, and 0 means zero.
Changes take effect within half a minute. Days and weeks are counted in India
time.

| Rule | Starts at |
|---|---|
| New accounts per day / per week | Off (carried over from the earlier settings) |
| Posts per person per hour | 5 |
| Gap between one person's posts | 60 seconds |
| Posts per day, whole app | Off |
| New account waits before posting | 24 hours |
| Account age before posts go to Telegram | 7 days |

Fixed in code: 3 reports hide a post until an admin reviews it; login, OTP,
contact and masjid-search requests are rate-limited (`api/middleware/rateLimits.js`).
Admins are exempt from the posting limits.

## Masjids Nearby

- Two sources are asked together and merged: the masjidnear.me directory and
  OpenStreetMap. A masjid known to both appears once.
- The directory's developer page documents `/v1/masjids/search?lat=..&lng=..&rad=..`.
  That address was not answering in November 2026, so the address its own site
  uses is called: `/v1/masjids/{lat}/{lng}/{radius}/12`. If the documented one
  starts working, `fetchDirectory()` in `api/services/masjids.js` is the one
  place to change.
- Answers are remembered for 12 hours per map cell (about 110 m), in the
  server's memory. A new deployment or a cold start clears them.
- **To switch the directory off**: set `MASJIDNEAR_API=off` on hasanath-api and
  redeploy. The page then uses OpenStreetMap alone.
- The map uses no key. Putting pins on a Google map inside the page would need
  a Google Cloud account with billing enabled.

## Android app

Full steps are in `docs/android-releases.md`. The essentials:

- Pushing source code does **not** publish an app. A release needs the signed
  APK in `public/android/`, `version.json` updated with the new version and
  checksum, and the download link on the landing page.
- The signing key (`hasanath-release.jks`) and its password are **not** in the
  repo and must never be. Without that key no update can ever be published,
  so keep a backup outside the repo.
- Installed apps check `https://hasanath.app/android/version.json` at most
  once every 6 hours, on a fresh launch. Raising `minSupportedVersionCode`
  removes the "Later" button for older versions.
- The app opens `https://hasanath.app`. A login belongs to the address it was
  made on, so changing the address signs everyone out once.

## Things that are easy to get wrong

- **Styles**: edit `public/css/styles.css`. `frontend/src/styles/base.css` is
  generated from it on every build and will be overwritten.
- **Class names**: the build fails if a class used in a component is not in
  the stylesheet. It does not catch a new class that reuses an existing name,
  which silently restyles something else. Search the stylesheet before naming
  a new class.
- **Icons**: the Material Symbols font is a subset. An icon name that is not
  already used somewhere in the app will show as text instead of a picture.
- **Patches**: `git am file.patch` then `git push`. A patch file, a loose APK
  or an extracted source folder left in the repo folder is untracked; delete
  it so a later `git add .` does not commit it.
- **Environment variables**: a wrong name fails silently (the app simply does
  not see the value). After any change, redeploy.
- **Emails not sending**: look in Vercel > hasanath-api > Logs for a line
  starting with `email:`. It states the exact reason.

## Off switches

| To do this | Do this |
|---|---|
| Stop using the masjid directory | `MASJIDNEAR_API=off`, redeploy |
| Send email through Gmail again | `EMAIL_PROVIDER=gmail`, redeploy |
| Close signups | Admin > Limits: set a signup limit to 0 |
| Stop all posting | Admin > Limits: set a post limit to 0 |
| Stop Telegram reminders being triggered | `npm run qstash:schedule -- delete` |
| Force everyone onto a new app version | Raise `minSupportedVersionCode` in `public/android/version.json` |

## Open items

- Delete the old Atlas cluster in the US after the safety week, once a final
  backup file has been taken with `mongodump`.
- Tighten DMARC from `p=none` to `p=quarantine` once a few weeks of reports
  show the app's own email passing.
- Campaigns (fundraising) was designed but put on hold; see the discussion of
  how money would flow before starting it.
- Vercel's free plan is for non-commercial use. If Hasanath ever earns money,
  move to a paid plan or another host first.
