import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { api, quran } from '../services/api';

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

// Shown immediately, then replaced by the real Ayah of the Day when the public
// Qur'an index answers. A marketing page should never wait on a network round
// trip to have something beautiful in its hero.
const FALLBACK_AYAH = {
  surahNo: 13,
  ayahNo: 28,
  surahName: "Ar-Ra'd",
  surahNameArabic: 'الرعد',
  arabicText: 'أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ',
  translationText: 'Verily, in the remembrance of Allah do hearts find rest.',
  translationLabel: 'Sahih International',
};

// The signed APK ships in public/android/ and the file name carries its
// version, so this has to move with every release. docs/android-releases.md
// has the checklist; installed phones find updates on their own through
// public/android/version.json.
const ANDROID_APP = {
  version: '1.5',
  size: '78 KB',
  href: '/android/Hasanath-1.5.apk',
};

// The studio behind Hasanath. That site lives in its own repository and is
// deployed separately; set VITE_UMI_APPS_URL at build time if the domain moves.
const UMI_APPS = {
  name: 'UMI Apps',
  href: import.meta.env.VITE_UMI_APPS_URL || 'https://umiapps.vercel.app',
};

const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#together', label: 'Friends' },
  { href: '#quran', label: 'Qur’an' },
  { href: '#how', label: 'How it works' },
  { href: '#community', label: 'Community' },
];

// Same six ids and names the Settings picker uses. The swatch is split
// diagonally - the accent gradient on one half, that palette's chrome on the
// other - so the round button and the menu preview show both tones before the
// visitor chooses. Kept local because this is the only place outside Settings
// that needs the labels.
const ACCENT_OPTIONS = [
  { value: 'green', label: 'Emerald', from: '#0f766e', to: '#2dd4bf', chrome: '#092b27' },
  { value: 'blue', label: 'Blue', from: '#2563eb', to: '#60a5fa', chrome: '#05080f' },
  { value: 'violet', label: 'Violet', from: '#7c3aed', to: '#a78bfa', chrome: '#08050f' },
  { value: 'gold', label: 'Gold', from: '#b45309', to: '#fbbf24', chrome: '#171006' },
  { value: 'rose', label: 'Rose', from: '#be123c', to: '#fb7185', chrome: '#12050a' },
  { value: 'ocean', label: 'Ocean', from: '#0e7490', to: '#22d3ee', chrome: '#041016' },
];

function accentSwatch(option) {
  return `linear-gradient(135deg, ${option.from} 0 46%, ${option.chrome} 46% 100%)`;
}

const FEATURES = [
  {
    id: 'salah',
    icon: 'checklist_rtl',
    label: 'Salah',
    title: 'See your day take shape.',
    body: 'Log each prayer in a tap, keep a gentle streak, and notice the rhythm of your worship without turning it into a scoreboard.',
    points: ['One tap per prayer', 'A clear daily view', 'Streaks that encourage, not pressure'],
    to: '/salah',
  },
  {
    id: 'quran',
    icon: 'auto_stories',
    label: 'Qur’an',
    title: 'The Qur’an, without the noise.',
    body: 'Read all 114 surahs, switch translations, follow along with reciters, and pick up exactly where you left off.',
    points: ['114 surahs', 'Multiple translations', 'Reciter audio and bookmarks'],
    to: '/quran',
  },
  {
    id: 'challenges',
    icon: 'emoji_events',
    label: 'Challenges',
    title: 'Small goals. Real momentum.',
    body: 'Set a daily goal for yourself, or invite friends in and keep each other steady. Every check-in adds to a streak you can look back on.',
    points: ['Goals that fit your life, daily or one-off', 'Shared challenges with up to 20 friends', 'Streaks, a leaderboard and catch-up days'],
    to: '/challenges',
  },
  {
    id: 'friends',
    icon: 'group',
    label: 'Friends',
    title: 'Keep good company.',
    body: 'Find friends by username and visit their profile. No follower counts, no public metrics — just the people you actually keep company with.',
    points: ['Search friends by username', 'Public profiles, private worship logs', 'A notification for every request and invite'],
    to: '/posts',
  },
  {
    id: 'community',
    icon: 'favorite',
    label: 'Community',
    title: 'Reflections worth sharing.',
    body: 'Share a verse, a lesson, or a quiet win. Read what others are learning, without the noise of a general feed.',
    points: ['Share reflections', 'Read what others learn', 'Your account, your identity'],
    to: '/posts',
  },
];

// The tools that live beside the tracker. None of them had a place on this
// page, so a visitor who only read the marketing copy never learned the app
// also carries hadith, prayer times, the qibla, the Hijri calendar, giving and
// a monthly summary.
const TOOLS = [
  {
    icon: 'menu_book',
    title: 'Hadith',
    body: 'The sayings of the Prophet ﷺ from the major collections, searchable, with bookmarks.',
    to: '/hadith',
  },
  {
    icon: 'schedule',
    title: 'Salah timings',
    body: 'Today’s prayer times for where you are, and what is next.',
    to: '/salah-timings',
  },
  {
    icon: 'explore',
    title: 'Qibla',
    body: 'A compass that points to the Ka’bah, wherever you happen to be.',
    to: '/qibla',
  },
  {
    icon: 'calendar_month',
    title: 'Islamic calendar',
    body: 'Hijri dates and months, side by side with the Gregorian day.',
    to: '/calendar',
  },
  {
    icon: 'volunteer_activism',
    title: 'Charity',
    body: 'Set a giving goal and keep a quiet record of what you give toward it.',
    to: '/charity',
  },
  {
    icon: 'insights',
    title: 'Stats',
    body: 'Salah, challenges and giving, gathered into one monthly view.',
    to: '/stats',
  },
];

