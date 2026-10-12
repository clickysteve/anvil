/**
 * ANVIL's internal synthesiser, as a Slop Factory Core instrument. The sound is unchanged
 * from the original audio preview (this is its code, moved): channel 10 plays short filtered
 * noise percussion; other channels a two-oscillator voice whose waveform depends on the MIDI
 * channel, through a velocity-dependent low-pass, with the same envelope.
 *
 * Level: the preview scaled its whole output by 0.4 x volume at one master gain. Now each
 * voice strip applies the 0.4 (MIX_HEADROOM) and the monitor applies the volume, which is the
 * same product.
 */
import type { Instrument, NoteHandle, NoteRequest } from '@slopfactory/core/audio';

const WAVES: OscillatorType[] = ['triangle', 'square', 'sawtooth', 'triangle', 'sine', 'square', 'sawtooth', 'triangle'];

/** The fixed mix headroom the original preview applied to everything. */
export const MIX_HEADROOM = 0.4;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    const len = Math.floor(ctx.sampleRate * 0.3);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let x = 12345;
    for (let i = 0; i < len; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (x / 0x3fffffff - 1) * (1 - i / len);
    }
    noiseBuffers.set(ctx, b);
  }
  return b;
}

export class AnvilSynth implements Instrument {
  start(ctx: BaseAudioContext, out: AudioNode, req: NoteRequest): NoteHandle {
    const t = req.time;
    const ch = req.channel ?? 1;
    const note = req.pitch;
    const vel = req.velocity;
    const g = ctx.createGain();
    const peak = (vel / 127) ** 1.5 * 0.5;
    if (ch === 10) {
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      const f = ctx.createBiquadFilter();
      f.type = note < 40 ? 'lowpass' : note < 48 ? 'bandpass' : 'highpass';
      f.frequency.value = note < 40 ? 180 : note < 48 ? 1200 : 6000;
      src.connect(f).connect(g).connect(out);
      g.gain.setValueAtTime(peak * 1.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (note === 46 || note === 49 ? 0.28 : 0.12));
      src.start(t);
      src.stop(t + 0.3);
      src.onended = () => g.disconnect();
      const end = t + 0.3;
      return {
        end,
        release() {},
        stop(time: number) {
          if (time >= end) return;
          g.gain.cancelScheduledValues(time);
          g.gain.setTargetAtTime(0, time, 0.01);
        },
      };
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
    f.connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.setTargetAtTime(peak * 0.6, t + 0.01, 0.15);
    o1.start(t);
    o2.start(t);
    o1.onended = () => g.disconnect();
    const h = {
      end: Infinity,
      release(time: number) {
        if (time >= h.end) return;
        g.gain.cancelScheduledValues(time);
        g.gain.setTargetAtTime(0, time, 0.03);
        o1.stop(time + 0.2);
        o2.stop(time + 0.2);
        h.end = time + 0.2;
      },
      stop(time: number) {
        if (time >= h.end) return;
        g.gain.cancelScheduledValues(time);
        g.gain.setTargetAtTime(0, time, 0.01);
        o1.stop(time + 0.1);
        o2.stop(time + 0.1);
        h.end = time + 0.1;
      },
    };
    return h;
  }
}
