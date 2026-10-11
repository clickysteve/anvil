import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseWav } from '../../src/core/dsp/vendor/goodbits/js/audio-codec.js';
import { constantTempo } from '../../src/core/events/timeline';
import { fileName, slug, uniqueNames } from '../../src/core/export/names';
import { encodeWav16, levelStats, wavInfo } from '../../src/core/export/wav';
import { crc32, createZip, readZip } from '../../src/core/export/zip';
import { planRenders, renderLength } from '../../src/core/render/offline';

describe('WAV export', () => {
  it('writes a valid 16-bit stereo RIFF header with exact sizes', async () => {
    const n = 44100;
    const L = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i / 10));
    const R = new Float32Array(n);
    const bytes = await encodeWav16([L, R], 44100);
    const info = wavInfo(bytes);
    expect(info).toMatchObject({ format: 1, channels: 2, sampleRate: 44100, bitsPerSample: 16, blockAlign: 4, byteRate: 44100 * 4, dataOffset: 44, dataBytes: n * 4, frames: n });
    expect(info.riffSize).toBe(bytes.length - 8);
    expect(bytes.length).toBe(44 + n * 4);
  });

  it('interleaves channels little-endian and converts with clamp and round (round half up: -0.5 becomes -16383; no dither, no normalising)', async () => {
    const bytes = await encodeWav16([Float32Array.from([0.5, -1, 2, 0]), Float32Array.from([-0.5, 1, -2, 1e-6])], 44100);
    const dv = new DataView(bytes.buffer, 44);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => dv.getInt16(i * 2, true))).toEqual([16384, -16383, -32767, 32767, 32767, -32767, 0, 0]);
    const back = parseWav(bytes.buffer as ArrayBuffer);
    expect(back.numberOfChannels).toBe(2);
    expect(back.getChannelData(0)[0]).toBeCloseTo(0.5, 4);
  });

  it('reports peaks and clipping, and silence', () => {
    expect(levelStats([Float32Array.from([0, 0.5, -1.5, 1.2])])).toMatchObject({ peak: 1.5, clipped: 2, silent: false });
    expect(levelStats([new Float32Array(10)])).toMatchObject({ peak: 0, silent: true, peakDb: -Infinity });
    expect(levelStats([Float32Array.from([0.5])]).peakDb).toBeCloseTo(-6.0206, 3);
  });
});

describe('ZIP', () => {
  const enc = new TextEncoder();
  it('round-trips stored files with correct CRCs and is deterministic', async () => {
    const files = [{ name: 'a.wav', data: new Uint8Array([1, 2, 3]) }, { name: 'dir/b.json', data: enc.encode('{"x":1}') }, { name: 'empty.txt', data: new Uint8Array(0) }];
    const z1 = createZip(files);
    expect(z1).toEqual(createZip(files));
    const back = await readZip(z1);
    expect(back.map((f) => f.name)).toEqual(['a.wav', 'dir/b.json', 'empty.txt']);
    expect(back[1].data).toEqual(files[1].data);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('reads deflated entries made by other tools and rejects damage', async () => {
    const data = enc.encode('hello hello hello hello');
    const z = createZip([{ name: 'x.txt', data }]);
    // rewrite as a deflated archive by hand
    const comp = new Uint8Array(deflateRawSync(data));
    const head = z.slice(0, 30 + 5);
    const dvh = new DataView(head.buffer);
    dvh.setUint16(8, 8, true);
    dvh.setUint32(18, comp.length, true);
    const central = z.slice(30 + 5 + data.length, z.length - 22);
    const dvc = new DataView(central.buffer);
    dvc.setUint16(10, 8, true);
    dvc.setUint32(20, comp.length, true);
    const end = z.slice(z.length - 22);
    new DataView(end.buffer).setUint32(16, head.length + comp.length, true);
    const deflated = new Uint8Array([...head, ...comp, ...central, ...end]);
    expect((await readZip(deflated))[0].data).toEqual(data);
    const bad = z.slice();
    bad[36] ^= 0xff; // flip a data byte (header 30 + name 5)
    await expect(readZip(bad)).rejects.toThrow(/corrupt/);
    await expect(readZip(new Uint8Array(30))).rejects.toThrow(/not a ZIP/);
    expect(() => createZip([{ name: 'a', data }, { name: 'a', data }])).toThrow(/duplicate/);
  });
});

describe('names', () => {
  it('sanitises and shortens', () => {
    expect(slug('My Big Song (Final!!) — vérsion 2', 24)).toBe('my-big-song-final-versio');
    expect(slug('***')).toBe('');
    expect(fileName(['anvil', '', 'item-ta', 'master'], 'wav')).toBe('anvil_item-ta_master.wav');
    expect(uniqueNames(['a.wav', 'a.wav', 'b.wav', 'a.wav'])).toEqual(['a.wav', 'a-2.wav', 'b.wav', 'a-3.wav']);
  });
});

describe('render planning', () => {
  it('puts every output in one render when it fits, and splits whole outputs when not', () => {
    const outs = [{ kind: 'master' as const, processed: true }, ...[1, 2, 3, 4, 5, 6].map((v) => ({ kind: 'stem' as const, voice: `v${v}`, processed: true }))];
    expect(planRenders(outs, 44100 * 10, 384 * 2 ** 20).length).toBe(1);
    const split = planRenders(outs, 44100 * 600, 384 * 2 ** 20);
    expect(split.length).toBeGreaterThan(1);
    expect(split.flat()).toEqual(outs);
    expect(planRenders(outs, 44100 * 10, 1).every((g) => g.length === 1)).toBe(true);
  });

  it('computes one shared length: music plus tail', () => {
    const t = { tempo: constantTempo(120, 24), length: 96 * 4, voices: [], events: [] };
    expect(renderLength(t, 2, 44100)).toEqual({ musicSeconds: 8, frames: 44100 * 10 });
  });
});
