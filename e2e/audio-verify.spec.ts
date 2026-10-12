/**
 * Objective audio verification. Renders controlled scenarios through ANVIL's real export path
 * in Chromium (OfflineAudioContext, the output-processor worklet, real sample decoding) and
 * measures the WAV data: pitch, onset timing, levels, quantisation, stereo content, tails,
 * stem alignment, and live playback against offline rendering. No listening is involved.
 *
 * With VERIFY_OUT set, the measurements are written there as JSON (docs/AUDIO-VERIFICATION.md
 * reports them).
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FAKE_MIDI } from './fakeMidi';
import { C2_HZ, C3_HZ, bassWav, kickWav, melodicWav, onset, peak, pitchHz, readWav16, rms, stereoWav } from './fixtures';

const SR = 44100;
/** Measurements are merged into VERIFY_OUT as each test records them (workers restart after a failure). */
const report = new Proxy({} as Record<string, unknown>, {
  set(target, key: string, value) {
    target[key] = value;
    if (process.env.VERIFY_OUT) {
      const all = existsSync(process.env.VERIFY_OUT) ? JSON.parse(readFileSync(process.env.VERIFY_OUT, 'utf8')) : {};
      all[key] = value;
      writeFileSync(process.env.VERIFY_OUT, JSON.stringify(all, null, 2));
    }
    return true;
  },
});
/** Raw audio for offline analysis, when VERIFY_DIR is set. */
const dump = (name: string, x: Float32Array) => process.env.VERIFY_DIR && writeFileSync(`${process.env.VERIFY_DIR}/${name}.f32`, Buffer.from(x.buffer, x.byteOffset, x.byteLength));

type W = { anvil: any };

async function open(page: Page) {
  await page.addInitScript(FAKE_MIDI);
  await page.goto('/anvil/');
  await expect(page.getByTestId('bank')).toBeVisible();
}

/** A fixed theme on voice 1: C3, G3, C4, C2, one second each at 120 BPM (quarter-note microbeats). */
async function fixedTheme(page: Page) {
  await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    const p = a.project;
    const deg = [28, 32, 35, 21]; // C3 G3 C4 C2 in C major
    p.tempo = 120;
    a.transport.setTempo(120);
    p.bank.TA = { ...p.bank.TA, microbeat: 24, pulse: 1, length: 8, cells: [{ start: 0, len: 8 }], events: deg.map((d, i) => ({ start: i * 2, len: 2, rest: false, accent: 0, degree: d })) };
    p.selected = 'TA';
    p.voices = p.voices.map((v: Record<string, unknown>, i: number) => (i === 0 ? { ...v, octave: 0, velocity: 100, accent: 0, art: 8, mute: false } : { ...v, mute: true }));
    a.emit('bank');
  });
}

async function load(page: Page, slot: number, name: string, buf: Buffer) {
  const ok = await page.evaluate(async ([slot, name, b64]) => {
    const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
    return (window as unknown as W).anvil.loadSample(slot, { bytes: bytes.buffer, name });
  }, [slot, name, buf.toString('base64')] as const);
  expect(ok).toBe(true);
}

let lastFirstNotes: Record<string, number> = {};

/** Run an export in the page and return the files (and each voice's first note, in seconds). */
async function exportFiles(page: Page, opts: Record<string, unknown>): Promise<Map<string, ReturnType<typeof readWav16>>> {
  const r = await page.evaluate(async (o) => {
    const res = await (window as unknown as W).anvil.exportAudio(o);
    const t = res.plan.timeline;
    const spt = 60 / (t.tempo.changes[0].bpm * t.tempo.ppq);
    const first: Record<string, number> = {};
    for (const e of t.events) if (e.type === 'note' && !(e.voice in first)) first[e.voice] = e.tick * spt;
    return { first, files: res.files.map((f: { name: string; bytes: Uint8Array; voice?: string }) => [f.name, btoa(Array.from(f.bytes, (b) => String.fromCharCode(b)).join('')), f.voice ?? '']) };
  }, opts);
  lastFirstNotes = r.first;
  return new Map(r.files.map(([n, b]: [string, string]) => [n, readWav16(Buffer.from(b, 'base64'))]));
}

