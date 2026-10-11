# The Good Bits: DSP inventory

An inventory of the audio-processing code in **The Good Bits**
(<https://github.com/clickysteve/the-good-bits>, commit `928353c`, MIT, same author as
ANVIL), written from reading the implementations, not their names. It records what each
algorithm does, whether it can run continuously (output processing) or only over a whole
buffer (sample processing), and how Slop Factory Core reuses it.

Good Bits uses **generic names on purpose**. They are kept exactly. Nothing here is described
as an emulation of a particular machine: where an algorithm resembles a classic sampler
workflow, this document says what the arithmetic does and leaves it there. (Some upstream
source comments and description strings mention hardware; they are vendored unchanged as
part of the code, but ANVIL's interface shows only Good Bits' generic labels and ANVIL's own
behavioural descriptions.)

## Terms used below

* **Streamable / real time**: causal, bounded state, no look-ahead; can process audio block by
  block as it plays (an AudioWorklet) and give the same result as one pass over the buffer.
* **Whole buffer**: needs the complete input (looks ahead, changes duration, or plans globally).
  Usable for per-sample preprocessing and offline work, not as a live output effect.
* **Deterministic**: same input and settings give the same output. Where an algorithm uses
  randomness it takes an explicit seed (Good Bits never calls `Math.random()` in the DSP files
  listed here; only UI helpers in `workspace-state.js` default to it).

Good Bits' whole test suite (`node --test`) passed on commit `928353c` when this inventory was
made; the per-file test counts below are the upstream tests that cover each module.

## 1. Output-stage processing (`js/outputstage.js`)

Pure functions over `Float32Array[]`, no DOM or Web Audio. Upstream runs them at export time
over whole regions; internally every stage is a per-sample state machine. Upstream tests:
`test/outputstage.test.mjs` (26 checks).

| Name | Actual behaviour | Parameters | Deterministic | Real time | Offline / preprocessing | Reuse |
|---|---|---|---|---|---|---|
| **Crunch** (`applyCrunch`) | Bit-depth quantiser `round(x / step) * step`, step `2 / 2^bits`, then integer sample-and-hold: every `rateDivide`-th input sample is held for `rateDivide` samples. No anti-alias or reconstruction filter (aliasing is intended). Never clips (values above 1 stay above 1). | `bits` 1-16 (16 = off), `rateDivide` 1-32 (1 = off) | yes | **yes** (state: held value, sample counter) | yes | Output processing (streamed, bit-identical), sample processing (inside STRETCH FX) |
| **Drive** (`applyDrive`, `driveShapeFor`) | Memoryless saturation, `out = (1-d) x + d shape(x, 1 + 5d, d)`. Shapes: Tape `tanh(gx)`; Tube biased `tanh` with DC removed; Diode hard clip at +-1; Fuzz `tanh(3gx)` for positive, hard clip for negative. | `type` tape/tube/diode/fuzz, `amountPct` 0-100 | yes | **yes** (stateless) | yes | Output processing (streamed), sample processing |
| **Output stage** (`applyOutputStage`, `MODE_FACTORIES`) | Ten character modes, each a factory returning a per-sample stereo closure with its own filters, delay lines, envelope followers and seeded xorshift32 noise. Cassette (wow/flutter delay mix, 60 Hz HP, 9 kHz LP, hiss, soft saturation); Reel-to-Reel (slow wow, 80 Hz shelf, 14 kHz LP); Damaged (deep wow, AGC ducking, hiss, random dropouts); Vinyl (wobble, 8 kHz tilt, 30 Hz HP, surface noise, random pops); Boombox (150 Hz-8 kHz band, 1.2 kHz peak, partial mono); AM Radio (300 Hz-4 kHz, crossover kink, mostly mono, programme-ducked hiss bursts); VHS Hi-Fi (50 Hz-12 kHz, AGC pumping, ticks); Bus Comp (envelope compressor, no noise); Lathe (8 kHz boost, 15 kHz LP, saturation, rare sample holds); Phone Bus (400 Hz-3.4 kHz, coarse mu-law quantiser, mostly mono). Intensity scales the wet difference, Mix blends. | `mode`, `mixPct`, `intensityPct`, `seed` | yes, given the seed (without one, upstream derives it from the buffer length) | **yes** (bounded per-mode state) | yes | Output processing (streamed, bit-identical with the same seed) |
| **Lo-fi chain** (`applyLofiChain`) | Output stage, then drive, then crunch, each only if enabled. | `{outputStage, drive, crunch}` settings objects, seed | yes | **yes** (all three stream) | yes | The shape of Core's output-processor settings; streamed in the same order |
| Filter helpers (`makeOnePoleLP/HP`, `makeBiquadPeak`, `makeBiquadLowShelf`, `makeEnvFollower`, `makeShortDelay`) | Textbook one-pole and RBJ biquad filters, peak envelope follower, short fractional delay line. Private helpers used by the modes. | cutoff, Q, gain | yes | yes | yes | `makeOnePoleLP` is reused as the output processor's optional Tone stage |
| `deriveRegionSeed` | Per-region seed from a batch seed. | | yes | n/a | n/a | Not needed (Core passes explicit seeds) |

