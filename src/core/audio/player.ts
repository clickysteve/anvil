/**
 * The note player: starts and releases notes on voices, live or offline, with one set of
 * rules.
 *
 * - The application resolves which instrument plays a note (`resolve`), so Core never knows
 *   what a voice means.
 * - Notes are addressed by a key. A note-on for a key that is still held first releases it
 *   (MIDI retrigger semantics when the key is "channel:pitch"); a note-off releases the key.
 *   Offline rendering gives every note its own key.
 * - Each voice keeps at most `maxPerVoice` sounding notes; the oldest is stopped to make room.
 */
import type { Instrument, NoteHandle, NoteRequest } from './instrument';
import type { Mixer } from './mixer';

export interface NoteStart extends NoteRequest {
  /** the application's instrument assignment key, if the note has one */
  instrument?: string;
}

export type ResolveInstrument = (voice: string, note: NoteStart) => Instrument | null;

interface Active {
  handle: NoteHandle;
  start: number;
}

export class NotePlayer {
  private held = new Map<string, NoteHandle>();
  private sounding = new Map<string, Active[]>();
  maxPerVoice: number;

  constructor(readonly ctx: BaseAudioContext, readonly mixer: Mixer, private resolve: ResolveInstrument, opts: { maxPerVoice?: number } = {}) {
    this.maxPerVoice = opts.maxPerVoice ?? 32;
  }

  noteOn(key: string, voice: string, note: NoteStart): boolean {
    this.noteOff(key, note.time);
    const inst = this.resolve(voice, note);
    if (!inst) return false;
    const list = (this.sounding.get(voice) ?? []).filter((a) => a.handle.end > note.time);
    while (list.length >= this.maxPerVoice) list.shift()!.handle.stop(note.time);
    const handle = inst.start(this.ctx, this.mixer.input(voice), note);
    if (!handle) {
      this.sounding.set(voice, list);
      return false;
    }
    list.push({ handle, start: note.time });
    this.sounding.set(voice, list);
    this.held.set(key, handle);
    return true;
  }

  noteOff(key: string, time: number): void {
    const h = this.held.get(key);
    if (!h) return;
    this.held.delete(key);
    h.release(time);
  }

  /** Release every held note (one-shots ring on). */
  releaseAll(time: number): void {
    for (const h of this.held.values()) h.release(time);
    this.held.clear();
  }

  /** Stop everything quickly, one-shots included (panic). */
  stopAll(time: number): void {
    for (const list of this.sounding.values()) for (const a of list) a.handle.stop(time);
    this.sounding.clear();
    this.held.clear();
  }

  /** Notes still sounding at `time`, per voice. */
  activeCount(voice: string, time: number): number {
    return (this.sounding.get(voice) ?? []).filter((a) => a.handle.end > time).length;
  }
}
