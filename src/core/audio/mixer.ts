/**
 * Audio routing shared by live playback and offline rendering:
 *
 *   instrument notes -> voice input -> voice processing -> voice gain -> pan -> mute/solo gate --+
 *                            \-> (dry tap: gain -> pan -> gate, for unprocessed stems)            |
 *                                                                                                 v
 *                                       master bus -> master processing -> master gain -> output
 *
 * Every voice also exposes its processed signal as a tap (post gate) for stem rendering.
 * Works on any BaseAudioContext. Deliberately not a DAW mixer: no sends, no automation.
 */
import { createOutputFxNode, type OutputFxNode } from '../dsp/output/node';
import { cleanFx, type OutputFxSettings } from '../dsp/output/settings';

export interface StripSettings {
  gain: number;
  /** -1..1 */
  pan: number;
  mute: boolean;
  solo: boolean;
  fx: OutputFxSettings;
}

export const defaultStrip = (): StripSettings => ({ gain: 1, pan: 0, mute: false, solo: false, fx: cleanFx() });

export interface MixerOptions {
  voices: string[];
  strips?: Record<string, Partial<StripSettings>>;
  masterFx?: OutputFxSettings;
  masterGain?: number;
  /** resolved result of loadOutputFx() for this context */
  fxAvailable: boolean;
  /** base seed for the processors' noise generators */
  seed?: number;
  /** build unprocessed taps as well (only needed for unprocessed stem export) */
  dryTaps?: boolean;
}

interface Strip {
  settings: StripSettings;
  input: GainNode;
  fx: OutputFxNode;
  gain: GainNode;
  pan: StereoPannerNode;
  gate: GainNode;
  dry?: { gain: GainNode; pan: StereoPannerNode; gate: GainNode };
}

/** Deterministic per-strip seed. */
export const stripSeed = (seed: number, index: number): number => (Math.imul((seed ^ (index + 1)) >>> 0, 0x9e3779b1) ^ (index << 7)) >>> 0;

const RAMP = 0.005;

export class Mixer {
  private strips = new Map<string, Strip>();
  readonly masterBus: GainNode;
  readonly masterFx: OutputFxNode;
  readonly output: GainNode;
  readonly voices: string[];

  constructor(readonly ctx: BaseAudioContext, opts: MixerOptions) {
    this.voices = [...opts.voices];
    const seed = opts.seed ?? 1;
    this.masterBus = ctx.createGain();
    this.masterFx = createOutputFxNode(ctx, opts.masterFx ?? cleanFx(), stripSeed(seed, 1000), opts.fxAvailable);
    this.output = ctx.createGain();
    this.output.gain.value = opts.masterGain ?? 1;
    this.masterBus.connect(this.masterFx.node).connect(this.output);
    opts.voices.forEach((id, i) => {
      const s = { ...defaultStrip(), ...opts.strips?.[id] };
      const input = ctx.createGain();
      const fx = createOutputFxNode(ctx, s.fx, stripSeed(seed, i), opts.fxAvailable);
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const gate = ctx.createGain();
      input.connect(fx.node).connect(gain).connect(pan).connect(gate).connect(this.masterBus);
      const strip: Strip = { settings: s, input, fx, gain, pan, gate };
      if (opts.dryTaps) {
        // the same stereo up-mix the processor does, so dry and processed stems match in CLEAN
        const up = ctx.createGain();
        up.channelCount = 2;
        up.channelCountMode = 'explicit';
        up.channelInterpretation = 'speakers';
        const dg = ctx.createGain();
        const dp = ctx.createStereoPanner();
        const dgate = ctx.createGain();
        input.connect(up).connect(dg).connect(dp).connect(dgate);
        strip.dry = { gain: dg, pan: dp, gate: dgate };
      }
      this.strips.set(id, strip);
    });
    this.applyLevels(true);
  }

  private strip(id: string): Strip {
    const s = this.strips.get(id);
    if (!s) throw new Error(`unknown voice "${id}"`);
    return s;
  }

  /** Where an instrument playing on this voice connects. */
  input(id: string): AudioNode {
    return this.strip(id).input;
  }

  /** The voice's processed signal after gain, pan and mute (a stem). */
  processedTap(id: string): AudioNode {
    return this.strip(id).gate;
  }

  /** The voice's signal before processing, after gain, pan and mute (requires dryTaps). */
  dryTap(id: string): AudioNode {
    const d = this.strip(id).dry;
    if (!d) throw new Error('dry taps were not built');
    return d.gate;
  }

  settings(id: string): StripSettings {
    return this.strip(id).settings;
  }

  setStrip(id: string, patch: Partial<StripSettings>): void {
    const s = this.strip(id);
    s.settings = { ...s.settings, ...patch };
    if (patch.fx) s.fx.set(patch.fx);
    this.applyLevels(false);
  }

  setMasterFx(fx: OutputFxSettings): void {
    this.masterFx.set(fx);
  }

  setMasterGain(g: number): void {
    this.ramp(this.output.gain, g, false);
  }

  /** Restart every processor's state at context time `at` (live START). */
  resetFx(at: number): void {
    for (const s of this.strips.values()) s.fx.reset(at);
    this.masterFx.reset(at);
  }

  /** Whether output processing actually runs (false: the browser lacks AudioWorklet). */
  get processing(): boolean {
    return this.masterFx.processing;
  }

  private ramp(p: AudioParam, v: number, instant: boolean): void {
    if (instant) {
      p.value = v;
      return;
    }
    const t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + RAMP);
  }

  private applyLevels(instant: boolean): void {
    const anySolo = [...this.strips.values()].some((s) => s.settings.solo);
    for (const s of this.strips.values()) {
      const audible = anySolo ? s.settings.solo : !s.settings.mute;
      this.ramp(s.gain.gain, s.settings.gain, instant);
      this.ramp(s.pan.pan, s.settings.pan, instant);
      this.ramp(s.gate.gain, audible ? 1 : 0, instant);
      if (s.dry) {
        this.ramp(s.dry.gain.gain, s.settings.gain, instant);
        this.ramp(s.dry.pan.pan, s.settings.pan, instant);
        this.ramp(s.dry.gate.gain, audible ? 1 : 0, instant);
      }
    }
  }

  dispose(): void {
    for (const s of this.strips.values()) {
      s.input.disconnect();
      s.fx.dispose();
      s.gain.disconnect();
      s.pan.disconnect();
      s.gate.disconnect();
    }
    this.masterBus.disconnect();
    this.masterFx.dispose();
    this.output.disconnect();
  }
}
