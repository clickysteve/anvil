/**
 * Transport: START, PAUSE, CONTINUE, STOP/RESET, play once and stop at end, under either
 * clock source.
 *
 * Internal clock
 *   START       position 0; sends FA (when Clock Out is on), then F8 and the music together
 *   PAUSE       ends sounding notes; sends FC; the position is kept
 *   CONTINUE    resumes from the kept position; sends FB, then F8
 *   STOP/RESET  ends sounding notes; sends FC if running; position back to 0
 *   No F8 is sent while stopped or paused (as observed in the original program).
 *
 * External clock (see clocks.ts for the incoming FA/FB/FC/F8 model)
 *   START       arms a fresh start: the next F8 plays position 0 (for joining a running master)
 *   CONTINUE    arms a resume from the kept position on the next F8
 *   PAUSE       stops following locally (notes ended, position kept)
 *   STOP/RESET  stops following and returns to position 0
 *   Clock Out is never sent while following an external clock (no clock thru in this release).
 */
import { programChanges, type Sequencer, type SeqEvent } from '../engine/sequencer';
import type { Project } from '../engine/types';
import { CLOCK, CONTINUE, START, STOP } from '../midi/messages';
import type { OutputRouter } from '../midi/router';
import { ExternalClock, InternalClock, type ExternalStatus, type TimeSource } from './clocks';

export type TransportState = 'stopped' | 'running' | 'paused' | 'armed';
export type ClockSource = 'internal' | 'external';

export interface TransportListener {
  onState?(s: TransportState): void;
  onTick?(): void;
  onClockStatus?(s: ExternalStatus): void;
}

export class Transport {
  state: TransportState = 'stopped';
  source: ClockSource = 'internal';
  clockOut = false;
  /** what an armed external transport does on the next F8 */
  private armed: 'start' | 'continue' | null = null;
  readonly internal: InternalClock;
  readonly external: ExternalClock;
  listener: TransportListener = {};
  /** clock ticks processed since START (for display) */
  ticks = 0;
  /** times of recently scheduled internal clocks (to undo lookahead on PAUSE) */
  private scheduled: number[] = [];

  constructor(
    readonly seq: Sequencer,
    readonly router: OutputRouter,
    private time: TimeSource,
    private getProject: () => Project,
  ) {
    this.internal = new InternalClock(time, (t) => this.onInternalTick(t));
    this.external = new ExternalClock(time, {
      onStart: (t) => this.extStart(t),
      onContinue: (t) => this.extContinue(t),
      onStop: (t) => this.extStop(t),
      onTick: (t) => this.extTick(t),
      onLost: (t) => this.extLost(t),
      onStatus: (s) => this.listener.onClockStatus?.(s),
    });
  }

  private setState(s: TransportState): void {
    if (this.state !== s) {
      this.state = s;
      this.listener.onState?.(s);
    }
  }

  get clockOutActive(): boolean {
    return this.clockOut && this.source === 'internal';
  }

  // ------------------------------------------------------------------ user controls

  start(): void {
    const now = this.time.now();
    this.silenceAt(now);
    if (this.source === 'external') {
      this.internal.stop();
      this.armed = 'start';
      this.seq.reset();
      this.ticks = 0;
      this.setState('armed');
      return;
    }
    this.internal.stop();
    this.seq.reset();
    this.ticks = 0;
    const t0 = now + this.internal.startDelayMs;
    if (this.clockOutActive) this.router.realtime(START, t0 - 1);
    this.sendPrograms(t0 - 1);
    this.setState('running');
    this.internal.start(t0);
  }

  pause(): void {
    if (this.state !== 'running' && this.state !== 'armed') return;
    const now = this.time.now();
    this.internal.stop();
    this.armed = null;
    if (this.source === 'internal' && this.state === 'running') {
      // Clocks already scheduled ahead of `now` (lookahead) have not been heard yet: drop
      // what the output can still cancel and move the position back, so CONTINUE resumes
      // exactly where the music stopped and in step with a clock-following slave.
      const ahead = this.scheduled.filter((t) => t > now).length;
      this.router.clearScheduled();
      if (ahead) this.seq.rewind(ahead);
      this.ticks = Math.max(0, this.ticks - ahead);
      if (this.clockOutActive) this.router.realtime(STOP, now);
    }
    this.scheduled = [];
    this.silenceAt(now);
    this.setState('paused');
  }

