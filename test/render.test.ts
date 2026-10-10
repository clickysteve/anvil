import { describe, expect, it } from 'vitest';
import { defaultParams, defaultVoice, newProject } from '../src/engine/defaults';
import { applyDivide, articulate, emptyVoiceStates, invertDegree, renderPass, triggersFor, velocityFor } from '../src/engine/render';
import { Rng } from '../src/engine/rng';
import { Sequencer } from '../src/engine/sequencer';
import { scaleEntries } from '../src/engine/tonality';
import type { Accent, Theme, ThemeEvent, Voice } from '../src/engine/types';

/** Build a theme from text: X x o = accented/normal/de-accented onset, - hold, . rest. */
function themeFrom(text: string, degrees: number[], mb = 6, pulse = 2): Theme {
  const events: ThemeEvent[] = [];
  let k = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const last = events[events.length - 1];
    if (c === '-') last.len++;
    else if (c === '.') {
      if (last && last.rest) last.len++;
      else events.push({ start: i, len: 1, rest: true, accent: -1, degree: -1 });
    } else {
      const accent: Accent = c === 'X' ? 1 : c === 'x' ? 0 : -1;
      events.push({ start: i, len: 1, rest: false, accent, degree: degrees[k++ % degrees.length] });
    }
  }
  return { id: 'TA', microbeat: mb, pulse, length: text.length, events, cells: [], seed: 0, params: defaultParams(), algorithms: [], origin: { kind: 'generated' } };
}

// the fixed theme used in the observation pass (20 notes, 4 rests)
const OBS = 'Xxx--.XxXxx--.x--.x--.XxXxXxXxXx';
const theme = themeFrom(OBS, [35, 36, 37, 38, 39, 40, 41]);

describe('accompaniment rhythms 1-12 (classic.acc.rhythm.v1)', () => {
  const counts: Record<number, number> = { 1: 20, 2: 4, 3: 12, 4: 0, 8: 8, 9: 4, 10: 32, 11: 12, 12: 16 };
  for (const [alg, n] of Object.entries(counts)) {
    it(`rhythm ${alg} gives ${n} notes on the observed theme`, () => {
      expect(triggersFor(theme, Number(alg))).toHaveLength(n);
    });
  }
  it('5/6/7 treat normal and accented as "accented", skip de-accented', () => {
    const t = themeFrom('XxoxXo..', [35]);
    expect(triggersFor(t, 5)).toHaveLength(4);
    expect(triggersFor(t, 6).map((x) => x.tick / 6)).toEqual([0, 4]);
    expect(triggersFor(t, 7).map((x) => x.tick / 6)).toEqual([1, 3]);
  });
  it('rest-triggered notes take the preceding theme pitch, de-accented', () => {
    const tr = triggersFor(theme, 2);
    const evs = theme.events;
    for (const t of tr) {
      const prev = evs.filter((e) => !e.rest && e.start * 6 < t.tick).pop()!;
      expect(t.degree).toBe(prev.degree);
      expect(t.accent).toBe(-1);
    }
  });
});

describe('divide (classic.acc.divide.v1)', () => {
  const tr = triggersFor(theme, 1);
  it('n keeps every nth note', () => {
    expect(applyDivide(tr, 2, new Rng(1))).toHaveLength(10);
    expect(applyDivide(tr, 3, new Rng(1))).toHaveLength(7);
  });
  it('half plays each note twice at half value', () => {
    const h = applyDivide(tr, 0, new Rng(1));
    expect(h.length).toBe(40);
    expect(h[0].len + h[1].len).toBe(tr[0].len);
    expect(h[1].degree).toBe(h[0].degree);
  });
  it('negative n keeps about one note in n', () => {
    let kept = 0;
    for (let s = 0; s < 200; s++) kept += applyDivide(tr, -4, new Rng(s)).length;
    expect(kept / (200 * 20)).toBeGreaterThan(0.2);
    expect(kept / (200 * 20)).toBeLessThan(0.3);
    expect(applyDivide(tr, -1, new Rng(3))).toHaveLength(20);
  });
});

