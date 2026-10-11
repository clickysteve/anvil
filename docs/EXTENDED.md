# Extended mode

Classic mode is ANVIL's reconstruction of the original instrument. Extended mode adds tools
on the **same engine**: there is one generator, one sequencer and one data model, and
Extended operations produce ordinary themes. A project stores its mode; switching mode never
changes the music, and Extended data (such as locks) is kept but inactive in Classic.

## Implemented

| Capability | What it does | Id |
|---|---|---|
| Seeded generation | Every theme records its seed; Extended lets you type a seed to regenerate a slot exactly | (generation) |
| Selective regeneration | New rhythm (pitch order kept), new pitches (rhythm kept), new accents, or new pitches from the selected event onward | `extended.regenerate.v1` |
| Motif locking | Locked events keep their pitch; their microrhythm survives rhythm regeneration and mutation | `extended.regenerate.v1` |
| Contour preservation | New pitches follow the old up/down shape where the rules allow | `extended.regenerate.v1` |
| Mutation depth | Changes about Depth % of pitches and half as many microrhythms | `extended.mutate.v1` |
| Ancestry | Each item shows what it was made from and how (one level of history) | n/a |
| Comparison | Draw another item as an outline over the theme view | n/a |

Available in both modes: hand editing, external MIDI clock in, clock out, MIDI file export,
internal audio (synth and samples), output processing, audio export, seeds stored with every
theme.

## Extension points (not yet implemented)

These fit the existing structure and are recorded so they can be added without new engines:

- **Weighted rhythm choices**: per-algorithm accent/rest/hold odds exposed as editable tables
  (the odds already live in one place in `rhythm.ts`).
- **User scale editing per octave**: the 70-entry tables are stored; the editor only sets one
  octave today.
- **Conditional rules**: constraints that depend on position or previous notes (e.g. end on
  the tonic), as extra filters in `chooseDegree`.
- **Interval and harmonic constraints**: allowed-interval sets; chord-tone targets on pulses.
- **Rhythm mutation styles**: displacement, augmentation, diminution of cells.
- **Phrase relationships and call-and-response**: generate a variation that answers a theme
  (same rhythm, contrasting contour; or cadence-shaped endings).
- **Interpolation**: blend two items' pitch and rhythm by a percentage.
- **Controlled surprise**: an explicit probability of rule-breaking leaps, instead of only the
  fallback.
- **Performance variation**: timing and velocity humanisation in milliseconds at output, so
  musical time stays exact.
- **MIDI / CV control**: map incoming notes and CCs to item selection, tonality (the original's
  MIDI control) and parameters; learnable mappings stored as preferences.
- **Arranger overdub**: record a single group of changes into existing steps.
- **MIDI file import**: read a melody into a theme (the original imported KCS sequences);
  in Classic it would only fill an empty slot, as the original did.
- **Clock thru**: forward incoming clock to an output, with loop protection.
