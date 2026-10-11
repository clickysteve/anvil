/**
 * SAMPLE BANK window: a compact overview of the thirteen sample slots (V1-V6 for the voices,
 * D1-D7 for the drum-table entries) and the detailed controls of the selected slot. Files can
 * be loaded with LOAD or dropped onto any slot row.
 */
import type { Session } from '../app/session';
import { VOICE_COUNT, voiceName } from '../audio/anvilTimeline';
import { isDrumSlot, SLOT_COUNT, slotLabel } from '../audio/settings';
import { fxLabel } from '../core/dsp/output/settings';
import { MACRO_INFO, stretchCharacters } from '../core/dsp/transform/settings';
import { snapToZeroCrossing, waveformPeaks } from '../core/sampler/edit';
import { noteName, parseNoteName, type PlayMode } from '../core/sampler/zone';
import { HARMONY_DRUM_BASE } from '../engine/types';
import { bind, h, refreshAll, svg } from './dom';
import { button, numField, selectField, toggle } from './widgets';
import { gemWindow, type GemWindow } from './window';

const MODE_TEXT: Record<PlayMode, string> = { oneshot: 'ONE SHOT', gated: 'GATED', loop: 'LOOP' };
const ACCEPT = 'audio/*,.wav,.wave,.aif,.aiff,.aifc,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm';

