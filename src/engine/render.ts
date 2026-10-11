/**
 * Rendering one pass of the playing item through the six voices.
 *
 * Voice 1 always plays the theme (DOC). Voices 2-6 derive notes from it in four stages:
 *   Rhythm 1-12  which theme positions trigger a note           (classic.acc.rhythm.v1)
 *   Divide       thin or double the triggers                    (classic.acc.divide.v1)
 *   Harmony      the pitch of each trigger, or a drum note      (classic.harmony.*.v1)
 *   Articulation note length, velocity from accent (and Feel)   (classic.articulation.v1, classic.feel.v1)
 * then Octave, Delay and the tonality turn it into MIDI.
 *
 * A pass is the item played once from its start. Rendering is pure: the same input (including
 * the pass seed and the carried voice state) always gives the same notes.
 */
import { Rng } from './rng';
import { degreeToMidi, foldNote } from './tonality';
import type { Accent, Theme, Tonality, Voice } from './types';
import { HARMONY_DRUM_BASE, DIVIDE_HALF } from './types';

export interface NoteOut {
  /** onset in clocks from the start of the pass (may exceed the pass length when delayed) */
  tick: number;
  /** duration in clocks (>= 1) */
  dur: number;
  ch: number; // 1..16
  note: number;
  vel: number;
  voice: number; // 0..5
  /** drum-table index (0..6) when a drum harmony chose the note, -1 for melodic notes */
  drum: number;
}

/** Per-voice state carried from one pass to the next (contrary motion). */
export interface VoiceState {
  prevTheme: number | null;
  prevVoice: number | null;
}

export const emptyVoiceStates = (): VoiceState[] => Array.from({ length: 6 }, () => ({ prevTheme: null, prevVoice: null }));

export interface RenderInput {
  theme: Theme;
  voices: Voice[];
  tonality: Tonality;
  /** 70-entry table of the active scale */
  entries: number[];
  weights: number[][];
  drums: number[];
  feel: boolean;
  /** seeds the random elements of this pass (random harmony, negative divide, feel, drums) */
  passSeed: number;
  state: VoiceState[];
}

interface Trigger {
  /** clocks from pass start */
  tick: number;
  /** clocks */
  len: number;
  degree: number;
  accent: Accent;
  /** on a pulse */
  pulse: boolean;
}

/** Which voices sound: soloed ones if any are soloed, otherwise the unmuted ones. */
export function audibleVoices(voices: Voice[]): boolean[] {
  const anySolo = voices.some((v) => v.solo);
  return voices.map((v) => (anySolo ? v.solo : !v.mute));
}

/** Per-microbeat map of the theme: the note sounding (or most recently sounded) at each microbeat. */
function microbeatMap(t: Theme) {
  const n = t.length;
  const onsetAt: (number | null)[] = new Array(n).fill(null); // event index
  const restAt: boolean[] = new Array(n).fill(false);
  const pitchAt: number[] = new Array(n).fill(-1);
  const notes = t.events.filter((e) => !e.rest);
  const lastNote = notes.length ? notes[notes.length - 1].degree : -1;
  let cur = lastNote; // a rest at the start takes the theme's last note (it precedes in the loop)
  t.events.forEach((e, i) => {
    for (let k = 0; k < e.len && e.start + k < n; k++) {
      const p = e.start + k;
      if (!e.rest) cur = e.degree;
      pitchAt[p] = cur;
      restAt[p] = e.rest;
      if (k === 0 && !e.rest) onsetAt[p] = i;
    }
  });
  return { onsetAt, restAt, pitchAt };
}

