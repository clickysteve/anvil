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
import { AudioPreview } from '../audio/preview';
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

export type Change = 'project' | 'bank' | 'params' | 'voices' | 'tonality' | 'transport' | 'midi' | 'prefs' | 'arranger' | 'notice' | 'mode';

export interface SessionDeps {
  time?: TimeSource;
  store?: KeyValueStore | null;
  prefStore?: PrefStore | null;
  midi?: MidiAccess;
  /** seed source for new projects (tests pass a fixed one) */
  seed?: () => number;
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
  readonly preview = new AudioPreview();
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
    this.router.addListener(this.preview.handle);
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
    if (c !== 'transport' && c !== 'midi' && c !== 'notice' && c !== 'prefs') this.scheduleAutosave();
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
    this.emit('project');
    this.emit('bank');
    this.emit('mode');
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
