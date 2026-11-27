import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setPageTitle } from '../hooks/usePageMeta';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { challenges as challengesApi, quran } from '../services/api';
import { useFavourites } from '../hooks/useFavourites';
import { copyText } from '../utils/clipboard';
import { useToast } from '../components/ToastProvider';
import Loader from '../components/Loader';

// The reader has two presentations of the same surah: the long list (the
// original page) and one ayah at a time with previous/next. The chosen one is
// remembered so opening the reader again feels the same, while an explicit
// `?view=` in the URL wins - that is what "Continue reading" and shared links
// send.
const VIEW_STORAGE_KEY = 'salah-quran-view';

function storedView() {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'single' ? 'single' : 'list';
  } catch (err) {
    // Private mode or a blocked store: fall back to the original list view.
    return 'list';
  }
}

function viewFromParams(params) {
  const fromUrl = params.get('view');
  if (fromUrl === 'single' || fromUrl === 'list') return fromUrl;
  return storedView();
}

function ayahFromParams(params) {
  const n = Number(params.get('ayah'));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

// Rewrites the query string without pushing a history entry. Reading is one
// activity: pressing "next ayah" twenty times should not bury the page the
// reader arrived from under twenty back-button steps.
function replaceQuery(search) {
  const query = search.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

export default function SurahPage() {
  const { surahNo } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);

  // "Surah Al-Fatiha (1) · Hasanath" in the tab, in history and in search
  // results, once the surah's name is known.
  useEffect(() => {
    if (data && data.surahName) setPageTitle(`Surah ${data.surahName} (${data.surahNo})`);
  }, [data]);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => viewFromParams(params));
  const [selectedAyah, setSelectedAyah] = useState(() => ayahFromParams(params));
  const [shareNotice, setShareNotice] = useState({ ayah: 0, status: '' });
  const shareTimer = useRef(null);
  // Debounced writer for the exact verse. Shared by the single-ayah view and
  // by an explicit jump in list view, so both remember where the reader is.
  const lastReadTimer = useRef(null);
  const lastReadSaved = useRef('');
  const { favourites, isFavourite, toggleFavourite } = useFavourites();
  const toast = useToast();

  // Reading challenges this account is working through today. Guests cannot
  // own one (creating needs an account), so this stays empty for them and the
  // reader never posts progress.
  const [readingChallenges, setReadingChallenges] = useState([]);

  const totalAyahs = data?.arabic?.length || 0;
  const urlAyah = Number(params.get('ayah'));

  useEffect(() => () => window.clearTimeout(shareTimer.current), []);

  // Shares the same translations the reader is looking at, all in one message.
  // The URL ends the text deliberately: native share sheets keep text order,
  // while a separate `url` field is often appended somewhere unpredictable.
  async function shareAyah(ayahNo) {
    if (!data) return;
    const index = ayahNo - 1;
    const translationText = data.translations
      .map((t) => {
        const translated = t.texts[index];
        return translated ? `${t.label}\n${translated}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    const appUrl = `${window.location.origin}/surah/${data.surahNo}?ayah=${ayahNo}&view=single`;
    const text = [
      'Hasanath — Qur’an',
      `${data.surahName} ${data.surahNo}:${ayahNo}`,
      data.arabic[index] || '',
      translationText,
      appUrl,
    ].filter(Boolean).join('\n\n');

    const note = (status) => {
      setShareNotice({ ayah: ayahNo, status });
      window.clearTimeout(shareTimer.current);
      shareTimer.current = window.setTimeout(() => {
        setShareNotice({ ayah: 0, status: '' });
      }, 1800);
    };

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${data.surahName} ${data.surahNo}:${ayahNo}`,
          text,
        });
        note('shared');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // A share sheet can fail for reasons the clipboard can still handle.
      }
    }

    try {
      await copyText(text);
      note('copied');
    } catch (err) {
      note('failed');
    }
  }

  // Keeps the slider honest: a surah with fewer ayahs than the slider was left
  // on would show an out-of-range value.
  useEffect(() => {
    setSelectedAyah((current) => (totalAyahs && current > totalAyahs ? totalAyahs : current));
  }, [totalAyahs]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    quran.surah(surahNo)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load this surah.'); });
    return () => { cancelled = true; };
  }, [surahNo]);

  // Seeded from the surah payload so the hearts are correct on first paint,
  // then replaced by whatever the shared favourites hook has loaded.
  const favKeys = useMemo(() => {
    if (favourites.length) return new Set(favourites.map((f) => `${f.surahNo}:${f.ayahNo}`));
    return new Set((data?.favouriteKeys) || []);
  }, [favourites, data]);

  // Opening a surah without ?ayah resumes at the stored verse, so a plain
  // /surah/2 and the "Continue reading" link agree. An explicit ?ayah always
  // wins because the URL is the shareable source of truth.
  //
  // This runs once per surah, not on every selectedAyah change: moving within
  // a surah must never be undone by re-seeding. Without the ref, navigating to
  // the next surah would also keep the previous surah's ayah number.
  const seededSurah = useRef(0);
  useEffect(() => {
    if (!data) return;
    if (seededSurah.current === data.surahNo) {
      if (selectedAyah > totalAyahs) setSelectedAyah(totalAyahs || 1);
      return;
    }
    seededSurah.current = data.surahNo;

    if (Number.isInteger(urlAyah) && urlAyah >= 1 && urlAyah <= totalAyahs) {
      setSelectedAyah(urlAyah);
      return;
    }

    const stored = data.lastRead;
    const storedAyah = Number(stored && stored.ayahNo);
    if (
      stored
      && Number(stored.surahNo) === Number(data.surahNo)
      && Number.isInteger(storedAyah)
      && storedAyah >= 1
      && storedAyah <= totalAyahs
    ) {
      setSelectedAyah(storedAyah);
      return;
    }

    setSelectedAyah(1);
  }, [data, totalAyahs, urlAyah, selectedAyah]);

  // Moves to an ayah, keeps the URL shareable, and (in list view) scrolls the
  // verse into the middle of the screen. A jump is an explicit reading
  // position, so it is saved even in list view; the initial render is not,
  // which stops browsing from overwriting a stored verse with ayah 1.
  const goToAyah = useCallback((n, { scroll = true } = {}) => {
    const ayah = Math.min(Math.max(Number(n) || 1, 1), Math.max(totalAyahs || 1, 1));
    setSelectedAyah(ayah);
    const search = new URLSearchParams(window.location.search);
    search.set('ayah', String(ayah));
    if (view === 'single') search.set('view', 'single');
    replaceQuery(search);
    const key = `${surahNo}:${ayah}`;
    if (lastReadSaved.current !== key) {
      window.clearTimeout(lastReadTimer.current);
      lastReadTimer.current = window.setTimeout(() => {
        lastReadSaved.current = key;
        quran.saveLastRead(Number(surahNo), ayah).catch(() => {
          // The position is a convenience; failing to save must not interrupt
          // reading.
        });
      }, 600);
    }
    if (!scroll) return;
    const el = document.getElementById(view === 'single' ? 'single-ayah' : String(ayah));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }, [totalAyahs, view, surahNo]);

  const stepAyah = useCallback((delta) => {
    const next = Math.min(Math.max(selectedAyah + delta, 1), Math.max(totalAyahs || 1, 1));
    if (next === selectedAyah) return;
    goToAyah(next);
  }, [selectedAyah, totalAyahs, goToAyah]);

  // Arrow keys follow the Arabic reading direction: the next verse is to the
  // left. Typing in the search/range fields is left alone.
  useEffect(() => {
    if (!data || view !== 'single') return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (event.target && event.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepAyah(1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepAyah(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [data, view, stepAyah]);

  // Compact bar that takes over once the page title scrolls away, so the
  // surah number, name and the way back stay reachable while reading.
  const headerRef = useRef(null);
  const [barStuck, setBarStuck] = useState(false);

  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setBarStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { rootMargin: '-8px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [data]);

  // Deep link support: /surah/2?ayah=255 opens scrolled to that ayah. Runs on
  // surah change and whenever the query changes, since the DOM only exists once
  // `data` has loaded.
  //
  // This has to sit ABOVE the early returns below. React compares the hook list
  // between renders, so an effect placed after `if (!data) return` only exists on
  // the loaded render - the first render calls fewer hooks than the second, and
  // React throws "Rendered more hooks than during the previous render", which
  // blanks the whole app.
  const deepLinkHandled = useRef('');
  useEffect(() => {
    if (!data || !urlAyah || view === 'single') return;
    const key = `${data.surahNo}:${urlAyah}`;
    if (deepLinkHandled.current === key) return;
    deepLinkHandled.current = key;
    goToAyah(urlAyah);
  }, [data, urlAyah, view, goToAyah]);

  // Save the exact verse. Debounced so holding "next" writes once the reader
  // settles, not once per tap. The list view already records the surah through
  // the GET that loaded it; only the single-ayah view knows a verse here.
  useEffect(() => {
    if (!data || view !== 'single') return undefined;
    const key = `${data.surahNo}:${selectedAyah}`;
    if (lastReadSaved.current === key) return undefined;
    window.clearTimeout(lastReadTimer.current);
    lastReadTimer.current = window.setTimeout(() => {
      lastReadSaved.current = key;
      quran.saveLastRead(data.surahNo, selectedAyah).catch(() => {
        // The position is a convenience; failing to save must not interrupt
        // reading.
      });
    }, 600);
    return () => window.clearTimeout(lastReadTimer.current);
  }, [data, view, selectedAyah]);

  // Active reading challenges, loaded once per surah visit. A failure only
  // hides the progress strip; the reader itself does not depend on it.
  useEffect(() => {
    if (!data || !data.isLoggedIn) return undefined;
    let cancelled = false;
    challengesApi.list()
      .then((payload) => {
        if (cancelled) return;
        setReadingChallenges((payload.challenges || []).filter(
          (challenge) => challenge.kind === 'quran' && (challenge.status || 'active') === 'active'
        ));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data]);

  // One verse, one unit of progress. Debounced like the position save so a
  // slider drag posts only the verse the reader settles on, not every value it
  // passes through. The server dedupes by surah:ayah as well, and the set here
  // stops a re-render from re-posting the same verse.
  //
  // All challenges are posted together and applied in one state update: posting
  // them one by one would update state after the first, re-run this effect and
  // cancel the rest of the loop.
  const postedAyahs = useRef(new Set());
  useEffect(() => {
    if (!data || view !== 'single' || !readingChallenges.length) return undefined;
    const key = `${data.surahNo}:${selectedAyah}`;
    if (postedAyahs.current.has(key)) return undefined;

    const timer = window.setTimeout(async () => {
      postedAyahs.current.add(key);
      const results = await Promise.all(readingChallenges.map(async (challenge) => {
        try {
          const result = await challengesApi.recordAyah(String(challenge._id), data.surahNo, selectedAyah);
          return { id: String(challenge._id), result };
        } catch (err) {
          // Progress is additive; a failed write just leaves the count as it was.
          return null;
        }
      }));

      const byId = new Map(results.filter(Boolean).map((entry) => [entry.id, entry.result]));
      if (!byId.size) return;
      setReadingChallenges((current) => current.map((entry) => (
        byId.has(String(entry._id)) ? byId.get(String(entry._id)).challenge : entry
      )));
      results.filter(Boolean).forEach((entry) => {
        if (entry.result.justCompleted) {
          toast(`${entry.result.challenge.challenge} complete for today`);
        }
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [data, view, selectedAyah, readingChallenges, toast]);

  function changeView(next) {
    if (next === view) return;
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch (err) {
      // Remembering the preference is optional.
    }
    const search = new URLSearchParams(window.location.search);
    search.set('ayah', String(selectedAyah));
    if (next === 'single') search.set('view', 'single');
    else search.delete('view');
    replaceQuery(search);
  }

  if (error) return <><div className="page-header"><h1>Surah</h1></div><div className="container1"><p className="post-empty">{error}</p></div></>;
  if (!data) return <Loader variant="page" label={`Loading ${surahNo}`} />;

  // One renderer for both views so the Arabic text, translations, share and
  // bookmark controls cannot drift apart between the list and the single ayah.
  function renderAyah(ayahNo) {
    const index = ayahNo - 1;
    const on = isFavourite(data.surahNo, ayahNo) || favKeys.has(`${data.surahNo}:${ayahNo}`);
    const shared = shareNotice.ayah === ayahNo ? shareNotice.status : '';
    const shareLabel = shared === 'copied'
      ? 'Ayah text copied'
      : shared === 'shared'
        ? 'Ayah shared'
        : shared === 'failed'
          ? 'Could not share ayah'
          : `Share ${data.surahName} ${data.surahNo}:${ayahNo}`;
    return (
      <article
        key={ayahNo}
        id={view === 'single' ? 'single-ayah' : String(ayahNo)}
        className={`ayah-block${view === 'single' ? ' ayah-block--single' : ''}`}
      >
        <div className="ayah-head">
          <p className="ayah-number">Ayah {ayahNo}</p>
          <div className="ayah-actions">
            <button
              type="button"
              className={`fav-btn ayah-share-btn${shared ? ` is-${shared}` : ''}`}
              aria-label={shareLabel}
              title={shared === 'copied' ? 'Copied' : 'Share ayah'}
              onClick={() => shareAyah(ayahNo)}
            >
              <span className="material-symbols-rounded">
                {shared === 'copied' || shared === 'shared' ? 'check' : shared === 'failed' ? 'error' : 'share'}
              </span>
            </button>
            <button
              type="button"
              className={`fav-btn bookmark-btn${on ? ' is-active' : ''}`}
              aria-pressed={on}
              aria-label={on ? 'Remove bookmark' : 'Bookmark this ayah'}
              onClick={() => toggleFavourite(data.surahNo, ayahNo)}
            >
              <span className="material-symbols-rounded">{on ? 'bookmark' : 'bookmark_border'}</span>
            </button>
          </div>
        </div>

        <p className="ayah-arabic-text" dir="rtl" lang="ar" style={{ fontFamily: `'${data.favoriteFont}', serif` }}>
          {data.arabic[index]}
        </p>

        {data.translations.map((t) => {
          const translated = t.texts[index];
          if (!translated) return null;
          const isPrimary = data.primaryTranslationId === t.id;
          return (
            <div className="ayah-translation" key={t.id}>
              <p className="ayah-translation-label">
                {t.label}{isPrimary ? ' · Primary' : ''}
              </p>
              <p className="ayah-translation-text">{translated}</p>
            </div>
          );
        })}
      </article>
    );
  }

  return (
    <>
      <Link to="/quran" className="reader-back">
        <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
        Quran
      </Link>

      {barStuck && (
        <div className="surah-sticky-bar">
          <div className="surah-sticky-inner">
            <Link to="/quran" className="surah-sticky-back" aria-label="Back to the surah list">
              <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
            </Link>
            <p className="surah-sticky-title">
              <span className="surah-sticky-no">{data.surahNo}.</span> {data.surahName}
            </p>
          </div>
        </div>
      )}

      <header className="page-header reader-header" ref={headerRef}>
        <p className="surah-page-kicker">Surah {data.surahNo} of 114</p>
        <h1>{data.surahName}</h1>
        <p className="surah-arabic-line">
          <span
            className="surah-arabic-name"
            dir="rtl"
            lang="ar"
            style={{ fontFamily: `'${data.favoriteFont}', serif` }}
          >
            {data.surahNameArabic}
          </span>
          <span className="surah-arabic-translation">· {data.surahNameTranslation}</span>
        </p>
        <div className="surah-meta-row">
          <span className="surah-meta-pill">
            <span className="material-symbols-rounded" aria-hidden="true">place</span>
            {data.revelationPlace}
          </span>
          <span className="surah-meta-pill">
            <span className="material-symbols-rounded" aria-hidden="true">menu_book</span>
            {data.totalAyah} Ayahs
          </span>
        </div>
      </header>

      {/* The two presentations of the same surah. The list keeps the original
          continuous read; single ayah gives the verse room and a clear way to
          move one step at a time - which is also what reading challenges
          count. */}
      <div className="reader-view-row">
        <span className="reader-view-label">View</span>
        <div className="reader-view-toggle" role="group" aria-label="Reading view">
          <button
            type="button"
            className={`reader-view-btn${view === 'list' ? ' is-active' : ''}`}
            aria-pressed={view === 'list'}
            onClick={() => changeView('list')}
          >
            <span className="material-symbols-rounded" aria-hidden="true">list</span>
            List
          </button>
          <button
            type="button"
            className={`reader-view-btn${view === 'single' ? ' is-active' : ''}`}
            aria-pressed={view === 'single'}
            onClick={() => changeView('single')}
          >
            <span className="material-symbols-rounded" aria-hidden="true">auto_stories</span>
            Single ayah
          </button>
        </div>
      </div>

      {/* Ayah navigator. views/surah.ejs had this between the surah meta and the
          ayah list; the port dropped it, so there was no way to jump to an ayah
          in a long surah. Same markup and same inline styling as the original. */}
      <div className="ayah-jump">
        <label htmlFor="ayahRange" className="ayah-jump-label">Go to Ayah</label>
        <input
          type="range" id="ayahRange" className="form-range"
          min="1" max={data.arabic.length} value={selectedAyah}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (view === 'single') goToAyah(n, { scroll: false });
            else setSelectedAyah(n);
          }}
        />
        <div className="ayah-jump-row">
          <span className="ayah-jump-caption">Ayah</span>
          <span className="ayah-jump-value">{selectedAyah}</span>
          {view === 'list' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => goToAyah(selectedAyah)}>Go</button>
          )}
        </div>
      </div>

      {view === 'single' ? (
        <>
          {readingChallenges.length > 0 && (
            <div className="ayah-reading-strip" aria-label="Reading challenge progress">
              {readingChallenges.map((challenge) => {
                const target = Number(challenge.dailyTarget) || 0;
                const count = Number(challenge.todayAyahs) || 0;
                const percent = target ? Math.min(100, Math.round((count / target) * 100)) : 0;
                return (
                  <div
                    className={`ayah-reading-item${challenge.targetReached ? ' is-done' : ''}`}
                    key={challenge._id}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">auto_stories</span>
                    <div className="ayah-reading-copy">
                      <strong>{challenge.challenge}</strong>
                      <span>{count} of {target} ayahs today</span>
                      <span
                        className="ayah-reading-bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={target}
                        aria-valuenow={count}
                        aria-label={`${challenge.challenge}: ${count} of ${target} ayahs today`}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </span>
                    </div>
                    <Link to="/challenges" className="ayah-reading-link">Challenges</Link>
                  </div>
                );
              })}
            </div>
          )}

          {renderAyah(selectedAyah)}

          <nav className="ayah-nav" aria-label="Ayah navigation">
            <button
              type="button"
              className="ayah-nav-btn"
              disabled={selectedAyah <= 1}
              onClick={() => stepAyah(-1)}
            >
              <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
              <span className="ayah-nav-copy">
                <span className="ayah-nav-label">Previous ayah</span>
                <span className="ayah-nav-value">
                  {selectedAyah > 1 ? `Ayah ${selectedAyah - 1}` : 'Start of surah'}
                </span>
              </span>
            </button>

            <span className="ayah-nav-count" aria-hidden="true">
              {selectedAyah} / {totalAyahs}
            </span>

            <button
              type="button"
              className="ayah-nav-btn is-next"
              disabled={selectedAyah >= totalAyahs}
              onClick={() => stepAyah(1)}
            >
              <span className="ayah-nav-copy">
                <span className="ayah-nav-label">Next ayah</span>
                <span className="ayah-nav-value">
                  {selectedAyah < totalAyahs ? `Ayah ${selectedAyah + 1}` : 'End of surah'}
                </span>
              </span>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
            </button>
          </nav>
        </>
      ) : (
        data.arabic.map((_, index) => renderAyah(index + 1))
      )}

      <nav className="surah-pager" aria-label="Surah navigation">
        {data.previousSurah ? (
          <Link
            className="surah-pager-link"
            to={`/surah/${data.previousSurah.surahNo}`}
            aria-label={`Previous surah: ${data.previousSurah.surahNo}. ${data.previousSurah.surahName}`}
          >
            <span className="surah-pager-direction">
              <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
              <span className="surah-pager-label">Previous surah</span>
            </span>
            <strong className="surah-pager-name">
              <span className="surah-pager-no">{data.previousSurah.surahNo}</span>
              <span className="surah-pager-title">{data.previousSurah.surahName}</span>
            </strong>
          </Link>
        ) : (
          <span className="surah-pager-link is-disabled" aria-disabled="true">
            <span className="surah-pager-direction">
              <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
              <span className="surah-pager-label">Previous surah</span>
            </span>
            <strong className="surah-pager-name">
              <span className="surah-pager-title">Start of the Qur’an</span>
            </strong>
          </span>
        )}

        {data.nextSurah ? (
          <Link
            className="surah-pager-link is-next"
            to={`/surah/${data.nextSurah.surahNo}`}
            aria-label={`Next surah: ${data.nextSurah.surahNo}. ${data.nextSurah.surahName}`}
          >
            <span className="surah-pager-direction">
              <span className="surah-pager-label">Next surah</span>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
            </span>
            <strong className="surah-pager-name">
              <span className="surah-pager-no">{data.nextSurah.surahNo}</span>
              <span className="surah-pager-title">{data.nextSurah.surahName}</span>
            </strong>
          </Link>
        ) : (
          <span className="surah-pager-link is-next is-disabled" aria-disabled="true">
            <span className="surah-pager-direction">
              <span className="surah-pager-label">Next surah</span>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
            </span>
            <strong className="surah-pager-name">
              <span className="surah-pager-title">End of the Qur’an</span>
            </strong>
          </span>
        )}
      </nav>
    </>
  );
}
