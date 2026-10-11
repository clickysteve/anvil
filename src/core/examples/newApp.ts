/**
 * How a new application uses Slop Factory Core, without any knowledge of ANVIL. Type-checked
 * with the rest of the code; test/core/examples.test.ts runs the parts that do not need a
 * browser.
 */
import {
  applyTransform,
  constantTempo,
  createZip,
  defaultZone,
  encodeWav16,
  FX_PRESETS,
  cleanFx,
  identityTransform,
  IndexedDbSampleStore,
  Mixer,
  NotePlayer,
  renderTimeline,
  SampleInstrument,
  sampleFromBytes,
  sortEvents,
  toAudioBuffer,
  decodeSample,
  loadOutputFx,
  writeBundle,
  type AudioData,
  type Instrument,
  type NoteEvent,
  type SampleStore,
  type Timeline,
} from '../index';

/** 1. Register musical voices and schedule note events: a timeline at the app's resolution. */
export function exampleTimeline(): Timeline {
  const ppq = 96;
  const note = (tick: number, voice: string, pitch: number, instrument?: string): NoteEvent => ({ type: 'note', tick, duration: ppq / 2, voice, pitch, velocity: 100, ...(instrument ? { instrument } : {}) });
  return {
    tempo: constantTempo(128, ppq),
    length: ppq * 4,
    voices: [
      { id: 'kick', name: 'Kick' },
      { id: 'lead', name: 'Lead' },
    ],
    events: sortEvents([note(0, 'kick', 36), note(ppq, 'kick', 36), note(0, 'lead', 60), note(ppq * 2, 'lead', 67), note(ppq * 3, 'kick', 38, 'snare-sample')]),
  };
}

/** 2. Assign samples: decode a user file, make an instrument, keep it in browser storage. */
export async function exampleAssignSample(bytes: ArrayBuffer, name: string, store: SampleStore = new IndexedDbSampleStore('my-app-samples')): Promise<{ instrument: SampleInstrument; sampleId: string }> {
  const decoded = await decodeSample(bytes, name);
  const stored = await sampleFromBytes(bytes, name);
  await store.put(stored); // identical files are stored once
  const instrument = new SampleInstrument(toAudioBuffer(decoded), { ...defaultZone(), root: 48, mode: 'oneshot' });
  return { instrument, sampleId: stored.id };
}

/** 3. Apply a sample transformation (Good Bits STRETCH FX), non-destructively. */
export function exampleTransform(audio: AudioData): AudioData {
  return applyTransform(audio, { ...identityTransform(), enabled: true, character: 'cyclic', ratio: 2, crunch: { enabled: true, bits: 12, rateDivide: 1 } });
}

/** 4. Live playback: mixer with an output processor per voice and on the master. */
export async function exampleLive(ctx: AudioContext, instruments: Record<string, Instrument>, workletUrl: string): Promise<NotePlayer> {
  const fxAvailable = await loadOutputFx(ctx, workletUrl);
  const mixer = new Mixer(ctx, {
    voices: ['kick', 'lead'],
    strips: { lead: { gain: 0.6, pan: 0.2, fx: FX_PRESETS.find((p) => p.key === 'cassette')!.apply(cleanFx()) } },
    masterFx: FX_PRESETS.find((p) => p.key === '12bit')!.apply(cleanFx()),
    fxAvailable,
  });
  mixer.output.connect(ctx.destination);
  const player = new NotePlayer(ctx, mixer, (voice, note) => (note.instrument ? instruments[note.instrument] : instruments[voice]) ?? null);
  // a note-on and its note-off (keys pair them; reuse "channel:pitch" for MIDI semantics)
  const t = ctx.currentTime + 0.05;
  player.noteOn('lead-1', 'lead', { time: t, pitch: 60, velocity: 100 });
  player.noteOff('lead-1', t + 0.5);
  return player;
}

/** 5. Render a WAV and stems, then package them (and a portable project bundle). */
export async function exampleExport(timeline: Timeline, instruments: Record<string, Instrument>, workletUrl: string, projectJson: string, store: SampleStore): Promise<{ zip: Uint8Array; bundle: Uint8Array }> {
  const r = await renderTimeline({
    timeline,
    tailSeconds: 2,
    master: true,
    stems: timeline.voices.map((v) => ({ voice: v.id, processed: true })),
    resolve: (voice, note) => (note.instrument ? instruments[note.instrument] : instruments[voice]) ?? null,
    fxModuleUrl: workletUrl,
    onProgress: (f) => console.log(`render ${Math.round(f * 100)}%`),
  });
  const files = await Promise.all(r.outputs.map(async (o) => ({ name: `${o.kind === 'master' ? 'master' : o.voice}.wav`, data: await encodeWav16(o.channels, r.sampleRate) })));
  const samples = await store.list();
  const stored = (await Promise.all(samples.map((m) => store.get(m.id)))).filter((s) => s !== null);
  return { zip: createZip(files), bundle: writeBundle('MyApp', { name: 'song.json', text: projectJson }, stored) };
}
