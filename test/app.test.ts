import { describe, expect, it } from 'vitest';
import { DEMOS } from '../src/app/demos';
import { Session } from '../src/app/session';
import { CURRENT_ALGORITHMS } from '../src/engine/algorithms';
import { newProject } from '../src/engine/defaults';
import * as edit from '../src/engine/edit';
import { generateTheme } from '../src/engine/theme';
import { ITEM_IDS } from '../src/engine/types';
import { mutate, regenerateAccents, regeneratePitches, regenerateRhythm } from '../src/extended/extended';
import { exportSmf, readSmf, renderPerformance } from '../src/midi/smf';
import { loadProject, parseProject, ProjectError, serializeProject } from '../src/persistence/format';
import { ProjectStorage } from '../src/persistence/storage';
import { FakePort, FakeTime, unmatchedNotes } from './helpers';

function memStore() {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), removeItem: (k: string) => void delete data[k] };
}

function session() {
  const time = new FakeTime();
  const store = memStore();
  const s = new Session({ time, store, prefStore: store, seed: () => 4242 });
  const port = new FakePort();
  s.router.setNotePort(port);
  return { s, time, port, store };
}

describe('project format', () => {
  it('round-trips a project exactly', () => {
    const p = newProject(7);
    p.bank.TA = generateTheme('TA', p.params, p.weights, 3);
    p.mode = 'extended';
    p.extended.locks.TA = [1, 2];
    const r = parseProject(serializeProject(p));
    expect(r.project).toEqual(p);
    expect(r.warnings).toEqual([]);
  });
  it('stores mode, seeds and algorithm versions', () => {
    const p = newProject(99);
    const o = JSON.parse(serializeProject(p));
    expect(o.format).toBe('anvil-project');
    expect(o.version).toBe(2);
    expect(o.mode).toBe('classic');
    expect(o.seed).toBe(99);
    expect(o.algorithms.harmonyInversion).toBe('classic.harmony.inversion.v1');
    expect(o.algorithms.pitchRepeats).toBe('classic.pitch.repeats.v1');
  });
  it('repairs out-of-range values and damaged themes with warnings', () => {
    const p = JSON.parse(serializeProject(newProject(1)));
    p.tempo = 9999;
    p.params.pulse = -3;
    p.voices[2].channel = 40;
    p.bank = { TA: { events: [] }, ZZ: {} };
    p.weights[0] = [0, 0, 0, 0, 0, 0, 0];
    const r = loadProject(p);
    expect(r.project.tempo).toBe(400);
    expect(r.project.params.pulse).toBe(1);
    expect(r.project.voices[2].channel).toBe(16);
    expect(r.project.bank.TA).toBeUndefined();
    expect(r.project.weights[0].some((w) => w > 0)).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(5);
  });
  it('replaces unknown algorithm versions and fills missing ones', () => {
    const p = JSON.parse(serializeProject(newProject(1)));
    p.algorithms = { pitch: 'classic.pitch.v99' };
    const r = loadProject(p);
    expect(r.project.algorithms).toEqual(CURRENT_ALGORITHMS);
    expect(r.warnings.some((w) => w.includes('classic.pitch.v99'))).toBe(true);
  });
  it('refuses newer formats and non-ANVIL files', () => {
    expect(() => parseProject('{"format":"anvil-project","version":99}')).toThrow(ProjectError);
    expect(() => parseProject('{"format":"something-else","version":1}')).toThrow(ProjectError);
    expect(() => parseProject('not json')).toThrow(ProjectError);
  });
  it('runs migrations in order', () => {
    const old = { ...JSON.parse(serializeProject(newProject(5))), version: 1, title: 'Old name' };
    delete old.name;
    const migrations = { 1: (o: Record<string, unknown>) => ({ ...o, name: o.title, version: 2 }) };
    const r = loadProject(old, migrations, 2);
    expect(r.project.name).toBe('Old name');
    expect(r.project.version).toBe(2);
    expect(r.warnings[0]).toContain('Upgraded');
  });
});

