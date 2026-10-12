import { describe, expect, it } from 'vitest';
import { DEMOS } from '../src/app/demos';
import { newProject } from '../src/engine/defaults';
import { freezePerformance, secondsPerClock } from '../src/engine/perform';
import { Sequencer } from '../src/engine/sequencer';
import { generateTheme } from '../src/engine/theme';
import type { Project } from '../src/engine/types';
import { renderPerformance } from '../src/midi/smf';
import { OutputRouter } from '../src/midi/router';
import { serializeProject } from '../src/persistence/format';
import { clockPeriodMs } from '../src/transport/clocks';
import { Transport } from '../src/transport/transport';
import { FakePort, FakeTime } from './helpers';

/** A project with a melodic accompaniment voice, a random drum voice and Feel (all the random paths). */
function busyProject(): Project {
  const p = newProject(777);
  p.bank.TA = generateTheme('TA', p.params, p.weights, 41);
  p.bank.TB = generateTheme('TB', { ...p.params, length: 16 }, p.weights, 42);
  p.voices[1] = { ...p.voices[1], mute: false, channel: 2, harmony: 3, tran: 3, divide: -2 };
  p.voices[2] = { ...p.voices[2], mute: false, channel: 10, rhythm: 10, harmony: 12, art: 1 };
  p.options.feel = true;
  return p;
}

/** Run the real transport (internal clock, fake time) through ONCE and return note messages by clock. */
function livePass(p: Project): { clock: number; kind: 'on' | 'off'; ch: number; note: number; vel: number }[] {
  const time = new FakeTime();
  const port = new FakePort();
  const router = new OutputRouter(time.now);
  router.setNotePort(port);
  const seq = new Sequencer(() => p);
  const tr = new Transport(seq, router, time, () => p);
  tr.clockOut = true;
  tr.setTempo(p.tempo);
  tr.playOnce();
  time.advance(60_000);
  const t0 = port.sent.find((s) => s.data[0] === 0xf8)!.time;
  const period = clockPeriodMs(p.tempo);
  return port.notes().map((s) => ({
    clock: Math.round((s.time - t0) / period),
    kind: (s.data[0] & 0xf0) === 0x90 && s.data[2] > 0 ? 'on' : 'off',
    ch: (s.data[0] & 15) + 1,
    note: s.data[1],
    vel: (s.data[0] & 0xf0) === 0x90 ? s.data[2] : 0,
  }));
}

