/**
 * The ANVIL project file format: versioned JSON.
 *
 *   { "format": "anvil-project", "version": 2, ... }
 *
 * Version 2 added `audio` (sample slots, voice sources, output processing).
 *
 * Loading validates every field and repairs what it can (out-of-range numbers are clamped,
 * missing fields take defaults, damaged themes are dropped), reporting each repair as a
 * warning. Older versions pass through MIGRATIONS in order; files from a newer ANVIL are
 * refused rather than guessed at.
 */
import { repairAlgorithms } from '../engine/algorithms';
import { defaultDrums, defaultOptions, defaultParams, defaultVoice, defaultWeights, FORMAT, FORMAT_VERSION, newProject } from '../engine/defaults';
import { DEGREES, defaultUserScale, SCALE_COUNT } from '../engine/tonality';
import type { Accent, Align, ArrangerStep, Cell, ItemId, Origin, Project, Theme, ThemeEvent, TVParams, Voice } from '../engine/types';
import { ITEM_IDS } from '../engine/types';
import { defaultAudio, repairAudio } from '../audio/settings';

export class ProjectError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Migration from version n to n + 1, keyed by n. */
export type Migration = (o: Obj) => Obj;
export const MIGRATIONS: Record<number, Migration> = {
  // format 2 adds internal audio settings; every voice stays on the internal synth, every
  // processor CLEAN, every sample slot empty, so a format 1 project sounds exactly as before
  1: (o) => ({ ...o, version: 2, audio: defaultAudio() }),
};

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 1);
}

export interface LoadResult {
  project: Project;
  warnings: string[];
}

function num(src: unknown, lo: number, hi: number, def: number, warn: (s: string) => void, label: string, int = true): number {
  let v = typeof src === 'number' ? src : typeof src === 'string' && src.trim() !== '' ? Number(src) : NaN;
  if (!Number.isFinite(v)) {
    if (src !== undefined) warn(`${label} was not a number; set to ${def}.`);
    return def;
  }
  if (int) v = Math.round(v);
  if (v < lo || v > hi) {
    const c = Math.max(lo, Math.min(hi, v));
    warn(`${label} ${v} was out of range; set to ${c}.`);
    return c;
  }
  return v;
}

const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

export function repairParams(src: unknown, warn: (s: string) => void, label = 'Parameter'): TVParams {
  const d = defaultParams();
  const o = isObj(src) ? src : {};
  const n = (k: keyof TVParams, lo: number, hi: number) => num(o[k], lo, hi, d[k], warn, `${label} ${k}`);
  return {
    microbeat: n('microbeat', 1, 96),
    length: n('length', 1, 256),
    pulse: n('pulse', 1, 16),
    rest: n('rest', 0, 99),
    rhythmAlg: n('rhythmAlg', 1, 6),
    rhythmVariant: n('rhythmVariant', 1, 16),
    firstNote: n('firstNote', 0, 7),
    pitchLoop: n('pitchLoop', 1, 99),
    low: n('low', 0, DEGREES - 1),
    high: n('high', 0, DEGREES - 1),
    maxStep: n('maxStep', 1, 69),
    maxLeap: n('maxLeap', 1, 69),
    maxRepeats: n('maxRepeats', 1, 99),
    onbeatTable: n('onbeatTable', 1, 8),
    offbeatTable: n('offbeatTable', 1, 8),
    rhythmVarAlg: n('rhythmVarAlg', 0, 5),
    pitchVarAlg: n('pitchVarAlg', 0, 4),
    varVariant: n('varVariant', 0, 99),
  };
}