  cont(): void {
    if (this.state === 'running') return;
    const now = this.time.now();
    if (this.source === 'external') {
      this.armed = 'continue';
      this.setState('armed');
      return;
    }
    if (this.state === 'stopped') return this.start();
    const t0 = now + this.internal.startDelayMs;
    if (this.clockOutActive) this.router.realtime(CONTINUE, t0 - 1);
    this.seq.invalidate();
    this.setState('running');
    this.internal.start(t0);
  }

  stop(): void {
    const now = this.time.now();
    const wasRunning = this.state === 'running';
    this.internal.stop();
    if (wasRunning && this.source === 'internal') this.router.clearScheduled();
    this.scheduled = [];
    this.armed = null;
    if (wasRunning && this.clockOutActive) this.router.realtime(STOP, now);
    this.silenceAt(now);
    this.seq.reset();
    this.ticks = 0;
    this.setState('stopped');
  }

  /** Start and stop again at the end of the theme. */
  playOnce(): void {
    this.start();
    this.seq.stopAtEnd = true;
  }

  /** Stop at the end of the current theme (when running). */
  stopAtEnd(): void {
    if (this.state === 'running' || this.state === 'armed') this.seq.stopAtEnd = true;
  }

  /** PANIC: stop everything sounding, everywhere. Transport state is unchanged otherwise. */
  panic(): void {
    const now = this.time.now();
    this.seq.silence();
    this.router.panic(now);
  }

  setSource(src: ClockSource): void {
    if (src === this.source) return;
    this.stop();
    this.source = src;
    if (src === 'external') this.external.enable();
    else this.external.disable();
  }

  setTempo(bpm: number): void {
    this.internal.setTempo(bpm);
  }

  // ------------------------------------------------------------------ clock ticks

  private onInternalTick(time: number): void {
    if (this.state !== 'running') return;
    this.scheduled.push(time);
    if (this.scheduled.length > 64) this.scheduled.shift();
    if (this.clockOutActive) this.router.realtime(CLOCK, time);
    this.process(time);
  }

  private process(time: number): void {
    const r = this.seq.tick1();
    this.ticks++;
    this.dispatch(r.events, time);
    if (r.ended) {
      this.internal.stop();
      if (this.clockOutActive) this.router.realtime(STOP, time);
      this.silenceAt(time);
      this.seq.reset();
      this.ticks = 0;
      this.armed = null;
      this.setState('stopped');
    }
    this.listener.onTick?.();
  }

  private dispatch(events: SeqEvent[], time: number): void {
    for (const e of events) {
      if (e.kind === 'off') this.router.noteOff(e.ch, e.note, time);
      else this.router.noteOn(e.ch, e.note, e.vel, time);
    }
  }

  private silenceAt(time: number): void {
    this.dispatch(this.seq.silence(), time);
    this.router.allNotesOff(time);
  }

  private sendPrograms(time: number): void {
    const p = this.getProject();
    if (!p.options.sendProgramsAtStart) return;
    for (const m of programChanges(p.voices)) this.router.send(m, time);
  }

  // ------------------------------------------------------------------ external clock

  private extStart(time: number): void {
    if (this.source !== 'external') return;
    this.silenceAt(time);
    this.seq.reset();
    this.ticks = 0;
    this.armed = null;
    this.sendPrograms(time);
    this.setState('running');
  }

  private extContinue(time: number): void {
    if (this.source !== 'external') return;
    if (this.state === 'stopped' && this.ticks === 0) this.seq.reset();
    this.armed = null;
    this.seq.invalidate();
    this.silenceAt(time);
    this.setState('running');
  }

  private extStop(time: number): void {
    if (this.source !== 'external') return;
    this.armed = null;
    this.silenceAt(time);
    if (this.state === 'running' || this.state === 'armed') this.setState('paused');
  }

  private extTick(time: number): void {
    if (this.source !== 'external') return;
    if (this.state === 'armed') {
      if (this.armed === 'start') {
        this.seq.reset();
        this.ticks = 0;
        this.sendPrograms(time);
      } else this.seq.invalidate();
      this.armed = null;
      this.setState('running');
    }
    if (this.state !== 'running') return;
    this.process(time);
  }

  private extLost(time: number): void {
    if (this.source !== 'external') return;
    this.armed = null;
    this.silenceAt(time);
    if (this.state === 'running' || this.state === 'armed') this.setState('paused');
  }
}