export function sampleBankWindow(s: Session, openAudioTab: (target: number) => void): GemWindow & { select(slot: number): void } {
  const p = () => s.project;
  let sel = 0;
  let onOpen = () => {};
  const win = gemWindow({ title: 'SAMPLE BANK', testid: 'sample-bank', area: 'voices', width: 640, onOpen: () => onOpen() });
  const fileInput = h('input', { type: 'file', accept: ACCEPT, hidden: true, 'data-testid': 'sample-file' });

  const slotVoice = (i: number) => {
    if (!isDrumSlot(i)) return voiceName(p(), i).toUpperCase();
    const k = i - VOICE_COUNT;
    const n = p().drums[k];
    return `DRUM ${k + 1}${n ? ` (${n})` : ' (off)'}`;
  };
  const sourceText = (i: number) => {
    if (isDrumSlot(i)) {
      const users = p().voices.map((v, n) => (v.harmony >= HARMONY_DRUM_BASE && p().audio.voices[n].source === 'sample' ? n + 1 : 0)).filter(Boolean);
      return users.length ? `V${users.join(',')}` : '—';
    }
    return p().audio.voices[i].source === 'sample' ? 'SAMPLE' : 'SYNTH';
  };

  const loadFile = async (slot: number, f: File) => {
    sel = slot;
    status(`Loading "${f.name}"…`);
    const ok = await s.loadSample(slot, { bytes: await f.arrayBuffer(), name: f.name, type: f.type });
    status(ok ? '' : s.notice, !ok);
    render();
  };
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) void loadFile(sel, f);
  });

  // ------------------------------------------------------------------ overview table
  const tbody = h('tbody', { tabindex: 0, 'aria-label': 'Sample slots (Up/Down select, A auditions)' });
  const rows: HTMLTableRowElement[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const tr = h('tr', { 'data-testid': `slot-row-${slotLabel(i)}`, onclick: () => select(i) });
    tr.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      tr.classList.add('drop');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop'));
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('drop');
      const f = e.dataTransfer?.files?.[0];
      if (f) void loadFile(i, f);
    });
    rows.push(tr);
    tbody.append(tr);
  }
  tbody.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      select(Math.max(0, Math.min(SLOT_COUNT - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      void s.audition(sel);
    }
  });
  const table = h('table', { class: 'slots', 'data-testid': 'slot-table' }, h('thead', {}, h('tr', {}, ...['SLOT', 'VOICE', 'SOURCE', 'SAMPLE', 'LEN', 'ROOT', 'MODE', ''].map((c) => h('th', {}, c)))), tbody);
  const renderRows = () => {
    rows.forEach((tr, i) => {
      const slot = p().audio.slots[i];
      const st = s.library.state(i);
      const name = slot.sampleId ? slot.name : '—';
      const len = st.status === 'ready' ? `${st.duration.toFixed(2)}s` : st.status === 'missing' ? 'MISSING' : st.status === 'error' ? 'ERROR' : st.status === 'loading' || st.status === 'processing' ? '…' : '';
      const cells = [slotLabel(i), slotVoice(i), sourceText(i), name, len, slot.sampleId ? noteName(slot.zone.root) : '', slot.sampleId ? MODE_TEXT[slot.zone.mode] : '', slot.zone.mute && slot.sampleId ? 'M' : ''];
      if (tr.children.length !== cells.length) tr.replaceChildren(...cells.map(() => h('td', {})));
      cells.forEach((c, k) => {
        const td = tr.children[k] as HTMLElement;
        if (td.textContent !== c) td.textContent = c;
        td.classList.toggle('sname', k === 3);
        td.classList.toggle('warn', (k === 4 && (st.status === 'missing' || st.status === 'error')) || k === 7);
      });
      tr.title = slot.sampleId ? slot.name : 'Empty: drop a file here or press LOAD';
      tr.classList.toggle('sel', i === sel);
      tr.setAttribute('aria-selected', String(i === sel));
    });
  };

  // ------------------------------------------------------------------ selected slot
  const head = h('div', { class: 'vtitle', 'data-testid': 'slot-selected' });
  const statusLine = h('div', { class: 'status', 'data-testid': 'slot-status', role: 'status' });
  let statusOverride: { text: string; err: boolean } | null = null;
  const status = (text: string, err = false) => {
    statusOverride = text ? { text, err } : null;
    renderStatus();
  };
  const renderStatus = () => {
    const st = s.library.state(sel);
    const slot = p().audio.slots[sel];
    let text = statusOverride?.text ?? '';
    let err = statusOverride?.err ?? false;
    if (!text) {
      if (!slot.sampleId) text = isDrumSlot(sel) ? 'Empty. Drum voices set to SAMPLE play this slot for drum-table entry ' + (sel - VOICE_COUNT + 1) + '.' : 'Empty. Load or drop a sample; the voice plays its synth until then.';
      else if (st.status === 'ready') text = `${st.duration.toFixed(3)} s  ·  ${st.sampleRate} Hz  ·  ${st.channels === 1 ? 'mono' : 'stereo'}${p().audio.slots[sel].transform.enabled ? '  ·  transformed' : ''}${st.message ? `  ·  ${st.message}` : ''}`;
      else if (st.status === 'processing') text = 'Applying the sample transformation…';
      else if (st.status === 'loading') text = 'Loading…';
      else {
        text = st.message;
        err = true;
      }
    }
    statusLine.textContent = text;
    statusLine.classList.toggle('err', err);
  };

  const sourceSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Voice source' },
    toggle({ label: 'SYNTH', hint: 'This voice plays ANVIL\'s internal synth', get: () => !isDrumSlot(sel) && p().audio.voices[sel].source === 'synth', set: () => s.setVoiceSource(sel, 'synth'), testid: 'source-synth' }),
    toggle({ label: 'SAMPLE', hint: 'This voice plays its sample (and drum voices their drum slots); the synth plays wherever a slot is empty', get: () => !isDrumSlot(sel) && p().audio.voices[sel].source === 'sample', set: () => s.setVoiceSource(sel, 'sample'), testid: 'source-sample' }),
  );
  const sourceRow = h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'SOURCE'), sourceSeg);
  const zone = () => p().audio.slots[sel].zone;
  const has = () => !p().audio.slots[sel].sampleId;
  const ms = (v: number | null) => (v === null ? 'end' : String(Math.round(v * 1000)));
  const parseMs = (x: string) => (x.trim() === '' || x === 'end' ? -1 : Number(x));
  const dur = () => s.library.state(sel).duration || 0;
  const zoneRow1 = h(
    'div',
    { class: 'row wrap' },
    numField({ label: 'ROOT', hint: 'The note at which the sample plays at its original speed (C4 = middle C). Higher notes play faster, lower slower', min: 0, max: 127, get: () => zone().root, set: (v) => s.setSlotZone(sel, { root: v }), format: noteName, parse: parseNoteName, testid: 'z-root', disabled: has }),
    numField({ label: 'TUNE', hint: 'Transpose in semitones', min: -48, max: 48, get: () => zone().tune, set: (v) => s.setSlotZone(sel, { tune: v }), testid: 'z-tune', disabled: has }),
    numField({ label: 'FINE', hint: 'Fine tuning in cents', min: -100, max: 100, get: () => zone().fine, set: (v) => s.setSlotZone(sel, { fine: v }), testid: 'z-fine', disabled: has }),
    numField({ label: 'VOL', hint: 'Volume (100 = unity, up to 200)', min: 0, max: 200, step: 1, big: 10, get: () => Math.round(zone().volume * 100), set: (v) => s.setSlotZone(sel, { volume: v / 100 }), testid: 'z-vol', disabled: has }),
    numField({ label: 'PAN', hint: 'Pan: L100 .. C .. R100', min: -100, max: 100, step: 5, get: () => Math.round(zone().pan * 100), set: (v) => s.setSlotZone(sel, { pan: v / 100 }), format: (v) => (v === 0 ? 'C' : v < 0 ? `L${-v}` : `R${v}`), parse: (x) => (/^c$/i.test(x) ? 0 : /^l/i.test(x) ? -Number(x.slice(1)) : /^r/i.test(x) ? Number(x.slice(1)) : Number(x)), testid: 'z-pan', disabled: has }),
  );
  const zoneRow2 = h(
    'div',
    { class: 'row wrap' },
    selectField<PlayMode>({ label: 'MODE', hint: 'ONE SHOT: whole sample. GATED: while the note is held. LOOP: loops the loop region while held', options: () => [['oneshot', 'ONE SHOT'], ['gated', 'GATED'], ['loop', 'LOOP']], get: () => zone().mode, set: (v) => s.setSlotZone(sel, { mode: v }), testid: 'z-mode', disabled: has }),
    numField({ label: 'REL', hint: 'Release after note-off, ms (GATED and LOOP)', min: 5, max: 5000, step: 5, big: 50, get: () => Math.round(zone().release * 1000), set: (v) => s.setSlotZone(sel, { release: v / 1000 }), testid: 'z-rel', disabled: () => has() || zone().mode === 'oneshot' }),
    numField({ label: 'VEL', hint: 'Velocity sensitivity %: 0 = every note at full level, 100 = ANVIL\'s velocities fully', min: 0, max: 100, step: 5, get: () => Math.round(zone().velocitySens * 100), set: (v) => s.setSlotZone(sel, { velocitySens: v / 100 }), testid: 'z-vel', disabled: has }),
    toggle({ label: 'MUTE', hint: 'Silence this slot in ANVIL\'s internal audio (MIDI is unaffected)', get: () => zone().mute, set: (v) => s.setSlotZone(sel, { mute: v }), testid: 'z-mute', disabled: has }),
  );
  const zoneRow3 = h(
    'div',
    { class: 'row wrap' },
    numField({ label: 'START', hint: 'Play from (ms)', min: 0, max: 600000, step: 1, big: 10, get: () => Math.round(zone().start * 1000), set: (v) => s.setSlotZone(sel, { start: Math.min(v / 1000, dur()) }), testid: 'z-start', disabled: has }),
    numField({ label: 'END', hint: 'Play to (ms); "end" = the end of the sample', min: -1, max: 600000, step: 1, big: 10, get: () => (zone().end === null ? -1 : Math.round(zone().end! * 1000)), set: (v) => s.setSlotZone(sel, { end: v < 0 || v / 1000 >= dur() ? null : v / 1000 }), format: (v) => (v < 0 ? 'end' : String(v)), parse: parseMs, testid: 'z-end', disabled: has }),
    numField({ label: 'LOOP', hint: 'Loop start (ms)', min: 0, max: 600000, step: 1, big: 10, get: () => Math.round(zone().loopStart * 1000), set: (v) => s.setSlotZone(sel, { loopStart: v / 1000 }), testid: 'z-loopstart', disabled: () => has() || zone().mode !== 'loop' }),
    numField({ label: 'TO', hint: 'Loop end (ms); "end" = END', min: -1, max: 600000, step: 1, big: 10, get: () => (zone().loopEnd === null ? -1 : Math.round(zone().loopEnd! * 1000)), set: (v) => s.setSlotZone(sel, { loopEnd: v < 0 ? null : v / 1000 }), format: (v) => ms(v < 0 ? null : v / 1000), parse: parseMs, testid: 'z-loopend', disabled: () => has() || zone().mode !== 'loop' }),
    button('SNAP', 'Move START, END and the loop points to the nearest zero crossings (fewer clicks)', () => {
      const a = s.library.state(sel).audio;
      if (!a) return;
      const z = zone();
      const sn = (t: number) => snapToZeroCrossing(a, t, 0.01);
      s.setSlotZone(sel, { start: z.start > 0 ? sn(z.start) : 0, end: z.end === null ? null : sn(z.end), loopStart: sn(z.loopStart), loopEnd: z.loopEnd === null ? null : sn(z.loopEnd) });
    }, { 'data-testid': 'z-snap' }),
  );
  const wave = svg('svg', { class: 'wave', viewBox: '0 0 400 40', preserveAspectRatio: 'none', 'aria-hidden': 'true', 'data-testid': 'slot-wave' });
  let waveKey = '';
  const renderWave = () => {
    const st = s.library.state(sel);
    const z = zone();
    const key = `${sel}|${st.key}|${st.status}|${JSON.stringify(z)}`;
    if (key === waveKey) return;
    waveKey = key;
    wave.replaceChildren();
    if (st.status !== 'ready' || !st.audio) return;
    const peaks = waveformPeaks(st.audio, 200);
    let d = 'M0 20';
    peaks.forEach((v, i) => (d += ` L${i * 2} ${20 - v * 19}`));
    for (let i = peaks.length - 1; i >= 0; i--) d += ` L${i * 2} ${20 + peaks[i] * 19}`;
    wave.append(svg('path', { class: 'w', d: `${d} Z` }));
    const x = (t: number) => (Math.max(0, Math.min(st.duration, t)) / Math.max(1e-9, st.duration)) * 400;
    if (z.mode === 'loop') wave.append(svg('rect', { class: 'lp', x: x(z.loopStart), y: 0, width: Math.max(1, x(z.loopEnd ?? z.end ?? st.duration) - x(z.loopStart)), height: 40 }));
    for (const t of [z.start, z.end ?? st.duration]) wave.append(svg('line', { class: 'm', x1: x(t), x2: x(t), y1: 0, y2: 40 }));
  };
  const actions = h(
    'div',
    { class: 'row wrap' },
    button('▶ AUDITION', 'Play the sample at its root note through this voice\'s processing (A)', () => void s.audition(sel), { 'data-testid': 'audition' }),
    button('LOAD…', 'Load a sample file into this slot (or drop a file onto any slot)', () => fileInput.click(), { 'data-testid': 'sample-load' }),
    button('CLEAR', 'Empty this slot (the sample stays in browser storage until PURGE)', () => s.clearSlot(sel), { 'data-testid': 'sample-clear' }),
    h('div', { class: 'spacer' }),
    button('PURGE UNUSED', 'Delete stored samples that no project saved in this browser uses', () => void s.purgeUnusedSamples(), { 'data-testid': 'sample-purge' }),
    fileInput,
  );

  // ------------------------------------------------------------------ sample transformation (Good Bits STRETCH FX)
  const tf = () => p().audio.slots[sel].transform;
  const charOptions = (): [string, string][] => stretchCharacters().flatMap((g) => g.characters.map((c): [string, string] => [c.key, `${g.label}: ${c.label}`]));
  const macroBox = h('div', { class: 'row wrap' });
  let macroKey = '';
  const renderMacros = () => {
    const c = stretchCharacters().flatMap((g) => g.characters).find((x) => x.key === tf().character);
    const key = `${sel}|${c?.key}`;
    if (key === macroKey) return;
    macroKey = key;
    macroBox.replaceChildren(
      ...(c?.macros ?? []).map((m) =>
        numField({ label: MACRO_INFO[m].label.toUpperCase(), hint: MACRO_INFO[m].hint, min: 0, max: 100, step: 5, get: () => tf().macros[m] ?? MACRO_INFO[m].default, set: (v) => s.setSlotTransform(sel, { macros: { ...tf().macros, [m]: v } }), disabled: () => has() || !tf().enabled }),
      ),
    );
  };
  const tfDis = () => has() || !tf().enabled;
  const xform = h(
    'details',
    { class: 'xform', 'data-testid': 'xform' },
    h('summary', { hint: 'Change the sample itself before it plays, with The Good Bits\' STRETCH FX chain' }, 'SAMPLE TRANSFORM'),
    h('p', { class: 'note' }, 'Transforms rework the sample\'s audio once (kept with the original, cached, recomputed when changed). They are not live effects: output processing is in the AUDIO tab.'),
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'ON', hint: 'Apply the transformation', get: () => tf().enabled, set: (v) => s.setSlotTransform(sel, { enabled: v }), testid: 'xf-on', disabled: has }),
      selectField<string>({ label: 'STRETCH', hint: 'Good Bits stretch character (generic names, as in Good Bits)', options: charOptions, get: () => tf().character, set: (v) => s.setSlotTransform(sel, { character: v }), testid: 'xf-char', disabled: tfDis }),
      numField({ label: 'RATIO %', hint: 'Time-stretch: output length as % of the input (100 = no stretch)', min: 25, max: 800, step: 5, big: 50, get: () => Math.round(tf().ratio * 100), set: (v) => s.setSlotTransform(sel, { ratio: v / 100 }), testid: 'xf-ratio', disabled: tfDis }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      numField({ label: 'PITCH', hint: 'Varispeed pitch in semitones (the length changes with it)', min: -24, max: 24, get: () => tf().pitch, set: (v) => s.setSlotTransform(sel, { pitch: v }), testid: 'xf-pitch', disabled: tfDis }),
      selectField<string>({ label: 'REVERSE', hint: 'Reverse before or after the stretch', options: () => [['none', 'off'], ['pre', 'before'], ['post', 'after']], get: () => tf().reverse, set: (v) => s.setSlotTransform(sel, { reverse: v as 'none' }), testid: 'xf-rev', disabled: tfDis }),
      numField({ label: 'SEED', hint: 'Seed for the random engines (granular, repeat, spectral)', min: 0, max: 99999, get: () => tf().seed, set: (v) => s.setSlotTransform(sel, { seed: v }), disabled: tfDis }),
    ),
    macroBox,
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'DRIVE', hint: 'Good Bits drive', get: () => tf().drive.enabled, set: (v) => s.setSlotTransform(sel, { drive: { ...tf().drive, enabled: v } }), disabled: tfDis }),
      selectField<string>({ label: 'TYPE', hint: 'Drive shape', options: () => [['tape', 'Tape'], ['tube', 'Tube'], ['diode', 'Diode'], ['fuzz', 'Fuzz']], get: () => tf().drive.type, set: (v) => s.setSlotTransform(sel, { drive: { ...tf().drive, type: v } }), disabled: tfDis }),
      numField({ label: 'AMT', hint: 'Drive amount %', min: 0, max: 100, step: 5, get: () => tf().drive.amountPct, set: (v) => s.setSlotTransform(sel, { drive: { ...tf().drive, amountPct: v } }), disabled: tfDis }),
      toggle({ label: 'CRUNCH', hint: 'Good Bits crunch: bit depth and sample-rate divide', get: () => tf().crunch.enabled, set: (v) => s.setSlotTransform(sel, { crunch: { ...tf().crunch, enabled: v } }), disabled: tfDis }),
      numField({ label: 'BITS', hint: 'Bit depth (16 = none)', min: 1, max: 16, get: () => tf().crunch.bits, set: (v) => s.setSlotTransform(sel, { crunch: { ...tf().crunch, bits: v } }), disabled: tfDis }),
      numField({ label: 'RATE ÷', hint: 'Hold every n-th sample (1 = none)', min: 1, max: 32, get: () => tf().crunch.rateDivide, set: (v) => s.setSlotTransform(sel, { crunch: { ...tf().crunch, rateDivide: v } }), disabled: tfDis }),
    ),
  );

  // ------------------------------------------------------------------ processing summary
  const voiceEng = h('span', { class: 'englabel', 'data-testid': 'voice-engine-label' });
  const masterEng = h('span', { class: 'englabel', 'data-testid': 'master-engine-label' });
  const voiceEngRow = h('div', { class: 'engrow' }, h('span', { class: 'lbl' }, 'VOICE ENGINE'), voiceEng, button('EDIT', 'Edit this voice\'s output processing (AUDIO tab)', () => openAudioTab(isDrumSlot(sel) ? 0 : sel + 1)));
  const engines = h(
    'div',
    { class: 'slotdetail' },
    voiceEngRow,
    h(
      'div',
      { class: 'engrow' },
      h('span', { class: 'lbl' }, 'OUTPUT ENGINE'),
      masterEng,
      button('EDIT', 'Edit the master output processing (AUDIO tab)', () => openAudioTab(0), { 'data-testid': 'master-edit' }),
      toggle({ label: 'BYPASS', hint: 'Bypass the master processing (settings are kept)', get: () => p().audio.master.bypass, set: (v) => s.setMasterFx({ ...p().audio.master, bypass: v }), testid: 'master-bypass' }),
    ),
  );

  const detail = h('div', { class: 'slotdetail' }, head, sourceRow, zoneRow1, zoneRow2, zoneRow3, wave, statusLine, actions, xform);
  win.body.append(table, detail, engines);

  const render = () => {
    renderRows();
    head.textContent = `SELECTED: ${slotLabel(sel)} / ${slotVoice(sel)}${p().audio.slots[sel].sampleId ? `  ·  ${p().audio.slots[sel].name}` : ''}`;
    sourceRow.hidden = isDrumSlot(sel);
    voiceEngRow.hidden = isDrumSlot(sel);
    voiceEng.textContent = isDrumSlot(sel) ? '' : fxLabel(p().audio.voices[sel].fx);
    masterEng.textContent = fxLabel(p().audio.master);
    renderStatus();
    renderWave();
    renderMacros();
  };
  function select(i: number): void {
    sel = i;
    statusOverride = null;
    refreshAll();
  }
  bind(() => {
    if (win.isOpen) render();
  });
  onOpen = render;
  return Object.assign(win, { select });
}
