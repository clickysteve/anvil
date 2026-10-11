/**
 * The common musical event representation.
 *
 * Time is counted in integer **ticks** at a resolution chosen by the application (`ppq`,
 * pulses per quarter note: ANVIL uses 24, DOWNBEAT 96). Integers are exact, so positions never
 * drift however long a piece runs. A **tempo map** turns ticks into seconds and sample frames:
 * each event's time is computed directly from its own tick and the tempo segment it falls in,
 * never by adding up durations, so there is no cumulative floating-point error.
 *
 * Events name a **voice** by string id (the application decides what a voice is: a theme
 * voice, a drum lane, a stream). Notes carry their duration, so a renderer never has to pair
 * note-ons with note-offs. An optional `instrument` key lets an application route a single
 * note to a different sound than its voice's default (for example a drum-table entry).
 *
 * Nothing here knows about any particular application.
 */

export type Tick = number;

export interface TempoChange {
  /** where this tempo starts (the first change must be at tick 0) */
  tick: Tick;
  /** quarter notes per minute */
  bpm: number;
}

export interface TempoMap {
  /** ticks per quarter note */
  ppq: number;
  /** sorted by tick, first at 0 */
  changes: TempoChange[];
}

export interface NoteEvent {
  type: 'note';
  tick: Tick;
  /** in ticks, >= 1 */
  duration: Tick;
  voice: string;
  /** MIDI note number 0..127 */
  pitch: number;
  /** 1..127 */
  velocity: number;
  /** MIDI channel 1..16, for applications that also send MIDI */
  channel?: number;
  /** application-defined instrument or sample assignment key overriding the voice's default */
  instrument?: string;
}

export interface ControlEvent {
  type: 'control';
  tick: Tick;
  voice: string;
  /** MIDI controller number 0..127 */
  controller: number;
  /** 0..127 */
  value: number;
  channel?: number;
}

export type MusicEvent = NoteEvent | ControlEvent;

export interface VoiceInfo {
  id: string;
  /** shown in interfaces and used for stem file names */
  name: string;
}

export interface Timeline {
  tempo: TempoMap;
  /** end of the musical material in ticks (exports add their tail after this) */
  length: Tick;
  voices: VoiceInfo[];
  /** sorted with sortEvents() */
  events: MusicEvent[];
  /** free-form provenance (seed, source item...) for reproducibility notes */
  meta?: Record<string, string | number | boolean>;
}

export function constantTempo(bpm: number, ppq: number): TempoMap {
  return { ppq, changes: [{ tick: 0, bpm }] };
}

/** Validate and normalise a tempo map (sorted, starting at 0, positive tempos). */
export function normaliseTempo(map: TempoMap): TempoMap {
  if (!(map.ppq > 0) || !Number.isFinite(map.ppq)) throw new RangeError('ppq must be a positive number');
  const changes = map.changes
    .filter((c) => Number.isFinite(c.tick) && Number.isFinite(c.bpm) && c.bpm > 0)
    .map((c) => ({ tick: Math.max(0, Math.round(c.tick)), bpm: c.bpm }))
    .sort((a, b) => a.tick - b.tick);
  if (!changes.length) throw new RangeError('a tempo map needs at least one tempo');
  if (changes[0].tick !== 0) changes.unshift({ tick: 0, bpm: changes[0].bpm });
  // a later change at the same tick wins
  const out: TempoChange[] = [];
  for (const c of changes) {
    if (out.length && out[out.length - 1].tick === c.tick) out[out.length - 1] = c;
    else out.push(c);
  }
  return { ppq: map.ppq, changes: out };
}

/**
 * Converts ticks to seconds and frames for one tempo map. Segment start times are computed
 * once from exact tick differences; each conversion is then a single multiply-add.
 */
export class TimeMap {
  readonly tempo: TempoMap;
  private starts: number[];

  constructor(tempo: TempoMap) {
    this.tempo = normaliseTempo(tempo);
    const ch = this.tempo.changes;
    this.starts = [0];
    for (let i = 1; i < ch.length; i++) this.starts.push(this.starts[i - 1] + (ch[i].tick - ch[i - 1].tick) * this.secondsPerTick(i - 1));
  }

  private secondsPerTick(i: number): number {
    return 60 / (this.tempo.changes[i].bpm * this.tempo.ppq);
  }

