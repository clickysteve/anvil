/**
 * Tonality: the layer that turns abstract scale degrees into MIDI notes.
 *
 * DOC: a theme's pitches are positions in a generalised 7-note scale; Scale, Mode, Key and
 * Octave convert them to notes; scales hold 70 pitches (10 octaves x 7); 38 preset scales are
 * every 7-note ascending scale with no step larger than a minor third; 8 more are the user's.
 *
 * INF (classic.scales.v1): ANVIL generates the 38 presets mathematically. Seven steps of 1-3
 * semitones summing to 12 can be arranged in 266 ways, which fall into 38 rotation classes.
 * The names, the chosen rotation of each class and the order are ANVIL's own.
 */
import type { Tonality } from './types';

export const DEGREES = 70;
export const PRESET_SCALES = 38;
export const USER_SCALES = 8;
export const SCALE_COUNT = PRESET_SCALES + USER_SCALES;
export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTERS = 'CDEFGAB';

/** Degree 35 = position 1 of the middle octave, named C4. */
export const MIDDLE_DEGREE = 35;

export interface ScaleDef {
  index: number;
  name: string;
  /** seven semitone steps (sum 12) */
  steps: number[];
}

/** Well-known scales, in conventional rotation. Generic music-theory names. */
const NAMED: [string, string][] = [
  ['Major', '2212221'],
  ['Melodic minor', '2122221'],
  ['Harmonic minor', '2122131'],
  ['Harmonic major', '2212131'],
  ['Double harmonic', '1312131'],
  ['Neapolitan major', '1222221'],
  ['Neapolitan minor', '1222131'],
  ['Hungarian minor', '2131131'],
  ['Hungarian major', '3121212'],
  ['Persian', '1311231'],
  ['Enigmatic', '1322211'],
  ['Oriental', '1311321'],
  ['Romanian major', '1312122'],
];

function rotations(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.slice(i) + s.slice(0, i));
  return out;
}

function buildPresets(): ScaleDef[] {
  // all compositions of 12 into 7 parts of 1..3
  const all: string[] = [];
  const rec = (prefix: string, sum: number) => {
    if (prefix.length === 7) {
      if (sum === 12) all.push(prefix);
      return;
    }
    for (const s of [1, 2, 3]) if (sum + s <= 12) rec(prefix + s, sum + s);
  };
  rec('', 0);
  const classes = new Map<string, string>(); // canonical (max rotation) -> chosen rotation
  for (const s of all) {
    const canon = rotations(s).sort().pop()!;
    if (!classes.has(canon)) classes.set(canon, canon);
  }
  const named: { name: string; steps: string }[] = [];
  const used = new Set<string>();
  for (const [name, steps] of NAMED) {
    const canon = rotations(steps).sort().pop()!;
    if (classes.has(canon) && !used.has(canon)) {
      used.add(canon);
      named.push({ name, steps });
    }
  }
  const rest = [...classes.keys()]
    .filter((c) => !used.has(c))
    .sort((a, b) => {
      const threes = (x: string) => x.split('').filter((c) => c === '3').length;
      return threes(a) - threes(b) || (a < b ? 1 : a > b ? -1 : 0);
    })
    .map((steps) => ({ name: steps.split('').join('·'), steps }));
  return [...named, ...rest].map((s, index) => ({ index, name: s.name, steps: s.steps.split('').map(Number) }));
}

export const SCALES: ScaleDef[] = buildPresets();

/** 70 MIDI notes (key C, octave 0) for seven ascending steps repeated over 10 octaves. */
export function entriesFromSteps(steps: readonly number[]): number[] {
  const cum = [0];
  for (let j = 0; j < 6; j++) cum.push(cum[j] + steps[j]);
  const out: number[] = [];
  for (let k = 0; k < 10; k++) for (let j = 0; j < 7; j++) out.push(12 * k + cum[j]);
  return out;
}

/** 70 MIDI notes from one octave of seven offsets (the user-scale editor's "copy octave"). */
export function entriesFromOctave(offsets: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < 10; k++) for (let j = 0; j < 7; j++) out.push(12 * k + (offsets[j] ?? 0));
  return out;
}

/** The default user scale: a plain major scale, so a fresh user slot is usable. */
export function defaultUserScale(): number[] {
  return entriesFromSteps([2, 2, 1, 2, 2, 2, 1]);
}

export function scaleName(index: number): string {
  if (index < PRESET_SCALES) return SCALES[index]?.name ?? '?';
  return `User ${index - PRESET_SCALES + 1}`;
}

/** The 70-entry table for a scale index (preset or user). */
export function scaleEntries(index: number, userScales: number[][]): number[] {
  if (index >= PRESET_SCALES) {
    const u = userScales[index - PRESET_SCALES];
    if (u && u.length === DEGREES) return u;
    return defaultUserScale();
  }
  return entriesFromSteps(SCALES[Math.max(0, Math.min(PRESET_SCALES - 1, index))].steps);
}

function entryAt(e: number[], i: number): number {
  let shift = 0;
  while (i < 0) {
    i += 7;
    shift -= 12;
  }
  while (i >= DEGREES) {
    i -= 7;
    shift += 12;
  }
  return e[i] + shift;
}

/** Fold a note into 0..127 by octaves. */
export function foldNote(n: number): number {
  while (n < 0) n += 12;
  while (n > 127) n -= 12;
  return n;
}

/**
 * MIDI note for a degree. Mode m starts the scale from its m-th position; the mode's first
 * note sits on Key (INF: the documentation says Mode chooses the starting note and Key the
 * root; ANVIL places the mode's start on the root). Octave transposes by octaves.
 */
export function degreeToMidi(degree: number, t: Tonality, entries: number[]): number {
  const m = Math.max(1, Math.min(7, t.mode)) - 1;
  const base = entryAt(entries, degree + m) - (entryAt(entries, m) - entryAt(entries, 0));
  return foldNote(base + t.key + 12 * t.octave);
}

/** ANVIL's name for a degree (exact only in C major, mode 1, key C, octave 0). */
export function degreeName(d: number): string {
  const oct = Math.floor(d / 7) - 1;
  return LETTERS[((d % 7) + 7) % 7] + oct;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI note name with middle C (60) = C4. */
export function midiName(n: number): string {
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
