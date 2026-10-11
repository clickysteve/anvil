/**
 * Web Worker entry for sample transformations, so a long stretch never blocks the page.
 * Message in: { id, audio: { sampleRate, channels }, transform }; out: { id, audio } or { id, error }.
 */
import { applyTransform } from './transform';
import { repairTransform } from './settings';

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

scope.onmessage = (e: MessageEvent) => {
  const { id, audio, transform } = e.data as { id: number; audio: { sampleRate: number; channels: Float32Array[] }; transform: unknown };
  try {
    const out = applyTransform(audio, repairTransform(transform));
    const channels = out.channels === audio.channels ? out.channels.map((c) => c.slice()) : out.channels;
    scope.postMessage({ id, audio: { sampleRate: out.sampleRate, channels } }, channels.map((c) => c.buffer as ArrayBuffer));
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
