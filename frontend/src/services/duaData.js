// Lazily loaded dua reader data.
//
// The collection is large enough (743 duas in four translations) that shipping
// it in the main bundle would slow the first paint for a screen most visitors
// never open. Each language therefore lives in its own generated module, and
// Vite emits one chunk per language; the service worker's cache-first rule for
// /assets/* keeps a chunk offline after its first successful open.
//
// The data comes from scripts/build-duas.js. To add a language, generate its
// module and add one line to DUA_LANGUAGES and PACK_LOADERS.
const CORE_LOADER = () => import('../data/duas/core.js');

const PACK_LOADERS = {
  en: () => import('../data/duas/en.js'),
  ta: () => import('../data/duas/ta.js'),
  ml: () => import('../data/duas/ml.js'),
  ur: () => import('../data/duas/ur.js'),
};

export const DUA_LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ta', label: 'தமிழ்', dir: 'ltr' },
  { code: 'ml', label: 'മലയാളം', dir: 'ltr' },
  { code: 'ur', label: 'اردو', dir: 'rtl' },
];

const STORAGE_KEY = 'hasanath-dua-lang';
const DEFAULT_LANGUAGE = 'en';
const cache = new Map();

export function isDuaLanguage(code) {
  return DUA_LANGUAGES.some((item) => item.code === code);
}

// Remember the reader's choice, and guess sensibly on the first visit: a Tamil
// or Malayalam browser gets that translation before it has opened the picker.
export function preferredDuaLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isDuaLanguage(stored)) return stored;
  } catch {
    // Private mode: fall through to the browser hint.
  }

  const browser = String(navigator.language || '').toLowerCase().split('-')[0];
  if (isDuaLanguage(browser)) return browser;
  return DEFAULT_LANGUAGE;
}

export function rememberDuaLanguage(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // The selection still applies for this session.
  }
}

export async function loadDuaCollection(code) {
  const language = isDuaLanguage(code) ? code : DEFAULT_LANGUAGE;

  if (!cache.has(language)) {
    const request = Promise.all([CORE_LOADER(), PACK_LOADERS[language]()])
      .then(([coreModule, packModule]) => {
        const core = coreModule.CORE;
        const pack = packModule.default;
        const meta = DUA_LANGUAGES.find((item) => item.code === language);

        const categories = Object.entries(pack.categories).map(([id, label]) => ({ id, label }));

        const duas = core
          .map((dua) => {
            const text = pack.duas[dua.id] || {};
            return {
              id: dua.id,
              category: dua.cat,
              subcategory: pack.subcategories[dua.sub] || '',
              arabic: dua.ar,
              transliteration: dua.tr,
              reference: text.r || dua.ref,
              title: text.t || '',
              translation: text.x || '',
            };
          })
          .filter((dua) => dua.translation);

        return { code: language, dir: meta?.dir || 'ltr', categories, duas };
      })
      .catch((error) => {
        // A failed import must not poison the cache: a retry after the network
        // comes back should try the chunk again.
        cache.delete(language);
        throw error;
      });

    cache.set(language, request);
  }

  return cache.get(language);
}
