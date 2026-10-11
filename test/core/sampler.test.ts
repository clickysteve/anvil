import { describe, expect, it } from 'vitest';
import { encodeWav } from '../../src/core/dsp/vendor/goodbits/js/audio-codec.js';
import { cleanFx } from '../../src/core/dsp/output/settings';
import { Mixer } from '../../src/core/audio/mixer';
import { NotePlayer } from '../../src/core/audio/player';
import { decodeSample, SampleError } from '../../src/core/sampler/decode';
import { snapToZeroCrossing, waveformPeaks } from '../../src/core/sampler/edit';
import { SampleInstrument } from '../../src/core/sampler/instrument';
import { defaultZone, noteName, parseNoteName, playbackRate, region, repairZone, velocityGain, zoneProblems, type SampleZone } from '../../src/core/sampler/zone';
import { asBuffer, asCtx, FakeBuffer, FakeBufferSource, FakeContext, FakeGain, FakePanner } from './fakeAudio';

const zone = (p: Partial<SampleZone> = {}): SampleZone => ({ ...defaultZone(), ...p });

describe('zone maths', () => {
  it('maps the root note to original speed and transposes chromatically', () => {
    const z = zone({ root: 48 }); // C3
    expect(playbackRate(z, 48)).toBe(1);
    expect(playbackRate(z, 60)).toBeCloseTo(2, 12);
    expect(playbackRate(z, 36)).toBeCloseTo(0.5, 12);
    expect(playbackRate(z, 55)).toBeCloseTo(Math.pow(2, 7 / 12), 12);
    expect(playbackRate(zone({ root: 48, tune: 12 }), 48)).toBeCloseTo(2, 12);
    expect(playbackRate(zone({ root: 48, fine: 100 }), 48)).toBeCloseTo(Math.pow(2, 1 / 12), 12);
  });

  it('scales level by velocity on a 1.5-power curve, with sensitivity', () => {
    expect(velocityGain(zone(), 127)).toBe(1);
    expect(velocityGain(zone(), 64)).toBeCloseTo(Math.pow(64 / 127, 1.5), 12);
    expect(velocityGain(zone({ velocitySens: 0 }), 10)).toBe(1);
    expect(velocityGain(zone(), 100)).toBeGreaterThan(velocityGain(zone(), 50));
  });

  it('keeps regions inside the sample and loops inside the region', () => {
    expect(region(zone({ start: 0.1, end: 0.5, loopStart: 0.2, loopEnd: 0.4 }), 1)).toMatchObject({ start: 0.1, end: 0.5, loopStart: 0.2, loopEnd: 0.4, trimmedStart: true, trimmedEnd: true });
    expect(region(zone({ end: 9 }), 1)).toMatchObject({ end: 1, trimmedEnd: false });
    expect(region(zone({ start: 0.3, loopStart: 0.1, loopEnd: 0.1 }), 1)).toMatchObject({ loopStart: 0.3, loopEnd: 1 });
    expect(zoneProblems(zone({ mode: 'loop', start: 0.5, loopStart: 0.2, loopEnd: 0.3 }), 1)).toContain('LOOP START must not be before START.');
    expect(zoneProblems(zone({ end: 0.1, start: 0.2 }), 1)).toContain('END must be after START.');
    expect(zoneProblems(zone(), 1)).toEqual([]);
  });

  it('repairs zones and names notes (middle C = C4)', () => {
    expect(repairZone({ root: 300, mode: 'x', volume: -1, release: 0, end: 'y' })).toMatchObject({ root: 127, mode: 'oneshot', volume: 0, release: 0.005, end: null });
    expect(noteName(60)).toBe('C4');
    expect(noteName(48)).toBe('C3');
    expect(parseNoteName('C3')).toBe(48);
    expect(parseNoteName('f#2')).toBe(42);
    expect(parseNoteName('Bb3')).toBe(58);
    expect(parseNoteName('64')).toBe(64);
    expect(parseNoteName('H9')).toBeNull();
  });
});

function setup(z: Partial<SampleZone> = {}, channels = 2, seconds = 1) {
  const ctx = new FakeContext();
  const buf = new FakeBuffer(channels, Math.round(seconds * 44100), 44100);
  const inst = new SampleInstrument(asBuffer(buf), zone(z));
  const out = ctx.createGain();
  return { ctx, inst, out, buf };
}
const lastSource = (ctx: FakeContext) => ctx.of<FakeBufferSource>('buffer').at(-1)!;
const noteGain = (ctx: FakeContext) => ctx.of<FakeGain>('gain').at(-1)!;

