/**
 * Extended mode: capabilities beyond the documented original, built on the same engine.
 *
 *   Selective regeneration   new rhythm (keeping the pitch sequence), new pitches (keeping the
 *                            rhythm), new accents, or new pitches for a range of events
 *   Motif locking            locked events keep their pitch (and their microrhythm when the
 *                            rhythm is regenerated)
 *   Contour preservation     new pitches follow the old up/down shape where the rules allow
 *   Mutation                 change a chosen proportion of pitches and microrhythms
 *   Seeds                    every result records its seed; a seed can be typed in to recall
 *   Ancestry                 every result records what it was made from
 *
 * Algorithm ids: extended.regenerate.v1, extended.mutate.v1. Classic projects never call these.
 */
import { chooseDegree, contourOf, pushPitch, type PitchContext } from '../engine/pitch';
import { drawAccent, varyCell, type Slot } from '../engine/rhythm';
import { Rng } from '../engine/rng';
import { generateTheme, impose, toSlots } from '../engine/theme';
import type { Origin, Theme, ThemeEvent, TVParams } from '../engine/types';

export const EXT_REGENERATE = 'extended.regenerate.v1';
export const EXT_MUTATE = 'extended.mutate.v1';

export interface ExtOptions {
  locks?: number[];
  preserveContour?: boolean;
}

function withOrigin(t: Theme, events: ThemeEvent[], seed: number, kind: Origin['kind'], note: string, alg: string, cells = t.cells): Theme {
  const length = events.length ? events[events.length - 1].start + events[events.length - 1].len : 0;
  const parent: Omit<Origin, 'parent'> = { kind: t.origin.kind, from: t.origin.from, note: t.origin.note };
  return {
    ...t,
    events,
    cells: cells.filter((c) => c.start < length).map((c) => ({ start: c.start, len: Math.min(c.len, length - c.start) })),
    length,
    seed: seed >>> 0,
    algorithms: Array.from(new Set([...t.algorithms, alg])),
    origin: { kind, from: t.origin.from ?? t.id, note, parent },
  };
}

/** Indices of note events (in event order) that are locked. */
const lockedSet = (locks?: number[]) => new Set(locks ?? []);

/** New pitches for notes (optionally only events [from, to]), keeping rhythm and locked notes. */
export function regeneratePitches(t: Theme, params: TVParams, weights: number[][], seed: number, opts: ExtOptions & { from?: number; to?: number } = {}): Theme {
  const rng = new Rng(seed);
  const locks = lockedSet(opts.locks);
  const events = t.events.map((e) => ({ ...e }));
  const old = events.filter((e) => !e.rest).map((e) => e.degree);
  const contour = opts.preserveContour ? contourOf(old) : undefined;
  const ctx: PitchContext = { history: [], lastInterval: null };
  let k = 0;
  const from = opts.from ?? 0;
  const to = opts.to ?? events.length - 1;
  events.forEach((e, i) => {
    if (e.rest) return;
    const inRange = i >= from && i <= to;
    if (!locks.has(i) && inRange) e.degree = chooseDegree(params, weights, e.start % t.pulse === 0, k, ctx, rng, contour?.[k] || undefined);
    pushPitch(ctx, e.degree);
    k++;
  });
  const what = opts.from !== undefined ? `new pitches for events ${from + 1}-${to + 1}` : 'new pitches';
  return withOrigin(t, events, seed, 'regenerated', what + (opts.preserveContour ? ' (contour kept)' : ''), EXT_REGENERATE);
}

