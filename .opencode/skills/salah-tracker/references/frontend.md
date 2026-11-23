# Frontend reference (`frontend/src`, `public/css`)

React 18 + Vite 5 SPA. Plain CSS. This file is the map; read the named files
for detail.

## 1. Route map

Source: `frontend/src/App.jsx`.

| Path | Component | Notes |
| --- | --- | --- |
| `/` | `LandingPage` | Guests see marketing. Signed-in users are redirected to `homePath` (fallback `/quran`). |
| `/login` | `AuthPage mode=login` | Outside the shell, standalone card. |
| `/register` | `AuthPage mode=register` | Outside the shell. |
| `/verify-email` | `AuthPage mode=verify` | Outside the shell. |
| `/forgot-password` | `AuthPage mode=forgot` | Outside the shell. |
| `/reset-password` | `AuthPage mode=reset` | Outside the shell. |
| `/quran` | `QuranPage` | Audio / Read / Bookmarks tabs from the hash. |
| `/hadith` | `HadithPage` | Collection grid + bookmarks. |
| `/hadith/:collection` | `HadithBookPage` | Reader with section/page/language state. |
| `/surah/:surahNo` | `SurahPage` | Reader, `?ayah=` deep link. |
| `/challenges` | `ChallengesPage` | Personal + friend challenges. |
| `/charity` | `CharityPage` | Account only. |
| `/stats` | `StatsPage` | Account only. |
| `/salah` | `SalahPage` | Account only. |
| `/posts` | `PostsPage` | Feed + composer. |
| `/post/:id` | `PostPage` | Permalink. |
| `/u/:username` | `ProfilePage` | Public profile. |
| `/settings` | `SettingsPage` | Preferences. |
| `/account` | `AccountPage` | Identity, password, deletion. |
| `/admin` | `AdminPage` | Unlisted; `AdminLogin` for non-admins. |
| `/notifications` | `NotificationsPage` | Account only. |
| `/salah-timings` | `SalahTimingsPage` | Date/location/method. |
| `/qibla` | `QiblaPage` | Compass. |
| `/calendar` | `CalendarPage` | Hijri/Gregorian. |
| `*` | `NotFound` | In-app 404. |

Auth routes are checked **before** the `booted` loader gate, so the sign-in card
paints without waiting for `/api/app/meta`; the theme applies once meta arrives.

## 2. Shell and providers

Files: `main.jsx`, `App.jsx`, `components/Navbar.jsx`, `components/TabBar.jsx`.

- `main.jsx`: `StrictMode` → `ErrorBoundary` → `BrowserRouter` → `App`.
  Imports generated `styles/base.css` then `styles/shell.css`. Removes the
  inline `#boot-loader` after two `requestAnimationFrame`s. Registers `/sw.js`
  only when `import.meta.env.PROD`.
- `App` = `AudioProvider` → `Shell`. The audio provider sits **above**
  `<Routes>` on purpose: navigation must not destroy the single `<audio>`.
- Provider nesting inside `Shell`: `SessionProvider` → `NotificationProvider`
  → `ToastProvider` → `ConfirmProvider` → `Navbar`,
  `AnnouncementBanner`, `.main-content` with `<Routes>`, then `Player` and
  `TabBar`.
- Desktop: fixed 280 px sidebar, 80 px collapsed; `.main-content` offset.
  ≤1024 px the sidebar becomes a top app bar; the drawer is retired.
- Fixed footer `TabBar`: Challenges, Salah, centered Qur'an, Posts, More. The
  More sheet is portaled; Timings/Qibla/Admin live elsewhere.
- `AnnouncementBanner` renders the sticky bar and one-time popup. `Player` and
  `TabBar` stack as one mobile chrome column. Auth routes render without
  navbar/footer.
- Route changes scroll to top before paint.

## 3. Session, meta and theme

Files: `hooks/useSession.jsx`, `App.jsx`, `api/app.js` `/api/app/meta`.

`/api/app/meta` returns:

```
{
  session: { isLoggedIn, username, displayName, avatarUrl, isAdmin },
  theme, accent, defaultHome, homePath,
  appFont, appFontSize, quranFontSize,
  banners: { sticky: [...], otb: {...}|null }
}
```

- `Cache-Control: no-store`.
- `session.displayName` is resolved server-side (`name` → `username` → email
  local-part → `friend`). The navbar greets with it and shows `@username` below;
  pages use `personName`/`personHandle` from `utils/personalization.js` for the
  same split. `username` remains the unique handle and profile route key.
- `useSession()` returns the context or a `FALLBACK`: `isLoggedIn: null`,
  no-op setters, `banners: {sticky: [], otb: null}`. `null` means unknown,
  distinct from signed out.
- The shell holds `meta = null` until boot succeeds or fails; no navbar/theme
  is guessed meanwhile. `refresh()` re-reads meta in place.
- `setTheme` writes `data-theme`, syncs `<meta name="theme-color">`, persists
  `salah-theme`, updates meta without looping.
- `setAccent` applies the palette and persists `salah-accent`. Typography
  applies the font and two scale variables and persists them.
- `homePath` comes from the server `HOME_PATHS` map (`salah`, `quran`, `audio`,
  `salah-tracker`, `salah-timings`, `challenges`, `charity`, `stats`, `posts`,
  `settings`); unmapped values fall back to `/quran`.
- `dismissOtb(id)` removes only the matching banner optimistically, then calls
  `banners.seen(id)`. If the request fails, the popup resurfaces on next boot.

## 4. API layer

File: `services/api.js`.

- One fetch wrapper: `BASE = '/api'`, `credentials: 'same-origin'`.
  JSON body unless `FormData` (no manual multipart header). Parses text;
  non-JSON throws `ApiError`; error messages prefer server `error`/`message`.
  Retries a GET once after **700 ms** on 502/503/504 only; never retries writes.
- After a non-GET `/settings*` or `/auth/*` request, `request()` calls the
  native `window.HasanathAndroid.refreshPrayerReminders()` when present, so
  phone alarms re-plan after a settings save or sign-in/out.
- `api`: `request`, `get`, `post`, `delete`.
- `quran`: `index`, `randomAyah`, `surah`, `reciters`, `audio`,
  `saveReciter`, `favourites`, `progress`, `saveProgress`, `clearProgress`,
  `toggleFavourite`.
- `hadiths`: `collections`, `collection`, `section`, `find`, `bookmarks`,
  `toggleBookmark`.
- `challenges`: `list`, `create`, `rename`, `remove`, `checkin`,
  `saveStreaks`.
- `salah`: `list`, `record`, `clear`.
- `posts`: `list`, `create`, `one`, `update`, `remove`, `toggleLike`,
  `profile`, `report`, `block`, `unblock`, `blocks`.
- `moderation`: `queue`, `approve`, `reject`.
- `admin`: `login`, `stats`, `users`, `setUserAdmin`, `banners`,
  `createBanner`, `updateBanner`, `removeBanner`, `retriggerBanner`,
  `broadcasts`, `sendBroadcast`.
- `banners.seen`.
- `friends`: `list`, `suggestions`, `search`, `request`, `accept`, `decline`,
  `remove`, `respondChallenge`.
- `notifications`: `list`, `count`, `read`, `readAll`.
- `friendChallenges`: `list`, `create`, `respond`, `update`, `checkin`,
  `remove`.
- `account`: `me`, `uploadAvatar`, `removeAvatar`.
- `settings.get`.
- `locations.search`.
- `charity`: `list`, `create`, `update`, `remove`, `donate`,
  `updateDonation`, `removeDonation`.
- `stats.get`.

## 5. Pages at a glance

Files: `pages/`.

- **LandingPage** — marketing shell, interactive Salah preview, live Ayah of
  the Day, theme/accent pickers, guest CTA (`homePath || /quran`), Android APK
  download (`ANDROID_APP` constant), skip link, reduced-motion support.
