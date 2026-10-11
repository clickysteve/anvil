/**
 * The session: one open project plus the live machinery (sequencer, transport, MIDI, monitor,
 * audio preview, storage, preferences). Every user action goes through a method here, so the
 * interface stays a thin view and the behaviour can be tested without a browser.
 */
import { CURRENT_ALGORITHMS } from '../engine/algorithms';
import { newProject } from '../engine/defaults';
import * as edit from '../engine/edit';
import { deriveSeed, randomSeed } from '../engine/rng';
import { Sequencer } from '../engine/sequencer';
import { copyTheme, generateTheme, generateVariation, isVariation, rowTheme } from '../engine/theme';
import type { ArrangerStep, ItemId, Mode, Project, Theme, Tonality, TVParams, Voice } from '../engine/types';
import { ITEM_IDS } from '../engine/types';
import { mutate, regenerateAccents, regeneratePitches, regenerateRhythm, toggleLock } from '../extended/extended';
import { makeBundle, unpackBundle } from '../audio/bundle';
import { exportAudio, type AudioExportOptions, type ExportResult } from '../audio/exportAudio';
import { SampleLibrary } from '../audio/library';
import { LiveAudio } from '../audio/live';
import { referencedSamples, SLOT_COUNT, slotLabel, type SampleSlot, type VoiceSource } from '../audio/settings';
import type { TransformRunner } from '../core/dsp/transform/cache';
import type { AudioData } from '../core/dsp/transform/transform';
import type { OutputFxSettings } from '../core/dsp/output/settings';
import type { DecodedSample } from '../core/sampler/decode';
import type { SampleZone } from '../core/sampler/zone';
import type { SampleTransform } from '../core/dsp/transform/settings';
import { IndexedDbSampleStore, type SampleStore } from '../core/storage/samples';
import { HARMONY_DRUM_BASE } from '../engine/types';
import { MidiMonitor } from '../midi/monitor';
import { OutputRouter } from '../midi/router';
import { exportSmf, type ExportOptions } from '../midi/smf';
import { MidiAccess } from '../midi/webmidi';
import { loadProject, parseProject, projectFileName, serializeProject, type LoadResult } from '../persistence/format';
import { defaultStore, ProjectStorage, type KeyValueStore } from '../persistence/storage';
import { browserTime, type TimeSource } from '../transport/clocks';
import { Transport, type ClockSource } from '../transport/transport';
import { findDemo } from './demos';
import { loadPrefs, savePrefs, type AppPrefs, type PrefStore } from './prefs';

export type Change = 'project' | 'bank' | 'params' | 'voices' | 'tonality' | 'transport' | 'midi' | 'prefs' | 'arranger' | 'notice' | 'mode' | 'audio' | 'samples';

/** Sample storage for this browser (IndexedDB), or null where IndexedDB is unavailable. */
export function defaultSampleStore(): SampleStore | null {
  try {
    return typeof indexedDB === 'undefined' ? null : new IndexedDbSampleStore('anvil-samples');
  } catch {
    return null;
  }
}

export interface SessionDeps {
  time?: TimeSource;
  store?: KeyValueStore | null;
  prefStore?: PrefStore | null;
  midi?: MidiAccess;
  /** seed source for new projects (tests pass a fixed one) */
  seed?: () => number;
  /** browser-local sample storage (default: IndexedDB "anvil-samples") */
  sampleStore?: SampleStore | null;
  /** where sample transformations run (default: synchronously) */
  transformRunner?: TransformRunner;
  /** URL of the output-processor worklet (default: none, so processing is unavailable) */
  workletUrl?: string | null;
  /** test hooks for environments without Web Audio */
  makeBuffer?: (audio: AudioData) => AudioBuffer;
  decode?: (bytes: ArrayBuffer, name: string) => Promise<DecodedSample>;
}

export class Session {
  project: Project;
  /** the item shown in the theme view */
  focus: ItemId = 'TA';
  /** selected event index in the focused item */
  selectedEvent: number | null = null;
  /** Extended: item drawn for comparison */
  compare: ItemId | null = null;
  notice = '';
  warnings: string[] = [];
  recording = false;
  private recordStart = 0;
  lastPreset: number | null = null;

