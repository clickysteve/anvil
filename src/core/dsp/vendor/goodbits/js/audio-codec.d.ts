// Type declarations for the vendored Good Bits js/audio-codec.js (see ../vendor.json).
export interface BufferLike { sampleRate: number; numberOfChannels: number; length: number; getChannelData(i: number): Float32Array }
export function parseWav(arrayBuffer: ArrayBuffer): BufferLike;
export function parseAiff(arrayBuffer: ArrayBuffer): BufferLike;
export function encodeWav(channels: Float32Array[], sampleRate: number, bitDepth?: 16 | 24, options?: { cuePoints?: number[] }): Blob;
