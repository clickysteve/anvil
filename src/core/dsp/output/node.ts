/**
 * Output-processor nodes for any BaseAudioContext (live or offline).
 *
 * `loadOutputFx(ctx, moduleUrl)` registers the worklet once per context. The module URL comes
 * from the application's bundler (for Vite: `import url from '.../worklet.ts?worker&url'`), so
 * Core itself makes no assumption about how it is served.
 *
 * Without AudioWorklet (an insecure context or an old browser) `createOutputFxNode` returns a
 * plain stereo pass-through and reports `processing: false`, so audio still plays, unprocessed.
 */
import { OUTPUT_FX_PROCESSOR } from './constants';
import { isClean, type OutputFxSettings } from './settings';

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

export function loadOutputFx(ctx: BaseAudioContext, moduleUrl: string): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        await ctx.audioWorklet.addModule(moduleUrl);
        return true;
      } catch {
        return false;
      }
    })();
    loaded.set(ctx, p);
  }
  return p;
}

export async function outputFxAvailable(ctx: BaseAudioContext): Promise<boolean> {
  return (await loaded.get(ctx)) ?? false;
}

export interface OutputFxNode {
  readonly node: AudioNode;
  /** false when the browser could not run the worklet: audio passes through unprocessed */
  readonly processing: boolean;
  settings: OutputFxSettings;
  set(settings: OutputFxSettings): void;
  /** restart processor state at context time `at` */
  reset(at: number): void;
  dispose(): void;
}

/** `available` must be the resolved result of loadOutputFx for this context. */
export function createOutputFxNode(ctx: BaseAudioContext, settings: OutputFxSettings, seed: number, available: boolean): OutputFxNode {
  if (available && typeof AudioWorkletNode !== 'undefined') {
    const node = new AudioWorkletNode(ctx, OUTPUT_FX_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { settings, seed },
    });
    const h: OutputFxNode = {
      node,
      processing: true,
      settings,
      set(s) {
        h.settings = s;
        node.port.postMessage({ type: 'settings', settings: s });
      },
      reset(at) {
        node.port.postMessage({ type: 'reset', at });
      },
      dispose() {
        node.disconnect();
        node.port.close();
      },
    };
    return h;
  }
  // stereo pass-through: forces mono sources up to two channels like the worklet does
  const g = ctx.createGain();
  g.channelCount = 2;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = 'speakers';
  return {
    node: g,
    processing: false,
    settings,
    set(s) {
      this.settings = s;
    },
    reset() {},
    dispose() {
      g.disconnect();
    },
  };
}

/** Does this processor need the worklet at all? (CLEAN can run without it.) */
export const needsProcessing = (s: OutputFxSettings): boolean => !isClean(s);