/** classic.acc.rhythm.v1: the trigger list for an accompaniment rhythm 1..12. */
export function triggersFor(t: Theme, rhythm: number): Trigger[] {
  const mb = t.microbeat;
  const pulse = Math.max(1, t.pulse);
  const map = microbeatMap(t);
  const out: Trigger[] = [];
  const isPulse = (p: number) => p % pulse === 0;
  const preceding = (p: number) => map.pitchAt[p];
  const add = (startMb: number, lenMb: number, degree: number, accent: Accent) => {
    if (degree < 0) return;
    out.push({ tick: startMb * mb, len: lenMb * mb, degree, accent, pulse: isPulse(startMb) });
  };
  const notes = t.events.filter((e) => !e.rest);
  const rests = t.events.filter((e) => e.rest);
  switch (rhythm) {
    case 1: // every note
      for (const e of notes) add(e.start, e.len, e.degree, e.accent);
      break;
    case 2: // every rest: the preceding note's pitch, de-accented (OBS)
      for (const e of rests) add(e.start, e.len, preceding(e.start), -1);
      break;
    case 3: // every note on a pulse
      for (const e of notes) if (isPulse(e.start)) add(e.start, e.len, e.degree, e.accent);
      break;
    case 4: // every rest on a pulse
      for (const e of rests) if (isPulse(e.start)) add(e.start, e.len, preceding(e.start), -1);
      break;
    case 5: // every accented note ("accented" = not de-accented, OBS)
      for (const e of notes) if (e.accent >= 0) add(e.start, e.len, e.degree, e.accent);
      break;
    case 6:
      for (const e of notes) if (e.accent >= 0 && isPulse(e.start)) add(e.start, e.len, e.degree, e.accent);
      break;
    case 7:
      for (const e of notes) if (e.accent >= 0 && !isPulse(e.start)) add(e.start, e.len, e.degree, e.accent);
      break;
    case 8: // every note not on a pulse
      for (const e of notes) if (!isPulse(e.start)) add(e.start, e.len, e.degree, e.accent);
      break;
    case 9: // every rest not on a pulse
      for (const e of rests) if (!isPulse(e.start)) add(e.start, e.len, preceding(e.start), -1);
      break;
    case 10: // every microbeat: the sounding (or preceding) pitch, one microbeat long
      for (let p = 0; p < t.length; p++) {
        const i = map.onsetAt[p];
        add(p, 1, preceding(p), i !== null ? t.events[i].accent : -1);
      }
      break;
    case 11: // every microbeat without an onset
      for (let p = 0; p < t.length; p++) if (map.onsetAt[p] === null) add(p, 1, preceding(p), -1);
      break;
    case 12: // every pulse, lasting to the next pulse (INF)
      for (let p = 0; p < t.length; p += pulse) {
        const i = map.onsetAt[p];
        add(p, Math.min(pulse, t.length - p), preceding(p), i !== null ? t.events[i].accent : -1);
      }
      break;
    default:
      for (const e of notes) add(e.start, e.len, e.degree, e.accent);
  }
  return out;
}

/** classic.acc.divide.v1 */
export function applyDivide(tr: Trigger[], divide: number, rng: Rng): Trigger[] {
  if (divide === 1) return tr;
  if (divide === DIVIDE_HALF) {
    const out: Trigger[] = [];
    for (const t of tr) {
      const a = Math.max(1, Math.floor(t.len / 2));
      out.push({ ...t, len: a });
      if (t.len - a >= 1) out.push({ ...t, tick: t.tick + a, len: t.len - a, pulse: false });
    }
    return out;
  }
  if (divide > 1) return tr.filter((_, i) => i % divide === 0);
  // negative: keep each note with probability 1/|n| (DOC "approximately one in n")
  const n = Math.abs(divide);
  return tr.filter(() => rng.chance(1 / n));
}

/** classic.harmony.inversion.v1: thirds-based re-reading of the degree (OBS, medium confidence). */
export function invertDegree(d: number, tran: number): number {
  const oct = Math.floor(d / 7);
  const pos = ((d % 7) + 7) % 7;
  return 7 * oct + 2 * pos - (tran - 1);
}

const FIXED_BASE = 42; // degree named C5: the fixed-harmony octave (INF placement)

interface HarmonyContext {
  rng: Rng;
  themeDegrees: number[];
  state: VoiceState;
  arpIndex: number;
  arpBase: number;
  weights: number[][];
  onbeatTable: number;
  offbeatTable: number;
  drums: number[];
  drumIndex: number;
  drumDir: number;
}

