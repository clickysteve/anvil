import { describe, expect, it } from 'vitest';
import { Rng, deriveSeed } from '../src/engine/rng';
import { SCALES, PRESET_SCALES, degreeToMidi, degreeName, entriesFromSteps, scaleEntries } from '../src/engine/tonality';
import { generateRhythm, rhythmText, buildCell, isAVersion } from '../src/engine/rhythm';
import { generatePitches } from '../src/engine/pitch';
import { defaultParams, defaultWeights } from '../src/engine/defaults';
import { generateTheme, generateVariation, toSlots } from '../src/engine/theme';
import type { TVParams, ThemeEvent } from '../src/engine/types';

const P = (o: Partial<TVParams> = {}): TVParams => ({ ...defaultParams(), ...o });
const W = defaultWeights();
const UNIFORM = Array.from({ length: 8 }, () => [1, 1, 1, 1, 1, 1, 1]);

describe('rng', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 10 }, () => a.u32());
    expect(Array.from({ length: 10 }, () => b.u32())).toEqual(sa);
    expect(Array.from({ length: 10 }, () => c.u32())).not.toEqual(sa);
  });
  it('int stays in range and weighted never picks zero weight', () => {
    const r = new Rng(1);
    for (let i = 0; i < 2000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      expect(r.weighted([0, 3, 0, 1])).not.toBe(0);
    }
    expect(r.weighted([0, 0])).toBe(-1);
  });
  it('deriveSeed separates parts', () => {
    expect(deriveSeed('ab', 'c')).not.toBe(deriveSeed('a', 'bc'));
    expect(deriveSeed(1, 2)).toBe(deriveSeed(1, 2));
  });
});

describe('tonality', () => {
  it('has exactly 38 distinct preset scales of 7 steps 1..3 summing to 12, Major first', () => {
    expect(SCALES).toHaveLength(PRESET_SCALES);
    expect(PRESET_SCALES).toBe(38);
    const canon = new Set<string>();
    for (const s of SCALES) {
      expect(s.steps).toHaveLength(7);
      expect(s.steps.reduce((a, b) => a + b, 0)).toBe(12);
      for (const st of s.steps) expect([1, 2, 3]).toContain(st);
      const str = s.steps.join('');
      const rots = Array.from({ length: 7 }, (_, i) => str.slice(i) + str.slice(0, i)).sort();
      canon.add(rots[6]);
    }
    expect(canon.size).toBe(38);
    expect(SCALES[0].name).toBe('Major');
    expect(SCALES[0].steps).toEqual([2, 2, 1, 2, 2, 2, 1]);
  });
  it('maps degree 35 to middle C in C major and applies mode, key and octave', () => {
    const e = scaleEntries(0, []);
    expect(degreeToMidi(35, { scale: 0, mode: 1, key: 0, octave: 0 }, e)).toBe(60);
    expect(degreeToMidi(36, { scale: 0, mode: 1, key: 0, octave: 0 }, e)).toBe(62);
    expect(degreeName(35)).toBe('C4');
    // mode 2 (dorian) rooted on the key: degree 37 (3rd) is a minor third above
    expect(degreeToMidi(37, { scale: 0, mode: 2, key: 0, octave: 0 }, e) - degreeToMidi(35, { scale: 0, mode: 2, key: 0, octave: 0 }, e)).toBe(3);
    expect(degreeToMidi(35, { scale: 0, mode: 1, key: 2, octave: 1 }, e)).toBe(74);
  });
  it('user scale entries are used verbatim', () => {
    const u = entriesFromSteps([1, 1, 1, 1, 1, 1, 6]);
    expect(degreeToMidi(36, { scale: 38, mode: 1, key: 0, octave: 0 }, scaleEntries(38, [u]))).toBe(61);
  });
});

function periodOf(s: string): number {
  for (let p = 1; p <= s.length; p++) {
    let ok = true;
    for (let i = p; i < s.length; i++) if (s[i] !== s[i - p]) { ok = false; break; }
    if (ok) return p;
  }
  return s.length;
}

