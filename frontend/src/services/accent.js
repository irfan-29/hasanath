// Accent palette applier.
//
// The palette itself lives in styles.css as html[data-accent="..."] blocks;
// this module only decides which id is painted and mirrors it into storage so
// the pre-paint script in index.html can replay it before the bundle loads.
// The storage key is duplicated there because that inline script cannot import
// from the bundle it races, exactly like THEME_STORAGE_KEY in useSession.

export const ACCENT_STORAGE_KEY = 'salah-accent';

// Must match the ids in api/services/userData.js and the blocks in styles.css.
export const ACCENT_IDS = ['green', 'blue', 'violet', 'gold', 'rose', 'ocean'];

export function normaliseAccent(value) {
  return ACCENT_IDS.includes(value) ? value : 'green';
}

export function applyAccent(value, { persist = true } = {}) {
  const accent = normaliseAccent(value);
  const root = document.documentElement;
  // "green" is the stylesheet's :root default, so it needs no attribute. That
  // also keeps the HTML clean for everyone who never opens the picker.
  if (accent === 'green') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', accent);

  if (persist) {
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    } catch (err) {
      // Private mode: the palette still applies to this page.
    }
  }
  return accent;
}
