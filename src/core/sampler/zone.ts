/**
 * A sample zone: how one sample plays as an instrument. Plain JSON.
 *
 * Times are in seconds of the sample's own audio (independent of the playback sample rate).
 */
export type PlayMode = 'oneshot' | 'gated' | 'loop';

export interface SampleZone {
  /** the MIDI note at which the sample plays at its original speed */
  root: number;
  /** semitones, -48..48 */
  tune: number;
  /** cents, -100..100 */
  fine: number;
  /** linear gain, 0..2 (1 = unity) */
  volume: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mode: PlayMode;
  /** play from here (s) */
  start: number;
  /** play to here (s); null = the end of the sample */
  end: number | null;
  /** loop region (LOOP mode); loopEnd null = END */
  loopStart: number;
  loopEnd: number | null;
  /** release time after note-off (GATED and LOOP), 0.005..5 s */
  release: number;
  /** how much velocity changes level: 0 = not at all, 1 = fully */
  velocitySens: number;
  mute: boolean;
}

export const MIN_LOOP_SECONDS = 0.001;
export const EDGE_FADE_SECONDS = 0.002;

export function defaultZone(): SampleZone {
  return { root: 60, tune: 0, fine: 0, volume: 1, pan: 0, mode: 'oneshot', start: 0, end: null, loopStart: 0, loopEnd: null, release: 0.03, velocitySens: 1, mute: false };
}

/** Playback-rate transposition, as on a hardware sampler: length changes with pitch. */
export function playbackRate(z: Pick<SampleZone, 'root' | 'tune' | 'fine'>, pitch: number): number {
  return Math.pow(2, (pitch - z.root + z.tune + z.fine / 100) / 12);
}

/** Level for a velocity: the same 1.5-power curve for every instrument, scaled by sensitivity. */
export function velocityGain(z: Pick<SampleZone, 'velocitySens'>, velocity: number): number {
  const v = Math.max(0, Math.min(127, velocity)) / 127;
  const s = Math.max(0, Math.min(1, z.velocitySens));
  return 1 - s + s * Math.pow(v, 1.5);
}

export interface Region {
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  /** START was moved from the sample's beginning (fade in) */
  trimmedStart: boolean;
  /** END was moved from the sample's end (fade out) */
  trimmedEnd: boolean;
}

/** The zone's playable region inside a sample of `duration` seconds, made consistent. */
export function region(z: SampleZone, duration: number): Region {
  const d = Math.max(0, duration);
  const start = Math.max(0, Math.min(z.start, Math.max(0, d - MIN_LOOP_SECONDS)));
  let end = z.end === null ? d : Math.max(start + MIN_LOOP_SECONDS, Math.min(z.end, d));
  if (end > d) end = d;
  let loopStart = Math.max(start, Math.min(z.loopStart, end - MIN_LOOP_SECONDS));
  let loopEnd = z.loopEnd === null ? end : Math.min(z.loopEnd, end);
  // an impossible loop (ends before it starts, or shorter than 1 ms) loops the whole region
  if (loopEnd - loopStart < MIN_LOOP_SECONDS) {
    loopStart = start;
    loopEnd = end;
  }
  return { start, end, loopStart, loopEnd, trimmedStart: start > 0, trimmedEnd: end < d - 1e-9 };
}

/** Human-readable problems with a zone's settings for a sample length (empty = fine). */
export function zoneProblems(z: SampleZone, duration: number): string[] {
  const out: string[] = [];
  if (z.start >= duration) out.push('START is past the end of the sample.');
  if (z.end !== null && z.end <= z.start) out.push('END must be after START.');
  if (z.mode === 'loop') {
    const end = z.end ?? duration;
    const le = z.loopEnd ?? end;
    if (z.loopStart < z.start) out.push('LOOP START must not be before START.');
    if (le > end + 1e-9) out.push('LOOP END must not be after END.');
    if (le - z.loopStart < MIN_LOOP_SECONDS) out.push('The loop must be at least 1 ms long.');
  }
  return out;
}

type Obj = Record<string, unknown>;
const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const optNum = (v: unknown, lo: number, hi: number) => (v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

export function repairZone(src: unknown): SampleZone {
  const d = defaultZone();
  const o = (src && typeof src === 'object' && !Array.isArray(src) ? src : {}) as Obj;
  return {
    root: Math.round(num(o.root, 0, 127, d.root)),
    tune: Math.round(num(o.tune, -48, 48, d.tune)),
    fine: num(o.fine, -100, 100, d.fine),
    volume: num(o.volume, 0, 2, d.volume),
    pan: num(o.pan, -1, 1, d.pan),
    mode: o.mode === 'gated' || o.mode === 'loop' ? o.mode : 'oneshot',
    start: num(o.start, 0, 3600, d.start),
    end: optNum(o.end, 0, 3600),
    loopStart: num(o.loopStart, 0, 3600, d.loopStart),
    loopEnd: optNum(o.loopEnd, 0, 3600),
    release: num(o.release, 0.005, 5, d.release),
    velocitySens: num(o.velocitySens, 0, 1, d.velocitySens),
    mute: o.mute === true,
  };
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI note name with middle C (60) = C4. */
export function noteName(n: number): string {
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}
/** Parse "C4", "f#2", "Bb3" or a number; null if unreadable. */
export function parseNoteName(s: string): number | null {
  const m = /^\s*([A-Ga-g])([#b]?)(-?\d+)\s*$/.exec(s);
  if (m) {
    const base = [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(m[1].toUpperCase())];
    const n = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
    return n >= 0 && n <= 127 ? n : null;
  }
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 127 ? n : null;
}