describe('frozen performance', () => {
  it('is deterministic and does not modify the project', () => {
    const p = busyProject();
    const before = serializeProject(p);
    const a = freezePerformance(p, { passes: 3 });
    const b = freezePerformance(p, { passes: 3 });
    expect(a).toEqual(b);
    expect(serializeProject(p)).toBe(before);
    expect(a.clocks).toBe(3 * p.bank.TA!.length * p.bank.TA!.microbeat);
    expect(a.tempo).toBe(p.tempo);
  });

  it('lists events in clock order with on/off pairs closed at the end', () => {
    const perf = freezePerformance(busyProject(), { passes: 2 });
    for (let i = 1; i < perf.events.length; i++) expect(perf.events[i].clock).toBeGreaterThanOrEqual(perf.events[i - 1].clock);
    const open = new Map<string, number>();
    for (const e of perf.events) {
      const k = `${e.ch}:${e.note}`;
      if (e.kind === 'on') open.set(k, (open.get(k) ?? 0) + 1);
      else if (open.get(k)) open.set(k, open.get(k)! - 1);
    }
    expect([...open.values()].every((n) => n === 0)).toBe(true);
    expect(perf.events.every((e) => e.clock <= perf.clocks)).toBe(true);
  });

  it('assigns every note to its voice and drum notes to their drum-table entry', () => {
    const p = busyProject();
    const perf = freezePerformance(p);
    const ons = perf.events.filter((e) => e.kind === 'on');
    expect(new Set(ons.map((e) => e.voice))).toEqual(new Set([0, 1, 2]));
    for (const e of ons) {
      if (e.voice === 2) {
        expect(e.drum).toBeGreaterThanOrEqual(0);
        expect(e.note).toBe(p.drums[e.drum]);
      } else expect(e.drum).toBe(-1);
    }
  });

  it('reproduces what the live transport plays from START, random choices included', () => {
    for (const p of [busyProject(), ...DEMOS.map((d) => d.build())]) {
      const perf = freezePerformance(p);
      const live = livePass(p);
      const frozenOns = perf.events.filter((e) => e.kind === 'on').map(({ clock, ch, note, vel }) => ({ clock, ch, note, vel }));
      const liveOns = live.filter((e) => e.kind === 'on').map(({ clock, ch, note, vel }) => ({ clock, ch, note, vel }));
      expect(liveOns).toEqual(frozenOns);
      // note-offs inside the pass land on the same clocks too
      const inside = (e: { clock: number }) => e.clock < perf.clocks;
      expect(live.filter((e) => e.kind === 'off' && inside(e)).map((e) => `${e.clock}:${e.ch}:${e.note}`)).toEqual(
        perf.events.filter((e) => e.kind === 'off' && inside(e)).map((e) => `${e.clock}:${e.ch}:${e.note}`),
      );
    }
  });

  it('plays the arranger once through and honours a chosen item', () => {
    const p = busyProject();
    const step = (item: 'TA' | 'TB', clocks: number) => ({ item, preset: null, scale: null, mode: null, key: null, octave: null, clocks });
    p.arranger.steps = [step('TA', 192), step('TB', 96)];
    p.options.arrangerLoop = true;
    const arr = freezePerformance(p, { arranger: true });
    expect(arr.arranger).toBe(true);
    expect(arr.clocks).toBeGreaterThanOrEqual(192 + 96);
    expect(p.options.arrangerLoop).toBe(true);
    const tb = freezePerformance(p, { item: 'TB' });
    expect(tb.item).toBe('TB');
    expect(tb.clocks).toBe(p.bank.TB!.length * p.bank.TB!.microbeat);
    expect(p.selected).toBe('TA');
  });

  it('is what the MIDI file export renders', () => {
    const p = busyProject();
    p.options.sendProgramsAtStart = true;
    p.voices[0].program = 5;
    const perf = freezePerformance(p, { passes: 2 });
    const smf = renderPerformance(p, { passes: 2 });
    expect(smf.clocks).toBe(perf.clocks);
    expect(smf.msgs[0].data).toEqual([0xc0, 4]);
    expect(smf.msgs.slice(perf.programs.length).map((m) => [m.clock, ...m.data])).toEqual(
      perf.events.map((e) => [e.clock, ...(e.kind === 'on' ? [0x90 | (e.ch - 1), e.note, e.vel] : [0x80 | (e.ch - 1), e.note, 0])]),
    );
  });

  it('converts clocks to seconds from the tempo', () => {
    expect(secondsPerClock(120)).toBeCloseTo(60 / (120 * 24), 12);
    expect(secondsPerClock(5)).toBe(secondsPerClock(20));
  });
});

describe('ANVIL timeline adapter', () => {
  it('turns a frozen performance into a valid core timeline with voices and drum assignments', async () => {
    const { performanceTimeline, voiceId, drumIndexOf } = await import('../src/audio/anvilTimeline');
    const { validateTimeline, TimeMap } = await import('@slopfactory/core/events');
    const p = busyProject();
    const perf = freezePerformance(p, { passes: 2 });
    const t = performanceTimeline(perf, p);
    expect(validateTimeline(t)).toEqual([]);
    expect(t.tempo).toEqual({ ppq: 24, changes: [{ tick: 0, bpm: p.tempo }] });
    expect(t.length).toBe(perf.clocks);
    expect(t.voices.map((v) => v.name)).toEqual(['Voice 1 theme', 'Voice 2', 'Voice 3 drums', 'Voice 4', 'Voice 5', 'Voice 6']);
    const ons = perf.events.filter((e) => e.kind === 'on');
    expect(t.events.length).toBe(ons.length);
    for (const n of t.events) {
      if (n.type !== 'note') continue;
      const d = drumIndexOf(n.instrument);
      if (n.voice === voiceId(2)) expect(p.drums[d]).toBe(n.pitch);
      else expect(d).toBe(-1);
      expect(n.tick + n.duration).toBeLessThanOrEqual(perf.clocks);
    }
    // seconds per clock match the transport's clock period
    expect(new TimeMap(t.tempo).seconds(24)).toBeCloseTo(60 / p.tempo, 12);
  });
});
