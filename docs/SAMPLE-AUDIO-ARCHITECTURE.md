# Sample engine, output processing and audio export: architecture

This document records what ANVIL's audio system was before this work, what The Good Bits
offers, and how the two are being joined.

**Status: design.** Nothing described in sections 3-8 is implemented yet except the frozen
performance (`src/engine/perform.ts`, section 3.3 step 1). The shared parts are being built as
**Slop Factory Core** (see `docs/SLOP-FACTORY-CORE.md` once it exists); this document will be
revised to describe what actually ships.

## 1. ANVIL as it was

### Composition and data model

| Part | Where | Notes |
|---|---|---|
| Composition engine | `src/engine/theme.ts`, `rhythm.ts`, `pitch.ts` | Pure, seeded; never calls `Math.random()` or reads the clock. |
| Themes and variations | `src/engine/types.ts` (`Theme`, `ItemId`) | 20 **items**: five themes TA-TE, each with three variation slots (VA1-VA3 ...). An item is a list of events in microbeats. There is **no "pattern" abstraction**. |
| Accompaniment | `src/engine/render.ts` | One *pass* of the playing item through six voices: rhythm 1-12, Divide, Harmony 1-16, articulation, velocity. |
| Drums | `render.ts` harmonies 12-16 (D1-D5) | A voice whose Harmony is D1-D5 plays notes from the project's **7-entry drum table** (`project.drums`, MIDI note numbers). Drums are not a separate voice: any of voices 2-6 can be a drum voice. |
| Internal synth | `src/audio/preview.ts` (`AudioPreview`) | A router listener: two oscillators + low-pass per note, noise percussion on MIDI channel 10, keyed by `channel:note`. Master gain `volume x 0.4`. |
| Voices | `project.voices` (always 6) | Voice 1 always plays the theme; voices 2-6 derive from it. Each has a MIDI channel (voices may share a channel), program, octave, velocity, accent, mute/solo, articulation, delay, rhythm, divide, harmony, tran. Voices have numbers, not names. |
| MIDI scheduling | `src/engine/sequencer.ts` | Clock-by-clock (24 per quarter). Pairs every note-on with its note-off by `channel:note`; a retrigger first ends the sounding note. Events carry the voice index. |
| Transport | `src/transport/transport.ts`, `clocks.ts` | START/PAUSE/CONTINUE/STOP, internal lookahead clock or external MIDI clock. |
| Tempo | `project.tempo` | One tempo per project (20-400 BPM). No tempo changes inside a performance. External clock follows the master. |
| Existing export | `src/midi/smf.ts` | Standard MIDI File, rendered by running a fresh `Sequencer` on a `structuredClone` of the project, clock by clock, with no real time. |
| Persistence | `src/persistence/format.ts`, `storage.ts` | Versioned JSON (`format: "anvil-project"`, version 1), migration table, repair with warnings. Autosave and a named library in `localStorage`. |
| Audio routing | `OutputRouter` listeners | Notes go to the MIDI port and to listeners (monitor, preview). The preview never sees the voice index. |
| Tests | `test/*.test.ts` (Vitest, 121), `e2e/anvil.spec.ts` (Playwright, 18) | Browser tests use production builds and a simulated Web MIDI device. |

**Voice count.** ANVIL has exactly **six musical voices** plus a **seven-entry drum table**
that any voice can play from. That, not the eight slots of the brief, is what the sample
bank maps to (section 4).

### Determinism (as found)

Generation seeds are stored on every theme. Playback randomness (random harmony, negative
Divide, Feel, random drums) draws from `deriveSeed(performanceSeed, passNumber)`, and
`Sequencer.reset()` sets `performanceSeed = deriveSeed(project.seed, 'performance')`.
Consequently **every START plays the same performance**, and the MIDI file export (a fresh
sequencer from the same project) already reproduces exactly what START plays. The audio
export reuses that property instead of inventing a second generator.

What START does not reproduce: changes made by the user during a performance (switching
item, recalling presets, moving tonality) shift later passes onto different pass numbers.
An export renders *what ANVIL plays from START with the chosen item selected*, or *one pass
through the arranger from PLAY ARRANGER*. That is the same thing ONCE and PLAY ARRANGER play.

## 2. The Good Bits (clickysteve/the-good-bits)

Inspected at commit `928353c` (MIT, same author as ANVIL). It is a static, offline sample
chopper: every processor works on whole `Float32Array` buffers at export time; there is no
live audio graph and no AudioWorklet.

