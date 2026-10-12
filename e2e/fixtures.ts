/**
 * Synthetic test samples, generated in code (the repository holds no audio files):
 * a short drum hit, a sustained melodic tone at C3, a bass tone at C2 and a stereo sample
 * with different content left and right. Encoded as 16-bit PCM WAV.
 */
export function wav16(channels: Float32Array[], sampleRate = 44100): Buffer {
  const n = channels[0].length;
  const ch = channels.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), 44 + (i * ch + c) * 2);
  return buf;
}

const SR = 44100;
const tone = (seconds: number, f: (i: number, t: number) => number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => f(i, i / SR));

export const C3_HZ = 130.8128;
export const C2_HZ = 65.4064;

/** 0.3 s kick: a sine sweeping 160 -> 45 Hz with a fast exponential decay. */
export const kickWav = () => {
  let phase = 0;
  return wav16([tone(0.3, (_, t) => {
    phase += (2 * Math.PI * (45 + 115 * Math.exp(-t * 30))) / SR;
    return 0.9 * Math.exp(-t * 12) * Math.sin(phase);
  })]);
};

/** 1.5 s sustained tone at C3 with three harmonics, 10 ms attack, steady after that (loopable). */
export const melodicWav = () => wav16([tone(1.5, (_, t) => Math.min(1, t / 0.01) * 0.5 * (Math.sin(2 * Math.PI * C3_HZ * t) + 0.3 * Math.sin(4 * Math.PI * C3_HZ * t) + 0.15 * Math.sin(6 * Math.PI * C3_HZ * t)))]);

/** 1 s bass at C2: a softened square. */
export const bassWav = () => wav16([tone(1, (_, t) => 0.6 * Math.min(1, t / 0.005) * Math.tanh(4 * Math.sin(2 * Math.PI * C2_HZ * t)))]);

/** 0.8 s stereo: 440 Hz left, 660 Hz right. */
export const stereoWav = () => wav16([tone(0.8, (_, t) => 0.5 * Math.sin(2 * Math.PI * 440 * t)), tone(0.8, (_, t) => 0.5 * Math.sin(2 * Math.PI * 660 * t))]);

/** Read a 16-bit PCM WAV (as written by ANVIL's export) into float channels. */
export function readWav16(buf: Buffer): { sampleRate: number; channels: Float32Array[]; bits: number; format: number; riffSize: number; dataBytes: number } {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let p = 12;
  let fmt = { format: 0, ch: 0, sr: 0, bits: 0 };
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') {
      const frames = size / (fmt.ch * 2);
      const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.ch; c++) channels[c][i] = buf.readInt16LE(p + 8 + (i * fmt.ch + c) * 2) / 32767;
      return { sampleRate: fmt.sr, channels, bits: fmt.bits, format: fmt.format, riffSize: buf.readUInt32LE(4), dataBytes: size };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

/** Minimal stored-ZIP reader for test downloads. */
export function readZipStored(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(name, buf.subarray(start, start + size));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Fundamental frequency by autocorrelation over a window (Hz). */
export function pitchHz(x: Float32Array, sr: number, from: number, len: number, minHz = 40, maxHz = 1000): number {
  const seg = x.subarray(from, from + len);
  const lo = Math.floor(sr / maxHz);
  const hi = Math.ceil(sr / minHz);
  let best = lo;
  let bestV = -Infinity;
  const corr: number[] = [];
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag];
    corr[lag] = s;
    if (s > bestV) {
      bestV = s;
      best = lag;
    }
  }
  // prefer the shortest lag with nearly the best correlation (avoids octave errors)
  for (let lag = lo; lag <= hi; lag++) if (corr[lag] >= 0.9 * bestV && corr[lag] >= (corr[lag - 1] ?? -Infinity) && corr[lag] >= (corr[lag + 1] ?? -Infinity)) { best = lag; break; }
  const a = corr[best - 1] ?? corr[best];
  const b = corr[best];
  const c = corr[best + 1] ?? corr[best];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (best + shift);
}

export const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
export const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** First frame whose absolute value exceeds a threshold. */
export const onset = (x: Float32Array, threshold = 0.01) => x.findIndex((v) => Math.abs(v) > threshold);
