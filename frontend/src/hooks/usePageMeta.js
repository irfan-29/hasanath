import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// A title, description and official address for each page.
//
// Every route used to share the one title in index.html, so a search engine
// saw the Quran page, a surah and the Dhikr page as copies of the same page,
// and a browser tab or history entry never said where you were. This sets them
// from the route. A page that knows more than its route does (a surah's name)
// overrides the title itself once its data has loaded; see setPageTitle.

export const SITE_URL = 'https://hasanath.app';
const SITE_NAME = 'Hasanath';
const HOME = {
  title: "Hasanath — Qur'an, Salah & Good Deeds Tracker",
  description: "Hasanath helps you track salah, read Qur'an, and build daily good deeds.",
};

// First match wins, so longer paths come before the paths they start with.
const PAGES = [
  ['/surah/', { title: 'Surah', description: "Read and listen to the Qur'an, surah by surah, with translations in many languages." }],
  ['/quran', { title: "Qur'an", description: "Read, listen to and reflect on the Holy Qur'an: 114 surahs, translations in many languages, bookmarks and recitation." }],
  ['/hadith', { title: 'Hadith', description: 'Browse ten collections of hadith, including Sahih al-Bukhari and Sahih Muslim, and bookmark the ones that stay with you.' }],
  ['/salah-timings', { title: 'Salah Timings', description: 'Accurate prayer times for your city, with the Hijri date.' }],
  ['/salah', { title: 'Salah Tracker', description: 'Log your five daily prayers and see your day at a glance.' }],
  ['/privacy', { title: 'Privacy Policy', description: 'What information Hasanath holds about you, why, who else is involved, and how to delete it.' }],
  ['/terms', { title: 'Terms of Use', description: 'The rules for using Hasanath.' }],
  ['/credits', { title: 'Sources and credits', description: 'Where Hasanath’s Qur’an text, translations, hadith, prayer times and maps come from.' }],
  ['/masjids', { title: 'Masjids Nearby', description: 'Find the masjids closest to you, with the distance to each and directions in Google Maps.' }],
  ['/qibla', { title: 'Qibla', description: 'Find the qibla direction from wherever you are.' }],
  ['/calendar', { title: 'Islamic Calendar', description: 'The Hijri calendar, month by month, with today marked.' }],
  ['/dhikr', { title: 'Dhikr & Dua', description: 'A dhikr counter you can use with your eyes closed, and a collection of duas.' }],
  ['/challenges', { title: 'Challenges', description: 'Build small daily habits, keep a streak, and take on challenges with friends.' }],
  ['/charity', { title: 'Charity', description: 'Set charity goals and keep track of your giving.' }],
  ['/stats', { title: 'Stats', description: 'See your salah and good deeds over time.' }],
  ['/posts', { title: 'Posts', description: 'Reflections, reminders and videos shared by the community.' }],
  ['/post/', { title: 'Post', description: 'A reflection shared on Hasanath.' }],
  ['/u/', { title: 'Profile', description: 'A profile on Hasanath.' }],
  ['/notifications', { title: 'Notifications' }],
  ['/settings', { title: 'Settings' }],
  ['/account', { title: 'Account' }],
  ['/admin', { title: 'Admin' }],
  ['/login', { title: 'Sign in' }],
  ['/register', { title: 'Create account' }],
  ['/forgot-password', { title: 'Reset password' }],
  ['/reset-password', { title: 'Reset password' }],
  ['/verify-email', { title: 'Verify email' }],
];

function setMeta(selector, attribute, value) {
  const node = document.head.querySelector(selector);
  if (node && value) node.setAttribute(attribute, value);
}

// For a page that learns its real name after loading, e.g. "Surah Al-Fatiha".
export function setPageTitle(title) {
  if (title) document.title = `${title} · ${SITE_NAME}`;
}

// Mounted once inside the router.
export function usePageMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const match = pathname === '/' ? null : PAGES.find(([prefix]) => pathname.startsWith(prefix));
    const page = match ? match[1] : HOME;
    document.title = match ? `${page.title} · ${SITE_NAME}` : HOME.title;
    setMeta('meta[name="description"]', 'content', page.description || HOME.description);
    // The official address of this page: always the main domain, without any
    // query string, so shared and tracked variants count as one page.
    setMeta('link[rel="canonical"]', 'href', `${SITE_URL}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`);
  }, [pathname]);
}