const item = (passes = 1, outputs = 'master', tail = 1, bake = true) => ({ range: { kind: 'item', item: 'TA', passes }, outputs, bake, allVoices: false, tailSeconds: tail });


test('clean sample playback: chromatic transposition, onsets, levels, tail', async ({ page }) => {
  await open(page);
  await fixedTheme(page);
  await load(page, 0, 'melodic_C3.wav', melodicWav());
  await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    a.setVoiceSource(0, 'sample');
    a.setSlotZone(0, { root: 48, mode: 'gated', release: 0.03 });
  });
  const [master] = [...(await exportFiles(page, item())).values()];
  const L = master.channels[0];
  const expected = [C3_HZ, C3_HZ * 2 ** (7 / 12), C3_HZ * 2, C2_HZ];
  const measured = expected.map((_, i) => pitchHz(L, SR, i * SR + 4410, 8820, 50, 600));
  const cents = measured.map((m, i) => 1200 * Math.log2(m / expected[i]));
  report.transposition = { expectedHz: expected, measuredHz: measured, errorCents: cents, peak: peak(L), frames: L.length, expectedFrames: 5 * SR };
  for (const c of cents) expect(Math.abs(c)).toBeLessThan(5);
  expect(L.length).toBe(5 * SR); // 4 s of music + 1 s tail, exactly
  // C4 plays the 1.5 s sample at double speed: it ends after 0.75 s (silence until the next note)
  expect(rms(L, 2 * SR + 0.8 * SR, 2 * SR + 0.95 * SR)).toBeLessThan(1e-4);
  // gated release: silence well inside the tail
  expect(rms(L, Math.round(4.2 * SR), 5 * SR)).toBeLessThan(1e-4);
  // mono sample, centred: identical channels
  expect(master.channels[1]).toEqual(L);

  // timing: a one-shot kick (sharp attack, silence between hits) on the same four notes
  await load(page, 0, 'kick.wav', kickWav());
  await page.evaluate(() => (window as unknown as W).anvil.setSlotZone(0, { root: 48, mode: 'oneshot' }));
  const k = [...(await exportFiles(page, item())).values()][0].channels[0];
  const kickOnsets = [0, 1, 2, 3].map((i) => onset(k.subarray(i * SR), 1.5 / 32767));
  report.timing = { kickOnsetFramesAfterClock: kickOnsets, expectedFrames: [0, 44100, 88200, 132300] };
  for (const o of kickOnsets) expect(o).toBeLessThanOrEqual(2); // first non-zero sample within 2 frames of the note's clock
});

test('crunch processing: bit depth and rate reduction measured in the master', async ({ page }) => {
  await open(page);
  await fixedTheme(page);
  await load(page, 0, 'melodic_C3.wav', melodicWav());
  await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    a.setVoiceSource(0, 'sample');
    a.setSlotZone(0, { root: 48, mode: 'gated' });
    const m = structuredClone(a.project.audio.master);
    m.crunch = { enabled: true, bits: 6, rateDivide: 4 };
    a.setMasterFx(m);
  });
  const [master] = [...(await exportFiles(page, item())).values()];
  const L = master.channels[0].subarray(0, 4 * SR);
  const levels = new Set(Array.from(L, (v) => Math.round(v * 32767)));
  let held = 0;
  let pairs = 0;
  for (let i = 1; i < L.length; i++) {
    if (L[i] !== 0 || L[i - 1] !== 0) {
      pairs++;
      if (L[i] === L[i - 1]) held++;
    }
  }
  const step = 2 / 64;
  const offGrid = Array.from(L).filter((v) => Math.abs(v / step - Math.round(v / step)) > 0.02).length;
  report.crunch = { bits: 6, rateDivide: 4, distinctLevels: levels.size, maxLevels: 65, heldFraction: held / pairs, expectedHeldFraction: 0.75, offGridSamples: offGrid };
  expect(levels.size).toBeLessThanOrEqual(65);
  expect(held / pairs).toBeGreaterThan(0.7);
  expect(offGrid).toBe(0);
});