  private segment(tick: number): number {
    const ch = this.tempo.changes;
    let lo = 0;
    let hi = ch.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ch[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  seconds(tick: Tick): number {
    const i = this.segment(tick);
    return this.starts[i] + (tick - this.tempo.changes[i].tick) * this.secondsPerTick(i);
  }

  /** Sample frame of a tick (rounded to the nearest frame). */
  frame(tick: Tick, sampleRate: number): number {
    return Math.round(this.seconds(tick) * sampleRate);
  }

  /** The tick at a time (fractional). */
  tick(seconds: number): number {
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i] > seconds) i--;
    return this.tempo.changes[i].tick + (seconds - this.starts[i]) / this.secondsPerTick(i);
  }

  bpmAt(tick: Tick): number {
    return this.tempo.changes[this.segment(tick)].bpm;
  }
}

const TYPE_ORDER = { control: 0, note: 1 } as const;

/**
 * Canonical order: by tick, then controls before notes at the same tick, then by voice id,
 * then pitch. Stable, so events that compare equal keep their input order.
 */
export function sortEvents<T extends MusicEvent>(events: T[]): T[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || TYPE_ORDER[a.e.type] - TYPE_ORDER[b.e.type] || (a.e.voice < b.e.voice ? -1 : a.e.voice > b.e.voice ? 1 : 0) || ('pitch' in a.e && 'pitch' in b.e ? a.e.pitch - b.e.pitch : 0) || a.i - b.i)
    .map((x) => x.e);
}

export interface TimelineProblem {
  index: number;
  message: string;
}

/** Problems that would make a timeline unrenderable (empty list = fine). */
export function validateTimeline(t: Timeline): TimelineProblem[] {
  const out: TimelineProblem[] = [];
  const voices = new Set(t.voices.map((v) => v.id));
  if (voices.size !== t.voices.length) out.push({ index: -1, message: 'voice ids must be unique' });
  try {
    normaliseTempo(t.tempo);
  } catch (e) {
    out.push({ index: -1, message: (e as Error).message });
  }
  if (!Number.isInteger(t.length) || t.length < 0) out.push({ index: -1, message: 'length must be a whole number of ticks' });
  t.events.forEach((e, i) => {
    if (!Number.isInteger(e.tick) || e.tick < 0) out.push({ index: i, message: 'tick must be a whole number >= 0' });
    if (!voices.has(e.voice)) out.push({ index: i, message: `unknown voice "${e.voice}"` });
    if (i > 0 && e.tick < t.events[i - 1].tick) out.push({ index: i, message: 'events are not sorted' });
    if (e.type === 'note') {
      if (!Number.isInteger(e.duration) || e.duration < 1) out.push({ index: i, message: 'duration must be a whole number >= 1' });
      if (!(e.pitch >= 0 && e.pitch <= 127)) out.push({ index: i, message: 'pitch out of range' });
      if (!(e.velocity >= 1 && e.velocity <= 127)) out.push({ index: i, message: 'velocity out of range' });
    } else if (!(e.value >= 0 && e.value <= 127) || !(e.controller >= 0 && e.controller <= 127)) out.push({ index: i, message: 'controller or value out of range' });
  });
  return out;
}

/** The last tick anything sounds until (note ends included). */
export function lastTick(t: Timeline): Tick {
  let end = t.length;
  for (const e of t.events) end = Math.max(end, e.type === 'note' ? e.tick + e.duration : e.tick);
  return end;
}

/** Events of selected voices only (for rendering one stem). */
export function eventsForVoices(t: Timeline, voices: Set<string>): MusicEvent[] {
  return t.events.filter((e) => voices.has(e.voice));
}

/**
 * Turns a MIDI-style stream of note-ons and note-offs into notes with durations, with MIDI
 * pairing semantics: a note-off ends the most recent note-on with the same pairing key
 * (normally channel and pitch), and a note-on for a key that is still sounding first ends
 * the sounding note. Notes still open when `close(tick)` is called end there.
 */
export class NotePairer {
  private open = new Map<string, NoteEvent>();
  readonly notes: NoteEvent[] = [];

  on(key: string, note: Omit<NoteEvent, 'type' | 'duration'>): void {
    this.off(key, note.tick);
    const n: NoteEvent = { type: 'note', duration: 1, ...note };
    this.open.set(key, n);
    this.notes.push(n);
  }

  off(key: string, tick: Tick): void {
    const n = this.open.get(key);
    if (!n) return;
    this.open.delete(key);
    n.duration = Math.max(1, tick - n.tick);
  }

  close(tick: Tick): NoteEvent[] {
    for (const key of [...this.open.keys()]) this.off(key, tick);
    return this.notes;
  }
}
