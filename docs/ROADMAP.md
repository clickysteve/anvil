# Roadmap

What is planned, in rough order. Nothing here is implemented; implemented features are in the
README and `docs/`.

## Slop Factory Core

Done: Core has its own repository and package (`clickysteve/slopfactory-core`, consumed by
version tag; ANVIL and DOWNBEAT both use it), choke groups, and DOWNBEAT's adoption (samples,
processing, voice and drum-sound stems). See `docs/SLOP-FACTORY-CORE.md`.

1. **Shared MIDI modules**, one at a time: messages, access, note-safe output, clock and
   lookahead scheduler, clock followers (pulse-locked and tempo-following), MIDI Learn with a
   parameter registry, SMF (Core's `docs/MIDI-ROADMAP.md`).
2. **Good Bits single copy**: upstream the one-line export to `outputstage.js`, then Good Bits
   imports the shared DSP.
3. Later: multi-sample instruments (key and velocity zones), slicing from Good Bits' onset and
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