describe('harmony', () => {
  it('inversion maps d to 7*floor(d/7) + 2*(d mod 7), Tran shifting down (classic.harmony.inversion.v1)', () => {
    expect(invertDegree(35, 1)).toBe(35);
    expect(invertDegree(36, 1)).toBe(37);
    expect(invertDegree(37, 1)).toBe(39);
    expect(invertDegree(41, 1)).toBe(47);
    expect(invertDegree(37, 5)).toBe(35);
  });
  function render(v: Partial<Voice>, t: Theme = theme) {
    const p = newProject(1);
    const voices = [defaultVoice(0), { ...defaultVoice(1), mute: false, octave: 0, ...v }, ...[2, 3, 4, 5].map(defaultVoice)];
    voices[0].mute = true;
    return renderPass({ theme: t, voices, tonality: p.tonality, entries: scaleEntries(0, []), weights: p.weights, drums: p.drums, feel: false, passSeed: 7, state: emptyVoiceStates() }).notes;
  }
  it('parallel transposes diatonically by Tran - 1 degrees', () => {
    const a = render({ harmony: 1, tran: 1 }).map((n) => n.note);
    const b = render({ harmony: 1, tran: 3 }).map((n) => n.note);
    // C major: C->E, D->F, E->G ...
    expect(b[0] - a[0]).toBe(4);
    expect(b[1] - a[1]).toBe(3);
  });
  it('partial only sounds notes landing on scale positions 1, 3, 5', () => {
    const notes = render({ harmony: 2, tran: 1 }).map((n) => n.note % 12);
    for (const n of notes) expect([0, 4, 7]).toContain(n);
    expect(notes.length).toBeLessThan(20);
  });
  it('fixed plays Tran as a constant scale position; partial fixed follows the octave', () => {
    expect(new Set(render({ harmony: 7, tran: 5 }).map((n) => n.note))).toEqual(new Set([79]));
    for (const n of render({ harmony: 8, tran: 5 })) expect(n.note % 12).toBe(7);
  });
  it('arpeggio up walks the tonic triad over Tran octaves', () => {
    const notes = render({ harmony: 9, tran: 1 }).map((n) => n.note % 12);
    expect(notes.slice(0, 4)).toEqual([0, 4, 7, 0]);
  });
  it('drum harmonies use the drum table and are never transposed', () => {
    const p = newProject(1);
    for (const h of [12, 13, 14, 15, 16]) {
      const notes = render({ harmony: h, tran: 5, octave: 2 });
      for (const n of notes) expect(p.drums).toContain(n.note);
    }
    const cyc = render({ harmony: 15 }).map((n) => n.note);
    expect(cyc.slice(0, 7)).toEqual(newProject(1).drums);
  });
});

describe('articulation (classic.articulation.v1) matches the measured table', () => {
  // [art] -> [6-clock accented, 6-clock normal, 18-clock normal followed by a 6-clock rest]
  const table: Record<number, [number, number, number]> = {
    1: [3, 3, 9], 2: [5, 3, 9], 3: [3, 5, 17], 4: [5, 5, 17],
    5: [3, 3, 12], 6: [6, 3, 12], 7: [3, 6, 24], 8: [6, 6, 24],
  };
  for (const [art, [a, n, l]] of Object.entries(table)) {
    it(`art ${art}`, () => {
      expect(articulate(Number(art), true, 6, 6, 6)).toBe(a);
      expect(articulate(Number(art), false, 6, 6, 6)).toBe(n);
      expect(articulate(Number(art), false, 18, 6, 24)).toBe(l);
    });
  }
});

describe('velocity', () => {
  it('base +/- accent exactly; negative accent inverts; clamped', () => {
    const v = { velocity: 64, accent: 12 };
    expect([1, 0, -1].map((l) => velocityFor(v, l as Accent, false, null))).toEqual([76, 64, 52]);
    expect(velocityFor({ velocity: 64, accent: -12 }, 1, false, null)).toBe(52);
    expect(velocityFor({ velocity: 120, accent: 40 }, 1, false, null)).toBe(127);
    expect(velocityFor({ velocity: 10, accent: 40 }, -1, false, null)).toBe(1);
  });
  it('Feel (classic.feel.v1) moves accented/de-accented notes toward the base only', () => {
    const r = new Rng(3);
    for (let i = 0; i < 100; i++) {
      const a = velocityFor({ velocity: 64, accent: 32 }, 1, true, r);
      expect(a).toBeGreaterThanOrEqual(64);
      expect(a).toBeLessThanOrEqual(96);
      expect((96 - a) % 4).toBe(0);
      expect(velocityFor({ velocity: 64, accent: 32 }, 0, true, r)).toBe(64);
    }
  });
});

