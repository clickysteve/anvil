/**
 * The sequencer turns the project into note events one MIDI clock at a time.
 *
 * It knows nothing about real time: a clock source (internal or external) calls tick() once
 * per MIDI clock and turns the returned events into MIDI at the right moment. That keeps the
 * musical model identical under internal and external clock, and makes playback testable.
 *
 * Playback model (DOC unless marked):
 *  - One item (theme or variation) plays at a time and loops. Selecting another item queues it;
 *    it starts at the next Theme Alignment boundary (microbeat, pulse or end of theme).
 *  - Tonality and accompaniment-preset changes apply at their own alignment boundary, or
 *    immediately ("off").
 *  - Voice edits apply from the next clock (INF: the rest of the pass is re-rendered).
 *  - The arranger steps through its list, each step lasting its own number of clocks.
 *  - Note-offs are always paired: every note-on emitted schedules its own note-off, and a
 *    retriggered note first ends the sounding one.
 */
import { renderPass, emptyVoiceStates, type NoteOut, type VoiceState } from './render';
import { deriveSeed } from './rng';
import { scaleEntries } from './tonality';
import type { Align, ArrangerStep, ItemId, Project, Theme, Tonality, Voice } from './types';

export interface SeqEvent {
  kind: 'on' | 'off';
  ch: number;
  note: number;
  vel: number;
  /** voice index 0..5, or -1 for note-offs that end everything (silence) */
  voice: number;
  /** drum-table index 0..6 for drum-harmony notes, -1 otherwise (informational; MIDI ignores it) */
  drum: number;
}

export interface TickResult {
  events: SeqEvent[];
  /** true when play-once / stop-at-end has reached the end of the theme */
  ended: boolean;
}

interface Pending {
  tick: number;
  kind: 'on' | 'off';
  ch: number;
  note: number;
  vel: number;
  voice: number;
  drum: number;
  pass: number;
  dur: number;
  /** identifies the note instance (for pairing offs with ons) */
  id: number;
}

interface Queued<T> {
  value: T;
  align: Align;
}

/** Called when the sequencer applies a change, so the app can update its display. */
export interface SequencerListener {
  onItem?(id: ItemId | null): void;
  onTonality?(t: Tonality): void;
  onPreset?(index: number): void;
  onArrangerStep?(index: number): void;
}

export const SILENT_PASS_CLOCKS = 96;

export class Sequencer {
  /** absolute position in clocks since START */
  tick = 0;
  pass = -1;
  passStart = 0;
  passClocks = SILENT_PASS_CLOCKS;
  item: ItemId | null = null;
  theme: Theme | null = null;
  activeTonality: Tonality;
  /** play to the end of the current theme, then report ended */
  stopAtEnd = false;
  arrangerPlaying = false;
  arrangerIndex = 0;
  arrangerStepStart = 0;
  listener: SequencerListener = {};

  private pending: Pending[] = [];
  private sounding = new Map<string, number>();
  private nextId = 1;
  private stateIn: VoiceState[] = emptyVoiceStates();
  private stateOut: VoiceState[] = emptyVoiceStates();
  private queuedItem: Queued<ItemId> | null = null;
  private queuedTonality: Queued<Tonality> | null = null;
  private queuedPreset: Queued<number> | null = null;
  private dirty = false;
  /** the seed of this performance: pass seeds derive from it */
  performanceSeed = 0;

  constructor(private getProject: () => Project, private applyPresetToProject: (index: number) => void = () => {}) {
    this.activeTonality = { ...getProject().tonality };
  }

  /** Back to the beginning (STOP/RESET or START). Pending notes are dropped; call silence() first. */
  reset(): void {
    const p = this.getProject();
    this.tick = 0;
    this.pass = -1;
    this.passStart = 0;
    this.passClocks = SILENT_PASS_CLOCKS;
    this.pending = [];
    this.sounding.clear();
    this.stateIn = emptyVoiceStates();
    this.stateOut = emptyVoiceStates();
    this.queuedItem = null;
    this.queuedTonality = null;
    this.queuedPreset = null;
    this.activeTonality = { ...p.tonality };
    this.item = p.selected;
    this.theme = null;
    this.dirty = false;
    this.stopAtEnd = false;
    this.arrangerIndex = 0;
    this.arrangerStepStart = 0;
    this.performanceSeed = deriveSeed(p.seed, 'performance');
  }

