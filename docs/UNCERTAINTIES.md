# Uncertainties

What ANVIL does not know about the original, and what it does instead. Each approximation
is isolated behind a versioned algorithm id (see [BEHAVIOUR.md](BEHAVIOUR.md)), so it can be
replaced by a better one later without changing how saved projects sound.

| Area | What is known | What is unknown | ANVIL's approach | Id |
|---|---|---|---|---|
| Microrhythm construction | Cells are built from onsets, holds and rests; A versions respect the pulse; observed accent proportions; A cells start with a note | The actual method (described by the author as secret) | Slot-by-slot stochastic builder with observed accent odds and inferred hold odds | `classic.rhythm.cell.v1` |
| Rest Probability | Rests appear less often than the nominal percentage; at 99 each A cell keeps one note | The mapping from the number to the chance | r(0.5+0.5r) at favoured positions, r² elsewhere | `classic.rhythm.cell.v1` |
| Second Order stringing | Up to Variant cells, multiples of the pulse, combined by "the same method" | The higher-level method | Random pattern favouring repeats and, in A, returns to the first cell on strong positions | `classic.rhythm.secondorder.v1` |
| Preset varied cells | Same length; often keep some onsets | How they are derived; whether "1/1" and "3/1" literally name the ratios | Re-roll some slots and accents | `classic.rhythm.preset.v1` |
| Large pitch jumps | 5-15 % of intervals exceed Max Leap in the original, mostly note 1 to 2 | What triggers them | Not reproduced; ANVIL only breaks the rules when nothing fits | `classic.pitch.v1` |
| Max Repeats | Documented as a successive-repeat limit | The original's output did not respect it | Implements the documented limit (owner decision) | `classic.pitch.repeats.v1` |
| Variations | Labels of 5 rhythm and 4 pitch algorithms | Not observed: pivot of inversion, which cells/pairs are chosen, V = 0 for deleting microbeats | Seeded random choice, pivot = first varied pitch | `classic.variation.*.v1` |
| Scale names and order | 38 presets defined mathematically | The original's names and order (not reproduced deliberately) | ANVIL's own names and order | `classic.scales.v1` |
| Mode rooting | Mode = starting position in the scale | Whether the mode start sits on Key | Mode start sits on Key | `classic.scales.v1` |
| Accompaniment lengths | Which positions trigger | Length and accent of rest-, microbeat- and pulse-triggered notes | Rest length; one microbeat; to the next pulse; de-accented unless an onset | `classic.acc.rhythm.v1` |
| Negative Divide | Documented "about one in n" | A small sample kept more | Keep with probability 1/n (owner decision) | `classic.acc.divide.v1` |
| Contrary motion | Stateful, differs between loops | Method | Mirror intervals, fold near the parallel pitch, carry state | `classic.harmony.contrary.v1` |
| Inversion | One theme measured: thirds-based re-reading | Generality | Use the measured mapping, medium confidence (owner decision) | `classic.harmony.inversion.v1` |
| Arpeggios | Tonic triad, Tran = octaves | Restart points | Restart each pass from the first note's octave | `classic.harmony.arpeggio.v1` |
| Drums D1-D5 | Names; drum notes never transposed | Methods; table layout | 7-entry table; random, weighted, follow degree, cyclic, alternating | `classic.harmony.drums.v1` |
| Fixed octave | Tran = scale position | Absolute octave | The octave ANVIL names C5 | `classic.harmony.v1` |
| Feel | Documented spread; v1.11 showed one only at huge Accent | Distribution | Off by default; 0-3 x floor(|Accent|/8) toward base (owner decision) | `classic.feel.v1` |
| Arranger timing | Steps hold clocks; theme steps queue | Exact interaction with alignment; overdub | Steps by clocks; record replaces; no overdub | n/a |
| Note naming | Displayed as note names | Which MIDI octave the original's names meant | ANVIL: degree 35 = C4 = MIDI 60 | n/a |
| External MIDI option | Exists; did not follow clock | Purpose | Not reproduced; ANVIL's clock-in is a modern feature | n/a |
| v1.05 vs v1.11 | Reviews describe v1.05; observation used v1.11 | Differences | ANVIL follows v1.11 where they differ | n/a |

## Known deliberate differences

- START, PAUSE, CONTINUE and STOP/RESET are distinct (the original resumed from pause on any
  of Start, Pause or Stop).
- External clock input exists (the original did not follow clock).
- Themes can be edited by hand.
- Seeds make every generation reproducible.
