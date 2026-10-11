/**
 * Live internal audio: the AudioContext, the Core mixer and note player, fed by the transport
 * with the sequencer's events (voice index included). It replaces the old audio preview, which
 * listened to the MIDI byte stream and could not tell voices apart. MIDI output is unchanged.
 *
 * The context is created at 44.1 kHz where the browser allows (the export rate), so live
 * processing runs at the same rate as exported audio.
 */
import { NotePlayer } from '../core/audio/player';
import { Mixer } from '../core/audio/mixer';
import { loadOutputFx } from '../core/dsp/output/node';
import type { SeqEvent } from '../engine/sequencer';
import type { AudioSink } from '../transport/transport';
import { voiceId, VOICE_COUNT } from './anvilTimeline';
import type { SampleLibrary } from './library';
import { anvilStrips, FX_SEED, makeResolver } from './routing';
import { isDrumSlot, type ProjectAudio } from './settings';
import { AnvilSynth } from './synth';

export const LIVE_SAMPLE_RATE = 44100;

export class LiveAudio implements AudioSink {
  enabled = false;
  volume = 0.5;
  ctx: AudioContext | null = null;
  /** output processing is running (false without AudioWorklet) */
  processing = false;
  private mixer: Mixer | null = null;
  private player: NotePlayer | null = null;
  private monitor: GainNode | null = null;
  readonly synth = new AnvilSynth();

  constructor(private getAudio: () => ProjectAudio, private library: SampleLibrary, private workletUrl: string | null) {}

  /** Must be called from a user gesture (browser autoplay rules). */
  async enable(): Promise<boolean> {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) {
        let ctx: AudioContext;
        try {
          ctx = new AC({ sampleRate: LIVE_SAMPLE_RATE, latencyHint: 'interactive' });
        } catch {
          ctx = new AC();
        }
        this.ctx = ctx;
        const fx = this.workletUrl ? await loadOutputFx(ctx, this.workletUrl) : false;
        this.processing = fx;
        const a = this.getAudio();
        this.mixer = new Mixer(ctx, { voices: Array.from({ length: VOICE_COUNT }, (_, i) => voiceId(i)), strips: anvilStrips(a), masterFx: a.master, fxAvailable: fx, seed: FX_SEED });
        this.monitor = ctx.createGain();
        this.monitor.gain.value = this.volume;
        this.mixer.output.connect(this.monitor).connect(ctx.destination);
        this.player = new NotePlayer(ctx, this.mixer, makeResolver(this.getAudio, this.library, this.synth));
      }
      await this.ctx.resume();
      this.enabled = true;
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
    this.allOff();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.monitor) this.monitor.gain.value = this.volume;
  }

  /** Push changed processing settings to the running graph (crossfaded in the worklet). */
  sync(): void {
    if (!this.mixer) return;
    const a = this.getAudio();
    const strips = anvilStrips(a);
    for (const [id, s] of Object.entries(strips)) this.mixer.setStrip(id, s);
    this.mixer.setMasterFx(a.master);
  }

  /**
   * performance.now() milliseconds -> AudioContext seconds (never in the past).
   *
   * getOutputTimestamp() pairs an audio-clock time with the performance.now() time at which it
   * is audible, smoothly, unlike ctx.currentTime, which only moves once per audio callback and
   * made note spacing jitter by up to a callback. Adding the context's own latency keeps the
   * mapping relative to the render position (where the original preview scheduled), so the
   * first notes after START (scheduled 30 ms ahead) are never late. Browsers without
   * getOutputTimestamp use currentTime, as the original preview did.
   */
  private at(timeMs: number): number {
    const ctx = this.ctx!;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const t = ts && ts.contextTime !== undefined && ts.performanceTime ? ts.contextTime + latency + (timeMs - ts.performanceTime) / 1000 : ctx.currentTime + (timeMs - performance.now()) / 1000;
    return Math.max(ctx.currentTime, t);
  }

  // ------------------------------------------------------------------ AudioSink (transport)

  note(e: SeqEvent, timeMs: number): void {
    if (!this.enabled || !this.ctx || !this.player) return;
    const key = `${e.ch}:${e.note}`;
    const t = this.at(timeMs);
    if (e.kind === 'off') this.player.noteOff(key, t);
    else if (e.voice >= 0) this.player.noteOn(key, voiceId(e.voice), { time: t, pitch: e.note, velocity: e.vel, channel: e.ch, instrument: e.drum >= 0 ? `drum:${e.drum}` : undefined });
  }

  allNotesOff(timeMs: number): void {
    if (!this.ctx || !this.player) return;
    this.player.releaseAll(this.at(timeMs));
  }

  panic(): void {
    this.allOff();
  }

  started(timeMs: number): void {
    if (!this.enabled || !this.ctx || !this.mixer) return;
    this.mixer.resetFx(this.at(timeMs));
  }

  /** Stop everything at once (panic, disable). */
  allOff(): void {
    if (!this.ctx || !this.player) return;
    this.player.stopAll(this.ctx.currentTime);
  }

  /**
   * Play a slot's sample at its root note through the voice it belongs to (a drum slot goes
   * through the first voice playing drums with SAMPLE selected, else voice 2), with that
   * voice's processing and the master processing.
   */
  audition(slot: number, voices: { harmonyIsDrum: boolean }[]): boolean {
    if (!this.ctx || !this.mixer) return false;
    const inst = this.library.instrument(slot);
    if (!inst) return false;
    const a = this.getAudio();
    let v = slot;
    if (isDrumSlot(slot)) {
      const i = voices.findIndex((x, n) => x.harmonyIsDrum && a.voices[n].source === 'sample');
      v = i >= 0 ? i : 1;
    }
    const t = this.ctx.currentTime + 0.01;
    const h = inst.start(this.ctx, this.mixer.input(voiceId(v)), { time: t, pitch: inst.zone.root, velocity: 110 });
    h?.release(t + 1);
    return !!h;
  }
}