type HarmonyResult = { degree: number } | { drum: number; index: number } | null;

function arpPattern(span: number, kind: 9 | 10 | 11): number[] {
  const up: number[] = [];
  for (let o = 0; o < Math.max(1, span); o++) up.push(7 * o, 7 * o + 2, 7 * o + 4);
  up.push(7 * Math.max(1, span));
  if (kind === 9) return up;
  const down = [...up].reverse();
  if (kind === 10) return down;
  return [...up, ...down.slice(1, -1)];
}

function liveDrums(drums: number[]): number[] {
  return drums.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
}

/** Pitch (or drum) for one trigger. Returns null when the harmony silences it (Partial). */
function harmonise(h: number, tran: number, tr: Trigger, cx: HarmonyContext): HarmonyResult {
  const d = tr.degree;
  const shift = Math.max(1, tran) - 1;
  if (h >= HARMONY_DRUM_BASE) {
    const live = liveDrums(cx.drums);
    if (!live.length) return null;
    const alg = h - HARMONY_DRUM_BASE + 1;
    let idx: number;
    if (alg === 1) idx = cx.rng.pick(live); // random drums
    else if (alg === 2) {
      // weighted random, by the scale-weight table for the position
      const w = cx.weights[(tr.pulse ? cx.onbeatTable : cx.offbeatTable) - 1] ?? [1, 1, 1, 1, 1, 1, 1];
      const ix = cx.rng.weighted(live.map((i) => w[i] ?? 0));
      idx = ix < 0 ? cx.rng.pick(live) : live[ix];
    } else if (alg === 3) {
      // follow theme: scale position -> table entry (nearest live entry)
      const pos = ((d % 7) + 7) % 7;
      idx = live.reduce((best, i) => (Math.abs(i - pos) < Math.abs(best - pos) ? i : best), live[0]);
    } else if (alg === 4) {
      idx = live[cx.drumIndex % live.length];
      cx.drumIndex++;
    } else {
      // alternating cyclic: forward then back
      const n = live.length;
      const cycle = n <= 1 ? 1 : 2 * n - 2;
      const k = cx.drumIndex % cycle;
      idx = live[k < n ? k : cycle - k];
      cx.drumIndex++;
    }
    return { drum: cx.drums[idx], index: idx };
  }
  switch (h) {
    case 1: // parallel
      return { degree: d + shift };
    case 2: {
      // partial: only notes landing on scale positions 1, 3, 5 sound
      const p = d + shift;
      const pos = ((p % 7) + 7) % 7;
      return pos === 0 || pos === 2 || pos === 4 ? { degree: p } : null;
    }
    case 3: // random harmony: transposed about half the time
      return { degree: cx.rng.chance(0.5) ? d + shift : d };
    case 4: // random notes from the theme (transposed by Tran - 1, INF)
      return { degree: (cx.themeDegrees.length ? cx.rng.pick(cx.themeDegrees) : d) + shift };
    case 5: {
      // contrary motion (classic.harmony.contrary.v1, INF)
      const anchor = d + shift;
      let p: number;
      if (cx.state.prevTheme === null || cx.state.prevVoice === null) p = anchor;
      else p = cx.state.prevVoice - (d - cx.state.prevTheme);
      while (p > anchor + 7) p -= 7;
      while (p < anchor - 7) p += 7;
      cx.state.prevTheme = d;
      cx.state.prevVoice = p;
      return { degree: p };
    }
    case 6:
      return { degree: invertDegree(d, Math.max(1, tran)) };
    case 7: // fixed: Tran is the scale position played
      return { degree: FIXED_BASE + shift };
    case 8: // partial fixed: Tran's scale position in the theme note's own octave
      return { degree: 7 * Math.floor(d / 7) + shift };
    case 9:
    case 10:
    case 11: {
      const pat = arpPattern(Math.max(1, tran), h);
      const p = cx.arpBase + pat[cx.arpIndex % pat.length];
      cx.arpIndex++;
      return { degree: p };
    }
    default:
      return { degree: d };
  }
}