- **AuthPage** — one component for login/register/verify/forgot/reset; rate
  limit messages, 6-digit code, resend cooldown, `returnTo`; success uses a full
  reload to `/` so the session cookie and meta boot are re-read.
- **QuranPage** — Audio/Read/Bookmarks tabs, hash-seeded tab, index + active
  reciter load, favourites hook, play-surah resolution.
- **SurahPage** — reader with `?ayah=` deep link, range slider, sticky compact
  bar via `IntersectionObserver`, share/copy, bookmark toggle, all translations
  with a primary marker, previous/next surah.
- **HadithPage** — collection grid + bookmark tab with sign-in gate.
- **HadithBookPage** — collection manifest, section chips, pagination,
  language chips persisted in `salah-hadith-lang`, `?no=`/jump-to-number
  resolution, highlight, share/copy, bookmark.
- **SalahPage** — account only; local-date selector, SVG progress ring,
  immediate status writes for Fajr/Zuhur/Asar/Magrib/Isha (`In Jamath`,
  `On Time`, `Late`, `Not Prayed`, `others`), “Not logged” deletes, refresh,
  toast.
- **CharityPage** — account only; targets with daily/weekly/monthly/yearly
  periods, progress, donations add/edit/delete, duplicate-name error, confirm
  dialogs, local-date defaults.
- **StatsPage** — account only; independent ranges for Salah/challenges/
  charity, CSS-only bars, client-side recent-giving sort; each filter reloads
  the report but dims only its section.
- **SalahTimingsPage** — date, location, calculation method, Asr school; each
  change saves then refetches; latest-request guard; empty location state;
  method note.
- **QiblaPage** — great-circle bearing/distance to the Kaaba, GPS then saved
  coordinates, iOS compass permission gesture, 72-tick dial, alignment state.
- **CalendarPage** — Hijri/Gregorian month grid, navigation, special-days
  table.
- **PostsPage / PostPage / ProfilePage** — feed + liked filter + composer; text
  or YouTube-ID post; like/report/block/edit/delete menus; permalink; profile
  with friendship states, suggestions/search, block/unblock, post/friends tabs.
  Authors and friend rows show the display name first with the unique
  `@handle` beside it.
- **NotificationsPage** — event feed, unread state, mark-all-read,
  accept/decline friend and challenge invitations.
- **AccountPage** — avatar cropper/upload/remove, display-name edit (no
  password; empty falls back to the username), username edit with password,
  email/verified state, password change modal, blocked-account undo,
  password-confirmed deletion.
- **SettingsPage** — theme, six accents, app font, app/Qur'an text sizes
  (Set then reload), default home, Qur'an font/reciter, edition picker/primary
  translation, location, calculation method, Asr, time format, Telegram
  modules, and **Phone Notifications** (Android app only).
- **AdminPage** — unlisted; non-admins see `AdminLogin`; query-string tabs:
  Overview, Moderation, Broadcast, Banners, Users. Broadcast and Banners forms
  accept `${user}` and render a live sample with `previewUserPlaceholder`.
- **NotFound** — in-app 404 with a link to Qur'an.
- **AnnouncementBanner / ToastProvider / ConfirmProvider** — global sticky/OTB,
  `role="status"` toasts, promise-based alert dialog.

## 6. Audio system

Files: `components/AudioProvider.jsx`, `components/Player.jsx`.

- One `new Audio()` held in a ref for the app lifetime. Context exposes `play`,
  `load`, `toggle`, `pause`, `seek`, `close`, `savePosition`, `skip`, loop,
  rate, sleep, progress.
- `play` resets `dismissing`, preserves `reciterId`, loads URL/startAt, replays
  loop allowance on a new surah. `load` attaches metadata before applying saved
  position and never autoplays.
- Loop cycles 0→1→2→3→0; replay-before-drain. Rates
  `[0.5, 0.75, 1, 1.25, 1.5, 2]`. Sleep modes: off, 15/30/45/60 min,
  end-of-surah; countdown pauses without closing.