describe('storage', () => {
  it('autosaves and restores; library saves by name', () => {
    const st = new ProjectStorage(memStore());
    const p = newProject(3);
    p.name = 'Song';
    expect(st.autosave(p)).toBe(true);
    expect(st.loadAutosave()!.project.name).toBe('Song');
    const e = st.saveNamed(p)!;
    expect(st.library().map((x) => x.name)).toEqual(['Song']);
    expect(st.loadNamed(e.id)!.project.seed).toBe(3);
    st.remove(e.id);
    expect(st.library()).toEqual([]);
  });
  it('survives a throwing store', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    const st = new ProjectStorage(bad);
    expect(st.autosave(newProject(1))).toBe(false);
    expect(st.loadAutosave()).toBeNull();
  });
});

describe('MIDI file export', () => {
  it('writes a valid format-1 file with tempo and paired notes', () => {
    const p = newProject(11);
    p.bank.TA = generateTheme('TA', p.params, p.weights, 5);
    p.voices[1].mute = false;
    p.voices[1].channel = 2;
    p.tempo = 100;
    const smf = readSmf(exportSmf(p, { passes: 2 }));
    expect(smf.format).toBe(1);
    expect(smf.division).toBe(96);
    expect(smf.tracks.length).toBe(3);
    const tempo = smf.tracks[0].find((e) => e.data[0] === 0xff && e.data[1] === 0x51)!;
    expect((tempo.data[2] << 16) | (tempo.data[3] << 8) | tempo.data[4]).toBe(600000);
    for (const tr of smf.tracks.slice(1)) {
      expect(unmatchedNotes(tr.filter((e) => e.data[0] < 0xf0).map((e) => ({ data: e.data, time: e.tick })))).toBe(0);
    }
    const lastTick = Math.max(...smf.tracks[1].map((e) => e.tick));
    expect(lastTick).toBeLessThanOrEqual(2 * p.bank.TA!.length * p.bank.TA!.microbeat * 4);
  });
  it('matches live playback event-for-event', () => {
    const p = newProject(12);
    p.bank.TA = generateTheme('TA', p.params, p.weights, 6);
    const a = renderPerformance(p, { passes: 1 });
    const b = renderPerformance(p, { passes: 1 });
    expect(a).toEqual(b);
    expect(a.clocks).toBe(p.bank.TA!.length * p.bank.TA!.microbeat);
  });
});

describe('editing', () => {
  const t = generateTheme('TA', { ...newProject(1).params, rest: 0 }, newProject(1).weights, 8);
  it('changes pitch, accent, rest and length without touching the original', () => {
    const before = structuredClone(t);
    const a = edit.setDegree(t, 0, 40);
    expect(a.events[0].degree).toBe(40);
    expect(a.origin.kind).toBe('edited');
    const b = edit.toggleRest(t, 1);
    expect(b.events[1].rest).toBe(true);
    const c = edit.changeLength(t, 0, 2);
    expect(c.length).toBe(t.length + 2);
    expect(c.events[1].start).toBe(t.events[0].len + 2);
    expect(edit.cycleAccent(t, 0).events[0].accent).not.toBe(t.events[0].accent);
    expect(t).toEqual(before);
  });
});

