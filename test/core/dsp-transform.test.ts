import { describe, expect, it } from 'vitest';
import { renderFx } from '../../src/core/dsp/vendor/goodbits/js/stretch-fx/render.js';
import { identityTransform, isIdentity, repairTransform, stretchCharacters, toRecipe, transformKey, type SampleTransform } from '../../src/core/dsp/transform/settings';
import { applyTransform } from '../../src/core/dsp/transform/transform';
import { TransformCache, type TransformRunner } from '../../src/core/dsp/transform/cache';

const SR = 22050;
function hit(seconds = 0.4): Float32Array[] {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / (SR * 0.08));
    L[i] = 0.8 * env * Math.sin((2 * Math.PI * 180 * i) / SR);
    R[i] = 0.6 * env * Math.sin((2 * Math.PI * 240 * i) / SR);
  }
  return [L, R];
}
const tf = (patch: Partial<SampleTransform>): SampleTransform => ({ ...identityTransform(), enabled: true, ...patch });

describe('sample transformations (Good Bits STRETCH FX)', () => {
  it('is the identity when disabled: the very same audio object comes back', () => {
    const audio = { sampleRate: SR, channels: hit() };
    expect(applyTransform(audio, identityTransform())).toBe(audio);
    expect(isIdentity(identityTransform())).toBe(true);
  });

  it('equals renderFx on the equivalent recipe, bit for bit', () => {
    const t = tf({ character: 'cyclic12', ratio: 2, reverse: 'post', pitch: -3, drive: { enabled: true, type: 'tube', amountPct: 30 }, crunch: { enabled: true, bits: 10, rateDivide: 2 }, macros: { cycle: 70, crossfade: 30 }, seed: 9 });
    const src = hit();
    const ref = renderFx({ channels: src, sampleRate: SR, recipe: toRecipe(t) });
    expect(applyTransform({ sampleRate: SR, channels: src }, t).channels).toEqual(ref.channels);
    expect(toRecipe(t).passes).toEqual([{ character: 'cyclic12', ratio: 2, macroValues: { cycle: 70, crossfade: 30 } }]);
  });

  it('stretches by the ratio and varispeed pitch changes length with pitch', () => {
    const src = hit();
    const n = src[0].length;
    expect(applyTransform({ sampleRate: SR, channels: src }, tf({ character: 'clean', ratio: 2 })).channels[0].length).toBeCloseTo(2 * n, -2);
    expect(applyTransform({ sampleRate: SR, channels: src }, tf({ pitch: -12 })).channels[0].length).toBeCloseTo(2 * n, -1);
    expect(applyTransform({ sampleRate: SR, channels: src }, tf({ pitch: 12 })).channels[0].length).toBeCloseTo(n / 2, -1);
  });

  it('runs every Good Bits character deterministically with finite, stereo output', () => {
    const src = hit(0.25);
    for (const g of stretchCharacters()) {
      for (const c of g.characters) {
        const t = tf({ character: c.key, ratio: 1.5, seed: 3 });
        const a = applyTransform({ sampleRate: SR, channels: src }, t);
        const b = applyTransform({ sampleRate: SR, channels: src }, t);
        expect(a.channels, c.key).toEqual(b.channels);
        expect(a.channels.length).toBe(2);
        for (const ch of a.channels) for (const v of ch) expect(Number.isFinite(v)).toBe(true);
      }
    }
  }, 60_000);

  it('keeps Good Bits generic character names', () => {
    const labels = stretchCharacters().flatMap((g) => g.characters.map((c) => c.label));
    expect(labels).toContain('Cyclic 12-bit');
    expect(labels).toContain("'93");
    expect(labels).toContain('Tape');
  });

  it('repairs stored settings and gives stable cache keys', () => {
    const r = repairTransform({ enabled: true, character: 'nope', ratio: 100, pitch: -99, crunch: { enabled: true, bits: 0 }, macros: { roughness: 140, bogus: 3 } });
    expect(r.character).toBe('clean');
    expect(r.ratio).toBe(8);
    expect(r.pitch).toBe(-24);
    expect(r.crunch.bits).toBe(1);
    expect(r.macros).toEqual({ roughness: 100 });
    expect(transformKey(identityTransform())).toBe('identity');
    expect(transformKey(tf({ ratio: 2 }))).toBe(transformKey(tf({ ratio: 2 })));
    expect(transformKey(tf({ ratio: 2 }))).not.toBe(transformKey(tf({ ratio: 3 })));
    expect(repairTransform(undefined)).toEqual(identityTransform());
  });
});

describe('transform cache', () => {
  it('computes each (sample, settings) once and drops on request', async () => {
    let runs = 0;
    const runner: TransformRunner = { run: async (a, t) => (runs++, applyTransform(a, t)) };
    const cache = new TransformCache(runner);
    const audio = { sampleRate: SR, channels: hit(0.1) };
    const t = tf({ pitch: 5 });
    const [a, b] = await Promise.all([cache.get('s1', audio, t), cache.get('s1', audio, t)]);
    expect(a).toBe(b);
    expect(runs).toBe(1);
    expect(await cache.get('s1', audio, identityTransform())).toBe(audio);
    expect(runs).toBe(1);
    cache.drop('s1');
    await cache.get('s1', audio, t);
    expect(runs).toBe(2);
  });

  it('forgets failed runs so they can be retried', async () => {
    let fail = true;
    const cache = new TransformCache({ run: async (a, t) => { if (fail) throw new Error('boom'); return applyTransform(a, t); } });
    const audio = { sampleRate: SR, channels: hit(0.1) };
    await expect(cache.get('x', audio, tf({ pitch: 1 }))).rejects.toThrow('boom');
    fail = false;
    await expect(cache.get('x', audio, tf({ pitch: 1 }))).resolves.toBeTruthy();
  });
});
