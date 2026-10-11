/**
 * The interactive theme view: a scrollable, zoomable piano roll of one theme.
 *
 *   drag a note             up/down changes pitch, left/right moves it in time
 *   drag a note's right edge  changes its length
 *   drag empty space        pans the view
 *   wheel                   scrolls pitch; horizontal wheel / trackpad swipe / Shift+wheel scrolls time
 *   Ctrl/Cmd + wheel        zooms time (add Shift to zoom pitch); trackpad pinch zooms time
 *   double-click a rest     adds a note there
 *
 * The view only reports intentions through callbacks; the session performs the edits.
 */
import { degreeName } from '../engine/tonality';
import type { Theme } from '../engine/types';
import { h, svg } from './dom';

export interface RollCallbacks {
  select(i: number | null): void;
  drag(i: number, dDeg: number, dMb: number): void;
  resize(i: number, len: number): void;
  add(at: number, degree: number): void;
}

export interface RollState {
  key: string;
  selected: number | null;
  locks: number[];
  compare: Theme | null;
}

const GUTTER = 34;
const TOP = 12;
const BOTTOM = 12;
const EDGE = 6;
const MAX_DEG = 69;

type Drag =
  | { mode: 'move' | 'resize'; i: number; x0: number; y0: number; len: number; el: SVGRectElement; moved: boolean }
  | { mode: 'pan'; x0: number; y0: number; mb0: number; top0: number; moved: boolean };

export class RollView {
  readonly wrap: HTMLDivElement;
  readonly svg: SVGSVGElement;
  /** pixels per microbeat and per degree row */
  cw = 16;
  rh = 12;
  /** first visible microbeat and the degree at the top row (both may be fractional) */
  scrollMb = 0;
  topDeg = 47;
  private theme: Theme | undefined;
  private state: RollState = { key: '', selected: null, locks: [], compare: null };
  private fittedKey = '';
  private drag: Drag | null = null;
  private playheadEl: SVGLineElement | null = null;
  private lastPlay: number | null = null;
  private interacted = 0;
  /** tallest row height FIT may choose (the maximised editor keeps rows compact) */
  maxFitRow = 24;

  constructor(private cb: RollCallbacks, attrs: Record<string, unknown> = {}) {
    this.svg = svg('svg', { class: 'roll', role: 'img', 'aria-label': 'Theme view' });
    this.wrap = h('div', { class: 'rollwrap', tabindex: 0, ...attrs }, this.svg);
    this.wrap.addEventListener('wheel', this.onWheel, { passive: false });
    this.svg.addEventListener('pointerdown', this.onDown);
    this.svg.addEventListener('pointermove', this.onMove);
    this.svg.addEventListener('pointerup', this.onUp);
    this.svg.addEventListener('pointercancel', this.onUp);
    this.svg.addEventListener('dblclick', this.onDbl);
    new ResizeObserver(() => this.render()).observe(this.wrap);
  }

  private get width(): number {
    return Math.max(240, this.wrap.clientWidth || 640);
  }
  private get height(): number {
    return Math.max(120, this.wrap.clientHeight || 240);
  }
  private get visCols(): number {
    return (this.width - GUTTER - 2) / this.cw;
  }
  private get visRows(): number {
    return (this.height - TOP - BOTTOM) / this.rh;
  }

  x(mb: number): number {
    return GUTTER + (mb - this.scrollMb) * this.cw;
  }
  y(d: number): number {
    return TOP + (this.topDeg - d) * this.rh;
  }

  /** Show a theme. A new item (state.key) is fitted to the view; edits keep the scroll. */
  set(theme: Theme | undefined, state: RollState): void {
    this.theme = theme;
    this.state = state;
    if (state.key !== this.fittedKey) {
      this.fittedKey = state.key;
      this.fit();
    }
    // never pull a note out from under the pointer mid-drag; the drop re-renders
    if (this.drag && this.drag.mode !== 'pan') return;
    this.render();
  }

