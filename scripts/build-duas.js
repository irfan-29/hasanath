#!/usr/bin/env node
// Builds the bundled dua collection from the Masnun Dua dataset.
//
//   node scripts/build-duas.js --source /path/to/masnun-dua
//
// The source is the free, no-attribution dataset published by IslamicAPI:
// https://github.com/islamicapi/masnun-dua (Hisnul Muslim, 1,001 entries).
// Its licence permits personal, educational and commercial use; see the
// repository README. We vendor the text at build time rather than calling the
// API at runtime: the PWA and the Android WebView must open the collection
// offline, and a third-party request would also add a hard dependency and a
// rate limit to the reader.
//
// A sparse checkout is enough (the full repo carries 219MB of translations):
//
//   git clone --depth 1 --filter=blob:none --sparse \
//     https://github.com/islamicapi/masnun-dua /tmp/masnun-dua
//   cd /tmp/masnun-dua && git sparse-checkout set \
//     translation/en translation/ta translation/ml translation/ur \
//     categories sub-categories
//
// Output goes to frontend/src/data/duas/. The files are generated modules, not
// JSON, so Vite splits each language into its own lazily imported chunk and the
// service worker's cache-first rule for /assets/* keeps it offline afterwards.
//
// Adding a language: add it to LANGUAGES, fetch that directory with
// sparse-checkout, add a loader entry in frontend/src/services/duaData.js, and
// rerun this script.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'frontend', 'src', 'data', 'duas');

// Native names live in the frontend so this script stays data-only. Keep the
// order here stable: it is the order of the language chips.
const LANGUAGES = ['en', 'ta', 'ml', 'ur'];

