#!/usr/bin/env node
// Rebuilds the Material Symbols Rounded subset that ships with the app.
//
//   node scripts/build-icon-font.js
//
// The icon font is a subset, so a glyph that is not listed in
// scripts/icon-names.txt is not in the file: the browser then paints the
// ligature name as text ("play_circle", "menu", "mark_email_read"). When you
// add an icon to the UI, add its name to that list and run this script.
//
// The output filename carries a version suffix because static fonts are
// cached aggressively. Bump it (and the @font-face / preload references) when
// the subset changes, or returning visitors will keep the old file.
const fs = require('node:fs');
const path = require('node:path');

const NAMES = fs
  .readFileSync(path.join(__dirname, 'icon-names.txt'), 'utf8')
  .split(/\s+/)
  .filter(Boolean)
  .sort();

const OUT = path.join(__dirname, '..', 'public', 'fonts', 'material-symbols-rounded-v4.woff2');
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200' +
  `&icon_names=${NAMES.join(',')}`;

// Google Fonts serves woff2 only to browsers that advertise support.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

(async () => {
  const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((res) => {
    if (!res.ok) throw new Error(`Google Fonts responded ${res.status}`);
    return res.text();
  });

  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) throw new Error('No woff2 URL in the Google Fonts response');

  const font = Buffer.from(await fetch(url).then((res) => res.arrayBuffer()));
  fs.writeFileSync(OUT, font);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${font.length} bytes, ${NAMES.length} icons)`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