  readonly time: TimeSource;
  readonly storage: ProjectStorage;
  readonly prefStore: PrefStore | null;
  prefs: AppPrefs;
  readonly midi: MidiAccess;
  readonly router: OutputRouter;
  readonly seq: Sequencer;
  readonly transport: Transport;
  readonly monitor = new MidiMonitor();
  /** live internal audio (the internal synth and samples) */
  readonly preview: LiveAudio;
  readonly library: SampleLibrary;
  readonly workletUrl: string | null;
  private listeners = new Set<(c: Change) => void>();
  private autosaveTimer: unknown = null;
  private newSeed: () => number;

  constructor(deps: SessionDeps = {}) {
    this.time = deps.time ?? browserTime;
    const store = deps.store === undefined ? defaultStore() : deps.store;
    this.storage = new ProjectStorage(store);
    this.prefStore = deps.prefStore === undefined ? store : deps.prefStore;
    this.prefs = loadPrefs(this.prefStore);
    this.midi = deps.midi ?? new MidiAccess();
    this.newSeed = deps.seed ?? randomSeed;
    const restored = this.storage.loadAutosave();
    this.project = restored?.project ?? this.freshProject();
    this.router = new OutputRouter(this.time.now);
    this.seq = new Sequencer(() => this.project, (i) => this.applyAccPreset(i));
    this.transport = new Transport(this.seq, this.router, this.time, () => this.project);
    this.transport.listener = {
      onState: () => this.emit('transport'),
      onClockStatus: () => this.emit('midi'),
    };
    this.seq.listener = {
      onItem: () => this.emit('transport'),
      onTonality: () => this.emit('tonality'),
      onPreset: () => this.emit('voices'),
      onArrangerStep: () => this.emit('arranger'),
    };
    this.router.addListener((b, t, d, port) => this.monitor.record(b, t, d, port));
    this.library = new SampleLibrary({ store: deps.sampleStore === undefined ? defaultSampleStore() : deps.sampleStore, runner: deps.transformRunner, makeBuffer: deps.makeBuffer, decode: deps.decode });
    this.library.onChange = () => this.emit('samples');
    this.workletUrl = deps.workletUrl ?? null;
    this.preview = new LiveAudio(() => this.project.audio, this.library, this.workletUrl);
    this.transport.audio = this.preview;
    this.library.sync(this.project.audio);
    this.transport.setTempo(this.project.tempo);
    this.transport.clockOut = this.prefs.clockOut;
    this.focus = this.project.selected;
    this.seq.reset();
  }

  private freshProject(): Project {
    const p = newProject(this.newSeed());
    this.generateInto(p, 'TA');
    return p;
  }

  // ------------------------------------------------------------------ events

  on(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(c: Change): void {
    for (const l of this.listeners) l(c);
    if (c !== 'transport' && c !== 'midi' && c !== 'notice' && c !== 'prefs' && c !== 'samples') this.scheduleAutosave();
  }

  say(msg: string): void {
    this.notice = msg;
    this.emit('notice');
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) this.time.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = this.time.setTimeout(() => {
      this.autosaveTimer = null;
      this.storage.autosave(this.project);
    }, 600);
  }

  saveNow(): void {
    this.storage.autosave(this.project);
  }

  setPrefs(patch: Partial<AppPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    savePrefs(this.prefStore, this.prefs);
    this.emit('prefs');
  }

  get isExtended(): boolean {
    return this.project.mode === 'extended';
  }

  // ------------------------------------------------------------------ generation

  private nextSeed(p: Project): number {
    return deriveSeed(p.seed, p.generation++);
  }

  /** Generate (or regenerate) an item into a project. Variations need their row's theme. */
  private generateInto(p: Project, id: ItemId, seed?: number): Theme {
    const s = seed ?? this.nextSeed(p);
    if (!isVariation(id)) {
      const t = generateTheme(id, p.params, p.weights, s);
      p.bank[id] = t;
      return t;
    }
    const row = rowTheme(id);
    if (!p.bank[row]) this.generateInto(p, row);
    const v = generateVariation(id, p.bank[row]!, p.params, p.weights, s);
    p.bank[id] = v;
    return v;
  }

  /** Make a new theme/variation in a slot (with an explicit seed in Extended mode). */
  generate(id: ItemId, seed?: number): Theme {
    const t = this.generateInto(this.project, id, seed);
    this.focus = id;
    this.selectedEvent = null;
    this.say(`${id}: ${isVariation(id) ? 'new variation' : 'new theme'} (seed ${t.seed}).`);
    this.emit('bank');
    return t;
  }

  /** Select an item to play (generating it if the slot is empty). */
  select(id: ItemId, immediate = false): void {
    if (!this.project.bank[id]) this.generateInto(this.project, id);
    this.project.selected = id;
    this.focus = id;
    this.selectedEvent = null;
    if (this.transport.state === 'running' || this.transport.state === 'armed') {
      this.seq.queueItem(id, immediate);
      this.recordStep();
    } else this.seq.item = id;
    this.emit('bank');
  }

