/**
 * Hand editing of themes (available in both modes; an ANVIL addition, see docs/BEHAVIOUR.md).
 * Every edit returns a new theme; the original is never mutated.
 */
import { DEGREES } from './tonality';
import type { Accent, Origin, Theme, ThemeEvent } from './types';

function edited(t: Theme, events: ThemeEvent[], note: string): Theme {
  // re-time the events so starts stay contiguous
  let pos = 0;
  const ev = events.map((e) => {
    const out = { ...e, start: pos };
    pos += e.len;
    return out;
  });
  const parent: Omit<Origin, 'parent'> = { kind: t.origin.kind, from: t.origin.from, note: t.origin.note };
  const cells = t.cells.filter((c) => c.start < pos).map((c) => ({ start: c.start, len: Math.min(c.len, pos - c.start) }));
  const covered = cells.reduce((s, c) => s + c.len, 0);
  if (covered < pos) cells.push({ start: covered, len: pos - covered });
  return { ...t, events: ev, length: pos, cells, origin: { kind: 'edited', from: t.origin.from ?? t.id, note, parent } };
}

export function setDegree(t: Theme, i: number, degree: number): Theme {
  const e = t.events[i];
  if (!e || e.rest) return t;
  const d = Math.max(0, Math.min(DEGREES - 1, Math.round(degree)));
  return edited(t, t.events.map((x, k) => (k === i ? { ...x, degree: d } : x)), `pitch of event ${i + 1}`);
}

export function cycleAccent(t: Theme, i: number): Theme {
  const e = t.events[i];
  if (!e || e.rest) return t;
  const next: Accent = e.accent === 1 ? 0 : e.accent === 0 ? -1 : 1;
  return edited(t, t.events.map((x, k) => (k === i ? { ...x, accent: next } : x)), `accent of event ${i + 1}`);
}

export function setAccent(t: Theme, i: number, accent: Accent): Theme {
  const e = t.events[i];
  if (!e || e.rest) return t;
  return edited(t, t.events.map((x, k) => (k === i ? { ...x, accent } : x)), `accent of event ${i + 1}`);
}

/** Note -> rest, or rest -> note (taking the previous note's pitch). Keeps at least one note. */
export function toggleRest(t: Theme, i: number): Theme {
  const e = t.events[i];
  if (!e) return t;
  if (!e.rest && t.events.filter((x) => !x.rest).length <= 1) return t;
  let prev = 35;
  for (let k = i - 1; k >= 0; k--) if (!t.events[k].rest) { prev = t.events[k].degree; break; }
  if (prev === 35) for (let k = i + 1; k < t.events.length; k++) if (!t.events[k].rest) { prev = t.events[k].degree; break; }
  const events = t.events.map((x, k) => (k === i ? (x.rest ? { ...x, rest: false, accent: 0 as Accent, degree: prev } : { ...x, rest: true, accent: -1 as Accent, degree: -1 }) : x));
  // merge adjacent rests
  const merged: ThemeEvent[] = [];
  for (const x of events) {
    const last = merged[merged.length - 1];
    if (last && last.rest && x.rest) last.len += x.len;
    else merged.push({ ...x });
  }
  return edited(t, merged, e.rest ? `rest ${i + 1} to note` : `note ${i + 1} to rest`);
}

/** Change an event's length by delta microbeats (the theme gets longer or shorter). */
export function changeLength(t: Theme, i: number, delta: number): Theme {
  const e = t.events[i];
  if (!e) return t;
  const len = Math.max(1, Math.min(64, e.len + Math.round(delta)));
  if (len === e.len) return t;
  return edited(t, t.events.map((x, k) => (k === i ? { ...x, len } : x)), `length of event ${i + 1}`);
}