export function repairVoice(src: unknown, i: number, warn: (s: string) => void): Voice {
  const d = defaultVoice(i);
  const o = isObj(src) ? src : {};
  const label = `Voice ${i + 1}`;
  const n = (k: keyof Voice, lo: number, hi: number) => num(o[k], lo, hi, d[k] as number, warn, `${label} ${k}`);
  return {
    channel: n('channel', 1, 16),
    program: n('program', 0, 128),
    octave: n('octave', -4, 4),
    velocity: n('velocity', 1, 127),
    accent: n('accent', -64, 64),
    mute: bool(o.mute, d.mute),
    solo: bool(o.solo, d.solo),
    art: n('art', 1, 8),
    delay: n('delay', 0, 96),
    rhythm: n('rhythm', 1, 12),
    divide: n('divide', -16, 16),
    harmony: n('harmony', 1, 16),
    tran: n('tran', 1, 15),
    locked: bool(o.locked, d.locked),
  };
}

function repairVoices(src: unknown, warn: (s: string) => void): Voice[] {
  const a = Array.isArray(src) ? src : [];
  if (src !== undefined && a.length !== 6) warn('The voice list was incomplete; missing voices use defaults.');
  return Array.from({ length: 6 }, (_, i) => repairVoice(a[i], i, warn));
}

function repairOrigin(src: unknown): Origin {
  const kinds: Origin['kind'][] = ['generated', 'variation', 'copy', 'edited', 'regenerated', 'mutated', 'imported'];
  const o = isObj(src) ? src : {};
  const kind = kinds.includes(o.kind as Origin['kind']) ? (o.kind as Origin['kind']) : 'generated';
  const out: Origin = { kind };
  if (typeof o.from === 'string' && (ITEM_IDS as readonly string[]).includes(o.from)) out.from = o.from as ItemId;
  if (typeof o.note === 'string') out.note = o.note.slice(0, 200);
  if (isObj(o.parent)) {
    const p = repairOrigin({ ...o.parent, parent: undefined });
    out.parent = p;
  }
  return out;
}

/** Validate a theme; returns null (with a warning) when it cannot be repaired. */
export function repairTheme(src: unknown, id: ItemId, warn: (s: string) => void): Theme | null {
  if (!isObj(src)) {
    warn(`${id} was not a theme and was removed.`);
    return null;
  }
  const quiet = () => {};
  const evs = Array.isArray(src.events) ? src.events : null;
  if (!evs || !evs.length) {
    warn(`${id} had no events and was removed.`);
    return null;
  }
  const events: ThemeEvent[] = [];
  let pos = 0;
  for (const e of evs) {
    if (!isObj(e)) {
      warn(`${id} had a damaged event and was removed.`);
      return null;
    }
    const len = num(e.len, 1, 4096, 1, quiet, 'len');
    const rest = e.rest === true;
    const accent = (e.accent === 1 || e.accent === 0 || e.accent === -1 ? e.accent : 0) as Accent;
    const degree = rest ? -1 : num(e.degree, 0, DEGREES - 1, 35, quiet, 'degree');
    events.push({ start: pos, len, rest, accent: rest ? -1 : accent, degree });
    pos += len;
  }
  if (events.length > 99) warn(`${id} has more than 99 events (allowed, but longer than the classic limit).`);
  if (!events.some((e) => !e.rest)) {
    warn(`${id} had no notes and was removed.`);
    return null;
  }
  const length = pos;
  let cells: Cell[] = [];
  if (Array.isArray(src.cells)) {
    let s = 0;
    for (const c of src.cells) {
      if (!isObj(c)) break;
      const len = num(c.len, 1, length, 1, quiet, 'cell');
      if (num(c.start, 0, length, -1, quiet, 'cell') !== s || s + len > length) break;
      cells.push({ start: s, len });
      s += len;
    }
    if (s !== length) cells = [];
  }
  if (!cells.length) cells = [{ start: 0, len: length }];
  return {
    id,
    microbeat: num(src.microbeat, 1, 96, 6, warn, `${id} microbeat`),
    pulse: num(src.pulse, 1, 16, 2, warn, `${id} pulse`),
    length,
    events,
    cells,
    seed: num(src.seed, 0, 0xffffffff, 0, quiet, 'seed'),
    params: repairParams(src.params, quiet),
    algorithms: Array.isArray(src.algorithms) ? src.algorithms.filter((a): a is string => typeof a === 'string') : [],
    origin: repairOrigin(src.origin),
  };
}