test('12-BIT preset and output stage change the sound but stay finite and bounded', async ({ page }) => {
  await open(page);
  await fixedTheme(page);
  await load(page, 0, 'bass_C2.wav', bassWav());
  await page.evaluate(() => (window as unknown as W).anvil.setVoiceSource(0, 'sample'));
  await page.evaluate(() => (window as unknown as W).anvil.setSlotZone(0, { root: 36, mode: 'gated' }));
  const clean = [...(await exportFiles(page, item())).values()][0].channels[0];
  const out: Record<string, unknown> = {};
  for (const [label, patch] of [
    ['12-BIT', { drive: { enabled: true, type: 'tape', amountPct: 15 }, crunch: { enabled: true, bits: 12, rateDivide: 2 }, tone: { enabled: true, hz: 10000 } }],
    ['Cassette', { outputStage: { enabled: true, mode: 'cassette', mixPct: 100, intensityPct: 60 } }],
  ] as const) {
    await page.evaluate((pt) => {
      const a = (window as unknown as W).anvil;
      a.setMasterFx({ ...structuredClone(a.project.audio.master), ...pt });
    }, patch as unknown as Record<string, unknown>);
    const x = [...(await exportFiles(page, item())).values()][0].channels[0];
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff += (x[i] - clean[i]) ** 2;
    out[label] = { peak: peak(x), cleanPeak: peak(clean), rmsDifferenceFromClean: Math.sqrt(diff / x.length), pitchHz: pitchHz(x, SR, 3 * SR + 4410, 8820, 30, 400) };
    expect(peak(x)).toBeLessThan(1);
    expect(Math.sqrt(diff / x.length)).toBeGreaterThan(1e-4);
    await page.evaluate(() => (window as unknown as W).anvil.setMasterFx(JSON.parse(JSON.stringify({ ...(window as unknown as W).anvil.project.audio.master, outputStage: { enabled: false, mode: 'cassette', mixPct: 100, intensityPct: 50 }, drive: { enabled: false, type: 'tape', amountPct: 30 }, crunch: { enabled: false, bits: 12, rateDivide: 2 }, tone: { enabled: false, hz: 8000 } }))));
  }
  report.processing = out;
});

test('stereo sample keeps its channels', async ({ page }) => {
  await open(page);
  await fixedTheme(page);
  await load(page, 0, 'stereo.wav', stereoWav());
  await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    a.setVoiceSource(0, 'sample');
    a.setSlotZone(0, { root: 48, mode: 'oneshot' }); // the first note, C3, plays it untransposed
  });
  const m = [...(await exportFiles(page, item())).values()][0];
  const l = pitchHz(m.channels[0], SR, 4410, 8820, 200, 1000);
  const r = pitchHz(m.channels[1], SR, 4410, 8820, 200, 1000);
  report.stereo = { leftHz: l, rightHz: r, expected: [440, 660] };
  expect(Math.abs(l - 440)).toBeLessThan(2);
  expect(Math.abs(r - 660)).toBeLessThan(3);
});

test('sample transformation: Good Bits stretch keeps pitch, Tape varispeed moves it', async ({ page }) => {
  await open(page);
  await fixedTheme(page);
  await load(page, 0, 'melodic_C3.wav', melodicWav());
  await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    a.setVoiceSource(0, 'sample');
    a.setSlotZone(0, { root: 48, mode: 'oneshot' });
    a.setSlotTransform(0, { enabled: true, character: 'clean', ratio: 2 });
  });
  await page.evaluate(() => (window as unknown as W).anvil.library.ready());
  const stretched = await page.evaluate(() => (window as unknown as W).anvil.library.state(0).duration);
  const m1 = [...(await exportFiles(page, item(1, 'master', 1))).values()][0].channels[0];
  const stretchPitch = pitchHz(m1, SR, 4410, 8820, 50, 600);
  await page.evaluate(() => (window as unknown as W).anvil.setSlotTransform(0, { character: 'clean', ratio: 1, pitch: -12 }));
  await page.evaluate(() => (window as unknown as W).anvil.library.ready());
  const tapeDur = await page.evaluate(() => (window as unknown as W).anvil.library.state(0).duration);
  const m2 = [...(await exportFiles(page, item(1, 'master', 1))).values()][0].channels[0];
  const tapePitch = pitchHz(m2, SR, 4410, 8820, 30, 600);
  report.transform = { stretchRatio2Duration: stretched, stretchPitchHz: stretchPitch, varispeedMinus12Duration: tapeDur, varispeedPitchHz: tapePitch, originalDuration: 1.5, originalHz: C3_HZ };
  expect(stretched).toBeGreaterThan(2.8);
  expect(Math.abs(1200 * Math.log2(stretchPitch / C3_HZ))).toBeLessThan(15);
  expect(tapeDur).toBeCloseTo(3, 1);
  expect(Math.abs(1200 * Math.log2(tapePitch / (C3_HZ / 2)))).toBeLessThan(10);
});

