# ANVIL Classic behaviour specification

Status: **frozen as the initial implementation specification** (Classic v1). Changes to
Classic behaviour after this point ship as new algorithm versions (see "Versioned
algorithms" below) so existing projects keep sounding the same.

This document describes what ANVIL's Classic mode does and why. Every claim carries an
evidence tag:

| Tag | Meaning |
|---|---|
| **DOC** | Stated in primary documentation (the author's preliminary manual, the official KCS addendum, the v1.11 program's own help and option labels) or in contemporary reviews read in full. |
| **OBS** | Observed by running Tunesmith v1.11 as a black box in an emulator and measuring its MIDI output (see [RESEARCH.md](RESEARCH.md)). |
| **INF** | Inferred: ANVIL's own choice where the evidence stops. Always isolated behind a versioned algorithm id. |
| **UNK** | Unknown. Not implemented as if known; either left out of Classic or approximated and tagged INF. |

Nothing in this document is copied from the original manual, help screens or software. It is
written from notes and measurements in ANVIL's own words.

## Decisions taken when the specification was frozen

Four questions were left open by the research and decided by the project owner:

1. **Max Repeats.** ANVIL implements the documented meaning: a limit on successive identical
   pitches. The observed v1.11 output did *not* show this limit, so this is a deliberate
   interpretation of the documentation, **not** a verified reproduction.
   Algorithm `classic.pitch.repeats.v1`: a run of identical pitches never exceeds N.
2. **Negative Divide.** ANVIL implements the documented "approximately one in n" thinning:
   each note is kept with probability 1/n. (A small observed sample kept more notes than that.)
   Algorithm `classic.acc.divide.v1`.
3. **Inversion harmony.** ANVIL uses the observed thirds-based mapping as the initial Classic
   algorithm, with **medium confidence** (it was measured on one theme).
   Algorithm `classic.harmony.inversion.v1`.
4. **Feel.** Off by default. When switched on, ANVIL applies its best evidence-supported
   approximation without claiming certainty. Algorithm `classic.feel.v1`.

## Versioned algorithms

Every algorithm that ANVIL had to approximate has a stable id stored in each project file
(`algorithms` table) and on each generated theme. The ids are listed in
`src/engine/algorithms.ts` and under *Project ▸ Algorithm versions* in the app (deliberately
out of the way of the musical interface).

| Id | Role | Evidence |
|---|---|---|
| `classic.rhythm.cell.v1` | microrhythm cell builder | OBS + INF |
| `classic.rhythm.secondorder.v1` | Second Order A/B stringing | DOC + INF |
| `classic.rhythm.single.v1` | Single A/B looping | OBS |
| `classic.rhythm.preset.v1` | 1/1 and 3/1 Presets | OBS + INF |
| `classic.pitch.v1` | pitch choice and constraints | DOC + OBS |
| `classic.pitch.repeats.v1` | Max Repeats (decision 1) | DOC + INF |
| `classic.variation.pitch.v1` | pitch variations | DOC + INF |
| `classic.variation.rhythm.v1` | rhythm variations | DOC + INF |
| `classic.scales.v1` | the 38 generated scales | DOC + INF |
| `classic.acc.rhythm.v1` | accompaniment rhythms 1-12 | DOC + OBS + INF |
| `classic.acc.divide.v1` | Divide (decision 2) | DOC + INF |
| `classic.harmony.v1` | parallel, partial, random, fixed | DOC + OBS |
| `classic.harmony.inversion.v1` | Inversion (decision 3) | OBS, medium |
| `classic.harmony.contrary.v1` | Contrary motion | INF |
| `classic.harmony.arpeggio.v1` | Arpeggios | OBS + INF |
| `classic.harmony.drums.v1` | Drums D1-D5 | DOC + INF |
| `classic.articulation.v1` | 8 articulations | OBS |
| `classic.feel.v1` | Feel (decision 4) | INF |

A project that names an id this build does not know is repaired to the current id for that
role, with a warning shown on load.

## 1. Data model

| Behaviour | ANVIL | Tag |
|---|---|---|
| Bank | Five themes TA-TE, each with three variation slots (VA1-VA3 ... VE1-VE3). One item plays at a time and loops. | DOC, OBS |
| Theme | An ordered list of events. Each event is a note or a rest with a length in microbeats; a note has a scale degree and one of three accent levels (accented, normal, de-accented). | DOC |
| Event limit | 99 events per generated theme (generation stops after the 99th). | DOC limit, INF cut |
| Time | Microbeat = a whole number of MIDI clocks (24 per quarter note). Loop length in clocks = Microbeat x Theme Length. | DOC, OBS |
| Generation | An empty slot is generated when first selected; any slot can be regenerated. Parameter changes affect only what is generated next. | DOC, OBS |
| Determinism | Each generation uses an explicit seed derived from the project seed and a counter; the seed is stored on the theme. | INF (modern requirement) |
| Copy | Items can be copied between slots. | DOC |
| Editing | ANVIL adds hand editing of pitch, accent, rest and length. No direct theme editing is documented for the original. | INF (ANVIL addition, both modes) |

## 2. Theme rhythm

Parameters: Microbeat, Length, Pulse, Rest Probability, Rhythm Algorithm (1-6), Variant.

| Behaviour | ANVIL | Tag |
|---|---|---|
| Pulse | Every Pulse-th microbeat from the start is strong. | DOC, OBS |
| Cells | Rhythms are built from microrhythms ("cells") one microbeat at a time: onset, hold, or rest. Cells always start on a pulse. | DOC (concept), INF (method) |
| 3 Single A, 4 Single B | One cell of Variant x Pulse microbeats, looped and cut at the theme length. Onsets, lengths and accents repeat exactly. | OBS (high) |
| 1 Second Order A, 2 Second Order B | Up to Variant distinct cells whose lengths are multiples of the pulse (one pulse long at low Variant), strung together by a higher-level pattern. Variant 1 = one cell repeated. | DOC, OBS (medium); stringing INF |
| 5 "1/1 Preset" | Cells of Variant x Pulse: base, varied, base, varied... Each varied occurrence differs. | OBS |
| 6 "3/1 Preset" | Base, base, base, varied; the four-cell group repeats identically. | OBS |
| Varied cells (5, 6) | Same length; each later slot re-rolled with probability 0.35, each onset's accent with 0.4; the first slot stays an onset in A versions. | INF |
| A versions (1, 3, 5, 6) | A cell never starts with a rest. Rests prefer off-pulse slots. | DOC, OBS |
| B versions (2, 4) | A cell may start with a rest. Rests prefer the pulse. | OBS |
| Accent odds | Per algorithm and pulse position, ANVIL draws accent levels with the proportions observed (rounded): Single A on-pulse 44/56/0, off-pulse 0/41/59 (accented/normal/de-accented), Single B 50/0/50 anywhere, Second Order A 50/41/9 and 6/44/50, Second Order B 42/39/19 and 13/33/54, 1/1 Preset 46/27/27 and 22/25/53, 3/1 Preset 58/31/11 and 11/40/49. | OBS (proportions), INF (use as odds) |
| Rest Probability | For r = Rest/100: the favoured position rests with r(0.5 + 0.5r), the other with r². This gives fewer rests than the nominal percentage, as observed. At 99 every A-version cell keeps only its first note. | OBS (tendencies, rest-99 result), INF (formula) |
| Holds | After a note, a hold continues it with probability 0.08 + 0.03 x Variant (Second Order, max 0.5) or 0.3 + 0.03 x Variant (others, max 0.6); A versions hold less on the pulse. | OBS (tendency), INF (values) |
| At least one note | Every cell keeps at least one onset. | INF |

## 3. Theme pitch

| Behaviour | ANVIL | Tag |
|---|---|---|
| Domain | Pitches are degrees of a 7-position scale; the tonality layer turns them into MIDI notes. | DOC, OBS |
| Low / High | Hard limits, in degrees. ANVIL names degrees as in C major (degree 35 = C4 = MIDI 60 in C major, mode 1, key C, octave 0). | DOC (units), OBS (hard) |
| Weights | The degree is drawn in proportion to its scale-position weight (0-8) from the Onbeat table if the note starts on a pulse, else the Offbeat table. Weight 0 is never chosen. 8 editable tables. | DOC, OBS |
| First Note | Fixes the scale position of the first note (1-7); 0 = free. | DOC, OBS |
| Max Step / Max Leap | In degrees. No interval exceeds Max Leap; after an interval larger than Max Step, the next interval is at most Max Step. Step may exceed Leap. | DOC, OBS |
| Max Repeats | At most N identical pitches in a row (decision 1). | DOC + INF |
| Fallback | If no degree satisfies the rules, the interval and repeat rules are dropped for that note; the range and the weights are kept. | DOC (drop restrictions), OBS (range always held) |
| Pitch Loop | After N pitches the sequence repeats with period N; 99 = no loop. | DOC, OBS |
| Independence | Rhythm and pitch are generated separately and combined in order. | DOC |

Known difference: the original showed occasional large jumps (5-15 % of intervals, often
between the first two notes) whose trigger is unknown. ANVIL only breaks the Step/Leap rule
in the fallback above.

## 4. Variations

A variation is made from its row's theme using the current Rhythm Variation algorithm, Pitch
Variation algorithm and the variation Variant V (DOC). Rhythm is varied first, then pitch;
the theme's pitch sequence is re-imposed in order on the new rhythm, and any extra notes get
new pitches by the current rules.

| Algorithm | ANVIL | Tag |
|---|---|---|
| Pitch 0 | none | DOC |
| Pitch 1 | regenerate the last V pitches with the current rules (V = 0: all) | DOC |
| Pitch 2 | invert the last V pitches around the first of them, folded into Low/High by octaves | DOC (label), INF (pivot) |
| Pitch 3 | reverse the order of the last V pitches | DOC |
| Pitch 4 | swap V randomly chosen adjacent pairs; V = 0 swaps every pair | DOC (label), INF (choice) |
| Rhythm 0 | none | DOC |
| Rhythm 1 | replace one randomly chosen microrhythm with a new cell of the same length | DOC (label), INF (choice) |
| Rhythm 2 | swap two randomly chosen microrhythms | DOC (label), INF (choice) |
| Rhythm 3 | halve the theme length | DOC |
| Rhythm 4 | delete the last microrhythm | DOC |
| Rhythm 5 | delete the last V microbeats (V = 0 treated as 1) | DOC, INF (V = 0) |

## 5. Tonality

| Behaviour | ANVIL | Tag |
|---|---|---|
| Preset scales | 38: one per rotation class of seven ascending steps of 1-3 semitones summing to 12 (266 step sequences / 7 rotations). Generated mathematically; names, chosen rotation and order are ANVIL's (Major first, then other named scales, then step patterns). | DOC (definition), INF (naming, order) |
| User scales | 8 user scales of 70 MIDI notes; ANVIL's editor sets seven offsets copied to every octave. | DOC (70 entries), INF (editor) |
| Mode | The scale starts from its m-th position. ANVIL places the mode's first note on the Key. | DOC, INF (rooting) |
| Key, Octave | Root C-B; global octave shift. | DOC |
| Change timing | Tonality changes while playing take effect at the next microbeat, pulse, theme end, or immediately (option). | DOC (option labels) |

## 6. Accompaniment

Six voices; voice 1 always plays the theme (DOC). Per voice: channel, program, octave,
velocity, accent, mute, solo, articulation, delay (clocks), rhythm, divide, harmony, Tran,
and a lock that protects it from accompaniment-preset recall (DOC). Copy-voice copies all but
program and mute (DOC). 26 accompaniment presets and 26 theme-parameter presets (DOC).

**Rhythm** (which positions trigger a note):

| # | Triggers | Tag |
|---|---|---|
| 1 | every note | DOC, OBS |
| 2 | every rest: the preceding note's pitch, de-accented, lasting the rest | DOC, OBS; length INF |
| 3 / 8 | notes on / off the pulse | DOC, OBS |
| 4 / 9 | rests starting on / off the pulse | DOC, OBS |
| 5 | accented notes ("accented" = not de-accented) | DOC, OBS |
| 6 / 7 | accented notes on / off the pulse | DOC, OBS |
| 10 | every microbeat: the sounding or preceding pitch, one microbeat long; onsets keep their accent, others de-accented | DOC, OBS; length/accent INF |
| 11 | every microbeat without an onset (as 10, de-accented) | DOC, OBS |
| 12 | every pulse, lasting to the next pulse | DOC, OBS; length INF |

**Divide**: n = every nth trigger, counted from each pass start; ½ = each note twice at half
value; negative n = keep each with probability 1/n (decision 2). DOC, OBS.

**Harmony** (Tran 1 = unison, 3 = a third, ...):

| # | Pitch | Tag |
|---|---|---|
| 1 Parallel | degree + (Tran - 1), diatonic | DOC, OBS |
| 2 Partial | as Parallel, but only notes landing on scale positions 1, 3, 5 sound | DOC, OBS |
| 3 Random harmony | transposed by Tran - 1 half the time | DOC, OBS |
| 4 Random notes | a random pitch from the theme, plus Tran - 1 | DOC, OBS; transposition INF |
| 5 Contrary motion | each theme interval mirrored from the voice's previous pitch, folded to within an octave of the parallel pitch; carries across passes | DOC (name), OBS (stateful), INF (method) |
| 6 Inversion | d -> 7*floor(d/7) + 2*(d mod 7), then Tran - 1 degrees down (decision 3) | OBS, medium |
| 7 Fixed | scale position Tran in a fixed octave (ANVIL: the octave named C5) | DOC, OBS; octave INF |
| 8 Partial fixed | scale position Tran in each theme note's own octave | DOC, OBS |
| 9 / 10 / 11 | arpeggio up / down / up-down over the tonic triad spanning Tran octaves, restarting each pass from the octave of the pass's first note | OBS (medium), INF (restart) |
| D1-D5 | drum notes from the 7-entry drum table, never transposed: D1 random, D2 weighted by the scale-weight table for the position, D3 the theme degree's scale position, D4 cyclic, D5 forwards then backwards | DOC (names, no transposition), INF (methods) |

## 7. Articulation and dynamics

| Articulation | Length (s = note value in clocks, mb = microbeat) | Tag |
|---|---|---|
| 1 Short staccato | s/2 | OBS |
| 4 Short legato | s - 1 | OBS |
| 5 Long staccato | s - mb, at least s/2 | OBS |
| 8 Long legato | to the next note of the voice, through rests | OBS |
| 2 / 6 | accented notes legato (short / long), others staccato | OBS |
| 3 / 7 | accented notes staccato (short / long), others legato | OBS |

"Accented" here means the accented level only (OBS). Lengths are whole clocks, minimum 1.
Measured values for 6- and 18-clock notes are reproduced exactly (unit-tested).

Velocity = base + Accent x level (accented +1, normal 0, de-accented -1), clamped 1-127;
a negative Accent inverts the pattern (DOC, OBS: 64 +/- 12 gives 76/64/52).

**Feel** (decision 4): off by default. When on, accented and de-accented notes move toward
the base velocity by a random 0-3 x floor(|Accent| / 8); normal notes are unchanged. The
documentation describes a spread of a fraction of Accent; v1.11 showed a spread only at a
very large Accent. INF.

## 8. Transport and clock

| Behaviour | ANVIL | Tag |
|---|---|---|
| Start | FA, then F8 at 24 per quarter note with the first notes on the first clock | OBS |
| Stop | FC, notes ended, position reset | OBS |
| Pause | FC, notes ended, position kept | OBS |
| Continue | FB, resumes from the kept position | OBS |
| Clock while stopped | none | OBS |
| Play once | FA, one theme, FC | DOC, OBS |
| Stop at end | stop at the end of the current theme | DOC, OBS |
| Panic | note-offs for every tracked note, plus All Notes Off, All Sound Off and Sustain Off on all channels | DOC (panic key), INF (messages) |

Difference by design: in the original, pressing Start, Pause or Stop while paused all
resumed with FB (OBS). ANVIL keeps four distinct controls: START (fresh), PAUSE, CONTINUE
(resume) and STOP/RESET.

External MIDI clock input is **not** historical: the original's "External MIDI" option did
not make it follow clock (OBS). ANVIL offers modern clock-in in both modes; see
[ARCHITECTURE.md](ARCHITECTURE.md).

## 9. Arranger

Up to 1000 steps; each step can set the item, accompaniment preset, scale, mode, key and
octave, and lasts a number of MIDI clocks. Per-group enable switches (theme, preset, scale,
mode, key & octave). Optional loop. A theme step queues the item, which starts at the theme
alignment boundary. Record turns the changes you make while playing into steps (replacing the
list). DOC for the model; the original's timing details were not observed (UNK), and ANVIL's
"Overdub" of single groups is not implemented.

## Not implemented in Classic

Master fade in/out, metronome, MIDI control input (tonality by key presses), channel
reassignment map, running-status option, MIDI merge, KCS import and continuous recording of
output. See [UNCERTAINTIES.md](UNCERTAINTIES.md) and [EXTENDED.md](EXTENDED.md).
