/** Compact controls. Every control is keyboard-operable and carries a hint. */
import { bind, h } from './dom';

export interface NumOpts {
  label: string;
  hint: string;
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** step with Shift held */
  big?: number;
  format?: (v: number) => string;
  parse?: (s: string) => number | null;
  disabled?: () => boolean;
  testid?: string;
  cls?: string;
}

export function numField(o: NumOpts): HTMLElement {
  const step = o.step ?? 1;
  const big = o.big ?? step * 10;
  const fmt = o.format ?? ((v: number) => String(v));
  const clamp = (v: number) => Math.max(o.min, Math.min(o.max, v));
  const input = h('input', { class: 'val', type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': o.label, 'data-testid': o.testid });
  const commit = () => {
    const raw = input.value.trim();
    const parsed = o.parse ? o.parse(raw) : raw === '' ? null : Number(raw);
    if (parsed !== null && Number.isFinite(parsed)) o.set(clamp(Math.round(parsed / step) * step));
    input.value = fmt(o.get());
  };
  const bump = (d: number) => {
    if (o.disabled?.()) return;
    o.set(clamp(Math.round((o.get() + d) * 1000) / 1000));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      bump(e.shiftKey ? big : step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      bump(-(e.shiftKey ? big : step));
    } else if (e.key === 'Enter') {
      commit();
      input.select();
    } else if (e.key === 'Escape') {
      input.value = fmt(o.get());
      input.blur();
    }
  });
  input.addEventListener('change', commit);
  input.addEventListener('focus', () => input.select());
  const wrap = h(
    'div',
    { class: 'field ' + (o.cls ?? ''), hint: o.hint },
    h('span', { class: 'lbl' }, o.label),
    h('button', { class: 'nudge', type: 'button', tabindex: -1, 'aria-label': `decrease ${o.label}`, onclick: (e: MouseEvent) => bump(-(e.shiftKey ? big : step)) }, '‹'),
    input,
    h('button', { class: 'nudge', type: 'button', tabindex: -1, 'aria-label': `increase ${o.label}`, onclick: (e: MouseEvent) => bump(e.shiftKey ? big : step) }, '›'),
  );
  wrap.addEventListener('wheel', (e) => {
    if (document.activeElement !== input && !wrap.matches(':hover')) return;
    e.preventDefault();
    bump((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? big : step));
  }, { passive: false });
  bind(() => {
    const dis = !!o.disabled?.();
    wrap.classList.toggle('disabled', dis);
    input.disabled = dis;
    if (document.activeElement !== input) input.value = fmt(o.get());
  });
  return wrap;
}

export interface SelectOpts<T extends string | number> {
  label: string;
  hint: string;
  options: () => [T, string][];
  get: () => T;
  set: (v: T) => void;
  testid?: string;
  cls?: string;
  disabled?: () => boolean;
}

export function selectField<T extends string | number>(o: SelectOpts<T>): HTMLElement {
  const sel = h('select', { 'aria-label': o.label, 'data-testid': o.testid });
  let lastKey = '';
  sel.addEventListener('change', () => {
    const opt = o.options().find(([v]) => String(v) === sel.value);
    if (opt) o.set(opt[0]);
  });
  const wrap = h('label', { class: 'field select ' + (o.cls ?? ''), hint: o.hint }, h('span', { class: 'lbl' }, o.label), sel);
  bind(() => {
    const opts = o.options();
    const key = opts.map(([v, l]) => `${v}=${l}`).join('|');
    if (key !== lastKey) {
      lastKey = key;
      sel.replaceChildren(...opts.map(([v, l]) => h('option', { value: String(v) }, l)));
    }
    sel.value = String(o.get());
    sel.disabled = !!o.disabled?.();
  });
  return wrap;
}

export interface ToggleOpts {
  label: string;
  hint: string;
  get: () => boolean;
  set: (v: boolean) => void;
  testid?: string;
  cls?: string;
  disabled?: () => boolean;
}

export function toggle(o: ToggleOpts): HTMLButtonElement {
  const b = h('button', { class: 'toggle ' + (o.cls ?? ''), type: 'button', hint: o.hint, 'data-testid': o.testid, onclick: () => o.set(!o.get()) }, o.label);
  bind(() => {
    const on = o.get();
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
    b.disabled = !!o.disabled?.();
  });
  return b;
}

export function button(label: string, hint: string, onclick: (e: MouseEvent) => void, attrs: Record<string, unknown> = {}): HTMLButtonElement {
  return h('button', { type: 'button', hint, onclick, ...attrs }, label);
}

export interface StripOpts {
  label: string;
  hint: string;
  has: (i: number) => boolean;
  active?: (i: number) => boolean;
  recall: (i: number, e: MouseEvent) => void;
  store: (i: number) => void;
  remove: (i: number) => void;
  testid?: string;
}

/** A row of A-Z preset buttons: click recalls (or stores into an empty slot); Shift-click stores; Alt-click clears. */
export function presetStrip(o: StripOpts): HTMLElement {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const buttons = letters.map((L, i) =>
    h('button', {
      type: 'button',
      class: 'preset',
      'aria-label': `${o.label} ${L}`,
      onclick: (e: MouseEvent) => {
        if (e.altKey) o.remove(i);
        else if (e.shiftKey || !o.has(i)) o.store(i);
        else o.recall(i, e);
      },
    }, L),
  );
  const strip = h('div', { class: 'strip', hint: o.hint, 'data-testid': o.testid, role: 'group', 'aria-label': o.label }, h('span', { class: 'lbl' }, o.label), ...buttons);
  bind(() => {
    buttons.forEach((b, i) => {
      b.classList.toggle('used', o.has(i));
      b.classList.toggle('active', !!o.active?.(i));
    });
  });
  return strip;
}

export function panel(area: string, title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'panel', 'data-area': area, 'aria-label': title }, h('h2', { class: 'ptitle' }, title), ...children);
}

export function group(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('div', { class: 'group' }, h('h3', {}, title), ...children);
}
