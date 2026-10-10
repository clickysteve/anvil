/**
 * Themes and variations: generation from parameters, and the documented variation operations.
 *
 * DOC: a variation starts from its own row's theme and applies the current Rhythm Variation
 * and Pitch Variation algorithms with the shared Variation Variant (V):
 *   Pitch:  0 none, 1 regenerate last V pitches, 2 invert last V, 3 reverse last V,
 *           4 swap V adjacent pairs (V = 0 means all pitches)
 *   Rhythm: 0 none, 1 replace one microrhythm, 2 swap two microrhythms, 3 halve theme length,
 *           4 delete last microrhythm, 5 delete last V microbeats
 * DOC: rhythm and pitch are generated separately and then combined, so either can change
 * without the other. After a rhythm variation the pitch sequence is re-imposed in order.
 *
 * INF (classic.variation.pitch.v1 / classic.variation.rhythm.v1): which microrhythm is
 * replaced or swapped (seeded random), the inversion pivot (the first varied pitch, folded back
 * into High/Low by octaves), which pairs are swapped (V seeded-random adjacent pairs).
 */
import { CURRENT_ALGORITHMS } from './algorithms';
import { chooseDegree, clampRange, generatePitches, pushPitch, type PitchContext } from './pitch';
import { buildCell, generateRhythm, slotsToEvents, type Slot } from './rhythm';
import { Rng } from './rng';
import type { Cell, ItemId, Origin, Theme, ThemeEvent, TVParams } from './types';

export function rhythmAlgorithmIds(alg: number): string[] {
  const ids = [CURRENT_ALGORITHMS.rhythmCell];
  if (alg <= 2) ids.push(CURRENT_ALGORITHMS.rhythmSecondOrder);
  else if (alg <= 4) ids.push(CURRENT_ALGORITHMS.rhythmSingle);
  else ids.push(CURRENT_ALGORITHMS.rhythmPreset);
  return ids;
}

const PITCH_IDS = () => [CURRENT_ALGORITHMS.pitch, CURRENT_ALGORITHMS.pitchRepeats];

/** Generate a theme from parameters and a seed. Pure and deterministic. */
export function generateTheme(id: ItemId, params: TVParams, weights: number[][], seed: number): Theme {
  const rng = new Rng(seed);
  const r = generateRhythm(params, rng.fork('rhythm'));
  const events = generatePitches(r.events, params.pulse, params, weights, rng.fork('pitch'));
  return {
    id,
    microbeat: Math.max(1, Math.round(params.microbeat)),
    pulse: Math.max(1, Math.round(params.pulse)),
    length: r.length,
    events,
    cells: r.cells,
    seed: seed >>> 0,
    params: { ...params },
    algorithms: [...rhythmAlgorithmIds(params.rhythmAlg), ...PITCH_IDS()],
    origin: { kind: 'generated' },
  };
}

// ---------------------------------------------------------------- slot view of a theme

export interface SlotView {
  slots: Slot[];
  degrees: number[]; // pitch sequence, one per note, in order
}

export function toSlots(t: Pick<Theme, 'events'>): SlotView {
  const slots: Slot[] = [];
  const degrees: number[] = [];
  for (const e of t.events) {
    if (e.rest) for (let i = 0; i < e.len; i++) slots.push(i === 0 ? { kind: 'rest', accent: -1 } : { kind: 'hold', accent: 0 });
    else {
      slots.push({ kind: 'on', accent: e.accent });
      for (let i = 1; i < e.len; i++) slots.push({ kind: 'hold', accent: 0 });
      degrees.push(e.degree);
    }
  }
  return { slots, degrees };
}

/**
 * Combine a rhythm (slots) with a pitch sequence in order. If the rhythm has more notes than
 * the sequence, the extra pitches are generated with the current pitch rules.
 */
export function impose(slots: Slot[], degrees: number[], pulse: number, params: TVParams, weights: number[][], rng: Rng): ThemeEvent[] {
  const events = slotsToEvents(slots);
  const ctx: PitchContext = { history: [], lastInterval: null };
  let k = 0;
  for (const e of events) {
    if (e.rest) continue;
    const d = k < degrees.length ? degrees[k] : chooseDegree(params, weights, e.start % pulse === 0, k, ctx, rng);
    e.degree = d;
    pushPitch(ctx, d);
    k++;
  }
  return events;
}

function cellsFromLengths(lengths: number[]): Cell[] {
  const out: Cell[] = [];
  let s = 0;
  for (const len of lengths) {
    if (len <= 0) continue;
    out.push({ start: s, len });
    s += len;
  }
  return out;
}

function totalLength(events: ThemeEvent[]): number {
  return events.length ? events[events.length - 1].start + events[events.length - 1].len : 0;
}

// ---------------------------------------------------------------- rhythm variations

