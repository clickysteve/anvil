# ANVIL user guide: samples, processing and audio export

The rest of ANVIL (themes, variations, accompaniment, arranger, MIDI, clock) is described in
the README and the in-app Help (?). This guide covers internal audio.

## Internal audio and MIDI

ANVIL always sends MIDI to the output chosen in the MIDI tab. Separately, it can play its own
**internal audio** in the browser: switch on **INTERNAL AUDIO** in the AUDIO tab (the MIDI
tab's AUDIO PREVIEW is the same switch). Internal audio is a small synthesiser or samples, and
it is what the Sample Bank, the output engine and Export Audio work with.

External MIDI instruments are never heard through ANVIL, processed or rendered: the browser
does not have their audio. To put them in a recording, record their audio separately.

## Loading samples

1. Press **SAMPLES** (top right) to open the Sample Bank.
2. Click a slot. **V1-V6** belong to voices 1-6. **D1-D7** belong to the seven entries of the
   drum table (Weights tab, DRUM TABLE): a voice playing a drum harmony (D1-D5) takes each
   drum note from the slot of the drum-table entry that produced it, so one drum voice can
   play a whole kit.
3. Press **LOAD…** or drop an audio file onto any slot row. WAV and AIFF are read exactly;
   MP3, OGG, FLAC, M4A and others go through the browser's decoder. Limits: 40 MB, 120 s.
   A file that cannot be read leaves the slot as it was and the status line says why.
4. Set the voice's **SOURCE** to **SAMPLE** (in the Sample Bank for V slots, or in the AUDIO
   tab's VOICE SOURCES). Drum slots play for voices that use a drum harmony and have SOURCE
   set to SAMPLE.

A voice set to SAMPLE plays the internal synth wherever its slot is empty or its sample is
missing, so it never goes silent by accident.

## Slot controls

| Control | Meaning |
|---|---|
| ROOT | The note at which the sample plays at its original speed (C4 = middle C; type a name such as C3, or a number). Higher notes play it faster and higher, lower notes slower and lower, as on a hardware sampler. |
| TUNE, FINE | Transpose in semitones and cents. |
| VOL | 100 = unity, up to 200. |
| PAN | L100 to R100 (C = centre). A mono sample stays at unity level when centred. |
| VEL | How much ANVIL's velocities change the level (100 = fully, 0 = not at all). |
| MODE | **ONE SHOT** plays the whole sample (drums; repeated hits overlap). **GATED** plays while the note is held, then fades over **REL**. **LOOP** repeats LOOP-TO while held, then fades over REL. |
| START, END | Trim the sample (ms; END "end" = to the end). |
| LOOP, TO | The loop region (LOOP mode); an impossible loop loops the whole region. |
| SNAP | Moves START, END and the loop points to the nearest zero crossings, to avoid clicks. |
| MUTE | Silences the slot in the internal audio (MIDI is unaffected). |
| AUDITION | Plays the root note through the voice's processing (in the slot list: **A**). |
| CLEAR | Empties the slot; the sample stays stored until PURGE UNUSED. |

In the slot list, Up/Down select a slot. Esc closes the window you are using; Space and Return
keep driving the transport.

## Sample transformations

**SAMPLE TRANSFORM** (in the Sample Bank) reworks a sample's audio once, with The Good Bits'
STRETCH FX chain, and keeps the original:

- **STRETCH**: a Good Bits stretch character (Clean, Tight, Transient, Punch, Vintage, Loose,
  Choppy, Glitch, Warped, Crushed, Stutter, '93, Cyclic, Cyclic 12-bit, Grain ... Tape), and
  **RATIO %** (output length; 100 = no stretch). Some characters add macro controls.
- **PITCH**: varispeed in semitones (the length changes with it).
- **REVERSE** before or after the stretch; **DRIVE**; **CRUNCH** (bits and rate divide);
  **SEED** for the random engines.

The result is computed in the background, cached, and recomputed only when the settings change.
Transformations are not live effects; for those, use the output engine.

## Output engine

In the AUDIO tab, **OUTPUT ENGINE** processes audio while it plays, and identically in exports.
Choose **MASTER** or a voice (**V1-V6**), then:

- **PRESET**: CLEAN, 12-BIT, BITCRUSH, RATE REDUCE, DRIVE, CASSETTE, VINYL, AM RADIO (starting
  points; everything stays editable).
- **BYPASS** keeps the settings but passes audio unchanged.
- **IN dB / OUT dB**: gain before and after the processing.
- **OUTPUT STAGE**: The Good Bits' characters (Cassette, Reel-to-Reel, Damaged, Vinyl, Boombox,
  AM Radio, VHS Hi-Fi, Bus Comp, Lathe, Phone Bus), with MIX and INT (intensity).
- **DRIVE**: Tape, Tube, Diode or Fuzz, with an amount.
- **CRUNCH**: effective bit depth and sample-rate reduction (every n-th sample held; the
  effective rate is shown). There is no anti-alias filter: the aliasing is part of the sound.
- **TONE**: a gentle low-pass after the chain.

CLEAN leaves the sound exactly as it was. Settings change smoothly while playing. The presets
describe what they do; none claims to be a particular machine.

## Exporting audio

1. Press **EXPORT** (top right).
2. **RANGE**: an **ITEM** (a theme or a variation, with **PASSES**) or the **ARRANGEMENT**
   once through. ANVIL renders exactly what START or PLAY ARRANGER plays, random choices
   included; hand changes made during a live performance are not part of it.
3. **OUTPUT**: **MASTER**, **STEMS** (one per audible voice; **ALL VOICES** includes muted ones,
   which are silent) or **MASTER + STEMS**. **TAIL** adds time after the music for sounds to
   ring out; it is the same for every file.
4. **BAKE PROCESSING INTO STEMS** (on by default) puts each voice's own processing in its stem.
   Master processing is always applied to the master file only.
5. Press **RENDER**. Several files arrive as one ZIP. The window shows each file's peak level
   and how many samples were clipped (ANVIL never normalises).

Files are WAV, 44.1 kHz, 16-bit, stereo, named like `anvil_my-song_ta_master.wav` and
`anvil_my-song_ta_voice-3-drums.wav`. Every file starts at the same moment and has the same
length, so stems line up when dropped into a DAW at bar 1. Summing the stems gives the mix
before master processing; a non-linear master processor (crunch, drive, a character) cannot be
rebuilt from stems.

Rendering does not stop or change playback, MIDI or the project.

## Keeping and moving samples

- Samples are stored in this browser (IndexedDB) and come back after a reload.
- Project files (DOWNLOAD) refer to samples but never contain them.
- **DOWNLOAD BUNDLE** (Project tab) writes one `.anvilpack` file with the project and every
  sample it uses (each once). **OPEN FILE** reads it on any computer.
- A project opened without its samples shows them as **MISSING** in the Sample Bank; those
  voices play the synth until you load the files again.
- **PURGE UNUSED** deletes stored samples that no project saved in this browser uses.
