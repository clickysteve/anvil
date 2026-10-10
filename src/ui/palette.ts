/**
 * Colour palettes: a purely visual layer, never part of a project.
 *
 * The interface draws with CSS custom properties for a small set of semantic roles. Each
 * functional area (constraints, bank, tonality, voices, ...) redefines --ink for its own panel,
 * so an area can carry its own colour while staying coherent inside. This follows the same
 * semantic-role approach and the same built-in palette names (Classic, Dark, Colour) as the
 * other instruments in the collection; the implementation here is ANVIL's own.
 */

export const ROLES = [
  'desktop', 'paper', 'ink', 'dim',
  'constraints', 'bank', 'tonality', 'voices', 'arranger', 'midi', 'transport', 'extended',
  'activity', 'selection',
] as const;
export type Role = (typeof ROLES)[number];
export type Colors = Record<Role, string>;

export const ROLE_INFO: Record<Role, string> = {
  desktop: 'Background behind the panels',
  paper: 'Panel background',
  ink: 'Frames, text and drawing',
  dim: 'Guides, small labels, disabled items',
  constraints: 'Theme parameters panel',
  bank: 'Themes & variations and the theme view',
  tonality: 'Scale, mode, key, octave and weights',
  voices: 'Accompaniment voices',
  arranger: 'Arranger',
  midi: 'MIDI, clock and monitor',
  transport: 'Transport bar',
  extended: 'Extended tools',
  activity: 'Playhead, playing marks, running state',
  selection: 'Selected event, focus and highlights',
};

export type Area = Exclude<Role, 'desktop' | 'paper' | 'ink' | 'dim' | 'activity' | 'selection'>;
export const AREAS: Area[] = ['constraints', 'bank', 'tonality', 'voices', 'arranger', 'midi', 'transport', 'extended'];

export interface Palette {
  id: string;
  name: string;
  builtIn: boolean;
  colors: Colors;
}

const fill = (c: string, extra: Partial<Colors> = {}): Colors => ({ ...(Object.fromEntries(ROLES.map((r) => [r, c])) as Colors), ...extra });

export const BUILT_INS: Palette[] = [
  { id: 'classic', name: 'Classic', builtIn: true, colors: fill('#000000', { paper: '#ffffff' }) },
  {
    id: 'dark',
    name: 'Dark',
    builtIn: true,
    colors: fill('#d9d4c7', { desktop: '#000000', paper: '#17191c', dim: '#8a857a', activity: '#e3b65c', selection: '#7fa7d1' }),
  },
  {
    id: 'colour',
    name: 'Colour',
    builtIn: true,
    colors: {
      desktop: '#23303a',
      paper: '#fbf8ef',
      ink: '#202020',
      dim: '#8c8576',
      constraints: '#1d6a86',
      bank: '#8a2f5e',
      tonality: '#2c7149',
      voices: '#7a3e2b',
      arranger: '#7d6208',
      midi: '#4e44a0',
      transport: '#a94f12',
      extended: '#8d2fa3',
      activity: '#d0372a',
      selection: '#2b78c9',
    },
  },
];
export const DEFAULT_PALETTE = 'classic';

export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}

function channels(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Minimum contrast against the paper for each role drawn on it. */
const NEEDS: Partial<Record<Role, number>> = { ink: 4.5, dim: 2, activity: 2.5, selection: 2.5 };
for (const a of AREAS) NEEDS[a] = 3;

export function contrastWarnings(c: Colors): { role: Role; ratio: number }[] {
  const out: { role: Role; ratio: number }[] = [];
  for (const r of ROLES) {
    const need = NEEDS[r];
    if (need === undefined) continue;
    const ratio = contrast(c[r], c.paper);
    if (ratio < need) out.push({ role: r, ratio });
  }
  return out;
}

const decl = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

/** The style sheet for a palette. */
export function paletteCss(c: Colors): string {
  let css = `:root{${decl({
    '--desktop': c.desktop,
    '--paper': c.paper,
    '--ink': c.ink,
    '--base-ink': c.ink,
    '--dim': c.dim,
    '--activity': c.activity,
    '--selection': c.selection,
  })}}\n`;
  for (const a of AREAS) css += `[data-area="${a}"]{--ink:${c[a]}}\n`;
  return css;
}

export function applyPalette(c: Colors, doc: Document = document): void {
  let el = doc.getElementById('anvil-palette') as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = 'anvil-palette';
    doc.head.appendChild(el);
  }
  el.textContent = paletteCss(c);
  doc.documentElement.dataset.palette = isMono(c) ? 'mono' : 'colour';
}

/** Two-colour palettes (every role is ink or paper) get dithered fills instead of tints. */
export function isMono(c: Colors): boolean {
  return ROLES.every((r) => c[r] === c.ink || c[r] === c.paper || r === 'desktop');
}

// ------------------------------------------------------------------ preferences

export interface PaletteStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY_CUSTOM = 'anvil.palettes';

export class PaletteLibrary {
  custom: Palette[] = [];
  constructor(private store: PaletteStore | null) {
    try {
      const raw = store?.getItem(KEY_CUSTOM);
      const list = raw ? JSON.parse(raw) : [];
      for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.colors !== 'object') continue;
        const base = BUILT_INS[0].colors;
        const colors = Object.fromEntries(ROLES.map((r) => [r, normHex(item.colors[r]) ?? base[r]])) as Colors;
        this.custom.push({ id: item.id, name: String(item.name).slice(0, 40), builtIn: false, colors });
      }
    } catch {
      this.custom = [];
    }
  }

  private save(): void {
    try {
      this.store?.setItem(KEY_CUSTOM, JSON.stringify(this.custom.map(({ id, name, colors }) => ({ id, name, colors }))));
    } catch {
      /* storage blocked */
    }
  }

  all(): Palette[] {
    return [...BUILT_INS, ...this.custom];
  }

  find(id: string): Palette {
    return this.all().find((p) => p.id === id) ?? BUILT_INS[0];
  }

  /** Editing a built-in makes a custom copy; returns the palette that was changed. */
  setColor(id: string, role: Role, value: string): Palette {
    const hex = normHex(value);
    let p = this.find(id);
    if (!hex) return p;
    if (p.builtIn) {
      let n = 1;
      while (this.all().some((x) => x.id === `custom-${n}`)) n++;
      p = { id: `custom-${n}`, name: `${p.name} (custom ${n})`, builtIn: false, colors: { ...p.colors } };
      this.custom.push(p);
    }
    p.colors[role] = hex;
    this.save();
    return p;
  }

  remove(id: string): void {
    this.custom = this.custom.filter((p) => p.id !== id);
    this.save();
  }
}
