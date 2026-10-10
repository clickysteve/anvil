/**
 * MIDI monitor: a bounded log of what ANVIL sends and receives.
 *
 * MIDI clock (F8) arrives 24 times per quarter note and would bury everything else, so clock
 * bytes are never logged one by one: they are counted per direction and summarised as a rate.
 * Start, Continue and Stop are always logged. Active sensing is counted, not logged.
 */
import { ACTIVE_SENSING, CLOCK, describe, hex } from './messages';
import type { Direction } from './router';

export interface MonitorEntry {
  seq: number;
  time: number;
  dir: Direction;
  port: string;
  hex: string;
  text: string;
}

export interface ClockSummary {
  /** total F8 seen */
  count: number;
  /** F8 per second over the last window */
  rate: number;
  /** time of the last F8 */
  last: number;
}

export class MidiMonitor {
  entries: MonitorEntry[] = [];
  clock: Record<Direction, ClockSummary> = {
    out: { count: 0, rate: 0, last: 0 },
    in: { count: 0, rate: 0, last: 0 },
  };
  sensing = 0;
  paused = false;
  /** show only these directions */
  filter: Record<Direction, boolean> = { in: true, out: true };
  private seq = 0;
  private window: Record<Direction, number[]> = { out: [], in: [] };
  /** bumped on every change so a UI can redraw cheaply */
  version = 0;

  constructor(public capacity = 300) {}

  record(bytes: number[], time: number, dir: Direction, port: string): void {
    const s = bytes[0];
    if (s === CLOCK) {
      const c = this.clock[dir];
      c.count++;
      c.last = time;
      const w = this.window[dir];
      w.push(time);
      while (w.length && time - w[0] > 1000) w.shift();
      c.rate = w.length;
      return;
    }
    if (s === ACTIVE_SENSING) {
      this.sensing++;
      return;
    }
    if (this.paused) return;
    this.entries.push({ seq: ++this.seq, time, dir, port, hex: hex(bytes), text: describe(bytes) });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    this.version++;
  }

  clear(): void {
    this.entries = [];
    this.clock.in = { count: 0, rate: 0, last: 0 };
    this.clock.out = { count: 0, rate: 0, last: 0 };
    this.window = { out: [], in: [] };
    this.version++;
  }

  visible(): MonitorEntry[] {
    return this.entries.filter((e) => this.filter[e.dir]);
  }
}
