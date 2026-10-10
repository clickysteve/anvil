/**
 * Standard MIDI File export (format 1).
 *
 * The export runs the same Sequencer as live playback, clock by clock, without real time, so
 * the file contains exactly what ANVIL would play (including voice delays, articulation and
 * the arranger). Division is 96 ticks per quarter note (4 per MIDI clock).
 *
 * Track 0 holds the name, tempo and a 4/4 time signature; then one track per MIDI channel used.
 */
import { programChanges, Sequencer } from '../engine/sequencer';
import type { ItemId, Project } from '../engine/types';

export const SMF_DIVISION = 96;
const PER_CLOCK = SMF_DIVISION / 24;

export interface ExportOptions {
  /** play this item (default: the selected item) */
  item?: ItemId;
  /** number of passes of the item (ignored with arranger) */
  passes?: number;
  /** play the arranger once through instead */
  arranger?: boolean;
  /** safety limit in clocks */
  maxClocks?: number;
}

interface TimedMsg {
  clock: number;
  data: number[];
  order: number;
}

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function text(type: number, s: string): number[] {
  const b = Array.from(new TextEncoder().encode(s));
  return [0xff, type, ...vlq(b.length), ...b];
}

function chunk(id: string, body: number[]): number[] {
  const len = body.length;
  return [...id.split('').map((c) => c.charCodeAt(0)), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

function track(events: { tick: number; data: number[] }[], name?: string): number[] {
  const body: number[] = [];
  if (name) body.push(0, ...text(0x03, name));
  let last = 0;
  for (const e of events) {
    body.push(...vlq(Math.max(0, e.tick - last)), ...e.data);
    last = Math.max(last, e.tick);
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', body);
}

/** Render playback into timed MIDI messages, in clocks. */
export function renderPerformance(project: Project, opts: ExportOptions = {}): { msgs: TimedMsg[]; clocks: number } {
  const p: Project = structuredClone(project);
  if (opts.item) p.selected = opts.item;
  const seq = new Sequencer(() => p, (i) => {
    const preset = p.accPresets[i];
    if (preset) p.voices = p.voices.map((v, k) => (v.locked ? v : { ...preset[k] }));
  });
  seq.reset();
  const msgs: TimedMsg[] = [];
  let order = 0;
  if (p.options.sendProgramsAtStart) for (const m of programChanges(p.voices)) msgs.push({ clock: 0, data: m, order: order++ });
  const max = opts.maxClocks ?? 24 * 4 * 512;
  const passes = Math.max(1, opts.passes ?? 1);
  if (opts.arranger && p.arranger.steps.length) {
    p.options.arrangerLoop = false;
    seq.startArranger();
  }
  let clock = 0;
  for (; clock < max; clock++) {
    if (!opts.arranger && seq.pass >= passes - 1 && seq.pass >= 0 && clock >= seq.passStart + seq.passClocks) break;
    if (opts.arranger && !seq.arrangerPlaying && clock > 0) break;
    const r = seq.tick1();
    for (const e of r.events) {
      const data = e.kind === 'on' ? [0x90 | ((e.ch - 1) & 15), e.note, e.vel] : [0x80 | ((e.ch - 1) & 15), e.note, 0];
      msgs.push({ clock, data, order: order++ });
    }
  }
  for (const e of seq.silence()) msgs.push({ clock, data: [0x80 | ((e.ch - 1) & 15), e.note, 0], order: order++ });
  return { msgs, clocks: clock };
}

export function exportSmf(project: Project, opts: ExportOptions = {}): Uint8Array {
  const { msgs } = renderPerformance(project, opts);
  const byCh = new Map<number, { tick: number; data: number[]; order: number }[]>();
  for (const m of msgs) {
    const ch = m.data[0] & 15;
    if (!byCh.has(ch)) byCh.set(ch, []);
    byCh.get(ch)!.push({ tick: m.clock * PER_CLOCK, data: m.data, order: m.order });
  }
  const usPerQuarter = Math.round(60_000_000 / Math.max(20, Math.min(400, project.tempo)));
  const conductor = [
    { tick: 0, data: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] },
    { tick: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ];
  const tracks = [track(conductor, project.name || 'ANVIL')];
  for (const ch of [...byCh.keys()].sort((a, b) => a - b)) {
    // note-offs before note-ons at the same tick
    const evs = byCh.get(ch)!.sort((a, b) => a.tick - b.tick || ((a.data[0] & 0xf0) === 0x80 ? 0 : 1) - ((b.data[0] & 0xf0) === 0x80 ? 0 : 1) || a.order - b.order);
    tracks.push(track(evs, `ANVIL ch${ch + 1}`));
  }
  const header = chunk('MThd', [0, 1, 0, tracks.length, (SMF_DIVISION >> 8) & 255, SMF_DIVISION & 255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

/** Minimal reader for tests: returns per-track absolute-tick events. */
export function readSmf(bytes: Uint8Array): { format: number; division: number; tracks: { tick: number; data: number[] }[][] } {
  let i = 0;
  const u32 = () => ((bytes[i++] << 24) | (bytes[i++] << 16) | (bytes[i++] << 8) | bytes[i++]) >>> 0;
  const u16 = () => (bytes[i++] << 8) | bytes[i++];
  const id = () => String.fromCharCode(bytes[i++], bytes[i++], bytes[i++], bytes[i++]);
  if (id() !== 'MThd') throw new Error('not a MIDI file');
  u32();
  const format = u16();
  const ntrk = u16();
  const division = u16();
  const tracks: { tick: number; data: number[] }[][] = [];
  for (let t = 0; t < ntrk; t++) {
    if (id() !== 'MTrk') throw new Error('bad track');
    const end = u32() + i;
    const evs: { tick: number; data: number[] }[] = [];
    let tick = 0;
    let running = 0;
    while (i < end) {
      let d = 0;
      for (;;) {
        const b = bytes[i++];
        d = (d << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      tick += d;
      let st = bytes[i];
      if (st & 0x80) i++;
      else st = running;
      if (st === 0xff) {
        const type = bytes[i++];
        let len = 0;
        for (;;) {
          const b = bytes[i++];
          len = (len << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        evs.push({ tick, data: [0xff, type, ...bytes.slice(i, i + len)] });
        i += len;
      } else {
        running = st;
        const n = (st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 1 : 2;
        evs.push({ tick, data: [st, ...bytes.slice(i, i + n)] });
        i += n;
      }
    }
    tracks.push(evs);
  }
  return { format, division, tracks };
}
