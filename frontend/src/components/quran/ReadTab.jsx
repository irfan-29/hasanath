import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { quran } from '../../services/api';
import { useToast } from '../ToastProvider';
import { copyText } from '../../utils/clipboard';

// Class names mirror views/quran-read.ejs exactly.
export default function ReadTab({ surahs, ayahOfTheDay, lastReadSurahs, favoriteFont }) {
  const [term, setTerm] = useState('');
  // The refreshed ayah is local state on purpose: it is not saved anywhere, so
  // leaving the Quran page and coming back shows the stored daily ayah again.
  const [randomAyah, setRandomAyah] = useState(null);
  const [randomLoading, setRandomLoading] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter((s, i) => s.surahName.toLowerCase().includes(q) || String(i + 1).includes(q));
  }, [surahs, term]);

  const shown = randomAyah || ayahOfTheDay;
  const isRandom = Boolean(randomAyah);

  async function loadRandomAyah() {
    if (randomLoading) return;
    setRandomLoading(true);
    try {
      const next = await quran.randomAyah();
      setRandomAyah(next);
    } catch (err) {
      toast('Could not load another ayah', { kind: 'error' });
    } finally {
      setRandomLoading(false);
    }
  }

  // Shares the verse exactly as shown - Arabic plus the translation the reader
  // has chosen. The daily one names itself "Ayah of the Day" so the recipient
  // knows why it arrived.
  async function shareAyah() {
    if (!shown) return;
    const appUrl = `${window.location.origin}/surah/${shown.surahNo}?ayah=${shown.ayahNo}`;
    const text = [
      `${isRandom ? 'Random Ayah' : 'Ayah of the Day'} · Hasanath`,
      `${shown.surahName} ${shown.surahNo}:${shown.ayahNo}`,
      shown.arabicText,
      shown.translationLabel,
      shown.translationText,
      appUrl,
    ].filter(Boolean).join('\n\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: `${shown.surahName} ${shown.surahNo}:${shown.ayahNo}`, text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // Fall through to copying.
      }
    }

    try {
      await copyText(text);
      toast(isRandom ? 'Ayah copied' : 'Ayah of the Day copied');
    } catch (err) {
      toast('Could not share this ayah', { kind: 'error' });
    }
  }

  return (
    <div className="quran-tab-panel" data-tab-panel="read">
      {shown && (
        <div className="container1">
          <div className="featured-head">
            <div className="featured-label">{isRandom ? 'Random Ayah' : 'Ayah of the Day'}</div>
            {isRandom && (
              <button type="button" className="featured-reset" onClick={() => setRandomAyah(null)}>
                Back to Ayah of the Day
              </button>
            )}
          </div>

          {/* No link around the whole block any more: reading it should not
              navigate away by accident. The three buttons underneath do the
              things the card used to imply - share, open in the reader, and
              show another verse. */}
          <div className="featured-surah">
            <div className="featured-ayah-ref">
              <p className="featured-ayah-cite">Surah {shown.surahNo} · Ayah {shown.ayahNo}</p>
              <p className="featured-ayah-surah">
                <span>{shown.surahName}</span>
                {shown.surahNameArabic && (
                  <span
                    className="featured-ayah-surah-arabic"
                    dir="rtl"
                    lang="ar"
                    style={{ fontFamily: `'${favoriteFont}', serif` }}
                  >
                    {shown.surahNameArabic}
                  </span>
                )}
              </p>
            </div>
            {shown.arabicText && (
              <p className="featured-ayah-arabic" dir="rtl" lang="ar" style={{ fontFamily: `'${favoriteFont}', serif` }}>
                {shown.arabicText}
              </p>
            )}
            {shown.translationText && (
              <>
                {shown.translationLabel && (
                  <p className="featured-ayah-edition">{shown.translationLabel}</p>
                )}
                <p className="featured-ayah-translation">{shown.translationText}</p>
              </>
            )}

            <div className="featured-ayah-actions">
              <button
                type="button"
                className="fav-btn"
                onClick={shareAyah}
                title="Share this ayah"
                aria-label="Share this ayah"
              >
                <span className="material-symbols-rounded">share</span>
              </button>
              <Link
                className="fav-btn"
                to={`/surah/${shown.surahNo}?ayah=${shown.ayahNo}`}
                title="Open in the reader"
                aria-label={`Open ${shown.surahName} ayah ${shown.ayahNo} in the reader`}
              >
                <span className="material-symbols-rounded">open_in_new</span>
              </Link>
              <button
                type="button"
                className="fav-btn"
                onClick={loadRandomAyah}
                disabled={randomLoading}
                title="Show a random ayah"
                aria-label="Show a random ayah"
              >
                <span className={`material-symbols-rounded${randomLoading ? ' is-spinning' : ''}`}>refresh</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {lastReadSurahs && lastReadSurahs.length > 0 && (
        <div className="container1">
          <div className="card-header"><h3>Continue Reading</h3></div>
          <div className="scrollable-container">
            {lastReadSurahs.map((no) => (
              <Link key={no} to={`/surah/${no}`} className="surah-pill">
                {no}. {surahs[no - 1]?.surahName}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="container1">
        <div className="card-header">
          <h3>Find a Surah</h3>
        </div>
        <div className="surah-search-wrapper">
          <input
            type="text"
            className="surah-search-input"
            placeholder="Search by number or name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="container1">
        <div className="card-header">
          <h3>All Surahs</h3>
          <span className="badge badge-primary">114 Surahs</span>
        </div>
        <div className="surah-grid">
          {filtered.map((surah, i) => {
            const no = surahs.indexOf(surah) + 1;
            return (
              <Link key={no} to={`/surah/${no}`} className="surah-card">
                <span className="surah-card-number">{no}</span>
                <div className="surah-card-content">
                  <p className="surah-name">{surah.surahName}</p>
                  {/* The Arabic name wears the reader's chosen Qur'an face,
                      the same one the ayahs use, instead of the UI font. */}
                  <p
                    className="surah-arabic"
                    dir="rtl"
                    lang="ar"
                    style={{ fontFamily: `'${favoriteFont}', serif` }}
                  >
                    {surah.surahNameArabic}
                  </p>
                  <p className="surah-translation">{surah.surahNameTranslation}</p>
                  <p className="surah-meta">{surah.revelationPlace} · {surah.totalAyah} Ayahs</p>
                </div>
                <span className="material-symbols-rounded surah-card-arrow">chevron_right</span>
              </Link>
            );
          })}
        </div>
        {filtered.length === 0 && <p className="post-empty">No surah matches “{term}”.</p>}
      </div>
    </div>
  );
}
