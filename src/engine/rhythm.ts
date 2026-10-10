/**
 * Theme rhythm: rhythm algorithms 1-6.
 *
 *   1 Second Order A    Variant = maximum number of distinct microrhythms
 *   2 Second Order B
 *   3 Single A          Variant = microrhythm length (in pulses)
 *   4 Single B
 *   5 1/1 Preset        Variant = cell length (in pulses)
 *   6 3/1 Preset
 *
 * A microrhythm ("cell") is built one microbeat ("slot") at a time. Each slot is an onset,
 * a hold (continues the previous note or rest) or a rest. Evidence and approximations:
 *
 *   OBS  Single A/B loop one cell of Variant x Pulse microbeats (classic.rhythm.single.v1).
 *   OBS  Presets alternate base and varied cells, 1:1 or 3:1 (classic.rhythm.preset.v1).
 *   OBS  A-version cells never start with a rest; B-version cells may, and B rests favour the
 *        pulse; A-version rests favour off-pulse positions.
 *   OBS  Accent level odds below are the observed proportions per algorithm, rounded.
 *   INF  The rest-probability mapping, hold odds, second-order stringing and varied-cell
 *        derivation are ANVIL's own (classic.rhythm.cell.v1, .secondorder.v1, .preset.v1).
 */
import type { Accent, Cell, ThemeEvent } from './types';
import { Rng } from './rng';

export interface Slot {
  kind: 'on' | 'hold' | 'rest';
  accent: Accent;
}

export interface RhythmParams {
  length: number;
  pulse: number;
  rest: number;
  rhythmAlg: number;
  rhythmVariant: number;
}

export interface RhythmResult {
  events: ThemeEvent[];
  cells: Cell[];
}

/** Maximum events (notes + rests) in one theme. DOC: up to 99. */
export const MAX_EVENTS = 99;

/** Accent odds [accented, normal, de-accented] on and off the pulse, per algorithm (OBS, rounded). */
const ACCENT_ODDS: Record<number, { on: number[]; off: number[] }> = {
  1: { on: [50, 41, 9], off: [6, 44, 50] },
  2: { on: [42, 39, 19], off: [13, 33, 54] },
  3: { on: [44, 56, 0], off: [0, 41, 59] },
  4: { on: [50, 0, 50], off: [50, 0, 50] },
  5: { on: [46, 27, 27], off: [22, 25, 53] },
  6: { on: [58, 31, 11], off: [11, 40, 49] },
};

/** A versions (respect for the pulse): 1, 3 and the presets. B versions: 2, 4. */
export function isAVersion(alg: number): boolean {
  return alg !== 2 && alg !== 4;
}

function isSecondOrder(alg: number): boolean {
  return alg === 1 || alg === 2;
}

function drawAccent(alg: number, onPulse: boolean, rng: Rng): Accent {
  const t = ACCENT_ODDS[alg] ?? ACCENT_ODDS[1];
  const i = rng.weighted(onPulse ? t.on : t.off);
  return i === 0 ? 1 : i === 1 ? 0 : -1;
}

/** Rest odds for one slot (INF). Fewer rests than the nominal percentage, as observed. */
function restOdds(restPct: number, onPulse: boolean, a: boolean): number {
  const r = Math.max(0, Math.min(99, restPct)) / 100;
  if (r <= 0) return 0;
  if (a && r >= 0.99) return 1; // OBS: at 99 each A-version cell keeps only its first note
  const favoured = r * (0.5 + 0.5 * r);
  const disfavoured = r * r;
  // A versions: rests prefer off-pulse slots. B versions: rests prefer the pulse.
  return a ? (onPulse ? disfavoured : favoured) : onPulse ? favoured : disfavoured;
}

/** Hold odds after a note (INF), tuned to the observed note-value tendencies. */
function holdOdds(alg: number, variant: number, onPulse: boolean): number {
  const base = isSecondOrder(alg) ? Math.min(0.5, 0.08 + 0.03 * variant) : Math.min(0.6, 0.3 + 0.03 * variant);
  return isAVersion(alg) && onPulse ? base * 0.6 : base;
}

/** Decide one slot given the previous slot kind ('rest' or note). */
function drawSlot(p: RhythmParams, j: number, onPulse: boolean, prevRest: boolean, rng: Rng): Slot {
  const a = isAVersion(p.rhythmAlg);
  if (j === 0 && a) return { kind: 'on', accent: drawAccent(p.rhythmAlg, onPulse, rng) };
  if (rng.chance(restOdds(p.rest, onPulse, a))) return { kind: prevRest ? 'hold' : 'rest', accent: -1 };
  if (j > 0 && !prevRest && rng.chance(holdOdds(p.rhythmAlg, p.rhythmVariant, onPulse))) return { kind: 'hold', accent: 0 };
  return { kind: 'on', accent: drawAccent(p.rhythmAlg, onPulse, rng) };
}

