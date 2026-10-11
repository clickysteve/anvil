/**
 * WAV export: Good Bits' encoder (16-bit PCM, little endian, interleaved, clamp and round, no
 * dither, no normalisation), plus level statistics and a header reader for checks and tests.
 */
import { encodeWav } from '../dsp/vendor/goodbits/js/audio-codec.js';

export async function encodeWav16(channels: Float32Array[], sampleRate: number): Promise<Uint8Array> {
  return new Uint8Array(await encodeWav(channels, sampleRate, 16).arrayBuffer());
}

export interface LevelStats {
  /** largest absolute sample value (1.0 = full scale) */
  peak: number;
  /** peak in dBFS (-Infinity for silence) */
  peakDb: number;
  /** samples beyond full scale, which the 16-bit conversion clamps */
  clipped: number;
  /** RMS over all channels */
  rms: number;
  silent: boolean;
}

export function levelStats(channels: Float32Array[]): LevelStats {
  let peak = 0;
  let clipped = 0;
  let sum = 0;
  let n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      if (a > 1) clipped++;
      sum += ch[i] * ch[i];
    }
    n += ch.length;
  }
  return { peak, peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, clipped, rms: n ? Math.sqrt(sum / n) : 0, silent: peak === 0 };
}

export interface WavInfo {
  riffSize: number;
  format: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  frames: number;
}

/** Read a canonical WAV header (for verification; throws on anything else). */
export function wavInfo(bytes: Uint8Array): WavInfo {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let pos = 12;
  let fmt: Omit<WavInfo, 'riffSize' | 'dataOffset' | 'dataBytes' | 'frames'> | null = null;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      fmt = { format: dv.getUint16(pos + 8, true), channels: dv.getUint16(pos + 10, true), sampleRate: dv.getUint32(pos + 12, true), byteRate: dv.getUint32(pos + 16, true), blockAlign: dv.getUint16(pos + 20, true), bitsPerSample: dv.getUint16(pos + 22, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data before fmt');
      return { riffSize: dv.getUint32(4, true), ...fmt, dataOffset: pos + 8, dataBytes: size, frames: size / fmt.blockAlign };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}
