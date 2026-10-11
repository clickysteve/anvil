# DOWNBEAT integration plan

How DOWNBEAT (<https://github.com/clickysteve/downbeat>, read at `07e31b0`) will adopt Slop
Factory Core. **Plan only: nothing in DOWNBEAT has been changed.** The goal is that sampling,
processing and stem export in DOWNBEAT take a fraction of the work they took in ANVIL, because
the hard parts (sample engine, processing, offline rendering, WAV/ZIP, storage, bundles) are
now in Core.

## 1. What DOWNBEAT has today

| Area | Where | What it is |
|---|---|---|
| Voices | `engine/types.ts` `Voice` | Up to 16 voices (tracks) with id, name, family (kick, snare, clap, hat, openhat, tom, perc, cymbal), MIDI channel, a **step list of notes or chords** (sound steps), program, internal sound (`VoiceSound`: one of 18 synthesised kinds, tune, decay, level), gate length, mute, solo. |
| Internal sounds | `audio/drums.ts` `DrumSynth` | Original Web Audio drum synthesis per kind; **closed hats choke ringing open hats**; a master `DynamicsCompressor` then a volume gain; `toCtxTime()` maps performance.now() to the audio clock with `getOutputTimestamp()` (the same approach ANVIL's live audio now uses). |
| Pattern representation | `engine/types.ts` `Pattern`, `Track`, `Strike` | Patterns of tracks of strikes (level 1-5 or random, sound step, flam, probability) with per-track loops, shifts, density, timing, velocity tools, fills, evolve, rules; songs of patterns with repeats; per-pattern tempo. The written source is never modified. |
| Generative events | `engine/realize.ts` `realize()` (pure, seeded), `engine/engine.ts` `Engine` | Each cycle is realised from the source into `PerfEvent`s: source strikes, flams, fills, extras, jams, echoes; suppressions recorded for the display. `NoteItem` carries tick (fractional in fine units, 4 per tick), duration, channel, **pitches** (chords), velocity, **voice** (the track) and **sound** (the voice whose sound plays it: fills can borrow another voice's sound). |
| Offline performance | `engine/engine.ts` `renderCycles(project, cycles)` | Plans N cycles from Start on a fresh Engine and returns notes, tempo changes and the end tick: the same performance Start plays. MIDI export already uses it. |
| Timing | `PPQ = 24` ticks per quarter, `FINE = 4` fine units per tick | Swing, humanise, shifts and flams in fine units (1/96 quarter). |
| MIDI scheduling | `scheduler/scheduler.ts` | Worker-ticked lookahead scheduler, internal or external clock (F8 = engine tick, FA/FB/FC, F2 Song Position), clock out. |
| MIDI | `midi/webmidi.ts`, `midi/output.ts`, `midi/messages.ts`, `midi/smf.ts` | Access with hot-plug, note-safe output, message helpers, SMF types 0/1 read and write. |
| Export | `App.exportMidi('pattern' \| 'performance' \| 'song' \| 'take')` | MIDI files only. No audio export. |
| Persistence | `persistence/format.ts` | `{ format: 'downbeat-project', version: 1, savedAt, project }`, migrations, validation; browser storage in `persistence/storage.ts`. |
| Existing DSP | `audio/drums.ts` | Synthesis and a master compressor; no sample playback, no output processing. |

## 2. How each Core part maps

### Events (adapter, ~60 lines)

```ts
// downbeat/src/audio/coreTimeline.ts (new)
const PPQ_FINE = 96;                       // DOWNBEAT's fine resolution: ticks x 4 are integers
function downbeatTimeline(project, cycles): Timeline {
  const { notes, tempos, endTick } = renderCycles(project, cycles);
  return {
    tempo: { ppq: 96, changes: tempoChanges(tempos) },    // per-pattern tempo becomes tempo segments
    length: Math.round(endTick * 4),
    voices: project.voices.map((v) => ({ id: v.id, name: v.name })),
    events: sortEvents(notes.flatMap((n) => n.pitches.map((pitch) => ({
      type: 'note', tick: Math.round(n.tick * 4), duration: Math.max(1, Math.round(n.duration * 4)),
      voice: n.voice, pitch, velocity: n.velocity, channel: n.channel,
      instrument: n.sound !== n.voice ? `sound:${n.sound}` : undefined,   // a fill borrowing another voice's sound
    })))),
  };
}
```

A fill that borrows another voice's sound stays in its own track's stem (voice = track) while
playing the other voice's instrument (instrument key), which Core already supports. Chords
become one note per pitch. Exact determinism comes from `renderCycles`, which DOWNBEAT already
trusts for MIDI export.

### Sample engine and voice mapping

* One `SampleInstrument` per voice (DOWNBEAT voices are drum lanes; a lane is one sound), with
  `mode: 'oneshot'` by default and `root` = the voice's base note, so the voice's **step list of
  notes** transposes the sample chromatically (tom runs, pitched percussion).
* Per-voice source: internal synth or sample, with fallback to the synth when the sample is
  missing (as in ANVIL).
* The existing `DrumSynth` becomes a Core `Instrument` (its `play()` already takes a time and
  a voice). Its master compressor is a nonlinear master stage: keep it as DOWNBEAT's own
  master insert after Core's master processing, or offer Core's Bus Comp output stage instead.
  The stem/master caveat (nonlinear master not reconstructible from stems) applies either way.
* **Choke groups** are the one missing Core feature: closed hat chokes open hat. Add to Core
  (Tier 3): an optional `chokeGroup` on the zone (or on the voice) and a `NotePlayer` rule
  that stops sounding notes of the same group with a short fade when a new one starts.

### Sample processing and output processing

Unchanged Core features: per-voice `SampleTransform` (Good Bits stretch characters, varispeed,
crunch: breakbeat-friendly), per-voice and master `OutputFxSettings` (Crunch for 12-bit drums,
Drive, the output-stage characters). The Sample Bank window, Output Engine controls and export
window from ANVIL can be ported almost directly (they are DOM code over plain settings).

### Audio routing

`Mixer` with one strip per DOWNBEAT voice (up to 16), strip gain = the voice's level, mute and
solo mapped to DOWNBEAT's voice mute/solo (Core's mixer implements both), master gain = the
volume preference. DOWNBEAT's scheduler calls a live sink exactly as ANVIL's transport does:
`noteOn(key, voice, { time, pitch, velocity, instrument })` with `toCtxTime(ms)`.

### WAV and stem export

`renderTimeline({ timeline: downbeatTimeline(project, cycles), master, stems: voices.map(...), ... })`
gives a master and **one stem per drum voice**, sample-aligned, with a shared tail, then
`encodeWav16` and `createZip`. Ranges map to what DOWNBEAT already exports as MIDI: current
pattern (N cycles), performance, song, take (a take is already a list of `NoteItem`s).

### Storage and bundles

`IndexedDbSampleStore('downbeat-samples')`, a `samples` / `audio` section in the project with
a version 1 to 2 migration (all voices on the internal synth, processors CLEAN, so old
projects sound the same), `writeBundle('DOWNBEAT', ...)` for portable `.downbeatpack` files.

### MIDI utilities

DOWNBEAT and Feelers share almost the same MIDI access, note-safe output and scheduler; they
are the natural source for Core's MIDI modules (see `docs/MIDI-FOUNDATION.md`). DOWNBEAT should
adopt those only when they exist in Core; its current MIDI code stays as it is.

## 3. Steps (each one shippable)

1. Depend on `@slopfactory/core` (after the repository exists; see `docs/SLOP-FACTORY-CORE.md`).
2. Add the timeline adapter and a unit test that `downbeatTimeline` equals `renderCycles`
   note for note (as ANVIL's test does for `freezePerformance`).
3. Wrap `DrumSynth` as an `Instrument`; route live notes through `Mixer` + `NotePlayer` with
   every voice on the synth and every processor CLEAN; verify the sound is unchanged (the
   compressor stays where it is).
4. Add choke groups to Core, with tests; use them for hats.
5. Add project format 2 (`audio` section) and the IndexedDB store.
6. Port the Sample Bank window (16 voice rows, no drum-table rows) and the Output Engine tab.
7. Port the Export Audio window: pattern / performance / song / take, master and drum stems.
8. Browser tests modelled on ANVIL's `e2e/audio.spec.ts` and `e2e/audio-verify.spec.ts`.

## 4. Risks and decisions for the owner

* **Choke groups** need a small Core addition before DOWNBEAT's hats sound right with samples.
* **The master compressor**: keep DOWNBEAT's own (familiar sound, but an extra nonlinear stage
  after Core's master processing) or replace it with Good Bits' Bus Comp.
* **Fractional ticks**: DOWNBEAT's fine units make every position an integer at 96 PPQ; any
  future sub-fine timing would need a higher Core PPQ (the model allows any).
* **Up to 16 stems**: one render holds 16 stereo outputs (32 channels) only without the
  master; Core already splits whole outputs across renders when needed.
