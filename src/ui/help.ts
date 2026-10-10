/** In-app help: ANVIL's own words. */
import { h } from './dom';

const SECTIONS: [string, string[]][] = [
  [
    'What ANVIL does',
    [
      'ANVIL composes short musical themes from rules you set, makes variations of them, and plays them through up to six voices of accompaniment derived from the theme. It plays MIDI hardware or software instruments through Web MIDI, or its own small preview sound.',
      'Work flows left to right: set constraints, generate a theme, make variations, shape the accompaniment, play, keep what you like.',
    ],
  ],
  [
    'Quick start',
    [
      '1. Choose a MIDI output in the MIDI tab (or switch on Audio preview).',
      '2. Press START (Space). Theme TA loops.',
      '3. Click another slot to queue it; it starts at the end of the current theme. Shift-click switches at once.',
      '4. Press G, double-click or right-click a slot to generate a new theme or variation there, using the current constraints.',
      '5. Unmute voices 2-6 and choose their Rhythm, Divide and Harmony to build an accompaniment.',
    ],
  ],
  [
    'Themes and variations',
    [
      'There are five themes (TA-TE), each with three variation slots. A variation is made from its row\'s theme with the Rhythm Variation and Pitch Variation algorithms and the variation Variant (V). Changing constraints only affects what you generate next.',
      'Rhythm algorithms build the theme from short rhythmic cells (microrhythms): Second Order A/B string several cells together (Variant = how many different cells); Single A/B loop one cell (Variant = its length in pulses); 1/1 and 3/1 Preset alternate a cell with varied copies. A versions respect the pulse more than B versions.',
      'Pitches are scale degrees chosen with the Onbeat or Offbeat weight table, within Low/High, with Max Step and Max Leap: after any interval larger than Max Step the next one is at most Max Step. Max Repeats limits identical notes in a row. First Note fixes the starting degree (0 = free); Pitch Loop repeats the first N pitches (99 = off).',
    ],
  ],
  [
    'Editing',
    [
      'Click a note (or rest) in the theme view to select it. Up/Down move it by a degree (Shift: by an octave), A cycles its accent, R turns a note into a rest and back, [ and ] shorten or lengthen it, Left/Right select neighbours.',
      'Ctrl-click (Cmd-click) a slot to copy the viewed item there. Alt-click a slot to view it without playing it.',
    ],
  ],
  [
    'Accompaniment',
    [
      'Voice 1 always plays the theme. Voices 2-6 take notes from the theme by Rhythm (which positions trigger a note), Divide (every nth, ½ = twice at half value, negative = randomly about one in n), Harmony (the pitch: parallel, partial, random, contrary motion, inversion, fixed, arpeggios, or drums D1-D5 from the drum table) and Tran (1 = unison, 3 = a third...).',
      'Articulation sets note length from staccato to legato; Velocity and Accent set dynamics (accented = base + Accent, de-accented = base - Accent). Delay shifts a voice in MIDI clocks. L locks a voice so accompaniment presets leave it alone.',
      'Accompaniment presets A-Z store all six voices: click to recall, Shift-click to store, Alt-click to clear. Theme parameter presets work the same way.',
    ],
  ],
  [
    'Transport and clock',
    [
      'START plays from the beginning. PAUSE stops in place. CONTINUE resumes from where you paused (it is not the same as START). STOP/RESET stops and returns to the beginning. ONCE plays the theme once; END stops at the end of the current theme. PANIC silences every note on every channel.',
      'Clock Out sends MIDI clock (24 per quarter note) with Start, Continue and Stop, so another device can follow ANVIL. No clock is sent while stopped.',
      'External clock: choose the input in the MIDI tab and set Clock to External. ANVIL then advances exactly one step per received clock. Start (FA) begins from the top, Continue (FB) resumes, Stop (FC) pauses in place. Clock alone never starts playback. If the clock stops arriving while playing, ANVIL shows CLOCK LOST, ends its notes and waits: press CONTINUE, or send Start/Continue from the master. While following external clock, Clock Out is off.',
    ],
  ],
  [
    'Classic and Extended',
    [
      'Classic mode is ANVIL\'s reconstruction of the original instrument\'s documented and observed behaviour. Extended mode adds new tools on the same engine: regenerate only rhythm, pitches or accents, lock notes, keep the melodic contour, mutate, type a seed, and compare two items. Switching mode never changes your music.',
    ],
  ],
  [
    'Saving',
    [
      'Your work is saved in this browser automatically. Save in browser keeps a named copy; Download writes a project file you can open later with Open file. Export MIDI writes a Standard MIDI File of what ANVIL plays.',
    ],
  ],
  [
    'Keyboard',
    [
      'Space start / pause / continue - Esc stop and reset - Shift+Esc panic - G generate the viewed slot - arrows in the slot grid move, Enter plays - ? help.',
    ],
  ],
  [
    'About',
    [
      'ANVIL is an independent instrument inspired by Dr. T\'s Tunesmith by Jim Johnson. It is not affiliated with or endorsed by its author or publisher, and contains none of its code, text, graphics or data. Where the original behaviour is unknown, ANVIL\'s own approximations are documented in the repository (docs/BEHAVIOUR.md and docs/UNCERTAINTIES.md).',
    ],
  ],
];

export function helpDialog(): HTMLDialogElement {
  const d = h(
    'dialog',
    { class: 'help', 'aria-label': 'ANVIL help' },
    h('div', { class: 'help-head' }, h('h2', {}, 'ANVIL help'), h('button', { type: 'button', class: 'close', 'aria-label': 'Close help', onclick: () => d.close() }, 'Close')),
    h('div', { class: 'help-body' }, ...SECTIONS.map(([title, paras]) => h('section', {}, h('h3', {}, title), ...paras.map((p) => h('p', {}, p))))),
  );
  return d;
}
