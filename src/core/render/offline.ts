/**
 * Offline rendering of a Timeline to a master mix and isolated, sample-aligned stems.
 *
 * The same Mixer, NotePlayer, instruments and output-processor worklet as live playback run
 * in an OfflineAudioContext. Each requested output (master, or one voice's stem) becomes two
 * channels of one multichannel render, so every output shares frame 0 = tick 0, the same
 * length (music plus a common tail) and the same sample rate by construction. A render too big
 * for the memory budget is split into several renders of whole outputs; each starts from frame
 * 0 with the same events, so alignment is unchanged.
 *
 * Notes are scheduled in chunks at suspend() points, which also report progress and allow
 * cancellation. Nothing here touches a live AudioContext, a transport or MIDI.
 */
import { NotePlayer, type ResolveInstrument } from '../audio/player';
import { Mixer, type StripSettings } from '../audio/mixer';
import { loadOutputFx } from '../dsp/output/node';
import type { OutputFxSettings } from '../dsp/output/settings';
import { TimeMap, type ControlEvent, type NoteEvent, type Timeline } from '../events/timeline';

export const EXPORT_SAMPLE_RATE = 44100;
export const MAX_RENDER_SECONDS = 20 * 60;
const MAX_CONTEXT_CHANNELS = 32;

export interface StemRequest {
  voice: string;
  /** include the voice's own output processing */
  processed: boolean;
}

export interface RenderRequest {
  timeline: Timeline;
  sampleRate?: number;
  /** silence-or-ring-out time after the end of the music, shared by every output */
  tailSeconds: number;
  master: boolean;
  stems: StemRequest[];
  strips?: Record<string, Partial<StripSettings>>;
  masterFx?: OutputFxSettings;
  masterGain?: number;
  fxSeed?: number;
  resolve: ResolveInstrument;
  /** output-processor worklet URL; without it processing is skipped (and reported) */
  fxModuleUrl?: string;
  maxPerVoice?: number;
  /** controller events, if the application gives them meaning */
  onControl?: (e: ControlEvent, time: number, mixer: Mixer) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** bytes of float audio one render may allocate (default 384 MB) */
  memoryBudget?: number;
  /** seconds of music scheduled per chunk */
  chunkSeconds?: number;
  /** for tests: build the context */
  createContext?: (channels: number, frames: number, sampleRate: number) => OfflineAudioContext;
}

export interface RenderOutput {
  kind: 'master' | 'stem';
  voice?: string;
  processed: boolean;
  channels: [Float32Array, Float32Array];
}

export interface RenderResult {
  sampleRate: number;
  frames: number;
  seconds: number;
  /** seconds of music before the tail */
  musicSeconds: number;
  outputs: RenderOutput[];
  /** number of OfflineAudioContext renders used */
  renders: number;
  /** false when output processing could not run (no AudioWorklet or no module URL) */
  processed: boolean;
}

export class RenderCancelled extends Error {
  constructor() {
    super('Render cancelled.');
    this.name = 'RenderCancelled';
  }
}

interface Out {
  kind: 'master' | 'stem';
  voice?: string;
  processed: boolean;
}

/** Split outputs into groups of at most `maxOutputs` (each output is two channels). */
export function planRenders(outputs: Out[], frames: number, memoryBudget: number): Out[][] {
  const perOutput = frames * 2 * 4;
  const maxOutputs = Math.max(1, Math.min(MAX_CONTEXT_CHANNELS / 2, Math.floor(memoryBudget / Math.max(1, perOutput))));
  const groups: Out[][] = [];
  for (let i = 0; i < outputs.length; i += maxOutputs) groups.push(outputs.slice(i, i + maxOutputs));
  return groups;
}

export function renderLength(timeline: Timeline, tailSeconds: number, sampleRate: number): { frames: number; musicSeconds: number } {
  const musicSeconds = new TimeMap(timeline.tempo).seconds(timeline.length);
  return { musicSeconds, frames: Math.max(1, Math.ceil((musicSeconds + Math.max(0, tailSeconds)) * sampleRate)) };
}