/** Is slot j of a cell a rest (following holds of rests)? */
function slotIsRest(cell: Slot[], j: number): boolean {
  for (let i = j; i >= 0; i--) {
    if (cell[i].kind === 'rest') return true;
    if (cell[i].kind === 'on') return false;
  }
  return false;
}

/**
 * Build one cell of `len` microbeats. Cells start on a pulse, so slot j is on the pulse when
 * j % pulse == 0. INF: every cell keeps at least one onset.
 */
export function buildCell(p: RhythmParams, len: number, rng: Rng): Slot[] {
  const cell: Slot[] = [];
  for (let j = 0; j < len; j++) {
    const onPulse = j % p.pulse === 0;
    const prevRest = j > 0 && slotIsRest(cell, j - 1);
    cell.push(drawSlot(p, j, onPulse, prevRest, rng));
  }
  // a cell beginning with "hold" means a rest continuing into it: normalise to rest
  if (cell[0].kind === 'hold') cell[0] = { kind: 'rest', accent: -1 };
  if (!cell.some((s) => s.kind === 'on')) {
    const j = isAVersion(p.rhythmAlg) ? 0 : rng.int(len);
    cell[j] = { kind: 'on', accent: drawAccent(p.rhythmAlg, j % p.pulse === 0, rng) };
    if (j + 1 < len && cell[j + 1].kind === 'hold') cell[j + 1] = { kind: 'rest', accent: -1 };
  }
  return normaliseCell(cell);
}

/** Make holds unambiguous: a hold following a rest stays part of the rest. */
function normaliseCell(cell: Slot[]): Slot[] {
  return cell.map((s, j) => (s.kind === 'hold' && j === 0 ? { kind: 'rest', accent: -1 } : s));
}

const cellKey = (c: Slot[]) => c.map((s) => (s.kind === 'on' ? 'xXo'[s.accent === 1 ? 1 : s.accent === 0 ? 0 : 2] : s.kind === 'hold' ? '-' : '.')).join('');

/** A varied copy of a base cell (INF classic.rhythm.preset.v1): same length, some slots re-rolled. */
export function varyCell(p: RhythmParams, base: Slot[], rng: Rng): Slot[] {
  for (let attempt = 0; attempt < 6; attempt++) {
    const out = base.map((s) => ({ ...s }));
    for (let j = 0; j < out.length; j++) {
      const onPulse = j % p.pulse === 0;
      if (j > 0 && rng.chance(0.35)) {
        const prevRest = slotIsRest(out, j - 1);
        out[j] = drawSlot(p, j, onPulse, prevRest, rng);
      } else if (out[j].kind === 'on' && rng.chance(0.4)) {
        out[j] = { kind: 'on', accent: drawAccent(p.rhythmAlg, onPulse, rng) };
      }
    }
    if (isAVersion(p.rhythmAlg) && out[0].kind !== 'on') out[0] = { kind: 'on', accent: drawAccent(p.rhythmAlg, true, rng) };
    if (!out.some((s) => s.kind === 'on')) continue;
    const norm = normaliseCell(out);
    if (cellKey(norm) !== cellKey(base) || attempt === 5) return norm;
  }
  return base.map((s) => ({ ...s }));
}

/** Lay cells end to end and cut at the theme length. */
function layCells(seq: Slot[][], length: number): { slots: Slot[]; cells: Cell[] } {
  const slots: Slot[] = [];
  const cells: Cell[] = [];
  for (const c of seq) {
    if (slots.length >= length) break;
    const start = slots.length;
    const take = Math.min(c.length, length - start);
    for (let j = 0; j < take; j++) slots.push(c[j]);
    cells.push({ start, len: take });
  }
  return { slots, cells };
}

function single(p: RhythmParams, rng: Rng) {
  const len = Math.max(1, p.rhythmVariant * p.pulse);
  const cell = buildCell(p, len, rng);
  const seq: Slot[][] = [];
  for (let n = 0; n * len < p.length; n++) seq.push(cell);
  return layCells(seq, p.length);
}