describe('Extended operations', () => {
  const p = newProject(2);
  const t = generateTheme('TA', { ...p.params, rest: 0 }, p.weights, 8);
  const notes = (x: typeof t) => x.events.filter((e) => !e.rest).map((e) => e.degree);
  it('new pitches keep the rhythm and locked notes', () => {
    const n = regeneratePitches(t, p.params, p.weights, 77, { locks: [0, 3] });
    expect(n.events.map((e) => [e.start, e.len, e.accent])).toEqual(t.events.map((e) => [e.start, e.len, e.accent]));
    expect(n.events[0].degree).toBe(t.events[0].degree);
    expect(n.events[3].degree).toBe(t.events[3].degree);
    expect(n.origin.kind).toBe('regenerated');
    expect(n.algorithms).toContain('extended.regenerate.v1');
  });
  it('contour preservation follows the old up/down shape where possible', () => {
    const n = regeneratePitches(t, { ...p.params, maxLeap: 7, maxStep: 7, maxRepeats: 9, low: 21, high: 55 }, p.weights, 5, { preserveContour: true });
    const a = notes(t);
    const b = notes(n);
    let same = 0;
    for (let i = 1; i < a.length; i++) if (Math.sign(a[i] - a[i - 1]) === Math.sign(b[i] - b[i - 1])) same++;
    expect(same / (a.length - 1)).toBeGreaterThan(0.8);
  });
  it('new rhythm keeps the pitch order; new accents keep onsets', () => {
    const r = regenerateRhythm(t, p.params, p.weights, 9);
    const a = notes(t);
    const b = notes(r);
    const n = Math.min(a.length, b.length);
    expect(b.slice(0, n)).toEqual(a.slice(0, n));
    const ac = regenerateAccents(t, p.params, 3);
    expect(ac.events.map((e) => e.start)).toEqual(t.events.map((e) => e.start));
  });
  it('mutation depth 0 changes nothing; deterministic per seed', () => {
    expect(notes(mutate(t, p.params, p.weights, 1, 0))).toEqual(notes(t));
    expect(mutate(t, p.params, p.weights, 4, 60)).toEqual(mutate(t, p.params, p.weights, 4, 60));
  });
});

describe('demos', () => {
  it('every demo builds, is deterministic, valid and marked original', () => {
    for (const d of DEMOS) {
      const a = d.build();
      expect(a).toEqual(d.build());
      expect(loadProject(JSON.parse(serializeProject(a))).warnings).toEqual([]);
      expect(a.notes).toContain('Original ANVIL demo');
      expect(Object.keys(a.bank).length).toBeGreaterThan(0);
      expect(renderPerformance(a, { passes: 1 }).msgs.length).toBeGreaterThan(0);
    }
    expect(DEMOS.map((d) => d.id)).toEqual(['simple', 'rhythmic', 'pitch', 'sparse', 'accompaniment', 'hermod']);
  });
});

describe('session', () => {
  it('starts with a generated theme and autosaves', () => {
    const { s, time, store } = session();
    expect(s.project.bank.TA).toBeDefined();
    s.setParam('rest', 30);
    time.advance(1000);
    expect(store.data['anvil.autosave']).toContain('"rest": 30');
  });
  it('selecting an empty variation generates its row theme first', () => {
    const { s } = session();
    s.clearItem('TB');
    s.select('VB2');
    expect(s.project.bank.TB).toBeDefined();
    expect(s.project.bank.VB2!.origin.from).toBe('TB');
  });
  it('generation is reproducible from the project seed', () => {
    const a = session().s;
    const b = session().s;
    a.generate('TC');
    b.generate('TC');
    expect(a.project.bank.TC).toEqual(b.project.bank.TC);
  });
  it('accompaniment preset recall respects voice lock-out', () => {
    const { s } = session();
    s.setVoice(1, 'velocity', 33);
    s.storeAccPreset(0);
    s.setVoice(1, 'velocity', 99);
    s.setVoice(2, 'velocity', 77);
    s.setVoice(2, 'locked', true);
    s.recallAccPreset(0);
    expect(s.project.voices[1].velocity).toBe(33);
    expect(s.project.voices[2].velocity).toBe(77);
  });
  it('replacing the project while playing leaves nothing sounding', () => {
    const { s, time, port } = session();
    s.start();
    time.advance(700);
    s.loadDemo('accompaniment');
    expect(s.transport.state).toBe('stopped');
    expect(unmatchedNotes(port.sent)).toBe(0);
  });
  it('mode switching keeps the music and its data', () => {
    const { s } = session();
    const before = structuredClone(s.project.bank);
    s.setMode('extended');
    s.view('TA');
    s.selectEvent(0);
    s.toggleLock();
    s.setMode('classic');
    expect(s.project.bank).toEqual(before);
    expect(s.project.extended.locks.TA).toEqual([0]);
    expect(s.roundTrip().project.mode).toBe('classic');
  });
  it('Extended actions do nothing in Classic mode', () => {
    const { s } = session();
    const before = structuredClone(s.project.bank.TA);
    s.extRegenerate('pitches');
    s.extMutate();
    expect(s.project.bank.TA).toEqual(before);
  });
  it('simulated external clock input drives playback through receive()', () => {
    const { s, time, port } = session();
    s.setClockSource('external');
    s.receive([0xfa], time.t);
    for (let i = 0; i < 48; i++) {
      time.advance(20);
      s.receive([0xf8], time.t);
    }
    expect(s.seq.tick).toBe(48);
    expect(port.notes().length).toBeGreaterThan(0);
    expect(s.monitor.clock.in.count).toBe(48);
    expect(s.monitor.entries.filter((e) => e.text.startsWith('Clock'))).toHaveLength(0);
    s.receive([0xfc], time.t);
    expect(unmatchedNotes(port.sent)).toBe(0);
  });
  it('arranger recording captures item changes with their durations', () => {
    const { s, time } = session();
    s.generate('TB');
    s.startRecording();
    time.advance(2000);
    s.select('TB');
    time.advance(1000);
    s.stop();
    const steps = s.project.arranger.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].item).toBe('TA');
    expect(steps[1].item).toBe('TB');
    expect(steps[0].clocks).toBeGreaterThan(80);
  });
  it('every bank slot can be generated', () => {
    const { s } = session();
    for (const id of ITEM_IDS) s.select(id);
    expect(Object.keys(s.project.bank)).toHaveLength(20);
  });
});

