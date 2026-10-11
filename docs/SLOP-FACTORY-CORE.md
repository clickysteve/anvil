# Slop Factory Core

Shared audio, sampling, processing, rendering, export and storage for browser music
applications. Infrastructure, not an application: the applications provide the musical ideas;
Core provides the plumbing.

**Status (this branch).** Core lives in ANVIL's repository at `src/core/`, as one package with
separate modules. ANVIL is its first (and so far only) user. **No code is shared across
repositories yet**: nothing has been published and no other application imports it. The
extraction plan is in section 6.

## 1. What is implemented

| Module | Path | What it provides |
|---|---|---|
| events | `src/core/events/timeline.ts` | The common musical event model: integer ticks at an application-chosen PPQ, tempo maps (piecewise, drift-free conversion to seconds and sample frames), notes with durations, voice ids, optional instrument keys, controller events, canonical ordering, validation, and a MIDI-style on/off pairer. |
| audio | `src/core/audio/` | The `Instrument` interface; `Mixer` (voice input, voice processing, gain, pan, mute/solo, master bus, master processing, master gain, processed and dry stem taps); `NotePlayer` (keyed note-on/off with retrigger semantics, per-voice polyphony, application-resolved instruments). Works on any `BaseAudioContext`. |
| sampler | `src/core/sampler/` | Sample zones (root, tune, fine, volume, pan, ONE SHOT / GATED / LOOP, start/end, loop points, release, velocity sensitivity, mute), the polyphonic `SampleInstrument` (playback-rate transposition of one shared AudioBuffer), decoding and validation (`decodeSample`), zero-crossing snapping and waveform peaks. |
| dsp/output | `src/core/dsp/output/` | **Output processing**: Good Bits' lo-fi chain (output stage, drive, crunch) plus gain and tone, streamed block by block; the AudioWorklet that runs it live and offline; presets; settings repair. |
| dsp/transform | `src/core/dsp/transform/` | **Sample processing**: non-destructive transformation recipes rendered by Good Bits' STRETCH FX chain (stretch characters, varispeed pitch, reverse, drive, crunch); a cache; a Worker runner. |
| dsp/vendor | `src/core/dsp/vendor/goodbits/` | Good Bits' DSP files, verbatim, with `vendor.json` (commit and hashes). See `docs/GOOD-BITS-DSP-INVENTORY.md`. |
| render | `src/core/render/offline.ts` | Offline rendering of a Timeline to a master and isolated, sample-aligned stems through the same graph as live playback, with progress and cancellation. |
| export | `src/core/export/` | 16-bit WAV (Good Bits' encoder), level statistics, WAV header reading, a dependency-free ZIP writer/reader, file-name sanitising. |
| storage | `src/core/storage/` | Content-addressed sample storage (SHA-256) in IndexedDB or memory, quota and availability errors, portable project bundles. |
| midi | `src/core/midi/interfaces.ts` | **Interfaces only** (Tier 2 design). See `docs/MIDI-FOUNDATION.md`. |

Everything is exported from `src/core/index.ts`. Examples a new application can follow are in
`src/core/examples/newApp.ts` (type-checked, partly run by the tests).

### Rules that keep Core reusable

* Core imports nothing outside `src/core` (enforced by `test/core/boundary.test.ts`), and its
  code names no application.
* Core never decides what a voice means. Applications give voice ids and names, and a
  `resolve(voice, note)` function that picks the instrument for each note.
* Core does not own project files. Applications store Core's settings objects (zones,
  transformations, processor settings: plain JSON with `repair*` functions) inside their own
  formats and migrations.
* Core makes no network requests and needs no server.

## 2. Public interfaces in brief

### Events

```ts
interface Timeline {
  tempo: TempoMap;            // { ppq, changes: [{ tick, bpm }] }
  length: Tick;               // end of the music
  voices: VoiceInfo[];        // [{ id, name }]
  events: MusicEvent[];       // NoteEvent | ControlEvent, sorted with sortEvents()
  meta?: Record<string, string | number | boolean>;
}
interface NoteEvent { type: 'note'; tick; duration; voice; pitch; velocity; channel?; instrument? }
```

* **Timing.** Integer ticks are the canonical time: exact, comparable, and free of
  accumulated error. `TimeMap.seconds(tick)` and `TimeMap.frame(tick, rate)` compute each
  position from its own tick and tempo segment (segment start times are summed once from
  exact tick differences), so a note a million ticks in is placed exactly where a direct
  calculation puts it. Tempo changes are segments of the map. Applications choose the
  resolution: ANVIL uses 24 PPQ (MIDI clocks), DOWNBEAT would use 96 (its fine units).
