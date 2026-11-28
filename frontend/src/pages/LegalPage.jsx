import { Link } from 'react-router-dom';
import { SUPPORT_EMAIL } from '../utils/contact';

// The three plain-language pages a visitor is entitled to before they hand
// over an email address: what the app does with their information (Privacy),
// the rules of using it (Terms), and where its content comes from (Credits).
//
// They are written from what the app actually does. If the app changes what
// it collects or which outside services it uses, change the matching section
// here and the "Last updated" date. docs/developer-notes.md lists the same
// services from the developer's side.
//
// These were drafted with care but not by a lawyer. Have them read by someone
// qualified before relying on them.

const UPDATED = '28 November 2026';
const OPERATOR = 'Mohammed Irfan U';

function Mail({ subject }) {
  const href = subject ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${SUPPORT_EMAIL}`;
  return <a href={href}>{SUPPORT_EMAIL}</a>;
}

function External({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function LegalShell({ title, lede, children }) {
  return (
    <article className="legal">
      <header className="legal-head">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {UPDATED}</p>
        {lede && <p className="legal-lede">{lede}</p>}
      </header>
      {children}
      <footer className="legal-foot">
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Use</Link>
        <Link to="/credits">Sources and credits</Link>
        <Mail />
      </footer>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      lede="Hasanath is a free, ad-free app for tracking your salah, reading the Qur’an and building good habits. This page says, in plain words, what information the app holds about you, why, who else is involved, and what you can do about it."
    >
      <section>
        <h2>The short version</h2>
        <ul>
          <li>There are no ads, and your information is never sold or used for advertising.</li>
          <li>There is no analytics or tracking code in the app.</li>
          <li>What you record about your worship is yours. Other people see only what you choose to share: your public profile, your posts, and your streak in a challenge you join with friends.</li>
          <li>You can delete your account, and everything in it, at any time from the Account page.</li>
        </ul>
      </section>

      <section>
        <h2>Who runs Hasanath</h2>
        <p>
          Hasanath is built and run by {OPERATOR}, an individual developer in India. For anything about
          your information, write to <Mail subject="Privacy" />.
        </p>
      </section>

      <section>
        <h2>What the app holds</h2>
        <h3>If you create an account</h3>
        <ul>
          <li><strong>Your email address</strong>, to sign you in, send you verification and password-reset codes, and reach you about your account.</li>
          <li><strong>Your password</strong>, stored only as a salted hash. Nobody, including the developer, can read it.</li>
          <li><strong>Your username, display name and profile photo</strong>, if you add one. These are public.</li>
          <li><strong>What you record</strong>: your salah log, challenges and streaks, charity goals and the donations you note against them, Qur’an and hadith bookmarks, and where you last read.</li>
          <li><strong>Your settings</strong>: theme, translation, reciter, prayer-time method and similar choices.</li>
          <li><strong>Your location</strong>, if you set one: the place name, its coordinates and time zone. It is used for prayer times, the qibla and nearby masjids. “Use my current location” reads your device’s position once, when you tap it, and saves the result as your location.</li>
          <li><strong>What you share</strong>: posts, likes, reports you make, friend requests and friendships, and challenges you share with friends.</li>
          <li><strong>Messages you send to support</strong> through the app.</li>
          <li><strong>Your Telegram chat id</strong>, only if you connect Telegram for reminders.</li>
          <li><strong>When you were last active</strong>, to the nearest few minutes.</li>
        </ul>
        <h3>If you use the app without an account</h3>
        <p>
          Your entries are kept in a cookie in your own browser, not in the app’s database. If you later
          create an account, they are moved into it.
        </p>
        <h3>Kept only on your device</h3>
        <p>
          Your dhikr counts, and in the Android app your notification choices, stay on your device and are
          not sent to the server.
        </p>
        <h3>Technical information</h3>
        <ul>
          <li><strong>A sign-in cookie</strong>, so you stay signed in. It cannot be read by scripts and is sent only over a secure connection.</li>
          <li><strong>Your network (IP) address</strong>, seen by the server when you use the app. It is used to limit abuse, such as repeated password guessing, and appears in the hosting provider’s short-lived logs.</li>
        </ul>
      </section>

      <section>
        <h2>Why it is held</h2>
        <ul>
          <li>To provide the app: show you your own records, calculate prayer times for your location, and deliver the reminders you turn on.</li>
          <li>To run the community features you choose to use: posts, friends and shared challenges.</li>
          <li>To keep the app safe: prevent abuse, act on reports, and enforce the Terms of Use.</li>
          <li>To answer you when you write to support.</li>
        </ul>
        <p>
          Records of religious practice are sensitive. They are held only because you choose to record
          them, and only to show them back to you.
        </p>
      </section>

      <section>
        <h2>Who else is involved</h2>
        <p>
          Hasanath runs on services provided by other companies. They handle information only to provide
          their service to the app.
        </p>
        <ul>
          <li><strong>Vercel</strong> hosts the website and the server.</li>
          <li><strong>MongoDB Atlas</strong> holds the database, in a data centre in Mumbai, India.</li>
          <li><strong>Resend</strong> delivers the emails the app sends you.</li>
          <li><strong>Zoho Mail</strong> receives the emails you send to support.</li>
          <li><strong>Telegram</strong>, only if you connect it, delivers your reminders to your chat.</li>
        </ul>
        <p>
          Some features fetch content from outside services. Where that involves anything about you, it is
          limited to what the feature needs:
        </p>
        <ul>
          <li><strong>Prayer times and the calendar</strong>: your location’s coordinates are sent to AlAdhan to calculate times. Your identity is not.</li>
          <li><strong>Choosing a location</strong>: the place name you type is sent to Open-Meteo to find it. If you use your current position, your browser sends its coordinates to BigDataCloud to name the place.</li>
          <li><strong>Masjids nearby</strong>: your location, rounded to about 110 metres, is sent to masjidnear.me and to OpenStreetMap to find masjids. Your browser loads the map’s pictures from OpenStreetMap, which sees your network address as any website would.</li>
          <li><strong>Directions</strong> open in Google Maps, under Google’s own terms, when you tap them.</li>
          <li><strong>Fonts</strong> are loaded by your browser from Google Fonts.</li>
          <li><strong>Videos</strong> in posts are played from YouTube, when a post includes one.</li>
        </ul>
        <p>Information may also be disclosed if the law requires it.</p>
      </section>

      <section>
        <h2>How long it is kept</h2>
        <ul>
          <li>Your account and its records are kept until you delete the account.</li>
          <li>Deleting your account removes your profile, records, posts, likes, friendships, shared challenges you created, notifications and photo. It cannot be undone.</li>
          <li>Verification and reset codes expire within minutes. Records used to limit abuse expire within hours.</li>
          <li>Messages to support are kept for as long as needed to deal with them.</li>
        </ul>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li><strong>See and correct</strong> your information in the app, on the Account and Settings pages.</li>
          <li><strong>Delete your account</strong> from the Account page. If you cannot sign in, write to <Mail subject="Delete my account" /> from the account’s email address and it will be deleted for you.</li>
          <li><strong>Turn features off</strong>: remove your location, disconnect Telegram, or switch off reminders in Settings.</li>
          <li><strong>Ask a question or make a complaint</strong> by writing to <Mail subject="Privacy" />. You will receive an acknowledgement within 24 hours and a full response within 15 days.</li>
        </ul>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          Hasanath is intended for people aged 18 and over. Someone younger may use it only with the
          permission of a parent or guardian. If you believe a child has created an account without
          that permission, write to <Mail subject="Child account" /> and it will be removed.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Connections to the app are encrypted. Passwords are hashed. Sign-in attempts and other
          sensitive actions are rate-limited, and changing your password signs you out everywhere else.
          No system is perfectly secure; if something goes wrong that affects your information, you will
          be told.
        </p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>
          If this policy changes in a way that matters, the date at the top will change and, where the
          change is significant, you will be told in the app.
        </p>
      </section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell
      title="Terms of Use"
      lede="These are the rules for using Hasanath. By creating an account or using the app, you agree to them."
    >
      <section>
        <h2>The service</h2>
        <p>
          Hasanath is a free app, run by {OPERATOR}, for tracking your salah, reading the Qur’an and
          hadith, keeping your dhikr, and sharing reflections with others. It is in early access:
          features may change, and signups may be limited.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>You must be 18 or older, or have the permission of a parent or guardian.</li>
          <li>Use an email address that is yours, and keep your password to yourself. You are responsible for what is done through your account.</li>
          <li>One person, one account. Do not create accounts by automated means.</li>
          <li>You can delete your account at any time from the Account page.</li>
        </ul>
      </section>

      <section>
        <h2>What you may not do</h2>
        <ul>
          <li>Post anything unlawful, hateful, threatening, obscene, or that harasses or demeans any person or group.</li>
          <li>Post anything that mocks or misrepresents the Qur’an, the Prophet ﷺ or any faith, or that stirs hostility between communities.</li>
          <li>Impersonate another person, or mislead others about who you are.</li>
          <li>Post advertising, spam, or requests for money.</li>
          <li>Share someone else’s private information without their consent.</li>
          <li>Use scripts or other automated means to access the app, copy its content in bulk, or get around its limits.</li>
          <li>Attempt to break into the app, disrupt it, or access another person’s account.</li>
        </ul>
      </section>

      <section>
        <h2>What you post</h2>
        <ul>
          <li>What you post remains yours. By posting it, you allow Hasanath to show it to other people in the app and through share links.</li>
          <li>You are responsible for what you post, including that you have the right to post it.</li>
          <li>Anyone can report a post. Posts that are reported repeatedly are hidden until an administrator reviews them.</li>
          <li>Posts that break these terms may be removed, and accounts that break them may be suspended or deleted.</li>
        </ul>
      </section>

      <section>
        <h2>Religious content</h2>
        <ul>
          <li>The Qur’an text, translations, hadith and duas come from the sources named on the <Link to="/credits">Sources and credits</Link> page. They are shown with care, but errors are possible. If you find one, please write to <Mail subject="Correction" />.</li>
          <li>Prayer times are calculated, and the qibla direction depends on your device’s compass. Both can differ slightly from your local masjid. Where they differ, follow your masjid.</li>
          <li>Nothing in the app is a religious ruling. For questions of practice, ask a qualified scholar.</li>
        </ul>
      </section>

      <section>
        <h2>Masjids, charity and other tools</h2>
        <ul>
          <li>The list of nearby masjids comes from public directories and may be incomplete or out of date.</li>
          <li>The Charity section is a private record of what you give. Hasanath does not collect, hold or transfer money.</li>
        </ul>
      </section>

      <section>
        <h2>Availability</h2>
        <p>
          Hasanath is offered as it is, without charge and without guarantee. It may be unavailable at
          times, and features may be changed or withdrawn. To the extent the law allows, the developer is
          not liable for loss arising from using the app or from being unable to use it, including the
          loss of records. Keep your own note of anything you cannot afford to lose.
        </p>
      </section>

      <section>
        <h2>Ending use</h2>
        <p>
          You may stop using Hasanath and delete your account at any time. An account that breaks these
          terms may be suspended or removed. If you think that was a mistake, write to <Mail subject="Account review" />.
        </p>
      </section>

      <section>
        <h2>Complaints</h2>
        <p>
          To report content or conduct, use the report option on a post, or write to{' '}
          <Mail subject="Complaint" />. Complaints are handled by {OPERATOR}. You will receive an
          acknowledgement within 24 hours and a resolution within 15 days.
        </p>
      </section>

      <section>
        <h2>Changes and law</h2>
        <p>
          These terms may be updated; the date at the top shows when. Continuing to use the app after a
          change means you accept it. These terms are governed by the laws of India.
        </p>
      </section>
    </LegalShell>
  );
}

export function CreditsPage() {
  return (
    <LegalShell
      title="Sources and credits"
      lede="Hasanath stands on the work of many others. This is where its content comes from."
    >
      <section>
        <h2>Qur’an and hadith</h2>
        <ul>
          <li><strong>Qur’an text, audio and reciters</strong>: <External href="https://quranapi.pages.dev">Quran API</External>.</li>
          <li><strong>Translations</strong> in many languages: the <External href="https://github.com/fawazahmed0/quran-api">quran-api</External> collection by Fawaz Ahmed. Each translation remains the work of its translator and publisher, named in the app beside the translation.</li>
          <li><strong>Hadith collections</strong>: the <External href="https://github.com/fawazahmed0/hadith-api">hadith-api</External> collection by Fawaz Ahmed.</li>
          <li><strong>Qur’an typefaces</strong>: the KFGQPC Hafs font from the King Fahd Glorious Qur’an Printing Complex, an IndoPak script font, and Noto Naskh Arabic.</li>
        </ul>
      </section>

      <section>
        <h2>Prayer times and calendar</h2>
        <ul>
          <li><strong>Prayer times and Hijri dates</strong>: <External href="https://aladhan.com">AlAdhan</External>.</li>
          <li><strong>Special Islamic days</strong>: <External href="https://www.islamicfinder.org">IslamicFinder</External>.</li>
        </ul>
      </section>

      <section>
        <h2>Places and maps</h2>
        <ul>
          <li><strong>Masjids nearby</strong>: <External href="https://masjidnear.me">masjidnear.me</External> and <External href="https://www.openstreetmap.org/copyright">OpenStreetMap</External> contributors.</li>
          <li><strong>The map</strong>: © <External href="https://www.openstreetmap.org/copyright">OpenStreetMap</External> contributors, drawn with <External href="https://leafletjs.com">Leaflet</External>.</li>
          <li><strong>Finding a place by name</strong>: <External href="https://open-meteo.com">Open-Meteo</External>, with data from GeoNames.</li>
          <li><strong>Naming your current position</strong>: <External href="https://www.bigdatacloud.com">BigDataCloud</External>.</li>
          <li><strong>Directions</strong>: Google Maps.</li>
        </ul>
      </section>

      <section>
        <h2>Design and software</h2>
        <ul>
          <li><strong>Icons</strong>: Material Symbols by Google.</li>
          <li><strong>Typefaces</strong>: from Google Fonts.</li>
          <li><strong>Built with</strong> React, Vite, Express and MongoDB, all open-source.</li>
        </ul>
      </section>

      <section>
        <h2>Something missing or wrong?</h2>
        <p>
          If your work is used here and is not credited properly, or you would like it removed, write to{' '}
          <Mail subject="Credits" /> and it will be put right.
        </p>
      </section>
    </LegalShell>
  );
}
