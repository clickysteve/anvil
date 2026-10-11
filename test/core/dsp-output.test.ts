import { describe, expect, it } from 'vitest';
import { applyCrunch, applyDrive, applyLofiChain, applyOutputStage, makeOnePoleLP } from '../../src/core/dsp/vendor/goodbits/js/outputstage.js';
import { cleanFx, FX_PRESETS, fxLabel, isClean, matchPreset, OUTPUT_STAGE_MODES, repairFx, type OutputFxSettings } from '../../src/core/dsp/output/settings';
import { createChain, OutputFxStream, processBuffers, SETTINGS_FADE } from '../../src/core/dsp/output/stream';

const SR = 44100;

/** Deterministic stereo test signal: two tones, a ramp and some pseudo-noise, peaking above 1. */
function signal(n = 6000, sr = SR): Float32Array[] {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let x = 99;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const noise = (x / 0x3fffffff - 1) * 0.1;
    L[i] = 0.7 * Math.sin((2 * Math.PI * 220 * i) / sr) + noise + (i / n) * 0.5;
    R[i] = 0.6 * Math.sin((2 * Math.PI * 331 * i) / sr) - noise;
  }
  return [L, R];
}

const fx = (patch: Partial<OutputFxSettings>): OutputFxSettings => ({ ...cleanFx(), ...patch });

describe('streaming output processor vs Good Bits whole-buffer functions', () => {
  const src = signal();

  it('crunch is bit-identical to applyCrunch at any block size', () => {
    for (const [bits, rateDivide] of [[12, 2], [4, 7], [16, 3], [8, 1], [1, 32]]) {
      const s = fx({ crunch: { enabled: true, bits, rateDivide } });
      const ref = applyCrunch(src, { bits, rateDivide });
      for (const block of [128, 37, 6000]) expect(processBuffers(src, SR, s, 1, block)).toEqual(ref);
    }
  });

  it('drive is bit-identical to applyDrive for every shape', () => {
    for (const type of ['tape', 'tube', 'diode', 'fuzz']) {
      for (const amountPct of [5, 40, 100]) {
        const s = fx({ drive: { enabled: true, type, amountPct } });
        expect(processBuffers(src, SR, s, 1)).toEqual(applyDrive(src, type, amountPct));
      }
    }
  });

  it('every output-stage mode is bit-identical to applyOutputStage with the same seed', () => {
    for (const m of OUTPUT_STAGE_MODES) {
      const s = fx({ outputStage: { enabled: true, mode: m.key, mixPct: 80, intensityPct: 65 } });
      expect(processBuffers(src, SR, s, 1234), m.key).toEqual(applyOutputStage(src, SR, m.key, 80, 65, 1234));
    }
  });

  it('the full chain is bit-identical to applyLofiChain, at 44.1 and 48 kHz', () => {
    const settings = {
      outputStage: { enabled: true, mode: 'vinyl', mixPct: 70, intensityPct: 40 },
      drive: { enabled: true, type: 'tube', amountPct: 35 },
      crunch: { enabled: true, bits: 10, rateDivide: 3 },
    };
    for (const sr of [44100, 48000]) {
      const sig = signal(5000, sr);
      expect(processBuffers(sig, sr, fx(settings), 77, 128)).toEqual(applyLofiChain(sig, sr, settings, 77));
    }
  });

  it('handles mono sources like Good Bits does (one channel treated as both)', () => {
    const mono = [signal()[0]];
    const s = fx({ outputStage: { enabled: true, mode: 'boombox', mixPct: 100, intensityPct: 100 }, crunch: { enabled: true, bits: 6, rateDivide: 2 } });
    const ref = applyLofiChain(mono, SR, { outputStage: s.outputStage, crunch: s.crunch }, 5);
    // Good Bits returns only the left output for a mono source; some modes (Boombox shares one
    // high-pass between channels) give a different right output even for identical inputs.
    const [L] = processBuffers(mono, SR, s, 5);
    expect(L).toEqual(ref[0]);
  });

  it('keeps stereo channels independent', () => {
    const s = fx({ crunch: { enabled: true, bits: 8, rateDivide: 2 } });
    const [L, R] = processBuffers(src, SR, s, 1);
    expect(L).toEqual(applyCrunch([src[0]], { bits: 8, rateDivide: 2 })[0]);
    expect(R).toEqual(applyCrunch([src[1]], { bits: 8, rateDivide: 2 })[0]);
  });

  it('applies Tone with Good Bits one-pole low-pass after the chain', () => {
    const s = fx({ tone: { enabled: true, hz: 3000 } });
    const lp = makeOnePoleLP(SR, 3000);
    const ref = Float32Array.from(src[0], (v) => lp(v));
    expect(processBuffers(src, SR, s, 1)[0]).toEqual(ref);
  });
});

