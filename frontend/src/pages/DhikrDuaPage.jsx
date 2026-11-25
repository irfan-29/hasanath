import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FormSelect from '../components/FormSelect';
import { useToast } from '../components/ToastProvider';
import { settings as settingsApi } from '../services/api';
import { canVibrate, click, keepAwake, vibrate } from '../services/haptics';
import { localDateKey } from '../utils/date';
import { DHIKR_PRESETS } from '../data/adhkar';
import {
  DUA_LANGUAGES,
  loadDuaCollection,
  preferredDuaLanguage,
  rememberDuaLanguage,
} from '../services/duaData';

// An offline-first dhikr counter plus a lazily loaded dua collection. Counts
// live in localStorage, keyed by the local day, so the counter needs no account
// and no network. The dua data is a generated chunk that the service worker
// keeps offline after its first open.
const STORAGE_KEY = 'hasanath-dhikr';
const DUA_PAGE_SIZE = 30;

const TABS = [
  { id: 'dhikr', label: 'Dhikr', icon: 'repeat' },
  { id: 'duas', label: 'Duas', icon: 'format_quote' },
];

// The source translations write the honourific as U+FDFA (ﷺ). That glyph only
// exists in Arabic faces, so in a Tamil, Malayalam or Latin sentence it paints
// as a box. Give the symbol its own face rather than altering the wording.
function DuaText({ text }) {
  if (!text || !String(text).includes('\uFDFA')) return text;
  return String(text)
    .split('\uFDFA')
    .flatMap((part, index) =>
      index === 0
        ? [part]
        : [
            <span
              className="dua-honorific"
              role="img"
              aria-label="peace be upon him"
              title="peace be upon him"
              key={index}
            >
              ﷺ
            </span>,
            part,
          ]
    );
}

function loadCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: localDateKey(), counts: {}, totals: {} };
    const parsed = JSON.parse(raw);
    if (parsed.date !== localDateKey()) return { date: localDateKey(), counts: {}, totals: {} };
    return {
      date: parsed.date,
      counts: parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {},
      totals: parsed.totals && typeof parsed.totals === 'object' ? parsed.totals : {},
    };
  } catch {
    return { date: localDateKey(), counts: {}, totals: {} };
  }
}

// How the counter answers a tap. Kept on the device, like the counts.
const PREFS_KEY = 'hasanath.dhikr.prefs';
const TASBIH_ORDER = ['subhanallah', 'alhamdulillah', 'allahuakbar'];

function loadPrefs() {
  const defaults = { vibrate: true, sound: false, autoNext: false };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) };
  } catch {
    return defaults;
  }
}

