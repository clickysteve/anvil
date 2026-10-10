import type { TimeSource } from '../src/transport/clocks';
import type { OutPort } from '../src/midi/router';

/** A manual clock with timers, for deterministic timing tests. */
export class FakeTime implements TimeSource {
  t = 1000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private id = 0;
  /** extra delay added to every timer wake-up (simulates timer jitter) */
  jitter: () => number = () => 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.id;
    this.timers.push({ at: this.t + ms + this.jitter(), fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  /** Advance time, firing timers in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

export interface Sent {
  data: number[];
  time: number;
}

export class FakePort implements OutPort {
  sent: Sent[] = [];
  cleared = 0;
  constructor(public id = 'out1', public name = 'Fake Out') {}
  send(data: number[], timestamp?: number): void {
    this.sent.push({ data: [...data], time: timestamp ?? 0 });
  }
  clear(): void {
    this.cleared++;
  }
  /** status bytes only */
  statuses(): number[] {
    return this.sent.map((s) => s.data[0]);
  }
  notes(): Sent[] {
    return this.sent.filter((s) => (s.data[0] & 0xe0) === 0x80);
  }
}

/** Check every note-on has a later (or equal-time) matching note-off; returns unmatched count. */
export function unmatchedNotes(sent: Sent[]): number {
  const open = new Map<string, number>();
  for (const s of sent) {
    const st = s.data[0] & 0xf0;
    const key = `${s.data[0] & 15}:${s.data[1]}`;
    if (st === 0x90 && s.data[2] > 0) open.set(key, (open.get(key) ?? 0) + 1);
    else if (st === 0x80 || (st === 0x90 && s.data[2] === 0)) {
      const n = open.get(key) ?? 0;
      if (n > 1) open.set(key, n - 1);
      else open.delete(key);
    }
  }
  let n = 0;
  for (const v of open.values()) n += v;
  return n;
}
