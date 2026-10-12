/**
 * A frozen performance: every note event ANVIL plays for a range, with its MIDI clock, voice
 * and drum-table index, computed without real time.
 *
 * It runs a fresh Sequencer on a structured clone of the project, clock by clock, exactly as
 * live playback does after START (or PLAY ARRANGER). The sequencer derives its performance
 * seed from the project seed, so the result is the performance the user hears from START:
 * the same random harmony, Divide, Feel and drum choices. The project passed in is never
 * modified, and no transport, router or clock is involved.
 *
 * MIDI file export and audio export both read this representation.
 */
import { programChanges, Sequencer } from './sequencer';
import type { ItemId, Project } from './types';

export interface PerformanceRange {
  /** play this item (default: the selected item) */
  item?: ItemId;
  /** number of passes of the item (ignored with arranger) */
  passes?: number;
  /** play the arranger once through instead */
  arranger?: boolean;
  /** safety limit in clocks */
  maxClocks?: number;
}

export interface PerfEvent {
  /** MIDI clock from the start of the performance */
  clock: number;
  kind: 'on' | 'off';
  ch: number;
  note: number;
  vel: number;
  /** 0..5; -1 for the closing note-offs of whatever is still sounding */
  voice: number;
  /** drum-table index 0..6, -1 for melodic notes */
  drum: number;
}

export interface FrozenPerformance {
  events: PerfEvent[];
  /** program changes sent at clock 0 (Send Programs at Start) */
  programs: number[][];
  /** length of the performance in clocks (the closing note-offs fall on this clock) */
  clocks: number;
  /** tempo in BPM (ANVIL has one tempo per project) */
  tempo: number;
  /** the seed the sequencer derived its pass seeds from */
  performanceSeed: number;
  /** the item that started the performance */
  item: ItemId;
  arranger: boolean;
}

export const DEFAULT_MAX_CLOCKS = 24 * 4 * 512;

export function freezePerformance(project: Project, range: PerformanceRange = {}): FrozenPerformance {
  const p: Project = structuredClone(project);
  if (range.item) p.selected = range.item;
  const seq = new Sequencer(() => p, (i) => {
    const preset = p.accPresets[i];
    if (preset) p.voices = p.voices.map((v, k) => (v.locked ? v : { ...preset[k] }));
  });
  seq.reset();
  const programs = p.options.sendProgramsAtStart ? programChanges(p.voices) : [];
  const events: PerfEvent[] = [];
  const max = range.maxClocks ?? DEFAULT_MAX_CLOCKS;
  const passes = Math.max(1, range.passes ?? 1);
  const arranger = !!range.arranger;
  if (arranger && p.arranger.steps.length) {
    p.options.arrangerLoop = false;
    seq.startArranger();
  }
  let clock = 0;
  for (; clock < max; clock++) {
    if (!arranger && seq.pass >= passes - 1 && seq.pass >= 0 && clock >= seq.passStart + seq.passClocks) break;
    if (arranger && !seq.arrangerPlaying && clock > 0) break;
    const r = seq.tick1();
    for (const e of r.events) events.push({ clock, kind: e.kind, ch: e.ch, note: e.note, vel: e.vel, voice: e.voice, drum: e.drum });
  }
  for (const e of seq.silence()) events.push({ clock, kind: 'off', ch: e.ch, note: e.note, vel: 0, voice: -1, drum: -1 });
  return { events, programs, clocks: clock, tempo: p.tempo, performanceSeed: seq.performanceSeed, item: p.selected, arranger };
}

/** Seconds per MIDI clock at a tempo. */
export function secondsPerClock(tempo: number): number {
  return 60 / (Math.max(20, Math.min(400, tempo)) * 24);
}
