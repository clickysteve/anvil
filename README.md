# ANVIL

**ANVIL** is an algorithmic MIDI composition instrument for the browser. You set rules; ANVIL
composes short themes from them, makes variations, and plays them through up to six voices of
accompaniment derived from the theme, on your MIDI hardware or its own preview sound.

The name follows a line of descent: Tunesmith → smith → anvil.

## Inspiration, and what ANVIL is not

ANVIL is inspired by **Dr. T's Tunesmith** (Jim Johnson, Dr. T's Music Software, 1988-91), an
Atari ST program that generated themes and variations from rhythmic "microrhythms", weighted
scale degrees and step/leap rules, and derived accompaniments from them.

ANVIL is **not** a port, emulator or copy of Tunesmith. It contains none of its code,
graphics, text, presets or data, and its interface is its own. Its Classic mode reconstructs
the original's documented and observed *behaviour*; where that behaviour is unknown, ANVIL's
own approximations are labelled, documented and versioned. ANVIL is not affiliated with or
endorsed by Jim Johnson or Dr. T's Music Software (see [NOTICE.md](NOTICE.md)).

ANVIL belongs to a small collection of instruments alongside **emmm** (after Intelligent
Music's M), **FrakMC** (Fractal Music Composer) and **Feelers** (after Dr. T's Fingers /
MIDI-AX), and shares their visual family and palette names.

## Classic and Extended

- **Classic**: the reconstruction. Five themes x three variations, six rhythm algorithms,
  weighted pitch rules, five rhythm and four pitch variation algorithms, 38 + 8 scales, six
  voices with 12 rhythms, Divide, 11 harmonies and 5 drum algorithms, 8 articulations,
  26 + 26 presets, arranger. Fully usable on its own.
- **Extended**: the same engine with new tools: regenerate only rhythm, pitches or accents,
  lock notes, keep contour, mutate, type seeds, compare items, see ancestry.

Projects remember their mode. Switching never changes the music.

## The system in brief

1. **Constraints**: rhythm (microbeat, length, pulse, rest %, algorithm, variant), pitch
   (first note, loop, low/high, max step/leap/repeats, onbeat/offbeat weight tables) and
   variation (rhythm var, pitch var, V).
2. **Themes & variations**: click a slot to play it (generating it if empty); G, double-click
   or right-click regenerates. Variations are made from their row's theme.
3. **Theme view**: see the structure (pulses, microrhythm cells, accents) and edit notes:
   drag notes for pitch and timing, drag a right edge for length, Backspace deletes,
   double-click a rest to add a note; wheel and swipe to scroll, Ctrl/Cmd+wheel to zoom.
   EXPAND opens a maximised editor window (roll, edit buttons, status line); RESTORE or
   Esc returns to the normal layout.
4. **Tonality**: scale, mode, key, octave, user scales, weight tables, drum table.
5. **Accompaniment**: voices 2-6 take rhythm, divide and harmony from the theme.
6. **Arranger**: a list of steps with durations; can be recorded live.

Full behaviour, with evidence for each rule: [docs/BEHAVIOUR.md](docs/BEHAVIOUR.md).

## MIDI setup

Use Chrome, Edge, Opera or Firefox (Web MIDI; ANVIL never asks for SysEx). In the **MIDI**
tab choose an **Output**; set each voice's channel in the accompaniment table. Without MIDI,
switch on **Audio preview**. The MIDI monitor shows traffic in and out; MIDI clock is
summarised as a rate rather than listed.

### Internal clock (ANVIL as master)

Set the tempo; switch on **CLOCK OUT** to send MIDI clock (24 per quarter note) with Start,
Continue and Stop. Clock can go to the note output or another port ("Clock to").

### External clock (ANVIL as slave)

Choose the **Input** in the MIDI tab and set **CLOCK** to External. ANVIL advances exactly one
step per received clock and follows Start (from the top), Continue (from where it stopped) and
Stop (pause in place). Clock alone never starts playback. If clock stops arriving, ANVIL shows
**CLOCK LOST**, ends its notes and waits for Start/Continue from the master or your CONTINUE.
Clock out is off while following external clock.

### Squarp Hermod+

