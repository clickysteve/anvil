/**
 * Sample-transformation settings: a non-destructive recipe applied to a sample's audio before
 * it is played (time-stretch, varispeed pitch, reverse, drive, crunch), rendered by Good Bits'
 * STRETCH FX chain. The original sample is kept; only these settings are stored, and the
 * processed audio is recomputed (and cached) when needed.
 */
import { CHARACTERS, GROUPS, MACROS } from '../vendor/goodbits/js/dsp/stretch/index.js';
import type { FxRecipe } from '../vendor/goodbits/js/stretch-fx/render.js';

export type ReverseMode = 'none' | 'pre' | 'post';

export interface SampleTransform {
  enabled: boolean;
  /** reverse before or after the stretch */
  reverse: ReverseMode;
  /** varispeed pitch in semitones (duration changes with it), -24..24 */
  pitch: number;
  /** a Good Bits stretch character key (clean, vintage, cyclic, tape, grain...) */
  character: string;
  /** time-stretch ratio, output length / input length, 0.25..8 (1 = no stretch) */
  ratio: number;
  /** the character's macro sliders, 0..100 (50 = the character's own settings) */
  macros: Record<string, number>;
  drive: { enabled: boolean; type: string; amountPct: number };
  crunch: { enabled: boolean; bits: number; rateDivide: number };
  /** seeds the random engines (granular, repeat, spectral) */
  seed: number;
}

export function identityTransform(): SampleTransform {
  return {
    enabled: false,
    reverse: 'none',
    pitch: 0,
    character: 'clean',
    ratio: 1,
    macros: {},
    drive: { enabled: false, type: 'tape', amountPct: 30 },
    crunch: { enabled: false, bits: 12, rateDivide: 1 },
    seed: 1,
  };
}

/** True when applying the transform would do nothing (so the original audio is used as is). */
export function isIdentity(t: SampleTransform): boolean {
  return !t.enabled;
}

/** The STRETCH FX recipe for these settings (one stretch pass, or none at ratio 1). */
export function toRecipe(t: SampleTransform): FxRecipe {
  const usedMacros = CHARACTERS[t.character]?.macros ?? [];
  const macroValues: Record<string, number> = {};
  for (const k of usedMacros) if (typeof t.macros[k] === 'number') macroValues[k] = t.macros[k];
  return {
    seed: t.seed >>> 0,
    pitch: t.pitch,
    reverse: t.reverse === 'none' ? null : t.reverse,
    passes: Math.abs(t.ratio - 1) < 1e-6 ? [] : [{ character: t.character, ratio: t.ratio, macroValues }],
    drive: t.drive.enabled && t.drive.amountPct > 0 ? { type: t.drive.type, amount: t.drive.amountPct } : null,
    crunch: t.crunch.enabled ? { bits: t.crunch.bits, rateDivide: t.crunch.rateDivide } : null,
  };
}

/** A stable cache key for the transform's audible settings. */
export function transformKey(t: SampleTransform): string {
  return isIdentity(t) ? 'identity' : JSON.stringify(toRecipe(t));
}

/** Characters in Good Bits' display groups (generic names, as Good Bits shows them). */
export function stretchCharacters(): { group: string; label: string; characters: { key: string; label: string; macros: string[] }[] }[] {
  return GROUPS.map((g) => ({
    group: g.key,
    label: g.label,
    characters: Object.entries(CHARACTERS)
      .filter(([, c]) => c.group === g.key)
      .map(([key, c]) => ({ key, label: c.label, macros: c.macros ?? [] })),
  }));
}

export const MACRO_INFO = MACROS;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, def: number, int = false) => {
  let x = typeof v === 'number' && Number.isFinite(v) ? v : def;
  if (int) x = Math.round(x);
  return Math.max(lo, Math.min(hi, x));
};

export function repairTransform(src: unknown): SampleTransform {
  const d = identityTransform();
  const o = isObj(src) ? src : {};
  const dr = isObj(o.drive) ? o.drive : {};
  const cr = isObj(o.crunch) ? o.crunch : {};
  const macros: Record<string, number> = {};
  if (isObj(o.macros)) for (const [k, v] of Object.entries(o.macros)) if (k in MACROS && typeof v === 'number' && Number.isFinite(v)) macros[k] = Math.max(0, Math.min(100, v));
  return {
    enabled: o.enabled === true,
    reverse: o.reverse === 'pre' || o.reverse === 'post' ? o.reverse : 'none',
    pitch: num(o.pitch, -24, 24, 0),
    character: typeof o.character === 'string' && o.character in CHARACTERS ? o.character : d.character,
    ratio: num(o.ratio, 0.25, 8, 1),
    macros,
    drive: { enabled: dr.enabled === true, type: ['tape', 'tube', 'diode', 'fuzz'].includes(dr.type as string) ? (dr.type as string) : 'tape', amountPct: num(dr.amountPct, 0, 100, 30) },
    crunch: { enabled: cr.enabled === true, bits: num(cr.bits, 1, 16, 12, true), rateDivide: num(cr.rateDivide, 1, 32, 1, true) },
    seed: num(o.seed, 0, 0xffffffff, 1, true),
  };
}