**Limitations.** No oversampling or anti-alias filtering anywhere (crunch aliasing and
diode/fuzz harmonics fold back). Gain staging is relative to full scale 1.0. Output-stage
modes allocate a two-element array per sample (the closure interface); fine for a few
streams, measurable with many.

## 2. Time-stretch engines (`js/dsp/stretch/`)

All engines map `(channels, sampleRate, ratio, params, seed?) -> channels`, with
`ratio = output length / input length`. They decide grain or frame placement once from a
mono reference and apply it to every channel, so stereo stays locked. The dispatcher
`stretchChannels()` (`index.js`) resolves a **character** to an engine and parameters, clamps
the ratio (0.05 to 1000, output at most 600 s), and scrubs non-finite samples and runaway
gain (clamped to +-4). All are **whole buffer**: they change duration and read ahead, so
they cannot be live output effects. All are deterministic (seeded where random). Upstream
tests: `test/dsp-stretch.test.mjs` (31), `test/timestretch.test.mjs` (13).

| Engine (file) | Actual behaviour | Characters using it (Good Bits names) | Parameters |
|---|---|---|---|
| `wsola` (`wsola.js`) | Waveform-similarity overlap-add: Hann-windowed grains at a fixed synthesis hop; each grain's read position is derived from its output position (no drift) and nudged within a search radius to the most similar splice point. Optional bit quantisation (`quantizeInPlace`, same quantiser as Crunch) after stretching. | Clean, Tight; Vintage (12-bit), Loose, Choppy, Glitch (8-bit), Warped, Crushed (6-bit) | `windowMs`, `searchMs`, `hopFraction`, `bitDepth` |
| `repeat` (`repeat.js`) | Walks the source in fixed chunks and plays each chunk a whole number of times (0 allowed, so it also compresses), chosen by an error-diffusion accumulator; short linear crossfades at joins; optional random +-1 wobble of the repeat count. Repeating a chunk of length L adds a buzz at `sampleRate / L`. | Stutter; '93 (8-bit, jittered) | `chunkMs`, `crossfadeMs`, `bitDepth`, `repeatJitter`, seed |
| `cyclic` (`cyclic.js`) | Fixed-length cycles laid end to end with trapezoid (linear) crossfades that sum to unity; the read point follows the output clock at `1/ratio`, with no splice search, so cycles start out of phase. Produces a doubled, phasey texture with a buzz at the cycle rate. | Cyclic; Cyclic 12-bit (shorter cycles, harder joins, 12-bit) | `cycleMs`, `crossfade` (0-0.5), `bitDepth` |
| `granular` (`granular.js`) | Overlapping windowed grains with per-grain jitter of source position, output time and pitch (resampled grain), random reversal and dropout; overlap-add normalised by window weight. | Grain, Scatter, Flutter, Shred, Cloud, Nervous, Broken; Destroyed (5-bit) | `grainMs`, `hopFraction`, jitters, `reverseProb`, `dropoutProb`, `envelope`, `bitDepth`, seed |
| `phaseVocoder` (`phase-vocoder.js`, `stft.js`, `fft.js`) | STFT analysis/resynthesis with true-frequency phase propagation; optional identity phase locking around spectral peaks, transient detection (spectral flux) with phase reset, and deliberate phase randomisation. Hop planning caps the synthesis hop at half a frame for large ratios. | Transient, Punch (phase-locked, transient reset); Phase, Underwater, Metallic, Glass | `fftMs`, `overlap`, `phaseLocking`, `phaseRandomize`, `transientReset`, `transientSensitivity`, seed |
| `spectralFreeze` (`spectral-freeze.js`) | Captures spectral snapshots across the source, holds each (magnitude and instantaneous frequency) and crossfades to the next while the phase accumulator keeps running. | Frozen, Drone | `fftMs`, `overlap`, `holdMs` |
| `paulstretch` (`paulstretch.js`) | Very large windows, heavy overlap, fully randomised per-bin phase every frame, optional magnitude smoothing and frame blending. Destroys transients by design. | Spectral, Infinite | `windowMs`, `overlap`, `smear`, seed |
| `varispeed` (`varispeed.js`) | Linear-interpolation resampling (`dsp.js resampleLinear`): duration and pitch change together. | Tape | none |

