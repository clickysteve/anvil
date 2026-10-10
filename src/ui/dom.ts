/** Tiny DOM helpers and the refresh registry used by the interface. */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; hint?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'hint') {
      el.dataset.hint = String(v);
      if (!el.title) el.title = String(v);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const SVGNS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Functions that bring a widget up to date with the session. Run after every change. */
const updaters = new Set<() => void>();

export function bind(fn: () => void): () => void {
  updaters.add(fn);
  fn();
  return () => updaters.delete(fn);
}

export function refreshAll(): void {
  for (const fn of updaters) fn();
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** True when the keyboard focus is in a text field (so global shortcuts stay out of the way). */
export function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color'].includes((a as HTMLInputElement).type)) || a.isContentEditable;
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
