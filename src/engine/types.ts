/**
 * ANVIL's data model. Everything here is plain JSON-compatible data so a project can be
 * inspected, saved, compared, exported and migrated without hidden state.
 *
 * Time units:
 *   clock      one MIDI clock, 1/24 of a quarter note. ANVIL's tick IS the MIDI clock.
 *   microbeat  a theme's smallest rhythmic unit, a whole number of clocks (Theme.microbeat).
 *
 * Pitch units:
 *   degree     an index into the active 70-entry scale (10 octaves x 7 positions).
 *              Degree 35 is position 1 of octave 5, which ANVIL names "C4" (MIDI 60 in
 *              C major, mode 1, key C, octave 0). Names are only exact for that tonality.
 */

/** Accent level of a theme event: 1 accented, 0 normal, -1 de-accented. */
export type Accent = 1 | 0 | -1;

export interface ThemeEvent {
  /** start, in microbeats from the beginning of the theme */
  start: number;
  /** length in microbeats (>= 1) */
  len: number;
  rest: boolean;
  accent: Accent;
  /** scale degree (0..69); ignored for rests (kept as -1) */
  degree: number;
}

/** A microrhythm segment of a theme (used by rhythm variations). */
export interface Cell {
  start: number;
  len: number;
}

export const THEME_IDS = ['TA', 'TB', 'TC', 'TD', 'TE'] as const;
export const ITEM_IDS = [
  'TA', 'VA1', 'VA2', 'VA3',
  'TB', 'VB1', 'VB2', 'VB3',
  'TC', 'VC1', 'VC2', 'VC3',
  'TD', 'VD1', 'VD2', 'VD3',
  'TE', 'VE1', 'VE2', 'VE3',
] as const;
export type ItemId = (typeof ITEM_IDS)[number];

/** Where a theme or variation came from (ancestry). */
export interface Origin {
  kind: 'generated' | 'variation' | 'copy' | 'edited' | 'regenerated' | 'mutated' | 'imported';
  /** the item it was derived from, if any */
  from?: ItemId;
  /** short human-readable note, e.g. "pitch var 2, V4" */
  note?: string;
  /** the origin it replaced, for edit chains (one level only, to stay small) */
  parent?: Omit<Origin, 'parent'>;
}

/** The parameters that shape a theme or variation (ANVIL's "theme & variation" set). */
export interface TVParams {
  // rhythm
  microbeat: number; // clocks per microbeat, 1..96
  length: number; // microbeats, 1..256
  pulse: number; // microbeats, 1..16
  rest: number; // rest probability 0..99
  rhythmAlg: number; // 1..6
  rhythmVariant: number; // 1..16
  // pitch
  firstNote: number; // 0 = free, 1..7 = scale position
  pitchLoop: number; // 1..99, 99 = no loop
  low: number; // degree
  high: number; // degree
  maxStep: number; // degrees, >= 1
  maxLeap: number; // degrees, >= 1
  maxRepeats: number; // >= 1
  onbeatTable: number; // 1..8
  offbeatTable: number; // 1..8
  // variation
  rhythmVarAlg: number; // 0..5
  pitchVarAlg: number; // 0..4
  varVariant: number; // 0..99 (0 = all, for pitch variations)
}

export interface Theme {
  id: ItemId;
  microbeat: number;
  pulse: number;
  /** total length in microbeats */
  length: number;
  events: ThemeEvent[];
  cells: Cell[];
  /** the seed that produced this item (regenerating with it reproduces it) */
  seed: number;
  /** the parameter set it was generated with */
  params: TVParams;
  /** algorithm version ids used to generate it */
  algorithms: string[];
  origin: Origin;
}

export interface Tonality {
  /** 0..37 preset scales, 38..45 user scales */
  scale: number;
  /** 1..7 */
  mode: number;
  /** 0..11, C..B */
  key: number;
  /** -4..4 */
  octave: number;
}

/** Harmony numbers: 1..11 melodic, 12..16 drums D1..D5. */
export const HARMONY_DRUM_BASE = 12;
/** Divide value meaning "half" (each note twice at half value). */
export const DIVIDE_HALF = 0;

export interface Voice {
  channel: number; // 1..16
  program: number; // 0 = none, 1..128
  octave: number; // -4..4
  velocity: number; // 1..127
  accent: number; // -64..64
  mute: boolean;
  solo: boolean;
  art: number; // 1..8
  delay: number; // clocks, 0..96
  rhythm: number; // 1..12
  divide: number; // ..., 2, 1, 0 (= half), -1, -2, ...
  harmony: number; // 1..16
  tran: number; // 1..15
  /** voice lock-out: accompaniment preset recall leaves this voice alone */
  locked: boolean;
}

export type Align = 'mbeat' | 'pulse' | 'theme' | 'off';

export interface Options {
  themeAlign: Exclude<Align, 'off'>;
  tonalityAlign: Align;
  presetAlign: Align;
  feel: boolean;
  sendProgramsAtStart: boolean;
  arrangerLoop: boolean;
}

export interface ArrangerStep {
  item: ItemId | null;
  preset: number | null; // accompaniment preset 0..25
  scale: number | null;
  mode: number | null;
  key: number | null;
  octave: number | null;
  /** duration of this step in clocks */
  clocks: number;
}

export interface Arranger {
  steps: ArrangerStep[];
  enable: { theme: boolean; preset: boolean; mode: boolean; scale: boolean; keyOctave: boolean };
}

export type Mode = 'classic' | 'extended';

/** Extended-mode data. Inert in Classic mode, but kept so switching modes loses nothing. */
export interface ExtendedState {
  /** locked event indices per item (motif locking) */
  locks: Partial<Record<ItemId, number[]>>;
  /** mutation depth for the Mutate action, 0..100 % */
  mutationDepth: number;
  /** keep the melodic contour when regenerating pitches */
  preserveContour: boolean;
}

/** Audio settings (format 2): sample slots, voice sources, output processors. See audio/settings.ts. */
export type { ProjectAudio } from '../audio/settings';
import type { ProjectAudio } from '../audio/settings';

export interface Project {
  format: 'anvil-project';
  version: number;
  name: string;
  mode: Mode;
  /** algorithm version id per algorithm role; see engine/algorithms.ts */
  algorithms: Record<string, string>;
  /** master seed; generation seeds are derived from it and a counter */
  seed: number;
  generation: number;
  tempo: number;
  params: TVParams;
  tvPresets: (TVParams | null)[];
  bank: Partial<Record<ItemId, Theme>>;
  /** the item selected for playback */
  selected: ItemId;
  tonality: Tonality;
  /** 8 user scales x 70 MIDI note numbers (at key C, octave 0) */
  userScales: number[][];
  /** 8 scale-weight tables x 7 positions, weights 0..8 */
  weights: number[][];
  /** 7 drum notes (0 = off) */
  drums: number[];
  voices: Voice[];
  accPresets: (Voice[] | null)[];
  options: Options;
  arranger: Arranger;
  extended: ExtendedState;
  /** internal audio: sample slots, voice sources, output processing (format 2) */
  audio: ProjectAudio;
  notes: string;
}

export const PRESET_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