Macro controls (`characters.js`): Roughness (old-digital family: window, bit depth, search,
chunk), Cycle length and Crossfade (cyclic), Grain size and Variation (granular), Smear
(spectral). Each is 0-100 with 50 = the character's own settings.

**Reuse:** as sample transformations, through STRETCH FX (section 3). **Limitations:** CPU
cost grows with length and ratio (the spectral engines most); linear-interpolation resampling
in varispeed and granular pitch jitter is not band-limited.

## 3. STRETCH FX chain (`js/stretch-fx/render.js`, `renderFx`)

A pure, synchronous recipe renderer: short fades on the source edges (0.6 ms in, 6 ms out),
optional reverse (before or after stretching), varispeed pitch in semitones
(`resampleLinear`, so pitching down lengthens), one or two passes through `stretchChannels`
(any character, seeded `seed + i x 7919`), optional Drive, optional Crunch, non-finite scrub,
then a **level match** back to the source's own peak (target clamped to 0.3-0.92, gain at
most 8x) and final edge fades (0.7 ms / 14 ms, swapped for a post-reverse). Output length is
capped at 24 s. Deterministic for a given recipe and seed. Upstream tests:
`test/stretch-fx.test.mjs` (29).

| Suitable for real time | Offline | Per-sample preprocessing | Offline export |
|---|---|---|---|
| no (whole buffer) | yes | **yes**: this is Core's sample-transformation engine | yes (the transformed sample is what plays) |

**Reuse:** Core's `applyTransform()` calls `renderFx` unchanged with a recipe built from the
stored transformation settings. The recipe *generator* (`recipe.js`, random archetypes and
"melt") is not reused: ANVIL lets the user choose the recipe directly.

**Limitations:** the level match changes the sample's level by design (a quiet source is
brought up to at least 0.3 peak); the 24 s cap limits long stretches; edge fades are tuned
for drum fragments.

## 4. Pitch shifting (`js/dsp/pitch-shift.js`)

`pitchShiftChannels`: stretch by the pitch factor (default character Transient), then
`resampleLinear` by its inverse and pin the length: pitch changes, duration does not. Limited
to +-24 semitones. Deterministic. Whole buffer. Upstream tests: `test/pitch-shift.test.mjs`
(18). **Not vendored yet**: ANVIL's sampler transposes by playback rate (pitch and length
together). Candidate for a future "keep length" transformation.

## 5. Sample I/O (`js/audio-codec.js`)

| Name | Behaviour | Reuse |
|---|---|---|
| `parseWav` | RIFF/WAVE reader: PCM 8/16/24/32-bit, 32-bit float, WAVE_FORMAT_EXTENSIBLE; native sample rate, no resampling; tolerates odd chunk padding. | Core sample decoding for WAV (byte-exact, native rate) |
| `parseAiff` | AIFF/AIFF-C PCM reader (80-bit float sample rate). | Core sample decoding for AIFF |
| `encodeWav` | PCM WAV writer, 16 or 24-bit, `round(clamp(x, -1, 1) x full scale)`, no dither, optional `cue ` chunk. | Core WAV export (16-bit) |

Deterministic, pure (returns a `Blob`). Upstream tests: `test/audio-codec.test.mjs` (19).
Compressed formats are decoded by the browser (`decodeAudioData`) in Good Bits and in Core.

## 6. Analysis and slicing (`js/dsp.js`, `js/stretch-fx/analysis.js`, `js/flip/slice-map.js`)

RMS envelopes, noise-floor estimation, silence and phrase regions, onset strength (single and
multi-band), onset picking, beat-grid fitting, drum-hit windows, band energies and a heuristic
hit classifier, hit fingerprints and de-duplication, zero-crossing search, fades, mono
downmix, linear resampling, waveform peaks. Deterministic, whole buffer (analysis, not audio
transformation). Upstream tests: `test/dsp.test.mjs` (64) and others.

