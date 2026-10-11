import { describe, expect, it } from 'vitest';
import { constantTempo, lastTick, normaliseTempo, NotePairer, sortEvents, TimeMap, validateTimeline, type MusicEvent, type Timeline } from '../../src/core/events/timeline';

const note = (tick: number, voice = 'a', pitch = 60, duration = 4): MusicEvent => ({ type: 'note', tick, duration, voice, pitch, velocity: 100 });

describe('timeline: time conversion', () => {
  it('converts ticks to seconds and frames at a constant tempo without drift', () => {
    const m = new TimeMap(constantTempo(120, 24));
    expect(m.seconds(24)).toBe(0.5);
    expect(m.frame(24, 44100)).toBe(22050);
    // a million clocks later the position is still exact (computed, not accumulated)
    const n = 1_000_000;
    expect(m.frame(n, 44100)).toBe(Math.round((n * 60) / (120 * 24) * 44100));
    const odd = new TimeMap(constantTempo(133.7, 96));
    expect(odd.seconds(96 * 1000)).toBeCloseTo(1000 * (60 / 133.7), 9);
  });

  it('handles tempo changes piecewise', () => {
    const m = new TimeMap({ ppq: 24, changes: [{ tick: 0, bpm: 120 }, { tick: 96, bpm: 60 }] });
    expect(m.seconds(96)).toBe(2);
    expect(m.seconds(120)).toBe(3);
    expect(m.bpmAt(100)).toBe(60);
    expect(m.tick(3)).toBeCloseTo(120, 9);
    expect(m.tick(1)).toBeCloseTo(48, 9);
  });

  it('normalises tempo maps', () => {
    expect(normaliseTempo({ ppq: 24, changes: [{ tick: 48, bpm: 90 }, { tick: 48, bpm: 100 }] }).changes).toEqual([{ tick: 0, bpm: 90 }, { tick: 48, bpm: 100 }]);
    expect(() => normaliseTempo({ ppq: 0, changes: [{ tick: 0, bpm: 120 }] })).toThrow();
    expect(() => normaliseTempo({ ppq: 24, changes: [{ tick: 0, bpm: -1 }] })).toThrow();
  });
});

describe('timeline: events', () => {
  it('sorts by tick, controls first, then voice and pitch, stably', () => {
    const cc: MusicEvent = { type: 'control', tick: 10, voice: 'b', controller: 7, value: 100 };
    const sorted = sortEvents([note(10, 'b', 62), note(10, 'a', 64), cc, note(0, 'z'), note(10, 'b', 61)]);
    expect(sorted.map((e) => `${e.tick}${e.type[0]}${e.voice}${'pitch' in e ? e.pitch : ''}`)).toEqual(['0nz60', '10cb', '10na64', '10nb61', '10nb62']);
  });

  it('validates voices, ordering and ranges', () => {
    const t: Timeline = { tempo: constantTempo(120, 24), length: 96, voices: [{ id: 'a', name: 'A' }], events: [note(0), note(4, 'nope'), { ...note(2), duration: 0 } as MusicEvent] };
    const msgs = validateTimeline(t).map((p) => p.message);
    expect(msgs).toContain('unknown voice "nope"');
    expect(msgs).toContain('events are not sorted');
    expect(msgs).toContain('duration must be a whole number >= 1');
    expect(validateTimeline({ ...t, events: [note(0), note(4)] })).toEqual([]);
    expect(lastTick({ ...t, events: [note(90, 'a', 60, 30)] })).toBe(120);
  });

  it('pairs MIDI-style on/off streams into durations with retrigger semantics', () => {
    const p = new NotePairer();
    p.on('1:60', { tick: 0, voice: 'a', pitch: 60, velocity: 90 });
    p.on('1:62', { tick: 2, voice: 'a', pitch: 62, velocity: 90 });
    p.off('1:60', 6);
    p.on('1:62', { tick: 8, voice: 'b', pitch: 62, velocity: 70 }); // retrigger by another voice ends the first
    p.off('1:62', 9);
    p.off('1:99', 9); // stray off ignored
    p.on('1:64', { tick: 10, voice: 'a', pitch: 64, velocity: 80 });
    const notes = p.close(20);
    expect(notes.map((n) => [n.tick, n.duration, n.voice, n.pitch])).toEqual([[0, 6, 'a', 60], [2, 6, 'a', 62], [8, 1, 'b', 62], [10, 10, 'a', 64]]);
  });
});
