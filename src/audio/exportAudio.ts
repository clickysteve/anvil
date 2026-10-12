/**
 * ANVIL's audio export: picks the musical range ANVIL actually has (an item, meaning a theme or
 * variation, for N passes; or the arrangement once through), freezes exactly the performance
 * START or PLAY ARRANGER would play, converts it to a Core timeline and renders master and/or
 * stems with Core's offline renderer, through the same instruments, routing and processing as
 * live playback. External MIDI instruments are not rendered: the browser only has ANVIL's own
 * sounds.
 */
import { audibleVoices } from '../engine/render';
import { freezePerformance, type FrozenPerformance } from '../engine/perform';
import type { ItemId, Project } from '../engine/types';
import type { Timeline } from '@slopfactory/core/events';
import { fileName, slug, uniqueNames } from '@slopfactory/core/export';
import { encodeWav16, levelStats, type LevelStats } from '@slopfactory/core/export';
import { createZip } from '@slopfactory/core/export';
import { EXPORT_SAMPLE_RATE, renderTimeline, type RenderResult, type StemRequest } from '@slopfactory/core/render';
import { performanceTimeline, voiceId, VOICE_COUNT } from './anvilTimeline';
import type { SampleLibrary } from './library';
import { anvilStrips, FX_SEED, makeResolver } from './routing';
import { AnvilSynth } from './synth';

export type ExportRange = { kind: 'item'; item: ItemId; passes: number } | { kind: 'arranger' };
export type ExportOutputs = 'master' | 'stems' | 'both';

export interface AudioExportOptions {
  range: ExportRange;
  outputs: ExportOutputs;
  /** stems carry their voice's processing (master processing is only ever on the master) */
  bake: boolean;
  /** export a stem for every voice, not only the audible ones */
  allVoices: boolean;
  tailSeconds: number;
}

export const defaultExportOptions = (item: ItemId): AudioExportOptions => ({ range: { kind: 'item', item, passes: 1 }, outputs: 'both', bake: true, allVoices: false, tailSeconds: 2 });

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
  kind: 'master' | 'stem';
  voice?: string;
  stats: LevelStats;
}

export interface ExportPlan {
  perf: FrozenPerformance;
  timeline: Timeline;
  master: boolean;
  stems: StemRequest[];
  /** file name of each output, in render order (master first) */
  names: string[];
  prefix: string;
}

export function rangeTag(r: ExportRange): string {
  return r.kind === 'arranger' ? 'arrangement' : `${r.item.toLowerCase()}${r.passes > 1 ? `-x${r.passes}` : ''}`;
}

/** Everything about an export that can be decided without rendering (pure, testable). */
export function planExport(project: Project, opts: AudioExportOptions): ExportPlan {
  if (opts.range.kind === 'arranger' && !project.arranger.steps.length) throw new Error('The arranger is empty: add steps, or export an item.');
  if (opts.range.kind === 'item' && !project.bank[opts.range.item]) throw new Error(`${opts.range.item} is empty: generate it first.`);
  const perf = opts.range.kind === 'arranger' ? freezePerformance(project, { arranger: true }) : freezePerformance(project, { item: opts.range.item, passes: Math.max(1, Math.min(64, opts.range.passes)) });
  const timeline = performanceTimeline(perf, project);
  const audible = audibleVoices(project.voices);
  const master = opts.outputs !== 'stems';
  const stems: StemRequest[] = opts.outputs === 'master' ? [] : Array.from({ length: VOICE_COUNT }, (_, i) => i).filter((i) => opts.allVoices || audible[i]).map((i) => ({ voice: voiceId(i), processed: opts.bake }));
  if (!master && !stems.length) throw new Error('Every voice is muted: there are no stems to export.');
  const nameSlug = slug(project.name, 24);
  const prefix = ['anvil', nameSlug === 'untitled' ? '' : nameSlug, rangeTag(opts.range)].filter(Boolean).join('_');
  const voiceNames = new Map(timeline.voices.map((v) => [v.id, slug(v.name, 24)]));
  const names = uniqueNames([...(master ? [fileName([prefix, 'master'], 'wav')] : []), ...stems.map((s) => fileName([prefix, voiceNames.get(s.voice)!], 'wav'))]);
  return { perf, timeline, master, stems, names, prefix };
}

export interface ExportResult {
  files: ExportFile[];
  /** the single download: a WAV, or a ZIP of several */
  download: { name: string; bytes: Uint8Array; type: string };
  render: RenderResult;
  plan: ExportPlan;
}

export async function exportAudio(project: Project, library: SampleLibrary, opts: AudioExportOptions, env: { workletUrl: string | null; onProgress?: (f: number, stage: string) => void; signal?: AbortSignal }): Promise<ExportResult> {
  const snapshot: Project = structuredClone(project);
  const plan = planExport(snapshot, opts);
  env.onProgress?.(0, 'Preparing samples');
  library.sync(snapshot.audio);
  await library.ready();
  const render = await renderTimeline({
    timeline: plan.timeline,
    sampleRate: EXPORT_SAMPLE_RATE,
    tailSeconds: Math.max(0, Math.min(30, opts.tailSeconds)),
    master: plan.master,
    stems: plan.stems,
    strips: anvilStrips(snapshot.audio),
    masterFx: snapshot.audio.master,
    fxSeed: FX_SEED,
    resolve: makeResolver(() => snapshot.audio, library, new AnvilSynth()),
    fxModuleUrl: env.workletUrl ?? undefined,
    onProgress: (f) => env.onProgress?.(f * 0.9, 'Rendering'),
    signal: env.signal,
  });
  env.onProgress?.(0.9, 'Writing WAV files');
  const files: ExportFile[] = [];
  for (let i = 0; i < render.outputs.length; i++) {
    const o = render.outputs[i];
    files.push({ name: plan.names[i], bytes: await encodeWav16(o.channels, render.sampleRate), kind: o.kind, voice: o.voice, stats: levelStats(o.channels) });
  }
  const download = files.length === 1 ? { name: files[0].name, bytes: files[0].bytes, type: 'audio/wav' } : { name: `${plan.prefix}.zip`, bytes: createZip(files.map((f) => ({ name: f.name, data: f.bytes }))), type: 'application/zip' };
  env.onProgress?.(1, 'Done');
  return { files, download, render, plan };
}
