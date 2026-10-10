/**
 * ANVIL's own default values. None of these are taken from historical presets or files.
 */
import { CURRENT_ALGORITHMS } from './algorithms';
import { defaultUserScale } from './tonality';
import type { Options, Project, TVParams, Voice } from './types';

export const FORMAT = 'anvil-project';
export const FORMAT_VERSION = 1;

export function defaultParams(): TVParams {
  return {
    microbeat: 6,
    length: 32,
    pulse: 2,
    rest: 10,
    rhythmAlg: 1,
    rhythmVariant: 3,
    firstNote: 1,
    pitchLoop: 99,
    low: 35, // C4
    high: 46, // G5
    maxStep: 2,
    maxLeap: 4,
    maxRepeats: 2,
    onbeatTable: 1,
    offbeatTable: 2,
    rhythmVarAlg: 1,
    pitchVarAlg: 1,
    varVariant: 4,
  };
}

/** Eight scale-weight tables (ANVIL's own starting points; all editable). */
export function defaultWeights(): number[][] {
  return [
    [8, 1, 6, 2, 7, 2, 1], // 1 chord tones
    [4, 4, 4, 4, 4, 4, 4], // 2 even
    [8, 0, 6, 0, 7, 0, 0], // 3 triad only
    [6, 5, 5, 0, 6, 5, 0], // 4 pentatonic
    [3, 6, 3, 6, 3, 6, 4], // 5 passing tones
    [8, 2, 2, 2, 4, 2, 2], // 6 tonic centred
    [6, 4, 0, 6, 6, 0, 3], // 7 open fourths
    [4, 2, 4, 2, 4, 2, 6], // 8 leading tone
  ];
}

/** Seven drum notes (General MIDI numbering; 0 = off). */
export function defaultDrums(): number[] {
  return [36, 38, 42, 46, 45, 50, 49];
}

export function defaultVoice(i: number): Voice {
  return {
    channel: i + 1,
    program: 0,
    octave: i === 1 ? -1 : 0,
    velocity: 96,
    accent: 16,
    mute: i !== 0,
    solo: false,
    art: i === 0 ? 4 : 1,
    delay: 0,
    rhythm: 1,
    divide: 1,
    harmony: 1,
    tran: 1,
    locked: false,
  };
}

export function defaultVoices(): Voice[] {
  return Array.from({ length: 6 }, (_, i) => defaultVoice(i));
}

export function defaultOptions(): Options {
  return {
    themeAlign: 'theme',
    tonalityAlign: 'mbeat',
    presetAlign: 'mbeat',
    feel: false,
    sendProgramsAtStart: false,
    arrangerLoop: true,
  };
}

export function newProject(seed: number, name = 'Untitled'): Project {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    name,
    mode: 'classic',
    algorithms: { ...CURRENT_ALGORITHMS },
    seed: seed >>> 0,
    generation: 0,
    tempo: 120,
    params: defaultParams(),
    tvPresets: Array.from({ length: 26 }, () => null),
    bank: {},
    selected: 'TA',
    tonality: { scale: 0, mode: 1, key: 0, octave: 0 },
    userScales: Array.from({ length: 8 }, () => defaultUserScale()),
    weights: defaultWeights(),
    drums: defaultDrums(),
    voices: defaultVoices(),
    accPresets: Array.from({ length: 26 }, () => null),
    options: defaultOptions(),
    arranger: { steps: [], enable: { theme: true, preset: true, mode: true, scale: true, keyOctave: true } },
    extended: { locks: {}, mutationDepth: 30, preserveContour: false },
    notes: '',
  };
}
