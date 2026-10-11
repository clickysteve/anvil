import { describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { makeBundle, unpackBundle } from '../src/audio/bundle';
import { planExport, defaultExportOptions } from '../src/audio/exportAudio';
import { SampleLibrary } from '../src/audio/library';
import { makeResolver, slotFor } from '../src/audio/routing';
import { defaultAudio, drumSlot, referencedSamples, repairAudio } from '../src/audio/settings';
import { AnvilSynth } from '../src/audio/synth';
import { encodeWav } from '../src/core/dsp/vendor/goodbits/js/audio-codec.js';
import { FX_PRESETS, cleanFx } from '../src/core/dsp/output/settings';
import { SampleInstrument } from '../src/core/sampler/instrument';
import { MemorySampleStore, sampleFromBytes } from '../src/core/storage/samples';
import { newProject } from '../src/engine/defaults';
import { generateTheme } from '../src/engine/theme';
import { Sequencer, type SeqEvent } from '../src/engine/sequencer';
import { OutputRouter } from '../src/midi/router';
import { loadProject, parseProject, serializeProject } from '../src/persistence/format';
import { Transport } from '../src/transport/transport';
import { FakePort, FakeTime } from './helpers';
import type { AudioData } from '../src/core/dsp/transform/transform';

const fakeBuffer = (a: AudioData) => ({ sampleRate: a.sampleRate, length: a.channels[0].length, numberOfChannels: a.channels.length, duration: a.channels[0].length / a.sampleRate, getChannelData: (i: number) => a.channels[i] }) as unknown as AudioBuffer;

async function wavBytes(seconds = 0.2, freq = 220): Promise<ArrayBuffer> {
  const n = Math.round(seconds * 44100);
  const ch = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / 44100));
  return encodeWav([ch, ch], 44100, 16).arrayBuffer();
}

function memKV() {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), removeItem: (k: string) => void delete data[k] };
}

function session(samples = new MemorySampleStore(), kv = memKV()) {
  const time = new FakeTime();
  const s = new Session({ time, store: kv, prefStore: kv, seed: () => 99, sampleStore: samples, makeBuffer: fakeBuffer });
  return { s, time, samples, kv };
}

describe('project format 2: audio settings', () => {
  it('upgrades format 1 projects with audio that sounds exactly as before', () => {
    const v1 = JSON.parse(serializeProject(newProject(5)));
    v1.version = 1;
    delete v1.audio;
    const r = loadProject(v1);
    expect(r.project.version).toBe(2);
    expect(r.warnings).toContain('Upgraded from format 1 to 2.');
    expect(r.project.audio).toEqual(defaultAudio());
    expect(r.project.audio.voices.every((v) => v.source === 'synth' && JSON.stringify(v.fx) === JSON.stringify(cleanFx()))).toBe(true);
  });

  it('round-trips audio settings exactly and repairs damaged ones', () => {
    const p = newProject(6);
    p.audio.voices[2] = { source: 'sample', fx: FX_PRESETS[1].apply(cleanFx()) };
    p.audio.slots[0] = { ...p.audio.slots[0], sampleId: 'a'.repeat(64), name: 'piano C3.wav', zone: { ...p.audio.slots[0].zone, root: 48, mode: 'loop', loopStart: 0.1 } };
    p.audio.master = FX_PRESETS[2].apply(cleanFx());
    const r = parseProject(serializeProject(p));
    expect(r.project.audio).toEqual(p.audio);
    expect(r.warnings).toEqual([]);
    const warns: string[] = [];
    const bad = repairAudio({ voices: [{ source: 'laser' }], slots: [{ sampleId: 'not-a-hash', name: 'x' }], master: { crunch: { enabled: true, bits: 99 } } }, (w) => warns.push(w));
    expect(bad.voices[0].source).toBe('synth');
    expect(bad.slots[0].sampleId).toBeNull();
    expect(bad.master.crunch.bits).toBe(16);
    expect(warns[0]).toContain('invalid sample');
    expect(repairAudio('junk', () => {})).toEqual(defaultAudio());
  });

  it('lists each referenced sample once', () => {
    const a = defaultAudio();
    a.slots[0].sampleId = 'b'.repeat(64);
    a.slots[7].sampleId = 'b'.repeat(64);
    a.slots[8].sampleId = 'c'.repeat(64);
    expect(referencedSamples(a)).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
    expect(a.slots[0].zone.mode).toBe('gated');
    expect(a.slots[drumSlot(0)].zone.mode).toBe('oneshot');
  });
});

