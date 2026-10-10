/**
 * Clock sources.
 *
 * InternalClock: a lookahead scheduler. A timer wakes every `intervalMs` and schedules every
 * MIDI clock whose time falls within the next `lookaheadMs`, with an exact timestamp. Musical
 * time advances one clock per tick; the conversion to milliseconds happens only here.
 *
 * ExternalClock: follows incoming MIDI real-time messages. Each received F8 is one clock: the
 * sequencer advances exactly once per F8 and never on an estimate. The smoothed BPM is
 * informational only. Transport semantics:
 *
 *   FA  Start      fresh start from the beginning; the next F8 plays position 0
 *   FB  Continue   resume from the preserved position on the next F8
 *   FC  Stop       stop following; notes are ended; the position is preserved (so FB resumes)
 *   F8 while stopped   updates detection and the tempo estimate; never starts playback
 *   no F8 for the loss timeout   CLOCK LOST: notes ended, playback stops, position preserved;
 *                    when clock returns ANVIL waits for FA or FB (or the user's CONTINUE)
 */

export interface TimeSource {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const browserTime: TimeSource = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export const MIN_BPM = 20;
export const MAX_BPM = 400;

export function clockPeriodMs(bpm: number): number {
  return 60000 / (Math.max(MIN_BPM, Math.min(MAX_BPM, bpm)) * 24);
}

export interface SchedulingStats {
  ticks: number;
  /** smallest (time scheduled - now) seen, ms; negative = late */
  minMargin: number;
  /** ticks scheduled after their time */
  late: number;
  /** times the clock had to resynchronise after the timer stalled */
  resyncs: number;
}

export class InternalClock {
  bpm = 120;
  running = false;
  lookaheadMs = 100;
  intervalMs = 25;
  /** the first tick is scheduled this far after start(), so it is never late */
  startDelayMs = 30;
  /** if the timer stalls longer than this, skip ahead instead of bursting old ticks */
  maxBehindMs = 200;
  stats: SchedulingStats = { ticks: 0, minMargin: Infinity, late: 0, resyncs: 0 };
  private nextTime = 0;
  private timer: unknown = null;

  constructor(private time: TimeSource, private onTick: (time: number) => void) {}

  setTempo(bpm: number): void {
    this.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
  }

  start(at?: number): number {
    this.stop();
    this.running = true;
    this.nextTime = at ?? this.time.now() + this.startDelayMs;
    this.stats = { ticks: 0, minMargin: Infinity, late: 0, resyncs: 0 };
    this.pump();
    return this.nextTime;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.time.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Time the next tick will be scheduled for. */
  get next(): number {
    return this.nextTime;
  }

  private pump = (): void => {
    if (!this.running) return;
    const now = this.time.now();
    if (now - this.nextTime > this.maxBehindMs) {
      // the page was throttled or suspended: do not burst a backlog of clocks
      this.nextTime = now + 1;
      this.stats.resyncs++;
    }
    const horizon = now + this.lookaheadMs;
    while (this.running && this.nextTime <= horizon) {
      const margin = this.nextTime - now;
      this.stats.ticks++;
      if (margin < this.stats.minMargin) this.stats.minMargin = margin;
      if (margin < 0) this.stats.late++;
      const t = this.nextTime;
      this.nextTime += clockPeriodMs(this.bpm);
      this.onTick(t);
    }
    if (this.running) this.timer = this.time.setTimeout(this.pump, this.intervalMs);
  };
}

export type ExternalStatus = 'off' | 'waiting' | 'detected' | 'running' | 'stopped' | 'lost';

export interface ExternalClockHandlers {
  onStart(time: number): void;
  onContinue(time: number): void;
  onStop(time: number): void;
  onTick(time: number): void;
  onLost(time: number): void;
  onStatus(status: ExternalStatus): void;
}

export class ExternalClock {
  status: ExternalStatus = 'off';
  /** smoothed tempo estimate (informational only) */
  bpm = 0;
  /** F8 received since selection */
  clocks = 0;
  lastClock = -1;
  private avgInterval = 0;
  private watchdog: unknown = null;
  /** watchdog period */
  checkMs = 50;

  constructor(private time: TimeSource, private h: ExternalClockHandlers) {}

  /** Loss timeout: several clock periods, within sensible bounds. */
  get lossTimeoutMs(): number {
    if (!this.avgInterval) return 1000;
    return Math.max(300, Math.min(2000, this.avgInterval * 8));
  }

  /** Begin listening (input selected). */
  enable(): void {
    this.reset();
    this.set('waiting');
    this.arm();
  }

  disable(): void {
    this.reset();
    this.set('off');
  }

  private reset(): void {
    if (this.watchdog !== null) this.time.clearTimeout(this.watchdog);
    this.watchdog = null;
    this.bpm = 0;
    this.avgInterval = 0;
    this.clocks = 0;
    this.lastClock = -1;
  }

  private set(s: ExternalStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.h.onStatus(s);
    }
  }

  private arm(): void {
    if (this.watchdog !== null) this.time.clearTimeout(this.watchdog);
    this.watchdog = this.time.setTimeout(this.check, this.checkMs);
  }

  private check = (): void => {
    this.watchdog = null;
    if (this.status === 'off') return;
    const now = this.time.now();
    if (this.lastClock >= 0 && (this.status === 'detected' || this.status === 'running' || this.status === 'stopped') && now - this.lastClock > this.lossTimeoutMs) {
      this.set('lost');
      this.bpm = 0;
      this.avgInterval = 0;
      this.h.onLost(now);
    }
    this.arm();
  };

  /** The selected input port disappeared. */
  portLost(): void {
    if (this.status === 'off') return;
    this.set('lost');
    this.bpm = 0;
    this.avgInterval = 0;
    this.h.onLost(this.time.now());
  }

  /** Feed one received message (only the status byte matters for real-time messages). */
  receive(status: number, time: number): void {
    if (this.status === 'off') return;
    switch (status) {
      case 0xf8: {
        if (this.lastClock >= 0) {
          const dt = time - this.lastClock;
          if (dt > 0 && dt < 1000) {
            this.avgInterval = this.avgInterval ? this.avgInterval * 0.9 + dt * 0.1 : dt;
            this.bpm = 60000 / (24 * this.avgInterval);
          }
        }
        this.lastClock = time;
        this.clocks++;
        if (this.status === 'waiting' || this.status === 'lost') this.set('detected');
        this.h.onTick(time);
        break;
      }
      case 0xfa:
        this.set('running');
        this.h.onStart(time);
        break;
      case 0xfb:
        this.set('running');
        this.h.onContinue(time);
        break;
      case 0xfc:
        this.set('stopped');
        this.h.onStop(time);
        break;
    }
  }
}
