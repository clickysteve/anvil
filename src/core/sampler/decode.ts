/**
 * Decoding and validating user samples, entirely in the browser.
 *
 * PCM WAV and AIFF are read by Good Bits' own parsers (byte-exact, at the file's native sample
 * rate); anything else goes to the browser's decoder (`decodeAudioData`). Every failure is a
 * SampleError with a code and a message meant for the user.
 */
import { parseAiff, parseWav } from '../dsp/vendor/goodbits/js/audio-codec.js';
import type { AudioData } from '../dsp/transform/transform';

export type SampleErrorCode = 'empty' | 'too-large' | 'too-long' | 'unsupported' | 'corrupt' | 'decode';

export class SampleError extends Error {
  constructor(readonly code: SampleErrorCode, message: string) {
    super(message);
    this.name = 'SampleError';
  }
}

export interface DecodedSample extends AudioData {
  frames: number;
  duration: number;
  warnings: string[];
}

export interface DecodeOptions {
  maxBytes?: number;
  maxSeconds?: number;
  /** decoder for formats Good Bits does not parse (default: the browser's) */
  decode?: (bytes: ArrayBuffer) => Promise<AudioData>;
}

export const MAX_SAMPLE_BYTES = 40 * 1024 * 1024;
export const MAX_SAMPLE_SECONDS = 120;

const AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc|mp3|m4a|aac|mp4|ogg|oga|opus|flac|webm|caf)$/i;

function fourcc(dv: DataView, at: number): string {
  return at + 4 <= dv.byteLength ? String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3)) : '';
}

/** Decode with the browser (OfflineAudioContext at 44.1 kHz; compressed formats resample to it). */
export async function browserDecode(bytes: ArrayBuffer): Promise<AudioData> {
  const OAC = globalThis.OfflineAudioContext;
  if (!OAC) throw new Error('this browser cannot decode audio');
  const ctx = new OAC(1, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  return { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice()) };
}

export async function decodeSample(bytes: ArrayBuffer, name: string, opts: DecodeOptions = {}): Promise<DecodedSample> {
  const maxBytes = opts.maxBytes ?? MAX_SAMPLE_BYTES;
  const maxSeconds = opts.maxSeconds ?? MAX_SAMPLE_SECONDS;
  if (bytes.byteLength === 0) throw new SampleError('empty', `"${name}" is empty.`);
  if (bytes.byteLength > maxBytes) throw new SampleError('too-large', `"${name}" is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1048576)} MB.`);
  const dv = new DataView(bytes);
  const isWav = fourcc(dv, 0) === 'RIFF' && fourcc(dv, 8) === 'WAVE';
  const isAiff = fourcc(dv, 0) === 'FORM' && (fourcc(dv, 8) === 'AIFF' || fourcc(dv, 8) === 'AIFC');
  let audio: AudioData;
  if (isWav || isAiff) {
    try {
      const b = isWav ? parseWav(bytes) : parseAiff(bytes);
      audio = { sampleRate: b.sampleRate, channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const unsupported = /unsupported/i.test(msg);
      if (unsupported && opts.decode !== undefined) {
        audio = await decodeOther(bytes, name, opts.decode);
      } else throw new SampleError(unsupported ? 'unsupported' : 'corrupt', `"${name}" could not be read: ${msg}.`);
    }
  } else {
    if (!AUDIO_EXT.test(name) && !opts.decode) throw new SampleError('unsupported', `"${name}" is not a supported audio file.`);
    audio = await decodeOther(bytes, name, opts.decode ?? browserDecode);
  }
  const warnings: string[] = [];
  if (!audio.channels.length || !audio.channels[0].length) throw new SampleError('empty', `"${name}" contains no audio.`);
  if (!(audio.sampleRate >= 3000 && audio.sampleRate <= 768000)) throw new SampleError('corrupt', `"${name}" has an impossible sample rate (${audio.sampleRate}).`);
  if (audio.channels.length > 2) {
    warnings.push(`"${name}" has ${audio.channels.length} channels; only the first two are used.`);
    audio = { sampleRate: audio.sampleRate, channels: audio.channels.slice(0, 2) };
  }
  const frames = audio.channels[0].length;
  const duration = frames / audio.sampleRate;
  if (duration > maxSeconds) throw new SampleError('too-long', `"${name}" is ${duration.toFixed(1)} s long; the limit is ${maxSeconds} s.`);
  let peak = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (!Number.isFinite(v)) throw new SampleError('corrupt', `"${name}" contains invalid sample values.`);
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
  }
  if (peak === 0) warnings.push(`"${name}" is completely silent.`);
  return { ...audio, frames, duration, warnings };
}

async function decodeOther(bytes: ArrayBuffer, name: string, decode: (b: ArrayBuffer) => Promise<AudioData>): Promise<AudioData> {
  try {
    return await decode(bytes);
  } catch (e) {
    throw new SampleError('decode', `The browser could not decode "${name}" (${e instanceof Error ? e.message : 'unknown format'}). Try WAV or AIFF.`);
  }
}

/** Make an AudioBuffer (context-independent, usable by live and offline contexts alike). */
export function toAudioBuffer(audio: AudioData): AudioBuffer {
  const buf = new AudioBuffer({ length: audio.channels[0].length, numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate });
  audio.channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}