const STEPS = [
  {
    icon: 'person_add',
    title: 'Begin',
    body: 'Create an account, or step in as a guest. Nothing is asked of you before you are ready.',
  },
  {
    icon: 'task_alt',
    title: 'Build',
    body: 'Log a prayer, read a page, tick a challenge. One small deed at a time is the whole method.',
  },
  {
    icon: 'trending_up',
    title: 'Grow',
    body: 'Watch your streaks and reflections become a record of effort, not a measure of worth.',
  },
];

const CHALLENGE_DEMO = [
  { icon: 'menu_book', name: 'Read one page', streak: 12 },
  { icon: 'favorite', name: 'Morning dhikr', streak: 8 },
  { icon: 'volunteer_activism', name: 'Give a little', streak: 5 },
  { icon: 'nightlight', name: 'Qiyam on Friday', streak: 3 },
];

// A shared challenge as the app shows it: each member's own streak, and
// whether they have checked in today.
const FRIEND_DEMO = [
  { initial: 'A', name: 'Amina', note: 'Checked in today', streak: 12, done: true },
  { initial: 'Y', name: 'Yusuf', note: 'Checked in today', streak: 9, done: true },
  { initial: 'S', name: 'Sara', note: 'Not yet today', streak: 4, done: false },
];

function PrayerRing({ value, size = 144 }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value, 0), PRAYERS.length) / PRAYERS.length;

  return (
    <div
      className="landing-ring"
      style={{ '--ring-size': `${size}px` }}
      role="img"
      aria-label={`${value} of ${PRAYERS.length} prayers completed`}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle className="landing-ring-track" cx="60" cy="60" r={radius} />
        <circle
          className="landing-ring-fill"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <div className="landing-ring-label">
        <strong>{value}<span>/{PRAYERS.length}</span></strong>
        <span>prayers</span>
      </div>
    </div>
  );
}

function PreviewFrame({ children, className = '' }) {
  return (
    <div className={`landing-preview ${className}`.trim()}>
      <div className="landing-preview-bar" aria-hidden="true">
        <span /><span /><span />
      </div>
      {children}
    </div>
  );
}

function MiniPost({ initial, name, time, text }) {
  return (
    <article className="landing-mini-post">
      <div className="landing-mini-post-head">
        <span className="landing-avatar" aria-hidden="true">{initial}</span>
        <div className="landing-post-meta">
          <strong>{name}</strong>
          <span>{time}</span>
        </div>
        <span className="material-symbols-rounded landing-post-more" aria-hidden="true">more_horiz</span>
      </div>
      <p className="landing-mini-post-text">{text}</p>
      <div className="landing-mini-post-actions" aria-hidden="true">
        <span><span className="material-symbols-rounded">favorite</span>24</span>
        <span><span className="material-symbols-rounded">chat_bubble</span>3</span>
        <span className="material-symbols-rounded">share</span>
      </div>
    </article>
  );
}

function SalahPreview() {
  return (
    <PreviewFrame className="landing-preview--salah">
      <div className="landing-preview-head">
        <div>
          <span className="landing-preview-kicker">Salah Tracker</span>
          <h3>Today</h3>
        </div>
        <span className="landing-badge">5 / 5</span>
      </div>
      <div className="landing-preview-salah">
        <PrayerRing value={5} size={124} />
        <div className="landing-preview-rows">
          {PRAYERS.map((prayer) => (
            <div className="landing-preview-row" key={prayer}>
              <span className="material-symbols-rounded">check_circle</span>
              <span>{prayer}</span>
              <span className="landing-preview-time">Logged</span>
            </div>
          ))}
        </div>
      </div>
      <p className="landing-preview-note">A clear picture of the day, without a scoreboard.</p>
    </PreviewFrame>
  );
}

function QuranPreview() {
  return (
    <PreviewFrame className="landing-preview--quran">
      <div className="landing-preview-head">
        <div>
          <span className="landing-preview-kicker">Qur’an</span>
          <h3>Ar-Ra’d · 13:28</h3>
        </div>
        <span className="landing-badge">Sahih International</span>
      </div>
      <p className="landing-preview-arabic">أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ</p>
      <p className="landing-preview-translation">Verily, in the remembrance of Allah do hearts find rest.</p>
      <div className="landing-preview-audio">
        <span className="material-symbols-rounded">play_arrow</span>
        <div className="landing-preview-wave" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((bar) => <span key={bar} />)}
        </div>
        <span className="landing-preview-duration">0:32</span>
      </div>
    </PreviewFrame>
  );
}