  /** Zoom and scroll so the whole theme is visible. */
  fit(): void {
    const t = this.theme;
    if (!t) return;
    const len = Math.max(1, t.length);
    this.cw = Math.max(6, Math.min(48, (this.width - GUTTER - 4) / len));
    const ds = [...t.events, ...(this.state.compare?.events ?? [])].filter((e) => !e.rest).map((e) => e.degree);
    const lo = Math.min(...ds) - 2;
    const hi = Math.max(...ds) + 2;
    const rows = Math.max(10, hi - lo + 1);
    this.rh = Math.max(8, Math.min(this.maxFitRow, (this.height - TOP - BOTTOM) / rows));
    const spare = this.visRows - (hi - lo + 1);
    this.topDeg = hi + Math.max(0, spare / 2);
    this.scrollMb = 0;
    this.clamp();
  }

  /**
   * Fit only the time axis to the view and centre the theme's pitches vertically, keeping the
   * current row height: a bigger view shows more time and more pitch rows, not taller notes.
   */
  fitTime(): void {
    const t = this.theme;
    if (!t) return;
    this.cw = Math.max(6, Math.min(48, (this.width - GUTTER - 4) / Math.max(1, t.length)));
    this.rh = Math.min(this.rh, this.maxFitRow);
    const ds = t.events.filter((e) => !e.rest).map((e) => e.degree);
    const mid = (Math.min(...ds) + Math.max(...ds)) / 2;
    this.topDeg = mid + this.visRows / 2;
    this.scrollMb = 0;
    this.clamp();
  }

  /** Current zoom and scroll, so a caller can put the view back exactly. */
  get view(): { cw: number; rh: number; scrollMb: number; topDeg: number } {
    return { cw: this.cw, rh: this.rh, scrollMb: this.scrollMb, topDeg: this.topDeg };
  }
  set view(v: { cw: number; rh: number; scrollMb: number; topDeg: number }) {
    Object.assign(this, v);
    this.clamp();
  }

  private clamp(): void {
    const len = this.theme?.length ?? 32;
    this.scrollMb = Math.max(0, Math.min(Math.max(0, len - this.visCols + 1), this.scrollMb));
    this.topDeg = Math.max(Math.min(MAX_DEG + 1, this.visRows - 1), Math.min(MAX_DEG + 1, this.topDeg));
  }

