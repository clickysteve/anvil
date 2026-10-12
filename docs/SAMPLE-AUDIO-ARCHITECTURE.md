# ANVIL audio: samples, processing and export

How ANVIL's internal audio works after the sample, processing and export work: what ANVIL had
before, what it uses from Slop Factory Core (`docs/SLOP-FACTORY-CORE.md`) and The Good Bits
(`docs/GOOD-BITS-DSP-INVENTORY.md`), and the ANVIL-specific parts. Everything described here
is implemented in this branch unless it is listed under "Not implemented".

## 1. ANVIL before this work

| Part | Where | Notes |
|---|---|---|
| Composition | `src/engine/` | Pure and seeded. 20 **items**: five themes TA-TE with three variation slots each. There is no "pattern" abstraction. |
| Voices | `project.voices` (always 6) | Voice 1 plays the theme; voices 2-6 derive from it (rhythm, divide, harmony, articulation). Voices have numbers, not names. |
| Drums | harmonies 12-16 (D1-D5) | Any of voices 2-6 can play from the project's **seven-entry drum table** (MIDI notes). |
| Sequencer | `src/engine/sequencer.ts` | Clock by clock (24 per quarter); pairs note-ons and note-offs by `channel:note`; events carry the voice. |
| Transport, clocks | `src/transport/` | Internal lookahead clock, or external MIDI clock (F8 authoritative). |
| Internal sound | `src/audio/preview.ts` (removed) | A listener on the MIDI byte stream: two oscillators per note, noise percussion on channel 10, keyed by `channel:note`, `volume x 0.4` master gain. It could not tell voices apart. |
| Export | `src/midi/smf.ts` | Standard MIDI File from a fresh sequencer on a clone of the project. |
| Persistence | `src/persistence/` | Versioned JSON (format 1), migrations and repair; localStorage autosave and library. |

**Determinism (as found).** `Sequencer.reset()` derives the performance seed from the project
seed, so every START plays the same performance, random harmony, negative Divide, Feel and
random drums included. This is what makes exports reproduce what the user hears.

## 2. Architecture now

```
                 Sequencer (unchanged algorithms; events now carry the drum-table index)
                         |
   live:  Transport ---> OutputRouter ---> MIDI port            (unchanged)
                 \-----> AudioSink: LiveAudio (src/audio/live.ts)
                                 |
                                 v
          Core Mixer + NotePlayer + instruments (AnvilSynth, SampleInstrument)
                    + output-processor AudioWorklet, in an AudioContext (44.1 kHz)

  export: freezePerformance() -> performanceTimeline() -> Core renderTimeline()
          (the same Mixer, NotePlayer, instruments and worklet, in an OfflineAudioContext)
```

| ANVIL file | Role |
|---|---|
| `src/engine/perform.ts` | `freezePerformance(project, range)`: runs a fresh sequencer on a clone, clock by clock, returning timed events with voice and drum index. Used by MIDI export and audio export. |
| `src/audio/anvilTimeline.ts` | Adapter to Core's event model: 24 PPQ, voices `v1`-`v6`, drum notes tagged `drum:0`-`drum:6`. |
| `src/audio/settings.ts` | The project's audio settings (format 2) and their repair. |
| `src/audio/synth.ts` | The old preview's sound, unchanged, as a Core `Instrument`. |
| `src/audio/routing.ts` | Which instrument plays a note (with synth fallback); voice strips. Shared by live and export. |
| `src/audio/library.ts` | Slot assignments to playable instruments: storage, decoding, transformations, buffers. |
| `src/audio/live.ts` | Live audio: the AudioContext, Core mixer and player, fed by the transport. |
| `src/audio/exportAudio.ts` | Export ranges, file names, rendering, WAV and ZIP. |
| `src/audio/bundle.ts` | Portable `.anvilpack` bundles. |
| `src/ui/sampleBank.ts`, `audioPanel.ts`, `exportWindow.ts`, `window.ts` | The interface. |

## 3. Voices, slots and sources

ANVIL has six voices and a seven-entry drum table, so the Sample Bank has **thirteen slots**:

| Slot | Plays | When |
|---|---|---|
| V1-V6 | the notes of voices 1-6 | the voice's SOURCE is SAMPLE and the note is melodic |
| D1-D7 | the notes of drum-table entries 1-7 | the voice's SOURCE is SAMPLE and the note came from a drum harmony |

These are not thirteen tracks: there are still six voices and six stems. Drum slots are
shared by every drum voice; each voice's drum sounds go through that voice's own processing
and stem.

* **Fallback.** A SAMPLE voice whose slot is empty, missing from storage, still loading or
  failed plays the internal synth instead. A slot's MUTE silences that slot (no fallback).
* **Note pairing.** Live, notes are keyed by `channel:note`, so a note-off or a retrigger
  ends the note that holds that key, as MIDI does. ONE SHOT notes ignore release (repeated
  drum hits overlap); different notes are polyphonic; each voice has at most 32 sample notes
  (the oldest is stolen).
* **Mix level.** The old preview applied `volume x 0.4` at one master gain. Each voice strip
  now applies the fixed 0.4 (the mix headroom, part of the sound and of exports) and the
  preview volume is a monitor gain after the master. With every processor CLEAN the product is
  the same.

