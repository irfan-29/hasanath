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

async function request(path, { method = 'GET', body, signal, retried = false } = {}) {
  const response = await fetch(BASE + path, {
    method,
    // Explicit even though same-origin: it documents the requirement and keeps
    // this working if the backend is ever called cross-origin.
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
      return request(path, { method, body, signal, retried: true });
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
  saveStreaks: (payload) => api.post('/challenges/streaks', payload),
};

export const salah = {
  list: (date) => api.get('/salah' + (date ? `?date=${encodeURIComponent(date)}` : '')),
  record: (payload) => api.post('/salah', payload),
};

export const posts = {
  list: () => api.get('/posts'),
  create: (payload) => api.post('/posts', payload),
  one: (id) => api.get(`/posts/${id}`),
  // PATCH, not PUT: only content/reference are accepted, and the server keeps
  // the post type (text vs video) fixed at creation.
  update: (id, payload) => api.request(`/posts/${id}`, { method: 'PATCH', body: payload }),
  remove: (id) => api.request(`/posts/${id}`, { method: 'DELETE' }),
  toggleLike: (id) => api.post(`/posts/${id}/like`),
  profile: (username) => api.get(`/u/${encodeURIComponent(username)}`),
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
};

export const settings = {
  get: () => api.get('/settings'),
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