- On `ended`: replay if loops remain; end-of-surah mode stops; otherwise
  auto-advance while `surahNo < 114`; else stop.
- Progress is persisted server-side via `/quran/progress`, throttled ~5 s, and
  forced on pause/pagehide/visibilitychange. `close()` sets `dismissing`
  before `pause()` so the pause handler cannot resurrect the bar, clears
  state/timers, then fire-and-forget clears server progress.
- `Player` restores saved progress once on mount via `quran.progress()` and
  `load()` (no autoplay). Dock: prev/play/next, loop badge, speed, sleep, close,
  pointer/keyboard scrub; menus portal to body, flip above the dock, close on
  Escape/outside, restore focus.
- Media Session metadata/actions + Android bridge
  (`window.HasanathAndroid.media`, callback `window.__hasanathMedia`) for
  lock-screen/native notifications. No audio in localStorage.

## 7. Qur'an tabs, favourites, sharing

Files: `pages/QuranPage.jsx`, `pages/SurahPage.jsx`,
`components/quran/*`, `hooks/useFavourites.js`, `hooks/useHadithBookmarks.js`.

- **Read tab:** Ayah of the Day card with share, open-in-reader, random-ayah
  refresh, back-to-daily; “Continue Reading” pills; searchable 114-surah grid.
  `randomAyah` is local/transient, so revisiting restores the stored daily
  ayah.
- **Audio tab:** reciter select saves the server preference; searchable surah
  list; per-surah loading state.
- **Bookmarks tab:** signed-out gate; entries rendered like reader ayahs with
  open/remove actions. `useFavourites` loads once, treats 401 as empty, toggles
  optimistically with rollback + reload; `useHadithBookmarks` mirrors it.
- **Share:** native `navigator.share` first, clipboard fallback, URL
  `.../surah/:no?ayah=:n` last in the text; per-ayah 1.8 s status. Hadith share
  uses `?no=`.
- Ayah of the Day is server-selected; `quran.randomAyah()` is not stored.
- `favouriteKeys` in the surah payload seed hearts before the hook loads; the
  hook state then takes over.

## 7.1 Phone notifications (Android)

File: `components/PhoneNotifications.jsx`, rendered from `SettingsPage`.

- Renders **nothing** outside the Android app. It talks to
  `window.HasanathAndroid` instead of the API:
  `getNotificationSettings()`, `setNotificationSettings(json)`,
  `requestNotificationPermission()`, `requestExactAlarms()`.
- State lives **on the phone**, not Mongo: per-prayer toggles, prayer timing
  (`at`, `before` = 10 minutes before, `both`), and friend/announcement alert
  preferences.
- Prayer reminders are native alarms scheduled from the user's Salah Timings
  location. They fire on the minute and work offline; exact-alarm permission is
  requested when Android would otherwise batch them.
- Friend and announcement alerts come from the app checking the in-app
  notification list in the background.
- Re-reads settings on `visibilitychange` because permissions can change in
  Android settings while the app is backgrounded.
- `services/api.js` calls `refreshPrayerReminders()` after `/settings` or
  `/auth/` writes so native alarms re-plan after a location/method change or a
  sign-in/out.

## 8. Styling architecture

Files: `public/css/styles.css` (canonical), `frontend/src/styles/base.css`
(generated), `frontend/src/styles/shell.css`.

- Canonical stylesheet is **`public/css/styles.css`** (~14.6k lines), copied to
  `frontend/src/styles/base.css` by `scripts/sync-frontend-css.js`. **Never edit
  `base.css`.**
- Design tokens in `:root`; dark theme via `[data-theme="dark"]`; six accent
  palettes via `[data-accent]` with paired dark overrides; accent-dependent
  `--accent-fill-*` and chrome variables; `--app-font-scale`,
  `--quran-font-scale`; app font via `html[data-app-font]`.
- Shared conventions: `.container1`, `.is-flat`, `.page-header`,
  `.gate-notice`, `.custom-selector`, `.ayah-block`, `.surah-pager`,
  `.sticky-banner`, `.tabbar`, `.global-audio-bar`. React-only additions belong
  in `shell.css` (audio list, Loader).