describe('rhythm (classic.rhythm.*.v1)', () => {
  it('Single A/B loop one cell of Variant x Pulse microbeats', () => {
    for (const alg of [3, 4]) for (const [v, pulse] of [[3, 2], [2, 4], [5, 1], [4, 3]]) for (let s = 0; s < 6; s++) {
      const r = generateRhythm({ length: 48, pulse, rest: 0, rhythmAlg: alg, rhythmVariant: v }, new Rng(s));
      const text = rhythmText(r.events);
      expect(text.length).toBe(48);
      expect((v * pulse) % periodOf(text)).toBe(0);
    }
  });
  it('Single A: on-pulse notes accented or normal, off-pulse notes normal or de-accented', () => {
    for (let s = 0; s < 30; s++) {
      const r = generateRhythm({ length: 32, pulse: 2, rest: 0, rhythmAlg: 3, rhythmVariant: 3 }, new Rng(s));
      for (const e of r.events) if (!e.rest) {
        if (e.start % 2 === 0) expect(e.accent).not.toBe(-1);
        else expect(e.accent).not.toBe(1);
      }
    }
  });
  it('Single B uses only accented and de-accented notes', () => {
    for (let s = 0; s < 30; s++) {
      const r = generateRhythm({ length: 32, pulse: 2, rest: 0, rhythmAlg: 4, rhythmVariant: 3 }, new Rng(s));
      for (const e of r.events) if (!e.rest) expect(e.accent).not.toBe(0);
    }
  });
  it('rest 0 gives no rests; A cells never start with a rest; rest 99 leaves one note per A cell', () => {
    for (let s = 0; s < 20; s++) for (const alg of [1, 2, 3, 4, 5, 6]) {
      const r = generateRhythm({ length: 32, pulse: 2, rest: 0, rhythmAlg: alg, rhythmVariant: 3 }, new Rng(s));
      expect(r.events.some((e) => e.rest)).toBe(false);
    }
    for (let s = 0; s < 20; s++) for (const alg of [1, 3, 5, 6]) {
      const r = generateRhythm({ length: 32, pulse: 2, rest: 40, rhythmAlg: alg, rhythmVariant: 3 }, new Rng(s));
      const slots = toSlots(r);
      for (const c of r.cells) expect(slots.slots[c.start].kind).toBe('on');
    }
    const r = generateRhythm({ length: 36, pulse: 2, rest: 99, rhythmAlg: 3, rhythmVariant: 3 }, new Rng(5));
    expect(r.events.filter((e) => !e.rest).length).toBe(6);
  });
  it('B cells may start with a rest', () => {
    let found = false;
    for (let s = 0; s < 60 && !found; s++) {
      const r = generateRhythm({ length: 32, pulse: 2, rest: 50, rhythmAlg: 4, rhythmVariant: 3 }, new Rng(s));
      if (r.events[0].rest) found = true;
    }
    expect(found).toBe(true);
    expect(isAVersion(2)).toBe(false);
  });
  it('Second Order Variant 1 repeats one pulse-length cell', () => {
    for (let s = 0; s < 10; s++) {
      const r = generateRhythm({ length: 32, pulse: 2, rest: 0, rhythmAlg: 1, rhythmVariant: 1 }, new Rng(s));
      expect(2 % periodOf(rhythmText(r.events))).toBe(0);
    }
  });
  it('Second Order cells are multiples of the pulse', () => {
    for (let s = 0; s < 10; s++) {
      const r = generateRhythm({ length: 64, pulse: 4, rest: 0, rhythmAlg: 2, rhythmVariant: 6 }, new Rng(s));
      for (const c of r.cells.slice(0, -1)) expect(c.len % 4).toBe(0);
    }
  });
  it('3/1 Preset: base base base varied, group repeats identically; 1/1 alternates base', () => {
    for (let s = 0; s < 10; s++) {
      const r = generateRhythm({ length: 64, pulse: 2, rest: 0, rhythmAlg: 6, rhythmVariant: 2 }, new Rng(s));
      const t = rhythmText(r.events);
      const c = (i: number) => t.slice(i * 4, i * 4 + 4);
      expect(c(1)).toBe(c(0));
      expect(c(2)).toBe(c(0));
      expect(t.slice(16, 32)).toBe(t.slice(0, 16));
      const r5 = generateRhythm({ length: 64, pulse: 2, rest: 0, rhythmAlg: 5, rhythmVariant: 2 }, new Rng(s));
      const t5 = rhythmText(r5.events);
      for (let i = 2; i < 16; i += 2) expect(t5.slice(i * 4, i * 4 + 4)).toBe(t5.slice(0, 4));
    }
  });
  it('lengths add up and the event limit is 99', () => {
    const r = generateRhythm({ length: 256, pulse: 1, rest: 50, rhythmAlg: 2, rhythmVariant: 8 }, new Rng(3));
    expect(r.events.length).toBeLessThanOrEqual(99);
    let pos = 0;
    for (const e of r.events) {
      expect(e.start).toBe(pos);
      expect(e.len).toBeGreaterThanOrEqual(1);
      pos += e.len;
    }
    expect(pos).toBe(r.length);
  });
  it('buildCell is deterministic', () => {
    const p = { length: 8, pulse: 2, rest: 30, rhythmAlg: 1, rhythmVariant: 3 };
    expect(buildCell(p, 8, new Rng(9))).toEqual(buildCell(p, 8, new Rng(9)));
  });
});

