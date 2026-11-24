import { useCallback, useEffect, useMemo, useState } from 'react';
import FormSelect from '../components/FormSelect';
import { useToast } from '../components/ToastProvider';
import { settings as settingsApi } from '../services/api';
import { localDateKey } from '../utils/date';
import { DHIKR_PRESETS, DUA_CATEGORIES, DUAS } from '../data/adhkar';

// A tiny, offline-first dhikr counter plus a searchable dua collection. The
// counts live in localStorage, keyed by the local day, so the module needs no
// account and no network - a PWA (or the Android WebView) can open it offline.
const STORAGE_KEY = 'hasanath-dhikr';

const TABS = [
  { id: 'dhikr', label: 'Dhikr', icon: 'repeat' },
  { id: 'duas', label: 'Duas', icon: 'format_quote' },
];

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

export default function DhikrDuaPage() {
  const toast = useToast();
  const [tab, setTab] = useState('dhikr');
  const [presetId, setPresetId] = useState('subhanallah');
  const [state, setState] = useState(loadCounts);
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
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

  const count = state.counts[presetId] || 0;
  const total = state.totals[presetId] || 0;
  const todayTotal = useMemo(
    () => Object.values(state.totals).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [state.totals]
  );
  const progress = preset.target > 0 ? Math.min(100, Math.round((count / preset.target) * 100)) : 0;
  const reached = preset.target > 0 && count >= preset.target;
  const arabicStyle = { fontFamily: `'${arabicFont}', serif` };

  const increment = useCallback(() => {
    setState((current) => ({
      ...current,
      counts: { ...current.counts, [presetId]: (current.counts[presetId] || 0) + 1 },
      totals: { ...current.totals, [presetId]: (current.totals[presetId] || 0) + 1 },
    }));
  }, [presetId]);

  const reset = useCallback(() => {
    setState((current) => ({
      ...current,
      counts: { ...current.counts, [presetId]: 0 },
    }));
  }, [presetId]);

  const filteredDuas = useMemo(() => {
    const term = query.trim().toLowerCase();
    return DUAS.filter((dua) => {
      if (category !== 'All' && dua.category !== category) return false;
      if (!term) return true;
      return [dua.title, dua.arabic, dua.transliteration, dua.translation, dua.category]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [category, query]);

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
          </div>
        </div>
      ) : (
        <>
          {/* The category rail reuses the hadith reader's chip rail, so the
              filter reads exactly like the other collection screens. */}
          <div className="hadith-langs">
            <span className="hadith-langs-label">Category</span>
            <div className="hadith-sections-chips">
              {['All', ...DUA_CATEGORIES].map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`hadith-chip${category === item ? ' is-active' : ''}`}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

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

          {filteredDuas.length === 0 ? (
            <p className="post-empty">No duas match.</p>
          ) : (
            <div className="dhikr-duas">
              {filteredDuas.map((dua) => (
                <article className="ayah-block" key={dua.id}>
                  <header className="favourite-head">
                    <div className="favourite-heading">
                      <span className="dhikr-dua-title">{dua.title}</span>
                      <span className="favourite-num">{dua.category}</span>
                      {dua.repeat > 1 && <span className="favourite-num">×{dua.repeat}</span>}
                    </div>
                    <div className="ayah-actions">
                      <button
                        type="button"
                        className="fav-btn"
                        title="Copy dua"
                        aria-label={`Copy ${dua.title}`}
                        onClick={() => copy(`${dua.arabic}\n${dua.transliteration}\n${dua.translation}`)}
                      >
                        <span className="material-symbols-rounded">content_copy</span>
                      </button>
                    </div>
                  </header>

                  <p className="ayah-arabic-text dhikr-dua-arabic" dir="rtl" lang="ar" style={arabicStyle}>
                    {dua.arabic}
                  </p>
                  <p className="dhikr-dua-transliteration">{dua.transliteration}</p>

                  <div className="ayah-translation">
                    <p className="ayah-translation-label">Translation</p>
                    <p className="ayah-translation-text">{dua.translation}</p>
                  </div>

                  <p className="dhikr-dua-source">Source: {dua.source}</p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
