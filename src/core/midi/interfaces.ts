/**
 * Shared MIDI foundation: INTERFACES ONLY (Tier 2 design). Nothing in Core implements these
 * yet; they record the contract the existing applications' MIDI code is to converge on.
 * See docs/MIDI-FOUNDATION.md for the audit they come from and the migration roadmap.
 */

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer?: string;
  connected: boolean;
}

/** A timestamped MIDI output (Web MIDI port, test double, or a router in front of one). */
export interface MidiOutputPort {
  readonly id: string;
  readonly name: string;
  /** timestamp: performance.now() milliseconds; omitted = now */
  send(bytes: number[], timestamp?: number): void;
  /** drop queued future messages, where the platform supports it */
  clear?(): void;
}

export interface MidiInputPort {
  readonly id: string;
  readonly name: string;
  listen(handler: (bytes: Uint8Array, timestamp: number) => void): () => void;
}

/** Where musical time comes from. Ticks are 24 per quarter note (MIDI clock). */
export interface ClockSource {
  readonly kind: 'internal' | 'external';
  /** called once per clock tick with its performance.now() time */
  onTick(fn: (time: number) => void): () => void;
  start(at?: number): void;
  stop(): void;
}

/** Follows incoming MIDI clock (F8) and transport (FA/FB/FC, F2 Song Position). */
export interface ClockFollower {
  status: 'off' | 'waiting' | 'detected' | 'running' | 'stopped' | 'lost';
  /** smoothed estimate, informational */
  bpm: number;
  receive(status: number, time: number, data?: number[]): void;
}

/** A parameter an application lets MIDI Learn (and later automation) control. */
export interface LearnableParameter {
  /** stable id, stored in mappings */
  id: string;
  label: string;
  group?: string;
  min: number;
  max: number;
  /** step for discrete parameters (1 = integers) */
  step?: number;
  get(): number;
  set(value: number): void;
}

export interface LearnMapping {
  parameter: string;
  source: { type: 'cc' | 'note'; channel: number | null; number: number };
  min: number;
  max: number;
  invert: boolean;
  /** relative encoders: two's complement, binary offset or sign-magnitude */
  mode: 'absolute' | 'relative-2c' | 'relative-offset' | 'relative-sign';
}

export interface ParameterRegistry {
  register(p: LearnableParameter): () => void;
  list(): LearnableParameter[];
  get(id: string): LearnableParameter | undefined;
}