describe('voice to sample routing', () => {
  it('maps melodic notes to the voice slot and drum notes to drum slots, only for SAMPLE voices', () => {
    const a = defaultAudio();
    expect(slotFor(a, 1)).toBe(-1);
    a.voices[1].source = 'sample';
    expect(slotFor(a, 1)).toBe(1);
    expect(slotFor(a, 1, 'drum:3')).toBe(drumSlot(3));
  });

  it('falls back to the internal synth when the slot has no playable sample', () => {
    const a = defaultAudio();
    a.voices[0].source = 'sample';
    const lib = new SampleLibrary({ store: new MemorySampleStore(), makeBuffer: fakeBuffer });
    const synth = new AnvilSynth();
    const resolve = makeResolver(() => a, lib, synth);
    expect(resolve('v1', { time: 0, pitch: 60, velocity: 90 })).toBe(synth);
    expect(resolve('v2', { time: 0, pitch: 60, velocity: 90 })).toBe(synth);
  });
});

describe('sample loading in the session', () => {
  it('decodes, stores, assigns and plays a sample; the voice uses it once SAMPLE is chosen', async () => {
    const { s, samples } = session();
    expect(await s.loadSample(0, { bytes: await wavBytes(), name: 'piano_C3.wav' })).toBe(true);
    const slot = s.project.audio.slots[0];
    expect(slot.name).toBe('piano_C3.wav');
    expect(slot.sampleId).toMatch(/^[0-9a-f]{64}$/);
    expect((await samples.list()).length).toBe(1);
    expect(s.library.state(0).status).toBe('ready');
    expect(s.library.state(0).duration).toBeCloseTo(0.2, 3);
    s.setVoiceSource(0, 'sample');
    const resolve = makeResolver(() => s.project.audio, s.library, new AnvilSynth());
    expect(resolve('v1', { time: 0, pitch: 60, velocity: 90 })).toBeInstanceOf(SampleInstrument);
    s.setSlotZone(0, { root: 48, mode: 'oneshot' });
    expect(s.library.instrument(0)!.zone.root).toBe(48);
  });

  it('reports bad files without touching the slot', async () => {
    const { s } = session();
    await s.loadSample(1, { bytes: await wavBytes(), name: 'ok.wav' });
    const before = structuredClone(s.project.audio.slots[1]);
    expect(await s.loadSample(1, { bytes: new Uint8Array([1, 2, 3]).buffer, name: 'notes.txt' })).toBe(false);
    expect(s.notice).toContain('not a supported audio file');
    expect(await s.loadSample(1, { bytes: new ArrayBuffer(0), name: 'empty.wav' })).toBe(false);
    expect(s.notice).toContain('empty');
    expect(s.project.audio.slots[1]).toEqual(before);
    expect(s.library.state(1).status).toBe('ready');
  });

  it('identical files are stored once and shared by slots', async () => {
    const { s, samples } = session();
    const bytes = await wavBytes();
    await s.loadSample(0, { bytes, name: 'a.wav' });
    await s.loadSample(drumSlot(2), { bytes: bytes.slice(0), name: 'b.wav' });
    expect((await samples.list()).length).toBe(1);
    expect(s.project.audio.slots[0].sampleId).toBe(s.project.audio.slots[drumSlot(2)].sampleId);
  });

  it('survives a reload (autosave + sample storage) and reports missing samples', async () => {
    const samples = new MemorySampleStore();
    const kv = memKV();
    const a = session(samples, kv);
    await a.s.loadSample(3, { bytes: await wavBytes(), name: 'bass.wav' });
    a.s.setVoiceSource(3, 'sample');
    a.s.saveNow();
    const b = session(samples, kv);
    expect(b.s.project.audio.slots[3].name).toBe('bass.wav');
    expect(b.s.project.audio.voices[3].source).toBe('sample');
    await b.s.library.ready();
    expect(b.s.library.state(3).status).toBe('ready');
    // another computer: the project but not the sample
    const c = session(new MemorySampleStore(), kv);
    await c.s.library.ready();
    expect(c.s.library.state(3).status).toBe('missing');
    expect(c.s.library.state(3).message).toContain('bass.wav');
    expect(makeResolver(() => c.s.project.audio, c.s.library, c.s.preview.synth)('v4', { time: 0, pitch: 40, velocity: 90 })).toBe(c.s.preview.synth);
  });

  it('clears slots and purges samples nothing refers to', async () => {
    const { s, samples } = session();
    await s.loadSample(0, { bytes: await wavBytes(0.1, 100), name: 'a.wav' });
    await s.loadSample(1, { bytes: await wavBytes(0.1, 200), name: 'b.wav' });
    s.clearSlot(0);
    expect(s.project.audio.slots[0].sampleId).toBeNull();
    s.saveNow();
    expect(await s.purgeUnusedSamples()).toBe(1);
    expect((await samples.list()).map((m) => m.name)).toEqual(['b.wav']);
  });
});

