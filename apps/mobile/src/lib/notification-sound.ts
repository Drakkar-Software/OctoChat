/**
 * Synthesized notification chimes for the desktop (Electron) app.
 *
 * The HTML5 `Notification` API has no custom-sound parameter — it plays the OS
 * default or nothing. On Windows the Chromium toast sound is unreliable even when
 * the toast itself shows. So on desktop we fire the toast *silent* (see
 * `notify.ts`) and play our own chime here instead, which also lets the user pick
 * one. The sounds are generated with the Web Audio API rather than bundled audio
 * files: Expo SDK 56 web/Metro asset `require()` resolution for media is fragile,
 * and synthesis needs no binary assets and plays reliably in the Electron renderer.
 *
 * Web/desktop only — there is no `AudioContext` on native, so every call no-ops
 * there (mobile push sound is OS/channel-controlled). For the unfocused-window
 * case the Electron main process sets `autoplayPolicy: 'no-user-gesture-required'`
 * (see `apps/desktop/src/main.ts`); without it a resumed context stays silent.
 */
import type { NotificationSound } from './notification-settings';

/** Human label for each chime, for the settings picker. */
export const NOTIFICATION_SOUND_LABELS: Record<NotificationSound, string> = {
  ping: 'Ping',
  pop: 'Pop',
  chime: 'Chime',
  blip: 'Blip',
};

type Ctx = AudioContext;

let ctx: Ctx | null = null;

/** Lazily create (and reuse) the shared AudioContext. Null off-web/desktop. */
function audioContext(): Ctx | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

interface ToneSpec {
  type: OscillatorType;
  /** Start frequency (Hz). */
  freq: number;
  /** Optional glide target — ramps `freq` → `freqEnd` over the tone. */
  freqEnd?: number;
  /** Offset from now (s) before the tone starts. */
  at: number;
  /** Duration (s). */
  dur: number;
  /** Peak gain (0–1); a short attack then exponential decay shapes it. */
  gain: number;
}

/** Schedule one enveloped oscillator on the context. */
function tone(ac: Ctx, spec: ToneSpec): void {
  const t0 = ac.currentTime + spec.at;
  const t1 = t0 + spec.dur;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, t0);
  if (spec.freqEnd) osc.frequency.exponentialRampToValueAtTime(spec.freqEnd, t1);
  // Quick attack to avoid a click, then exponential decay to (near) zero.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(spec.gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Voice each chime as a small set of scheduled tones. */
const VOICES: Record<NotificationSound, (ac: Ctx) => void> = {
  ping: (ac) => tone(ac, { type: 'sine', freq: 880, at: 0, dur: 0.32, gain: 0.18 }),
  pop: (ac) => tone(ac, { type: 'sine', freq: 520, freqEnd: 180, at: 0, dur: 0.12, gain: 0.2 }),
  chime: (ac) => {
    tone(ac, { type: 'sine', freq: 660, at: 0, dur: 0.26, gain: 0.16 });
    tone(ac, { type: 'sine', freq: 988, at: 0.1, dur: 0.3, gain: 0.16 });
  },
  blip: (ac) => tone(ac, { type: 'triangle', freq: 1280, at: 0, dur: 0.07, gain: 0.16 }),
};

/**
 * Play the given notification chime. No-op off web/desktop, or if the Web Audio
 * API is unavailable. Resumes a suspended context first (autoplay-policy gating);
 * any failure is swallowed so a missing sound never breaks the notification.
 */
export function playNotificationSound(name: NotificationSound): void {
  const ac = audioContext();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') void ac.resume();
    (VOICES[name] ?? VOICES.ping)(ac);
  } catch {
    /* audio unavailable — ignore */
  }
}
