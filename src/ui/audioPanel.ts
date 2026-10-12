/**
 * The AUDIO tab: internal audio on/off, which source each voice plays, and the OUTPUT ENGINE
 * editor for the master and each voice (Good Bits output processing: output stage, drive,
 * crunch, plus gain and tone).
 */
import type { Session } from '../app/session';
import { VOICE_COUNT } from '../audio/anvilTimeline';
import { DRIVE_SHAPES, FX_PRESETS, fxLabel, matchPreset, OUTPUT_STAGE_MODES, type OutputFxSettings } from '@slopfactory/core/dsp';
import { bind, h, refreshAll } from './dom';
import { button, numField, selectField, toggle } from './widgets';

export interface AudioPanel {
  el: HTMLElement;
  /** 0 = master, 1-6 = voice */
  target(t: number): void;
}

export function audioPanel(s: Session, open: { bank: () => void; export: () => void }): AudioPanel {
  const p = () => s.project;
  let target = 0;
  const fx = (): OutputFxSettings => (target === 0 ? p().audio.master : p().audio.voices[target - 1].fx);
  const setFx = (f: OutputFxSettings) => (target === 0 ? s.setMasterFx(f) : s.setVoiceFx(target - 1, f));
  const patch = <K extends keyof OutputFxSettings>(k: K, v: Partial<OutputFxSettings[K]> | OutputFxSettings[K]) =>
    setFx({ ...fx(), [k]: typeof v === 'object' && v !== null ? { ...(fx()[k] as object), ...v } : v } as OutputFxSettings);

  const sources = h(
    'table',
    { class: 'voices', 'data-testid': 'voice-sources' },
    h('thead', {}, h('tr', {}, ...['#', 'SOURCE', 'ENGINE'].map((c) => h('th', {}, c)))),
    h(
      'tbody',
      {},
      ...Array.from({ length: VOICE_COUNT }, (_, i) => {
        const eng = h('span', { class: 'lbl' });
        bind(() => (eng.textContent = fxLabel(p().audio.voices[i].fx)));
        return h(
          'tr',
          {},
          h('td', {}, h('span', { class: 'vnum' }, String(i + 1))),
          h(
            'td',
            {},
            h(
              'div',
              { class: 'seg' },
              toggle({ label: 'SYNTH', hint: `Voice ${i + 1} plays the internal synth`, get: () => p().audio.voices[i].source === 'synth', set: () => s.setVoiceSource(i, 'synth'), testid: `src-v${i + 1}-synth` }),
              toggle({ label: 'SAMPLE', hint: `Voice ${i + 1} plays its sample slot (drum notes: their drum slots); the synth fills in for empty slots`, get: () => p().audio.voices[i].source === 'sample', set: () => s.setVoiceSource(i, 'sample'), testid: `src-v${i + 1}-sample` }),
            ),
          ),
          h('td', {}, eng),
        );
      }),
    ),
  );

  const targetSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Processor', 'data-testid': 'fx-target' },
    ...['MASTER', ...Array.from({ length: VOICE_COUNT }, (_, i) => `V${i + 1}`)].map((label, t) =>
      toggle({ label, hint: t === 0 ? 'Master processing: applied to the whole internal mix' : `Voice ${t} processing`, get: () => target === t, set: () => setTarget(t), testid: `fx-target-${label.toLowerCase()}` }),
    ),
  );
  const processingNote = h('p', { class: 'note warn', 'data-testid': 'fx-unavailable' });
  bind(() => {
    processingNote.hidden = !(s.preview.enabled && !s.preview.processing);
    processingNote.textContent = 'This browser cannot run the output processors (AudioWorklet needs https or localhost): audio plays unprocessed.';
  });
  const dis = () => fx().bypass;
  const crunchRate = h('span', { class: 'lbl', 'data-testid': 'fx-rate-hz' });
  bind(() => (crunchRate.textContent = fx().crunch.enabled && fx().crunch.rateDivide > 1 ? `≈${Math.round((s.preview.ctx?.sampleRate ?? 44100) / fx().crunch.rateDivide)} Hz` : ''));

  const editor = h(
    'div',
    { 'data-testid': 'fx-editor' },
    h('div', { class: 'row wrap' }, targetSeg),
    h(
      'div',
      { class: 'row wrap' },
      selectField<string>({
        label: 'PRESET',
        hint: 'Starting points; every setting below stays editable',
        options: () => [['', '(custom)'], ...FX_PRESETS.map((x): [string, string] => [x.key, x.label])],
        get: () => matchPreset(fx()) ?? '',
        set: (k) => {
          const pr = FX_PRESETS.find((x) => x.key === k);
          if (pr) setFx({ ...pr.apply(fx()), bypass: false });
        },
        testid: 'fx-preset',
      }),
      toggle({ label: 'BYPASS', hint: 'Pass audio through unchanged (settings kept)', get: () => fx().bypass, set: (v) => patch('bypass', v), testid: 'fx-bypass' }),
      numField({ label: 'IN dB', hint: 'Gain before processing', min: -24, max: 24, step: 0.5, big: 3, get: () => fx().inDb, set: (v) => patch('inDb', v), testid: 'fx-in', disabled: dis }),
      numField({ label: 'OUT dB', hint: 'Gain after processing', min: -24, max: 24, step: 0.5, big: 3, get: () => fx().outDb, set: (v) => patch('outDb', v), testid: 'fx-out', disabled: dis }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'OUTPUT STAGE', hint: 'Good Bits output-stage character', get: () => fx().outputStage.enabled, set: (v) => patch('outputStage', { enabled: v }), testid: 'fx-stage', disabled: dis }),
      selectField<string>({ label: 'MODE', hint: 'Character mode (Good Bits names)', options: () => OUTPUT_STAGE_MODES.map((m): [string, string] => [m.key, m.label]), get: () => fx().outputStage.mode, set: (v) => patch('outputStage', { mode: v }), testid: 'fx-stage-mode', disabled: dis }),
      numField({ label: 'MIX', hint: 'Wet/dry mix %', min: 0, max: 100, step: 5, get: () => fx().outputStage.mixPct, set: (v) => patch('outputStage', { mixPct: v }), disabled: dis }),
      numField({ label: 'INT', hint: 'Intensity %', min: 0, max: 100, step: 5, get: () => fx().outputStage.intensityPct, set: (v) => patch('outputStage', { intensityPct: v }), disabled: dis }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'DRIVE', hint: 'Good Bits drive (saturation)', get: () => fx().drive.enabled, set: (v) => patch('drive', { enabled: v }), testid: 'fx-drive', disabled: dis }),
      selectField<string>({ label: 'TYPE', hint: 'Drive shape', options: () => DRIVE_SHAPES.map((m): [string, string] => [m.key, m.label]), get: () => fx().drive.type, set: (v) => patch('drive', { type: v }), disabled: dis }),
      numField({ label: 'AMT', hint: 'Drive amount %', min: 0, max: 100, step: 5, get: () => fx().drive.amountPct, set: (v) => patch('drive', { amountPct: v }), testid: 'fx-drive-amt', disabled: dis }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'CRUNCH', hint: 'Good Bits crunch: bit-depth reduction and sample-and-hold rate reduction (no anti-alias filter: aliasing is part of the sound)', get: () => fx().crunch.enabled, set: (v) => patch('crunch', { enabled: v }), testid: 'fx-crunch', disabled: dis }),
      numField({ label: 'BITS', hint: 'Effective bit depth (16 = none)', min: 1, max: 16, get: () => fx().crunch.bits, set: (v) => patch('crunch', { bits: v }), testid: 'fx-bits', disabled: dis }),
      numField({ label: 'RATE ÷', hint: 'Hold every n-th sample (1 = none)', min: 1, max: 32, get: () => fx().crunch.rateDivide, set: (v) => patch('crunch', { rateDivide: v }), testid: 'fx-rate', disabled: dis }),
      crunchRate,
    ),
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'TONE', hint: 'One-pole low-pass after the chain (Good Bits filter)', get: () => fx().tone.enabled, set: (v) => patch('tone', { enabled: v }), testid: 'fx-tone', disabled: dis }),
      numField({ label: 'Hz', hint: 'Tone cutoff', min: 200, max: 20000, step: 100, big: 1000, get: () => fx().tone.hz, set: (v) => patch('tone', { hz: v }), disabled: dis }),
    ),
    processingNote,
  );

  const el = h(
    'div',
    {},
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'INTERNAL AUDIO', hint: 'Hear ANVIL\'s internal synth and samples in the browser (MIDI output is unaffected)', get: () => s.preview.enabled, set: (v) => void s.setAudioPreview(v), testid: 'audio-on' }),
      button('SAMPLE BANK…', 'Open the Sample Bank window', () => open.bank(), { 'data-testid': 'open-sample-bank' }),
      button('EXPORT AUDIO…', 'Open the Export Audio window', () => open.export(), { 'data-testid': 'open-export' }),
    ),
    h('h3', {}, 'VOICE SOURCES'),
    sources,
    h('h3', {}, 'OUTPUT ENGINE'),
    editor,
    h('p', { class: 'note' }, 'Output processing runs live and in exports (the same code). Sample transformations, which change a sample\'s audio once, are in the Sample Bank. External MIDI instruments are never processed or rendered by ANVIL.'),
  );

  function setTarget(t: number): void {
    target = t;
    refreshAll();
  }
  return { el, target: setTarget };
}
