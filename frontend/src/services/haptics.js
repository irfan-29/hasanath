// Feedback you can feel (and optionally hear) without looking at the screen.
//
// Used by the dhikr counter, where people count with their eyes closed. Three
// routes, best first:
// - the Android app's bridge (window.HasanathAndroid.vibrate), which uses the
//   phone's haptic motor directly and works for the volume-key counter too;
// - the browser's Vibration API (Chrome on Android, the installed PWA);
// - nothing (iPhone Safari has no vibration), where the optional sound helps.

const PATTERNS = {
  tick: 14,                               // every count: a light tap
  milestone: [0, 70, 80, 70],             // each 33 on the way to 100: two short pulses
  done: [0, 240, 120, 240, 120, 460],     // target reached: long, unmistakable
};

function native() {
  const b = typeof window !== 'undefined' ? window.HasanathAndroid : null;
  return b && typeof b.vibrate === 'function' ? b : null;
}

export function canVibrate() {
  return Boolean(native()) || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function');
}

export function vibrate(kind) {
  const b = native();
  try {
    if (b) { b.vibrate(kind); return; }
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(PATTERNS[kind] || PATTERNS.tick);
  } catch {
    // Vibration blocked (battery saver, permissions): counting still works.
  }
}

let audio = null;

// A soft wooden-bead click; a rising pair of tones when the target is reached.
export function click(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    if (audio.state === 'suspended') audio.resume();
    const tones = kind === 'done' ? [[660, 0, 0.16], [880, 0.18, 0.3]] : kind === 'milestone' ? [[760, 0, 0.09], [760, 0.13, 0.09]] : [[540, 0, 0.045]];
    tones.forEach(([freq, at, len]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + at;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === 'tick' ? 0.12 : 0.2, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + len + 0.02);
    });
  } catch {
    // No audio available: stay silent.
  }
}

// Keep the screen on while counting. The app does it natively; browsers use a wake lock.
let wakeLock = null;
export async function keepAwake(on) {
  const b = typeof window !== 'undefined' ? window.HasanathAndroid : null;
  try {
    if (b && typeof b.keepAwake === 'function') { b.keepAwake(Boolean(on)); return; }
    if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {
    // Wake lock refused (low battery, unsupported): the phone's own timeout applies.
  }
}