describe('portable bundles', () => {
  it('moves a project and its samples to a fresh browser', async () => {
    const a = session();
    await a.s.loadSample(0, { bytes: await wavBytes(), name: 'lead.wav' });
    await a.s.loadSample(drumSlot(0), { bytes: await wavBytes(0.05, 60), name: 'kick.wav' });
    a.s.rename('Bundle Song');
    const b = await a.s.bundle();
    expect(b.name).toBe('Bundle-Song.anvilpack');
    expect(b.missing).toEqual([]);
    const fresh = session();
    await fresh.s.openBundle(b.bytes);
    expect(fresh.s.project.name).toBe('Bundle Song');
    expect((await fresh.samples.list()).length).toBe(2);
    expect(fresh.s.library.state(0).status).toBe('ready');
    expect(fresh.s.library.state(drumSlot(0)).status).toBe('ready');
  });

  it('reports samples that could not be included', async () => {
    const p = newProject(1);
    p.audio.slots[0] = { ...p.audio.slots[0], sampleId: 'd'.repeat(64), name: 'gone.wav' };
    const b = await makeBundle(p, new MemorySampleStore());
    expect(b.missing).toEqual(['gone.wav']);
    const u = await unpackBundle(b.bytes, new MemorySampleStore());
    expect(u.stored).toBe(0);
    expect(JSON.parse(u.projectText).audio.slots[0].name).toBe('gone.wav');
    const st = new MemorySampleStore();
    st.quotaBytes = 0;
    const good = await makeBundle({ ...p, audio: { ...p.audio, slots: p.audio.slots.map((x, i) => (i === 0 ? { ...x, sampleId: null } : x)) } }, st);
    expect(good.missing).toEqual([]);
    const s2 = new MemorySampleStore();
    const kick = await sampleFromBytes(await wavBytes(0.01), 'k.wav');
    await s2.put(kick);
    p.audio.slots[0].sampleId = kick.id;
    const full = new MemorySampleStore();
    full.quotaBytes = 1;
    const u2 = await unpackBundle((await makeBundle(p, s2)).bytes, full);
    expect(u2.problems[0]).toContain('could not be stored');
  });
});

