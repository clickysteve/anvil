# Provenance

ANVIL is an independent, clean-room work inspired by **Dr. T's Tunesmith** by **Jim
Johnson** (published by Dr. T's Music Software). ANVIL is not affiliated with, endorsed by or
connected to Jim Johnson, Dr. T's Music Software or any successor. Product names belong to
their owners and are used only to describe the inspiration.

## What ANVIL contains

All code, text, interface design, names, demos, default values and scale/weight tables in
this repository are original to ANVIL.

ANVIL contains **none** of the following from the original:

- program code or binaries, disassembly or decompiled logic;
- disk images, ROMs or emulator files;
- graphics, fonts, icons, screenshots or screen layouts;
- manual or help text (paraphrased facts are written in ANVIL's own words);
- presets, factory songs, tunes, scale tables or scale names, drum tables, or any data files.

The 38 preset scales are generated from their mathematical definition (all 7-step scales with
steps of one to three semitones, one per rotation class). Accent and rest odds are rounded
proportions measured from the original's MIDI output; they are statistics, not copied data.

## How behaviour was established

See [RESEARCH.md](RESEARCH.md): documents read in full, plus black-box observation of the
running program's MIDI output in an emulator, without inspecting its code. Research
material is kept outside this repository and its history.

## Third-party components

| Component | Licence | Use |
|---|---|---|
| Tiny5 font (via @fontsource/tiny5) | SIL Open Font License 1.1 | titles |
| Silkscreen font (via @fontsource/silkscreen) | SIL Open Font License 1.1 | fallback title face |
| Vite, TypeScript, Vitest, Playwright, happy-dom | MIT / Apache-2.0 | build and tests only |
| fake-indexeddb | Apache-2.0 | unit tests only (IndexedDB sample storage) |
| The Good Bits DSP (`src/core/dsp/vendor/goodbits/`) | MIT, same author as ANVIL | output processing, sample transformations, WAV/AIFF codec |

### The Good Bits

DSP files from The Good Bits (<https://github.com/clickysteve/the-good-bits>, commit
`928353c`) are vendored **verbatim**, keeping Good Bits' directory layout and its licence file.
`vendor.json` records the commit and each file's SHA-256 of the upstream bytes, and
`test/core/vendor.test.ts` fails if any vendored file differs. The only change is one appended
`export` line at the end of `outputstage.js` exposing four existing helpers; the upstream bytes
above it are unchanged. Good Bits' runtime CDN dependencies (essentia.js, JSZip) are not used.
Good Bits deliberately uses generic names for its algorithms; ANVIL keeps them and does not
describe any processor as an emulation of a particular machine.
See [GOOD-BITS-DSP-INVENTORY.md](GOOD-BITS-DSP-INVENTORY.md).

The colour palettes use the same semantic-role idea and palette names (Classic, Dark,
Colour) as the other instruments in the same collection; ANVIL's palette code is its own.

## Repository audit

Performed for this release (commands run against the working tree and history):

- File types: only TypeScript, CSS, HTML, Markdown, JSON and configuration files, the
  vendored Good Bits JavaScript and its licence (`src/core/dsp/vendor/goodbits/`), and the
  one-line `public/CNAME` naming the site's domain. No binaries, images, audio, disk images,
  `.PRG`, `.TUN`, `.MID`, ROM, PDF or archive files; test samples are generated in code.
  (`git ls-files | grep -viE '\.(ts|css|html|md|json|mjs|yml|gitignore|npmrc)$|^LICENSE$|CNAME$|^src/core/dsp/vendor/goodbits/(LICENSE|.*\.js)$'` returns nothing.)
- History: the same check over every commit (`git log --all --name-only`) finds no research
  artefacts.
- Text: no passages from the original manual or help screens. Algorithm and option names
  that appear in the interface ("Second Order A", "Partial fixed", ...) are short functional
  labels used to identify behaviour.
- Demos are generated from ANVIL's own parameters and seeds and are marked as original.

## Licence scope

The MIT licence in [LICENSE](../LICENSE) covers ANVIL's original code and documentation
only. It grants nothing in respect of Tunesmith or any other third-party work, and ANVIL
makes no claim about the copyright or licensing status of the original software.