  /** Note-offs for everything sounding; forgets pending events. Position is kept (PAUSE). */
  silence(): SeqEvent[] {
    const out: SeqEvent[] = [];
    for (const key of this.sounding.keys()) {
      const [ch, note] = key.split(':').map(Number);
      out.push({ kind: 'off', ch, note, vel: 0, voice: -1, drum: -1 });
    }
    this.sounding.clear();
    // keep pending note-ons of the current pass that are still in the future; they will be
    // re-rendered on CONTINUE anyway, so drop everything and mark dirty.
    this.pending = [];
    this.dirty = true;
    return out;
  }

  get soundingCount(): number {
    return this.sounding.size;
  }

  /** Clocks left in the current pass. */
  get left(): number {
    return Math.max(0, this.passStart + this.passClocks - this.tick);
  }

  get offset(): number {
    return this.tick - this.passStart;
  }

  queueItem(id: ItemId, immediate = false): void {
    this.queuedItem = { value: id, align: immediate ? 'off' : this.getProject().options.themeAlign };
  }

  get queued(): ItemId | null {
    return this.queuedItem?.value ?? null;
  }

  queueTonality(t: Tonality, immediate = false): void {
    this.queuedTonality = { value: { ...t }, align: immediate ? 'off' : this.getProject().options.tonalityAlign };
  }

  queuePreset(index: number, immediate = false): void {
    this.queuedPreset = { value: index, align: immediate ? 'off' : this.getProject().options.presetAlign };
  }

  /** Voice parameters or the playing theme's tonality changed: re-render from the next clock. */
  invalidate(): void {
    this.dirty = true;
  }

  startArranger(): void {
    this.arrangerPlaying = true;
    this.arrangerIndex = 0;
    this.arrangerStepStart = this.tick;
    this.applyArrangerStep(0);
  }

  stopArranger(): void {
    this.arrangerPlaying = false;
  }

  // ------------------------------------------------------------------ the clock

  tick1(): TickResult {
    const p = this.getProject();
    const events: SeqEvent[] = [];
    const T = this.tick;

    // arranger: move to the next step when this one's time is up
    if (this.arrangerPlaying) this.advanceArranger(T);

    // end of pass (or first tick)
    let newPass = this.pass < 0 || T >= this.passStart + this.passClocks;
    if (newPass && this.pass >= 0 && this.stopAtEnd) {
      this.stopAtEnd = false;
      return { events: this.drainOffsAt(T, events), ended: true };
    }
    // aligned changes inside a pass
    const off = T - this.passStart;
    const mb = this.theme?.microbeat ?? 6;
    const pulseClocks = mb * (this.theme?.pulse ?? 1);
    const at = (a: Align) => a === 'off' || newPass || (a === 'mbeat' && off % mb === 0) || (a === 'pulse' && off % pulseClocks === 0);

    if (this.queuedItem && (newPass || (this.queuedItem.align !== 'theme' && at(this.queuedItem.align)))) {
      this.item = this.queuedItem.value;
      this.queuedItem = null;
      newPass = true;
      this.listener.onItem?.(this.item);
    }
    if (this.queuedTonality && at(this.queuedTonality.align)) {
      this.activeTonality = this.queuedTonality.value;
      this.queuedTonality = null;
      this.dirty = true;
      this.listener.onTonality?.(this.activeTonality);
    }
    if (this.queuedPreset && at(this.queuedPreset.align)) {
      this.applyPresetToProject(this.queuedPreset.value);
      this.listener.onPreset?.(this.queuedPreset.value);
      this.queuedPreset = null;
      this.dirty = true;
    }

    if (newPass) this.beginPass(p, T);
    else if (this.dirty) this.rerender(p, T);
    this.dirty = false;

    this.drainOffsAt(T, events);
    this.drainOnsAt(T, events);
    this.tick = T + 1;
    return { events, ended: false };
  }

  private drainOffsAt(T: number, events: SeqEvent[]): SeqEvent[] {
    const keep: Pending[] = [];
    for (const e of this.pending) {
      if (e.kind === 'off' && e.tick <= T) {
        const key = `${e.ch}:${e.note}`;
        if (this.sounding.get(key) === e.id) {
          this.sounding.delete(key);
          events.push({ kind: 'off', ch: e.ch, note: e.note, vel: 0, voice: e.voice, drum: e.drum });
        }
      } else keep.push(e);
    }
    this.pending = keep;
    return events;
  }