**Reuse now:** `findNearestZeroCrossing` (loop-point snapping), `applyFades`, `toMono`,
`resampleLinear` and `computePeaks` (waveform display), vendored as part of `dsp.js` because
the stretch engines import it. **Reuse later:** onset picking, beat-grid fitting and slicing
are the obvious foundation for slicing and the future breakbeat rearranger (Tier 3).

## 7. Rearrangement and conforming

| Module | Behaviour | Real time | Reuse |
|---|---|---|---|
| FLIP (`js/flip/*`): `operations.js`, `recipe.js`, `render.js` | Hierarchical, seeded rearrangement of a sliced loop (repeat, reverse, substitute, roll, drop, transposition) into a recipe; the renderer assembles audio with read-level crossfades that leave natural joins bit-identical, preserves total length exactly, and pitch-shifts regions with `pitchShiftChannels`. | no | Future breakbeat rearranger (Tier 3). Not vendored now. |
| PLAY NICE (`js/play-nice/*`) | Tempo and key conforming plans (snap to loop length, octave choice) rendered with `stretchChannels` then `pitchShiftChannels`; downbeat alignment. | no | Future tempo-locked loop import. Not vendored now. |
| SNAP BACK (`js/stretch-fx/snap-back.js`) | Renders lead-in + stretched result + return as one buffer. | no | Not needed. |

## 8. LAB (`js/lab/*`)

A registry of low-level primitives (derivatives, leaky integrators, signal-dependent delay,
zero-crossing gating, bistable switches, folds, spectral bin permutation...) chained by a
seeded random graph generator, with a safety pass (`dcBlock`, `softLimit`). Deterministic
given the seed. Most primitives are causal, but several use whole-buffer reads (`lerpRead`
over the full channel) or STFT frames, and the module's purpose is random exploration of
offline buffers. **Not reused**; `softLimit` is a candidate for an optional master safety
stage if one is ever wanted (ANVIL does not limit or normalise exports).

## 9. Not DSP, or not usable

* `essentia-bridge.js`: key and tempo detection via essentia.js from a CDN, **AGPL-3.0**.
  Not vendored (licence and runtime-CDN dependency).
* `io-fs.js` ZipBatch: JSZip from a CDN with DEFLATE. Not vendored; Core has its own small
  stored-ZIP writer and reader with no runtime dependency.
* `preview-waveform.js`, `editor-waveform.js`, controllers, naming, storage: interface code.

## 10. What Slop Factory Core vendors, and how

Files are copied **verbatim** into `src/core/dsp/vendor/goodbits/js/...`, keeping Good Bits'
directory layout so their relative imports are unchanged. `vendor.json` records the upstream
commit and the SHA-256 of each file's upstream bytes; a unit test fails if a vendored file
drifts. The one modification is an appended line in `outputstage.js` exporting four existing
private helpers (`MODE_FACTORIES`, `makeRng`, `driveShapeFor`, `makeOnePoleLP`); the upstream
bytes above it are unchanged.

| Vendored | Used for |
|---|---|
| `js/outputstage.js` | Output processing (streamed) and STRETCH FX's drive/crunch |
| `js/audio-codec.js` | WAV/AIFF decoding, WAV export |
| `js/dsp.js` | Required by the stretch engines and STRETCH FX; zero crossings, fades, peaks |
| `js/dsp/stretch/*.js` (14 files) | Sample transformation engines and character registry |
| `js/stretch-fx/render.js` | Sample transformation chain |

**Parity tests** (`test/core/dsp-*.test.ts`) check that Core's streaming output processor,
fed 128-frame blocks, is bit-identical to `applyCrunch`, `applyDrive`, `applyOutputStage` and
`applyLofiChain` on the same input and seed, and that Core's transformation call equals
`renderFx` on the same recipe.

**Keeping one copy.** Two copies (Good Bits and Core) should not diverge indefinitely. The
plan, which needs the owner's approval because it changes Good Bits:

1. Upstream the one-line export addition to Good Bits' `outputstage.js` (no behaviour change).
2. When Core gets its own repository (see `docs/SLOP-FACTORY-CORE.md`), move these modules
   there unchanged and have Good Bits import them from the Core package; Good Bits' own tests
   then run against the shared code.
3. Until then, `vendor.json` pins the exact upstream commit; updating means copying the files
   again, updating the hashes, and re-running both test suites.
