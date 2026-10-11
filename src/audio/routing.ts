/**
 * How ANVIL routes its voices through Slop Factory Core: which instrument plays a note, and the
 * voice strips (fixed mix headroom, per-voice processing). Shared by live playback and export,
 * so both make the same decisions.
 */
import type { Instrument } from '../core/audio/instrument';
import type { StripSettings } from '../core/audio/mixer';
import type { ResolveInstrument } from '../core/audio/player';
import { drumIndexOf, voiceId, voiceIndex, VOICE_COUNT } from './anvilTimeline';
import type { SampleLibrary } from './library';
import { drumSlot, type ProjectAudio } from './settings';
import { MIX_HEADROOM } from './synth';

/** The slot a note would play from (or -1 when the voice uses the synth). */
export function slotFor(audio: ProjectAudio, voice: number, instrument?: string): number {
  if (audio.voices[voice]?.source !== 'sample') return -1;
  const d = drumIndexOf(instrument);
  return d >= 0 ? drumSlot(d) : voice;
}

/**
 * A voice set to SAMPLE plays its slot's sample; if that slot is empty, missing or still
 * loading it falls back to the internal synth, so a voice never goes silently unusable. A
 * muted slot is silent (the sample instrument plays nothing).
 */
export function makeResolver(getAudio: () => ProjectAudio, library: SampleLibrary, synth: Instrument): ResolveInstrument {
  return (voice, note) => {
    const slot = slotFor(getAudio(), voiceIndex(voice), note.instrument);
    if (slot < 0) return synth;
    return library.instrument(slot) ?? synth;
  };
}

export function anvilStrips(audio: ProjectAudio): Record<string, Partial<StripSettings>> {
  const out: Record<string, Partial<StripSettings>> = {};
  for (let i = 0; i < VOICE_COUNT; i++) out[voiceId(i)] = { gain: MIX_HEADROOM, pan: 0, fx: audio.voices[i].fx };
  return out;
}

/** Seed for the output processors' noise (fixed, so exports are reproducible). */
export const FX_SEED = 0x5eed;