  private drainOnsAt(T: number, events: SeqEvent[]): void {
    const due = this.pending.filter((e) => e.kind === 'on' && e.tick <= T);
    if (!due.length) return;
    this.pending = this.pending.filter((e) => !(e.kind === 'on' && e.tick <= T));
    for (const e of due) {
      const key = `${e.ch}:${e.note}`;
      if (this.sounding.has(key)) events.push({ kind: 'off', ch: e.ch, note: e.note, vel: 0, voice: e.voice, drum: e.drum });
      this.sounding.set(key, e.id);
      events.push({ kind: 'on', ch: e.ch, note: e.note, vel: e.vel, voice: e.voice, drum: e.drum });
      this.pending.push({ ...e, kind: 'off', tick: T + e.dur });
    }
  }

  private render(p: Project, theme: Theme): NoteOut[] {
    const r = renderPass({
      theme,
      voices: p.voices,
      tonality: this.activeTonality,
      entries: scaleEntries(this.activeTonality.scale, p.userScales),
      weights: p.weights,
      drums: p.drums,
      feel: p.options.feel,
      passSeed: deriveSeed(this.performanceSeed, this.pass),
      state: this.stateIn,
    });
    this.stateOut = r.state;
    return r.notes;
  }

  private beginPass(p: Project, T: number): void {
    // drop not-yet-played note-ons of the previous pass only if it was cut short
    this.pending = this.pending.filter((e) => e.kind === 'off' || e.tick < T || e.pass === this.pass && e.tick >= this.passStart + this.passClocks);
    this.pass++;
    this.passStart = T;
    this.stateIn = this.stateOut.map((s) => ({ ...s }));
    const theme = this.item ? p.bank[this.item] ?? null : null;
    this.theme = theme;
    if (!theme || !theme.length) {
      this.passClocks = SILENT_PASS_CLOCKS;
      return;
    }
    this.passClocks = theme.length * theme.microbeat;
    for (const n of this.render(p, theme)) this.addOn(n, T, this.pass);
  }

  private rerender(p: Project, T: number): void {
    if (!this.theme) return;
    const cur = this.pass;
    this.pending = this.pending.filter((e) => !(e.kind === 'on' && e.pass === cur && e.tick >= T));
    const off = T - this.passStart;
    for (const n of this.render(p, this.theme)) if (n.tick >= off) this.addOn(n, this.passStart, cur);
  }

  private addOn(n: NoteOut, base: number, pass: number): void {
    this.pending.push({ tick: base + n.tick, kind: 'on', ch: n.ch, note: n.note, vel: n.vel, voice: n.voice, drum: n.drum, pass, dur: n.dur, id: this.nextId++ });
  }

  // ------------------------------------------------------------------ arranger

  private advanceArranger(T: number): void {
    const steps = this.getProject().arranger.steps;
    if (!steps.length) {
      this.arrangerPlaying = false;
      return;
    }
    const step = steps[this.arrangerIndex];
    if (!step || T - this.arrangerStepStart < Math.max(1, step.clocks)) return;
    let next = this.arrangerIndex + 1;
    if (next >= steps.length) {
      if (!this.getProject().options.arrangerLoop) {
        this.arrangerPlaying = false;
        this.listener.onArrangerStep?.(-1);
        return;
      }
      next = 0;
    }
    this.arrangerIndex = next;
    this.arrangerStepStart = T;
    this.applyArrangerStep(next);
  }

  private applyArrangerStep(i: number): void {
    const p = this.getProject();
    const s: ArrangerStep | undefined = p.arranger.steps[i];
    if (!s) return;
    const en = p.arranger.enable;
    if (en.theme && s.item) this.queueItem(s.item);
    if (en.preset && s.preset !== null && p.accPresets[s.preset]) this.queuePreset(s.preset);
    const t = { ...(this.queuedTonality?.value ?? this.activeTonality) };
    let changed = false;
    if (en.scale && s.scale !== null) { t.scale = s.scale; changed = true; }
    if (en.mode && s.mode !== null) { t.mode = s.mode; changed = true; }
    if (en.keyOctave && s.key !== null) { t.key = s.key; changed = true; }
    if (en.keyOctave && s.octave !== null) { t.octave = s.octave; changed = true; }
    if (changed) {
      this.queueTonality(t);
      p.tonality = { ...t };
    }
    this.listener.onArrangerStep?.(i);
  }
}

/** Program changes for voices with a program set (Send Programs at Start). */
export function programChanges(voices: Voice[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const v of voices) {
    if (v.program > 0 && !seen.has(v.channel)) {
      seen.add(v.channel);
      out.push([0xc0 | ((v.channel - 1) & 15), (v.program - 1) & 127]);
    }
  }
  return out;
}