* **Durations, not note-offs.** Renderers schedule notes with known lengths. Applications
  that think in MIDI note-on/note-off use `NotePairer`, which applies MIDI pairing semantics
  (a retrigger ends the sounding note).
* **Instrument keys.** `instrument` routes one note to a different sound than its voice's
  default while it stays in its voice's stem (ANVIL's drum-table notes; DOWNBEAT's fills that
  borrow another voice's sound).
* **Determinism.** A timeline is plain data. Freezing an application's generated performance
  into one, then rendering it, never regenerates anything.

### Audio

```ts
interface Instrument { start(ctx: BaseAudioContext, out: AudioNode, note: NoteRequest): NoteHandle | null }
interface NoteHandle { release(time): void; stop(time): void; readonly end: number }
new Mixer(ctx, { voices, strips?, masterFx?, masterGain?, fxAvailable, seed?, dryTaps? })
new NotePlayer(ctx, mixer, resolve, { maxPerVoice })   // noteOn(key, voice, note), noteOff(key, t)
```

Signal flow: instrument, per-voice processing, voice gain and pan, mute/solo gate, master bus,
master processing, master gain, output. The same objects run in an `AudioContext` and in an
`OfflineAudioContext`.

### Sample processing vs output processing

| | Sample processing (`dsp/transform`) | Output processing (`dsp/output`) |
|---|---|---|
| Acts on | the sample's audio, once | the audio stream, continuously |
| Algorithms | Good Bits STRETCH FX: stretch characters (WSOLA, cyclic, repeat, granular, phase vocoder, spectral freeze, PaulStretch, varispeed), varispeed pitch, reverse, drive, crunch | Good Bits output stage (10 modes), drive, crunch; gain; one-pole tone |
| When | before playback, in a Worker, cached per (sample, settings) | live in an AudioWorklet, and identically in offline rendering |
| Stored as | a `SampleTransform` beside the original sample | an `OutputFxSettings` per voice and for the master |
| Changes duration | can | never |

Destructive, whole-buffer algorithms (time-stretch) are never forced into the real-time graph.

### Rendering and export

```ts
renderTimeline({ timeline, tailSeconds, master, stems: [{ voice, processed }], strips, masterFx,
                 resolve, fxModuleUrl, onProgress, signal }) -> { outputs, frames, sampleRate, ... }
encodeWav16(channels, rate) ; createZip(entries) ; readZip(bytes)
```

Every output of a render starts at frame 0 (= tick 0), has the same length (music plus the
shared tail) and rate. Stems contain only their voice. With `processed: true` a stem includes
its voice's processing; master processing only ever reaches the master output. Nothing is
trimmed or normalised; level statistics report peaks and clamped samples.

A non-linear master processor (saturation, crunch, a compressor) applied to the full mix
cannot be reproduced by processing each stem and summing them: the sum of the stems is the
mix *before* master processing.

### Storage

```ts
interface SampleStore { put; get; has; delete; list }          // IndexedDbSampleStore, MemorySampleStore
sampleFromBytes(bytes, name)   // id = SHA-256 of the bytes: identical files stored once
writeBundle(app, { name, text }, samples) ; readBundle(bytes, app)
```

Bundles are ZIPs of `manifest.json`, the application's project file and each sample once;
hashes are checked on import and problems are reported without blocking the project.

## 3. Repository strategy

Options considered:

| | A. Dedicated shared repository, versioned package | B. Monorepo of all applications | C. Package published to a registry, consumed by separate repositories |
|---|---|---|---|
| GitHub Pages / static builds | each app bundles Core into its own static build | one repository, several sites to deploy | as A |
| Versioning | git tags; each app pins a version | everything moves together | registry versions |
| Dependency updates | explicit bump per app | instant, and instantly breaking | explicit bump per app |
| Development | link locally (`npm link` or a `file:` path) while changing Core | easiest cross-cutting changes | as A, plus publishing |
| Provenance and licensing | one MIT repository, Good Bits vendor manifest kept | mixes every app's history and provenance audits | as A |
| Cost to existing apps | small: add a dependency | large: migrate five repositories | small, plus registry account and publishing |

