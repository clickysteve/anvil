/**
 * Output-processor settings: what a voice or master processor does to audio as it plays.
 *
 * The stage layout is Good Bits' lo-fi chain (`applyLofiChain`: output stage, then drive, then
 * crunch) with the same field names, plus an input and output gain and an optional Tone stage
 * (Good Bits' one-pole low-pass). Plain JSON, safe to store in any application's project file.
 */
import { DRIVE_TYPES, OUTPUT_STAGES } from '../vendor/goodbits/js/outputstage.js';

export interface OutputStageSettings {
  enabled: boolean;
  /** a Good Bits output-stage mode key (cassette, reelToReel, damaged, vinyl, ...) */
  mode: string;
  mixPct: number;
  intensityPct: number;
}

export interface DriveSettings {
  enabled: boolean;
  /** tape | tube | diode | fuzz */
  type: string;
  amountPct: number;
}

export interface CrunchSettings {
  enabled: boolean;
  /** 1..16 (16 = no reduction) */
  bits: number;
  /** 1..32 (1 = no reduction): every n-th sample is held n samples */
  rateDivide: number;
}

export interface ToneSettings {
  enabled: boolean;
  /** one-pole low-pass cutoff, 200..20000 Hz */
  hz: number;
}

export interface OutputFxSettings {
  /** keep the settings but pass audio through unchanged */
  bypass: boolean;
  /** gain before the chain, dB (-24..24) */
  inDb: number;
  /** gain after the chain, dB (-24..24) */
  outDb: number;
  outputStage: OutputStageSettings;
  drive: DriveSettings;
  crunch: CrunchSettings;
  tone: ToneSettings;
}

export const OUTPUT_STAGE_MODES = OUTPUT_STAGES.filter((s) => s.key !== 'clean');
export const DRIVE_SHAPES = DRIVE_TYPES;

export function cleanFx(): OutputFxSettings {
  return {
    bypass: false,
    inDb: 0,
    outDb: 0,
    outputStage: { enabled: false, mode: 'cassette', mixPct: 100, intensityPct: 50 },
    drive: { enabled: false, type: 'tape', amountPct: 30 },
    crunch: { enabled: false, bits: 12, rateDivide: 2 },
    tone: { enabled: false, hz: 8000 },
  };
}

/** True when the processor leaves audio exactly as it is. */
export function isClean(s: OutputFxSettings): boolean {
  return s.bypass || (!s.outputStage.enabled && !s.drive.enabled && !s.crunch.enabled && !s.tone.enabled && s.inDb === 0 && s.outDb === 0);
}

/** Named starting points. Names describe what the settings do; none claims to model a machine. */
export interface FxPreset {
  key: string;
  label: string;
  description: string;
  apply(base: OutputFxSettings): OutputFxSettings;
}

const withStages = (patch: Partial<Pick<OutputFxSettings, 'outputStage' | 'drive' | 'crunch' | 'tone'>>) => (b: OutputFxSettings): OutputFxSettings => {
  const c = cleanFx();
  return {
    ...b,
    bypass: false,
    outputStage: { ...c.outputStage, enabled: false, ...patch.outputStage },
    drive: { ...c.drive, enabled: false, ...patch.drive },
    crunch: { ...c.crunch, enabled: false, ...patch.crunch },
    tone: { ...c.tone, enabled: false, ...patch.tone },
  };
};

