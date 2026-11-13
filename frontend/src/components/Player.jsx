import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAudio, PLAYBACK_RATES, SLEEP_OPTIONS } from './AudioProvider';
import { quran } from '../services/api';

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Countdown shown inside the sleep-timer button while a timer runs. Hours flip
// the label to h:mm:ss so even a long setting fits one line.
function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const MENU_WIDTH = 200;
// Six rows plus the header, used for the flip-above check. The speed list has
// the same row count, so one height serves both menus.
const MENU_HEIGHT = 296;

// Same class names and structure as the old audio bar, so the stylesheet
// renders it identically. The difference is where it lives: here it is mounted
// above the router, which is why playback survives navigation.
export default function Player() {
  const { track, playing, position, duration, toggle, seek, close, load, hasTrack,
          skip, canSkipBack, canSkipForward, loop, loopsLeft, cycleLoop,
          rate, changeRate, sleepMode, sleepRemaining, chooseSleep } = useAudio();
  const [restored, setRestored] = useState(false);
  const [scrubPct, setScrubPct] = useState(null);
  const trackRef = useRef(null);
  const rangeRef = useRef(null);
  const dragging = useRef(false);

  // --- Popover menus ---------------------------------------------------------
  // Speed and sleep share one panel and one set of placement rules; `menu`
  // says which button owns it. Positioning is measured from that button, so
  // the panel opens upward from the dock as it always has.
  const [menu, setMenu] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const sleepBtnRef = useRef(null);
  const speedBtnRef = useRef(null);
  const menuRef = useRef(null);

  const toggleMenu = (name) => setMenu((open) => (open === name ? null : name));

  // Outside pointer (or Escape) closes the panel: the same contract the
  // app-wide FormSelect listbox follows.
  useEffect(() => {
    if (!menu) return undefined;
    const closeOnOutside = (event) => {
      if (!sleepBtnRef.current?.contains(event.target)
        && !speedBtnRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)) {
        setMenu(null);
      }
    };
    const closeOnKey = (event) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [menu]);

  // Right-aligned to the owning button and flipped above the dock when there is
  // not enough room underneath - the dock sits low, so the usual case is up.
  useEffect(() => {
    if (!menu) return undefined;
    const place = () => {
      const anchor = (menu === 'speed' ? speedBtnRef : sleepBtnRef).current;
      const rect = anchor?.getBoundingClientRect();
      if (!rect) return;
      const gap = 8;
      const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
      const right = Math.min(rect.right, window.innerWidth - 8);
      const left = Math.max(8, right - width);
      const below = window.innerHeight - rect.bottom - gap;
      const openUp = below < MENU_HEIGHT && rect.top > MENU_HEIGHT;
      setMenuPos({
        top: openUp ? Math.max(8, rect.top - MENU_HEIGHT - gap) : rect.bottom + gap,
        left,
        width,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menu]);

  useEffect(() => {
    let cancelled = false;
    quran.progress()
      .then((data) => {
        if (cancelled || !data || !data.track) return;
        load(data.track);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRestored(true); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!restored || !hasTrack) return null;

  const sleepLabel = sleepMode === 'surah'
    ? 'Sleep timer: stops at the end of this surah'
    : sleepRemaining > 0
      ? `Sleep timer: about ${Math.ceil(sleepRemaining / 60000)} minutes remaining`
      : 'Sleep timer';

  const pct = duration > 0
    ? (scrubPct !== null ? scrubPct : Math.min(100, Math.max(0, (position / duration) * 100)))
    : 0;

  // The native range stays for keyboard access, but pointer input is handled by
  // the track itself. The old input was clipped to the 4px rail, which made the
  // thumb almost impossible to grab. We also preview the selected position
  // locally while dragging instead of waiting for timeupdate to catch up.
  const fractionAt = (clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const preview = (clientX) => {
    const fraction = fractionAt(clientX);
    setScrubPct(fraction * 100);
    return fraction;
  };

  const beginScrub = (event) => {
    if (!duration || duration <= 0) return;
    event.preventDefault();
    dragging.current = true;
    try {
      trackRef.current?.setPointerCapture?.(event.pointerId);
    } catch (err) {
      // Pointer capture is a convenience; dragging still works without it.
    }
    preview(event.clientX);
    rangeRef.current?.focus({ preventScroll: true });
  };

  const moveScrub = (event) => {
    if (!dragging.current) return;
    preview(event.clientX);
  };

  const endScrub = (event) => {
    if (!dragging.current) return;
    dragging.current = false;
    const fraction = preview(event.clientX);
    try {
      trackRef.current?.releasePointerCapture?.(event.pointerId);
    } catch (err) {
      // Already released by the browser.
    }
    seek(fraction);
    setScrubPct(null);
  };

  const cancelScrub = (event) => {
    dragging.current = false;
    try {
      trackRef.current?.releasePointerCapture?.(event.pointerId);
    } catch (err) {
      // Already released by the browser.
    }
    setScrubPct(null);
  };

  const menuStyle = {
    top: menuPos ? `${menuPos.top}px` : undefined,
    left: menuPos ? `${menuPos.left}px` : undefined,
    width: menuPos ? `${menuPos.width}px` : undefined,
    visibility: menuPos ? 'visible' : 'hidden',
  };

  return (
    <div className={`global-audio-bar${playing ? ' is-playing' : ''}`} id="globalAudioBar">
      <div className="audio-bar-inner">
        <div className="audio-bar-track-info">
          <span className={`audio-equalizer${playing ? ' is-playing' : ''}`} aria-hidden="true">
            <span /><span /><span /><span />
          </span>
          <div className="audio-track-meta">
            <div className="surah-title" title={`${track.surahNo}. ${track.surahName}`}>
              <span className="audio-track-title-text">{track.surahNo}. {track.surahName}</span>
            </div>
            <div className="reciter-name" title={track.reciterName || 'Qur’an recitation'}>
              {track.reciterName || 'Qur’an recitation'}
            </div>
          </div>
        </div>

        <div className="audio-bar-actions">
          {/* Transport: previous, play/pause, next. Disabled at the ends of the
              Quran rather than silently doing nothing. */}
          <div className="audio-transport">
            <button type="button" className="audio-btn" onClick={() => skip(-1)}
                    disabled={!canSkipBack} aria-label="Previous surah">
              <span className="material-symbols-rounded">skip_previous</span>
            </button>
            <button type="button" className="audio-btn audio-btn-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
              <span className="material-symbols-rounded">{playing ? 'pause' : 'play_arrow'}</span>
            </button>
            <button type="button" className="audio-btn" onClick={() => skip(1)}
                    disabled={!canSkipForward} aria-label="Next surah">
              <span className="material-symbols-rounded">skip_next</span>
            </button>
          </div>

          {/* The two things you arm on the dock, side by side: repeat and
              speed. Both read their state off the button itself. */}
          <div className="audio-modes">
            {/* Loop cycles repeat-1, 2, 3 times, then off. The repeat glyph
                stays visible the whole time and the count rides ON the icon as
                a small badge, so the mode reads at a glance. */}
            <button
              type="button"
              className={`audio-btn audio-loop-btn${loop ? ' is-on' : ''}`}
              onClick={cycleLoop}
              aria-label={loop ? `Repeat surah: ${loop} time${loop === 1 ? '' : 's'}` : 'Repeat surah: off'}
              title={loop ? `Repeats remaining: ${loopsLeft}` : 'Repeat surah (1-3 times)'}
            >
              <span className="material-symbols-rounded" aria-hidden="true">repeat</span>
              {loop > 0 && <span className="audio-loop-badge">{loopsLeft}</span>}
            </button>

            <button
              ref={speedBtnRef}
              type="button"
              className={`audio-btn audio-speed-btn${rate !== 1 ? ' is-on' : ''}`}
              aria-label={`Playback speed ${rate}×`}
              aria-haspopup="menu"
              aria-expanded={menu === 'speed'}
              title={`Playback speed: ${rate}×`}
              onClick={() => toggleMenu('speed')}
            >
              <span className="audio-speed-label">{rate}×</span>
            </button>
          </div>

          <button
            ref={sleepBtnRef}
            type="button"
            className={`audio-btn audio-sleep-btn${sleepMode !== 'off' ? ' is-on' : ''}`}
            aria-label={sleepLabel}
            aria-haspopup="menu"
            aria-expanded={menu === 'sleep'}
            title={sleepLabel}
            onClick={() => toggleMenu('sleep')}
          >
            {sleepMode === 'surah'
              ? <span className="audio-sleep-count">Surah</span>
              : sleepRemaining > 0
                ? <span className="audio-sleep-count">{formatRemaining(sleepRemaining)}</span>
                : <span className="material-symbols-rounded" aria-hidden="true">bedtime</span>}
          </button>

          <button type="button" className="audio-btn audio-close-btn" onClick={close} aria-label="Close audio">
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div className="audio-progress-row">
          <span className="audio-time">{formatTime(scrubPct !== null ? (scrubPct / 100) * duration : position)}</span>
          <div
            ref={trackRef}
            className={`audio-progress-track${scrubPct !== null ? ' is-scrubbing' : ''}`}
            onPointerDown={beginScrub}
            onPointerMove={moveScrub}
            onPointerUp={endScrub}
            onPointerCancel={cancelScrub}
          >
            <div className="audio-progress-fill" style={{ width: `${pct}%` }} />
            <span
              className="audio-progress-thumb"
              style={{ left: `${pct}%`, display: duration > 0 ? undefined : 'none' }}
              aria-hidden="true"
            />
            <input
              ref={rangeRef}
              type="range"
              className="audio-progress-input"
              min="0"
              max="100"
              value={pct}
              aria-label="Seek"
              onChange={(e) => {
                const fraction = Number(e.target.value) / 100;
                setScrubPct(fraction * 100);
                seek(fraction);
                setScrubPct(null);
              }}
            />
          </div>
          <span className="audio-time">{formatTime(duration)}</span>
        </div>
      </div>

      {menu === 'sleep' && createPortal(
        <div
          ref={menuRef}
          className="audio-menu"
          role="menu"
          aria-label="Sleep timer"
          style={menuStyle}
        >
          <div className="audio-menu-head">
            <span className="material-symbols-rounded" aria-hidden="true">bedtime</span>
            Sleep timer
          </div>
          {SLEEP_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={sleepMode === option.id}
              className={`audio-menu-option${sleepMode === option.id ? ' is-selected' : ''}`}
              onPointerEnter={(event) => event.currentTarget.classList.add('is-active')}
              onPointerLeave={(event) => event.currentTarget.classList.remove('is-active')}
              onClick={() => {
                chooseSleep(option.id);
                setMenu(null);
                sleepBtnRef.current?.focus();
              }}
            >
              <span>{option.label}</span>
              {sleepMode === option.id
                && <span className="material-symbols-rounded" aria-hidden="true">check</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {menu === 'speed' && createPortal(
        <div
          ref={menuRef}
          className="audio-menu"
          role="menu"
          aria-label="Playback speed"
          style={menuStyle}
        >
          <div className="audio-menu-head">
            <span className="material-symbols-rounded" aria-hidden="true">speed</span>
            Playback speed
          </div>
          {PLAYBACK_RATES.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={rate === value}
              className={`audio-menu-option${rate === value ? ' is-selected' : ''}`}
              onPointerEnter={(event) => event.currentTarget.classList.add('is-active')}
              onPointerLeave={(event) => event.currentTarget.classList.remove('is-active')}
              onClick={() => {
                changeRate(value);
                setMenu(null);
                speedBtnRef.current?.focus();
              }}
            >
              <span>{value}×{value === 1 ? ' (default)' : ''}</span>
              {rate === value
                && <span className="material-symbols-rounded" aria-hidden="true">check</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
