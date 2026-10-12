/**
 * ANVIL's sample library: turns the project's thirteen slot assignments into playable Slop
 * Factory Core sample instruments.
 *
 * For each slot with a sample id it fetches the original bytes from browser storage, decodes
 * them once per sample (shared by every slot using that sample), applies the slot's sample
 * transformation through the shared cache (so an expensive stretch runs once per sample and
 * settings), and keeps one AudioBuffer per (sample, transformation). Live playback and offline
 * export use the same instruments and buffers.
 */
import type { AudioData } from '@slopfactory/core/dsp';
import { syncRunner, TransformCache, type TransformRunner } from '@slopfactory/core/dsp';
import { transformKey } from '@slopfactory/core/dsp';
import { decodeSample, SampleError, toAudioBuffer, type DecodedSample } from '@slopfactory/core/sampler';
import { SampleInstrument } from '@slopfactory/core/sampler';
import { sampleFromBytes, StorageError, type SampleStore } from '@slopfactory/core/storage';
import type { ProjectAudio, SampleSlot } from './settings';
import { SLOT_COUNT } from './settings';

export type SlotStatus = 'empty' | 'loading' | 'processing' | 'ready' | 'missing' | 'error';

export interface SlotState {
  status: SlotStatus;
  /** decoded length of the (transformed) audio in seconds */
  duration: number;
  /** of the original sample */
  sampleRate: number;
  channels: number;
  message: string;
  instrument: SampleInstrument | null;
  /** the audio the instrument plays (after transformation), for waveform display */
  audio: AudioData | null;
  /** sample id and transformation this state was built for */
  key: string;
}

const blank = (status: SlotStatus = 'empty', message = '', key = ''): SlotState => ({ status, duration: 0, sampleRate: 0, channels: 0, message, instrument: null, audio: null, key });

export interface LibraryDeps {
  store: SampleStore | null;
  runner?: TransformRunner;
  /** AudioBuffer factory (tests replace it) */
  makeBuffer?: (audio: AudioData) => AudioBuffer;
  decode?: (bytes: ArrayBuffer, name: string) => Promise<DecodedSample>;
}

export interface LoadedSample {
  id: string;
  name: string;
  warnings: string[];
}

export class SampleLibrary {
  private decoded = new Map<string, Promise<DecodedSample>>();
  private buffers = new Map<string, Promise<{ buffer: AudioBuffer; audio: AudioData }>>();
  private states: SlotState[] = Array.from({ length: SLOT_COUNT }, () => blank());
  private pending = new Set<Promise<unknown>>();
  readonly transforms: TransformCache;
  onChange: () => void = () => {};

  constructor(private deps: LibraryDeps) {
    this.transforms = new TransformCache(deps.runner ?? syncRunner);
  }

  get store(): SampleStore | null {
    return this.deps.store;
  }

  state(slot: number): SlotState {
    return this.states[slot] ?? blank();
  }

  /** Decode, validate and store a user file. Throws SampleError or StorageError with a message for the user. */
  async importFile(bytes: ArrayBuffer, name: string, type = ''): Promise<LoadedSample> {
    const decoded = await (this.deps.decode ?? ((b, n) => decodeSample(b, n)))(bytes, name);
    const stored = await sampleFromBytes(bytes, name, type);
    if (!this.deps.store) throw new StorageError('unavailable', 'Browser storage is unavailable, so the sample cannot be kept.');
    await this.deps.store.put(stored);
    this.decoded.set(stored.id, Promise.resolve(decoded));
    return { id: stored.id, name, warnings: decoded.warnings };
  }

  private decodedSample(id: string, name: string): Promise<DecodedSample> {
    let p = this.decoded.get(id);
    if (!p) {
      p = (async () => {
        const s = await this.deps.store?.get(id);
        if (!s) throw new SampleError('empty', 'missing');
        return (this.deps.decode ?? ((b, n) => decodeSample(b, n)))(s.bytes, s.name || name);
      })();
      this.decoded.set(id, p);
      p.catch(() => this.decoded.delete(id));
    }
    return p;
  }

  private buffer(id: string, slot: SampleSlot, decoded: DecodedSample) {
    const key = `${id}|${transformKey(slot.transform)}`;
    let p = this.buffers.get(key);
    if (!p) {
      p = this.transforms.get(id, decoded, slot.transform).then((audio) => ({ audio, buffer: (this.deps.makeBuffer ?? toAudioBuffer)(audio) }));
      this.buffers.set(key, p);
      p.catch(() => this.buffers.delete(key));
    }
    return p;
  }

  /** Bring every slot up to date with the project's settings. Cheap when nothing changed. */
  sync(audio: ProjectAudio): void {
    audio.slots.forEach((slot, i) => {
      const st = this.states[i];
      if (!slot.sampleId) {
        if (st.status !== 'empty') {
          this.states[i] = blank();
          this.onChange();
        }
        return;
      }
      const id = slot.sampleId;
      const key = `${id}|${transformKey(slot.transform)}`;
      if (st.key === key && st.status === 'ready' && st.instrument) {
        st.instrument.zone = slot.zone;
        return;
      }
      if (st.key === key && st.status !== 'empty') return;
      const loading = blank(this.transforms.has(id, slot.transform) || !slot.transform.enabled ? 'loading' : 'processing', '', key);
      this.states[i] = loading;
      const job = (async () => {
        try {
          const decoded = await this.decodedSample(id, slot.name);
          const { buffer, audio: a } = await this.buffer(id, slot, decoded);
          if (this.states[i] !== loading) return;
          const instrument = new SampleInstrument(buffer, slot.zone);
          this.states[i] = { status: 'ready', duration: buffer.duration, sampleRate: decoded.sampleRate, channels: decoded.channels.length, message: decoded.warnings.join(' '), instrument, audio: a, key };
        } catch (e) {
          if (this.states[i] !== loading) return;
          const missing = e instanceof SampleError && e.message === 'missing';
          this.states[i] = blank(missing ? 'missing' : 'error', missing ? `"${slot.name}" is not in this browser's storage. Load it again, or open the project bundle.` : e instanceof Error ? e.message : String(e), key);
        } finally {
          this.onChange();
        }
      })();
      this.pending.add(job);
      void job.finally(() => this.pending.delete(job));
      this.onChange();
    });
  }

  /** Resolves when every slot has finished loading or processing. */
  async ready(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** The playable instrument of a slot, or null (empty, missing, failed, still loading). */
  instrument(slot: number): SampleInstrument | null {
    const s = this.states[slot];
    return s?.status === 'ready' ? s.instrument : null;
  }

  /** Try again for slots whose sample was missing or failed (after importing samples). */
  retry(): void {
    this.states = this.states.map((st) => (st.status === 'missing' || st.status === 'error' ? blank() : st));
  }

  /** Forget decoded audio for a sample (after it is deleted from storage). */
  forget(id: string): void {
    this.decoded.delete(id);
    for (const k of [...this.buffers.keys()]) if (k.startsWith(`${id}|`)) this.buffers.delete(k);
    this.transforms.drop(id);
  }
}
