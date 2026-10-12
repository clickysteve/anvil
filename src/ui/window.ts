/**
 * Floating application windows in ANVIL's GEM-like style: a title bar in the panel ink with a
 * close box, a compact body, square 1px frame. Non-modal (playback and the rest of ANVIL keep
 * working), draggable by the title bar, kept inside the browser window, and raised when used.
 * Esc closes the window holding the keyboard focus (see app.ts).
 */
import { h } from './dom';

export interface GemWindow {
  el: HTMLElement;
  body: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

let top = 1100;
const all: GemWindow[] = [];
/** the window the user last clicked or focused (buttons do not take focus in ANVIL) */
let active: GemWindow | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    active = all.find((w) => w.isOpen && w.el.contains(e.target as Node)) ?? null;
  }, true);
}

/** The open window the keyboard belongs to: the one holding focus, else the last one used. */
export function focusedWindow(): GemWindow | null {
  const a = document.activeElement;
  const f = all.find((w) => w.isOpen && a instanceof Node && w.el.contains(a));
  if (f) return f;
  return active?.isOpen ? active : null;
}

export function gemWindow(o: { title: string; testid: string; area?: string; width?: number; onOpen?: () => void }): GemWindow {
  const body = h('div', { class: 'gwin-body' });
  const closeBtn = h('button', { type: 'button', class: 'gwin-close', 'aria-label': `Close ${o.title}`, hint: 'Close (Esc)', 'data-testid': `${o.testid}-close` }, '×');
  const title = h('div', { class: 'gwin-title' }, h('span', { class: 'gwin-name' }, o.title), closeBtn);
  const el = h('section', { class: 'gwin', role: 'dialog', 'aria-modal': 'false', 'aria-label': o.title, 'data-testid': o.testid, 'data-area': o.area ?? 'midi', hidden: true, tabindex: -1 }, title, body);
  if (o.width) el.style.width = `min(${o.width}px, calc(100vw - 16px))`;
  let pos: { x: number; y: number } | null = null;

  const clamp = () => {
    if (!pos) return;
    const r = el.getBoundingClientRect();
    pos.x = Math.max(0, Math.min(window.innerWidth - Math.min(r.width, window.innerWidth), pos.x));
    pos.y = Math.max(0, Math.min(window.innerHeight - 24, pos.y));
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  };
  const raise = () => {
    el.style.zIndex = String(++top);
  };
  el.addEventListener('pointerdown', raise, true);
  window.addEventListener('resize', clamp);

  title.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button') || window.innerWidth < 760) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    title.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      pos = { x: ev.clientX - dx, y: ev.clientY - dy };
      clamp();
    };
    const up = () => {
      title.removeEventListener('pointermove', move);
      title.removeEventListener('pointerup', up);
    };
    title.addEventListener('pointermove', move);
    title.addEventListener('pointerup', up);
  });

  const w: GemWindow = {
    el,
    body,
    get isOpen() {
      return !el.hidden;
    },
    open() {
      const was = !el.hidden;
      el.hidden = false;
      raise();
      if (!pos) {
        const r = el.getBoundingClientRect();
        pos = { x: Math.max(0, (window.innerWidth - r.width) / 2), y: Math.max(8, Math.min(80, (window.innerHeight - r.height) / 2)) };
      }
      clamp();
      if (!was) {
        o.onOpen?.();
        active = w;
        el.focus({ preventScroll: true });
      }
    },
    close() {
      if (el.hidden) return;
      el.hidden = true;
      if (active === w) active = null;
    },
    toggle() {
      if (el.hidden) w.open();
      else w.close();
    },
  };
  closeBtn.addEventListener('click', () => w.close());
  all.push(w);
  return w;
}
