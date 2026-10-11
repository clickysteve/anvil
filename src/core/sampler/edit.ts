/** Small sample-editing helpers: zero-crossing snapping (Good Bits' search) and waveform peaks. */
import { findNearestZeroCrossing, toMono } from '../dsp/vendor/goodbits/js/dsp.js';
import type { AudioData } from '../dsp/transform/transform';

/** Move a time (s) to the nearest zero crossing within `windowSeconds`, using Good Bits' search. */
export function snapToZeroCrossing(audio: AudioData, seconds: number, windowSeconds = 0.01): number {
  const mono = toMono(audio.channels);
  const i = Math.max(0, Math.min(mono.length - 1, Math.round(seconds * audio.sampleRate)));
  return findNearestZeroCrossing(mono, i, Math.round(windowSeconds * audio.sampleRate)) / audio.sampleRate;
}

/** Peak absolute values in `bins` equal slices (for drawing a waveform). */
export function waveformPeaks(audio: AudioData, bins: number): number[] {
  const n = audio.channels[0]?.length ?? 0;
  const out = new Array<number>(bins).fill(0);
  if (!n) return out;
  for (let b = 0; b < bins; b++) {
    const a = Math.floor((b * n) / bins);
    const e = Math.max(a + 1, Math.floor(((b + 1) * n) / bins));
    let p = 0;
    for (const ch of audio.channels) for (let i = a; i < e && i < n; i++) p = Math.max(p, Math.abs(ch[i]));
    out[b] = p;
  }
  return out;
}

/** Peak absolute value over all channels. */
export function peakOf(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}