function repairWeights(src: unknown, warn: (s: string) => void): number[][] {
  const d = defaultWeights();
  const a = Array.isArray(src) ? src : [];
  return d.map((def, i) => {
    const row = Array.isArray(a[i]) ? (a[i] as unknown[]) : null;
    if (!row) return def;
    const r = def.map((w, j) => num(row[j], 0, 8, w, () => {}, 'weight'));
    if (!r.some((w) => w > 0)) {
      warn(`Scale-weight table ${i + 1} was all zero; restored.`);
      return def;
    }
    return r;
  });
}

function repairUserScales(src: unknown): number[][] {
  const a = Array.isArray(src) ? src : [];
  return Array.from({ length: 8 }, (_, i) => {
    const s = a[i];
    if (Array.isArray(s) && s.length === DEGREES && s.every((n) => Number.isInteger(n) && n >= 0 && n <= 127)) return [...(s as number[])];
    return defaultUserScale();
  });
}

const ALIGNS: Align[] = ['mbeat', 'pulse', 'theme', 'off'];

function repairStep(src: unknown): ArrangerStep | null {
  if (!isObj(src)) return null;
  const q = () => {};
  const opt = (v: unknown, lo: number, hi: number) => (v === null || v === undefined ? null : num(v, lo, hi, lo, q, 'step'));
  return {
    item: typeof src.item === 'string' && (ITEM_IDS as readonly string[]).includes(src.item) ? (src.item as ItemId) : null,
    preset: opt(src.preset, 0, 25),
    scale: opt(src.scale, 0, SCALE_COUNT - 1),
    mode: opt(src.mode, 1, 7),
    key: opt(src.key, 0, 11),
    octave: opt(src.octave, -4, 4),
    clocks: num(src.clocks, 1, 1_000_000, 192, q, 'step'),
  };
}

/** Parse, migrate, validate and repair a project file. */
export function parseProject(text: string, migrations: Record<number, Migration> = MIGRATIONS, current = FORMAT_VERSION): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectError('The file is not valid JSON.');
  }
  return loadProject(raw, migrations, current);
}

