import { describe, expect, it } from 'vitest';
import { newProject } from '../src/engine/defaults';
import { Sequencer } from '../src/engine/sequencer';
import { generateTheme } from '../src/engine/theme';
import type { Project } from '../src/engine/types';
import { OutputRouter } from '../src/midi/router';
import { clockPeriodMs } from '../src/transport/clocks';
import { Transport } from '../src/transport/transport';
import { FakePort, FakeTime, unmatchedNotes } from './helpers';

function setup(opts: { source?: 'internal' | 'external'; clockOut?: boolean; mutate?: (p: Project) => void } = {}) {
  const p = newProject(1234);
  p.params.rest = 0;
  p.bank.TA = generateTheme('TA', p.params, p.weights, 99);
  p.bank.TB = generateTheme('TB', { ...p.params, length: 16 }, p.weights, 98);
  p.voices[1].mute = false; // a second voice for more notes
  p.voices[1].art = 8;
  opts.mutate?.(p);
  const time = new FakeTime();
  const port = new FakePort();
  const router = new OutputRouter(time.now);
  router.setNotePort(port);
  const seq = new Sequencer(() => p);
  const tr = new Transport(seq, router, time, () => p);
  tr.clockOut = opts.clockOut ?? true;
  if (opts.source === 'external') tr.setSource('external');
  return { p, time, port, router, seq, tr };
}

const count = (port: FakePort, b: number) => port.statuses().filter((s) => s === b).length;