describe('sample instrument', () => {
  it('ONE SHOT plays the region at the transposed rate and ignores note-off', () => {
    const { ctx, inst, out } = setup({ root: 60, start: 0.1, end: 0.6 });
    const h = inst.start(asCtx(ctx), out as unknown as AudioNode, { time: 2, pitch: 72, velocity: 127 })!;
    const src = lastSource(ctx);
    expect(src.playbackRate.value).toBeCloseTo(2, 12);
    expect(src.started).toEqual({ when: 2, offset: 0.1, duration: 0.5 });
    expect(h.end).toBeCloseTo(2.25, 12);
    h.release(2.1);
    expect(src.stops).toEqual([]);
    // trimmed start and end get 2 ms edge fades
    expect(noteGain(ctx).gain.events[0]).toEqual(['set', 0, 2]);
  });

  it('GATED stops on note-off with the zone release', () => {
    const { ctx, inst, out } = setup({ mode: 'gated', release: 0.05 });
    const h = inst.start(asCtx(ctx), out as unknown as AudioNode, { time: 1, pitch: 60, velocity: 100 })!;
    h.release(1.5);
    const src = lastSource(ctx);
    expect(src.stops).toEqual([1.55]);
    expect(noteGain(ctx).gain.events.at(-1)).toEqual(['linear', 0, 1.55]);
    expect(h.end).toBeCloseTo(1.55, 12);
  });

  it('LOOP loops the loop region while held, then releases', () => {
    const { ctx, inst, out } = setup({ mode: 'loop', start: 0.05, loopStart: 0.2, loopEnd: 0.4 });
    const h = inst.start(asCtx(ctx), out as unknown as AudioNode, { time: 0, pitch: 60, velocity: 100 })!;
    const src = lastSource(ctx);
    expect(src.loop).toBe(true);
    expect([src.loopStart, src.loopEnd]).toEqual([0.2, 0.4]);
    expect(src.started).toEqual({ when: 0, offset: 0.05, duration: undefined });
    expect(h.end).toBe(Infinity);
    h.release(3);
    expect(src.stops).toEqual([3.03]);
  });

  it('applies volume, velocity and pan; mono samples are panned at unity when centred', () => {
    const st = setup({ volume: 0.5, pan: -0.25 });
    st.inst.start(asCtx(st.ctx), st.out as unknown as AudioNode, { time: 0, pitch: 60, velocity: 64 });
    expect(noteGain(st.ctx).gain.value).toBeCloseTo(0.5 * Math.pow(64 / 127, 1.5), 12);
    expect(st.ctx.of<FakePanner>('panner').at(-1)!.pan.value).toBe(-0.25);
    const mono = setup({}, 1);
    mono.inst.start(asCtx(mono.ctx), mono.out as unknown as AudioNode, { time: 0, pitch: 60, velocity: 127 });
    expect(noteGain(mono.ctx).gain.value).toBeCloseTo(Math.SQRT2, 12);
  });

  it('a muted zone plays nothing', () => {
    const { ctx, inst, out } = setup({ mute: true });
    expect(inst.start(asCtx(ctx), out as unknown as AudioNode, { time: 0, pitch: 60, velocity: 100 })).toBeNull();
    expect(ctx.of('buffer')).toEqual([]);
  });
});

describe('note player and mixer', () => {
  function rig(z: Partial<SampleZone>, max = 32) {
    const ctx = new FakeContext();
    const mixer = new Mixer(asCtx(ctx), { voices: ['a', 'b'], fxAvailable: false });
    const inst = new SampleInstrument(asBuffer(new FakeBuffer(2, 44100, 44100)), zone(z));
    const player = new NotePlayer(asCtx(ctx), mixer, (v) => (v === 'a' ? inst : null), { maxPerVoice: max });
    return { ctx, mixer, player };
  }

  it('is polyphonic: different keys never cut each other', () => {
    const { ctx, player } = rig({ mode: 'gated' });
    player.noteOn('1:60', 'a', { time: 0, pitch: 60, velocity: 100 });
    player.noteOn('1:64', 'a', { time: 0.1, pitch: 64, velocity: 100 });
    player.noteOn('1:67', 'a', { time: 0.2, pitch: 67, velocity: 100 });
    expect(ctx.of<FakeBufferSource>('buffer').every((s) => s.stops.length === 0)).toBe(true);
    expect(player.activeCount('a', 0.3)).toBe(3);
  });

  it('a repeated key retriggers: GATED releases the old note, ONE SHOT lets it ring', () => {
    const g = rig({ mode: 'gated' });
    g.player.noteOn('1:60', 'a', { time: 0, pitch: 60, velocity: 100 });
    g.player.noteOn('1:60', 'a', { time: 0.5, pitch: 60, velocity: 100 });
    expect(g.ctx.of<FakeBufferSource>('buffer')[0].stops).toEqual([0.53]);
    const o = rig({ mode: 'oneshot' });
    o.player.noteOn('1:60', 'a', { time: 0, pitch: 60, velocity: 100 });
    o.player.noteOn('1:60', 'a', { time: 0.5, pitch: 60, velocity: 100 });
    expect(o.ctx.of<FakeBufferSource>('buffer')[0].stops).toEqual([]);
    expect(o.player.activeCount('a', 0.6)).toBe(2);
  });

  it('note-off releases, unresolved voices are silent, and the oldest note is stolen at the limit', () => {
    const { ctx, player } = rig({ mode: 'gated' }, 2);
    expect(player.noteOn('x', 'b', { time: 0, pitch: 60, velocity: 1 })).toBe(false);
    player.noteOn('k1', 'a', { time: 0, pitch: 60, velocity: 100 });
    player.noteOn('k2', 'a', { time: 0.1, pitch: 62, velocity: 100 });
    player.noteOn('k3', 'a', { time: 0.2, pitch: 64, velocity: 100 });
    const srcs = ctx.of<FakeBufferSource>('buffer');
    expect(srcs[0].stops[0]).toBeCloseTo(0.206, 9);
    player.noteOff('k2', 0.5);
    expect(srcs[1].stops).toEqual([0.53]);
    player.stopAll(0.6); // k3's sample (1 s at +4 semitones) is still playing at 0.6 s
    expect(srcs[2].stops.at(-1)).toBeCloseTo(0.606, 9);
  });

  it('mixes voices through gain, pan and mute/solo gates into the master bus', () => {
    const ctx = new FakeContext();
    const m = new Mixer(asCtx(ctx), { voices: ['a', 'b', 'c'], fxAvailable: false, strips: { a: { gain: 0.4 }, b: { pan: 0.5 } }, masterGain: 0.8, dryTaps: true });
    const gates = () => ['a', 'b', 'c'].map((v) => (m.processedTap(v) as unknown as FakeGain).gain.value);
    expect(gates()).toEqual([1, 1, 1]);
    expect((m.output as unknown as FakeGain).gain.value).toBe(0.8);
    m.setStrip('b', { mute: true });
    expect((m.processedTap('b') as unknown as FakeGain).gain.events.at(-1)).toEqual(['linear', 0, 0.005]);
    m.setStrip('c', { solo: true });
    expect((m.processedTap('a') as unknown as FakeGain).gain.events.at(-1)?.[1]).toBe(0);
    expect((m.dryTap('c') as unknown as FakeGain).gain.events.at(-1)?.[1]).toBe(1);
    expect(m.processing).toBe(false);
    expect(m.settings('a').fx).toEqual(cleanFx());
  });
});

