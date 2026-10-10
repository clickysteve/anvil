/**
 * Demonstration projects. All ORIGINAL to ANVIL: made here from ANVIL's own parameters and
 * fixed seeds. None reproduces a historical preset, song or file.
 */
import { newProject } from '../engine/defaults';
import { deriveSeed } from '../engine/rng';
import { generateTheme, generateVariation, rowTheme } from '../engine/theme';
import type { ItemId, Project, TVParams } from '../engine/types';

export interface Demo {
  id: string;
  name: string;
  description: string;
  /** suggested app setting: send MIDI clock (the Hermod+ demo) */
  clockOut?: boolean;
  build(): Project;
}

function gen(p: Project, id: ItemId, over: Partial<TVParams> = {}): void {
  const params = { ...p.params, ...over };
  const seed = deriveSeed(p.seed, p.generation++);
  if (id[0] === 'T') p.bank[id] = generateTheme(id, params, p.weights, seed);
  else {
    const src = p.bank[rowTheme(id)];
    if (src) p.bank[id] = generateVariation(id, src, params, p.weights, seed);
  }
}

const tag = 'Original ANVIL demo.';

export const DEMOS: Demo[] = [
  {
    id: 'simple',
    name: 'Simple theme',
    description: 'One looping Single A theme on voice 1. Click a slot to hear another theme; press G to make a new one.',
    build() {
      const p = newProject(0x51a9e1, 'Demo: Simple theme');
      p.params = { ...p.params, rhythmAlg: 3, rhythmVariant: 4, rest: 5, pulse: 2, low: 35, high: 44, maxStep: 2, maxLeap: 3 };
      p.voices[0] = { ...p.voices[0], art: 4, velocity: 92, accent: 18 };
      for (const id of ['TA', 'TB', 'TC'] as ItemId[]) gen(p, id);
      p.notes = `${tag} A plain starting point: voice 1 plays the theme alone.`;
      return p;
    },
  },
  {
    id: 'rhythmic',
    name: 'Rhythmic variation',
    description: 'A Second Order theme and three rhythm variations (replace, swap, halve), chained by the arranger.',
    build() {
      const p = newProject(0x7e47a2, 'Demo: Rhythmic variation');
      p.params = { ...p.params, rhythmAlg: 1, rhythmVariant: 4, rest: 15, pulse: 2, length: 32 };
      gen(p, 'TA');
      gen(p, 'VA1', { rhythmVarAlg: 1, pitchVarAlg: 0 });
      gen(p, 'VA2', { rhythmVarAlg: 2, pitchVarAlg: 0 });
      gen(p, 'VA3', { rhythmVarAlg: 3, pitchVarAlg: 0 });
      p.voices[1] = { ...p.voices[1], mute: false, rhythm: 3, harmony: 7, tran: 1, octave: -1, art: 1, channel: 2 };
      const step = (item: ItemId, clocks: number) => ({ item, preset: null, scale: null, mode: null, key: null, octave: null, clocks });
      p.arranger.steps = [step('TA', 384), step('VA1', 384), step('VA2', 384), step('VA3', 192), step('VA3', 192)];
      p.notes = `${tag} Press Play Arranger to hear the theme and its variations in turn.`;
      return p;
    },
  },
  {
    id: 'pitch',
    name: 'Pitch-constrained',
    description: 'A narrow range, small steps and a pentatonic weight table: gentle, stepwise melodies.',
    build() {
      const p = newProject(0x9c3d11, 'Demo: Pitch-constrained');
      p.params = { ...p.params, rhythmAlg: 2, rhythmVariant: 3, rest: 10, low: 35, high: 40, maxStep: 1, maxLeap: 2, maxRepeats: 2, onbeatTable: 4, offbeatTable: 4, firstNote: 1 };
      p.tonality = { scale: 0, mode: 6, key: 9, octave: 0 };
      for (const id of ['TA', 'TB'] as ItemId[]) gen(p, id);
      gen(p, 'VA1', { rhythmVarAlg: 0, pitchVarAlg: 3, varVariant: 0 });
      gen(p, 'VA2', { rhythmVarAlg: 0, pitchVarAlg: 2, varVariant: 6 });
      p.voices[0] = { ...p.voices[0], art: 8, accent: 10 };
      p.notes = `${tag} VA1 reverses the theme's pitches; VA2 inverts its last six.`;
      return p;
    },
  },
  {
    id: 'sparse',
    name: 'Sparse',
    description: 'High rest probability, Single B rhythm and long legato: spacious, rest-heavy lines.',
    build() {
      const p = newProject(0x5a7e5e, 'Demo: Sparse');
      p.tempo = 84;
      p.params = { ...p.params, microbeat: 12, length: 24, rhythmAlg: 4, rhythmVariant: 3, rest: 60, pulse: 2, low: 31, high: 45, maxLeap: 5 };
      p.tonality = { scale: 2, mode: 1, key: 2, octave: 0 };
      for (const id of ['TA', 'TB', 'TC'] as ItemId[]) gen(p, id);
      p.voices[0] = { ...p.voices[0], art: 8, velocity: 80, accent: 20 };
      p.voices[1] = { ...p.voices[1], mute: false, rhythm: 2, harmony: 1, tran: 5, octave: -1, art: 8, channel: 2, velocity: 70 };
      p.notes = `${tag} Voice 2 plays only where the theme rests.`;
      return p;
    },
  },
  {
    id: 'accompaniment',
    name: 'Accompaniment',
    description: 'All six voices: theme, parallel thirds, bass on the pulse, arpeggio, offbeat chords and drums on channel 10.',
    build() {
      const p = newProject(0xacc0aa, 'Demo: Accompaniment');
      p.tempo = 112;
      p.params = { ...p.params, rhythmAlg: 1, rhythmVariant: 3, rest: 12, pulse: 2, low: 35, high: 46 };
      for (const id of ['TA', 'TB'] as ItemId[]) gen(p, id);
      gen(p, 'VA1', { rhythmVarAlg: 2, pitchVarAlg: 1, varVariant: 4 });
      const v = p.voices;
      v[0] = { ...v[0], channel: 1, art: 4, velocity: 96, accent: 16 };
      v[1] = { ...v[1], channel: 2, mute: false, rhythm: 5, harmony: 1, tran: 3, octave: 0, art: 4, velocity: 72, accent: 10 };
      v[2] = { ...v[2], channel: 3, mute: false, rhythm: 12, divide: 2, harmony: 8, tran: 1, octave: -2, art: 5, velocity: 90, accent: 12 };
      v[3] = { ...v[3], channel: 4, mute: false, rhythm: 10, divide: 2, harmony: 11, tran: 1, octave: 0, art: 1, velocity: 60, accent: 8 };
      v[4] = { ...v[4], channel: 5, mute: false, rhythm: 8, harmony: 2, tran: 5, octave: 0, art: 1, velocity: 64, accent: 8, delay: 0 };
      v[5] = { ...v[5], channel: 10, mute: false, rhythm: 10, divide: 1, harmony: 14, tran: 1, octave: 0, art: 1, velocity: 90, accent: 24 };
      p.accPresets[0] = v.map((x) => ({ ...x }));
      p.accPresets[1] = v.map((x, i) => ({ ...x, mute: i !== 0 && i !== 2 && i !== 5 }));
      p.notes = `${tag} Accompaniment preset A is the full band; preset B keeps theme, bass and drums.`;
      return p;
    },
  },
  {
    id: 'hermod',
    name: 'Hermod+ setup',
    description: 'Four voices on MIDI channels 1-4 with Clock Out on, for a Squarp Hermod+ (or any sequencer) following ANVIL over USB.',
    clockOut: true,
    build() {
      const p = newProject(0x4e2a0d, 'Demo: Hermod+ setup');
      p.tempo = 120;
      p.params = { ...p.params, rhythmAlg: 6, rhythmVariant: 2, rest: 10, pulse: 2, length: 32 };
      for (const id of ['TA', 'TB'] as ItemId[]) gen(p, id);
      const v = p.voices;
      v[0] = { ...v[0], channel: 1, art: 4 };
      v[1] = { ...v[1], channel: 2, mute: false, rhythm: 3, harmony: 8, tran: 1, octave: -1, art: 5 };
      v[2] = { ...v[2], channel: 3, mute: false, rhythm: 10, divide: 2, harmony: 9, tran: 2, art: 1, velocity: 70 };
      v[3] = { ...v[3], channel: 4, mute: false, rhythm: 12, harmony: 12, art: 1, velocity: 100, accent: 20 };
      p.options.sendProgramsAtStart = false;
      p.notes = [
        tag,
        'Hardware example (not verified on hardware by the ANVIL developers).',
        'ANVIL as clock master: connect the Hermod+ by USB, choose it as MIDI output, keep Clock Out on and set the Hermod+ to follow external clock from USB. ANVIL sends Start (FA), Clock (F8), Stop (FC) and Continue (FB).',
        'Voices 1-4 send on MIDI channels 1-4; route those channels to Hermod+ tracks or onward to CV/gate.',
        'ANVIL as clock slave: set the Hermod+ to send clock over USB, choose it as MIDI input and set Clock to External in ANVIL.',
      ].join('\n');
      return p;
    },
  },
];

export function findDemo(id: string): Demo | undefined {
  return DEMOS.find((d) => d.id === id);
}