function preset(p: RhythmParams, rng: Rng) {
  const len = Math.max(1, p.rhythmVariant * p.pulse);
  const base = buildCell(p, len, rng);
  const seq: Slot[][] = [];
  if (p.rhythmAlg === 5) {
    // 1/1: base, varied, base, varied ... each varied cell differs (OBS)
    for (let n = 0; n * len < p.length; n++) seq.push(n % 2 === 0 ? base : varyCell(p, base, rng));
  } else {
    // 3/1: base, base, base, varied; the four-cell group repeats identically (OBS)
    const varied = varyCell(p, base, rng);
    for (let n = 0; n * len < p.length; n++) seq.push(n % 4 === 3 ? varied : base);
  }
  return layCells(seq, p.length);
}

function secondOrder(p: RhythmParams, rng: Rng) {
  const v = Math.max(1, p.rhythmVariant);
  const maxK = v <= 3 ? 1 : v <= 6 ? 2 : 3;
  const pool: Slot[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v; i++) {
    let cell: Slot[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      cell = buildCell(p, p.pulse * (1 + rng.int(maxK)), rng);
      if (!seen.has(cellKey(cell))) break;
    }
    seen.add(cellKey(cell));
    pool.push(cell);
  }
  // Higher-level pattern, built like a cell: strong positions (every other cell) return to the
  // first cell more often in the A version; repeats of the previous cell are common in both.
  const a = isAVersion(p.rhythmAlg);
  const seq: Slot[][] = [];
  let total = 0;
  let prev = 0;
  for (let m = 0; total < p.length; m++) {
    let idx: number;
    if (m === 0) idx = 0;
    else if (rng.chance(0.3)) idx = prev;
    else if (a && m % 2 === 0 && rng.chance(0.5)) idx = 0;
    else idx = rng.int(pool.length);
    seq.push(pool[idx]);
    total += pool[idx].length;
    prev = idx;
  }
  return layCells(seq, p.length);
}

/** Slots to events: onsets start notes, holds extend, rests merge. */
export function slotsToEvents(slots: Slot[]): ThemeEvent[] {
  const events: ThemeEvent[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const last = events[events.length - 1];
    if (s.kind === 'on') events.push({ start: i, len: 1, rest: false, accent: s.accent, degree: -1 });
    else if (s.kind === 'rest') {
      if (last && last.rest) last.len++;
      else events.push({ start: i, len: 1, rest: true, accent: -1, degree: -1 });
    } else {
      // hold: extends whatever precedes (a note or a rest); at time 0 it is a rest
      if (last) last.len++;
      else events.push({ start: i, len: 1, rest: true, accent: -1, degree: -1 });
    }
  }
  return events;
}

/** Enforce the 99-event limit (INF: the theme is cut after the 99th event). */
function capEvents(events: ThemeEvent[], cells: Cell[]): { events: ThemeEvent[]; cells: Cell[]; length: number } {
  if (events.length <= MAX_EVENTS) {
    const length = events.length ? events[events.length - 1].start + events[events.length - 1].len : 0;
    return { events, cells, length };
  }
  const kept = events.slice(0, MAX_EVENTS);
  const length = kept[kept.length - 1].start + kept[kept.length - 1].len;
  const cut = cells.filter((c) => c.start < length).map((c) => ({ start: c.start, len: Math.min(c.len, length - c.start) }));
  return { events: kept, cells: cut, length };
}

/** Generate a theme rhythm. Pitches are left at -1 for the pitch generator. */
export function generateRhythm(p: RhythmParams, rng: Rng): RhythmResult & { length: number } {
  const q: RhythmParams = {
    length: Math.max(1, Math.round(p.length)),
    pulse: Math.max(1, Math.round(p.pulse)),
    rest: Math.max(0, Math.min(99, Math.round(p.rest))),
    rhythmAlg: Math.max(1, Math.min(6, Math.round(p.rhythmAlg))),
    rhythmVariant: Math.max(1, Math.round(p.rhythmVariant)),
  };
  const laid = q.rhythmAlg <= 2 ? secondOrder(q, rng) : q.rhythmAlg <= 4 ? single(q, rng) : preset(q, rng);
  const events = slotsToEvents(laid.slots);
  if (!events.some((e) => !e.rest)) {
    events.splice(0, events.length, { start: 0, len: q.length, rest: false, accent: 1, degree: -1 });
  }
  return capEvents(events, laid.cells);
}

/** Rhythm pattern as text: X accented, x normal, o de-accented, - held, . rest. */
export function rhythmText(events: ThemeEvent[]): string {
  let s = '';
  for (const e of events) {
    const head = e.rest ? '.' : e.accent === 1 ? 'X' : e.accent === 0 ? 'x' : 'o';
    s += head + (e.rest ? '.' : '-').repeat(e.len - 1);
  }
  return s;
}

export function onPulse(start: number, pulse: number): boolean {
  return start % Math.max(1, pulse) === 0;
}
