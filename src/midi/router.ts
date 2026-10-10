/**
 * Output routing with note tracking.
 *
 * Every note-on that leaves ANVIL is recorded with its port, channel and time; every note-off
 * clears it. allNotesOff() ends whatever is still sounding, never earlier than the note-on's
 * own (possibly future, scheduled) timestamp, so a lookahead-scheduled note cannot outlive a
 * STOP. PANIC also sends All Notes Off, All Sound Off and Sustain Off on all 16 channels.
 *
 * Listeners (the MIDI monitor and the audio preview) see exactly the stream that is sent.
 */
import { cc, noteOff, noteOn } from './messages';

export interface OutPort {
  id: string;
  name: string;
  send(data: number[], timestamp?: number): void;
  /** drop messages scheduled for the future, where the platform supports it */
  clear?(): void;
}

export type Direction = 'out' | 'in';
export type MidiListener = (bytes: number[], time: number, dir: Direction, port: string) => void;

interface Sounding {
  port: OutPort | null;
  ch: number;
  note: number;
  time: number;
}

export class OutputRouter {
  notePort: OutPort | null = null;
  /** null = clock goes to the note port */
  clockPort: OutPort | null = null;
  private listeners = new Set<MidiListener>();
  private sounding = new Map<string, Sounding>();
  /** count of send() failures (device gone mid-send) */
  errors = 0;

  constructor(private now: () => number) {}

  addListener(l: MidiListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(port: OutPort | null, data: number[], time: number): void {
    if (port) {
      try {
        port.send(data, time);
      } catch {
        this.errors++;
      }
    }
    for (const l of this.listeners) l(data, time, 'out', port?.id ?? '');
  }

  get soundingCount(): number {
    return this.sounding.size;
  }

  noteOn(ch: number, note: number, vel: number, time: number): void {
    const port = this.notePort;
    const key = `${port?.id ?? ''}|${ch}|${note}`;
    const prev = this.sounding.get(key);
    if (prev) this.emit(prev.port, noteOff(ch, note), Math.max(time, prev.time));
    this.sounding.set(key, { port, ch, note, time });
    this.emit(port, noteOn(ch, note, vel), time);
  }

  noteOff(ch: number, note: number, time: number): void {
    const key = `${this.notePort?.id ?? ''}|${ch}|${note}`;
    const s = this.sounding.get(key);
    if (s) {
      this.sounding.delete(key);
      this.emit(s.port, noteOff(ch, note), Math.max(time, s.time));
    } else {
      this.emit(this.notePort, noteOff(ch, note), time);
    }
  }

  /** Raw channel message to the note port (program changes etc.). */
  send(data: number[], time: number): void {
    this.emit(this.notePort, data, time);
  }

  /** A system real-time byte (F8, FA, FB, FC) to the clock port. */
  realtime(byte: number, time: number): void {
    this.emit(this.clockPort ?? this.notePort, [byte], time);
  }

  /** Cancel messages scheduled ahead (where supported). Tracked notes stay tracked. */
  clearScheduled(): void {
    for (const p of new Set([this.notePort, this.clockPort])) {
      try {
        p?.clear?.();
      } catch {
        /* not supported */
      }
    }
  }

  /** End every tracked note, at `time` but never before its own note-on. */
  allNotesOff(time = this.now()): number {
    let n = 0;
    for (const s of this.sounding.values()) {
      this.emit(s.port, noteOff(s.ch, s.note), Math.max(time, s.time + 1));
      n++;
    }
    this.sounding.clear();
    return n;
  }

  /** Tracked note-offs plus All Notes Off / All Sound Off / Sustain Off on every channel. */
  panic(time = this.now()): void {
    const ports = new Set<OutPort>();
    for (const s of this.sounding.values()) if (s.port) ports.add(s.port);
    this.allNotesOff(time);
    if (this.notePort) ports.add(this.notePort);
    const t = time + 2;
    if (!ports.size) {
      for (let ch = 1; ch <= 16; ch++) for (const m of [cc(ch, 64, 0), cc(ch, 120, 0), cc(ch, 123, 0)]) this.emit(null, m, t);
      return;
    }
    for (const port of ports) for (let ch = 1; ch <= 16; ch++) for (const m of [cc(ch, 64, 0), cc(ch, 120, 0), cc(ch, 123, 0)]) this.emit(port, m, t);
  }

  /** Change the note output; notes sounding on the old port are ended first. */
  setNotePort(port: OutPort | null, time = this.now()): void {
    if (port?.id === this.notePort?.id && port === this.notePort) return;
    this.allNotesOff(time);
    this.notePort = port;
  }

  setClockPort(port: OutPort | null): void {
    this.clockPort = port;
  }

  /** A port disappeared: forget its notes (nothing can be sent to it any more). */
  portLost(id: string): void {
    for (const [k, s] of this.sounding) if (s.port?.id === id) this.sounding.delete(k);
    if (this.notePort?.id === id) this.notePort = null;
    if (this.clockPort?.id === id) this.clockPort = null;
  }

  /** Input traffic, so the monitor can show it. */
  noteInput(bytes: number[], time: number, port: string): void {
    for (const l of this.listeners) l(bytes, time, 'in', port);
  }
}