**Recommendation: A, a dedicated repository with a versioned package**, matching the owner's
preference: `clickysteve/slopfactory-core` (name to be confirmed; note that
`clickysteve/slopfactory` already exists and is the catalogue web site, which this must not be
confused with), containing **one package**, `@slopfactory/core`, with subpath exports per module
(`@slopfactory/core/events`, `/audio`, `/sampler`, `/dsp`, `/render`, `/export`, `/storage`,
`/midi`). One package is enough: the modules are small, versioned together and tested
together, and subpath exports keep imports narrow so bundlers drop what an app does not use.

Distribution, smallest first: applications depend on a **git tag**
(`"@slopfactory/core": "github:clickysteve/slopfactory-core#v0.1.0"`), which npm installs and
Vite bundles into each app's static build; nothing is fetched at run time. Publishing to npm or
GitHub Packages can come later without changing imports. The package ships TypeScript source
(all apps use Vite and TypeScript, so they compile it) or prebuilt ES modules with `.d.ts`
files; source is simpler and keeps the AudioWorklet and Worker entry points bundleable by each
app (`?worker&url` / `?worker` imports need source files).

Creating the repository and publishing anything need the owner's approval. Neither has been
done.

## 4. Browser and platform requirements

* Web Audio with `OfflineAudioContext`; AudioWorklet for output processing (secure context:
  https or localhost). Without AudioWorklet, audio plays and renders unprocessed and Core
  reports it (`Mixer.processing`, `RenderResult.processed`).
* IndexedDB and Web Crypto (`crypto.subtle`) for sample storage; without them, storage
  reports `StorageError('unavailable')` and applications keep working without persistence.
* Tested in Chromium (Playwright). Firefox and Safari support the same APIs but have not been
  tested in this branch.

## 5. Determinism

* Musical determinism belongs to the application: it freezes its performance into a Timeline
  (ANVIL's `freezePerformance` reproduces START exactly).
* Core adds no randomness except the seeded noise of some output-stage modes (fixed seeds per
  strip) and seeded stretch engines (seed stored in the transformation).
* Offline renders of the same Timeline and settings are identical in every note, level and
  position. Chromium sums a node's several inputs in an order that can vary between renders,
  so floating-point rounding can move individual samples by up to one 16-bit step; the
  browser tests assert exactly that bound.

## 6. Extraction strategy

1. **Now (this branch):** Core is developed in `src/core/` under the boundary rule. ANVIL
   imports it through relative paths.
2. **Create the repository** (with approval): copy `src/core/` (including
   `dsp/vendor/goodbits` with `vendor.json` and its licence), `test/core/` (and
   `test/core/fakeAudio.ts`), and the browser tests that exercise Core directly; add a
   `package.json` with subpath exports, `tsconfig`, Vitest and Playwright. Tag `v0.1.0`.
3. **Switch ANVIL** to the package: replace `../core/...` imports with `@slopfactory/core/...`
   (mechanical), keep ANVIL's adapters (`src/audio/`) in ANVIL, delete `src/core/`.
4. **DOWNBEAT** adopts the package second (`docs/DOWNBEAT-INTEGRATION-PLAN.md`).
5. **Good Bits**: with approval, upstream the one-line export addition to `outputstage.js`,
   then have Good Bits import the shared DSP from the package so there is one copy (see the
   inventory, section 10).
6. **Later apps** (emmm, Feelers, FrakMC) adopt the modules they need; the MIDI foundation
   moves from interfaces to implementation as described in `docs/MIDI-FOUNDATION.md`.

## 7. Licensing and provenance

Core is MIT, like ANVIL and The Good Bits (all three by the same author). Vendored Good Bits
files keep their upstream bytes; `vendor.json` records the commit and per-file SHA-256, and a
unit test fails if a vendored file drifts. Good Bits' runtime CDN dependencies (essentia.js,
AGPL-3.0; JSZip) are **not** used by Core. Dev-only dependency added: `fake-indexeddb`
(Apache-2.0) for IndexedDB unit tests.

## 8. Known limitations

* No choke groups, no multi-sample zones (one sample per instrument), no sample-start
  modulation: DOWNBEAT will need choke groups (planned).
* Output processing is not oversampled; crunch aliasing is intentional, drive aliasing is not
  filtered.
* Output-stage modes allocate per sample (Good Bits' closure interface); many simultaneous
  character processors cost CPU.
* Sample-transformation output is capped at 24 s (Good Bits STRETCH FX limit).
* Renders longer than 20 minutes are refused; very long renders are split into several
  OfflineAudioContext renders of whole outputs.
* External MIDI instruments cannot be rendered by the browser.
