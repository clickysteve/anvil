/**
 * Audio preview: a small built-in synth that plays the same note stream ANVIL sends to MIDI,
 * so ANVIL can be heard without hardware. It listens to the output router; it never changes
 * what is sent. Channel 10 plays short noise/tone percussion; other channels a simple
 * two-oscillator voice whose waveform depends on the channel.
 */
import type { Direction } from '../midi/router';

const WAVES: OscillatorType[] = ['triangle', 'square', 'sawtooth', 'triangle', 'sine', 'square', 'sawtooth', 'triangle'];

interface Playing {
  osc: OscillatorNode[];
  gain: GainNode;
}

export class AudioPreview {
  enabled = false;
  volume = 0.5;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Playing>();
  private noise: AudioBuffer | null = null;

  /** Must be called from a user gesture (browser autoplay rules). */
  async enable(): Promise<boolean> {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume * 0.4;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.3);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let x = 12345;
        for (let i = 0; i < len; i++) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          d[i] = (x / 0x3fffffff - 1) * (1 - i / len);
        }
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
    if (this.master) this.master.gain.value = this.volume * 0.4;
  }

  /** performance.now() timestamp -> AudioContext time */
  private at(time: number): number {
    const ctx = this.ctx!;
    return Math.max(ctx.currentTime, ctx.currentTime + (time - performance.now()) / 1000);
  }

  /** Router listener. */
  handle = (bytes: number[], time: number, dir: Direction): void => {
    if (!this.enabled || !this.ctx || dir !== 'out') return;
    const st = bytes[0] & 0xf0;
    const ch = (bytes[0] & 15) + 1;
    if (st === 0x90 && bytes[2] > 0) this.on(ch, bytes[1], bytes[2], time);
    else if (st === 0x80 || (st === 0x90 && bytes[2] === 0)) this.off(ch, bytes[1], time);
    else if (st === 0xb0 && (bytes[1] === 120 || bytes[1] === 123)) this.allOff();
  };

  private on(ch: number, note: number, vel: number, time: number): void {
    const ctx = this.ctx!;
    const t = this.at(time);
    const key = `${ch}:${note}`;
    this.off(ch, note, time);
    const g = ctx.createGain();
    const peak = (vel / 127) ** 1.5 * 0.5;
    if (ch === 10) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = note < 40 ? 'lowpass' : note < 48 ? 'bandpass' : 'highpass';
      f.frequency.value = note < 40 ? 180 : note < 48 ? 1200 : 6000;
      src.connect(f).connect(g).connect(this.master!);
      g.gain.setValueAtTime(peak * 1.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (note === 46 || note === 49 ? 0.28 : 0.12));
      src.start(t);
      src.stop(t + 0.3);
      return;
    }
    const freq = 440 * 2 ** ((note - 69) / 12);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = WAVES[(ch - 1) % WAVES.length];
    o2.type = 'sine';
    o1.frequency.value = freq;
    o2.frequency.value = freq * 1.003;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(9000, 600 + vel * 30);
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.master!);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.setTargetAtTime(peak * 0.6, t + 0.01, 0.15);
    o1.start(t);
    o2.start(t);
    this.voices.set(key, { osc: [o1, o2], gain: g });
  }

  private off(ch: number, note: number, time: number): void {
    const key = `${ch}:${note}`;
    const v = this.voices.get(key);
    if (!v || !this.ctx) return;
    this.voices.delete(key);
    const t = this.at(time);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.03);
    for (const o of v.osc) o.stop(t + 0.2);
  }

  allOff(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices.values()) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.01);
      for (const o of v.osc) o.stop(t + 0.1);
    }
    this.voices.clear();
  }
}
