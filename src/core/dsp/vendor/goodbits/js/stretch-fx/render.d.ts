// Type declarations for the vendored Good Bits js/stretch-fx/render.js (see ../../vendor.json).
export interface FxPass { character: string; ratio: number; macroValues?: Record<string, number> }
export interface FxRecipe {
  seed: number;
  pitch?: number;
  reverse?: 'pre' | 'post' | null | string;
  passes: FxPass[];
  drive?: { type: string; amount: number } | null;
  crunch?: { bits: number; rateDivide: number } | null;
}
export function renderFx(opts: { channels: Float32Array[]; sampleRate: number; recipe: FxRecipe }): { channels: Float32Array[]; sampleRate: number; duration: number };
export function sliceFragment(channels: Float32Array[], sampleRate: number, startSec: number, endSec: number): Float32Array[];