describe('clean, bypass, gain and boundaries', () => {
  const src = signal();
  it('CLEAN and BYPASS leave every sample unchanged', () => {
    expect(processBuffers(src, SR, cleanFx(), 1)).toEqual(src);
    const busy = FX_PRESETS.find((p) => p.key === '12bit')!.apply(cleanFx());
    expect(processBuffers(src, SR, { ...busy, bypass: true }, 1)).toEqual(src);
    expect(isClean(cleanFx())).toBe(true);
    expect(isClean(busy)).toBe(false);
  });

  it('applies input and output gain in dB', () => {
    const [L] = processBuffers(src, SR, fx({ outDb: -6.0206 }), 1);
    for (let i = 0; i < 100; i++) expect(L[i]).toBeCloseTo(src[0][i] / 2, 4);
    const [L2] = processBuffers(src, SR, fx({ inDb: 6.0206 }), 1);
    expect(L2[10]).toBeCloseTo(src[0][10] * 2, 4);
  });

  it('repairs out-of-range and missing settings', () => {
    const r = repairFx({ inDb: 99, crunch: { enabled: true, bits: 40, rateDivide: 0.2 }, drive: { type: 'laser' }, outputStage: { mode: 'nope', mixPct: -5 }, tone: { hz: 5 } });
    expect(r.inDb).toBe(24);
    expect(r.crunch).toEqual({ enabled: true, bits: 16, rateDivide: 1 });
    expect(r.drive.type).toBe('tape');
    expect(r.outputStage.mode).toBe('cassette');
    expect(r.outputStage.mixPct).toBe(0);
    expect(r.tone.hz).toBe(200);
    expect(repairFx(undefined)).toEqual(cleanFx());
  });

  it('never produces non-finite output at extreme settings', () => {
    const loud = signal().map((c) => c.map((v) => v * 8));
    const s = fx({ inDb: 24, outDb: 24, drive: { enabled: true, type: 'fuzz', amountPct: 100 }, crunch: { enabled: true, bits: 1, rateDivide: 32 }, outputStage: { enabled: true, mode: 'damaged', mixPct: 100, intensityPct: 100 } });
    for (const ch of processBuffers(loud, SR, s, 3)) for (const v of ch) expect(Number.isFinite(v)).toBe(true);
  });

  it('labels settings by preset or stage', () => {
    expect(fxLabel(cleanFx())).toBe('CLEAN');
    expect(fxLabel({ ...cleanFx(), bypass: true })).toBe('BYPASS');
    for (const p of FX_PRESETS) expect(matchPreset(p.apply(cleanFx()))).toBe(p.key);
    expect(fxLabel(fx({ crunch: { enabled: true, bits: 9, rateDivide: 3 } }))).toBe('9BIT/3');
  });
});

describe('determinism and live parameter changes', () => {
  const src = signal();
  it('is deterministic for a seed and varies between seeds', () => {
    const s = fx({ outputStage: { enabled: true, mode: 'cassette', mixPct: 100, intensityPct: 100 } });
    expect(processBuffers(src, SR, s, 9)).toEqual(processBuffers(src, SR, s, 9));
    expect(processBuffers(src, SR, s, 9)[0]).not.toEqual(processBuffers(src, SR, s, 10)[0]);
  });

  it('crossfades a settings change over SETTINGS_FADE samples', () => {
    const a = fx({ crunch: { enabled: true, bits: 4, rateDivide: 1 } });
    const b = cleanFx();
    const stream = new OutputFxStream(a, SR, 1);
    const L = Float32Array.from(src[0].subarray(0, 1024));
    const R = Float32Array.from(src[1].subarray(0, 1024));
    stream.process(L.subarray(0, 128), R.subarray(0, 128), 128);
    stream.set(b);
    stream.process(L.subarray(128), R.subarray(128), 896);
    const oldOut = applyCrunch([src[0].subarray(0, 1024)], { bits: 4 })[0];
    expect(L[128]).toBeCloseTo(oldOut[128], 6); // starts on the old sound
    for (let k = 128 + SETTINGS_FADE; k < 1024; k++) expect(L[k]).toBe(src[0][k]); // ends on the new one
    // no step larger than the signal itself makes across the fade
    let maxStep = 0;
    for (let k = 129; k < 128 + SETTINGS_FADE; k++) maxStep = Math.max(maxStep, Math.abs(L[k] - L[k - 1]));
    expect(maxStep).toBeLessThan(0.3);
  });

  it('reset() restarts state so a run from reset equals a fresh processor', () => {
    const s = fx({ outputStage: { enabled: true, mode: 'vhs', mixPct: 100, intensityPct: 80 }, crunch: { enabled: true, bits: 8, rateDivide: 5 } });
    const stream = new OutputFxStream(s, SR, 4);
    const junk = signal(333);
    stream.process(junk[0], junk[1], 333);
    stream.reset();
    const L = Float32Array.from(src[0]);
    const R = Float32Array.from(src[1]);
    stream.process(L, R, L.length);
    expect([L, R]).toEqual(processBuffers(src, SR, s, 4));
  });

  it('a chain built for CLEAN is a no-op function', () => {
    const L = Float32Array.from([0.5, -0.25]);
    createChain(cleanFx(), SR, 1)(L, L, 2);
    expect(Array.from(L)).toEqual([0.5, -0.25]);
  });
});
