// Thin fetch wrapper over the backend.
//
// Same-origin on purpose. The frontend calls /api/* on its own domain and Vercel
// rewrites those to the Express backend, so requests never leave the origin and
// the session cookie plus the signed guest cookie are sent automatically.
//
// This is the one deliberate divergence from the nafahperfumes frontend, which
// points axios straight at the backend URL with `withCredentials: false` and a
// Bearer token in localStorage. That is fine there because it has no cookies;
// this app does, and a cross-origin call would force SameSite=None and break
// the guest store that holds a signed-out visitor's data.

const BASE = '/api';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, formData, signal, retried = false } = {}) {
  const response = await fetch(BASE + path, {
    method,
    // Explicit even though same-origin: it documents the requirement and keeps
    // this working if the backend is ever called cross-origin.
    credentials: 'same-origin',
    // A FormData body must not get a Content-Type header: the browser adds the
    // multipart boundary itself, and overriding it would make the upload
    // unparseable on the server.
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: formData || (body ? JSON.stringify(body) : undefined),
    signal,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      // A non-JSON body means we hit a page route rather than an API route.
      // Surfacing it as an error is more useful than silently passing on HTML.
      throw new ApiError(`Unexpected non-JSON response (${response.status})`, response.status, text.slice(0, 200));
    }
  }

  if (!response.ok) {
    // 502/503/504 from the platform are usually a cold start or a deploy blip,
    // not a real answer. Retrying a GET once turns "Request failed" into a
    // slightly slower page. Writes are never retried: they may have landed.
    if (!retried && method === 'GET' && [502, 503, 504].includes(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return request(path, { method, body, formData, signal, retried: true });
    }

    // Prefer the server's human-readable message; fall back to something that
    // does not just repeat the status code, which told the reader nothing.
    const raw = payload && (payload.message || payload.error);
    const fallback = response.status >= 500
      ? 'Something went wrong on our side. Please try again.'
      : `Request failed (${response.status})`;
    const message = (typeof raw === 'string' && raw && raw !== 'failed') ? raw : fallback;
    throw new ApiError(message, response.status, payload);
  }

  // In the Android app, prayer reminders are scheduled on the phone from the
  // user's Salah Timings settings. A settings save or a sign-in/out can change
  // the location, method or account, so let the app re-schedule them.
  if (method !== 'GET' && (path.startsWith('/settings') || path.startsWith('/auth/'))) {
    try {
      const native = typeof window !== 'undefined' && window.HasanathAndroid;
      if (native && typeof native.refreshPrayerReminders === 'function') native.refreshPrayerReminders();
    } catch (err) { /* not in the app, or an older app version */ }
  }

  return payload;
}

export const api = {
  request,
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  delete: (path, body, opts) => request(path, { ...opts, method: 'DELETE', body }),
};

// ---- Quran module --------------------------------------------------------

export const quran = {
  index: () => api.get('/quran/index'),
  // Transient: the server picks a surah and ayah at random and does not store
  // it, so the daily ayah is unchanged when the page is opened again.
  randomAyah: () => api.get('/quran/random-ayah'),
  surah: (no) => api.get(`/quran/surah/${no}`),
  reciters: () => api.get('/quran/reciters'),
  audio: (surahNo, reciter) =>
    api.get(`/quran/audio?surahNo=${encodeURIComponent(surahNo)}` + (reciter ? `&reciter=${encodeURIComponent(reciter)}` : '')),
  saveReciter: (reciter) => api.post('/quran/reciter', { reciter }),
  // The exact verse the reader is on, written as the single-ayah view moves.
  // Guests are allowed: the server stores it in the signed cookie.
  saveLastRead: (surahNo, ayahNo) => api.post('/quran/last-read', { surahNo, ayahNo }),
  favourites: () => api.get('/quran/favourites'),
  progress: () => api.get('/quran/progress'),
  saveProgress: (payload) => api.post('/quran/progress', payload),
  // Told to the server when the player is dismissed, so the next page load does
  // not restore a bar the user just closed. See AudioProvider.close().
  clearProgress: () => api.request('/quran/progress', { method: 'DELETE' }),
  toggleFavourite: (surahNo, ayahNo) => api.post('/quran/favourites/toggle', { surahNo, ayahNo }),
};

// ---- Hadith module --------------------------------------------------------

export const hadiths = {
  collections: () => api.get('/hadiths/collections'),
  collection: (id) => api.get(`/hadiths/${encodeURIComponent(id)}`),
  section: (id, sectionId, { page = 1, per = 25, lang = 'eng' } = {}) =>
    api.get(`/hadiths/${encodeURIComponent(id)}/section/${encodeURIComponent(sectionId)}?page=${page}&per=${per}&lang=${encodeURIComponent(lang)}`),
  find: (id, no, per = 25) =>
    api.get(`/hadiths/${encodeURIComponent(id)}/find?no=${encodeURIComponent(no)}&per=${per}`),
  bookmarks: () => api.get('/hadiths/bookmarks'),
  toggleBookmark: (collection, number) => api.post('/hadiths/bookmarks/toggle', { collection, number }),
};

// ---- Challenges, salah, posts, profile, account, settings ----

export const challenges = {
  list: () => api.get('/challenges'),
  // `startDate`/`period`/`endDate` describe the challenge window; a one-time
  // task ignores them. The server validates the family (start within the last
  // six days or the future, end not before start).
  create: (payload) => {
    const data = typeof payload === 'string' ? { name: payload } : payload;
    return api.post('/challenges', {
      challenge: data.name,
      oneTime: Boolean(data.oneTime),
      // A "quran" challenge is counted from the reader, one ayah at a time.
      // Omitted for manual challenges so old callers keep the default.
      kind: data.kind,
      dailyTarget: data.dailyTarget,
      startDate: data.startDate,
      period: data.period,
      endDate: data.endDate,
    });
  },
  rename: (id, challenge, extra = {}) => api.post(`/challenges/${id}`, { challenge, ...extra }),
  remove: (id) => api.request(`/challenges/${id}`, { method: 'DELETE' }),
  // One challenge, one day: the server decides whether the day is still inside
  // the rolling 7-day window.
  checkin: (id, date) => api.post(`/challenges/${id}/checkin`, date ? { date } : {}),
  // Reading progress: one call per verse opened. The server dedupes and
  // completes the day's check-in when the daily target is reached.
  recordAyah: (id, surahNo, ayahNo) => api.post(`/challenges/${id}/ayah`, { surahNo, ayahNo }),
  saveStreaks: (payload) => api.post('/challenges/streaks', payload),
};

export const salah = {
  list: (date) => api.get('/salah' + (date ? `?date=${encodeURIComponent(date)}` : '')),
  record: (payload) => api.post('/salah', payload),
  // "Not logged" removes the entry rather than writing a blank status, which
  // the record route refuses and the day's report would still count.
  clear: (payload) => api.delete('/salah', payload),
};

// "?a=1&b=2" from the values that are set; "" when none are.
function pageQuery(params) {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const posts = {
  // Posts arrive a page at a time. `before` is the id of the last post already
  // shown (the server's nextCursor); `liked` narrows the feed to liked posts.
  list: ({ before, liked } = {}) => api.get(`/posts${pageQuery({ before, liked: liked ? 1 : '' })}`),
  create: (payload) => api.post('/posts', payload),
  one: (id) => api.get(`/posts/${id}`),
  // PATCH, not PUT: only content/reference are accepted, and the server keeps
  // the post type (text vs video) fixed at creation.
  update: (id, payload) => api.request(`/posts/${id}`, { method: 'PATCH', body: payload }),
  remove: (id) => api.request(`/posts/${id}`, { method: 'DELETE' }),
  toggleLike: (id) => api.post(`/posts/${id}/like`),
  // Without `before`: the whole profile and its newest posts. With it: only the
  // next page of that profile's posts.
  profile: (username, { before } = {}) => api.get(`/u/${encodeURIComponent(username)}${pageQuery({ before })}`),
  // One report per account per post; repeats are accepted and change nothing.
  report: (id, payload) => api.post(`/posts/${id}/report`, payload),
  block: (userId) => api.post(`/users/${userId}/block`, {}),
  unblock: (userId) => api.request(`/users/${userId}/block`, { method: 'DELETE' }),
  blocks: () => api.get('/account/blocks'),
};

// Moderation is server-gated by the admin check (ADMIN_EMAILS plus accounts
// granted the flag); these calls answer 403 for every other account, so the
// client page is a convenience rather than the guard.
export const moderation = {
  queue: () => api.get('/admin/moderation'),
  approve: (id) => api.post(`/admin/posts/${id}/approve`, {}),
  reject: (id) => api.post(`/admin/posts/${id}/reject`, {}),
};

// The admin portal. Same gate as moderation, split by task so each panel only
// asks for what it draws.
export const admin = {
  // The portal's own sign-in. Rejects a valid non-admin account with 403
  // `not-admin` instead of establishing a session.
  login: (identifier, password) => api.post('/admin/login', { identifier, password }),
  stats: () => api.get('/admin/stats'),
  // Every adjustable limit (signups and posting), with what has been used so far.
  limits: () => api.get('/admin/limits'),
  // payload: { values: { <key>: number | null }, thresholdPercent }. null = off.
  updateLimits: (payload) => api.request('/admin/limits', { method: 'PUT', body: payload }),
  users: ({ q = '', page = 1, limit = 25 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    const qs = params.toString();
    return api.get(`/admin/users${qs ? `?${qs}` : ''}`);
  },
  // Grants or revokes the portal flag. ADMIN_EMAILS addresses always stay
  // admins, and the server refuses a change to your own account.
  setUserAdmin: (id, isAdmin) => api.request(`/admin/users/${id}`, { method: 'PATCH', body: { isAdmin } }),
  banners: () => api.get('/admin/banners'),
  createBanner: (payload) => api.post('/admin/banners', payload),
  updateBanner: (id, payload) => api.request(`/admin/banners/${id}`, { method: 'PATCH', body: payload }),
  removeBanner: (id) => api.request(`/admin/banners/${id}`, { method: 'DELETE' }),
  // Re-show a live campaign without creating a second one.
  retriggerBanner: (id) => api.post(`/admin/banners/${id}/retrigger`, {}),
  broadcasts: () => api.get('/admin/broadcasts'),
  sendBroadcast: (payload) => api.post('/admin/broadcasts', payload),
  contactMessages: ({ status = '', page = 1, limit = 50 } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    const qs = params.toString();
    return api.get(`/admin/contact-messages${qs ? `?${qs}` : ''}`);
  },
  replyContactMessage: (id, payload) => api.request(`/admin/contact-messages/${id}`, { method: 'PATCH', body: payload }),
};

// Signed-in users contact the admin.
export const contact = {
  send: (payload) => api.post('/contact-admin', payload),
  mine: () => api.get('/contact-admin/mine'),
};

// Acknowledgement for the one-time popup. Deliberately not under /admin: every
// signed-in reader calls it.
export const banners = {
  seen: (id) => api.post(`/banners/${id}/seen`, {}),
};

// ---- Friends, notifications and shared challenges ----
//
export const friends = {
  list: () => api.get('/friends'),
  // People you may know: friends of friends first, then new accounts.
  suggestions: () => api.get('/friends/suggestions'),
  search: (q) => api.get(`/users/search?q=${encodeURIComponent(q)}`),
  request: (username) => api.post('/friends/requests', { username }),
  accept: (friendshipId) => api.post(`/friends/requests/${friendshipId}/accept`, {}),
  decline: (friendshipId) => api.post(`/friends/requests/${friendshipId}/decline`, {}),
  remove: (username) => api.request(`/friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  respondChallenge: (challengeId, action) =>
    api.post(`/friend-challenges/${challengeId}/respond`, { action }),
};

export const notifications = {
  list: () => api.get('/notifications'),
  count: () => api.get('/notifications/count'),
  read: (id) => api.post(`/notifications/${id}/read`, {}),
  readAll: () => api.post('/notifications/read-all', {}),
};

export const friendChallenges = {
  list: () => api.get('/friend-challenges'),
  create: (payload) => api.post('/friend-challenges', payload),
  respond: (id, action) => api.post(`/friend-challenges/${id}/respond`, { action }),
  // Creator-only. `friends` adds new invitees; existing participants are left
  // alone, so the caller only needs to send the newly picked usernames.
  update: (id, payload) => api.request(`/friend-challenges/${id}`, { method: 'PATCH', body: payload }),
  // `date` is optional: omitted means today, otherwise an ISO day inside the
  // server's backfill window (it answers 400 outside it).
  checkin: (id, date) => api.post(`/friend-challenges/${id}/checkin`, date ? { date } : {}),
  remove: (id) => api.request(`/friend-challenges/${id}`, { method: 'DELETE' }),
};

export const account = {
  me: () => api.get('/account'),
  // `file` is the square JPEG the cropper produced, not the file the user
  // picked. FormData carries the multipart boundary; the server validates the
  // type and size again.
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.request('/account/avatar', { method: 'POST', formData });
  },
  removeAvatar: () => api.request('/account/avatar', { method: 'DELETE' }),
};

export const settings = {
  get: () => api.get('/settings'),
};

// Place search for the prayer-time location pickers (city, town, any address).
export const locations = {
  search: (q) => api.get(`/locations/search?q=${encodeURIComponent(q)}`),
};

export const charity = {
  list: () => api.get('/charity'),
  create: (payload) => api.post('/charity', payload),
  update: (id, payload) => api.request(`/charity/${id}`, { method: 'PATCH', body: payload }),
  remove: (id) => api.request(`/charity/${id}`, { method: 'DELETE' }),
  donate: (id, payload) => api.post(`/charity/${id}/donate`, payload),
  updateDonation: (id, index, payload) => api.request(`/charity/${id}/donation/${index}`, { method: 'PATCH', body: payload }),
  removeDonation: (id, index) => api.request(`/charity/${id}/donation/${index}`, { method: 'DELETE' }),
};

export const stats = {
  // Each stats module carries its own window on the report now, so every
  // parameter is optional and only the defined ones reach the query string.
  get: ({ days, charityMonths, challengeDays } = {}) => {
    const params = new URLSearchParams();
    if (days !== undefined) params.set('days', days);
    if (charityMonths !== undefined) params.set('charityMonths', charityMonths);
    if (challengeDays !== undefined) params.set('challengeDays', challengeDays);
    const qs = params.toString();
    return api.get(`/stats${qs ? `?${qs}` : ''}`);
  },
};

export { ApiError };