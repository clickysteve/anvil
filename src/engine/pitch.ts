/**
 * Theme pitch (classic.pitch.v1, classic.pitch.repeats.v1).
 *
 * DOC+OBS: degrees are chosen in proportion to the scale-weight table for the note's position
 * (Onbeat table when the note starts on a pulse, Offbeat otherwise); zero weight is never
 * chosen. High/Low are hard limits in degrees. The largest interval is Max Leap; after an
 * interval larger than Max Step, the next interval is at most Max Step. First Note fixes the
 * starting scale position (0 = free). Pitch Loop N repeats the first N pitches (99 = never).
 *
 * DOC: when no note satisfies the restrictions, the restrictions are dropped for that note
 * except the scale weights. OBS: notes never left High/Low in 350+ observed notes, so ANVIL's
 * fallback keeps the range as well as the weights.
 *
 * Max Repeats (classic.pitch.repeats.v1, decided interpretation): at most N successive
 * identical pitches. The observed v1.11 output did not show this limit; ANVIL implements the
 * documented meaning deliberately.
 */
import type { ThemeEvent } from './types';
import { Rng } from './rng';
import { DEGREES } from './tonality';

export interface PitchParams {
  firstNote: number;
  pitchLoop: number;
  low: number;
  high: number;
  maxStep: number;
  maxLeap: number;
  maxRepeats: number;
  onbeatTable: number;
  offbeatTable: number;
}

export interface PitchContext {
  /** previous pitches (most recent last) that constrain the next choice */
  history: number[];
  /** the last interval taken (for the Step/Leap rule) */
  lastInterval: number | null;
}

export function clampRange(p: PitchParams): { low: number; high: number } {
  let low = Math.max(0, Math.min(DEGREES - 1, Math.round(p.low)));
  let high = Math.max(0, Math.min(DEGREES - 1, Math.round(p.high)));
  if (low > high) [low, high] = [high, low];
  return { low, high };
}

function table(weights: number[][], n: number): number[] {
  const t = weights[Math.max(1, Math.min(8, n)) - 1];
  return t && t.some((w) => w > 0) ? t : [1, 1, 1, 1, 1, 1, 1];
}

/** The run length of identical pitches at the end of `history`. */
function runLength(history: number[]): number {
  if (!history.length) return 0;
  const last = history[history.length - 1];
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === last; i--) n++;
  return n;
}

/**
 * Choose one degree. `index` is the note's index in the theme (0 = first note).
 * Optional `direction` (Extended contour preservation): -1 down, 0 same, 1 up — honoured when
 * possible, ignored otherwise.
 */
export function chooseDegree(
  p: PitchParams,
  weights: number[][],
  onPulseNote: boolean,
  index: number,
  ctx: PitchContext,
  rng: Rng,
  direction?: number,
): number {
  const { low, high } = clampRange(p);
  const w = table(weights, onPulseNote ? p.onbeatTable : p.offbeatTable);
  const step = Math.max(1, Math.round(p.maxStep));
  const leap = Math.max(1, Math.round(p.maxLeap));
  const repeats = Math.max(1, Math.round(p.maxRepeats));
  const prev = ctx.history.length ? ctx.history[ctx.history.length - 1] : null;

  const candidates: number[] = [];
  const cw: number[] = [];
  const ok = (d: number) => {
    const weight = w[((d % 7) + 7) % 7];
    if (weight <= 0) return false;
    if (index === 0 && p.firstNote >= 1 && p.firstNote <= 7 && d % 7 !== p.firstNote - 1) return false;
    if (prev !== null) {
      const limit = ctx.lastInterval !== null && Math.abs(ctx.lastInterval) > step ? step : leap;
      if (Math.abs(d - prev) > limit) return false;
      if (d === prev && runLength(ctx.history) >= repeats) return false;
      if (direction !== undefined && Math.sign(d - prev) !== Math.sign(direction)) return false;
    }
    return true;
  };
  for (let d = low; d <= high; d++) if (ok(d)) {
    candidates.push(d);
    cw.push(w[d % 7]);
  }
  if (!candidates.length && direction !== undefined) return chooseDegree(p, weights, onPulseNote, index, ctx, rng);
  if (!candidates.length) {
    // fallback: keep range and weights only (First Note also kept for the first note)
    for (let d = low; d <= high; d++) {
      const weight = w[d % 7];
      if (weight <= 0) continue;
      if (index === 0 && p.firstNote >= 1 && p.firstNote <= 7 && d % 7 !== p.firstNote - 1) continue;
      candidates.push(d);
      cw.push(weight);
    }
  }
  if (!candidates.length) {
    // the weights exclude every degree in range (or First Note is outside it): any in-range degree
    for (let d = low; d <= high; d++) {
      candidates.push(d);
      cw.push(1);
    }
  }
  return candidates[rng.weighted(cw)];
}

export function pushPitch(ctx: PitchContext, d: number): void {
  const prev = ctx.history.length ? ctx.history[ctx.history.length - 1] : null;
  ctx.lastInterval = prev === null ? null : d - prev;
  ctx.history.push(d);
}

/** Assign pitches to the notes of a rhythm, in order. Returns new events. */
export function generatePitches(
  events: ThemeEvent[],
  pulse: number,
  p: PitchParams,
  weights: number[][],
  rng: Rng,
  opts: { fromNote?: number; contour?: number[] } = {},
): ThemeEvent[] {
  const out = events.map((e) => ({ ...e }));
  const notes = out.filter((e) => !e.rest);
  const from = Math.max(0, opts.fromNote ?? 0);
  const ctx: PitchContext = { history: [], lastInterval: null };
  for (let i = 0; i < from && i < notes.length; i++) pushPitch(ctx, notes[i].degree);
  const loop = Math.max(1, Math.round(p.pitchLoop));
  for (let i = from; i < notes.length; i++) {
    let d: number;
    if (loop < 99 && i >= loop) d = notes[i - loop].degree;
    else d = chooseDegree(p, weights, notes[i].start % Math.max(1, pulse) === 0, i, ctx, rng, opts.contour?.[i]);
    notes[i].degree = d;
    pushPitch(ctx, d);
  }
  for (const e of out) if (e.rest) e.degree = -1;
  return out;
}

/** Signs of successive intervals of a pitch list (index i = direction into note i). */
export function contourOf(degrees: number[]): number[] {
  return degrees.map((d, i) => (i === 0 ? 0 : Math.sign(d - degrees[i - 1])));
}
