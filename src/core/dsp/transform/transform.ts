/**
 * Applying a sample transformation: Good Bits' STRETCH FX renderer (`renderFx`), unchanged.
 * Pure and synchronous, so it runs the same on the main thread, in a Worker or in a test.
 */
import { renderFx } from '../vendor/goodbits/js/stretch-fx/render.js';
import { isIdentity, toRecipe, type SampleTransform } from './settings';

export interface AudioData {
  sampleRate: number;
  channels: Float32Array[];
}

/** The transformed audio, or the input itself (not copied) when the transform is off. */
export function applyTransform(audio: AudioData, t: SampleTransform): AudioData {
  if (isIdentity(t)) return audio;
  if (!audio.channels.length || !audio.channels[0].length) throw new Error('empty sample');
  const r = renderFx({ channels: audio.channels, sampleRate: audio.sampleRate, recipe: toRecipe(t) });
  return { sampleRate: r.sampleRate, channels: r.channels };
}
