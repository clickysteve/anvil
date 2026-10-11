/**
 * Streaming output processor: Good Bits' lo-fi chain run sample by sample, so the same code
 * serves an AudioWorklet (live and OfflineAudioContext) and plain buffers.
 *
 * Every stage calls the vendored Good Bits code (`MODE_FACTORIES`, `driveShapeFor`,
 * `makeOnePoleLP`) or repeats its arithmetic exactly (crunch, mix/intensity), rounding to
 * 32-bit float between stages as Good Bits' whole-buffer functions do when they write each
 * stage into a Float32Array. The result is bit-identical to `applyLofiChain` for the same
 * input, settings and seed, whatever the block size (see test/core/dsp-output.test.ts).
 */
import { driveShapeFor, makeOnePoleLP, makeRng, MODE_FACTORIES } from '../vendor/goodbits/js/outputstage.js';
import { isClean, type OutputFxSettings } from './settings';

/** Processes a stereo block in place. */
export type BlockFn = (l: Float32Array, r: Float32Array, n: number) => void;

const f32 = Math.fround;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const dbToGain = (db: number) => (db === 0 ? 1 : Math.pow(10, db / 20));

/** Build the chain for one set of settings. Its state (filters, noise, hold counter) starts fresh. */
export function createChain(s: OutputFxSettings, sampleRate: number, seed: number): BlockFn {
  if (isClean(s)) return () => {};
  const inG = dbToGain(s.inDb);
  const outG = dbToGain(s.outDb);

  // output stage (applyOutputStage)
  const mix = clamp01((s.outputStage.mixPct ?? 100) / 100);
  const factory = MODE_FACTORIES[s.outputStage.mode];
  const stage = s.outputStage.enabled && mix > 0.0001 && s.outputStage.mode !== 'clean' && factory ? factory(sampleRate, makeRng(seed)) : null;
  const intensity = clamp01((s.outputStage.intensityPct ?? 50) / 100);

  // drive (applyDrive)
  const d = s.drive.enabled ? clamp01((s.drive.amountPct ?? 0) / 100) : 0;
  const useDrive = d > 0.0001;
  const g = 1 + d * 5;
  const shape = driveShapeFor(s.drive.type);

  // crunch (applyCrunch)
  const bits = Math.max(1, Math.min(16, Math.round(s.crunch.bits ?? 16)));
  const rate = Math.max(1, Math.min(32, Math.round(s.crunch.rateDivide ?? 1)));
  const hasBits = s.crunch.enabled && bits < 16;
  const hasRate = s.crunch.enabled && rate > 1;
  const useCrunch = hasBits || hasRate;
  const step = 2 / Math.pow(2, bits);
  let index = 0;
  let heldL = 0;
  let heldR = 0;

  // tone (Good Bits one-pole low-pass)
  const useTone = s.tone.enabled && s.tone.hz < 20000;
  const lpL = makeOnePoleLP(sampleRate, s.tone.hz);
  const lpR = makeOnePoleLP(sampleRate, s.tone.hz);

  return (L, R, n) => {
    for (let k = 0; k < n; k++) {
      let l = inG === 1 ? L[k] : f32(L[k] * inG);
      let r = inG === 1 ? R[k] : f32(R[k] * inG);
      if (stage) {
        const [rawL, rawR] = stage(l, r);
        const wetL = l + (rawL - l) * intensity;
        const wetR = r + (rawR - r) * intensity;
        l = f32(l + (wetL - l) * mix);
        r = f32(r + (wetR - r) * mix);
      }
      if (useDrive) {
        l = f32((1 - d) * l + d * shape(l, g, d));
        r = f32((1 - d) * r + d * shape(r, g, d));
      }
      if (useCrunch) {
        if (!hasRate || index % rate === 0) {
          heldL = l;
          heldR = r;
        }
        index++;
        l = hasBits ? f32(Math.round(heldL / step) * step) : heldL;
        r = hasBits ? f32(Math.round(heldR / step) * step) : heldR;
      }
      if (useTone) {
        l = f32(lpL(l));
        r = f32(lpR(r));
      }
      L[k] = outG === 1 ? l : l * outG;
      R[k] = outG === 1 ? r : r * outG;
    }
  };
}

/** Samples over which a settings change crossfades from the old chain to the new one. */
export const SETTINGS_FADE = 256;

/**
 * A processor whose settings can change while it runs. A change starts a new chain and
 * crossfades from the old one over SETTINGS_FADE samples, so switching never clicks.
 */
export class OutputFxStream {
  private chain: BlockFn;
  private old: BlockFn | null = null;
  private fadeLeft = 0;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);

  constructor(private settings: OutputFxSettings, readonly sampleRate: number, readonly seed: number) {
    this.chain = createChain(settings, sampleRate, seed);
  }

  get current(): OutputFxSettings {
    return this.settings;
  }

  set(settings: OutputFxSettings): void {
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    this.old = this.chain;
    this.fadeLeft = SETTINGS_FADE;
    this.settings = settings;
    this.chain = createChain(settings, this.sampleRate, this.seed);
  }

  /** Start the current settings' state afresh (noise, filters, hold phase), with no crossfade. */
  reset(): void {
    this.old = null;
    this.fadeLeft = 0;
    this.chain = createChain(this.settings, this.sampleRate, this.seed);
  }

  process(L: Float32Array, R: Float32Array, n = L.length): void {
    if (!this.old || this.fadeLeft <= 0) {
      this.chain(L, R, n);
      return;
    }
    if (this.scratchL.length < n) {
      this.scratchL = new Float32Array(n);
      this.scratchR = new Float32Array(n);
    }
    const oL = this.scratchL;
    const oR = this.scratchR;
    oL.set(L.subarray(0, n));
    oR.set(R.subarray(0, n));
    this.old(oL, oR, n);
    this.chain(L, R, n);
    for (let k = 0; k < n; k++) {
      if (this.fadeLeft <= 0) break;
      const t = 1 - this.fadeLeft / SETTINGS_FADE;
      L[k] = oL[k] + (L[k] - oL[k]) * t;
      R[k] = oR[k] + (R[k] - oR[k]) * t;
      this.fadeLeft--;
    }
    if (this.fadeLeft <= 0) this.old = null;
  }
}

/** Run a processor over whole stereo buffers (offline helper; same code as the worklet). */
export function processBuffers(channels: Float32Array[], sampleRate: number, settings: OutputFxSettings, seed: number, blockSize = 128): Float32Array[] {
  const L = Float32Array.from(channels[0]);
  const R = Float32Array.from(channels[1] ?? channels[0]);
  const s = new OutputFxStream(settings, sampleRate, seed);
  for (let i = 0; i < L.length; i += blockSize) {
    const n = Math.min(blockSize, L.length - i);
    s.process(L.subarray(i, i + n), R.subarray(i, i + n), n);
  }
  return [L, R];
}