describe('internal clock and transport', () => {
  it('START sends FA, then F8 at 24 PPQN with the first notes on the first clock', () => {
    const { time, port, tr } = setup();
    tr.start();
    time.advance(1000);
    const st = port.statuses();
    expect(st[0]).toBe(0xfa);
    const firstClock = port.sent.find((s) => s.data[0] === 0xf8)!;
    const firstNote = port.sent.find((s) => (s.data[0] & 0xf0) === 0x90)!;
    expect(firstNote.time).toBe(firstClock.time);
    expect(port.sent.find((s) => s.data[0] === 0xfa)!.time).toBeLessThan(firstClock.time);
    // 120 BPM: 48 clocks per second, give or take the lookahead window
    const clocks = count(port, 0xf8);
    expect(clocks).toBeGreaterThanOrEqual(48);
    expect(clocks).toBeLessThanOrEqual(48 + 6);
    // spacing
    const times = port.sent.filter((s) => s.data[0] === 0xf8).map((s) => s.time);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(clockPeriodMs(120), 6);
  });

  it('no F8 while stopped or paused', () => {
    const { time, port, tr } = setup();
    time.advance(500);
    expect(count(port, 0xf8)).toBe(0);
    tr.start();
    time.advance(500);
    tr.pause();
    const n = port.sent.length;
    time.advance(2000);
    expect(port.sent.slice(n).filter((s) => s.data[0] === 0xf8 && s.time > time.t - 1900).length).toBe(0);
  });

  it('PAUSE sends FC and ends notes; CONTINUE sends FB and resumes from the same position', () => {
    const { time, port, tr, seq } = setup();
    tr.start();
    time.advance(700);
    tr.pause();
    const pos = seq.tick;
    expect(port.statuses()).toContain(0xfc);
    expect(unmatchedNotes(port.sent)).toBe(0);
    time.advance(3000);
    expect(seq.tick).toBe(pos);
    tr.cont();
    time.advance(10);
    const fb = port.sent.findIndex((s) => s.data[0] === 0xfb);
    expect(fb).toBeGreaterThan(0);
    expect(port.statuses().filter((s) => s === 0xfa)).toHaveLength(1); // CONTINUE is not START
    time.advance(500);
    expect(seq.tick).toBeGreaterThan(pos);
  });

  it('PAUSE undoes the lookahead so the resumed position matches what was heard', () => {
    const { time, port, tr, seq } = setup();
    tr.start();
    time.advance(1000);
    tr.pause();
    const heard = port.sent.filter((s) => s.data[0] === 0xf8 && s.time <= time.t).length;
    expect(seq.tick).toBe(heard);
    expect(port.cleared).toBeGreaterThan(0);
  });

  it('STOP/RESET returns to position 0 and leaves nothing sounding', () => {
    const { time, port, tr, seq, router } = setup();
    tr.start();
    time.advance(1234);
    tr.stop();
    expect(seq.tick).toBe(0);
    expect(router.soundingCount).toBe(0);
    expect(unmatchedNotes(port.sent)).toBe(0);
    expect(tr.state).toBe('stopped');
  });

  it('every note-on is paired with a note-off across start/pause/continue/stop and output change', () => {
    const { time, port, tr, router } = setup();
    tr.start();
    time.advance(900);
    tr.pause();
    tr.cont();
    time.advance(777);
    const other = new FakePort('out2', 'Other');
    router.setNotePort(other);
    expect(unmatchedNotes(port.sent)).toBe(0);
    time.advance(600);
    tr.stop();
    expect(unmatchedNotes(other.sent)).toBe(0);
  });

  it('play once: FA, exactly one theme, FC', () => {
    const { time, port, tr, p } = setup();
    tr.playOnce();
    time.advance(10000);
    const st = port.statuses();
    expect(st.filter((s) => s === 0xfa)).toHaveLength(1);
    expect(st.filter((s) => s === 0xfc)).toHaveLength(1);
    const clocks = count(port, 0xf8);
    const t = p.bank.TA!;
    expect(clocks).toBe(t.length * t.microbeat + 1); // the closing clock carries the stop
    expect(tr.state).toBe('stopped');
    expect(unmatchedNotes(port.sent)).toBe(0);
  });

  it('clock out off sends no real-time bytes; tempo changes the clock period', () => {
    const { time, port, tr } = setup({ clockOut: false });
    tr.setTempo(60);
    tr.start();
    time.advance(1000);
    expect(port.statuses().some((s) => s >= 0xf8)).toBe(false);
    expect(port.notes().length).toBeGreaterThan(0);
  });

  it('scheduling margin stays positive under timer jitter', () => {
    const { time, tr } = setup();
    let k = 0;
    time.jitter = () => [0, 3, 11, 27, 6, 40, 1][k++ % 7];
    tr.setTempo(300);
    tr.start();
    time.advance(5000);
    expect(tr.internal.stats.late).toBe(0);
    expect(tr.internal.stats.minMargin).toBeGreaterThanOrEqual(0);
    expect(tr.internal.stats.ticks).toBeGreaterThan(590);
  });

  it('a stalled timer resynchronises instead of bursting old clocks', () => {
    const { time, tr } = setup();
    tr.start();
    time.advance(100);
    let first = true;
    time.jitter = () => (first ? ((first = false), 2000) : 0);
    time.advance(3000);
    expect(tr.internal.stats.resyncs).toBe(1);
  });

  it('PANIC ends everything and sends CC 123/120/64 on all channels', () => {
    const { time, port, tr, router } = setup();
    tr.start();
    time.advance(400);
    tr.panic();
    expect(router.soundingCount).toBe(0);
    const ccs = port.sent.filter((s) => (s.data[0] & 0xf0) === 0xb0);
    for (const n of [123, 120, 64]) expect(ccs.filter((s) => s.data[1] === n)).toHaveLength(16);
  });
});

