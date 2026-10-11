/**
 * Caches transformed sample audio so an expensive transformation runs once per
 * (sample, settings), not once per note. The work is done by a runner: synchronous by default,
 * or a Worker (see WorkerTransformRunner) in the browser.
 */
import { applyTransform, type AudioData } from './transform';
import { isIdentity, transformKey, type SampleTransform } from './settings';

export interface TransformRunner {
  run(audio: AudioData, t: SampleTransform): Promise<AudioData>;
}

export const syncRunner: TransformRunner = {
  run: async (audio, t) => applyTransform(audio, t),
};

/** Runs transformations in a Worker created from `worker.ts` by the application's bundler. */
export class WorkerTransformRunner implements TransformRunner {
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, { resolve: (a: AudioData) => void; reject: (e: Error) => void }>();

  constructor(private create: () => Worker) {}

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = this.create();
      this.worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { id: number; audio?: AudioData; error?: string };
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.audio) p.resolve(m.audio);
        else p.reject(new Error(m.error ?? 'transformation failed'));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || 'transformation worker failed'));
        this.pending.clear();
        this.worker = null;
      };
    }
    return this.worker;
  }

  run(audio: AudioData, t: SampleTransform): Promise<AudioData> {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      this.pending.set(id, { resolve, reject });
      // copies are sent so the caller keeps its original audio
      this.ensure().postMessage({ id, audio: { sampleRate: audio.sampleRate, channels: audio.channels.map((c) => c.slice()) }, transform: t });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export class TransformCache {
  private entries = new Map<string, Promise<AudioData>>();
  constructor(private runner: TransformRunner = syncRunner, private maxEntries = 64) {}

  /** The transformed audio for a sample id and settings (computed once, then shared). */
  get(sampleId: string, audio: AudioData, t: SampleTransform): Promise<AudioData> {
    if (isIdentity(t)) return Promise.resolve(audio);
    const key = `${sampleId}|${transformKey(t)}`;
    let p = this.entries.get(key);
    if (!p) {
      p = this.runner.run(audio, t);
      this.entries.set(key, p);
      p.catch(() => this.entries.delete(key));
      if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    }
    return p;
  }

  has(sampleId: string, t: SampleTransform): boolean {
    return isIdentity(t) || this.entries.has(`${sampleId}|${transformKey(t)}`);
  }

  /** Forget everything cached for a sample. */
  drop(sampleId: string): void {
    for (const k of [...this.entries.keys()]) if (k.startsWith(`${sampleId}|`)) this.entries.delete(k);
  }

  get size(): number {
    return this.entries.size;
  }
}
