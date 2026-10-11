/** In-app help: ANVIL's own words. */
import { h } from './dom';

const SECTIONS: [string, string[]][] = [
  [
    'What ANVIL does',
    [
      'ANVIL composes short musical themes from rules you set, makes variations of them, and plays them through up to six voices of accompaniment derived from the theme. It plays MIDI hardware or software instruments through Web MIDI, and its own internal sound: a small synthesiser, or samples you load.',
      'Work flows left to right: set constraints, generate a theme, make variations, shape the accompaniment, play, keep what you like.',
    ],
  ],
  [
    'Quick start',
    [
      '1. Choose a MIDI output in the MIDI tab, or switch on INTERNAL AUDIO in the AUDIO tab.',
      '2. Press START (Space). Theme TA loops. Space again stops; Return pauses and resumes.',
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
      'Drag a note up or down to change its pitch, sideways to move it in time, or drag its right edge to change its length. Neighbouring notes and rests make room; the theme keeps its length and no note is removed by dragging.',
      'Mouse wheel scrolls up and down (pitch); a sideways swipe or Shift+wheel scrolls through time; Ctrl/Cmd+wheel or a trackpad pinch zooms (add Shift to zoom pitch). Drag empty space to pan. FIT (or F) shows the whole theme. Drag the bottom edge of the view to make it taller. EXPAND opens the theme in a maximised editor window (just the roll, the edit buttons and a status line); RESTORE or Esc returns to the normal layout, with your edits, selection and playback unchanged.',
      'Backspace (or DELETE) turns the selected note into a rest. Double-click a rest to put a note there. With a note selected: Up/Down move it by a degree (Shift: an octave), A cycles its accent, R toggles note/rest, [ and ] shorten or lengthen it, Left/Right select neighbours.',
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
    'Internal audio and MIDI',
    [
      'ANVIL always sends MIDI to the chosen output. Separately, it can play its own internal audio in the browser (AUDIO tab, INTERNAL AUDIO; the MIDI tab\'s AUDIO PREVIEW is the same switch). Internal audio is what the Sample Bank, the output processing and Export Audio work with. External MIDI instruments are never heard through, processed or rendered by ANVIL: to put them in a recording, record their audio separately.',
      'Each voice plays either the internal SYNTH or a SAMPLE (AUDIO tab, VOICE SOURCES, or the Sample Bank). A voice set to SAMPLE plays the internal synth wherever its slot is empty, so it never goes silent by accident.',
    ],
  ],
  [
    'Sample Bank',
    [
      'SAMPLES (top right) opens the Sample Bank. There are thirteen slots: V1-V6 for voices 1-6, and D1-D7 for the seven drum-table entries. A voice playing a drum harmony (D1-D5) with its source set to SAMPLE takes each drum note from the slot of the drum-table entry that produced it, so one drum voice can play a whole kit. Drum slots are shared by all drum voices.',
      'Click a slot to select it, then LOAD, or drop an audio file onto any slot. WAV and AIFF are read exactly; MP3, OGG, FLAC, M4A and others go through the browser\'s decoder. Files up to 40 MB and 120 s. Samples stay in this browser (nothing is uploaded) and survive reloads.',
      'ROOT is the note at which the sample plays at its original speed (C4 = middle C): higher notes play it faster and higher, lower notes slower and lower, as on a hardware sampler. TUNE and FINE shift it. VOL (100 = unity), PAN, VEL (how much ANVIL\'s velocities change the level).',
      'MODE: ONE SHOT plays the whole sample (drums); GATED plays while the note is held, then fades over REL; LOOP repeats LOOP-TO while held. START and END trim the sample; SNAP moves the points to zero crossings to avoid clicks. MUTE silences a slot in the internal audio only. AUDITION (or A in the slot list) plays the root note through the voice\'s processing.',
      'SAMPLE TRANSFORM reworks the sample\'s audio once, with The Good Bits\' STRETCH FX chain: a stretch character (Clean, Vintage, Cyclic, Tape, Grain... the Good Bits names), stretch ratio, varispeed pitch, reverse, drive and crunch. The original stays stored; the result is cached and recomputed only when the settings change. PURGE UNUSED removes stored samples no saved project uses.',
    ],
  ],
  [
    'Output engine',
    [
      'The AUDIO tab\'s OUTPUT ENGINE processes audio while it plays (and identically in exports), per voice (V1-V6) and on the master. It is The Good Bits\' output processing: OUTPUT STAGE (Cassette, Reel-to-Reel, Damaged, Vinyl, Boombox, AM Radio, VHS Hi-Fi, Bus Comp, Lathe, Phone Bus), DRIVE (Tape, Tube, Diode, Fuzz) and CRUNCH (bit depth and sample-rate reduction, with no anti-alias filter: the aliasing is part of the sound), plus input and output gain and a TONE low-pass. PRESET gives starting points such as 12-BIT; BYPASS keeps the settings but passes audio unchanged. CLEAN leaves the sound exactly as it is.',
    ],
  ],
  [
    'Export audio',
    [
      'EXPORT (top right) renders WAV files (44.1 kHz, 16-bit, stereo): an ITEM (a theme or a variation, for a number of passes) or the ARRANGEMENT once through, exactly as START or PLAY ARRANGER plays it (the same random choices). It never interrupts playback or changes the project.',
      'OUTPUT: the MASTER mix, one STEM per voice, or both (several files come as one ZIP). Every file starts at the same moment, has the same length (the music plus the shared TAIL) and is never trimmed or normalised, so stems line up in a DAW. BAKE PROCESSING INTO STEMS puts each voice\'s own processing in its stem; master processing is applied to the master file only. Summing the stems rebuilds the mix before master processing; a non-linear master processor cannot be rebuilt from stems.',
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
      'Project files refer to samples but never contain them. DOWNLOAD BUNDLE writes one .anvilpack file with the project and every sample it uses (each once); OPEN FILE reads it on another computer. A project opened without its samples shows them as MISSING until you load them again; those voices play the synth meanwhile.',
    ],
  ],
  [
    'Keyboard',
    [
      'Space start / stop - Return pause / continue (starts when stopped) - Esc stop and reset (or close the window in use) - Shift+Esc panic - G generate the viewed slot - arrows in the slot grid move, Return on a slot plays it - in the Sample Bank list, Up/Down select and A auditions - ? help.',
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
