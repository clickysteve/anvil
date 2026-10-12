/**
 * ANVIL's audio settings, stored in the project (format 2): which voices play samples, the
 * thirteen sample slots, and the output processors. The sample audio itself lives in browser
 * storage (IndexedDB); a slot stores only the sample's id and file name.
 *
 * Slots 0-5 (V1-V6) belong to voices 1-6. Slots 6-12 (D1-D7) belong to drum-table entries 1-7:
 * a voice playing a drum harmony with its source set to SAMPLE takes each drum note from the
 * drum slot of the drum-table entry that produced it. Drum slots are shared by all drum voices,
 * but each voice keeps its own processing and stem.
 */
import { cleanFx, repairFx, type OutputFxSettings } from '@slopfactory/core/dsp';
import { identityTransform, repairTransform, type SampleTransform } from '@slopfactory/core/dsp';
import { defaultZone, repairZone, type SampleZone } from '@slopfactory/core/sampler';
import { DRUM_COUNT, VOICE_COUNT } from './anvilTimeline';

export type VoiceSource = 'synth' | 'sample';

export interface SampleSlot {
  /** SHA-256 id of the sample in browser storage, or null for an empty slot */
  sampleId: string | null;
  /** original file name, shown in the interface (and when the sample is missing) */
  name: string;
  zone: SampleZone;
  transform: SampleTransform;
}

export interface VoiceAudio {
  source: VoiceSource;
  fx: OutputFxSettings;
}

export interface ProjectAudio {
  voices: VoiceAudio[];
  slots: SampleSlot[];
  master: OutputFxSettings;
}

export const SLOT_COUNT = VOICE_COUNT + DRUM_COUNT;
export const isDrumSlot = (slot: number): boolean => slot >= VOICE_COUNT;
export const drumSlot = (drumIndex: number): number => VOICE_COUNT + drumIndex;
export const slotLabel = (slot: number): string => (isDrumSlot(slot) ? `D${slot - VOICE_COUNT + 1}` : `V${slot + 1}`);

export function emptySlot(slot: number): SampleSlot {
  return { sampleId: null, name: '', zone: { ...defaultZone(), mode: isDrumSlot(slot) ? 'oneshot' : 'gated' }, transform: identityTransform() };
}

export function defaultAudio(): ProjectAudio {
  return {
    voices: Array.from({ length: VOICE_COUNT }, () => ({ source: 'synth' as VoiceSource, fx: cleanFx() })),
    slots: Array.from({ length: SLOT_COUNT }, (_, i) => emptySlot(i)),
    master: cleanFx(),
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function repairSlot(src: unknown, slot: number, warn: (s: string) => void): SampleSlot {
  if (!isObj(src)) return emptySlot(slot);
  const id = typeof src.sampleId === 'string' && /^[0-9a-f]{64}$/.test(src.sampleId) ? src.sampleId : null;
  if (src.sampleId != null && !id) warn(`Sample slot ${slotLabel(slot)} referred to an invalid sample and was emptied.`);
  return {
    sampleId: id,
    name: id && typeof src.name === 'string' ? src.name.slice(0, 200) : '',
    zone: repairZone(src.zone),
    transform: repairTransform(src.transform),
  };
}

export function repairAudio(src: unknown, warn: (s: string) => void): ProjectAudio {
  const d = defaultAudio();
  if (src === undefined) return d;
  if (!isObj(src)) {
    warn('The audio settings were damaged; defaults were used.');
    return d;
  }
  const vs = Array.isArray(src.voices) ? src.voices : [];
  const ss = Array.isArray(src.slots) ? src.slots : [];
  return {
    voices: d.voices.map((def, i) => {
      const v = isObj(vs[i]) ? vs[i] : {};
      return { source: v.source === 'sample' ? 'sample' : 'synth', fx: v.fx === undefined ? def.fx : repairFx(v.fx) };
    }),
    slots: d.slots.map((_, i) => repairSlot(ss[i], i, warn)),
    master: src.master === undefined ? d.master : repairFx(src.master),
  };
}

/** Sample ids a project refers to (each once). */
export function referencedSamples(a: ProjectAudio): string[] {
  return [...new Set(a.slots.map((s) => s.sampleId).filter((id): id is string => !!id))];
}