/** Transpose every note by delta degrees, kept within the scale table. */
export function transposeTheme(t: Theme, delta: number): Theme {
  return edited(
    t,
    t.events.map((x) => (x.rest ? x : { ...x, degree: Math.max(0, Math.min(DEGREES - 1, x.degree + delta)) })),
    `transposed ${delta > 0 ? '+' : ''}${delta}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Piano-roll style edits. The theme stays one gapless line of events, so these keep the total
// length the same: a moved or resized note takes time from, or gives time to, its neighbours.
// A neighbouring note is shortened but never removed; a neighbouring rest may be used up.

const restEv = (len: number): ThemeEvent => ({ start: 0, len, rest: true, accent: -1, degree: -1 });

function mergeRests(events: ThemeEvent[]): ThemeEvent[] {
  const out: ThemeEvent[] = [];
  for (const e of events) {
    if (e.len <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.rest && e.rest) last.len += e.len;
    else out.push({ ...e });
  }
  return out;
}

/** How far event i can move (negative = earlier, positive = later), in microbeats. */
export function moveLimits(t: Theme, i: number): { min: number; max: number } {
  const prev = t.events[i - 1];
  const next = t.events[i + 1];
  const room = (e: ThemeEvent | undefined) => (!e ? 0 : e.rest ? e.len : e.len - 1);
  return { min: -room(prev) || 0, max: room(next) };
}

/** Move note i by k microbeats in time. */
export function moveNote(t: Theme, i: number, k: number): Theme {
  const e = t.events[i];
  if (!e || e.rest || !k) return t;
  const lim = moveLimits(t, i);
  k = Math.max(lim.min, Math.min(lim.max, Math.round(k)));
  if (!k) return t;
  const ev = t.events.map((x) => ({ ...x }));
  const prev = ev[i - 1];
  const next = ev[i + 1];
  const before: ThemeEvent[] = ev.slice(0, Math.max(0, i - 1));
  const after: ThemeEvent[] = ev.slice(i + 2);
  let mid: ThemeEvent[];
  if (k > 0) {
    // the gap left behind becomes rest; the next event loses its start
    next.len -= k;
    if (prev) mid = prev.rest ? [{ ...prev, len: prev.len + k }, ev[i], next] : [prev, restEv(k), ev[i], next];
    else mid = [restEv(k), ev[i], next];
  } else {
    const m = -k;
    prev.len -= m;
    const tail = next ? (next.rest ? [{ ...next, len: next.len + m }] : [restEv(m), next]) : [restEv(m)];
    mid = [prev, ev[i], ...tail];
  }
  return edited(t, mergeRests([...before, ...mid, ...after]), `moved event ${i + 1} ${k > 0 ? 'later' : 'earlier'} by ${Math.abs(k)}`);
}

/** Set the length of event i; the following event absorbs the difference. */
export function resizeEvent(t: Theme, i: number, len: number): Theme {
  const e = t.events[i];
  if (!e) return t;
  const next = t.events[i + 1];
  const maxGrow = !next ? 0 : next.rest ? next.len : next.len - 1;
  const n = Math.max(1, Math.min(e.len + maxGrow, Math.round(len)));
  const d = n - e.len;
  if (!d) return t;
  const ev = t.events.map((x) => ({ ...x }));
  ev[i].len = n;
  if (d > 0) ev[i + 1].len -= d;
  else if (next && next.rest) ev[i + 1].len -= d;
  else ev.splice(i + 1, 0, restEv(-d));
  return edited(t, mergeRests(ev), `length of event ${i + 1}`);
}

/** Put a one-microbeat note into a rest at microbeat `at`. Returns the theme and the new index. */
export function addNote(t: Theme, at: number, degree: number): { theme: Theme; index: number } {
  const i = t.events.findIndex((e) => at >= e.start && at < e.start + e.len);
  const e = t.events[i];
  if (!e || !e.rest) return { theme: t, index: -1 };
  const d = Math.max(0, Math.min(DEGREES - 1, Math.round(degree)));
  const a = at - e.start;
  const parts: ThemeEvent[] = [];
  if (a > 0) parts.push(restEv(a));
  parts.push({ start: 0, len: 1, rest: false, accent: 0, degree: d });
  if (e.len - a - 1 > 0) parts.push(restEv(e.len - a - 1));
  const ev = [...t.events.slice(0, i), ...parts, ...t.events.slice(i + 1)];
  return { theme: edited(t, ev, `added a note at microbeat ${at + 1}`), index: i + (a > 0 ? 1 : 0) };
}

/** Delete note i (it becomes a rest; adjacent rests merge). Keeps at least one note. */
export function deleteNote(t: Theme, i: number): Theme {
  const e = t.events[i];
  if (!e || e.rest) return t;
  return toggleRest(t, i);
}
