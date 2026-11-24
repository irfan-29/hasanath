# Bundled duas

Generated data. Do not edit these files by hand.

The collection is built from [Masnun Dua](https://github.com/islamicapi/masnun-dua),
a free, no-attribution dataset of Hisnul Muslim duas. Its README permits
personal, educational and commercial app use; the duas themselves are sourced
from the Qur'an and authentic hadith.

```bash
# One-time sparse checkout (the full repo carries ~219 MB of translations)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/islamicapi/masnun-dua /tmp/masnun-dua
cd /tmp/masnun-dua
git sparse-checkout set translation/en translation/ta translation/ml translation/ur \
  categories sub-categories

# From the Hasanath repo root
npm run build:duas -- --source /tmp/masnun-dua
```

- `core.js` — language-independent entries: id, category/subcategory id,
  Arabic, transliteration and reference.
- `<code>.js` — one module per translation: category/subcategory labels, titles,
  translations and localised references.
- `manifest.json` — generation date, language list and counts.

`frontend/src/services/duaData.js` imports `core.js` plus one language module on
demand, so Vite emits one lazily loaded chunk per language and the service
worker caches each chunk after its first open. Add a language in both the
generator (`LANGUAGES`) and the loader (`DUA_LANGUAGES`, `PACK_LOADERS`), fetch
its translation directory, and rerun the generator.

Arabic is normalised during generation: U+060C is replaced with a space because
QPC-Hafs draws it as a pause dot, and ornate parentheses / the standalone
sallallahu-alayhi-wasallam glyph are expanded or removed because they are not in
the bundled reader faces.