| Module | What it is | Suitable for ANVIL? |
|---|---|---|
| `js/outputstage.js` `applyCrunch` | Bit-depth quantiser (1-16 bits, `round(x / step) * step`, step `2 / 2^bits`) and integer sample-and-hold rate divider (1-32). No anti-alias or reconstruction filter. | **Yes, real time.** Stateless per sample apart from the held value and a sample counter. |
| `js/outputstage.js` `applyDrive` | Saturation: tape (`tanh`), tube (biased `tanh`), diode (hard clip at +-1), fuzz. Wet amount and gain both follow the amount (0-100). | **Yes, real time.** Memoryless. |
| `js/outputstage.js` `applyOutputStage` | Ten "character" modes (Cassette, Reel-to-Reel, Damaged, Vinyl, Boombox, AM Radio, VHS Hi-Fi, Bus Comp, Lathe, Phone Bus) with Mix and Intensity. Each mode is a factory returning a per-sample `(L, R) => [L, R]` closure with its own filter, delay-line, envelope and seeded xorshift noise state. | **Yes, real time.** Although the public function is whole-buffer, every mode is a causal per-sample state machine and streams unchanged. |
| `js/outputstage.js` filter primitives | One-pole low/high-pass, RBJ peak and low shelf, envelope follower (private helpers). | The one-pole low-pass is reused as the 12-bit engine's tone filter. |
| `js/dsp/stretch/*` (WSOLA, phase vocoder, granular, PaulStretch, spectral freeze, repeat, cyclic, varispeed) | Time-stretch engines behind a character registry. `cyclic` lays fixed-length cycles end to end with linear crossfades; `repeat` repeats whole chunks; several characters add 12-bit (or lower) quantisation. | **Not as output effects** (they change duration, need the whole buffer and look ahead). **Yes as sample transformations**, via Good Bits' STRETCH FX chain. |
| `js/dsp/pitch-shift.js` | Offline FFT pitch shift built on the stretch engines. | No (offline, whole buffer). |
| `js/lab/dsp.js` | LAB's experimental primitive vocabulary for randomly generated effect graphs, plus `dcBlock` and `softLimit` safety utilities. | No for the vocabulary (designed for random exploration of offline buffers, several are whole-buffer spectral). `softLimit` is a stateless per-sample curve; ANVIL does not need it (see 6.4). |
| `js/flip`, `js/play-nice`, `js/stretch-fx` | Loop remixing, conforming and arrangement tools. | No (not processors). |

**Correction.** An earlier draft of this section said Good Bits had no sampler-style
processing because nothing was named after a hardware sampler. That was wrong: Good Bits
deliberately uses generic names, and its sampler-inspired processing lives mainly in the
time-stretch engines (`cyclic`, `repeat`, the `Vintage`, `'93`, `Cyclic 12-bit` and `Tape`
characters), the crunch stage and the varispeed pitch of the STRETCH FX chain. Those are
destructive sample transformations, not continuous output effects. A full inventory, by actual
DSP behaviour, is in `docs/GOOD-BITS-DSP-INVENTORY.md`. ANVIL keeps Good Bits' generic names
and makes no claim to emulate any specific machine.

## 3. Integration plan

```
                       Sequencer (unchanged algorithms; events gain a drum-table index)
                                  |
           live: Transport -> OutputRouter -> MIDI port (unchanged)
                     |
                     +-> AudioSink (LiveAudio)            export: freezePerformance()
                                  |                                   |
                                  v                                   v
                           AudioEngine on AudioContext      AudioEngine on OfflineAudioContext
                           (one class, one graph, one worklet, the same event semantics)
```

### 3.1 Shared code

* `src/audio/goodbits/outputstage.js`: Good Bits' `outputstage.js` **vendored verbatim**
  apart from added `export` keywords on its private factories and helpers (listed in the
  file header). The original whole-buffer functions remain and are used as the reference in
  tests.
* `src/audio/fx.ts`: the streaming wrapper. It calls the vendored factories and drive shapes
  directly; crunch is the same arithmetic as `applyCrunch` with a running sample counter.
  Tests assert that processing in 128-frame blocks is **bit-identical** to Good Bits'
  whole-buffer functions.
* `src/audio/fx-worklet.ts`: an `AudioWorkletProcessor` that only feeds blocks to `fx.ts`.
  The same module is loaded into the live `AudioContext` and the export
  `OfflineAudioContext`, so live playback, audition and export run the same code.
* `src/audio/engine.ts`: the graph and note handling for both contexts.

### 3.2 Real-time graph

```
per voice v (0-5):
  synth notes ----\
  sample notes ----> voiceIn[v] -> fx[v] (AudioWorklet) -> voiceOut[v] (x0.4 headroom) --+
                        \-> preTap[v] (x0.4)  (unprocessed stem tap, export only)         |
                                                                                         v
                                                  mix -> masterFx (AudioWorklet) -> masterOut
live:   masterOut -> monitor gain (preview volume) -> destination
export: voiceOut[v] / preTap[v] / masterOut -> ChannelMerger -> OfflineAudioContext destination
```