function ChallengesPreview() {
  return (
    <PreviewFrame className="landing-preview--challenges">
      <div className="landing-preview-head">
        <div>
          <span className="landing-preview-kicker">Challenges</span>
          <h3>This week</h3>
        </div>
        <span className="landing-badge">4 active</span>
      </div>
      <div className="landing-challenge-grid">
        {CHALLENGE_DEMO.map((item) => (
          <div className="landing-challenge" key={item.name}>
            <div className="landing-challenge-top">
              <span className="material-symbols-rounded">{item.icon}</span>
              <span className="landing-challenge-streak">{item.streak}d</span>
            </div>
            <strong>{item.name}</strong>
            <div className="landing-challenge-bar">
              <span style={{ width: `${Math.min(item.streak * 8, 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

function CommunityPreview() {
  return (
    <PreviewFrame className="landing-preview--community">
      <div className="landing-preview-head">
        <div>
          <span className="landing-preview-kicker">Community</span>
          <h3>Reflections</h3>
        </div>
        <span className="landing-badge">Feed</span>
      </div>
      <MiniPost
        initial="A"
        name="Amina"
        time="2m"
        text="A small reminder: consistency matters more than intensity."
      />
      <MiniPost
        initial="Y"
        name="Yusuf"
        time="18m"
        text="Finished my first full week of reading after Maghrib, alhamdulillah."
      />
    </PreviewFrame>
  );
}

function FriendsPreview() {
  return (
    <PreviewFrame className="landing-preview--friends">
      <div className="landing-preview-head">
        <div>
          <span className="landing-preview-kicker">Friends’ challenge</span>
          <h3>Read after Maghrib</h3>
        </div>
        <span className="landing-badge">4 members</span>
      </div>
      <div className="landing-friends">
        {FRIEND_DEMO.map((friend) => (
          <div className="landing-friend" key={friend.name}>
            <span className="landing-avatar" aria-hidden="true">{friend.initial}</span>
            <div className="landing-friend-meta">
              <strong>{friend.name}</strong>
              <span>{friend.note}</span>
            </div>
            <span className={`landing-friend-streak${friend.done ? ' is-done' : ''}`}>
              <span className="material-symbols-rounded" aria-hidden="true">
                {friend.done ? 'local_fire_department' : 'schedule'}
              </span>
              {friend.streak}d
            </span>
          </div>
        ))}
      </div>
      <p className="landing-preview-note">Everyone sees the streak. Nobody sees your log.</p>
    </PreviewFrame>
  );
}

const PREVIEWS = {
  salah: SalahPreview,
  quran: QuranPreview,
  challenges: ChallengesPreview,
  friends: FriendsPreview,
  community: CommunityPreview,
};

export default function LandingPage() {
  const { homePath, setTheme, theme, accent, setAccent } = useSession();
  const appHref = homePath || '/quran';

  // The salah card is a real little demo, not a screenshot: tapping a prayer
  // updates the ring. It is the smallest possible taste of the product.
  const [done, setDone] = useState([true, true, true, false, false]);
  const [activeFeature, setActiveFeature] = useState('salah');
  const [menuOpen, setMenuOpen] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [ayah, setAyah] = useState(FALLBACK_AYAH);
  const [liveAyah, setLiveAyah] = useState(false);
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  );
  const [selectedAccent, setSelectedAccent] = useState(
    () => document.documentElement.getAttribute('data-accent') || 'green'
  );
  const artRef = useRef(null);
  const accentRef = useRef(null);

  const currentAccent = ACCENT_OPTIONS.find((option) => option.value === selectedAccent) || ACCENT_OPTIONS[0];

  const doneCount = done.filter(Boolean).length;
  const active = FEATURES.find((feature) => feature.id === activeFeature) || FEATURES[0];
  const ActivePreview = PREVIEWS[active.id] || SalahPreview;

  // The shell's theme is authoritative once meta arrives; reading the <html>
  // attribute first keeps the toggle correct even if the boot request failed.
  useEffect(() => {
    if (theme === 'dark' || theme === 'light') setDark(theme === 'dark');
  }, [theme]);

  // Same idea for the accent: the session value wins once it is known, and
  // falling back to the attribute covers the first paint before meta arrives.
  useEffect(() => {
    if (typeof accent === 'string' && ACCENT_OPTIONS.some((option) => option.value === accent)) {
      setSelectedAccent(accent);
    }
  }, [accent]);

  useEffect(() => {
    if (!accentOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setAccentOpen(false);
    };
    const onPointerDown = (event) => {
      if (accentRef.current && !accentRef.current.contains(event.target)) {
        setAccentOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [accentOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // The public Qur'an index already carries the global Ayah of the Day in the
  // reader's primary translation. Reusing it keeps one source of truth.
  useEffect(() => {
    let cancelled = false;
    quran.index()
      .then((data) => {
        const next = data && data.ayahOfTheDay;
        if (!cancelled && next && next.arabicText && next.translationText) {
          setAyah(next);
          setLiveAyah(true);
        }
      })
      .catch(() => {
        // The fallback is already on screen; a failed fetch is not something a
        // visitor needs to see on a marketing page.
      });
    return () => { cancelled = true; };
  }, []);

  // Reveal sections as they enter the viewport. Without JS (or with reduced
  // motion) everything starts visible, so the page is never blank.
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('.landing-reveal'));
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) root.style.scrollBehavior = 'smooth';
    return () => { root.style.scrollBehavior = previous; };
  }, []);

  function handleArtMove(event) {
    const node = artRef.current;
    if (!node) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    node.style.setProperty('--mx', x.toFixed(3));
    node.style.setProperty('--my', y.toFixed(3));
  }

  function handleArtLeave() {
    const node = artRef.current;
    if (!node) return;
    node.style.setProperty('--mx', '0');
    node.style.setProperty('--my', '0');
  }

  function togglePrayer(index) {
    setDone((current) => current.map((value, i) => (i === index ? !value : value)));
  }

  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    setDark(!dark);
    setTheme(next);
    // /settings writes the guest store too, so a visitor's choice survives a
    // reload even before they have an account. A failure is not worth surfacing.
    api.post('/settings', { theme: next }).catch(() => {});
  }

  function chooseAccent(value) {
    setSelectedAccent(value);
    setAccent(value);
    setAccentOpen(false);
    // Same guest-store write as the theme toggle, so the palette survives a
    // reload before the visitor has an account.
    api.post('/settings', { accent: value }).catch(() => {});
  }

  function handleTabKey(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const tabs = event.currentTarget.parentElement;
    const index = FEATURES.findIndex((feature) => feature.id === activeFeature);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = FEATURES[(index + step + FEATURES.length) % FEATURES.length];
    setActiveFeature(next.id);
    if (tabs && tabs.children[FEATURES.indexOf(next)]) {
      tabs.children[FEATURES.indexOf(next)].focus();
    }
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">Skip to content</a>

      <div className="landing-bg" aria-hidden="true">
        <span className="landing-orb landing-orb--one" />
        <span className="landing-orb landing-orb--two" />
        <span className="landing-orb landing-orb--three" />
        <span className="landing-grid" />
      </div>

      <header className={`landing-nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="landing-inner landing-nav-inner">
          <Link to="/" className="landing-brand" aria-label="Hasanath home">
            <span className="landing-brand-mark material-symbols-rounded" aria-hidden="true">mosque</span>
            <span className="landing-brand-text">Hasanath</span>
          </Link>

          <nav className="landing-links" aria-label="Landing sections">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>{link.label}</a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <div className="landing-accent" ref={accentRef}>
              <button
                type="button"
                className="landing-accent-btn"
                onClick={() => setAccentOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={accentOpen}
                aria-label={`Accent colour: ${currentAccent.label}`}
                title={`Accent colour: ${currentAccent.label}`}
              >
                <span
                  className="landing-accent-dot"
                  style={{ '--swatch': accentSwatch(currentAccent) }}
                  aria-hidden="true"
                />
              </button>
              {accentOpen && (
                <div className="landing-accent-menu" role="menu" aria-label="Accent colour">
                  {ACCENT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={option.value === selectedAccent}
                      className={`landing-accent-option${option.value === selectedAccent ? ' is-active' : ''}`}
                      onClick={() => chooseAccent(option.value)}
                    >
                      <span
                        className="landing-accent-swatch"
                        style={{ '--swatch': accentSwatch(option) }}
                        aria-hidden="true"
                      />
                      <span className="landing-accent-name">{option.label}</span>
                      {option.value === selectedAccent && (
                        <span className="material-symbols-rounded landing-accent-check" aria-hidden="true">
                          check
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="landing-theme"
              onClick={toggleTheme}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {dark ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            <Link to="/login" className="btn btn-outline">Sign in</Link>
            <Link to="/register" className="btn btn-primary">Get started</Link>
          </div>

          <button
            type="button"
            className="landing-menu-btn"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              {menuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>

        {menuOpen && (
          <div className="landing-mobile-menu" id="landing-mobile-menu">
            <nav className="landing-mobile-links" aria-label="Landing sections">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} onClick={closeMenu}>{link.label}</a>
              ))}
            </nav>
            <div className="landing-mobile-actions">
              <Link to="/login" className="btn btn-outline" onClick={closeMenu}>Sign in</Link>
              <Link to="/register" className="btn btn-primary" onClick={closeMenu}>Get started</Link>
            </div>
          </div>
        )}
      </header>

      <main id="landing-main">
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-inner landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow">
                <span className="landing-eyebrow-dot" aria-hidden="true" />
                A calmer way to grow
              </p>
              <h1 id="landing-hero-title" className="landing-headline">
                <span className="landing-headline-line">Every good deed,</span><br />
                <span className="landing-grad">remembered.</span>
              </h1>
              <p className="landing-lede">
                Track your salah, read the Qur’an, take on challenges with friends,
                and share reflections — in one quiet, ad-free place.
              </p>
              <div className="landing-cta-row">
                <Link to="/register" className="btn btn-primary">
                  Begin your journey
                  <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </Link>
                <Link to={appHref} className="btn btn-outline">
                  Explore without an account
                </Link>
              </div>
              <a className="landing-android-link" href={ANDROID_APP.href} download>
                <span className="material-symbols-rounded" aria-hidden="true">android</span>
                Download for Android
                <span className="landing-android-link-meta">APK · {ANDROID_APP.size}</span>
              </a>
              <div className="landing-trust">
                <span className="landing-trust-item">
                  <span className="material-symbols-rounded" aria-hidden="true">check_circle</span>
                  Free to use
                </span>
                <span className="landing-trust-item">
                  <span className="material-symbols-rounded" aria-hidden="true">block</span>
                  No ads
                </span>
                <span className="landing-trust-item">
                  <span className="material-symbols-rounded" aria-hidden="true">lock</span>
                  Your data stays yours
                </span>
              </div>
            </div>

            <div
              className="landing-hero-art"
              ref={artRef}
              onMouseMove={handleArtMove}
              onMouseLeave={handleArtLeave}
            >
              <div className="landing-watermark" aria-hidden="true">حسنات</div>

              <div className="landing-float landing-float--salah">
                <div className="landing-float-inner landing-card">
                  <div className="landing-card-top">
                    <span className="landing-card-eyebrow">Today’s salah</span>
                    <span className="landing-pill">Try it</span>
                  </div>
                  <div className="landing-salah-body">
                    <PrayerRing value={doneCount} size={140} />
                    <div className="landing-prayer-list">
                      {PRAYERS.map((prayer, index) => (
                        <button
                          key={prayer}
                          type="button"
                          className={`landing-prayer${done[index] ? ' is-done' : ''}`}
                          onClick={() => togglePrayer(index)}
                          aria-pressed={done[index]}
                        >
                          <span className="landing-prayer-icon material-symbols-rounded" aria-hidden="true">
                            {done[index] ? 'check' : 'radio_button_unchecked'}
                          </span>
                          {prayer}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="landing-card-hint">Tap a prayer to try it</p>
                  <span className="sr-only" aria-live="polite">
                    {doneCount} of {PRAYERS.length} prayers complete
                  </span>
                </div>
              </div>

              <div className="landing-float landing-float--ayah">
                <div className="landing-float-inner landing-card landing-card--ayah">
                  <div className="landing-card-top">
                    <span className="landing-card-eyebrow">Ayah of the day</span>
                    <span className="landing-pill">{liveAyah ? 'Live' : 'Reflection'}</span>
                  </div>
                  <p className="landing-ayah-arabic" lang="ar" dir="rtl">{ayah.arabicText}</p>
                  <p className="landing-ayah-translation">{ayah.translationText}</p>
                  <div className="landing-ayah-meta">
                    <span>{ayah.surahName} · {ayah.surahNo}:{ayah.ayahNo}</span>
                    <span>{ayah.translationLabel || 'Translation'}</span>
                  </div>
                </div>
              </div>

              <div className="landing-float landing-float--streak">
                <div className="landing-float-inner landing-card landing-card--streak">
                  <div className="landing-card-top">
                    <span className="landing-card-eyebrow">Consistency</span>
                    <span className="landing-pill">12 days</span>
                  </div>
                  <div className="landing-streak-top">
                    <span className="landing-flame material-symbols-rounded" aria-hidden="true">
                      local_fire_department
                    </span>
                    <div>
                      <strong>12</strong>
                      <span>day streak</span>
                    </div>
                  </div>
                  <div className="landing-week" aria-hidden="true">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
                      <span
                        key={`${day}-${index}`}
                        className={`landing-day${index < 5 ? ' is-done' : ''}`}
                      >
                        {day}
                      </span>
                    ))}
                  </div>
                  <p className="landing-card-hint">Small and steady beats big and brief.</p>
                </div>
              </div>

              <div className="landing-float landing-float--post">
                <div className="landing-float-inner">
                  <MiniPost
                    initial="A"
                    name="Amina"
                    time="2m"
                    text="A small reminder: the deed most beloved to Allah is the one done consistently, even if it is small."
                  />
                </div>
              </div>

              <div className="landing-float landing-float--badge" aria-hidden="true">
                <div className="landing-float-inner landing-badge-float">
                  <span className="material-symbols-rounded">verified</span>
                  Private by design
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="landing-marquee" aria-hidden="true">
          <div className="landing-marquee-track">
            {[0, 1].map((group) => (
              <div className="landing-marquee-group" key={group}>
                {['Salah', 'Qur’an', 'Dhikr', 'Challenges', 'Friends', 'Hadith', 'Reflection', 'Community'].map((item) => (
                  <span className="landing-marquee-item" key={`${group}-${item}`}>
                    {item}
                    <span className="landing-marquee-star material-symbols-rounded">star</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section className="landing-section landing-section--tight" aria-label="Hasanath at a glance">
          <div className="landing-inner landing-stats landing-reveal">
            <div className="landing-stat">
              <strong className="landing-stat-value">5</strong>
              <span className="landing-stat-label">daily prayers</span>
            </div>
            <div className="landing-stat">
              <strong className="landing-stat-value">114</strong>
              <span className="landing-stat-label">surahs to read</span>
            </div>
            <div className="landing-stat">
              <strong className="landing-stat-value">0</strong>
              <span className="landing-stat-label">ads or distractions</span>
            </div>
          </div>
        </section>

        <section id="features" className="landing-section" aria-labelledby="features-title">
          <div className="landing-inner">
            <div className="landing-section-head landing-reveal">
              <p className="landing-kicker">One quiet place</p>
              <h2 id="features-title" className="landing-section-title">
                Everything your worship needs.
              </h2>
              <p className="landing-section-lede">
                No dashboards to manage, no streak anxiety. Just the practices you
                already care about, laid out clearly.
              </p>
            </div>

            <div className="landing-tabs" role="tablist" aria-label="Hasanath features">
              {FEATURES.map((feature) => (
                <button
                  key={feature.id}
                  type="button"
                  role="tab"
                  id={`landing-tab-${feature.id}`}
                  aria-selected={active.id === feature.id}
                  aria-controls="landing-feature-panel"
                  tabIndex={active.id === feature.id ? 0 : -1}
                  className={`landing-tab${active.id === feature.id ? ' is-active' : ''}`}
                  onClick={() => setActiveFeature(feature.id)}
                  onKeyDown={handleTabKey}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">{feature.icon}</span>
                  {feature.label}
                </button>
              ))}
            </div>

            <div
              className="landing-stage"
              key={active.id}
              role="tabpanel"
              id="landing-feature-panel"
              aria-labelledby={`landing-tab-${active.id}`}
            >
              <div className="landing-stage-preview">
                <ActivePreview />
              </div>
              <div className="landing-stage-copy">
                <span
                  className="landing-stage-icon material-symbols-rounded"
                  aria-hidden="true"
                >
                  {active.icon}
                </span>
                <h3>{active.title}</h3>
                <p>{active.body}</p>
                <ul className="landing-checklist">
                  {active.points.map((point) => (
                    <li key={point}>
                      <span className="material-symbols-rounded" aria-hidden="true">check</span>
                      {point}
                    </li>
                  ))}
                </ul>
                <Link to={active.to} className="landing-text-link">
                  Explore {active.label}
                  <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="together" className="landing-section landing-together" aria-labelledby="together-title">
          <div className="landing-inner landing-split">
            <div className="landing-split-copy landing-reveal">
              <p className="landing-kicker">Together</p>
              <h2 id="together-title" className="landing-section-title">
                Good habits hold better with company.
              </h2>
              <p className="landing-section-lede">
                Add a friend by username, then start a challenge you all check in
                to. You see each other’s streaks and nothing else — the daily
                nudging happens without anyone reading your records.
              </p>
              <ul className="landing-checklist">
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Find friends by username, accept or decline requests
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  One shared challenge for up to 20 friends
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Daily check-ins with a shared streak and a leaderboard
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Catch up on a missed day from the past week
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  A notification when someone invites, accepts or checks in
                </li>
              </ul>
              <Link to="/challenges" className="btn btn-primary">
                Start a challenge with friends
                <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>

            <div className="landing-community-stack landing-reveal">
              <div className="landing-card">
                <div className="landing-card-top">
                  <span className="landing-card-eyebrow">New invitation</span>
                  <span className="landing-pill">Just now</span>
                </div>
                <p className="landing-invite-text">
                  <strong>Amina</strong> invited you to <strong>Read after Maghrib</strong>.
                </p>
                <div className="landing-invite-actions" aria-hidden="true">
                  <span className="landing-invite-btn is-accept">Accept</span>
                  <span className="landing-invite-btn">Decline</span>
                </div>
              </div>

              <div className="landing-card">
                <div className="landing-card-top">
                  <span className="landing-card-eyebrow">Shared streak</span>
                  <span className="landing-pill">7 days</span>
                </div>
                <div className="landing-streak-top">
                  <span className="landing-flame material-symbols-rounded" aria-hidden="true">
                    local_fire_department
                  </span>
                  <div>
                    <strong>7</strong>
                    <span>days together</span>
                  </div>
                </div>
                <div className="landing-friends">
                  {FRIEND_DEMO.map((friend) => (
                    <div className="landing-friend" key={`shared-${friend.name}`}>
                      <span className="landing-avatar" aria-hidden="true">{friend.initial}</span>
                      <div className="landing-friend-meta">
                        <strong>{friend.name}</strong>
                        <span>Best {friend.streak}</span>
                      </div>
                      <span className={`landing-friend-streak${friend.done ? ' is-done' : ''}`}>
                        <span className="material-symbols-rounded" aria-hidden="true">
                          {friend.done ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                        {friend.done ? 'Today' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="landing-card-hint">Three of four checked in today.</p>
              </div>

              <div className="landing-community-note">
                <span className="material-symbols-rounded" aria-hidden="true">lock</span>
                Friends see the challenge you share. Your salah and reading log stay private.
              </div>
            </div>
          </div>
        </section>

        <section id="quran" className="landing-section landing-quran" aria-labelledby="quran-title">
          <div className="landing-inner landing-split">
            <div className="landing-split-copy landing-reveal">
              <p className="landing-kicker">The Qur’an</p>
              <h2 id="quran-title" className="landing-section-title">
                Open the Qur’an, without the noise.
              </h2>
              <p className="landing-section-lede">
                All 114 surahs, the translations you trust, and reciter audio in the
                same calm reader. Your place is remembered for next time.
              </p>
              <ul className="landing-checklist">
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  114 surahs with Arabic and translation
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Multiple translations and reciters
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Ayah of the Day, in your primary translation
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Bookmarks and last-read position
                </li>
              </ul>
              <Link to="/quran" className="btn btn-primary">
                Read the Qur’an
                <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>

            <div className="landing-ayah-live landing-reveal">
              <div className="landing-ayah-live-head">
                <div>
                  <span className="landing-card-eyebrow">Ayah of the day</span>
                  <h3>{ayah.surahName}</h3>
                </div>
                <span className="landing-pill">{liveAyah ? 'Live' : 'Daily'}</span>
              </div>
              <p className="landing-ayah-live-arabic" lang="ar" dir="rtl">{ayah.arabicText}</p>
              <p className="landing-ayah-live-translation">{ayah.translationText}</p>
              <div className="landing-ayah-live-meta">
                <span>{ayah.surahName} · {ayah.surahNo}:{ayah.ayahNo}</span>
                <span>{ayah.translationLabel || 'Translation'}</span>
              </div>
              <Link
                to={`/surah/${ayah.surahNo}?ayah=${ayah.ayahNo}`}
                className="landing-text-link"
              >
                Read the full surah
                <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>

        <section id="how" className="landing-section" aria-labelledby="how-title">
          <div className="landing-inner">
            <div className="landing-section-head landing-reveal">
              <p className="landing-kicker">A simple rhythm</p>
              <h2 id="how-title" className="landing-section-title">
                Three steps, repeated gently.
              </h2>
              <p className="landing-section-lede">
                Hasanath is built around consistency, not perfection. Start where
                you are.
              </p>
            </div>
            <div className="landing-steps">
              {STEPS.map((step, index) => (
                <div
                  className="landing-step landing-reveal"
                  key={step.title}
                  style={{ '--step-delay': `${index * 0.1}s` }}
                >
                  <span className="landing-step-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="landing-step-icon material-symbols-rounded" aria-hidden="true">
                    {step.icon}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="community"
          className="landing-section landing-community"
          aria-labelledby="community-title"
        >
          <div className="landing-inner landing-split landing-split--reverse">
            <div className="landing-community-stack landing-reveal">
              <MiniPost
                initial="A"
                name="Amina"
                time="2m"
                text="A small reminder: consistency matters more than intensity. One page today is enough."
              />
              <MiniPost
                initial="Y"
                name="Yusuf"
                time="18m"
                text="Finished my first full week of reading after Maghrib, alhamdulillah. Small steps add up."
              />
              <div className="landing-community-note">
                <span className="material-symbols-rounded" aria-hidden="true">lock</span>
                You choose what to share. Your logs stay private.
              </div>
            </div>

            <div className="landing-split-copy landing-reveal">
              <p className="landing-kicker">Community</p>
              <h2 id="community-title" className="landing-section-title">
                Reflections worth sharing.
              </h2>
              <p className="landing-section-lede">
                Share a verse, a lesson, or a quiet win. Read what others are
                learning — without the noise of a general feed.
              </p>
              <ul className="landing-checklist">
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  A feed built around reflection, not engagement
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Public profiles, private worship logs
                </li>
                <li>
                  <span className="material-symbols-rounded" aria-hidden="true">check</span>
                  Share a post with a single link
                </li>
              </ul>
              <Link to="/posts" className="btn btn-primary">
                Visit the feed
                <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="tools-title">
          <div className="landing-inner">
            <div className="landing-section-head landing-reveal">
              <p className="landing-kicker">Also inside</p>
              <h2 id="tools-title" className="landing-section-title">
                The rest of the day, in the same place.
              </h2>
              <p className="landing-section-lede">
                Hadith, prayer times, the qiblah, the Hijri calendar, giving and a
                monthly summary — all one tap from the tracker.
              </p>
            </div>
            <div className="landing-tools">
              {TOOLS.map((tool, index) => (
                <Link
                  key={tool.title}
                  to={tool.to}
                  className="landing-tool landing-reveal"
                  style={{ '--step-delay': `${index * 0.06}s` }}
                >
                  <span className="landing-tool-icon material-symbols-rounded" aria-hidden="true">
                    {tool.icon}
                  </span>
                  <h3>
                    {tool.title}
                    <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                  </h3>
                  <p>{tool.body}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-android" aria-labelledby="android-title">
          <div className="landing-inner">
            <div className="landing-android-card landing-reveal">
              <span className="landing-android-mark material-symbols-rounded" aria-hidden="true">
                android
              </span>
              <div className="landing-android-copy">
                <p className="landing-kicker">Also on Android</p>
                <h2 id="android-title">Keep it on your phone.</h2>
                <p>
                  Prefer an app icon? Install Hasanath straight from the file — no
                  store account, the same tracker, and the next version is offered
                  from inside the app.
                </p>
                <p className="landing-android-meta">
                  Version {ANDROID_APP.version} · {ANDROID_APP.size}
                </p>
              </div>
              <div className="landing-android-actions">
                <a className="btn btn-primary" href={ANDROID_APP.href} download>
                  <span className="material-symbols-rounded" aria-hidden="true">download</span>
                  Download APK
                </a>
                <span className="landing-android-hint">
                  Android asks once whether to allow installs from your browser.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-quote-section" aria-label="A reminder">
          <div className="landing-inner">
            <figure className="landing-quote landing-reveal">
              <p className="landing-quote-arabic" lang="ar" dir="rtl">
                أَحَبُّ الْأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ
              </p>
              <blockquote className="landing-quote-text">
                “The most beloved deeds to Allah are those that are most consistent,
                even if they are small.”
              </blockquote>
              <figcaption className="landing-quote-cite">Sahih al-Bukhari 6464</figcaption>
            </figure>
          </div>
        </section>

        <section className="landing-final-section" aria-labelledby="landing-final-title">
          <div className="landing-inner">
            <div className="landing-final landing-reveal">
              <span className="landing-final-orbit" aria-hidden="true" />
              <p className="landing-kicker">Start where you are</p>
              <h2 id="landing-final-title" className="landing-final-title">
                One prayer. One page. One day.
              </h2>
              <p className="landing-final-lede">
                You do not need a perfect week to begin. You need one small deed,
                today.
              </p>
              <div className="landing-final-actions">
                <Link to="/register" className="btn btn-primary">
                  Create your account
                  <span className="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                </Link>
                <Link to={appHref} className="btn btn-outline">Try it first</Link>
              </div>
              <p className="landing-final-note">Free to use · No ads · No subscription</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-inner landing-footer-grid">
          <div className="landing-footer-brand">
            <Link to="/" className="landing-brand" aria-label="Hasanath home">
              <span className="landing-brand-mark material-symbols-rounded" aria-hidden="true">
                mosque
              </span>
              <span className="landing-brand-text">Hasanath</span>
            </Link>
            <p>Every good deed, remembered.</p>
            <p className="landing-footer-note">
              A calm place for salah, Qur’an, and the small habits that add up.
            </p>
            <a
              className="landing-footer-parent"
              href={UMI_APPS.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="landing-footer-parent-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <defs>
                    <linearGradient id="umiMiniRing" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#2dd4bf" />
                      <stop offset="0.5" stopColor="#6366f1" />
                      <stop offset="1" stopColor="#ffb45c" />
                    </linearGradient>
                    <clipPath id="umiMiniClip">
                      <circle cx="12" cy="12" r="10" />
                    </clipPath>
                  </defs>
                  <g clipPath="url(#umiMiniClip)">
                    <circle cx="12" cy="12" r="10" fill="#0a1024" />
                    <circle cx="12" cy="13.6" r="9" fill="#ff8a3d" opacity="0.22" />
                    <circle cx="12" cy="12.8" r="4" fill="#ffd166" />
                    <path
                      d="M1.5 16 5.6 10.5 8 13.2 10.8 8l2.8 5.4 2.4-2.6 6.5 5.2Z"
                      fill="#2dd4bf"
                    />
                    <path
                      d="M1.5 18.2 4.8 13.6l2.6 2.6 2.8-4.2 3.2 4.6 2.9-3.4 5.2 5Z"
                      fill="#3b82f6"
                      opacity="0.9"
                    />
                    <path
                      d="M1.5 20.6 5 16.6l2.6 2.4 2.5-3.7 2.8 3.8 3.1-2.8 4.5 4.3Z"
                      fill="#22305c"
                    />
                  </g>
                  <circle
                    cx="12"
                    cy="12"
                    r="10.6"
                    fill="none"
                    stroke="url(#umiMiniRing)"
                    strokeWidth="1.2"
                  />
                </svg>
              </span>
              <span>
                A product of <strong>{UMI_APPS.name}</strong>
              </span>
              <svg
                className="landing-footer-parent-arrow"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M8 16 16 8M9 8h7v7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>

          <div className="landing-footer-col">
            <h3>App</h3>
            <Link to="/quran">Qur’an</Link>
            <Link to="/hadith">Hadith</Link>
            <Link to="/salah">Salah Tracker</Link>
            <Link to="/challenges">Challenges</Link>
            <Link to="/posts">Community</Link>
            <Link to="/charity">Charity</Link>
            <Link to="/stats">Stats</Link>
            <a href={ANDROID_APP.href} download>
              Android app (APK)
            </a>
          </div>

          <div className="landing-footer-col">
            <h3>Account</h3>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create an account</Link>
            <Link to={appHref}>Continue as guest</Link>
          </div>

          <div className="landing-footer-col">
            <h3>Explore</h3>
            <Link to="/salah-timings">Salah timings</Link>
            <Link to="/qibla">Qibla</Link>
            <Link to="/calendar">Islamic calendar</Link>
            <Link to="/notifications">Notifications</Link>
            <Link to="/settings">Settings</Link>
          </div>
        </div>

        <div className="landing-inner landing-footer-bottom">
          <span>© {new Date().getFullYear()} Hasanath</span>
          <span>Track · Pray · Grow</span>
        </div>
      </footer>
    </div>
  );
}