describe('sample decoding', () => {
  const wav = async (channels: Float32Array[], sr = 44100) => new Uint8Array(await encodeWav(channels, sr, 16).arrayBuffer()).buffer;
  const tone = (n: number, f = 440, sr = 44100) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / sr));

  it('reads PCM WAV at its native rate with Good Bits parser', async () => {
    const d = await decodeSample(await wav([tone(4800, 440, 48000), tone(4800, 220, 48000)], 48000), 'piano_C3.wav');
    expect(d.sampleRate).toBe(48000);
    expect(d.channels.length).toBe(2);
    expect(d.frames).toBe(4800);
    expect(d.duration).toBeCloseTo(0.1, 9);
    expect(d.channels[0][100]).toBeCloseTo(tone(4800, 440, 48000)[100], 4);
    expect(d.warnings).toEqual([]);
  });

  it('gives a specific error for each kind of bad file', async () => {
    const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: SampleError) => e.code);
    expect(await code(decodeSample(new ArrayBuffer(0), 'a.wav'))).toBe('empty');
    expect(await code(decodeSample(new ArrayBuffer(100), 'a.wav', { maxBytes: 50 }))).toBe('too-large');
    const junk = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map((c) => c.charCodeAt(0))));
    expect(await code(decodeSample(junk.buffer, 'broken.wav'))).toBe('corrupt');
    expect(await code(decodeSample(new Uint8Array(10).buffer, 'notes.txt'))).toBe('unsupported');
    expect(await code(decodeSample(new Uint8Array(10).buffer, 'x.mp3', { decode: async () => { throw new Error('bad'); } }))).toBe('decode');
    expect(await code(decodeSample(await wav([tone(44100 * 3)]), 'long.wav', { maxSeconds: 2 }))).toBe('too-long');
    expect(await code(decodeSample(await wav([new Float32Array(0)]), 'empty.wav'))).toBe('empty');
  });

  it('warns about silence and extra channels, and uses a supplied decoder for other formats', async () => {
    const silent = await decodeSample(await wav([new Float32Array(100)]), 'quiet.wav');
    expect(silent.warnings[0]).toContain('silent');
    const many = await decodeSample(new ArrayBuffer(4), 'x.ogg', { decode: async () => ({ sampleRate: 44100, channels: [tone(10), tone(10), tone(10)] }) });
    expect(many.channels.length).toBe(2);
    expect(many.warnings[0]).toContain('3 channels');
  });

  it('snaps to zero crossings and draws peaks', () => {
    const audio = { sampleRate: 44100, channels: [tone(4410, 100)] };
    const t = snapToZeroCrossing(audio, 0.0049, 0.002);
    expect(Math.abs(t - 0.005)).toBeLessThan(2 / 44100);
    expect(Math.max(...waveformPeaks(audio, 10))).toBeCloseTo(0.5, 2);
  });
});