export async function renderTimeline(req: RenderRequest): Promise<RenderResult> {
  const sr = req.sampleRate ?? EXPORT_SAMPLE_RATE;
  const { frames, musicSeconds } = renderLength(req.timeline, req.tailSeconds, sr);
  if (frames / sr > MAX_RENDER_SECONDS) throw new RangeError(`The render would be ${Math.round(frames / sr)} s long; the limit is ${MAX_RENDER_SECONDS / 60} minutes.`);
  const voiceIds = new Set(req.timeline.voices.map((v) => v.id));
  for (const s of req.stems) if (!voiceIds.has(s.voice)) throw new Error(`unknown voice "${s.voice}"`);
  const outputs: Out[] = [...(req.master ? [{ kind: 'master' as const, processed: true }] : []), ...req.stems.map((s) => ({ kind: 'stem' as const, voice: s.voice, processed: s.processed }))];
  if (!outputs.length) throw new Error('Nothing to render: choose the master, stems or both.');
  const groups = planRenders(outputs, frames, req.memoryBudget ?? 384 * 1024 * 1024);
  const results: RenderOutput[] = [];
  let processed = true;
  for (let g = 0; g < groups.length; g++) {
    const r = await renderGroup(req, groups[g], frames, sr, (f) => req.onProgress?.((g + f) / groups.length));
    processed &&= r.processed;
    results.push(...r.outputs);
  }
  req.onProgress?.(1);
  return { sampleRate: sr, frames, seconds: frames / sr, musicSeconds, outputs: results, renders: groups.length, processed };
}

async function renderGroup(req: RenderRequest, group: Out[], frames: number, sr: number, progress: (f: number) => void): Promise<{ outputs: RenderOutput[]; processed: boolean }> {
  if (req.signal?.aborted) throw new RenderCancelled();
  const channels = group.length * 2;
  const ctx = req.createContext ? req.createContext(channels, frames, sr) : new OfflineAudioContext({ numberOfChannels: channels, length: frames, sampleRate: sr });
  const fxAvailable = req.fxModuleUrl ? await loadOutputFx(ctx, req.fxModuleUrl) : false;
  const needsAll = group.some((o) => o.kind === 'master');
  const needed = new Set(needsAll ? req.timeline.voices.map((v) => v.id) : group.map((o) => o.voice!));
  const mixer = new Mixer(ctx, {
    voices: req.timeline.voices.map((v) => v.id),
    strips: req.strips,
    masterFx: req.masterFx,
    masterGain: req.masterGain,
    fxAvailable,
    seed: req.fxSeed,
    dryTaps: group.some((o) => o.kind === 'stem' && !o.processed),
  });
  const merger = ctx.createChannelMerger(channels);
  merger.channelInterpretation = 'discrete';
  group.forEach((o, k) => {
    const split = ctx.createChannelSplitter(2);
    const src = o.kind === 'master' ? mixer.output : o.processed ? mixer.processedTap(o.voice!) : mixer.dryTap(o.voice!);
    src.connect(split);
    split.connect(merger, 0, 2 * k);
    split.connect(merger, 1, 2 * k + 1);
  });
  ctx.destination.channelCount = channels;
  ctx.destination.channelCountMode = 'explicit';
  ctx.destination.channelInterpretation = 'discrete';
  merger.connect(ctx.destination);

  const player = new NotePlayer(ctx, mixer, req.resolve, { maxPerVoice: req.maxPerVoice });
  const tm = new TimeMap(req.timeline.tempo);
  const events = req.timeline.events.filter((e) => needed.has(e.voice));
  let next = 0;
  let cancelled = false;
  const schedule = (until: number) => {
    while (next < events.length) {
      const e = events[next];
      const t = tm.seconds(e.tick);
      if (t >= until) break;
      next++;
      if (cancelled) continue;
      if (e.type === 'note') {
        const n = e as NoteEvent;
        const key = `n${next}`;
        player.noteOn(key, n.voice, { time: t, pitch: n.pitch, velocity: n.velocity, channel: n.channel, instrument: n.instrument });
        player.noteOff(key, tm.seconds(n.tick + n.duration));
      } else req.onControl?.(e, t, mixer);
    }
  };
  const quantum = 128 / sr;
  const chunk = Math.max(quantum * 4, Math.floor((req.chunkSeconds ?? 2) / quantum) * quantum);
  const total = frames / sr;
  schedule(chunk);
  for (let T = chunk; T < total - quantum; T += chunk) {
    const at = T;
    void ctx.suspend(at).then(() => {
      if (req.signal?.aborted && !cancelled) {
        cancelled = true;
        mixer.output.disconnect();
        for (const o of group) if (o.kind === 'stem') (o.processed ? mixer.processedTap(o.voice!) : mixer.dryTap(o.voice!)).disconnect();
      }
      schedule(at + chunk);
      progress(Math.min(1, at / total));
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  mixer.dispose();
  if (cancelled || req.signal?.aborted) throw new RenderCancelled();
  return {
    processed: fxAvailable,
    outputs: group.map((o, k) => ({ ...o, channels: [buf.getChannelData(2 * k).slice(), buf.getChannelData(2 * k + 1).slice()] as [Float32Array, Float32Array] })),
  };
}
