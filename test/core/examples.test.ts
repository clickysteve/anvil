import { describe, expect, it } from 'vitest';
import { exampleTimeline, exampleTransform } from '../../src/core/examples/newApp';
import { TimeMap, validateTimeline } from '../../src/core';

describe('Core examples (the browser-free parts)', () => {
  it('builds a valid timeline for an application with its own voices and resolution', () => {
    const t = exampleTimeline();
    expect(validateTimeline(t)).toEqual([]);
    expect(new TimeMap(t.tempo).seconds(96)).toBeCloseTo(60 / 128, 12);
    expect(t.events.find((e) => e.type === 'note' && e.instrument)).toMatchObject({ voice: 'kick', instrument: 'snare-sample' });
  });

  it('applies a Good Bits transformation to plain audio data', () => {
    const audio = { sampleRate: 22050, channels: [Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 5) * Math.exp(-i / 2000))] };
    const out = exampleTransform(audio);
    expect(out.channels[0].length).toBeGreaterThan(audio.channels[0].length * 1.8);
  });
});