export function applyRhythmVariation(src: Theme, params: TVParams, weights: number[][], rng: Rng): { events: ThemeEvent[]; cells: Cell[]; note: string } {
  const alg = Math.round(params.rhythmVarAlg);
  const view = toSlots(src);
  let slots = view.slots;
  let cells = src.cells.length ? src.cells.map((c) => ({ ...c })) : [{ start: 0, len: src.length }];
  let note = '';
  const cellSlots = (c: Cell) => slots.slice(c.start, c.start + c.len);
  if (alg === 1) {
    const i = rng.int(cells.length);
    const c = cells[i];
    const fresh = buildCell({ length: src.length, pulse: src.pulse, rest: params.rest, rhythmAlg: params.rhythmAlg, rhythmVariant: params.rhythmVariant }, c.len, rng);
    slots = [...slots.slice(0, c.start), ...fresh, ...slots.slice(c.start + c.len)];
    note = `replaced microrhythm ${i + 1}`;
  } else if (alg === 2 && cells.length >= 2) {
    const i = rng.int(cells.length);
    let j = rng.int(cells.length - 1);
    if (j >= i) j++;
    const [a, b] = i < j ? [i, j] : [j, i];
    const parts = cells.map(cellSlots);
    [parts[a], parts[b]] = [parts[b], parts[a]];
    slots = parts.flat();
    cells = cellsFromLengths(parts.map((p) => p.length));
    note = `swapped microrhythms ${a + 1} and ${b + 1}`;
  } else if (alg === 3) {
    const len = Math.max(1, Math.floor(slots.length / 2));
    slots = slots.slice(0, len);
    note = 'halved length';
  } else if (alg === 4 && cells.length >= 2) {
    const last = cells[cells.length - 1];
    slots = slots.slice(0, last.start);
    note = 'deleted last microrhythm';
  } else if (alg === 5) {
    const v = Math.max(1, Math.round(params.varVariant));
    slots = slots.slice(0, Math.max(1, slots.length - v));
    note = `deleted last ${v} microbeats`;
  }
  if (alg === 3 || alg === 4 || alg === 5) {
    cells = cells.filter((c) => c.start < slots.length).map((c) => ({ start: c.start, len: Math.min(c.len, slots.length - c.start) }));
  }
  // a cut theme must not start with a hold
  if (slots.length && slots[0].kind === 'hold') slots[0] = { kind: 'rest', accent: -1 };
  if (!slots.some((s) => s.kind === 'on')) slots[0] = { kind: 'on', accent: 1 };
  const events = impose(slots, view.degrees, src.pulse, params, weights, rng);
  return { events, cells, note };
}

// ---------------------------------------------------------------- pitch variations

function foldIntoRange(d: number, low: number, high: number): number {
  while (d > high && d - 7 >= low) d -= 7;
  while (d < low && d + 7 <= high) d += 7;
  return Math.max(low, Math.min(high, d));
}

export function applyPitchVariation(events: ThemeEvent[], pulse: number, params: TVParams, weights: number[][], rng: Rng): { events: ThemeEvent[]; note: string } {
  const alg = Math.round(params.pitchVarAlg);
  const out = events.map((e) => ({ ...e }));
  const notes = out.filter((e) => !e.rest);
  const n = notes.length;
  const v = Math.max(0, Math.round(params.varVariant));
  const count = v === 0 ? n : Math.min(v, n);
  const from = n - count;
  const { low, high } = clampRange(params);
  let note = '';
  if (alg === 1 && count > 0) {
    const regenerated = generatePitches(out, pulse, { ...params, pitchLoop: 99 }, weights, rng, { fromNote: from });
    return { events: regenerated, note: `regenerated last ${count} pitches` };
  }
  if (alg === 2 && count > 0) {
    const pivot = notes[from].degree;
    for (let i = from; i < n; i++) notes[i].degree = foldIntoRange(2 * pivot - notes[i].degree, low, high);
    note = `inverted last ${count} pitches`;
  } else if (alg === 3 && count > 1) {
    const seq = notes.slice(from).map((e) => e.degree).reverse();
    for (let i = from; i < n; i++) notes[i].degree = seq[i - from];
    note = `reversed last ${count} pitches`;
  } else if (alg === 4 && n >= 2) {
    if (v === 0) {
      for (let i = 0; i + 1 < n; i += 2) [notes[i].degree, notes[i + 1].degree] = [notes[i + 1].degree, notes[i].degree];
      note = 'swapped all adjacent pairs';
    } else {
      for (let k = 0; k < v; k++) {
        const i = rng.int(n - 1);
        [notes[i].degree, notes[i + 1].degree] = [notes[i + 1].degree, notes[i].degree];
      }
      note = `swapped ${v} adjacent pairs`;
    }
  }
  return { events: out, note };
}

/** Make a variation of `src` with the current parameters. Pure and deterministic. */
export function generateVariation(id: ItemId, src: Theme, params: TVParams, weights: number[][], seed: number): Theme {
  const rng = new Rng(seed);
  const r = applyRhythmVariation(src, params, weights, rng.fork('rhythm'));
  const p = applyPitchVariation(r.events, src.pulse, params, weights, rng.fork('pitch'));
  const notes = [r.note, p.note].filter(Boolean).join('; ') || 'unchanged copy';
  return {
    id,
    microbeat: src.microbeat,
    pulse: src.pulse,
    length: totalLength(p.events),
    events: p.events,
    cells: r.cells,
    seed: seed >>> 0,
    params: { ...params },
    algorithms: [CURRENT_ALGORITHMS.variationRhythm, CURRENT_ALGORITHMS.variationPitch, ...PITCH_IDS()],
    origin: { kind: 'variation', from: src.id, note: `rhythm var ${params.rhythmVarAlg}, pitch var ${params.pitchVarAlg}, V${params.varVariant}: ${notes}` },
  };
}

export function rowTheme(id: ItemId): ItemId {
  return ('T' + id[1]) as ItemId;
}

export function isVariation(id: ItemId): boolean {
  return id[0] === 'V';
}

/** A deep copy of a theme under another id. */
export function copyTheme(t: Theme, id: ItemId, origin?: Origin): Theme {
  return {
    ...t,
    id,
    events: t.events.map((e) => ({ ...e })),
    cells: t.cells.map((c) => ({ ...c })),
    params: { ...t.params },
    algorithms: [...t.algorithms],
    origin: origin ?? { kind: 'copy', from: t.id },
  };
}

export function themeLengthClocks(t: Pick<Theme, 'length' | 'microbeat'>): number {
  return t.length * t.microbeat;
}

export { totalLength };
