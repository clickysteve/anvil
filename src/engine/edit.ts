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