## 4. Live audio

`LiveAudio` creates the AudioContext at 44.1 kHz where the browser allows (it resamples to the
device), so live processing runs at the export rate. The transport hands it every sequencer
event (voice and drum index included) beside the MIDI router, plus all-notes-off on
STOP/PAUSE/clock loss, panic, and START (processors restart their state then).

**Timing.** MIDI timestamps (performance.now() milliseconds) are mapped to the audio clock
with `getOutputTimestamp()` plus the context's reported latency. The original preview used
`ctx.currentTime`, which only advances once per audio callback; the audio verification (below)
showed that put up to ~15 ms of jitter on note spacing. The new mapping is smooth and stays
relative to the render position, so the first notes after START (scheduled 30 ms ahead) are
never late. Measured: live note spacing within 20 frames (0.45 ms) of the offline render.

## 5. Output processing

Core's output processor (Good Bits output stage, drive and crunch, plus gain and tone) runs in
an AudioWorklet on each voice and on the master. The AUDIO tab edits it; presets: CLEAN,
12-BIT, BITCRUSH, RATE REDUCE, DRIVE, CASSETTE, VINYL, AM RADIO. None is described as an
emulation of a particular machine. CLEAN and BYPASS are exact copies. Settings changes
crossfade over 256 samples. Without AudioWorklet (an insecure context), audio plays unprocessed
and the AUDIO tab says so.

**Core 0.2.0 fix.** A GATED or LOOP note's release now fades from its level at the note-off.
Before, a release scheduled ahead (always in exports, usually live) made Chromium ramp from the
note's start, so held samples faded out over their whole length.

## 6. Sample processing

Each slot can carry a **sample transformation** (Sample Bank, SAMPLE TRANSFORM): Good Bits
STRETCH FX with a stretch character (Good Bits' generic names), ratio, varispeed pitch,
reverse, drive, crunch and seed. The original sample stays in storage; the transformed audio
is computed in a Worker, cached per (sample, settings) and shared by live playback and export.

## 7. Export

* **Ranges** (ANVIL's own units): an **item** (a theme or a variation) for 1-64 passes, or the
  **arrangement** once through. There is no pattern range because ANVIL has no patterns.
* **What is rendered**: exactly what START (or PLAY ARRANGER) plays: `freezePerformance` uses
  the same sequencer and performance seed. Nothing is regenerated. Changes made by hand during
  a live performance are not captured.
* **Outputs**: master, stems (one per audible voice, or all six), or both; several files come
  as one ZIP. Names: `anvil_<project>_<range>_master.wav`, `..._voice-1-theme.wav`,
  `..._voice-3-drums.wav`; the project part is sanitised and at most 24 characters and is left
  out for "Untitled".
* **Format**: WAV, 44.1 kHz, 16-bit PCM, stereo (Good Bits' encoder: clamp, scale by 32767,
  round; no dither; no normalisation). The export window reports each file's peak and the
  number of clamped samples.
* **Alignment**: one multichannel offline render holds the master and every stem, so all start
  at frame 0 with the same length (music plus the shared tail).
* **Bake processing into stems** (default on): stems carry their voice's processing; master
  processing is applied to the master only. Summing the stems rebuilds the mix before master
  processing; a non-linear master processor cannot be rebuilt from stems. Off: stems are the
  unprocessed voice signals.
* Rendering never touches the live AudioContext, the transport, MIDI or the project (the
  export works on a clone and the tests compare the serialised project before and after).

## 8. Persistence

* **Project format 2** adds `audio`: voice sources and processors, the thirteen slots (sample
  id, file name, zone, transformation) and the master processor. A migration upgrades format 1
  projects with every voice on the synth, every processor CLEAN and every slot empty, so they
  sound exactly as before. Older ANVIL versions refuse format 2 files rather than guessing.
* **Samples** live in IndexedDB (`anvil-samples`), keyed by the SHA-256 of their bytes
  (identical files stored once). Project files carry only ids and names, never audio.
* **Portable bundles** (`.anvilpack`, Project tab: DOWNLOAD BUNDLE; OPEN FILE reads them): the
  project file plus each referenced sample once, hash-checked on import.
* **Missing samples** (a project opened without its bundle) show as MISSING in their slot and
  the voice plays the synth until the file is loaded again.
* PURGE UNUSED deletes stored samples that neither the open project, the autosave nor any
  named project in this browser refers to.

## 9. Internal audio vs external MIDI

ANVIL always sends MIDI. Internal audio is separate: the internal synth and samples, heard in
the browser and rendered by Export Audio. External MIDI instruments cannot be rendered by the
browser; record their audio separately.

## 10. Not implemented / known limitations

* No pattern range (ANVIL has no patterns); exports start from START or PLAY ARRANGER.
* No multi-sample instruments, no keyboard zones: one sample per slot. ANVIL assigns no choke
  groups (Slop Factory Core supports them since 0.2.0; ANVIL's voices have no use for them yet).
* Stem export files are stereo even for mono content.
* Chromium can move individual exported samples by one 16-bit step between renders of the
  same project (floating-point summation order); every note, level and position is identical.
* Renders over 20 minutes are refused.
* Tested in Chromium only.