  render(): void {
    const root = this.svg;
    while (root.firstChild) root.removeChild(root.firstChild);
    const W = this.width;
    const H = this.height;
    root.setAttribute('viewBox', `0 0 ${W} ${H}`);
    root.setAttribute('width', String(W));
    root.setAttribute('height', String(H));
    const t = this.theme;
    if (!t) {
      const tx = svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' });
      tx.textContent = 'Empty slot: click it or press G to generate';
      root.append(tx);
      this.playheadEl = null;
      return;
    }
    this.clamp();
    const defs = svg('defs');
    const clip = svg('clipPath', { id: 'rollclip' });
    clip.append(svg('rect', { x: GUTTER, y: 0, width: W - GUTTER, height: H }));
    defs.append(clip);
    root.append(defs);
    const area = svg('g', { 'clip-path': 'url(#rollclip)' });
    const loDeg = Math.floor(this.topDeg - this.visRows) - 1;
    const hiDeg = Math.ceil(this.topDeg) + 1;
    // rows: shade the scale's first position (C in C major), label rows when there is room
    for (let d = Math.max(0, loDeg); d <= Math.min(MAX_DEG, hiDeg); d++) {
      const yy = this.y(d);
      if (d % 7 === 0) area.append(svg('rect', { x: GUTTER, y: yy, width: W - GUTTER, height: this.rh, class: 'rowc' }));
      if (d % 7 === 0 || this.rh >= 11) {
        const lab = svg('text', { x: 2, y: yy + this.rh - 2, class: d % 7 === 0 ? 'axis c' : 'axis' });
        lab.textContent = degreeName(d);
        root.append(lab);
      }
      area.append(svg('line', { x1: GUTTER, x2: W, y1: yy + this.rh, y2: yy + this.rh, class: d % 7 === 0 ? 'grid c' : 'grid row' }));
    }
    // columns
    const m0 = Math.max(0, Math.floor(this.scrollMb));
    const m1 = Math.min(t.length, Math.ceil(this.scrollMb + this.visCols));
    for (let mb = m0; mb <= m1; mb++) {
      area.append(svg('line', { x1: this.x(mb), x2: this.x(mb), y1: TOP, y2: H - BOTTOM, class: mb % t.pulse === 0 ? 'grid pulse' : 'grid' }));
    }
    // end of theme
    area.append(svg('rect', { x: this.x(t.length), y: 0, width: Math.max(0, W - this.x(t.length)), height: H, class: 'beyond' }));
    t.cells.forEach((c, i) => area.append(svg('rect', { x: this.x(c.start) + 0.5, y: 2, width: Math.max(1, c.len * this.cw - 1.5), height: 6, class: i % 2 ? 'cell odd' : 'cell' })));
    const cmp = this.state.compare;
    if (cmp) {
      for (const e of cmp.events) {
        if (e.rest) continue;
        area.append(svg('rect', { x: this.x(e.start) + 1, y: this.y(e.degree) + 1, width: Math.max(1, e.len * this.cw - 2), height: Math.max(1, this.rh - 2), class: 'cmp' }));
      }
    }
    const locks = new Set(this.state.locks);
    t.events.forEach((e, i) => {
      const sel = this.state.selected === i ? ' sel' : '';
      if (e.rest) {
        area.append(svg('rect', { x: this.x(e.start) + 1, y: H - BOTTOM + 3, width: Math.max(1, e.len * this.cw - 2), height: 5, class: 'rest' + sel, 'data-i': i }));
        return;
      }
      const cls = e.accent === 1 ? 'n acc' : e.accent === 0 ? 'n nrm' : 'n dea';
      area.append(svg('rect', { x: this.x(e.start) + 1, y: this.y(e.degree) + 1, width: Math.max(2, e.len * this.cw - 2), height: Math.max(2, this.rh - 2), class: cls + sel, 'data-i': i }));
      if (locks.has(i)) area.append(svg('rect', { x: this.x(e.start) + 2, y: this.y(e.degree) - 4, width: 5, height: 4, class: 'lock' }));
    });
    root.append(area);
    root.append(svg('line', { x1: GUTTER, x2: GUTTER, y1: 0, y2: H, class: 'gutterline' }));
    this.playheadEl = svg('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'playhead', visibility: 'hidden' });
    root.append(this.playheadEl);
    if (this.lastPlay !== null) this.playhead(this.lastPlay);
  }

  /** Move the playhead (microbeats) or hide it (null). Follows playback when it leaves the view. */
  playhead(mb: number | null): void {
    this.lastPlay = mb;
    const el = this.playheadEl;
    if (!el) return;
    if (mb === null) return void el.setAttribute('visibility', 'hidden');
    const idle = performance.now() - this.interacted > 2500 && !this.drag;
    if (idle && (mb < this.scrollMb || mb > this.scrollMb + this.visCols - 1)) {
      this.scrollMb = Math.max(0, mb - 1);
      this.render();
      return;
    }
    const xx = this.x(mb);
    el.setAttribute('x1', String(xx));
    el.setAttribute('x2', String(xx));
    el.setAttribute('visibility', xx >= GUTTER ? 'visible' : 'hidden');
  }

  // ------------------------------------------------------------------ input

  private onWheel = (e: WheelEvent): void => {
    if (!this.theme) return;
    e.preventDefault();
    this.interacted = performance.now();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-dy * 0.01);
      const r = this.svg.getBoundingClientRect();
      if (e.shiftKey) {
        const at = this.topDeg - (e.clientY - r.top - TOP) / this.rh;
        this.rh = Math.max(6, Math.min(40, this.rh * f));
        this.topDeg = at + (e.clientY - r.top - TOP) / this.rh;
      } else {
        const at = this.scrollMb + (e.clientX - r.left - GUTTER) / this.cw;
        this.cw = Math.max(4, Math.min(80, this.cw * f));
        this.scrollMb = at - (e.clientX - r.left - GUTTER) / this.cw;
      }
    } else {
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
      this.scrollMb += dx / this.cw;
      this.topDeg -= dy / this.rh;
    }
    this.render();
  };

  private local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.theme) return;
    this.wrap.focus();
    this.interacted = performance.now();
    const tgt = e.target as Element;
    const idx = tgt.getAttribute('data-i');
    const p = this.local(e);
    if (idx !== null) {
      const i = Number(idx);
      this.cb.select(i);
      const ev = this.theme.events[i];
      if (!ev || ev.rest) return;
      // the selection re-render replaced the element: find the new one
      const el = this.svg.querySelector(`rect.n[data-i="${i}"]`) as SVGRectElement | null;
      if (!el) return;
      const right = this.x(ev.start + ev.len);
      this.drag = { mode: right - p.x <= EDGE ? 'resize' : 'move', i, x0: p.x, y0: p.y, len: ev.len, el, moved: false };
    } else {
      this.drag = { mode: 'pan', x0: p.x, y0: p.y, mb0: this.scrollMb, top0: this.topDeg, moved: false };
    }
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    const p = this.local(e);
    if (!d) {
      // cursor hint: resize near a note's right edge
      const tgt = e.target as Element;
      const idx = tgt.getAttribute?.('data-i');
      const ev = idx !== null && idx !== undefined ? this.theme?.events[Number(idx)] : undefined;
      this.svg.style.cursor = ev && !ev.rest ? (this.x(ev.start + ev.len) - p.x <= EDGE ? 'ew-resize' : 'grab') : 'default';
      return;
    }
    const dx = p.x - d.x0;
    const dy = p.y - d.y0;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    this.interacted = performance.now();
    if (d.mode === 'pan') {
      this.scrollMb = d.mb0 - dx / this.cw;
      this.topDeg = d.top0 + dy / this.rh;
      this.render();
      return;
    }
    const dMb = Math.round(dx / this.cw);
    if (d.mode === 'move') {
      const dDeg = Math.round(-dy / this.rh);
      d.el.setAttribute('transform', `translate(${dMb * this.cw} ${-dDeg * this.rh})`);
      d.el.classList.add('dragging');
    } else {
      d.el.setAttribute('width', String(Math.max(2, (d.len + dMb) * this.cw - 2)));
      d.el.classList.add('dragging');
    }
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (!d) return;
    const p = this.local(e);
    const dx = p.x - d.x0;
    const dy = p.y - d.y0;
    if (d.mode === 'pan') {
      if (!d.moved) this.cb.select(null);
      return;
    }
    if (!d.moved) return;
    const dMb = Math.round(dx / this.cw);
    if (d.mode === 'move') this.cb.drag(d.i, Math.round(-dy / this.rh), dMb);
    else this.cb.resize(d.i, d.len + dMb);
    this.render();
  };

  private onDbl = (e: MouseEvent): void => {
    const t = this.theme;
    if (!t) return;
    const tgt = e.target as Element;
    const idx = tgt.getAttribute('data-i');
    if (idx !== null && !t.events[Number(idx)]?.rest) return;
    const p = this.local(e);
    const at = Math.floor(this.scrollMb + (p.x - GUTTER) / this.cw);
    const deg = Math.ceil(this.topDeg - (p.y - TOP) / this.rh);
    if (at < 0 || at >= t.length || p.x < GUTTER) return;
    this.cb.add(at, Math.max(0, Math.min(MAX_DEG, deg)));
  };
}