- Bootstrap is loaded from `/vendor/bootstrap.min.css`; Material Symbols is
  self-hosted/preloaded; the icon subset list is `scripts/icon-names.txt`.
- Responsive: main app at 1024/768/600/1200; landing at
  1080/980/900/780/700/640/560/400. Reduced-motion rules exist in both
  stylesheets.
- Sticky banner height is measured into `--sticky-banner-height`; the tab bar
  and player respect safe-area insets.
- Build gates: `sync-frontend-css.js` → `check-react-imports.js` →
  `check-classnames.js` → `vite build`.
- `check-classnames.js` rejects any `className` absent from `styles.css`,
  generated `base.css`, `shell.css`, the Bootstrap class snapshot, the template
  class snapshot, or a tiny runtime allow list.
- `check-react-imports.js` uses a Babel AST to reject missing hook imports,
  hooks after early returns in the same function, and unbound identifiers.

## 9. PWA and service worker

Files: `public/sw.js`, `public/manifest.webmanifest`, `frontend/index.html`,
`frontend/src/main.jsx`.

- Manifest: standalone; start/scope `/`; theme `#092b27`; background
  `#f8fafc`; 192/512 + maskable icons; shortcuts `/salah`, `/quran`,
  `/salah-timings`.
- SW registered production-only after `load`. Cache version `v1`; install
  precaches `/`, the manifest and the 192 icon; activate deletes old
  `hasanath-*` caches and claims clients.
- Never handles non-GET, Range requests, cross-origin, `/api/*` or
  `/.well-known/*`.
- Navigations: network-first, fallback cached `/`, then inline 503 offline HTML.
  `/assets/*`: cache-first. `/fonts|images|icons|css/*`:
  stale-while-revalidate. No personal data is cached.
- No custom install prompt. Android distribution is the direct APK; PWA
  installability comes from manifest + SW.

## 10. Persistence, dates, accessibility, quirks

- localStorage keys: `salah-theme`, `salah-accent`, `salah-appfont`,
  `salah-appscale`, `salah-qscale`, `salah-sticky-dismissed` (stored as
  `id:revision`), `salah-hadith-lang`. No `sessionStorage` use.
- A pre-paint inline script in `index.html` duplicates the theme/accent/font/
  scale keys and replays them before bundles. `THEME_STORAGE_KEY` is duplicated
  in `useSession.jsx` and `index.html`; keep both in sync.
- Settings and Qur'an audio position are server-side. Android Phone
  Notification preferences are the exception: they live on the device through
  `window.HasanathAndroid`. Theme/accent are optimistic; failed saves roll the
  paint back. Text-size changes are not live: pressing Set saves and reloads.
  Guest theme/accent writes go to the guest store.
- Reader state is URL-query-driven (`?ayah`, `?section`, `?page`, `?no`) for
  shareability; hadith language is localStorage.
- **Dates:** never use `toISOString()` for local days. Use `localDateKey()` in
  `frontend/src/utils/date.js`; challenge day keys are parsed at `T12:00:00` to
  avoid timezone shifts. Sort timestamps with `Date.parse`, not string compare.
- Audio close must set `dismissing` before `pause()`; otherwise the pause
  persistence handler resurrects the dismissed dock. Both `play()` and `load()`
  reset the guard.
- Accessibility: semantic tabs/roles, `aria-selected`, `aria-current`,
  `aria-expanded/haspopup`, `aria-pressed`, labelled dialogs, Escape/outside
  dismissal, focus restoration in menus, portal overlays, body scroll lock,
  `aria-live` toasts and boot/status text, skip link, reduced-motion rules,
  RTL `dir`/`lang` for Arabic/Urdu. Focus is restored mainly in popovers/dialogs,
  not centrally per route.
- Potential private-mode issue: most localStorage reads are wrapped in
  try/catch, but `HadithBookPage` reads the language key directly in state
  initialization.
