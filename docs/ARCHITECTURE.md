# Architecture

ANVIL is a static TypeScript web application (Vite build, no server). Layers, from the
inside out:

```
src/engine/       pure, deterministic music model (no DOM, no timers, no Math.random)
  rng.ts          seeded sfc32 generator, seed derivation
  types.ts        the project data model (plain JSON)
  algorithms.ts   versioned algorithm ids and project repair
  rhythm.ts       rhythm algorithms 1-6 (cells, stringing, presets)
  pitch.ts        degree choice under the pitch rules
  theme.ts        theme generation, variations, rhythm/pitch combination
  tonality.ts     38 generated scales, user scales, degree -> MIDI
  render.ts       one pass of the playing item through six voices -> timed notes
  sequencer.ts    clock-by-clock playback: passes, aligned changes, arranger, note pairing
  edit.ts         hand editing
src/extended/     Extended-mode operations (selective regeneration, locks, contour, mutate)
src/transport/
  clocks.ts       InternalClock (lookahead scheduler), ExternalClock (MIDI clock follower)
  transport.ts    START / PAUSE / CONTINUE / STOP, clock out, external transport model
src/midi/
  router.ts       output routing, note tracking, panic, listeners
  webmidi.ts      Web MIDI access wrapper
  monitor.ts      bounded MIDI log with clock aggregation
  smf.ts          Standard MIDI File export (and a minimal reader for tests)
src/audio/        audio preview synth fed by the same output stream
src/persistence/  project format, validation/repair/migration, browser storage
src/app/          Session (all user actions), preferences, demos
src/ui/           DOM interface, palettes, theme drawing, help
```

The interface is a thin view: every control calls a `Session` method; after every change
all bound widgets refresh. The whole behaviour can therefore be tested without a browser.

## The theme representation

A `Theme` is plain data: `events` (start and length in microbeats, rest flag, accent level,
scale degree), `cells` (the microrhythm segmentation), `microbeat`, `pulse`, `length`,
plus provenance: the `seed`, the `params` it was generated with, the `algorithms` ids used,
and its `origin` (generated, variation of X, edited, regenerated, mutated, copied). The same
object is used for generation, playback, variation, editing, comparison, saving and MIDI
export.

## Determinism

The engine never calls `Math.random()` or reads the clock. Generation seeds are derived from
the project seed and a counter (`deriveSeed(projectSeed, n)`), stored on each theme, and
reproduce it exactly. Playback randomness (random harmony, negative divide, Feel, random
drums) uses a seed derived from a performance seed and the pass number, so the same
performance plays the same notes, live or exported.

## Time

**Musical time is counted in MIDI clocks** (24 per quarter note). The sequencer has no idea
of milliseconds: a clock source calls `tick1()` once per MIDI clock and gets back the note
events for that clock. Conversion between clocks and real time happens only at the
boundary, in the clock sources.

### Internal clock

`InternalClock` is a lookahead scheduler. A timer wakes every 25 ms and schedules every clock
whose time falls within the next 100 ms, computing its exact time from the tempo
(`60000 / (BPM x 24)` ms per clock). Notes and F8 bytes are sent through Web MIDI with that
timestamp, so jitter in the timer does not reach the output. A tempo change applies from the
next unscheduled clock. If the page is throttled and the timer falls more than 200 ms
behind, the clock resynchronises instead of bursting a backlog.

**Scheduled messages are never withdrawn.** Once a clock or note has been handed to Web
MIDI with a future timestamp, ANVIL treats it as sent. `MIDIOutput.clear()` is missing or a
no-op in some browsers (Chromium), and where it works it would also drop note-offs that are
already scheduled, so ANVIL does not call it. Instead, PAUSE, STOP, END and play-once let the
current lookahead window (at most 100 ms) play out: FC and the closing note-offs are
timestamped just after the last scheduled clock, the sequencer position already counts every
clock that was sent, and CONTINUE (FB) or a new START (FA) is never scheduled before the
previous run's last message. A clock-following device therefore receives exactly the clocks
ANVIL counted, in order, on every browser. The cost is that PAUSE and STOP take effect up to
one lookahead window after the button press.

Measured in the browser tests (Chromium, simulated MIDI output, 150 BPM): every clock was
scheduled ahead of its time (minimum margin about 27 ms) and clock spacing matched the
nominal period to within 0.01 ms.

### Clock out

With Clock Out on: FA before the first clock of START, F8 on every clock while running, FC
on PAUSE/STOP/end of play-once, FB before the first clock of CONTINUE. Nothing is sent while
stopped or paused. Clock can go to the note output or a separate port.

### External clock in

`ExternalClock` receives real-time bytes from the chosen input:

| Received | Effect |
|---|---|
| FA Start | fresh start: position 0, the next F8 plays position 0 |
| FB Continue | resume from the preserved position on the next F8 |
| FC Stop | stop following; notes ended; position preserved |
| F8 while running | advance exactly one clock (play its events now) |
| F8 while not running | updates detection and the tempo estimate only; never starts playback |

Status: WAITING (nothing received), CLOCK DETECTED, RUNNING, STOPPED, CLOCK LOST.

**F8 is authoritative.** The sequencer advances once per received F8, never from the
estimated tempo. The BPM shown is a smoothed estimate for information. Events are sent
immediately on the F8 that carries them.

**Clock loss.** If no F8 arrives for the loss timeout (eight smoothed clock periods, between
300 ms and 2 s; 1 s before any estimate exists), or the input port disconnects: status
CLOCK LOST, all notes ended, playback stops with the position preserved. ANVIL never falls
back to its internal clock and never continues from the estimate. When F8 returns, status
becomes CLOCK DETECTED but nothing plays until the master sends FA or FB, or the user presses
CONTINUE (arms a resume on the next F8) or START (arms a fresh start).

**Clock out while following** is disabled: there is no clock thru in this release, so no
feedback loop is possible.

Song Position Pointer is not used (the sequencer's position is a looping pass, not a song
position).

## Notes always end

- The sequencer pairs every note-on with its own note-off; a retrigger of a sounding note
  first ends it.
- The router tracks every note-on per port, channel and note. STOP, PAUSE, output change,
  project change, mode change, panic and clock loss end all tracked notes, never earlier than
  their own (possibly scheduled-ahead) note-on.
- A port that disappears keeps its note list; if it comes back, those notes are ended.
- PANIC adds All Notes Off, All Sound Off and Sustain Off on all 16 channels.

## Persistence

Project files are JSON with `format: "anvil-project"` and an integer `version`. Loading
migrates older versions step by step (`MIGRATIONS`), refuses newer ones, then validates and
repairs every field, reporting repairs as warnings. The project stores its mode, seed,
generation counter and algorithm-version table. Autosave writes the open project to
localStorage after each change; named copies form a browser library. App preferences (MIDI
ports, clock settings, palette) are stored separately and never in projects.

## Testing

- `npm test`: Vitest unit tests for the engine, observed measurements, sequencer, transport
  and both clocks (with a manual fake clock), persistence, export, demos, Extended tools and
  the session.
- `npm run test:e2e`: Playwright browser tests against production builds served at `/anvil/`
  and `/`, with a simulated Web MIDI implementation injected before load.