test('stems: isolated, sample-aligned with leading silence, shared tail, sum to the master', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-project').click();
  await page.getByTestId('demo-accompaniment').click();
  await load(page, 7, 'kick.wav', kickWav()); // D2 slot is index 7; load into every drum slot used
  for (const k of [6, 8, 9, 10, 11, 12]) await load(page, k, 'kick.wav', kickWav());
  const voices = await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    a.project.voices.forEach((v: { harmony: number }, i: number) => v.harmony >= 12 && a.setVoiceSource(i, 'sample'));
    return a.project.voices.map((v: { mute: boolean; harmony: number }) => ({ mute: v.mute, drum: v.harmony >= 12 }));
  });
  const files = await exportFiles(page, item(1, 'both', 2));
  const names = [...files.keys()];
  for (const n of names) dump(n.replace('.wav', ''), files.get(n)!.channels[0]);
  const master = files.get(names[0])!;
  const frames = master.channels[0].length;
  const [timeline, tempoSpc] = await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    return [a.project.bank[a.project.selected].length * a.project.bank[a.project.selected].microbeat, 60 / (a.project.tempo * 24)];
  });
  const stems = names.slice(1).map((n) => ({ n, w: files.get(n)! }));
  const voiceOf = (n: string) => `v${/voice-(\d)/.exec(n)![1]}`;
  const stemInfo = stems.map(({ n, w }) => ({ name: n, frames: w.channels[0].length, firstNoteFrame: Math.round((lastFirstNotes[voiceOf(n)] ?? NaN) * SR), firstOnsetFrame: onset(w.channels[0], 0.0005), peak: peak(w.channels[0]) }));
  const sum = new Float32Array(frames);
  for (const { w } of stems) for (let i = 0; i < frames; i++) sum[i] += w.channels[0][i];
  let maxErr = 0;
  let clamped = 0;
  for (let i = 0; i < frames; i++) {
    // the master is clamped to full scale by the 16-bit conversion; the stems (each quieter) are not
    if (Math.abs(master.channels[0][i]) >= 32766 / 32767) {
      clamped++;
      continue;
    }
    maxErr = Math.max(maxErr, Math.abs(sum[i] - master.channels[0][i]));
  }
  let sumPeak = 0;
  for (const v of sum) sumPeak = Math.max(sumPeak, Math.abs(v));
  report.stems = { voices, files: names, frames, expectedFrames: Math.ceil((timeline * tempoSpc + 2) * SR), stems: stemInfo, maxSumErrorUnclamped: maxErr, lsb: 1 / 32767, masterClampedFrames: clamped, stemSumPeak: sumPeak, tailRms: rms(master.channels[0], frames - SR, frames) };
  expect(frames).toBe(Math.ceil((timeline * tempoSpc + 2) * SR));
  for (const s of stemInfo) {
    expect(s.frames).toBe(frames);
    // leading silence kept: each stem's sound starts at its voice's first note, not at frame 0
    if (s.peak > 0) expect(Math.abs(s.firstOnsetFrame - s.firstNoteFrame)).toBeLessThanOrEqual(256);
  }
  expect(maxErr).toBeLessThan((stems.length + 1) / 32767);
  // every stem with notes has its own content (not a copy of another voice)
  const nonSilent = stems.filter((s) => peak(s.w.channels[0]) > 0);
  for (let i = 0; i < nonSilent.length; i++) for (let j = i + 1; j < nonSilent.length; j++) expect(nonSilent[i].w.channels[0]).not.toEqual(nonSilent[j].w.channels[0]);
});