The **Hermod+ setup** demo puts voices 1-4 on channels 1-4 with Clock Out on. As master:
connect by USB, choose the Hermod+ as output, set the Hermod+ to follow USB clock. As slave:
set the Hermod+ to send clock over USB, choose it as input and set Clock to External. This
setup has **not** been verified on hardware by the developers.

## Transport

| Control | Key | Does |
|---|---|---|
| START | Space (when not playing), Return (when stopped) | play from the beginning |
| PAUSE | Return (while playing) | stop in place |
| CONTINUE | Return (while paused) | resume from where it paused |
| STOP/RESET | Space (while playing), Esc | stop and return to the beginning |
| ONCE | | play the theme once |
| END | | stop at the end of the current theme |
| PANIC | Shift+Esc | silence every note on every channel |

## Saving

Work autosaves in the browser. **Save in browser** keeps named copies; **Download** writes a
`.anvil.json` file; **Open file** reads one back (older formats are upgraded, damaged values
repaired with a report). **Export item / arranger** writes a Standard MIDI File of exactly what
ANVIL plays. Palettes and MIDI port choices are browser preferences, not project data.

## Palettes

Classic (black on white), Dark and Colour, plus custom palettes made by editing any colour in
the **Look** tab. Colours are semantic roles (each panel area has its own ink).

## Known limitations

Not implemented (none of these block normal use):

- the original's occasional large pitch jumps (their trigger is unknown, so they are not reproduced);
- arranger overdub (Record replaces the step list);
- master fade in/out, metronome;
- MIDI control input (changing tonality or items from a keyboard);
- Song Position Pointer (sent or received), clock thru;
- MIDI file import.

MIDI timing in the browser: ANVIL schedules up to 100 ms ahead and never withdraws a message
once scheduled (browsers differ in whether they can), so PAUSE and STOP take effect at most
one lookahead window after the button press. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Hardware: clock in/out and transport have been tested only against a simulated Web MIDI
device. Behaviour with real hardware, including the Squarp Hermod+ as clock master and as
clock follower over USB, still needs to be checked on the devices themselves.

## Uncertainties and provenance

- [docs/UNCERTAINTIES.md](docs/UNCERTAINTIES.md): what is unknown and what ANVIL does instead.
- [docs/RESEARCH.md](docs/RESEARCH.md): sources and the black-box observation method.
- [docs/PROVENANCE.md](docs/PROVENANCE.md): clean-room statement and repository audit.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, timing and clock model.
- [docs/EXTENDED.md](docs/EXTENDED.md): Extended features and future extension points.

## Licence

ANVIL's own code and documentation are MIT licensed ([LICENSE](LICENSE)). The licence covers
nothing else; see [NOTICE.md](NOTICE.md) for its scope and the non-affiliation statement.

## Development

Requires Node.js 20.19+ (22 recommended).

```bash
npm ci
npm run dev          # http://localhost:5299
npm run typecheck
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright, Chromium)
npm run build        # static site in dist/, works from any folder
npm run build:pages  # build for https://<user>.github.io/anvil/
npm run verify       # all of the above
```

Browser tests serve two production builds (one under `/anvil/`, one at `/`) and inject a
simulated Web MIDI device. If Playwright's bundled Chromium is not installed, point
`CHROMIUM_PATH` at a Chromium binary.

## Deployment

`.github/workflows/pages.yml` runs on pushes to `main`: install from the lockfile, type
check, unit tests, browser tests, build, and only then deploy to GitHub Pages. Pull requests
run the same checks without deploying. The site is published at
<https://anvil.allmyfriendsaresynths.com/>: `public/CNAME` names the custom domain and is
copied into every build, and its presence makes the workflow build for the domain root (`/`).
Without it the build would use `/<repository>/`. The build itself uses relative asset paths
by default, so `npm run build` output also works from any folder.

One-time setup on GitHub: **Settings ▸ Pages ▸ Build and deployment ▸ Source: GitHub
Actions**, and **Custom domain: anvil.allmyfriendsaresynths.com** with **Enforce HTTPS**.
DNS: a `CNAME` record for `anvil` pointing to `clickysteve.github.io`.