const notesOf = (ev: ThemeEvent[]) => ev.filter((e) => !e.rest).map((e) => e.degree);

describe('pitch (classic.pitch.v1)', () => {
  const rhythm = (n: number): ThemeEvent[] => Array.from({ length: n }, (_, i) => ({ start: i, len: 1, rest: false, accent: 0 as const, degree: -1 }));
  it('keeps every note within High/Low', () => {
    for (let s = 0; s < 20; s++) {
      const ev = generatePitches(rhythm(64), 1, P({ low: 35, high: 39, maxStep: 1, maxLeap: 2 }), UNIFORM, new Rng(s));
      for (const d of notesOf(ev)) {
        expect(d).toBeGreaterThanOrEqual(35);
        expect(d).toBeLessThanOrEqual(39);
      }
    }
  });
  it('obeys Leap, and after an interval larger than Step the next is within Step (when possible)', () => {
    let checked = 0;
    for (let s = 0; s < 20; s++) {
      const ev = generatePitches(rhythm(64), 1, P({ low: 28, high: 49, maxStep: 2, maxLeap: 4, maxRepeats: 3 }), UNIFORM, new Rng(s));
      const d = notesOf(ev);
      for (let i = 1; i < d.length; i++) {
        expect(Math.abs(d[i] - d[i - 1])).toBeLessThanOrEqual(4);
        if (i >= 2 && Math.abs(d[i - 1] - d[i - 2]) > 2) {
          expect(Math.abs(d[i] - d[i - 1])).toBeLessThanOrEqual(2);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
  it('First Note fixes the starting scale position; 0 is free', () => {
    for (let s = 0; s < 10; s++) {
      const ev = generatePitches(rhythm(8), 1, P({ firstNote: 3 }), UNIFORM, new Rng(s));
      expect(notesOf(ev)[0] % 7).toBe(2);
    }
  });
  it('Pitch Loop N repeats with period N; 1 holds one pitch', () => {
    const d = notesOf(generatePitches(rhythm(32), 1, P({ pitchLoop: 4 }), UNIFORM, new Rng(1)));
    for (let i = 4; i < d.length; i++) expect(d[i]).toBe(d[i - 4]);
    const one = notesOf(generatePitches(rhythm(16), 1, P({ pitchLoop: 1 }), UNIFORM, new Rng(1)));
    expect(new Set(one).size).toBe(1);
  });
  it('Max Repeats limits successive identical pitches (classic.pitch.repeats.v1)', () => {
    for (const rep of [1, 2, 3]) for (let s = 0; s < 10; s++) {
      const d = notesOf(generatePitches(rhythm(64), 1, P({ low: 35, high: 37, maxRepeats: rep, maxStep: 2, maxLeap: 2 }), UNIFORM, new Rng(s)));
      let run = 1;
      for (let i = 1; i < d.length; i++) {
        run = d[i] === d[i - 1] ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(rep);
      }
    }
  });
  it('never chooses a zero-weight scale position', () => {
    const triad = Array.from({ length: 8 }, () => [8, 0, 6, 0, 7, 0, 0]);
    for (let s = 0; s < 10; s++) {
      const d = notesOf(generatePitches(rhythm(64), 1, P({ firstNote: 0, maxStep: 1, maxLeap: 1 }), triad, new Rng(s)));
      for (const x of d) expect([0, 2, 4]).toContain(x % 7);
    }
  });
  it('uses the Onbeat table on pulse notes and the Offbeat table off the pulse', () => {
    const w = [[1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0], ...UNIFORM.slice(2)];
    const ev = generatePitches(rhythm(16), 2, P({ onbeatTable: 1, offbeatTable: 2, firstNote: 0, maxStep: 7, maxLeap: 7, maxRepeats: 9, low: 28, high: 48 }), w, new Rng(1));
    ev.forEach((e) => expect(e.degree % 7).toBe(e.start % 2 === 0 ? 0 : 4));
  });
});

describe('themes and variations', () => {
  it('generation is deterministic for a seed and parameters', () => {
    expect(generateTheme('TA', P(), W, 77)).toEqual(generateTheme('TA', P(), W, 77));
    expect(generateTheme('TA', P(), W, 77).events).not.toEqual(generateTheme('TA', P(), W, 78).events);
  });
  it('records the algorithm ids used', () => {
    const t = generateTheme('TA', P({ rhythmAlg: 3 }), W, 1);
    expect(t.algorithms).toContain('classic.rhythm.single.v1');
    expect(t.algorithms).toContain('classic.pitch.repeats.v1');
  });
  it('pitch var 3 reverses the last V pitches; 0/0 copies unchanged', () => {
    const t = generateTheme('TA', P({ rest: 0 }), W, 5);
    const v = generateVariation('VA1', t, P({ rhythmVarAlg: 0, pitchVarAlg: 3, varVariant: 4 }), W, 9);
    const a = notesOf(t.events);
    const b = notesOf(v.events);
    expect(b.slice(0, -4)).toEqual(a.slice(0, -4));
    expect(b.slice(-4)).toEqual(a.slice(-4).reverse());
    const same = generateVariation('VA2', t, P({ rhythmVarAlg: 0, pitchVarAlg: 0 }), W, 9);
    expect(same.events).toEqual(t.events);
    expect(v.origin.from).toBe('TA');
  });
  it('pitch var 1 V0 regenerates all pitches but keeps the rhythm', () => {
    const t = generateTheme('TA', P({ rest: 0 }), W, 5);
    const v = generateVariation('VA1', t, P({ rhythmVarAlg: 0, pitchVarAlg: 1, varVariant: 0 }), W, 10);
    expect(v.events.map((e) => [e.start, e.len, e.rest, e.accent])).toEqual(t.events.map((e) => [e.start, e.len, e.rest, e.accent]));
  });
  it('pitch var 2 inverts around the first varied pitch', () => {
    const t = generateTheme('TA', P({ rest: 0, low: 21, high: 55 }), W, 6);
    const v = generateVariation('VA1', t, P({ rhythmVarAlg: 0, pitchVarAlg: 2, varVariant: 0, low: 0, high: 69 }), W, 1);
    const a = notesOf(t.events);
    const b = notesOf(v.events);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(2 * a[0] - a[i]);
  });
  it('rhythm var 3 halves, 5 deletes the last V microbeats, 4 deletes the last microrhythm', () => {
    const t = generateTheme('TA', P({ length: 32 }), W, 5);
    expect(generateVariation('VA1', t, P({ rhythmVarAlg: 3, pitchVarAlg: 0 }), W, 1).length).toBe(16);
    expect(generateVariation('VA1', t, P({ rhythmVarAlg: 5, pitchVarAlg: 0, varVariant: 3 }), W, 1).length).toBe(29);
    const v4 = generateVariation('VA1', t, P({ rhythmVarAlg: 4, pitchVarAlg: 0 }), W, 1);
    expect(v4.length).toBe(t.cells[t.cells.length - 1].start);
  });
  it('rhythm var 2 keeps total length and pitch order', () => {
    const t = generateTheme('TA', P({ rhythmAlg: 1, rhythmVariant: 6, length: 32 }), W, 12);
    const v = generateVariation('VA1', t, P({ rhythmVarAlg: 2, pitchVarAlg: 0 }), W, 3);
    expect(v.length).toBe(t.length);
    const a = notesOf(t.events);
    const b = notesOf(v.events);
    const n = Math.min(a.length, b.length);
    expect(b.slice(0, n)).toEqual(a.slice(0, n));
  });
});