  /** Show an item in the theme view without changing what plays. */
  view(id: ItemId): void {
    this.focus = id;
    this.selectedEvent = null;
    this.emit('bank');
  }

  copyItem(from: ItemId, to: ItemId): void {
    const t = this.project.bank[from];
    if (!t || from === to) return;
    this.project.bank[to] = copyTheme(t, to);
    this.focus = to;
    this.say(`Copied ${from} to ${to}.`);
    this.emit('bank');
  }

  clearItem(id: ItemId): void {
    delete this.project.bank[id];
    delete this.project.extended.locks[id];
    if (this.compare === id) this.compare = null;
    this.say(`Cleared ${id}.`);
    this.emit('bank');
  }

  // ------------------------------------------------------------------ parameters

  setParam<K extends keyof TVParams>(k: K, v: TVParams[K]): void {
    this.project.params = { ...this.project.params, [k]: v };
    this.emit('params');
  }

  storeTvPreset(i: number): void {
    this.project.tvPresets[i] = { ...this.project.params };
    this.say(`Stored the theme parameters as preset ${String.fromCharCode(65 + i)}.`);
    this.emit('params');
  }

  recallTvPreset(i: number): void {
    const p = this.project.tvPresets[i];
    if (!p) return;
    this.project.params = { ...p };
    this.say(`Recalled theme parameter preset ${String.fromCharCode(65 + i)}.`);
    this.emit('params');
  }

  deleteTvPreset(i: number): void {
    this.project.tvPresets[i] = null;
    this.emit('params');
  }

  setWeight(table: number, pos: number, w: number): void {
    const row = [...this.project.weights[table]];
    row[pos] = Math.max(0, Math.min(8, Math.round(w)));
    if (!row.some((x) => x > 0)) {
      this.say('A scale-weight table needs at least one non-zero weight.');
      return;
    }
    this.project.weights = this.project.weights.map((r, i) => (i === table ? row : r));
    this.emit('params');
  }

  // ------------------------------------------------------------------ tonality

  setTonality(patch: Partial<Tonality>, immediate = false): void {
    const t = { ...this.project.tonality, ...patch };
    this.project.tonality = t;
    if (this.transport.state === 'running' || this.transport.state === 'armed') {
      this.seq.queueTonality(t, immediate);
      this.recordStep();
    } else this.seq.activeTonality = { ...t };
    this.emit('tonality');
  }

  setUserScale(index: number, entries: number[]): void {
    this.project.userScales = this.project.userScales.map((s, i) => (i === index ? [...entries] : s));
    this.seq.invalidate();
    this.emit('tonality');
  }

  // ------------------------------------------------------------------ voices

  setVoice<K extends keyof Voice>(i: number, k: K, v: Voice[K]): void {
    this.project.voices = this.project.voices.map((x, n) => (n === i ? { ...x, [k]: v } : x));
    this.seq.invalidate();
    this.emit('voices');
  }

  copyVoice(from: number, to: number): void {
    const s = this.project.voices[from];
    // DOC: copies everything except program and mute
    this.project.voices = this.project.voices.map((x, n) => (n === to ? { ...s, program: x.program, mute: x.mute, solo: x.solo, locked: x.locked } : x));
    this.seq.invalidate();
    this.emit('voices');
  }

  storeAccPreset(i: number): void {
    this.project.accPresets[i] = this.project.voices.map((v) => ({ ...v }));
    this.say(`Stored the accompaniment as preset ${String.fromCharCode(65 + i)}.`);
    this.emit('voices');
  }

  deleteAccPreset(i: number): void {
    this.project.accPresets[i] = null;
    this.emit('voices');
  }

  recallAccPreset(i: number, immediate = false): void {
    if (!this.project.accPresets[i]) return;
    this.lastPreset = i;
    if (this.transport.state === 'running' || this.transport.state === 'armed') {
      this.seq.queuePreset(i, immediate);
      this.recordStep();
    } else this.applyAccPreset(i);
    this.emit('voices');
  }

  /** Copy a preset into the live voices, leaving locked-out voices alone. */
  private applyAccPreset(i: number): void {
    const preset = this.project.accPresets[i];
    if (!preset) return;
    this.project.voices = this.project.voices.map((v, n) => (v.locked ? v : { ...preset[n], locked: false }));
    this.seq.invalidate();
  }

