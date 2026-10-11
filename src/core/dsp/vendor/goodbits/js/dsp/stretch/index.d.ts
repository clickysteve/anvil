// Type declarations for the vendored Good Bits js/dsp/stretch/index.js (see ../../../vendor.json).
export * from './characters.js';
export const DEFAULT_MAX_RATIO: number;
export const MAX_OUTPUT_SECONDS: number;
export const MIN_RATIO: number;
export function stretchChannels(channels: Float32Array[], sampleRate: number, ratio: number, characterKey: string, options?: { macroValues?: Record<string, number>; seed?: number }): Float32Array[];
export function ratioForTargetTempo(detectedBpm: number, targetBpm: number): number;
