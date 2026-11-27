import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { challenges, quran } from '../../services/api';
import { useToast } from '../ToastProvider';
import FormSelect from '../FormSelect';
import { copyText } from '../../utils/clipboard';
import { localDateKey } from '../../utils/date';

// A reading challenge's window uses the same presets as the Challenges page,
// plus the open-ended option the server already supports.
const PERIOD_OPTIONS = [
  { value: '10', label: '10 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'none', label: 'No end date' },
];

// The exact verse a reading challenge should reopen at. `lastAyah` is the most
// recent "surah:ayah" the server counted today; without it the reader's own
// last-read position is the best guess.
function readingLink(challenge, lastRead) {
  const [surahNo, ayahNo] = String(challenge.lastAyah || '').split(':').map(Number);
  if (Number.isInteger(surahNo) && surahNo >= 1 && Number.isInteger(ayahNo) && ayahNo >= 1) {
    return `/surah/${surahNo}?ayah=${ayahNo}&view=single`;
  }
  if (lastRead) return `/surah/${lastRead.surahNo}?ayah=${lastRead.ayahNo}&view=single`;
  return '/surah/1?view=single';
}

// Class names mirror views/quran-read.ejs exactly.
export default function ReadTab({ surahs, ayahOfTheDay, lastReadHistory, favoriteFont, isLoggedIn }) {
  const [term, setTerm] = useState('');
  // The refreshed ayah is local state on purpose: it is not saved anywhere, so
  // leaving the Quran page and coming back shows the stored daily ayah again.
  const [randomAyah, setRandomAyah] = useState(null);
  const [randomLoading, setRandomLoading] = useState(false);
  const toast = useToast();

  // Daily ayah challenges. They live on the same personal-challenge document
  // as every other habit, so this is a plain read of /api/challenges; the
  // Challenges tab lists the very same rows.
  const [challengeList, setChallengeList] = useState([]);
  const [challengeLoading, setChallengeLoading] = useState(true);
  const [challengeError, setChallengeError] = useState('');
  const [target, setTarget] = useState('5');
  const [period, setPeriod] = useState('30');
  const [creatingChallenge, setCreatingChallenge] = useState(false);

  useEffect(() => {
    let cancelled = false;
    challenges.list()
      .then((payload) => { if (!cancelled) setChallengeList(payload.challenges || []); })
      .catch(() => { if (!cancelled) setChallengeError('Could not load your reading challenge.'); })
      .finally(() => { if (!cancelled) setChallengeLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter((s, i) => s.surahName.toLowerCase().includes(q) || String(i + 1).includes(q));
  }, [surahs, term]);

  const shown = randomAyah || ayahOfTheDay;
  const isRandom = Boolean(randomAyah);

  // The most recent verse still in the history, for a reading challenge whose
  // own lastAyah is missing. Rows opened only in the list view carry no verse.
  const lastRead = useMemo(() => {
    const entry = (lastReadHistory || []).find((row) => row.ayahNo);
    return entry ? { surahNo: entry.surahNo, ayahNo: entry.ayahNo } : null;
  }, [lastReadHistory]);

  const activeReading = useMemo(
    () => challengeList.filter(
      (challenge) => challenge.kind === 'quran' && (challenge.status || 'active') === 'active'
    ),
    [challengeList]
  );

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

  // Starts the daily reading challenge from the Qur'an page. The Challenges
  // tab is the full editor; this is the one-tap entry point the reader asked
  // for while they are already reading.
  async function startReadingChallenge() {
    const dailyTarget = Number(target);
    if (!Number.isInteger(dailyTarget) || dailyTarget < 1 || dailyTarget > 50) {
      setChallengeError('Choose between 1 and 50 ayahs a day.');
      return;
    }
    setCreatingChallenge(true);
    setChallengeError('');
    try {
      await challenges.create({
        name: 'Daily Qur’an reading',
        kind: 'quran',
        dailyTarget,
        startDate: localDateKey(),
        period,
      });
      // Re-read instead of trusting the create response: the list carries the
      // presented fields (status, todayAyahs) the progress card needs.
      const payload = await challenges.list();
      setChallengeList(payload.challenges || []);
      toast('Daily ayah challenge started');
    } catch (err) {
      setChallengeError('Could not start that challenge.');
    } finally {
      setCreatingChallenge(false);
    }
  }

  // Shares the verse exactly as shown - Arabic plus the translation the reader
  // has chosen. The daily one names itself "Ayah of the Day" so the recipient
  // knows why it arrived.
  async function shareAyah() {
    if (!shown) return;
    const appUrl = `${window.location.origin}/surah/${shown.surahNo}?ayah=${shown.ayahNo}&view=single`;
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
        <div className="container1 is-flat">
          <div className="featured-head">
            <div className="featured-label">{isRandom ? 'Random Ayah' : 'Ayah of the Day'}</div>

            {/* The actions sit on the label row rather than under the verse:
                share, open in the reader and show another verse stay reachable
                without reading to the bottom of a long ayah. */}
            <div className="featured-ayah-actions">
              {/* Back to the daily ayah, first in the icon row so it lines up
                  with the other controls instead of pushing the label aside. */}
              {isRandom && (
                <button
                  type="button"
                  className="fav-btn featured-back"
                  onClick={() => setRandomAyah(null)}
                  title="Back to Ayah of the Day"
                  aria-label="Back to Ayah of the Day"
                >
                  <span className="material-symbols-rounded">arrow_back</span>
                </button>
              )}
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
                to={`/surah/${shown.surahNo}?ayah=${shown.ayahNo}&view=single`}
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

          {/* No link around the whole block any more: reading it should not
              navigate away by accident. The header buttons do the things the
              card used to imply - share, open in the reader, and show another
              verse. */}
          <div className="featured-surah">
            {/* One compact reference line - the surah name and the verse
                number together - instead of a heading plus a second line for
                the Arabic name. */}
            <div className="featured-ayah-ref">
              <p className="featured-ayah-cite">{shown.surahName} {shown.surahNo}:{shown.ayahNo}</p>
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
          </div>
        </div>
      )}

      {/* Every surah in the five-entry history keeps the compact pill strip.
          A surah with a saved verse shows it and reopens that ayah; a surah
          only opened in the list view shows just its name. */}
      {lastReadHistory && lastReadHistory.length > 0 && (
        <div className="container1 is-flat">
          <div className="card-header"><h3>Continue Reading</h3></div>
          <div className="scrollable-container">
            {lastReadHistory.map((entry) => {
              const name = surahs[entry.surahNo - 1]?.surahName || `Surah ${entry.surahNo}`;
              const to = entry.ayahNo
                ? `/surah/${entry.surahNo}?ayah=${entry.ayahNo}&view=single`
                : `/surah/${entry.surahNo}`;
              return (
                <Link
                  key={entry.surahNo}
                  to={to}
                  className="surah-pill"
                  aria-label={`Continue ${name} at ayah ${entry.ayahNo}`}
                >
                  {name} {entry.surahNo}:{entry.ayahNo}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* The daily ayah challenge lives here because this is where reading
          starts. It is a normal personal challenge underneath, so the
          Challenges tab lists it, counts the streak and lets it be edited or
          deleted like any other. */}
      <div className="container1 is-flat quran-challenge-card">
        <div className="card-header">
          <h3>Daily Ayah challenge</h3>
          {activeReading.length > 0 && (
            <span className="badge badge-primary">
              {activeReading.length} active
            </span>
          )}
        </div>

        {activeReading.map((challenge) => {
          const dailyTarget = Number(challenge.dailyTarget) || 1;
          const count = Number(challenge.todayAyahs) || 0;
          const percent = Math.min(100, Math.round((count / dailyTarget) * 100));
          return (
            <div
              className={`quran-challenge-item${challenge.targetReached ? ' is-done' : ''}`}
              key={challenge._id}
            >
              <div className="quran-challenge-item-head">
                <strong>{challenge.challenge}</strong>
                <span className="quran-challenge-count">
                  {count} / {dailyTarget} today
                </span>
              </div>
              <div
                className="quran-challenge-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={dailyTarget}
                aria-valuenow={count}
                aria-label={`${challenge.challenge}: ${count} of ${dailyTarget} ayahs today`}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="quran-challenge-item-foot">
                <span className="quran-challenge-streak">
                  <span className="material-symbols-rounded" aria-hidden="true">local_fire_department</span>
                  {challenge.currentStreak || 0} day streak
                </span>
                <Link className="btn btn-primary btn-sm" to={readingLink(challenge, lastRead)}>
                  {challenge.targetReached ? 'Read more' : 'Continue reading'}
                </Link>
              </div>
            </div>
          );
        })}

        {activeReading.length === 0 && (
          !isLoggedIn ? (
            <p className="quran-challenge-gate">
              <span className="material-symbols-rounded" aria-hidden="true">lock</span>
              <span>
                <Link to="/login">Sign in</Link> to start a daily ayah challenge and keep your streak.
              </span>
            </p>
          ) : challengeLoading ? (
            <p className="quran-challenge-hint">Checking your challenges…</p>
          ) : (
            <div className="quran-challenge-form">
              <div className="salah-form-grid">
                <div className="form-floating">
                  <input
                    id="ayah-challenge-target"
                    className="form-control form-control-sm"
                    type="number"
                    min="1"
                    max="50"
                    placeholder="5"
                    value={target}
                    onChange={(e) => { setTarget(e.target.value); setChallengeError(''); }}
                  />
                  <label htmlFor="ayah-challenge-target">Ayahs per day</label>
                </div>
                <FormSelect
                  id="ayah-challenge-period"
                  label="Challenge period"
                  value={period}
                  options={PERIOD_OPTIONS}
                  onChange={setPeriod}
                />
              </div>
              <div className="quran-challenge-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={creatingChallenge}
                  onClick={startReadingChallenge}
                >
                  {creatingChallenge ? 'Starting…' : 'Start challenge'}
                </button>
                <Link to="/challenges" className="btn btn-outline btn-sm">All challenges</Link>
              </div>
            </div>
          )
        )}

        {challengeError && (
          <p className="challenge-form-error" role="alert">{challengeError}</p>
        )}
      </div>

      <div className="container1 is-flat">
        <div className="card-header">
          <h3>All Surahs</h3>
          <span className="badge badge-primary">114 Surahs</span>
        </div>
        {/* The search belongs to the list it filters, so it sits under the
            heading instead of in a card of its own with a second title. */}
        <div className="surah-search-wrapper">
          <input
            type="text"
            className="surah-search-input"
            placeholder="Search by number or name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label="Search surahs by number or name"
          />
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
