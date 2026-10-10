/**
 * Drawing a theme: time runs left to right in microbeats, scale degree runs upward.
 * Accented notes are solid, normal notes are tinted, de-accented notes are outlined.
 * Pulse positions and microrhythm (cell) boundaries are marked so the structure is visible.
 */
import { degreeName } from '../engine/tonality';
import type { Theme } from '../engine/types';
import { svg } from './dom';

export interface ViewOpts {
  width: number;
  height: number;
  mini?: boolean;
  selected?: number | null;
  locks?: number[];
  compare?: Theme | null;
}

function range(t: Theme, c?: Theme | null): [number, number] {
  const ds = [...t.events, ...(c?.events ?? [])].filter((e) => !e.rest).map((e) => e.degree);
  let lo = Math.min(...ds);
  let hi = Math.max(...ds);
  if (!Number.isFinite(lo)) [lo, hi] = [35, 42];
  const minRows = 8;
  if (hi - lo + 1 < minRows) {
    const pad = minRows - (hi - lo + 1);
    lo -= Math.floor(pad / 2);
    hi += Math.ceil(pad / 2);
  }
  return [lo - 1, hi + 1];
}

export function drawTheme(root: SVGSVGElement, t: Theme | undefined, o: ViewOpts): { x: (mb: number) => number; gutter: number } {
  while (root.firstChild) root.removeChild(root.firstChild);
  root.setAttribute('viewBox', `0 0 ${o.width} ${o.height}`);
  root.setAttribute('width', String(o.width));
  root.setAttribute('height', String(o.height));
  const gutter = o.mini ? 0 : 30;
  const top = o.mini ? 2 : 14;
  const bottom = o.mini ? 2 : 10;
  if (!t) {
    if (!o.mini) {
      const tx = svg('text', { x: o.width / 2, y: o.height / 2, 'text-anchor': 'middle', class: 'empty' });
      tx.textContent = 'Empty slot: click or press G to generate';
      root.append(tx);
    }
    return { x: () => 0, gutter };
  }
  const len = Math.max(t.length, o.compare?.length ?? 0);
  const cw = (o.width - gutter - 2) / len;
  const [lo, hi] = range(t, o.compare);
  const rows = hi - lo + 1;
  const rh = (o.height - top - bottom) / rows;
  const x = (mb: number) => gutter + mb * cw;
  const y = (d: number) => top + (hi - d) * rh;

  if (!o.mini) {
    // degree rows: C lines and labels
    for (let d = lo; d <= hi; d++) {
      if (d % 7 === 0) {
        root.append(svg('line', { x1: gutter, x2: o.width, y1: y(d) + rh, y2: y(d) + rh, class: 'grid c' }));
        const lab = svg('text', { x: 2, y: y(d) + rh - 2, class: 'axis' });
        lab.textContent = degreeName(d);
        root.append(lab);
      }
    }
    // microbeats, pulses, cells
    for (let mb = 0; mb <= len; mb++) {
      const cls = mb % t.pulse === 0 ? 'grid pulse' : 'grid';
      root.append(svg('line', { x1: x(mb), x2: x(mb), y1: top, y2: o.height - bottom, class: cls }));
    }
    t.cells.forEach((c, i) => {
      root.append(svg('rect', { x: x(c.start) + 0.5, y: 2, width: Math.max(1, c.len * cw - 1.5), height: 6, class: i % 2 ? 'cell odd' : 'cell' }));
    });
  }
  if (o.compare && !o.mini) {
    for (const e of o.compare.events) {
      if (e.rest) continue;
      root.append(svg('rect', { x: x(e.start) + 1, y: y(e.degree) + 1, width: Math.max(1, e.len * cw - 2), height: Math.max(1, rh - 2), class: 'cmp' }));
    }
  }
  const locks = new Set(o.locks ?? []);
  t.events.forEach((e, i) => {
    if (e.rest) {
      if (!o.mini) {
        const r = svg('rect', { x: x(e.start) + 1, y: o.height - bottom + 3, width: Math.max(1, e.len * cw - 2), height: 4, class: 'rest' + (o.selected === i ? ' sel' : ''), 'data-i': i });
        root.append(r);
      }
      return;
    }
    const cls = e.accent === 1 ? 'n acc' : e.accent === 0 ? 'n nrm' : 'n dea';
    const r = svg('rect', {
      x: x(e.start) + (o.mini ? 0 : 1),
      y: y(e.degree) + (o.mini ? 0 : 1),
      width: Math.max(1, e.len * cw - (o.mini ? 0.6 : 2)),
      height: Math.max(1, rh - (o.mini ? 0 : 2)),
      class: cls + (o.selected === i ? ' sel' : ''),
      'data-i': i,
    });
    root.append(r);
    if (locks.has(i) && !o.mini) root.append(svg('rect', { x: x(e.start) + 2, y: y(e.degree) - 5, width: 5, height: 4, class: 'lock' }));
  });
  if (!o.mini) {
    const ph = svg('line', { x1: gutter, x2: gutter, y1: 0, y2: o.height, class: 'playhead', visibility: 'hidden' });
    ph.id = 'playhead';
    root.append(ph);
  }
  return { x, gutter };
}
