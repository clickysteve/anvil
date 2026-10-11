# MIDI foundation: audit and design

Tier 2 work: an audit of the MIDI code in the five instruments, the common interfaces they
should converge on, and a migration roadmap. **Nothing in this document is implemented as
shared code yet.** The interfaces exist as TypeScript types in `src/core/midi/interfaces.ts`
so later work has a fixed contract; no Core module implements them.

Repositories read (shallow clones of `main`): ANVIL (this branch), DOWNBEAT `07e31b0`, emmm
`0f4656a`, Feelers `62d951a`, FrakMC `7a29259`.

## 1. What each application has

| Capability | ANVIL | DOWNBEAT | emmm | Feelers | FrakMC |
|---|---|---|---|---|---|
| Web MIDI access wrapper | `midi/webmidi.ts` `MidiAccess` | `midi/webmidi.ts` `MidiAccess` (state, hot-plug events per port) | `midi/webmidi.ts` | `midi/webmidi.ts` `MidiAccess` (near-identical to DOWNBEAT's) | `midi/webmidi.ts` `WebMidi` (outputs only) |
| Inputs | one input (clock, monitor) | one input (clock, step learn) | inputs (clock, MIDI Learn, control) | one input (clock) | none |
| Hot-plug / disconnect | port lost/returned, orphaned notes ended on return | per-port lost/returned events | yes | as DOWNBEAT | yes (outputs) |
| Note safety on output | `midi/router.ts` `OutputRouter`: tracks note-ons per port/channel/note, ends them no earlier than their own timestamp | `midi/output.ts` `MidiOutput`: per-note ids, a pair is released only when every holder releases; emergency offs stamped after queued messages | sink-based | `midi/output.ts` `MidiOutput` (same design and code shape as DOWNBEAT's) | `midi/router.ts` `Router`: on/off state per key, `releaseAll` after note-on times |
| Panic | tracked offs + CC 64/120/123 on 16 channels | yes | All Sound/Notes Off helpers | yes | All Sound/Notes Off, sustain off, note-off sweep |
| Message helpers | `midi/messages.ts` (noteOn/Off, cc, describe) | `midi/messages.ts` (+ program change, Song Position, note names/parsing) | `midi/messages.ts` (+ `parse()` to a structured message) | `midi/messages.ts` (+ Song Position) | in `monitor.ts` |
| Monitor | `midi/monitor.ts` (bounded log, clock aggregated as a rate) | `ui/monitor.ts` | yes | `ui/monitor.ts` | `midi/monitor.ts` |
| Scheduler | `transport/clocks.ts` `InternalClock`: 25 ms timer, 100 ms lookahead, per-clock timestamps; never withdraws scheduled messages | `scheduler/scheduler.ts`: Worker ticker (`WorkerTicker`), 25 ms / 100 ms, tempo anchor, note-offs queued until inside the window | `scheduler/scheduler.ts` + `clock.ts` `TickClock`: Worker timer every 10 ms, 60 ms lookahead, piecewise tick/ms map with tempo segments | `scheduler/scheduler.ts`: as DOWNBEAT (Worker ticker) | `scheduler/scheduler.ts`: Worker timer every 10 ms, injectable time |
| Clock out | F8 with FA/FB/FC, optional separate port | F8, FA/FB/FC, F2 Song Position 0 on stop | F8 (`SchedulerSink.pulse`) | F8, FA/FB/FC, F2 on stop | F8, FA/FC |
| External clock in | `ExternalClock`: **F8 authoritative** (one clock per F8), loss timeout, CLOCK LOST state, no clock thru | F8 = engine tick; FA/FB/FC; **F2 Song Position followed**; `PulseEstimator` for display and placing between-pulse events | `midi/clockIn.ts` `ClockFollower`: **tempo follower** (trimmed-mean tempo, bounded phase nudging), Start/Stop/Continue optional | F8 = engine tick; FA/FB/FC | none |
| Song Position Pointer | not used (documented) | sent and received | received (F2 0 = back to start) | sent (0 on stop) | none |
| MIDI Learn | none | step-note learn only (note input into a step) | **full CC/note Learn** (`extended/extended.ts`): targets, learn/replace/remove, mappings as app preferences, rising-edge note triggers, CC to ranges | none | none |
| MIDI file | `midi/smf.ts`: format-1 writer from the frozen performance; minimal reader for tests | `midi/smf.ts`: types 0/1 writer and reader (import) | `midi/smf.ts`: writer (Movies) and reader (import into patterns) | none | `midi/smf.ts`: formats 0/1 reader and writer (player) |
| Audio monitor | `audio/live.ts` (now Core-based) | `audio/drums.ts` drum synth, `getOutputTimestamp` mapping | `audio/monitor.ts` | `audio/preview.ts` (tap on the MIDI stream) | monitor via router listener |

### Observations

* **Duplication is real and already convergent.** DOWNBEAT and Feelers share almost the same
  `MidiAccess`, `MidiOutput` and scheduler. ANVIL and FrakMC solved note safety the same way
  with different code.
* **Two external-clock philosophies exist**, both deliberate: *pulse-locked* (ANVIL, DOWNBEAT,
  Feelers: each F8 advances musical time exactly one tick) and *tempo-following* (emmm: the
  estimated tempo drives the internal scheduler, with gentle phase correction). A shared
  foundation must support both, not pick one.
* **Scheduling details differ for good reasons** (lookahead 60-100 ms, Worker vs main-thread
  timer, withdrawing queued notes or not). The shared part is the tick/time mapping, the
  lookahead loop and note safety; policies stay configurable.
* **MIDI Learn exists once** (emmm) and is tied to emmm's targets. Its mapping model
  (source = CC or note + channel; target; replace rules; ranges) is the starting point.

## 2. Common interfaces (in `src/core/midi/interfaces.ts`)

* `MidiPortInfo`, `MidiOutputPort` (timestamped `send`, optional `clear`), `MidiInputPort`.
* `ClockSource` (internal or external, emits ticks at 24 PPQN with their times).
* `ClockFollower` (status, smoothed BPM, `receive(status, time, data)`), implemented either
  pulse-locked or tempo-following.
* `LearnableParameter` and `ParameterRegistry`: applications register parameters (id, label,
  group, range, step, get/set) instead of hard-coding Learn targets.
* `LearnMapping`: source (CC or note, channel or omni, number), parameter, min/max, invert,
  absolute or relative encoder mode (two's complement, binary offset, sign-magnitude).

## 3. Migration roadmap

| Step | Content | Source to start from | Tier |
|---|---|---|---|
| 1 | `midi/messages`: builders, `parse()`, `describe()`, note names, Song Position | emmm `parse`, DOWNBEAT builders and SPP | 3 |
| 2 | `midi/access`: Web MIDI wrapper with per-port lost/returned events | DOWNBEAT/Feelers `MidiAccess` | 3 |
| 3 | `midi/output`: note-safe output (per-note ids, release when all holders release, emergency offs after queued messages, panic) | DOWNBEAT/Feelers `MidiOutput`, ANVIL's orphan handling | 3 |
| 4 | `midi/clock`: tick/ms tempo map (Core's `TimeMap` already does the maths), lookahead scheduler with Worker ticker, clock out (F8/FA/FB/FC/F2) | emmm `TickClock`, DOWNBEAT scheduler, ANVIL's never-withdraw rule as an option | 3 |
| 5 | `midi/clock-in`: pulse-locked follower (ANVIL `ExternalClock` + DOWNBEAT SPP) and tempo follower (emmm `ClockFollower`) behind one interface | those three | 3 |
| 6 | `midi/learn`: registry, armed learn, mappings with ranges/inversion/relative modes, persistence as app preferences | emmm Learn | 3 |
| 7 | `midi/smf`: one writer/reader (types 0 and 1) | DOWNBEAT or FrakMC `smf.ts` (both full readers/writers) | 3 |
| 8 | Routing extras: per-track destinations, channel maps, transposition, velocity curves, thru, monitoring | new | 3 |

Each step should land with the tests of the application it is extracted from, and be adopted
by one application before the next. ANVIL's own MIDI code is left as it is in this branch: it
works, is well tested, and replacing it now would add risk without benefit.

## 4. How a new application would use it (planned API, not implemented)

```ts
// planned: registering parameters for MIDI Learn
const registry = createParameterRegistry();
registry.register({ id: 'tempo', label: 'Tempo', min: 40, max: 240, get: () => tempo, set: (v) => setTempo(v) });
const learn = createMidiLearn(registry, { onChange: savePrefs });
learn.arm('tempo');                       // the next CC or note received is mapped
input.listen((bytes, t) => learn.receive(bytes, t));

// planned: clock
const clock = createInternalClock({ bpm: 120, lookaheadMs: 100 });
clock.onTick((time) => engine.tick(time));          // 24 per quarter note
const follow = createPulseFollower({ lossMs: 500 }); // or createTempoFollower()
```