/** New rhythm with the current rhythm parameters; the pitch sequence is re-imposed in order. */
export function regenerateRhythm(t: Theme, params: TVParams, weights: number[][], seed: number, opts: ExtOptions = {}): Theme {
  const locks = lockedSet(opts.locks);
  const fresh = generateTheme(t.id, { ...params, microbeat: t.microbeat, pulse: t.pulse, length: t.length }, weights, seed);
  const old = toSlots(t);
  let slots: Slot[] = toSlots(fresh).slots;
  let cells = fresh.cells;
  if (locks.size) {
    // keep each original microrhythm that contains a locked event
    const lockedStarts = t.events.filter((_, i) => locks.has(i)).map((e) => e.start);
    const keep = t.cells.filter((c) => lockedStarts.some((s) => s >= c.start && s < c.start + c.len));
    slots = slots.slice(0, t.length);
    while (slots.length < t.length) slots.push({ kind: 'hold', accent: 0 });
    for (const c of keep) for (let j = 0; j < c.len; j++) slots[c.start + j] = old.slots[c.start + j];
    if (slots[0].kind === 'hold') slots[0] = { kind: 'rest', accent: -1 };
    cells = t.cells;
  }
  const events = impose(slots, old.degrees, t.pulse, params, weights, new Rng(seed).fork('extend'));
  return withOrigin(t, events, seed, 'regenerated', 'new rhythm, same pitch sequence', EXT_REGENERATE, cells);
}

/** New accent levels (same onsets and pitches), drawn with the current rhythm algorithm's odds. */
export function regenerateAccents(t: Theme, params: TVParams, seed: number, opts: ExtOptions = {}): Theme {
  const rng = new Rng(seed);
  const locks = lockedSet(opts.locks);
  const events = t.events.map((e, i) => (e.rest || locks.has(i) ? { ...e } : { ...e, accent: drawAccent(params.rhythmAlg, e.start % t.pulse === 0, rng) }));
  return withOrigin(t, events, seed, 'regenerated', 'new accents', EXT_REGENERATE);
}

/** Change about `depth` % of pitches and depth/2 % of microrhythms (locked material kept). */
export function mutate(t: Theme, params: TVParams, weights: number[][], seed: number, depth: number, opts: ExtOptions = {}): Theme {
  const rng = new Rng(seed);
  const p = Math.max(0, Math.min(100, depth)) / 100;
  const locks = lockedSet(opts.locks);
  const view = toSlots(t);
  let slots = view.slots.map((s) => ({ ...s }));
  const lockedStarts = t.events.filter((_, i) => locks.has(i)).map((e) => e.start);
  const rp = { length: t.length, pulse: t.pulse, rest: params.rest, rhythmAlg: params.rhythmAlg, rhythmVariant: params.rhythmVariant };
  for (const c of t.cells) {
    if (lockedStarts.some((s) => s >= c.start && s < c.start + c.len)) continue;
    if (!rng.chance(p / 2)) continue;
    const base = slots.slice(c.start, c.start + c.len);
    const v = varyCell(rp, base, rng);
    slots = [...slots.slice(0, c.start), ...v, ...slots.slice(c.start + c.len)];
  }
  if (slots[0].kind === 'hold') slots[0] = { kind: 'rest', accent: -1 };
  if (!slots.some((s) => s.kind === 'on')) slots[0] = { kind: 'on', accent: 1 };
  const events = impose(slots, view.degrees, t.pulse, params, weights, rng.fork('extend'));
  // pitch mutation
  const ctx: PitchContext = { history: [], lastInterval: null };
  let k = 0;
  const lockedDeg = new Set(t.events.map((e, i) => (locks.has(i) ? e.start : -1)));
  for (const e of events) {
    if (e.rest) continue;
    if (!lockedDeg.has(e.start) && rng.chance(p)) e.degree = chooseDegree(params, weights, e.start % t.pulse === 0, k, ctx, rng);
    pushPitch(ctx, e.degree);
    k++;
  }
  return withOrigin(t, events, seed, 'mutated', `mutated ${Math.round(p * 100)}%`, EXT_MUTATE);
}

/** Toggle a lock on an event index. */
export function toggleLock(locks: number[] | undefined, i: number): number[] {
  const s = new Set(locks ?? []);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  return [...s].sort((a, b) => a - b);
}
