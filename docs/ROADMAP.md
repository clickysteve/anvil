# Roadmap

What is planned, in rough order. Nothing here is implemented; implemented features are in the
README and `docs/`.

## Slop Factory Core

1. **Own repository and package** (needs the owner's approval): `clickysteve/slopfactory-core`,
   one package `@slopfactory/core` with subpath exports, consumed by git tag; ANVIL switches to
   it. See `docs/SLOP-FACTORY-CORE.md`, section 6.
2. **Choke groups** in the note player (needed for DOWNBEAT's hats).
3. **DOWNBEAT adoption**: samples, processing and drum stems (`docs/DOWNBEAT-INTEGRATION-PLAN.md`).
4. **Shared MIDI modules**, one at a time: messages, access, note-safe output, clock and
   lookahead scheduler, clock followers (pulse-locked and tempo-following), MIDI Learn with a
   parameter registry, SMF (`docs/MIDI-FOUNDATION.md`).
5. **Good Bits single copy**: upstream the one-line export to `outputstage.js`, then Good Bits
   imports the shared DSP.
6. Later: multi-sample instruments (key and velocity zones), slicing from Good Bits' onset and
   beat-grid analysis, the breakbeat rearranger (Good Bits FLIP), duration-preserving pitch
   shift as a transformation, 24-bit and other export formats, oversampled processing.

## ANVIL

From earlier work (still open): the original's occasional large pitch jumps, arranger
overdub, master fade, metronome, MIDI control input, Song Position Pointer, clock thru, MIDI
file import (see README, Known limitations). With the audio work:

- Per-voice pan and level in the accompaniment table (the Core mixer already has them).
- Rendering a live take (what was actually played, including hand changes), recorded from the
  sequencer's events.
- emmm, Feelers and FrakMC adopting the relevant Core modules after DOWNBEAT.
