// Type declarations for the parts of the vendored Good Bits js/dsp.js used from TypeScript (see ../vendor.json).
export function findNearestZeroCrossing(mono: Float32Array, sampleIndex: number, windowSamples: number): number;
export function applyFades(channels: Float32Array[], fadeInSamples: number, fadeOutSamples: number): void;
export function toMono(channels: Float32Array[]): Float32Array;
export function resampleLinear(mono: Float32Array, fromRate: number, toRate: number): Float32Array;
export function computePeaks(mono: Float32Array, binCount: number): Float32Array | number[];