export function loadProject(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS, current = FORMAT_VERSION): LoadResult {
  if (!isObj(raw) || (raw.format !== undefined && raw.format !== FORMAT)) throw new ProjectError('This is not an ANVIL project file.');
  let o: Obj = raw;
  let version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) throw new ProjectError('The project has no valid format version.');
  if (version > current) throw new ProjectError(`This project was saved by a newer ANVIL (format ${version}); this version reads up to format ${current}.`);
  const warnings: string[] = [];
  while (version < current) {
    const m = migrations[version];
    if (!m) throw new ProjectError(`No migration from format ${version}.`);
    o = m(structuredClone(o));
    version++;
    warnings.push(`Upgraded from format ${version - 1} to ${version}.`);
  }
  const warn = (s: string) => warnings.push(s);
  const base = newProject(num(o.seed, 0, 0xffffffff, 1, warn, 'Seed'));
  const p: Project = base;
  p.version = current;
  p.name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'Untitled';
  p.mode = o.mode === 'extended' ? 'extended' : 'classic';
  const alg = repairAlgorithms(o.algorithms);
  p.algorithms = alg.table;
  warnings.push(...alg.warnings);
  p.generation = num(o.generation, 0, 1e9, 0, warn, 'Generation counter');
  p.tempo = num(o.tempo, 20, 400, 120, warn, 'Tempo', false);
  p.params = repairParams(o.params, warn);
  const tvp = Array.isArray(o.tvPresets) ? o.tvPresets : [];
  p.tvPresets = Array.from({ length: 26 }, (_, i) => (isObj(tvp[i]) ? repairParams(tvp[i], () => {}) : null));
  p.bank = {};
  if (isObj(o.bank)) {
    for (const [k, v] of Object.entries(o.bank)) {
      if (!(ITEM_IDS as readonly string[]).includes(k)) {
        warn(`Unknown bank slot "${k}" ignored.`);
        continue;
      }
      const t = repairTheme(v, k as ItemId, warn);
      if (t) p.bank[k as ItemId] = t;
    }
  }
  p.selected = typeof o.selected === 'string' && (ITEM_IDS as readonly string[]).includes(o.selected) ? (o.selected as ItemId) : 'TA';
  const t = isObj(o.tonality) ? o.tonality : {};
  p.tonality = {
    scale: num(t.scale, 0, SCALE_COUNT - 1, 0, warn, 'Scale'),
    mode: num(t.mode, 1, 7, 1, warn, 'Mode'),
    key: num(t.key, 0, 11, 0, warn, 'Key'),
    octave: num(t.octave, -4, 4, 0, warn, 'Octave'),
  };
  p.userScales = repairUserScales(o.userScales);
  p.weights = repairWeights(o.weights, warn);
  const dr = Array.isArray(o.drums) ? o.drums : [];
  p.drums = defaultDrums().map((d, i) => num(dr[i], 0, 127, d, warn, `Drum ${i + 1}`));
  p.voices = repairVoices(o.voices, warn);
  const ap = Array.isArray(o.accPresets) ? o.accPresets : [];
  p.accPresets = Array.from({ length: 26 }, (_, i) => (Array.isArray(ap[i]) ? repairVoices(ap[i], () => {}) : null));
  const op = isObj(o.options) ? o.options : {};
  const dop = defaultOptions();
  p.options = {
    themeAlign: (['mbeat', 'pulse', 'theme'] as const).includes(op.themeAlign as 'theme') ? (op.themeAlign as 'theme') : dop.themeAlign,
    tonalityAlign: ALIGNS.includes(op.tonalityAlign as Align) ? (op.tonalityAlign as Align) : dop.tonalityAlign,
    presetAlign: ALIGNS.includes(op.presetAlign as Align) ? (op.presetAlign as Align) : dop.presetAlign,
    feel: bool(op.feel, dop.feel),
    sendProgramsAtStart: bool(op.sendProgramsAtStart, dop.sendProgramsAtStart),
    arrangerLoop: bool(op.arrangerLoop, dop.arrangerLoop),
  };
  const ar = isObj(o.arranger) ? o.arranger : {};
  const steps = Array.isArray(ar.steps) ? ar.steps.map(repairStep).filter((s): s is ArrangerStep => !!s) : [];
  if (steps.length > 1000) warn('The arranger had more than 1000 steps; extra steps were dropped.');
  const en = isObj(ar.enable) ? ar.enable : {};
  p.arranger = {
    steps: steps.slice(0, 1000),
    enable: {
      theme: bool(en.theme, true),
      preset: bool(en.preset, true),
      mode: bool(en.mode, true),
      scale: bool(en.scale, true),
      keyOctave: bool(en.keyOctave, true),
    },
  };
  const ex = isObj(o.extended) ? o.extended : {};
  const locks: Project['extended']['locks'] = {};
  if (isObj(ex.locks)) {
    for (const [k, v] of Object.entries(ex.locks)) {
      if ((ITEM_IDS as readonly string[]).includes(k) && Array.isArray(v)) locks[k as ItemId] = v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 4096);
    }
  }
  p.extended = {
    locks,
    mutationDepth: num(ex.mutationDepth, 0, 100, 30, warn, 'Mutation depth'),
    preserveContour: bool(ex.preserveContour, false),
  };
  p.audio = repairAudio(o.audio, warn);
  p.notes = typeof o.notes === 'string' ? o.notes.slice(0, 20000) : '';
  return { project: p, warnings };
}

export function projectFileName(p: Project): string {
  const base = p.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'anvil-project';
  return `${base}.anvil.json`;
}