export default function DhikrDuaPage() {
  const toast = useToast();
  const [tab, setTab] = useState('dhikr');
  const [presetId, setPresetId] = useState('subhanallah');
  const [state, setState] = useState(loadCounts);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [focus, setFocus] = useState(false);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [duaLang, setDuaLang] = useState(preferredDuaLanguage);
  const [collection, setCollection] = useState(null);
  const [duaStatus, setDuaStatus] = useState('idle');
  const [duaReload, setDuaReload] = useState(0);
  const [duaLimit, setDuaLimit] = useState(DUA_PAGE_SIZE);
  // The reader's Quran Font preference, fetched from the same settings the
  // reader uses. Arabic here is prose, but it should wear the face they chose.
  const [arabicFont, setArabicFont] = useState('QPC-Hafs');

  const preset = DHIKR_PRESETS.find((item) => item.id === presetId) || DHIKR_PRESETS[0];

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .get()
      .then((data) => {
        if (!cancelled) setArabicFont(data?.settings?.favoriteFont || 'QPC-Hafs');
      })
      .catch(() => {
        // Signed out or offline: the app's default Arabic face still renders.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode or disabled storage: the counter still works for this session.
    }
  }, [state]);

  // The dua dataset is a cached dynamic import, so opening this tab the first
  // time is the only network cost. The chosen language is remembered, which is
  // also why the module is imported only once per session.
  useEffect(() => {
    if (tab !== 'duas') return undefined;
    let cancelled = false;
    setDuaStatus('loading');
    loadDuaCollection(duaLang)
      .then((data) => {
        if (cancelled) return;
        setCollection(data);
        setDuaStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setDuaStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tab, duaLang, duaReload]);

  useEffect(() => {
    setDuaLimit(DUA_PAGE_SIZE);
  }, [category, query, duaLang]);

  const count = state.counts[presetId] || 0;
  const total = state.totals[presetId] || 0;
  const todayTotal = useMemo(
    () => Object.values(state.totals).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [state.totals]
  );
  const progress = preset.target > 0 ? Math.min(100, Math.round((count / preset.target) * 100)) : 0;
  const reached = preset.target > 0 && count >= preset.target;
  const arabicStyle = { fontFamily: `'${arabicFont}', serif` };

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable: the choices last for this visit.
    }
  }, [prefs]);

  const togglePref = (key) => setPrefs((current) => ({ ...current, [key]: !current[key] }));

  // Every count is answered so it can be felt with eyes closed: a light tap
  // for each one, two short pulses at 33 / 66 / 99 on the way to 100, and a
  // long, unmistakable pattern the moment the target is reached.
  const increment = useCallback(() => {
    const next = count + 1;
    const target = preset.target;
    const kind = target > 0 && next === target ? 'done'
      : target > 33 && next < target && next % 33 === 0 ? 'milestone'
        : 'tick';
    if (prefs.vibrate) vibrate(kind);
    if (prefs.sound) click(kind);

    setState((current) => ({
      ...current,
      counts: { ...current.counts, [presetId]: (current.counts[presetId] || 0) + 1 },
      totals: { ...current.totals, [presetId]: (current.totals[presetId] || 0) + 1 },
    }));

    // The tasbih after salah (33, 33, 34) can flow on by itself.
    const order = TASBIH_ORDER.indexOf(presetId);
    if (kind === 'done' && prefs.autoNext && order >= 0 && order < TASBIH_ORDER.length - 1) {
      window.setTimeout(() => setPresetId(TASBIH_ORDER[order + 1]), 900);
    }
  }, [count, preset.target, presetId, prefs.vibrate, prefs.sound, prefs.autoNext]);

  // Eyes-closed mode: the whole screen counts, the screen stays awake, and in
  // the Android app the volume keys count too.
  const incrementRef = useRef(increment);
  incrementRef.current = increment;

  useEffect(() => {
    if (!focus) return undefined;
    const bridge = typeof window !== 'undefined' ? window.HasanathAndroid : null;
    const hasKeys = bridge && typeof bridge.dhikrKeys === 'function';
    keepAwake(true);
    window.__hasanathDhikr = () => incrementRef.current();
    if (hasKeys) bridge.dhikrKeys(true);

    // The phone's Back button leaves the mode instead of the page.
    window.history.pushState({ dhikrFocus: true }, '');
    const onPop = () => setFocus(false);
    window.addEventListener('popstate', onPop);

    return () => {
      keepAwake(false);
      delete window.__hasanathDhikr;
      if (hasKeys) bridge.dhikrKeys(false);
      window.removeEventListener('popstate', onPop);
    };
  }, [focus]);

  const closeFocus = () => {
    if (window.history.state && window.history.state.dhikrFocus) window.history.back();
    else setFocus(false);
  };

  const reset = useCallback(() => {
    setState((current) => ({
      ...current,
      counts: { ...current.counts, [presetId]: 0 },
    }));
  }, [presetId]);

  const activeCollection = collection?.code === duaLang ? collection : null;
  const duas = activeCollection?.duas || [];
  const categories = activeCollection?.categories || [];

  const filteredDuas = useMemo(() => {
    const term = query.trim().toLowerCase();
    return duas.filter((dua) => {
      if (category !== 'All' && dua.category !== category) return false;
      if (!term) return true;
      return [
        dua.title,
        dua.subcategory,
        dua.arabic,
        dua.transliteration,
        dua.translation,
        dua.reference,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [category, duas, query]);

  const visibleDuas = filteredDuas.slice(0, duaLimit);

  function chooseDuaLanguage(code) {
    setDuaLang(code);
    rememberDuaLanguage(code);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Could not copy', { kind: 'error' });
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Dhikr &amp; Dua</h1>
        <p>Remember Allah and keep a gentle daily rhythm</p>
      </div>

      <div className="quran-tabs" role="tablist" aria-label="Dhikr and Dua">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`quran-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <span className="material-symbols-rounded">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'dhikr' ? (
        <div className="container1 dhikr-panel">
          <div className="card-header">
            <h3>Daily dhikr</h3>
            <span className="badge badge-primary">{todayTotal} today</span>
          </div>

          <FormSelect
            id="dhikr-preset"
            label="Dhikr"
            value={presetId}
            options={DHIKR_PRESETS.map((item) => ({
              value: item.id,
              label: `${item.label}${item.target ? ` · ${item.target}×` : ''}`,
            }))}
            onChange={setPresetId}
          />

          <div className="dhikr-stage">
            {preset.arabic && (
              <p className="ayah-arabic-text dhikr-arabic" dir="rtl" lang="ar" style={arabicStyle}>
                {preset.arabic}
              </p>
            )}
            {preset.transliteration && <p className="dhikr-transliteration">{preset.transliteration}</p>}
            {preset.meaning && <p className="dhikr-meaning">{preset.meaning}</p>}

            <button
              type="button"
              className="dhikr-tap"
              onClick={increment}
              aria-label={`Count ${preset.label}. Currently ${count}.`}
            >
              <span className="dhikr-tap-count">{count}</span>
              <span className="dhikr-tap-label">Tap to count</span>
            </button>

            <p className="dhikr-progress" aria-live="polite">
              {preset.target > 0 ? `${Math.min(count, preset.target)} of ${preset.target}` : 'Free count'}
              {reached && (
                <span className="dhikr-reached">
                  <span className="material-symbols-rounded" aria-hidden="true">check_circle</span>
                  Target reached
                </span>
              )}
            </p>

            {preset.target > 0 && (
              <div
                className="dhikr-bar"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax={preset.target}
                aria-valuenow={Math.min(count, preset.target)}
                aria-label={`${preset.label} progress`}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="dhikr-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={reset} disabled={count === 0}>
                Reset count
              </button>
              {total > 0 && <span className="dhikr-total">{total} counted today</span>}
            </div>

            <div className="dhikr-feel">
              <button type="button" className="btn btn-primary dhikr-focus-open" onClick={() => setFocus(true)}>
                Eyes-closed mode
              </button>
              <p className="dhikr-feel-hint">
                Tap anywhere to count. You will feel each count, and a long vibration when you reach the target.
              </p>
              <div className="dhikr-opts" role="group" aria-label="Counter feedback">
                {canVibrate() && (
                  <button type="button" className="dhikr-opt" aria-pressed={prefs.vibrate} onClick={() => togglePref('vibrate')}>
                    Vibration
                  </button>
                )}
                <button type="button" className="dhikr-opt" aria-pressed={prefs.sound} onClick={() => togglePref('sound')}>
                  Sound
                </button>
                <button type="button" className="dhikr-opt" aria-pressed={prefs.autoNext} onClick={() => togglePref('autoNext')}>
                  Auto next (33 · 33 · 34)
                </button>
              </div>
            </div>
          </div>

          {focus && (
            <div className="dhikr-focus" role="dialog" aria-modal="true" aria-label={`Counting ${preset.label}`}>
              <button
                type="button"
                className="dhikr-focus-surface"
                onPointerDown={(event) => { event.preventDefault(); increment(); }}
                onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); increment(); } }}
                aria-label={`Count ${preset.label}. Currently ${count}.`}
                autoFocus
              >
                <span className="dhikr-focus-name">{preset.label}</span>
                <span className="dhikr-focus-count">{count}</span>
                <span className="dhikr-focus-target">
                  {preset.target > 0 ? (reached ? 'Target reached' : `of ${preset.target}`) : 'Free count'}
                </span>
                <span className="dhikr-focus-hint">Tap anywhere{typeof window !== 'undefined' && window.HasanathAndroid && typeof window.HasanathAndroid.dhikrKeys === 'function' ? ', or press a volume key' : ''}</span>
              </button>
              <button type="button" className="dhikr-focus-close" onClick={closeFocus}>
                Done
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Both rails mirror the hadith reader: a small pinned label and a
              horizontally scrolling chip row, so the collection filters read
              exactly like the other reading screens. */}
          <div className="hadith-langs" role="group" aria-label="Dua translation language">
            <span className="hadith-langs-label">Translation</span>
            <div className="hadith-sections-chips">
              {DUA_LANGUAGES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  lang={item.code}
                  className={`hadith-chip hadith-lang-chip dhikr-script${duaLang === item.code ? ' is-active' : ''}`}
                  aria-pressed={duaLang === item.code}
                  onClick={() => chooseDuaLanguage(item.code)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {activeCollection && (
            <div className="hadith-langs">
              <span className="hadith-langs-label">Category</span>
              <div className="hadith-sections-chips">
                {[{ id: 'All', label: 'All' }, ...categories].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    lang={item.id === 'All' ? undefined : duaLang}
                    className={`hadith-chip dhikr-script${category === item.id ? ' is-active' : ''}`}
                    aria-pressed={category === item.id}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {duaStatus === 'error' ? (
            <div className="dhikr-status">
              <p className="post-empty">
                Could not load the duas. Connect once and try again; the collection is saved for
                offline reading afterwards.
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setDuaReload((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : !activeCollection ? (
            <p className="post-empty">Loading duas…</p>
          ) : (
            <>
              <form className="friend-search dhikr-search" role="search" onSubmit={(event) => event.preventDefault()}>
                <input
                  className="form-control"
                  type="search"
                  placeholder="Search duas"
                  aria-label="Search duas"
                  value={query}
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </form>

              <p className="dhikr-count">
                {filteredDuas.length === duas.length
                  ? `${duas.length} duas`
                  : `${filteredDuas.length} of ${duas.length} duas`}
              </p>

              {filteredDuas.length === 0 ? (
                <p className="post-empty">No duas match.</p>
              ) : (
                <>
                  <div className="dhikr-duas">
                    {visibleDuas.map((dua) => (
                      <article className="ayah-block" key={dua.id}>
                        <header className="favourite-head">
                          <div className="favourite-heading">
                            <span
                              className="dhikr-dua-title dhikr-script"
                              dir={activeCollection.dir}
                              lang={duaLang}
                            >
                              <DuaText text={dua.title} />
                            </span>
                            {dua.subcategory && (
                              <span
                                className="favourite-num dhikr-script"
                                dir={activeCollection.dir}
                                lang={duaLang}
                              >
                                <DuaText text={dua.subcategory} />
                              </span>
                            )}
                          </div>
                          <div className="ayah-actions">
                            <button
                              type="button"
                              className="fav-btn"
                              title="Copy dua"
                              aria-label={`Copy ${dua.title || 'dua'}`}
                              onClick={() =>
                                copy(
                                  [dua.arabic, dua.transliteration, dua.translation, dua.reference && `Source: ${dua.reference}`]
                                    .filter(Boolean)
                                    .join('\n\n')
                                )
                              }
                            >
                              <span className="material-symbols-rounded">content_copy</span>
                            </button>
                          </div>
                        </header>

                        <p className="ayah-arabic-text dhikr-dua-arabic" dir="rtl" lang="ar" style={arabicStyle}>
                          {dua.arabic}
                        </p>
                        {dua.transliteration && (
                          <p className="dhikr-dua-transliteration">{dua.transliteration}</p>
                        )}

                        <div className="ayah-translation">
                          <p className="ayah-translation-label">Translation</p>
                          <p
                            className="ayah-translation-text dhikr-script"
                            dir={activeCollection.dir}
                            lang={duaLang}
                          >
                            <DuaText text={dua.translation} />
                          </p>
                        </div>

                        {dua.reference && (
                          <p className="dhikr-dua-source">
                            Source:{' '}
                            <span className="dhikr-script" dir={activeCollection.dir} lang={duaLang}>
                              <DuaText text={dua.reference} />
                            </span>
                          </p>
                        )}
                      </article>
                    ))}
                  </div>

                  {filteredDuas.length > duaLimit && (
                    <div className="dhikr-more">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setDuaLimit((value) => value + DUA_PAGE_SIZE)}
                      >
                        Show more ({filteredDuas.length - duaLimit} left)
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
