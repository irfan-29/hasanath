import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useSession } from '../hooks/useSession.jsx';

// The two announcement surfaces the admin portal controls.
//
//   sticky - a thin bar pinned above the chrome. Dismissal is remembered in
//            localStorage for this browser; the admin turns the banner off when
//            the message is no longer needed.
//   otb    - a one-time popup. It is delivered by /api/app/meta only while the
//            account has not acknowledged it, and closing it posts the
//            acknowledgement so it does not follow the same person around.
//
// Both are fixed overlays, so this component can live anywhere inside the shell.

const STICKY_KEY = 'salah-sticky-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(STICKY_KEY) || '';
  } catch (err) {
    return '';
  }
}

function rememberDismissed(id) {
  try {
    localStorage.setItem(STICKY_KEY, id);
  } catch (err) {
    // Private mode or disabled storage: the bar still hides for this page.
  }
}

// A banner button may point at an app route or the open web. Keeping the two
// cases explicit is what lets an internal link stay inside the SPA.
function Cta({ banner, className, onInternal }) {
  if (!banner || !banner.ctaUrl) return null;
  const label = banner.ctaLabel || 'Open';

  if (banner.ctaUrl.startsWith('/')) {
    return (
      <Link to={banner.ctaUrl} className={className} onClick={onInternal}>
        {label}
      </Link>
    );
  }

  return (
    <a
      href={banner.ctaUrl}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onInternal}
    >
      {label}
    </a>
  );
}

export default function AnnouncementBanner() {
  const { banners, dismissOtb } = useSession();
  const sticky = banners && banners.sticky ? banners.sticky[0] : null;
  const otb = banners ? banners.otb : null;
  const [dismissedSticky, setDismissedSticky] = useState(readDismissed);

  // A new sticky banner gets a new id, so a dismissal of the previous campaign
  // does not hide it.
  const stickyVisible = Boolean(sticky && sticky.id !== dismissedSticky);

  useEffect(() => {
    if (!otb) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [otb]);

  useEffect(() => {
    if (!otb) return undefined;
    const onEscape = (event) => {
      if (event.key === 'Escape') dismissOtb(otb.id);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [otb, dismissOtb]);

  function hideSticky() {
    if (!sticky) return;
    rememberDismissed(sticky.id);
    setDismissedSticky(sticky.id);
  }

  return (
    <>
      {stickyVisible && (
        <div
          className={`sticky-banner sticky-banner-${sticky.position}`}
          role="region"
          aria-label="Announcement"
        >
          <span className="material-symbols-rounded sticky-banner-icon" aria-hidden="true">campaign</span>
          <div className="sticky-banner-text">
            <strong>{sticky.title}</strong>
            {sticky.body && <span>{sticky.body}</span>}
          </div>
          <Cta banner={sticky} className="btn btn-sm sticky-banner-cta" />
          <button
            type="button"
            className="sticky-banner-close"
            aria-label="Dismiss announcement"
            onClick={hideSticky}
          >
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      )}

      {otb && createPortal(
        <div className="otb-overlay" role="presentation" onPointerDown={() => dismissOtb(otb.id)}>
          <div
            className="otb-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="otb-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="otb-close"
              aria-label="Close announcement"
              onClick={() => dismissOtb(otb.id)}
            >
              <span className="material-symbols-rounded" aria-hidden="true">close</span>
            </button>

            <span className="otb-kicker">What&apos;s new</span>
            <h2 className="otb-title" id="otb-title">{otb.title}</h2>
            {otb.body && <p className="otb-body">{otb.body}</p>}

            <div className="otb-actions">
              {otb.ctaUrl ? (
                <>
                  <Cta
                    banner={otb}
                    className="btn btn-primary"
                    onInternal={() => dismissOtb(otb.id)}
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => dismissOtb(otb.id)}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => dismissOtb(otb.id)}
                >
                  Got it
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