  setDrum(i: number, note: number): void {
    this.project.drums = this.project.drums.map((d, n) => (n === i ? Math.max(0, Math.min(127, note)) : d));
    this.seq.invalidate();
    this.emit('voices');
  }

  setOption<K extends keyof Project['options']>(k: K, v: Project['options'][K]): void {
    this.project.options = { ...this.project.options, [k]: v };
    this.seq.invalidate();
    this.emit('project');
  }

  // ------------------------------------------------------------------ editing

  private replaceFocused(t: Theme, msg?: string): void {
    this.project.bank[this.focus] = t;
    if (this.focus === this.seq.item && this.transport.state === 'running') this.seq.invalidate();
    if (msg) this.say(msg);
    this.emit('bank');
  }

  get focused(): Theme | undefined {
    return this.project.bank[this.focus];
  }

  editEvent(op: 'up' | 'down' | 'octaveUp' | 'octaveDown' | 'accent' | 'rest' | 'longer' | 'shorter'): void {
    const t = this.focused;
    const i = this.selectedEvent;
    if (!t || i === null || !t.events[i]) return;
    const e = t.events[i];
    let n: Theme = t;
    if (op === 'up' || op === 'down' || op === 'octaveUp' || op === 'octaveDown') {
      const d = { up: 1, down: -1, octaveUp: 7, octaveDown: -7 }[op];
      n = edit.setDegree(t, i, e.degree + d);
    } else if (op === 'accent') n = edit.cycleAccent(t, i);
    else if (op === 'rest') n = edit.toggleRest(t, i);
    else if (op === 'longer') n = edit.changeLength(t, i, 1);
    else n = edit.changeLength(t, i, -1);
    if (op === 'rest' && n !== t) this.selectedEvent = Math.min(i, n.events.length - 1);
    this.replaceFocused(n);
  }

  /** Drag result: change pitch by dDeg degrees and move dMb microbeats in time (one edit). */
  dragEvent(i: number, dDeg: number, dMb: number): void {
    const t0 = this.focused;
    const e = t0?.events[i];
    if (!t0 || !e || e.rest || (!dDeg && !dMb)) return;
    const lim = edit.moveLimits(t0, i);
    const k = Math.max(lim.min, Math.min(lim.max, Math.round(dMb)));
    let t = dDeg ? edit.setDegree(t0, i, e.degree + dDeg) : t0;
    if (k) t = edit.moveNote(t, i, k);
    if (t === t0) return;
    // the moved note's index can change when rests are inserted or merged before it
    const j = t.events.findIndex((x) => !x.rest && x.start === e.start + k);
    this.selectedEvent = j >= 0 ? j : i;
    this.replaceFocused(t);
  }

  resizeSelected(len: number): void {
    const t = this.focused;
    const i = this.selectedEvent;
    if (!t || i === null || !t.events[i]) return;
    this.replaceFocused(edit.resizeEvent(t, i, len));
  }

  /** Add a note into a rest at microbeat `at` (double-click in the theme view). */
  addNoteAt(at: number, degree: number): void {
    const t = this.focused;
    if (!t) return;
    const r = edit.addNote(t, at, degree);
    if (r.index < 0) return;
    this.selectedEvent = r.index;
    this.replaceFocused(r.theme);
  }

  /** Delete the selected note (it becomes a rest). */
  deleteSelected(): void {
    const t = this.focused;
    const i = this.selectedEvent;
    if (!t || i === null || !t.events[i] || t.events[i].rest) return;
    const n = edit.deleteNote(t, i);
    if (n === t) return this.say('A theme needs at least one note.');
    this.selectedEvent = n.events.findIndex((e) => e.start <= t.events[i].start && e.start + e.len > t.events[i].start);
    this.replaceFocused(n);
  }

  transposeFocused(delta: number): void {
    const t = this.focused;
    if (t) this.replaceFocused(edit.transposeTheme(t, delta));
  }

  selectEvent(i: number | null): void {
    this.selectedEvent = i;
    this.emit('bank');
  }

  // ------------------------------------------------------------------ Extended

  setMode(m: Mode): void {
    if (this.project.mode === m) return;
    this.project.mode = m;
    if (m === 'classic') this.compare = null;
    this.seq.invalidate();
    this.say(m === 'extended' ? 'Extended mode: extra tools are in the Extended tab.' : 'Classic mode.');
    this.emit('mode');
  }

  private extSeed(seed?: number): number {
    return seed ?? this.nextSeed(this.project);
  }

