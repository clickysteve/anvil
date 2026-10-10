# Research

How ANVIL's Classic behaviour was established. The research material itself (articles,
documentation files, the program, emulator images, captures, screenshots and notes) is kept
**outside this repository**. This file records what was consulted and how, not the material.

## Evidence classes

- **DOC**: documentation read in full.
- **OBS**: black-box observation of the running program's MIDI output.
- **INF**: ANVIL's own inference where evidence stops.
- **UNK**: unknown.

Search-engine snippets, summaries and metadata were not treated as sources. A source that
could not be read in full is listed as inaccessible and contributed nothing.

## Sources read in full

| Source | Kind | Used for |
|---|---|---|
| Jim Johnson, preliminary documentation for Tunesmith 0.70 (beta/demo), distributed with the program archive | primary documentation | parameter meanings, algorithm descriptions, step/leap rule, weights, tonality, accompaniment lists, transport keys |
| "Copy From KCS" addendum (v1.07 and later), distributed with the program archive | primary documentation | internal theme structure (up to 99 notes/rests, three accent levels) |
| Tunesmith v1.11 (1991): option and help labels as displayed by the program | observed interface text | names of algorithms and options in the released version (Theme/Tonality/Preset alignment, Send MIDI Clock, External MIDI) |
| Ian Waugh, "Dr T's Tunesmith", *Music Technology*, January 1989 (v1.05), including two printed screenshots | review | overall model, parameter set, presets, arranger |
| Ian Waugh, "Battle of the Algorithms", *Micro Music*, April/May 1989 | review | comparison context, parameter descriptions |
| Jim Pierson-Perry, "Variations on a Theme", *START* 3(10), May 1989 | review | tonality (70-note scales, 38 + 8 scales), voice parameters, presets |
| "ST News: More music software", *ST-Log* 33, June 1989 | news item | feature list |
| Tim Conrardy, Tunesmith page on *Tim's Atari MIDI World* (fan site, c. 2000) | secondary | keyboard controls, freeware claim, origins of ideas (unverified) |
| Jaxitron, *Cybernetic Music* (TAB Books, 1985) | background | the idea of microrhythms; linked to Tunesmith only by a fan claim |

The review screenshots and the program's own screens were used to understand the parameter
set. ANVIL's interface is its own design and reproduces none of them.

## Black-box observation (Tunesmith v1.11)

To resolve behaviour the documents leave open, Tunesmith v1.11 was run in the Hatari
emulator with a user-supplied EmuTOS ROM. The program was treated strictly as a black box:
**no disassembly, decompilation or inspection of program code or data.** Settings were
changed through its interface; output was captured as raw MIDI bytes and analysed with
scripts that live outside this repository.

Volume: 52 rhythm/pitch conditions (315 generated themes), 54 accompaniment, articulation
and velocity captures, 7 transport sequences, and one external-clock test. All timing was
measured in MIDI clocks, so emulator speed did not affect results.

Principal results (details and confidence levels in [BEHAVIOUR.md](BEHAVIOUR.md)):

- Single A/B loop one cell of Variant x Pulse microbeats (11 conditions, no exceptions).
- 1/1 and 3/1 Presets alternate base and varied cells 1:1 and 3:1.
- Accent placement rules per algorithm; A and B rest tendencies; rest-99 behaviour.
- Pitch: High/Low hard, step/leap in degrees, First Note, Pitch Loop and weight behaviour as
  documented; Max Repeats did **not** limit repeated notes as its wording suggests.
- Accompaniment rhythms 1-12, Divide, and harmonies 1-4 and 6-11 measured on fixed themes.
- Articulation lengths for 6- and 18-clock notes; velocity = base +/- Accent exactly.
- Transport bytes for start, stop, pause, continue, play-once and stop-at-end.
- The "External MIDI" option did not make the program follow MIDI clock.

## What remains unknown

See [UNCERTAINTIES.md](UNCERTAINTIES.md). In short: the exact cell-building and stringing
methods, the rest-probability mapping, the varied-cell method, contrary motion, arpeggio
restart points, drum algorithms, the fine detail of the variation algorithms, Feel, the
trigger for large pitch jumps, and the arranger's timing details.

## Decisions

The owner's decisions on Max Repeats, negative Divide, Inversion and Feel are recorded at the
top of [BEHAVIOUR.md](BEHAVIOUR.md).
