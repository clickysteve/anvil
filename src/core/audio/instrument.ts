/**
 * The instrument interface every sound source implements (the sampler, an application's own
 * synthesiser). An instrument starts one note at a time into a destination node of any
 * BaseAudioContext, so the same instrument code plays live and renders offline.
 */

export interface NoteRequest {
  /** context time in seconds */
  time: number;
  /** MIDI note number */
  pitch: number;
  /** 1..127 */
  velocity: number;
  /** MIDI channel, for instruments whose sound depends on it */
  channel?: number;
}

export interface NoteHandle {
  /** Begin the note's release at `time` (note-off). One-shot notes ignore it. */
  release(time: number): void;
  /** Stop quickly at `time` (panic, voice stealing). */
  stop(time: number): void;
  /** Context time by which the note is certainly silent (Infinity while held with no end). */
  readonly end: number;
}

export interface Instrument {
  /** Start a note; null when the instrument has nothing to play (muted, no audio). */
  start(ctx: BaseAudioContext, out: AudioNode, note: NoteRequest): NoteHandle | null;
}

/** Ramp a gain to zero from whatever it is doing at `time`. */
export function fadeOut(param: AudioParam, time: number, seconds: number, holdValue: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(time);
  else {
    param.cancelScheduledValues(time);
    param.setValueAtTime(holdValue, time);
  }
  param.linearRampToValueAtTime(0, time + Math.max(0.001, seconds));
}