/** Record ANVIL's live internal mix (before the monitor volume) on the audio thread while it plays the item once. */
async function recordLive(page: Page, seconds: number): Promise<{ data: Float32Array; sampleRate: number }> {
  const r = await page.evaluate(async (ms) => {
    const a = (window as unknown as W).anvil;
    const ctx: AudioContext = a.preview.ctx;
    // batches of 32 blocks (4096 frames), so the recorder does not crowd the main thread
    const code = "registerProcessor('verify-rec', class extends AudioWorkletProcessor { constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.port.onmessage = () => { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; }; } process(i) { const c = i[0] && i[0][0]; this.buf.set(c || new Float32Array(128), this.n); this.n += 128; if (this.n === 4096) { this.port.postMessage(this.buf.slice()); this.n = 0; } return true; } });";
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const rec = new AudioWorkletNode(ctx, 'verify-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    const chunks: Float32Array[] = [];
    rec.port.onmessage = (e) => chunks.push(e.data as Float32Array);
    a.preview.mixer.output.connect(rec);
    rec.connect(sink).connect(ctx.destination);
    await new Promise((res) => setTimeout(res, 200));
    a.playOnce();
    await new Promise((res) => setTimeout(res, ms));
    a.stop();
    await new Promise<void>((res) => {
      const last = rec.port.onmessage;
      rec.port.onmessage = (e) => {
        last?.call(rec.port, e);
        res();
      };
      rec.port.postMessage('flush');
    });
    a.preview.mixer.output.disconnect(rec);
    rec.disconnect();
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return { data: Array.from(out), sampleRate: ctx.sampleRate };
  }, seconds * 1000);
  return { data: Float32Array.from(r.data), sampleRate: r.sampleRate };
}

test('live playback matches the offline render (timing, level, pitch)', async ({ page }) => {
  await open(page);
  await fixedTheme(page);
  await load(page, 0, 'kick.wav', kickWav());
  await page.evaluate(() => {
    const a = (window as unknown as W).anvil;
    a.setVoiceSource(0, 'sample');
    a.setSlotZone(0, { root: 48, mode: 'oneshot' });
  });
  const offK = [...(await exportFiles(page, item(1, 'master', 0.5))).values()][0].channels[0];
  await page.getByTestId('tab-audio').click();
  await page.getByTestId('audio-on').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).anvil.preview.enabled)).toBe(true);
  const liveK = await recordLive(page, 4.6);
  dump('live-kick', liveK.data);
  dump('offline-kick', offK);
  const thr = 1.5 / 32767;
  const s0 = onset(liveK.data, thr);
  const hits = [0, 1, 2, 3].map((i) => {
    const from = s0 + i * SR - 4000;
    return onset(liveK.data.subarray(from), thr) + from;
  });
  const intervals = hits.slice(1).map((h, i) => h - hits[i] - SR);
  const hitRms = (x: Float32Array, at: number) => rms(x, at, at + 4410);
  const levelRatios = [0, 1, 2, 3].map((i) => hitRms(liveK.data, hits[i]) / hitRms(offK, i * SR));

  // pitch: the sustained sample, gated
  await load(page, 0, 'melodic_C3.wav', melodicWav());
  await page.evaluate(() => (window as unknown as W).anvil.setSlotZone(0, { root: 48, mode: 'gated' }));
  const offM = [...(await exportFiles(page, item(1, 'master', 0.5))).values()][0].channels[0];
  const liveM = await recordLive(page, 4.6);
  const m0 = onset(liveM.data, thr);
  const livePitch = [0, 1, 2, 3].map((i) => pitchHz(liveM.data, SR, m0 + i * SR + 13230, 8820, 50, 600));
  const offPitch = [0, 1, 2, 3].map((i) => pitchHz(offM, SR, i * SR + 13230, 8820, 50, 600));
  report.liveVsOffline = { liveSampleRate: liveK.sampleRate, hitIntervalErrorFrames: intervals, hitLevelRatioLiveOverOffline: levelRatios, livePitchHz: livePitch, offlinePitchHz: offPitch };
  expect(liveK.sampleRate).toBe(SR);
  for (const e of intervals) expect(Math.abs(e)).toBeLessThan(0.01 * SR); // live scheduling jitter under 10 ms
  for (const r of levelRatios) expect(Math.abs(r - 1)).toBeLessThan(0.05);
  for (let i = 0; i < 4; i++) expect(Math.abs(1200 * Math.log2(livePitch[i] / offPitch[i]))).toBeLessThan(3);
});