function arg(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const source = path.resolve(arg('source', '/tmp/masnun-dua'));
if (!fs.existsSync(path.join(source, 'translation', 'en'))) {
  console.error(`No Masnun Dua checkout at ${source}.`);
  console.error('Pass --source <dir> pointing at a sparse checkout (see this file\'s header).');
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readLanguage(file) {
  const full = path.join(source, file);
  return fs.existsSync(full) ? readJson(full) : null;
}

// The source is a scraped collection: every Arabic line uses U+060C, which
// QPC-Hafs (the app's default reader face) draws as a pause dot that reads as
// a typo. Ornate parentheses and the standalone salawat glyph are outside the
// subset font too. Normalise to characters every bundled face can draw.
function cleanArabic(value) {
  return String(value || '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\uFD3E\uFD3F]/g, ' ')
    .replace(/\uFDFA/g, 'صلى الله عليه وسلم')
    .replace(/\u060C/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function key(arabic) {
  return arabic.replace(/\s+/g, ' ');
}

const categoriesByLang = {};
const subcategoriesByLang = {};
for (const lang of LANGUAGES) {
  const categories = readLanguage(`categories/${lang}.json`) || readLanguage('categories/en.json');
  const subcategories = readLanguage(`sub-categories/${lang}.json`) || readLanguage('sub-categories/en.json');
  categoriesByLang[lang] = new Map(categories.map((item) => [item.url, cleanText(item.name)]));
  subcategoriesByLang[lang] = new Map(subcategories.map((item) => [item.id, cleanText(item.title)]));
}

const categoryOrder = new Map(
  readJson(path.join(source, 'categories', 'en.json')).map((item, index) => [item.url, index])
);

// Which subcategory owns each dua id (the same ids in every language file).
const subcategoryOf = new Map();
for (const sub of readJson(path.join(source, 'sub-categories', 'en.json'))) {
  for (const id of sub['dua-ids'] || []) {
    subcategoryOf.set(id, { sub: sub.id, cat: sub.category });
  }
}

// Group all ids by normalised Arabic. The dataset repeats a number of duas in
// several chapters; one card is enough, but a duplicate can still hold a
// translation another copy is missing, so groups are merged below.
const groups = new Map();
for (const lang of LANGUAGES) {
  const dir = path.join(source, 'translation', lang);
  if (!fs.existsSync(dir)) {
    console.error(`Missing translation/${lang}. Fetch it with git sparse-checkout first.`);
    process.exit(1);
  }
}

const ids = fs
  .readdirSync(path.join(source, 'translation', 'en'))
  .map((file) => Number(file.match(/^dua_(\d+)\.json$/)?.[1]))
  .filter(Boolean)
  .sort((a, b) => a - b);

const records = [];
for (const id of ids) {
  const en = readJson(path.join(source, 'translation', 'en', `dua_${id}.json`));
  const arabic = cleanArabic(en.arabic);
  const translation = cleanText(en.translation);
  if (!arabic || !translation) continue;

  const entry = {
    id,
    arabic,
    english: translation,
    transliteration: cleanText(en.transliteration),
    reference: cleanText(en.reference),
    byLang: {},
  };
  for (const lang of LANGUAGES) {
    const file = path.join(source, 'translation', lang, `dua_${id}.json`);
    if (!fs.existsSync(file)) continue;
    const dua = readJson(file);
    entry.byLang[lang] = {
      title: cleanText(dua.title),
      translation: cleanText(dua.translation),
      reference: cleanText(dua.reference),
    };
  }

  const k = key(arabic);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(entry);
}

const chosen = [];
for (const group of groups.values()) {
  // Pick the copy that carries the most complete set of translations, then the
  // longest English text (the scraped copies sometimes truncate).
  group.sort((a, b) => {
    const count = (item) => LANGUAGES.filter((lang) => item.byLang[lang]?.translation).length;
    return count(b) - count(a) || b.english.length - a.english.length || a.id - b.id;
  });
  const canonical = group[0];
  const where = subcategoryOf.get(canonical.id) || { sub: 0, cat: 'other-duas' };
  chosen.push({ canonical, group, ...where });
}

chosen.sort(
  (a, b) =>
    (categoryOrder.get(a.cat) ?? 99) - (categoryOrder.get(b.cat) ?? 99) ||
    a.sub - b.sub ||
    a.canonical.id - b.canonical.id
);

// ---- Output -----------------------------------------------------------------

const core = chosen.map(({ canonical, sub, cat }) => ({
  id: canonical.id,
  cat,
  sub,
  ar: canonical.arabic,
  tr: canonical.transliteration,
  ref: canonical.reference,
}));

const usedCategories = [...new Set(chosen.map((item) => item.cat))].sort(
  (a, b) => (categoryOrder.get(a) ?? 99) - (categoryOrder.get(b) ?? 99)
);
const usedSubcategories = [...new Set(chosen.map((item) => item.sub))].sort((a, b) => a - b);

const HEADER = `// Generated by scripts/build-duas.js from the Masnun Dua dataset
// (https://github.com/islamicapi/masnun-dua). Do not edit by hand; rerun the
// script instead. Arabic is normalised for the app's bundled reader faces.
`;

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(
  path.join(OUT_DIR, 'core.js'),
  `${HEADER}
export const CORE = ${JSON.stringify(core)};
`
);

for (const lang of LANGUAGES) {
  const categories = {};
  for (const category of usedCategories) {
    categories[category] = categoriesByLang[lang].get(category) || categoriesByLang.en.get(category) || category;
  }

  const subcategories = {};
  for (const sub of usedSubcategories) {
    subcategories[sub] = subcategoriesByLang[lang].get(sub) || subcategoriesByLang.en.get(sub) || '';
  }

  const duas = {};
  for (const { canonical, group } of chosen) {
    const pick = (field) => {
      const direct = canonical.byLang[lang]?.[field];
      if (direct) return direct;
      for (const member of group) {
        const value = member.byLang[lang]?.[field];
        if (value) return value;
      }
      return '';
    };

    const translation = pick('translation') || canonical.english;
    const title = pick('title') || canonical.byLang.en?.title || '';
    const reference = pick('reference');
    const item = { t: title, x: translation };
    if (reference && reference !== canonical.reference) item.r = reference;
    duas[canonical.id] = item;
  }

  fs.writeFileSync(
    path.join(OUT_DIR, `${lang}.js`),
    `${HEADER}
export default {
  code: ${JSON.stringify(lang)},
  categories: ${JSON.stringify(categories)},
  subcategories: ${JSON.stringify(subcategories)},
  duas: ${JSON.stringify(duas)},
};
`
  );
}

// A manifest is handy for the build log and for docs; the app itself imports
// the modules above.
fs.writeFileSync(
  path.join(OUT_DIR, 'manifest.json'),
  `${JSON.stringify(
    {
      source: 'https://github.com/islamicapi/masnun-dua',
      generated: new Date().toISOString().slice(0, 10),
      languages: LANGUAGES,
      duas: core.length,
      categories: usedCategories.length,
    },
    null,
    2
  )}\n`
);

const kb = (file) => `${Math.round(fs.statSync(path.join(OUT_DIR, file)).size / 1024)}KB`;
console.log(
  `Wrote ${core.length} unique duas in ${LANGUAGES.length} languages ` +
    `(core ${kb('core.js')}, ${LANGUAGES.map((lang) => `${lang} ${kb(`${lang}.js`)}`).join(', ')})`
);