export const FX_PRESETS: FxPreset[] = [
  { key: 'clean', label: 'CLEAN', description: 'No processing.', apply: () => cleanFx() },
  {
    key: '12bit',
    label: '12-BIT',
    description: 'Crunch to 12 bits with the rate held every 2 samples, a touch of tape drive, Tone at 10 kHz.',
    apply: withStages({ drive: { enabled: true, type: 'tape', amountPct: 15 }, crunch: { enabled: true, bits: 12, rateDivide: 2 }, tone: { enabled: true, hz: 10000 } }),
  },
  { key: 'bitcrush', label: 'BITCRUSH', description: 'Crunch to 8 bits, rate held every 4 samples.', apply: withStages({ crunch: { enabled: true, bits: 8, rateDivide: 4 } }) },
  { key: 'rate', label: 'RATE REDUCE', description: 'Sample-rate reduction only: every 6th sample held.', apply: withStages({ crunch: { enabled: true, bits: 16, rateDivide: 6 } }) },
  { key: 'drive', label: 'DRIVE', description: 'Tube drive at 40 %.', apply: withStages({ drive: { enabled: true, type: 'tube', amountPct: 40 } }) },
  { key: 'cassette', label: 'CASSETTE', description: 'Good Bits Cassette output stage.', apply: withStages({ outputStage: { enabled: true, mode: 'cassette', mixPct: 100, intensityPct: 60 } }) },
  { key: 'vinyl', label: 'VINYL', description: 'Good Bits Vinyl output stage.', apply: withStages({ outputStage: { enabled: true, mode: 'vinyl', mixPct: 100, intensityPct: 50 } }) },
  { key: 'radio', label: 'AM RADIO', description: 'Good Bits AM Radio output stage.', apply: withStages({ outputStage: { enabled: true, mode: 'amRadio', mixPct: 100, intensityPct: 70 } }) },
];

/** Which preset (if any) the settings currently match, for display. */
export function matchPreset(s: OutputFxSettings): string | null {
  const key = (x: OutputFxSettings) => JSON.stringify({ ...x, bypass: false });
  for (const p of FX_PRESETS) if (key(p.apply(s)) === key(s)) return p.key;
  return null;
}

/** A short status label, e.g. "CLEAN", "12-BIT", "CRUNCH+DRIVE", "BYPASS". */
export function fxLabel(s: OutputFxSettings): string {
  if (s.bypass) return 'BYPASS';
  const m = matchPreset(s);
  if (m) return FX_PRESETS.find((p) => p.key === m)!.label;
  const parts: string[] = [];
  if (s.outputStage.enabled) parts.push(OUTPUT_STAGES.find((x) => x.key === s.outputStage.mode)?.label.toUpperCase() ?? 'STAGE');
  if (s.drive.enabled) parts.push('DRIVE');
  if (s.crunch.enabled) parts.push(`${s.crunch.bits}BIT${s.crunch.rateDivide > 1 ? `/${s.crunch.rateDivide}` : ''}`);
  if (s.tone.enabled) parts.push('TONE');
  return parts.length ? parts.join('+') : s.inDb || s.outDb ? 'GAIN' : 'CLEAN';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, def: number, int = false) => {
  let x = typeof v === 'number' && Number.isFinite(v) ? v : def;
  if (int) x = Math.round(x);
  return Math.max(lo, Math.min(hi, x));
};
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

/** Validate stored settings, filling anything missing or out of range from the CLEAN defaults. */
export function repairFx(src: unknown): OutputFxSettings {
  const d = cleanFx();
  const o = isObj(src) ? src : {};
  const os = isObj(o.outputStage) ? o.outputStage : {};
  const dr = isObj(o.drive) ? o.drive : {};
  const cr = isObj(o.crunch) ? o.crunch : {};
  const to = isObj(o.tone) ? o.tone : {};
  const modes = OUTPUT_STAGE_MODES.map((m) => m.key);
  const drives = DRIVE_TYPES.map((m) => m.key);
  return {
    bypass: bool(o.bypass, d.bypass),
    inDb: num(o.inDb, -24, 24, d.inDb),
    outDb: num(o.outDb, -24, 24, d.outDb),
    outputStage: {
      enabled: bool(os.enabled, false),
      mode: typeof os.mode === 'string' && modes.includes(os.mode) ? os.mode : d.outputStage.mode,
      mixPct: num(os.mixPct, 0, 100, d.outputStage.mixPct),
      intensityPct: num(os.intensityPct, 0, 100, d.outputStage.intensityPct),
    },
    drive: {
      enabled: bool(dr.enabled, false),
      type: typeof dr.type === 'string' && drives.includes(dr.type) ? dr.type : d.drive.type,
      amountPct: num(dr.amountPct, 0, 100, d.drive.amountPct),
    },
    crunch: { enabled: bool(cr.enabled, false), bits: num(cr.bits, 1, 16, d.crunch.bits, true), rateDivide: num(cr.rateDivide, 1, 32, d.crunch.rateDivide, true) },
    tone: { enabled: bool(to.enabled, false), hz: num(to.hz, 200, 20000, d.tone.hz) },
  };
}
