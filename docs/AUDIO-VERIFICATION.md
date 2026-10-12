# Audio verification

Objective measurements of ANVIL's audio output, made on this branch by
`e2e/audio-verify.spec.ts` in headless Chromium (Playwright's Chromium 1194). Scenarios are
rendered through ANVIL's real export path (the frozen performance, Core's OfflineAudioContext
renderer, the output-processor AudioWorklet, real sample decoding); the exported 16-bit WAV
data is decoded and measured in Node.

**No listening tests were performed.** Every statement below is a measurement. Headless
Chromium has no audio hardware; live audio runs against its fake output device, which is
enough to measure the live graph's output (captured on the audio thread) but says nothing
about any particular sound card.

Run it with: `npm run build:e2e && VERIFY_OUT=verify.json npx playwright test e2e/audio-verify.spec.ts`.

## Test material

Generated in code (`e2e/fixtures.ts`; the repository holds no audio files):

| Sample | Content |
|---|---|
| Short drum hit | 0.3 s mono kick: a sine sweeping 160 to 45 Hz, exponential decay |
| Sustained melodic | 1.5 s mono tone at C3 (130.81 Hz) with 2nd and 3rd harmonics, 10 ms attack |
| Bass | 1 s mono softened square at C2 (65.41 Hz) |
| Stereo | 0.8 s, 440 Hz left and 660 Hz right |

Most scenarios use a fixed theme on voice 1: C3, G3, C4, C2, one second each at 120 BPM
(quarter-note microbeats), long legato articulation, velocity 100.

## Results

| What | Scenario | Measured | Check |
|---|---|---|---|
| **Chromatic transposition** | melodic sample, root C3, GATED, notes C3 G3 C4 C2 | 130.94, 196.09, 261.73, 65.43 Hz (expected 130.81, 196.00, 261.63, 65.41) | error 1.74, 0.78, 0.71, 0.59 cents (< 5) |
| **Timing** | kick sample, ONE SHOT, same four notes | first non-zero sample of each hit at frames 0, 44100, 88200, 132300 exactly | 0 frames from the clock |
| **Duration and tail** | 4 s of music + 1 s tail | 220 500 frames (expected 220 500) | exact |
| **Gated playback** | C4 plays the 1.5 s sample at double speed | RMS < 1e-4 between 0.80 and 0.95 s into the note; silent within the tail after release | ends when the sample ends; release completes |
| **Mono sample, centred** | as above | left and right channels identical | equal |
| **Crunch: bit depth** | master crunch 6 bits, rate divide 4 | 0 samples off the 6-bit grid (step 2/64); 11 distinct levels used (the signal peaks near 0.16, so it spans few of the 64 levels) | on grid |
| **Crunch: rate reduction** | as above | 94 % of consecutive non-silent sample pairs equal (at least 75 % expected from holding each value 4 samples; quantisation of a quiet signal makes more pairs equal) | > 70 % |
| **12-BIT preset** | bass sample, master 12-BIT (tape drive 15 %, crunch 12 bits / 2, tone 10 kHz) | peak 0.185 (clean 0.168); RMS difference from clean 0.0107; pitch still 65.46 Hz | changed, bounded, finite |
| **Output stage** | master Cassette (mix 100, intensity 60) | peak 0.288; RMS difference from clean 0.0475; pitch 65.51 Hz | changed, bounded, finite |
| **Stereo** | stereo sample at its root | left 440.000 Hz, right 659.999 Hz | channels kept apart |
| **Sample transformation: stretch** | melodic sample, Good Bits Clean stretch, ratio 2 | duration 3.00 s (from 1.5 s), pitch 130.85 Hz | pitch kept (0.2 cents) |
| **Sample transformation: varispeed** | pitch -12 | duration 3.00 s, pitch 65.43 Hz | octave down (0.4 cents) |
| **Stem alignment** | Accompaniment demo, master + 6 stems, kick samples in every drum slot, 2 s tail | every file 277 200 frames (= music + tail, as computed from the tempo); each stem's first sound within 0-7 frames of its voice's first note (voice 5 starts at frame 64 969 and its stem is silent before it) | aligned, leading silence kept |
| **Stem sum vs master** | as above, all processors CLEAN | max difference 6.1e-5 (2 LSB, the rounding of seven 16-bit files) wherever the master is below full scale | sums to the master |
| **Master clipping** | as above | the stems summed peak at 1.124 (+1.0 dBFS): **93 master frames clamped** by the 16-bit conversion; the export window reports the count; nothing is normalised | reported, not hidden |
| **Tail** | as above | the last second of the master is digital silence (every voice finished inside the 2 s tail) | not truncated |
| **Live vs offline: timing** | kick sample, live playback recorded on the audio thread vs export | hit spacing differs from the render by 5, 1 and -2 frames (over six runs: at most 20 frames, 0.45 ms) | < 10 ms |
| **Live vs offline: level** | as above | live/offline RMS per hit 1.00002, 1.00000, 0.99997, 1.00001 | equal |
| **Live vs offline: pitch** | melodic sample | live 130.89, 196.09, 261.73, 65.47 Hz; offline 130.91, 196.11, 261.72, 65.47 Hz | < 3 cents apart |

Browser tests in `e2e/audio.spec.ts` add: every exported file is a valid RIFF/WAVE PCM file at
44.1 kHz, 16-bit, 2 channels with a consistent RIFF size; a second render of the same export
differs by at most one 16-bit step on any sample (Chromium's summing order); the project is
unchanged by exporting; a sample voice produces sound in the live mix.

## Problems the verification found, and what was done

1. **Live note-spacing jitter.** The first live measurement showed note intervals off by
   9-20 ms. Live audio mapped MIDI timestamps to the audio clock through `ctx.currentTime`,
   which advances only once per audio callback (the original preview did the same). Live
   audio now maps through `getOutputTimestamp()` plus the context latency; measured spacing
   is within 0.45 ms of the offline render. MIDI timing is unaffected.
2. **Stems did not sum to the master at first.** Investigation showed the stems were right:
   the demo mix with loud kick samples exceeds full scale and the 16-bit master is clamped
   there. The verification now records clamped frames and compares the sum only where the
   master is below full scale; the export window already reports clamped samples per file.
3. **Bit-exact repeat renders.** Two renders of the same export differ by up to 1.4e-5 (under
   half a 16-bit step before rounding; at most one step after) because Chromium sums a node's
   inputs in an order that can vary. The tests assert this bound; the documentation says so
   instead of claiming bit-identical renders.

## Limitations of this verification

* Headless Chromium only; Firefox and Safari not tested.
* Pitch is measured by autocorrelation on synthetic tones; noisy or inharmonic material was
  not measured.
* Live measurements run against Chromium's fake audio device, not a sound card.
* Clicks were not measured as such; edge fades and the 256-sample settings crossfade are
  covered by unit tests, not by listening.