describe('sequencer', () => {
  function seqWith(mutate?: (p: ReturnType<typeof newProject>) => void) {
    const p = newProject(5);
    p.bank.TA = themeFrom(OBS, [35, 37, 39]);
    p.bank.TB = themeFrom('XxXx', [42]);
    mutate?.(p);
    const s = new Sequencer(() => p);
    s.reset();
    return { p, s };
  }
  const run = (s: Sequencer, n: number) => {
    const ev = [];
    for (let i = 0; i < n; i++) ev.push(...s.tick1().events.map((e) => ({ ...e, t: s.tick - 1 })));
    return ev;
  };
  it('loops the theme: loop length = microbeat x length clocks', () => {
    const { s } = seqWith();
    const ev = run(s, 192 * 2);
    const ons = ev.filter((e) => e.kind === 'on');
    expect(ons.length).toBe(40);
    expect(ons[20].t).toBe(192);
  });
  it('a queued item starts at the end of the theme (Theme alignment)', () => {
    const { s } = seqWith();
    run(s, 50);
    s.queueItem('TB');
    run(s, 100);
    expect(s.item).toBe('TA');
    run(s, 42);
    expect(s.item).toBe('TA');
    run(s, 1);
    expect(s.item).toBe('TB');
    expect(s.passStart).toBe(192);
  });
  it('pulse alignment switches at the next pulse; immediate switches on the next clock', () => {
    const { s, p } = seqWith();
    p.options.themeAlign = 'pulse';
    run(s, 13);
    s.queueItem('TB');
    run(s, 1);
    expect(s.item).toBe('TA');
    run(s, 10);
    expect(s.item).toBe('TA');
    run(s, 1);
    expect(s.item).toBe('TB');
    expect(s.passStart).toBe(24);
    s.queueItem('TA', true);
    run(s, 1);
    expect(s.item).toBe('TA');
  });
  it('note-offs pair with note-ons, including retriggers of the same note', () => {
    const { s } = seqWith((p) => {
      p.voices[0].art = 8; // long legato: overlapping same pitches
      p.voices[1].mute = false;
      p.voices[1].rhythm = 10;
      p.voices[1].delay = 3;
    });
    const ev = run(s, 192 * 3);
    const open = new Map<string, number>();
    for (const e of ev) {
      const k = `${e.ch}:${e.note}`;
      if (e.kind === 'on') {
        expect(open.get(k) ?? 0).toBe(0);
        open.set(k, 1);
      } else open.set(k, 0);
    }
    const rest = s.silence();
    expect(rest.length).toBe([...open.values()].filter((v) => v).length);
  });
  it('voice delay shifts notes by clocks', () => {
    const { s } = seqWith((p) => (p.voices[0].delay = 5));
    const ev = run(s, 20);
    expect(ev.find((e) => e.kind === 'on')!.t).toBe(5);
  });
  it('tonality changes apply at the microbeat boundary', () => {
    const { s, p } = seqWith();
    run(s, 7);
    s.queueTonality({ ...p.tonality, key: 2 });
    const ev = run(s, 30);
    const first = ev.find((e) => e.kind === 'on')!;
    expect(first.t).toBe(12);
    expect(first.note).toBe(67 + 2); // third note, degree 39 (G), in D
  });
  it('the arranger steps through items by clocks', () => {
    const { s, p } = seqWith();
    p.arranger.steps = [
      { item: 'TA', preset: null, scale: null, mode: null, key: null, octave: null, clocks: 192 },
      { item: 'TB', preset: null, scale: null, mode: null, key: 5, octave: null, clocks: 48 },
    ];
    s.startArranger();
    run(s, 192);
    run(s, 1);
    expect(s.item).toBe('TB');
    expect(s.activeTonality.key).toBe(5);
  });
  it('rendering is deterministic for the same performance', () => {
    const a = seqWith((p) => { p.voices[1].mute = false; p.voices[1].harmony = 3; p.options.feel = true; });
    const b = seqWith((p) => { p.voices[1].mute = false; p.voices[1].harmony = 3; p.options.feel = true; });
    expect(run(a.s, 600)).toEqual(run(b.s, 600));
  });
});