The old preview applied `volume x 0.4` once at the end. The new graph applies the fixed 0.4
per voice (it is the mix headroom, part of the sound) and the preview volume only to the
monitor. With every processor set to CLEAN the processors copy their input exactly, so the
live output equals the old preview's output (sections 6.1, 9).

The live `AudioContext` is created at 44.1 kHz when the browser allows it (it resamples to
the device), so live processing runs at the same rate as the export. If the browser refuses,
it runs at the device rate and the rate divider's effective rate (shown in Hz) differs.

### 3.3 Offline rendering

1. `freezePerformance(project, range)` (`src/engine/perform.ts`) runs a fresh `Sequencer` on
   a `structuredClone` of the project, clock by clock, exactly as the MIDI export does, and
   returns timed events `{clock, kind, voice, ch, note, vel, drum}` plus the total length in
   clocks. The MIDI file export now uses the same function.
2. Time is `clock x 60 / (tempo x 24)` seconds; the file starts at clock 0.
3. One `OfflineAudioContext` at 44 100 Hz renders the master and every requested stem as
   channels of one multichannel buffer (two per output, up to 14), so all outputs share one
   timeline by construction. Long renders that would exceed a memory budget are split into
   several renders of whole outputs; every render starts at frame 0 with the same events, so
   alignment is unchanged.
4. Events are scheduled in chunks at `suspend()` points, which also drive the progress bar
   and cancellation. Nothing touches the live context, the transport, the MIDI router or the
   project.

### 3.4 Live event path

The transport hands every sequencer event (with its voice index) to an `AudioSink` beside
the MIDI router; STOP, PAUSE, panic and clock loss call `allNotesOff`/`panic` on it. MIDI
output is unchanged. The internal synth keeps its old behaviour (it is the old preview code,
moved): waveform by MIDI channel, noise percussion on channel 10, note pairing by
`channel:note`.

## 4. Voice-to-sample mapping

| Slot | Plays | Used when |
|---|---|---|
| V1-V6 | the notes of voice 1-6 | that voice's SOURCE is SAMPLE and the note is melodic |
| D1-D7 | the notes of drum-table entry 1-7 | the voice's SOURCE is SAMPLE and the note came from a drum harmony (D1-D5) |

Thirteen slots, because ANVIL has six voices and a seven-entry drum table. Drum slots are
shared by all drum voices, but each voice's drum sounds go through that voice's own
processing and stem.

**Fallback.** A voice set to SAMPLE whose needed slot is empty, missing from storage or
failed to decode plays the internal synth instead, and the Sample Bank says so. A slot's
MUTE silences that slot's audio (it does not fall back).

**Note semantics.** The sequencer guarantees a note-off for every note-on by
`channel:note`. The engine mirrors that: it records which voice holds each `channel:note`,
and a note-off (or a retrigger) releases the holder. ONE SHOT notes ignore release, so
repeated drum hits overlap; GATED and LOOP notes release with the slot's release time;
different notes are fully polyphonic. A per-voice cap (32 sample notes) steals the oldest.

## 5. Sample playback

* Decoding: `decodeAudioData` on an `OfflineAudioContext` at 44.1 kHz, so the decoded data
  is the same for live and export. Validation: unsupported type, empty file, size limit
  (40 MB), duration limit (120 s), decode failure and silent/empty audio each give a
  specific message; failures never touch the running engine.
* Pitch: `playbackRate = 2^((note - root + tune + fine / 100) / 12)` (hardware-sampler
  style transposition; length changes with pitch).
* Velocity: amplitude `volume / 100 x (velocity / 127)^1.5`, the same curve as the synth.
* Pan: `StereoPannerNode` per slot. Stereo samples keep their two channels.
* ONE SHOT: plays START to END. GATED: plays until note-off, then a linear release
  (default 30 ms). LOOP: loops LOOP START-LOOP END while held, then releases. Short fades
  (2 ms) are applied only where a trimmed START or END would otherwise click.
* Loop points are validated (`START <= LOOP START < LOOP END <= END`, at least 1 ms) and can
  be snapped to rising zero crossings.

## 6. Processing

### 6.1 Engines

| Engine | Chain (Good Bits functions in **bold**) | Parameters |
|---|---|---|
| CLEAN | exact copy | none |
| 12-BIT (crunch preset) | input gain -> **drive** -> **crunch** -> **one-pole low-pass** -> output gain | bits (12), rate divide (2 = 22.05 kHz), drive type and amount, tone (Hz), in/out dB |
| BITCRUSH | input gain -> **crunch** -> output gain | bits, rate divide, in/out dB |
| DRIVE | input gain -> **drive** -> output gain | type, amount, in/out dB |
| CHARACTER | input gain -> **output stage** -> output gain | mode (10 Good Bits modes), mix, intensity, in/out dB |