  extRegenerate(what: 'rhythm' | 'pitches' | 'accents' | 'range', seed?: number): void {
    const t = this.focused;
    if (!t || !this.isExtended) return;
    const p = this.project;
    const locks = p.extended.locks[this.focus];
    const s = this.extSeed(seed);
    let n: Theme;
    if (what === 'rhythm') n = regenerateRhythm(t, p.params, p.weights, s, { locks });
    else if (what === 'accents') n = regenerateAccents(t, p.params, s, { locks });
    else if (what === 'range') {
      const i = this.selectedEvent ?? 0;
      n = regeneratePitches(t, p.params, p.weights, s, { locks, preserveContour: p.extended.preserveContour, from: i, to: t.events.length - 1 });
    } else n = regeneratePitches(t, p.params, p.weights, s, { locks, preserveContour: p.extended.preserveContour });
    this.replaceFocused(n, `${this.focus}: ${n.origin.note} (seed ${s}).`);
  }

  extMutate(seed?: number): void {
    const t = this.focused;
    if (!t || !this.isExtended) return;
    const p = this.project;
    const s = this.extSeed(seed);
    const n = mutate(t, p.params, p.weights, s, p.extended.mutationDepth, { locks: p.extended.locks[this.focus] });
    this.replaceFocused(n, `${this.focus}: ${n.origin.note} (seed ${s}).`);
  }

  toggleLock(): void {
    if (this.selectedEvent === null || !this.isExtended) return;
    const l = this.project.extended.locks;
    l[this.focus] = toggleLock(l[this.focus], this.selectedEvent);
    this.emit('bank');
  }

  clearLocks(): void {
    delete this.project.extended.locks[this.focus];
    this.emit('bank');
  }

  setExtended<K extends keyof Project['extended']>(k: K, v: Project['extended'][K]): void {
    this.project.extended = { ...this.project.extended, [k]: v };
    this.emit('project');
  }

  // ------------------------------------------------------------------ transport

  start(): void {
    this.transport.start();
  }
  pause(): void {
    this.transport.pause();
  }
  cont(): void {
    this.transport.cont();
  }
  stop(): void {
    if (this.recording) this.stopRecording();
    this.transport.stop();
  }
  playOnce(): void {
    this.transport.playOnce();
  }
  stopAtEnd(): void {
    this.transport.stopAtEnd();
    this.say('Stopping at the end of the theme.');
  }
  panic(): void {
    this.transport.panic();
    this.preview.allOff();
    this.say('Panic: all notes off on every channel.');
  }
  setTempo(bpm: number): void {
    this.project.tempo = Math.max(20, Math.min(400, Math.round(bpm * 10) / 10));
    this.transport.setTempo(this.project.tempo);
    this.emit('project');
  }

  setClockSource(src: ClockSource): void {
    this.transport.setSource(src);
    this.setPrefs({ clockSource: src });
    this.attachInput();
    this.emit('transport');
  }

  setClockOut(on: boolean): void {
    this.transport.clockOut = on;
    this.setPrefs({ clockOut: on });
  }

  // ------------------------------------------------------------------ arranger

  playArranger(): void {
    if (!this.project.arranger.steps.length) {
      this.say('The arranger is empty: add steps first.');
      return;
    }
    const first = this.project.arranger.steps[0];
    if (first.item) {
      if (!this.project.bank[first.item]) this.generateInto(this.project, first.item);
      this.project.selected = first.item;
    }
    this.start();
    this.seq.startArranger();
    this.emit('arranger');
  }

  stopArranger(): void {
    this.seq.stopArranger();
    this.emit('arranger');
  }

  currentStep(): ArrangerStep {
    const t = this.project.tonality;
    return { item: this.project.selected, preset: this.lastPreset, scale: t.scale, mode: t.mode, key: t.key, octave: t.octave, clocks: 192 };
  }

  addStep(at?: number): void {
    const steps = [...this.project.arranger.steps];
    if (steps.length >= 1000) return;
    const s = this.currentStep();
    const item = this.project.bank[this.project.selected];
    if (item) s.clocks = item.length * item.microbeat;
    steps.splice(at ?? steps.length, 0, s);
    this.project.arranger = { ...this.project.arranger, steps };
    this.emit('arranger');
  }

  updateStep(i: number, patch: Partial<ArrangerStep>): void {
    const steps = this.project.arranger.steps.map((s, n) => (n === i ? { ...s, ...patch } : s));
    this.project.arranger = { ...this.project.arranger, steps };
    this.emit('arranger');
  }

