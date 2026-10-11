/**
 * AudioWorklet processor for output processing. It only moves blocks in and out of the shared
 * OutputFxStream, so live playback (AudioContext) and offline rendering (OfflineAudioContext)
 * run exactly the same DSP code.
 *
 * Messages: { type: 'settings', settings } changes settings (crossfaded);
 *           { type: 'reset', at } restarts processor state at context time `at` (seconds).
 */
import { repairFx, type OutputFxSettings } from './settings';
import { OutputFxStream } from './stream';
import { OUTPUT_FX_PROCESSOR } from './constants';

declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

interface Options {
  processorOptions?: { settings?: OutputFxSettings; seed?: number };
}

class OutputFxProcessor extends AudioWorkletProcessor {
  private stream: OutputFxStream;
  private resetAt: number | null = null;

  constructor(options: Options) {
    super(options);
    const po = options.processorOptions ?? {};
    this.stream = new OutputFxStream(repairFx(po.settings), sampleRate, (po.seed ?? 1) >>> 0);
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; settings?: unknown; at?: number };
      if (m.type === 'settings') this.stream.set(repairFx(m.settings));
      else if (m.type === 'reset') this.resetAt = typeof m.at === 'number' ? m.at : 0;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const inp = inputs[0] ?? [];
    if (inp.length > 0) {
      L.set(inp[0]);
      R.set(inp[1] ?? inp[0]);
    } else {
      L.fill(0);
      R.fill(0);
    }
    if (this.resetAt !== null && currentTime >= this.resetAt) {
      this.stream.reset();
      this.resetAt = null;
    }
    this.stream.process(L, R, L.length);
    return true;
  }
}

registerProcessor(OUTPUT_FX_PROCESSOR, OutputFxProcessor);