Any processor can be **bypassed** (kept but inactive). Settings changes crossfade from the
old processor to the new one over 256 samples to avoid clicks.

### 6.2 Placement

Six per-voice processors and one master processor, all the same engine code.

### 6.3 Live/export parity

Bit-exact parity is proven where it is meaningful: the streaming processor equals Good Bits'
offline functions sample for sample, and the worklet is the same code in both contexts.
Two differences remain and are documented rather than hidden:

* **Note timing.** Live notes are placed by converting `performance.now()` to the audio
  clock (as the old preview did); export uses exact clock times. Live timing jitter is a few
  milliseconds.
* **Stateful processors.** CHARACTER modes with noise, wow or random pops, and the crunch
  rate divider's hold phase, depend on when the processor started. Live processors are
  reset at each START (at audio-block resolution); export processors start at the first
  frame. The algorithm and seed are the same; the sample-exact phase of noise can differ.

### 6.4 DSP quality notes

* **Clipping.** Crunch does not clip (it quantises). Diode drive clips at +-1 by design.
  The WAV encoder clamps to +-1 and the export reports peaks and clipped-sample counts per
  file. There is no automatic normalisation or limiting.
* **Aliasing.** Crunch's sample-and-hold has no anti-alias filter (as in Good Bits); the
  aliasing is the effect. The tone filter softens the steps afterwards.
* **Channels.** The graph is stereo throughout; mono sources are up-mixed (L = R).
* **Latency.** The worklets process in place: no added latency.
* **CPU.** CLEAN is a copy. CHARACTER modes allocate a small array per sample (Good Bits'
  closure interface); seven active CHARACTER processors are the most expensive case.
* **Determinism.** Offline rendering is deterministic: the same project, range and
  settings give the same samples (verified in the browser tests).

## 7. Persistence

* Project format **version 2** adds `audio`: voice sources, 13 slots (sample id, file
  name, root, tune, fine, volume, pan, mode, start/end, loop points, release, mute), six
  voice processors and the master processor. A migration upgrades version 1 files with
  defaults (every voice on the internal synth, every processor CLEAN), so old projects
  sound exactly as before.
* Sample audio lives in **IndexedDB** (`anvil-samples`), keyed by the SHA-256 of the file's
  bytes, so identical files are stored once. The project only references the id and name.
  The original file bytes are kept (not decoded PCM).
* **Portable bundle** (`.anvilpack`): a ZIP (stored, uncompressed) holding
  `manifest.json`, `project.anvil.json` and `samples/<sha256>.<ext>`. Each sample appears
  once however many slots use it; hashes are verified on import. Plain `.anvil.json`
  downloads never contain audio.
* Missing samples (a project opened on another computer without its bundle) are shown as
  MISSING in their slot; the voice falls back to the synth until the file is loaded again.

## 8. Export format

* WAV, RIFF/WAVE, PCM 16-bit little endian, 44 100 Hz, 2 channels, interleaved.
  Conversion: clamp to [-1, 1], scale by 32767, round. No dither (so silence stays exactly
  zero and output is deterministic) and no normalisation.
* Ranges: an **item** (any theme or variation, N passes) or the **arrangement** (one pass
  through the arranger). There is no pattern range because ANVIL has no patterns.
* Outputs: master, stems, or both. Stems: one per audible voice (or all six), named after
  the voice (`voice-1-theme`, `voice-4-drums` ...).
* Every file starts at frame 0 = clock 0, has the same length (performance + shared tail),
  the same rate and channel count; nothing is trimmed or normalised.
* **Bake processing into stems** (on by default): stems carry their per-voice processing;
  master processing is applied to the master file only. Summing the stems reconstructs the
  mix before master processing. Off: stems are the unprocessed voice signals.
* Several files are packed into one ZIP (stored). Names:
  `anvil_<project>_<range>_master.wav`, `anvil_<project>_<range>_voice-2.wav`; the project
  part is sanitised and at most 24 characters.

## 9. Known technical limitations

* External MIDI instruments cannot be rendered: the browser only renders ANVIL's internal
  synth and samples. Record hardware separately.
* Exports render from START (or PLAY ARRANGER). Changes made by hand during a live
  performance are not captured.
* Live note timing has a few milliseconds of jitter; export timing is exact.
* Noise phase of stateful CHARACTER modes can differ between live and export (6.3).
* No processor emulates a specific machine; names describe what the DSP does.
* Very long exports are limited to 20 minutes.
* AudioWorklet needs a secure context (https or localhost). Without it, audio plays
  unprocessed and processing controls say so.
* Unused samples stay in IndexedDB until PURGE UNUSED is pressed.