/** classic.articulation.v1: sounding length in clocks. */
export function articulate(art: number, accented: boolean, s: number, mb: number, gap: number): number {
  const shortStaccato = Math.floor(s / 2);
  const shortLegato = s - 1;
  const longStaccato = Math.max(s - mb, Math.floor(s / 2));
  const longLegato = Math.max(s, gap);
  let d: number;
  switch (art) {
    case 1: d = shortStaccato; break;
    case 2: d = accented ? shortLegato : shortStaccato; break;
    case 3: d = accented ? shortStaccato : shortLegato; break;
    case 4: d = shortLegato; break;
    case 5: d = longStaccato; break;
    case 6: d = accented ? longLegato : longStaccato; break;
    case 7: d = accented ? longStaccato : longLegato; break;
    case 8: d = longLegato; break;
    default: d = shortLegato;
  }
  return Math.max(1, d);
}

/** Velocity from base, accent and level; Feel (classic.feel.v1) moves it toward the base. */
export function velocityFor(v: Pick<Voice, 'velocity' | 'accent'>, level: Accent, feel: boolean, rng: Rng | null): number {
  let offset = v.accent * level;
  if (feel && rng && level !== 0) {
    const spread = rng.int(4) * Math.floor(Math.abs(v.accent) / 8);
    offset = Math.sign(offset) * Math.max(0, Math.abs(offset) - spread);
  }
  return Math.max(1, Math.min(127, Math.round(v.velocity + offset)));
}

export function renderPass(inp: RenderInput): { notes: NoteOut[]; state: VoiceState[] } {
  const t = inp.theme;
  const loopClocks = t.length * t.microbeat;
  const audible = audibleVoices(inp.voices);
  const state = inp.state.map((s) => ({ ...s }));
  const themeDegrees = t.events.filter((e) => !e.rest).map((e) => e.degree);
  const firstDeg = themeDegrees.length ? themeDegrees[0] : 35;
  const notes: NoteOut[] = [];
  inp.voices.forEach((v, vi) => {
    if (!audible[vi]) return;
    const rng = new Rng(inp.passSeed).fork(`voice${vi}`);
    const rhythm = vi === 0 ? 1 : v.rhythm;
    const divide = vi === 0 ? 1 : v.divide;
    const harmony = vi === 0 ? 1 : v.harmony;
    const tran = vi === 0 ? 1 : v.tran;
    const triggers = applyDivide(triggersFor(t, rhythm), divide, rng.fork('divide'));
    const cx: HarmonyContext = {
      rng: rng.fork('harmony'),
      themeDegrees,
      state: state[vi],
      arpIndex: 0,
      arpBase: 7 * Math.floor(firstDeg / 7),
      weights: inp.weights,
      onbeatTable: t.params.onbeatTable,
      offbeatTable: t.params.offbeatTable,
      drums: inp.drums,
      drumIndex: 0,
      drumDir: 1,
    };
    const sounding: { tr: Trigger; note: number; drum: number }[] = [];
    for (const tr of triggers) {
      const h = harmonise(harmony, tran, tr, cx);
      if (!h) continue;
      const note = 'drum' in h ? h.drum : foldNote(degreeToMidi(h.degree, inp.tonality, inp.entries) + 12 * v.octave);
      sounding.push({ tr, note, drum: 'drum' in h ? h.index : -1 });
    }
    const feelRng = rng.fork('feel');
    sounding.forEach(({ tr, note, drum }, i) => {
      const next = i + 1 < sounding.length ? sounding[i + 1].tr.tick : sounding[0].tr.tick + loopClocks;
      const dur = articulate(v.art, tr.accent === 1, tr.len, t.microbeat, next - tr.tick);
      notes.push({
        tick: tr.tick + Math.max(0, v.delay),
        dur,
        ch: v.channel,
        note,
        vel: velocityFor(v, tr.accent, inp.feel, feelRng),
        voice: vi,
        drum,
      });
    });
  });
  notes.sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  return { notes, state };
}
