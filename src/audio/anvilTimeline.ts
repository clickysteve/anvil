/**
 * ANVIL's adapter to the shared event model: a frozen performance (engine/perform.ts) becomes a
 * Slop Factory Core Timeline. ANVIL counts time in MIDI clocks, so its timeline uses 24 ticks
 * per quarter note and ticks are clocks, unchanged.
 *
 * Voices are "v1".."v6". Notes from a drum harmony carry the instrument key "drum:<index>"
 * (drum-table entry 0..6), so a drum voice can play a different sample per drum-table entry
 * while still being one voice (one stem).
 */
import { HARMONY_DRUM_BASE, type Project } from '../engine/types';
import type { FrozenPerformance } from '../engine/perform';
import { constantTempo, NotePairer, sortEvents, type Timeline, type VoiceInfo } from '../core/events/timeline';

export const ANVIL_PPQ = 24;
export const VOICE_COUNT = 6;
export const DRUM_COUNT = 7;

export const voiceId = (i: number): string => `v${i + 1}`;
export const voiceIndex = (id: string): number => Number(id.slice(1)) - 1;
export const drumInstrument = (k: number): string => `drum:${k}`;
export const drumIndexOf = (instrument: string | undefined): number => (instrument?.startsWith('drum:') ? Number(instrument.slice(5)) : -1);

/** A voice's display name: "Voice 1 theme", "Voice 3", "Voice 5 drums". */
export function voiceName(p: Project, i: number): string {
  if (i === 0) return 'Voice 1 theme';
  return `Voice ${i + 1}${p.voices[i]?.harmony >= HARMONY_DRUM_BASE ? ' drums' : ''}`;
}

export function anvilVoices(p: Project): VoiceInfo[] {
  return Array.from({ length: VOICE_COUNT }, (_, i) => ({ id: voiceId(i), name: voiceName(p, i) }));
}

/**
 * Pair the performance's note-ons and note-offs the way the sequencer and MIDI do (by channel
 * and note), attributing each note to the voice that started it.
 */
export function performanceTimeline(perf: FrozenPerformance, p: Project): Timeline {
  const pair = new NotePairer();
  for (const e of perf.events) {
    const key = `${e.ch}:${e.note}`;
    if (e.kind === 'off') pair.off(key, e.clock);
    else pair.on(key, { tick: e.clock, voice: voiceId(e.voice), pitch: e.note, velocity: e.vel, channel: e.ch, ...(e.drum >= 0 ? { instrument: drumInstrument(e.drum) } : {}) });
  }
  return {
    tempo: constantTempo(perf.tempo, ANVIL_PPQ),
    length: perf.clocks,
    voices: anvilVoices(p),
    events: sortEvents(pair.close(perf.clocks)),
    meta: { app: 'anvil', item: perf.item, arranger: perf.arranger, performanceSeed: perf.performanceSeed },
  };
}