describe('piano-roll edits', () => {
  const base = { ...newProject(1).params, rest: 0 };
  const t0 = generateTheme('TA', base, newProject(1).weights, 21);
  const total = (x: typeof t0) => x.events.reduce((s, e) => s + e.len, 0);
  const contiguous = (x: typeof t0) => x.events.every((e, i) => i === 0 || e.start === x.events[i - 1].start + x.events[i - 1].len);
  it('moving a note keeps the length, never removes a note, and leaves a rest behind', () => {
    // find a note followed by a longer event
    const t = edit.changeLength(t0, 1, 2);
    const notes = t.events.filter((e) => !e.rest).length;
    const m = edit.moveNote(t, 0, 1);
    expect(total(m)).toBe(total(t));
    expect(contiguous(m)).toBe(true);
    expect(m.events[0].rest).toBe(true);
    expect(m.events.filter((e) => !e.rest).length).toBe(notes);
    const back = edit.moveNote(m, 1, -1);
    expect(back.events[0].rest).toBe(false);
    expect(total(back)).toBe(total(t));
    // limits: cannot move past a one-microbeat note
    expect(edit.moveLimits(t0, 0)).toEqual({ min: 0, max: t0.events[1].len - 1 });
  });
  it('resizing takes time from the next event and gives it back as rest', () => {
    const t = edit.changeLength(t0, 1, 3);
    const r = edit.resizeEvent(t, 0, t.events[0].len + 2);
    expect(total(r)).toBe(total(t));
    expect(r.events[0].len).toBe(t.events[0].len + 2);
    const s = edit.resizeEvent(r, 0, 1);
    expect(total(s)).toBe(total(t));
    expect(s.events[1].rest).toBe(true);
  });
  it('delete makes a rest; double-click adds a note into a rest', () => {
    const d = edit.deleteNote(t0, 2);
    expect(d.events.find((e) => e.start === t0.events[2].start)!.rest).toBe(true);
    expect(total(d)).toBe(total(t0));
    const restAt = d.events.find((e) => e.rest)!;
    const a = edit.addNote(d, restAt.start, 40);
    expect(a.index).toBeGreaterThanOrEqual(0);
    expect(a.theme.events[a.index]).toMatchObject({ rest: false, degree: 40, start: restAt.start, len: 1 });
    expect(total(a.theme)).toBe(total(t0));
    expect(contiguous(a.theme)).toBe(true);
  });
});
