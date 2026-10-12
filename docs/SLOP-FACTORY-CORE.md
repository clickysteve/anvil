# Slop Factory Core in ANVIL

ANVIL's internal audio runs on **Slop Factory Core**, `@slopfactory/core`, the shared audio
package of the Slop Factory instruments. Core was first developed here (`src/core/`) and now
lives in its own repository, **<https://github.com/clickysteve/slopfactory-core>**, with its
own tests, documentation and version tags. DOWNBEAT uses the same package.

## How ANVIL depends on it

`package.json` names an immutable commit of the Core repository (the 0.2.0 release commit; a version tag can be used the same way):

```json
"@slopfactory/core": "github:clickysteve/slopfactory-core#fb403db63d21caa96d3ca816c799671c0be11707"
```

and `package-lock.json` pins that commit. `npm ci` installs it with no build step (the
tag contains the built package), and Vite bundles it into ANVIL's static build; nothing is
fetched at run time. To upgrade: install the new tag, run `npm run verify`, commit both files
(see Core's `docs/RELEASING.md`).

## What ANVIL uses

| Core module | Used by ANVIL for |
|---|---|
| `@slopfactory/core/events` | the frozen performance as a timeline (`src/audio/anvilTimeline.ts`) |
| `@slopfactory/core/audio` | the mixer, note player and instrument interface (`src/audio/live.ts`, `routing.ts`, `synth.ts`) |
| `@slopfactory/core/sampler` | sample decoding and the sample instrument (`src/audio/library.ts`, the Sample Bank) |
| `@slopfactory/core/dsp` | output processing and sample transformations (AUDIO tab, Sample Bank) |
| `@slopfactory/core/render`, `/export` | audio export: offline rendering, WAV, ZIP, file names |
| `@slopfactory/core/storage` | IndexedDB sample storage and `.anvilpack` bundles |
| `output-fx-worklet.js`, `transform-worker.js` | the processing AudioWorklet and the transformation Worker, imported with Vite's `?url` |

ANVIL's own code stays in ANVIL: the adapters in `src/audio/` (timeline, settings and their
migration, routing, synth instrument, live audio, export ranges and names, bundles) and the
interface. Core contains no ANVIL code and does not import it.

ANVIL does not use Core's choke groups (it assigns none), so its sound is unchanged by them.

## Core's documentation

In the Core repository: `README.md`, `docs/ARCHITECTURE.md` (event model, routing,
rendering, stems, choke groups, storage, determinism), `docs/API.md`, `docs/RELEASING.md`,
`docs/GOOD-BITS-DSP.md` (the Good Bits DSP inventory that used to be here) and
`docs/MIDI-ROADMAP.md` (the MIDI audit that used to be here).

## Changes in Core that affect ANVIL

- **0.2.0** fixed fades scheduled ahead: a GATED or LOOP sample's release (and a stolen or
  stopped note) now fades from its level at the note-off, not from the note-on. Before, in
  Chromium, such notes ramped down over their whole length, live and in exports. ANVIL's
  synth is not affected.