  removeStep(i: number): void {
    this.project.arranger = { ...this.project.arranger, steps: this.project.arranger.steps.filter((_, n) => n !== i) };
    this.emit('arranger');
  }

  moveStep(i: number, d: number): void {
    const steps = [...this.project.arranger.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    this.project.arranger = { ...this.project.arranger, steps };
    this.emit('arranger');
  }

  setArrangerEnable(k: keyof Project['arranger']['enable'], v: boolean): void {
    this.project.arranger = { ...this.project.arranger, enable: { ...this.project.arranger.enable, [k]: v } };
    this.emit('arranger');
  }

  /** Record: every item, tonality or preset change while playing becomes a step. */
  startRecording(): void {
    this.recording = true;
    this.project.arranger = { ...this.project.arranger, steps: [] };
    if (this.transport.state !== 'running') this.start();
    this.recordStart = this.transport.ticks;
    this.project.arranger.steps.push(this.currentStep());
    this.say('Recording: changes you make while playing become arranger steps.');
    this.emit('arranger');
  }

  private recordStep(): void {
    if (!this.recording) return;
    const steps = this.project.arranger.steps;
    const now = this.transport.ticks;
    if (steps.length) steps[steps.length - 1].clocks = Math.max(1, now - this.recordStart);
    this.recordStart = now;
    const s = this.currentStep();
    if (this.seq.queued) s.item = this.seq.queued;
    steps.push(s);
    this.emit('arranger');
  }

  stopRecording(): void {
    if (!this.recording) return;
    const steps = this.project.arranger.steps;
    if (steps.length) steps[steps.length - 1].clocks = Math.max(1, this.transport.ticks - this.recordStart);
    this.recording = false;
    this.say(`Recorded ${steps.length} arranger steps.`);
    this.emit('arranger');
  }

  // ------------------------------------------------------------------ projects

  /** Replace the open project; playback stops first so nothing is left sounding. */
  replaceProject(p: Project, warnings: string[] = []): void {
    this.transport.stop();
    this.recording = false;
    this.project = p;
    this.warnings = warnings;
    this.focus = p.selected;
    this.selectedEvent = null;
    this.compare = null;
    this.lastPreset = null;
    this.transport.setTempo(p.tempo);
    this.seq.reset();
    this.library.sync(p.audio);
    this.preview.sync();
    this.emit('project');
    this.emit('bank');
    this.emit('mode');
    this.emit('audio');
    this.saveNow();
  }

  newProject(): void {
    this.replaceProject(this.freshProject());
    this.say('New project.');
  }

  loadDemo(id: string): void {
    const d = findDemo(id);
    if (!d) return;
    this.replaceProject(d.build());
    if (d.clockOut) this.setClockOut(true);
    this.say(`Loaded demo "${d.name}".${d.clockOut ? ' Clock Out is on.' : ''}`);
  }

  rename(name: string): void {
    this.project.name = name.trim().slice(0, 80) || 'Untitled';
    this.emit('project');
  }

  setNotes(text: string): void {
    this.project.notes = text.slice(0, 20000);
    this.emit('project');
  }

  serialize(): string {
    return serializeProject(this.project);
  }

  fileName(): string {
    return projectFileName(this.project);
  }

  importText(text: string): LoadResult {
    const r = parseProject(text);
    this.replaceProject(r.project, r.warnings);
    this.say(`Opened "${r.project.name}"${r.warnings.length ? ` with ${r.warnings.length} repair${r.warnings.length > 1 ? 's' : ''}` : ''}.`);
    return r;
  }

  saveToLibrary(): boolean {
    const e = this.storage.saveNamed(this.project);
    this.say(e ? `Saved "${this.project.name}" in this browser.` : `Could not save: ${this.storage.lastError || 'storage unavailable'}.`);
    return !!e;
  }

  openFromLibrary(id: string): void {
    const r = this.storage.loadNamed(id);
    if (!r) return this.say('That saved project could not be read.');
    this.replaceProject(r.project, r.warnings);
    this.say(`Opened "${r.project.name}".`);
  }

  exportMidi(opts: ExportOptions = {}): Uint8Array {
    return exportSmf(this.project, opts);
  }

  /** Clone the project through the file format (used by tests and duplicate). */
  roundTrip(): LoadResult {
    return loadProject(JSON.parse(this.serialize()));
  }

  // ------------------------------------------------------------------ internal audio, samples, export

  private audioChanged(): void {
    this.library.sync(this.project.audio);
    this.preview.sync();
    this.emit('audio');
  }

  setVoiceSource(i: number, source: VoiceSource): void {
    const a = this.project.audio;
    this.project.audio = { ...a, voices: a.voices.map((v, n) => (n === i ? { ...v, source } : v)) };
    this.audioChanged();
  }

  setVoiceFx(i: number, fx: OutputFxSettings): void {
    const a = this.project.audio;
    this.project.audio = { ...a, voices: a.voices.map((v, n) => (n === i ? { ...v, fx } : v)) };
    this.audioChanged();
  }

  setMasterFx(fx: OutputFxSettings): void {
    this.project.audio = { ...this.project.audio, master: fx };
    this.audioChanged();
  }

  private setSlot(slot: number, patch: Partial<SampleSlot>): void {
    const a = this.project.audio;
    this.project.audio = { ...a, slots: a.slots.map((x, n) => (n === slot ? { ...x, ...patch } : x)) };
    this.audioChanged();
  }

  setSlotZone(slot: number, patch: Partial<SampleZone>): void {
    this.setSlot(slot, { zone: { ...this.project.audio.slots[slot].zone, ...patch } });
  }

  setSlotTransform(slot: number, patch: Partial<SampleTransform>): void {
    this.setSlot(slot, { transform: { ...this.project.audio.slots[slot].transform, ...patch } });
  }

  clearSlot(slot: number): void {
    const a = this.project.audio.slots[slot];
    if (!a.sampleId) return;
    this.setSlot(slot, { sampleId: null, name: '' });
    this.say(`Cleared sample slot ${slotLabel(slot)}.`);
  }

  /**
   * Decode, validate, store and assign a user file to a slot. Never throws: a bad file leaves
   * the slot (and the running audio) as it was and reports why. Returns true on success.
   */
  async loadSample(slot: number, file: { bytes: ArrayBuffer; name: string; type?: string }): Promise<boolean> {
    if (slot < 0 || slot >= SLOT_COUNT) return false;
    try {
      const r = await this.library.importFile(file.bytes, file.name, file.type ?? '');
      this.library.retry();
      this.setSlot(slot, { sampleId: r.id, name: r.name });
      await this.library.ready();
      const st = this.library.state(slot);
      if (st.status === 'error') {
        this.say(`Could not load "${file.name}": ${st.message}`);
        return false;
      }
      this.say(`Loaded "${file.name}" into ${slotLabel(slot)}${r.warnings.length ? ` (${r.warnings.join(' ')})` : ''}.`);
      return true;
    } catch (e) {
      this.say(`Could not load "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Play a slot's sample at its root note (switches internal audio on: call from a click). */
  async audition(slot: number): Promise<boolean> {
    if (!this.preview.enabled) await this.setAudioPreview(true);
    if (!this.preview.enabled) return false;
    await this.library.ready();
    const ok = this.preview.audition(slot, this.project.voices.map((v) => ({ harmonyIsDrum: v.harmony >= HARMONY_DRUM_BASE })));
    if (!ok) this.say(`Slot ${slotLabel(slot)} has no playable sample.`);
    return ok;
  }

  /** Delete stored samples no saved project in this browser refers to. Returns how many. */
  async purgeUnusedSamples(): Promise<number> {
    const store = this.library.store;
    if (!store) return 0;
    const used = new Set(referencedSamples(this.project.audio));
    const projects = [this.storage.loadAutosave(), ...this.storage.library().map((e) => {
      try {
        return this.storage.loadNamed(e.id);
      } catch {
        return null;
      }
    })];
    for (const r of projects) if (r) for (const id of referencedSamples(r.project.audio)) used.add(id);
    let n = 0;
    for (const m of await store.list()) {
      if (used.has(m.id)) continue;
      await store.delete(m.id);
      this.library.forget(m.id);
      n++;
    }
    this.say(n ? `Removed ${n} unused sample${n > 1 ? 's' : ''} from this browser.` : 'No unused samples.');
    return n;
  }

  /** Render audio for the export window. Does not change the project, transport or MIDI. */
  async exportAudio(opts: AudioExportOptions, onProgress?: (f: number, stage: string) => void, signal?: AbortSignal): Promise<ExportResult> {
    return exportAudio(this.project, this.library, opts, { workletUrl: this.workletUrl, onProgress, signal });
  }

  /** A portable bundle of the project and its samples. */
  async bundle(): Promise<{ name: string; bytes: Uint8Array; missing: string[] }> {
    return makeBundle(this.project, this.library.store);
  }

  /** Open a portable bundle: store its samples, then open its project. */
  async openBundle(bytes: Uint8Array): Promise<void> {
    const b = await unpackBundle(bytes, this.library.store);
    this.library.retry();
    const r = parseProject(b.projectText);
    this.replaceProject(r.project, [...b.problems, ...r.warnings]);
    await this.library.ready();
    this.say(`Opened bundle "${r.project.name}" with ${b.stored} sample${b.stored === 1 ? '' : 's'}${b.problems.length ? ` (${b.problems.length} problem${b.problems.length > 1 ? 's' : ''})` : ''}.`);
  }

  // ------------------------------------------------------------------ MIDI devices

  async initMidi(): Promise<void> {
    this.midi.onChange(() => this.devicesChanged());
    await this.midi.init();
    this.devicesChanged();
    if (this.prefs.clockSource === 'external') this.setClockSource('external');
  }

  private devicesChanged(): void {
    // output: (re)connect to the chosen port when available, drop it when it disappears
    const id = this.prefs.outputId;
    const cur = this.router.notePort;
    if (cur && !this.midi.isConnected('output', cur.id)) {
      this.router.portLost(cur.id);
      this.say(`MIDI output "${cur.name}" disconnected.`);
    }
    if (id && !this.router.notePort && this.midi.isConnected('output', id)) this.router.setNotePort(this.midi.output(id));
    const cid = this.prefs.clockOutputId;
    if (cid && (!this.router.clockPort || this.router.clockPort.id !== cid) && this.midi.isConnected('output', cid)) this.router.setClockPort(this.midi.output(cid));
    if (this.router.clockPort && !this.midi.isConnected('output', this.router.clockPort.id)) this.router.setClockPort(null);
    // input: a vanished clock input is a clock loss
    const inId = this.prefs.inputId;
    if (inId && !this.midi.isConnected('input', inId)) {
      if (this.transport.source === 'external' && this.transport.external.status !== 'lost' && this.transport.external.status !== 'off') {
        this.transport.external.portLost();
        this.say('MIDI input disconnected: clock lost.');
      }
      this.inputAttached = false;
    } else if (inId && !this.inputAttached) this.attachInput();
    this.emit('midi');
  }

  private inputAttached = false;

  private attachInput(): void {
    const id = this.prefs.inputId;
    if (!id || !this.midi.isConnected('input', id)) {
      this.midi.unlisten();
      this.inputAttached = false;
      return;
    }
    this.midi.listen(id, (data, ts) => this.receive(Array.from(data), ts));
    this.inputAttached = true;
    if (this.transport.source === 'external' && (this.transport.external.status === 'lost' || this.transport.external.status === 'off')) this.transport.external.enable();
  }

  /** Incoming MIDI (also used by tests to simulate an input). */
  receive(data: number[], time: number): void {
    const st = data[0];
    if (st >= 0xf8) {
      if (st !== 0xf8) this.router.noteInput(data, time, this.prefs.inputId ?? '');
      else this.monitor.record(data, time, 'in', this.prefs.inputId ?? '');
      if (this.transport.source === 'external') this.transport.external.receive(st, time);
      return;
    }
    this.router.noteInput(data, time, this.prefs.inputId ?? '');
  }

  selectOutput(id: string | null): void {
    this.router.setNotePort(id ? this.midi.output(id) : null);
    this.setPrefs({ outputId: id });
    this.emit('midi');
  }

  selectClockOutput(id: string | null): void {
    this.router.setClockPort(id ? this.midi.output(id) : null);
    this.setPrefs({ clockOutputId: id });
    this.emit('midi');
  }

  selectInput(id: string | null): void {
    this.setPrefs({ inputId: id });
    this.attachInput();
    if (this.transport.source === 'external') this.transport.external.enable();
    this.emit('midi');
  }

  async setAudioPreview(on: boolean): Promise<void> {
    if (on) {
      this.preview.setVolume(this.prefs.previewVolume);
      const ok = await this.preview.enable();
      if (!ok) this.say('Audio preview is not available in this browser.');
      this.setPrefs({ audioPreview: ok });
    } else {
      this.preview.disable();
      this.setPrefs({ audioPreview: false });
    }
    this.emit('midi');
  }

  /** Version ids in force (for the project details view). */
  algorithmTable(): Record<string, string> {
    return { ...CURRENT_ALGORITHMS, ...this.project.algorithms };
  }

  itemIds(): readonly ItemId[] {
    return ITEM_IDS;
  }
}
