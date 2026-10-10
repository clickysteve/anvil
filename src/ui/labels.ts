/** Short names for algorithm numbers and values, shown in the interface. */
import { degreeName } from '../engine/tonality';

export const RHYTHM_ALGS = ['Second Order A', 'Second Order B', 'Single A', 'Single B', '1/1 Preset', '3/1 Preset'];
export const RHYTHM_VARS = ['None', 'Replace one microrhythm', 'Swap two microrhythms', 'Halve theme length', 'Delete last microrhythm', 'Delete last V microbeats'];
export const PITCH_VARS = ['None', 'Regenerate last V pitches', 'Invert last V pitches', 'Reverse last V pitches', 'Swap V adjacent pairs'];
export const ACC_RHYTHMS = [
  'Every note', 'Every rest', 'Notes on pulse', 'Rests on pulse', 'Accented notes', 'Accented on pulse',
  'Accented off pulse', 'Notes off pulse', 'Rests off pulse', 'Every microbeat', 'Microbeats w/o onset', 'Every pulse',
];
export const HARMONIES = [
  'Parallel', 'Partial', 'Random harmony', 'Random notes', 'Contrary motion', 'Inversion', 'Fixed', 'Partial fixed',
  'Arpeggio up', 'Arpeggio down', 'Arpeggio up-down', 'D1 Random drums', 'D2 Weighted drums', 'D3 Drums follow theme',
  'D4 Cyclic drums', 'D5 Alternating drums',
];
export const ARTS = [
  'Short staccato', 'Short legato accents', 'Short staccato accents', 'Short legato',
  'Long staccato', 'Long legato accents', 'Long staccato accents', 'Long legato',
];

export const DIVIDES: [number, string][] = [
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((n): [number, string] => [n, String(n)]),
  [0, '½'],
  ...[-1, -2, -3, -4, -5, -6, -7, -8].map((n): [number, string] => [n, String(n)]),
];

const NOTE_VALUES: Record<number, string> = { 96: '1/1', 72: '1/2.', 48: '1/2', 36: '1/4.', 32: '1/2T', 24: '1/4', 18: '1/8.', 16: '1/4T', 12: '1/8', 9: '1/16.', 8: '1/8T', 6: '1/16', 4: '1/16T', 3: '1/32', 2: '1/32T' };

export function microbeatLabel(clocks: number): string {
  return NOTE_VALUES[clocks] ? `${clocks} ${NOTE_VALUES[clocks]}` : `${clocks}`;
}

export function parseDegree(s: string): number | null {
  const m = /^([A-Ga-g])(-?\d)$/.exec(s.trim());
  if (m) return 'CDEFGAB'.indexOf(m[1].toUpperCase()) + 7 * (Number(m[2]) + 1);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export { degreeName };

/** Clocks as bars:beats (4/4), for arranger step lengths. */
export function clocksLabel(c: number): string {
  const beats = c / 24;
  const bars = Math.floor(beats / 4);
  const rest = Math.round((beats - bars * 4) * 100) / 100;
  return `${bars}:${rest}`;
}