describe('transport feeds internal audio beside MIDI', () => {
  it('sends every event with its voice, ends notes on stop and announces starts; MIDI unchanged', () => {
    const p = newProject(3);
    p.bank.TA = generateTheme('TA', p.params, p.weights, 2);
    p.voices[1].mute = false;
    const time = new FakeTime();
    const port = new FakePort();
    const router = new OutputRouter(time.now);
    router.setNotePort(port);
    const tr = new Transport(new Sequencer(() => p), router, time, () => p);
    const got: { kind: string; e?: SeqEvent; t: number }[] = [];
    tr.audio = { note: (e, t) => got.push({ kind: 'note', e, t }), allNotesOff: (t) => got.push({ kind: 'off', t }), panic: (t) => got.push({ kind: 'panic', t }), started: (t) => got.push({ kind: 'start', t }) };
    tr.start();
    time.advance(800);
    tr.stop();
    tr.panic();
    // START first ends anything left over, then announces the start before the first note
    expect(got.findIndex((g) => g.kind === 'start')).toBeLessThan(got.findIndex((g) => g.kind === 'note'));
    const notes = got.filter((g) => g.kind === 'note' && g.e!.kind === 'on');
    const midiOns = port.notes().filter((s) => (s.data[0] & 0xf0) === 0x90);
    expect(notes.length).toBe(midiOns.length);
    expect(notes.map((n) => [n.e!.note, n.t])).toEqual(midiOns.map((m) => [m.data[1], m.time]));
    expect(new Set(notes.map((n) => n.e!.voice))).toEqual(new Set([0, 1]));
    expect(got.some((g) => g.kind === 'off')).toBe(true);
    expect(got.at(-1)!.kind).toBe('panic');
  });
});

describe('export planning', () => {
  function proj() {
    const p = newProject(8);
    p.name = 'My Song: Final (v2)!';
    p.bank.TA = generateTheme('TA', p.params, p.weights, 4);
    p.bank.VA1 = generateTheme('VA1', p.params, p.weights, 5);
    p.voices[2] = { ...p.voices[2], mute: false, harmony: 13, channel: 10 };
    return p;
  }

  it('names files predictably after ANVIL voices and the range', () => {
    const plan = planExport(proj(), defaultExportOptions('TA'));
    expect(plan.names).toEqual(['anvil_my-song-final-v2_ta_master.wav', 'anvil_my-song-final-v2_ta_voice-1-theme.wav', 'anvil_my-song-final-v2_ta_voice-3-drums.wav']);
    expect(plan.stems).toEqual([{ voice: 'v1', processed: true }, { voice: 'v3', processed: true }]);
    const p = proj();
    p.name = 'Untitled';
    expect(planExport(p, { ...defaultExportOptions('VA1'), range: { kind: 'item', item: 'VA1', passes: 4 }, outputs: 'stems', allVoices: true, bake: false }).names[0]).toBe('anvil_va1-x4_voice-1-theme.wav');
  });

  it('exports the variation or arrangement asked for, without touching the project', () => {
    const p = proj();
    const before = serializeProject(p);
    const va = planExport(p, { ...defaultExportOptions('VA1'), range: { kind: 'item', item: 'VA1', passes: 2 } });
    expect(va.perf.item).toBe('VA1');
    expect(va.timeline.length).toBe(2 * p.bank.VA1!.length * p.bank.VA1!.microbeat);
    expect(serializeProject(p)).toBe(before);
    expect(p.selected).toBe('TA');
    expect(() => planExport(p, { ...defaultExportOptions('TA'), range: { kind: 'arranger' } })).toThrow(/arranger is empty/);
    expect(() => planExport(p, defaultExportOptions('TE'))).toThrow(/TE is empty/);
    p.voices.forEach((v) => (v.mute = true));
    expect(() => planExport(p, { ...defaultExportOptions('TA'), outputs: 'stems' })).toThrow(/muted/);
  });

  it('is deterministic: the same project gives the same timeline', () => {
    expect(planExport(proj(), defaultExportOptions('TA')).timeline).toEqual(planExport(proj(), defaultExportOptions('TA')).timeline);
  });
});