describe('external clock', () => {
  function feed(tr: Transport, time: FakeTime, bytes: number[], gap = clockPeriodMs(120)) {
    for (const b of bytes) {
      time.advance(b === 0xf8 ? gap : 1);
      tr.external.receive(b, time.t);
    }
  }
  const F8 = (n: number) => Array(n).fill(0xf8);

  it('F8 while stopped never starts playback; status goes WAITING -> DETECTED', () => {
    const { time, tr, port, seq } = setup({ source: 'external' });
    expect(tr.external.status).toBe('waiting');
    feed(tr, time, F8(48));
    expect(tr.external.status).toBe('detected');
    expect(tr.state).toBe('stopped');
    expect(seq.tick).toBe(0);
    expect(port.notes()).toHaveLength(0);
    expect(tr.external.bpm).toBeCloseTo(120, 0);
  });

  it('FA -> F8... -> FC -> F8... -> FB -> F8... continues from the preserved position', () => {
    const { time, tr, seq, port } = setup({ source: 'external' });
    feed(tr, time, [0xfa, ...F8(30)]);
    expect(tr.state).toBe('running');
    expect(seq.tick).toBe(30);
    feed(tr, time, [0xfc, ...F8(20)]);
    expect(tr.state).toBe('paused');
    expect(tr.external.status).toBe('stopped');
    expect(seq.tick).toBe(30);
    expect(unmatchedNotes(port.sent)).toBe(0);
    feed(tr, time, [0xfb, ...F8(10)]);
    expect(tr.state).toBe('running');
    expect(seq.tick).toBe(40);
  });

  it('FA -> F8... -> FC -> FA -> F8... is a fresh restart', () => {
    const { time, tr, seq } = setup({ source: 'external' });
    feed(tr, time, [0xfa, ...F8(50), 0xfc, 0xfa, ...F8(5)]);
    expect(seq.tick).toBe(5);
    expect(tr.state).toBe('running');
  });

  it('the sequencer advances exactly once per F8, whatever the tempo', () => {
    const { time, tr, seq } = setup({ source: 'external' });
    feed(tr, time, [0xfa]);
    feed(tr, time, F8(24), clockPeriodMs(60));
    feed(tr, time, F8(24), clockPeriodMs(200));
    feed(tr, time, F8(24), clockPeriodMs(97));
    expect(seq.tick).toBe(72);
    expect(tr.external.bpm).toBeGreaterThan(97);
    expect(tr.external.bpm).toBeLessThan(200);
  });

  it('notes are emitted at the F8 time (F8 is authoritative)', () => {
    const { time, tr, port } = setup({ source: 'external' });
    feed(tr, time, [0xfa, 0xf8]);
    const t0 = time.t;
    const ons = port.sent.filter((s) => (s.data[0] & 0xf0) === 0x90);
    expect(ons.length).toBeGreaterThan(0);
    for (const o of ons) expect(o.time).toBe(t0);
  });

  it('clock out is never sent while following external clock', () => {
    const { time, tr, port } = setup({ source: 'external', clockOut: true });
    feed(tr, time, [0xfa, ...F8(48), 0xfc, 0xfb, ...F8(10)]);
    expect(port.statuses().some((s) => s >= 0xf8)).toBe(false);
  });

  it('clock loss: notes ended, CLOCK LOST, no continuing; return waits for FA/FB', () => {
    const { time, tr, seq, port, router } = setup({ source: 'external' });
    feed(tr, time, [0xfa, ...F8(40)]);
    time.advance(2500);
    expect(tr.external.status).toBe('lost');
    expect(tr.state).toBe('paused');
    expect(router.soundingCount).toBe(0);
    expect(unmatchedNotes(port.sent)).toBe(0);
    const pos = seq.tick;
    feed(tr, time, F8(30));
    expect(tr.external.status).toBe('detected');
    expect(seq.tick).toBe(pos); // no invented transport state
    feed(tr, time, [0xfb, ...F8(4)]);
    expect(seq.tick).toBe(pos + 4);
  });

  it('after loss the user can arm CONTINUE to rejoin on the next F8', () => {
    const { time, tr, seq } = setup({ source: 'external' });
    feed(tr, time, [0xfa, ...F8(40)]);
    time.advance(2500);
    const pos = seq.tick;
    tr.cont();
    expect(tr.state).toBe('armed');
    feed(tr, time, F8(3));
    expect(seq.tick).toBe(pos + 3);
  });

  it('START while external arms a fresh start on the next F8 (joining a running master)', () => {
    const { time, tr, seq } = setup({ source: 'external' });
    feed(tr, time, F8(10));
    tr.start();
    expect(tr.state).toBe('armed');
    feed(tr, time, F8(7));
    expect(seq.tick).toBe(7);
  });

  it('input disconnect is a clock loss', () => {
    const { time, tr, router } = setup({ source: 'external' });
    feed(tr, time, [0xfa, ...F8(20)]);
    tr.external.portLost();
    expect(tr.external.status).toBe('lost');
    expect(tr.state).toBe('paused');
    expect(router.soundingCount).toBe(0);
  });

  it('synthetic master with tempo changes: position equals F8 count, no hanging notes', () => {
    const { time, tr, seq, port } = setup({ source: 'external' });
    feed(tr, time, [0xfa]);
    let n = 0;
    for (const bpm of [90, 140, 60, 180, 120]) {
      feed(tr, time, F8(96), clockPeriodMs(bpm));
      n += 96;
      expect(seq.tick).toBe(n);
    }
    feed(tr, time, [0xfc]);
    expect(unmatchedNotes(port.sent)).toBe(0);
  });
});
