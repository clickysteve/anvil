/**
 * The ANVIL interface. A thin view over the Session: every control calls a Session method,
 * and after every change all bound widgets refresh from the session state.
 */
import type { Session } from '../app/session';
import { DEMOS } from '../app/demos';
import { ALGORITHMS } from '../engine/algorithms';
import { entriesFromOctave, KEY_NAMES, PRESET_SCALES, SCALE_COUNT, scaleName } from '../engine/tonality';
import { HARMONY_DRUM_BASE, ITEM_IDS, type ItemId, type TVParams, type Voice } from '../engine/types';
import { isVariation } from '../engine/theme';
import { bind, clear, download, h, refreshAll, svg, typing } from './dom';
import { helpDialog } from './help';
import { ACC_RHYTHMS, ARTS, clocksLabel, degreeName, DIVIDES, HARMONIES, microbeatLabel, parseDegree, PITCH_VARS, RHYTHM_ALGS, RHYTHM_VARS } from './labels';
import { applyPalette, contrastWarnings, PaletteLibrary, ROLE_INFO, ROLES, type Role } from './palette';
import { drawTheme } from './themeView';
import { button, group, numField, panel, presetStrip, selectField, toggle } from './widgets';

const STATE_TEXT = { stopped: 'STOPPED', running: 'RUNNING', paused: 'PAUSED', armed: 'ARMED' } as const;
const EXT_TEXT = { off: '', waiting: 'WAITING', detected: 'CLOCK DETECTED', running: 'RUNNING', stopped: 'STOPPED', lost: 'CLOCK LOST' } as const;

export function mountApp(root: HTMLElement, s: Session, palettes: PaletteLibrary): void {
  const p = () => s.project;
  const help = helpDialog();

  const applyCurrentPalette = () => applyPalette(palettes.find(s.prefs.palette).colors);
  applyCurrentPalette();

  // ------------------------------------------------------------------ header
  const nameInput = h('input', {
    class: 'pname',
    type: 'text',
    'aria-label': 'Project name',
    hint: 'Project name (used for saving and file names)',
    'data-testid': 'project-name',
    onchange: () => s.rename(nameInput.value),
  });
  bind(() => {
    if (document.activeElement !== nameInput) nameInput.value = p().name;
  });
  const modeSwitch = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Mode', hint: 'Classic: the reconstructed original behaviour. Extended: extra tools on the same engine.' },
    toggle({ label: 'CLASSIC', hint: 'Classic mode', get: () => p().mode === 'classic', set: () => s.setMode('classic'), testid: 'mode-classic' }),
    toggle({ label: 'EXTENDED', hint: 'Extended mode', get: () => p().mode === 'extended', set: () => s.setMode('extended'), testid: 'mode-extended' }),
  );
  const midiChip = h('span', { class: 'chip', 'data-testid': 'midi-status', hint: 'MIDI output status' });
  bind(() => {
    const st = s.midi.status;
    const out = s.router.notePort;
    midiChip.textContent = st === 'unsupported' ? 'NO WEB MIDI' : st === 'denied' ? 'MIDI BLOCKED' : st === 'pending' ? 'MIDI …' : out ? `OUT ${out.name}` : 'NO OUTPUT';
    midiChip.classList.toggle('warn', st !== 'ready' || !out);
  });
  const header = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand', hint: 'ANVIL: themes, variations, accompaniment' }, h('span', { class: 'mark' }, 'ANVIL'), h('span', { class: 'sub' }, 'theme · variation · accompaniment')),
    nameInput,
    modeSwitch,
    h('div', { class: 'spacer' }),
    midiChip,
    selectField({
      label: 'Palette',
      hint: 'Colour palette (a preference of this browser, not part of the project)',
      options: () => palettes.all().map((x) => [x.id, x.name]),
      get: () => s.prefs.palette,
      set: (v) => {
        s.setPrefs({ palette: v });
        applyCurrentPalette();
      },
      testid: 'palette',
    }),
    button('?', 'Help (?)', () => help.showModal(), { class: 'helpbtn', 'aria-label': 'Help', 'data-testid': 'help' }),
  );

  // ------------------------------------------------------------------ transport
  const stateBox = h('div', { class: 'state', 'data-testid': 'transport-state', role: 'status', 'aria-live': 'polite' });
  const posBox = h('div', { class: 'pos', 'data-testid': 'position' });
  const extBox = h('div', { class: 'ext', 'data-testid': 'clock-status' });
  const tbtn = (label: string, hint: string, fn: () => void, id: string) => button(label, hint, fn, { class: 'tbtn', 'data-testid': id });
  const transport = h(
    'section',
    { class: 'transport', 'data-area': 'transport', 'aria-label': 'Transport' },
    tbtn('▶ START', 'Start from the beginning (Space when stopped)', () => s.start(), 'start'),
    tbtn('❚❚ PAUSE', 'Pause in place (Space while running)', () => s.pause(), 'pause'),
    tbtn('▶▶ CONTINUE', 'Continue from the paused position (Space while paused)', () => s.cont(), 'continue'),
    tbtn('■ STOP/RESET', 'Stop and return to the beginning (Esc)', () => s.stop(), 'stop'),
    tbtn('ONCE', 'Play the theme once, then stop', () => s.playOnce(), 'once'),
    tbtn('END', 'Stop at the end of the current theme', () => s.stopAtEnd(), 'end'),
    stateBox,
    numField({ label: 'TEMPO', hint: 'Tempo in BPM for the internal clock (Shift: steps of 10)', min: 20, max: 400, step: 1, get: () => p().tempo, set: (v) => s.setTempo(v), testid: 'tempo', disabled: () => s.transport.source === 'external' }),
    selectField<'internal' | 'external'>({
      label: 'CLOCK',
      hint: 'Clock source: Internal (ANVIL keeps time) or External (follow MIDI clock from the input chosen in the MIDI tab)',
      options: () => [['internal', 'Internal'], ['external', 'External']],
      get: () => s.transport.source,
      set: (v) => s.setClockSource(v),
      testid: 'clock-source',
    }),
    toggle({ label: 'CLOCK OUT', hint: 'Send MIDI clock, Start, Continue and Stop (internal clock only)', get: () => s.transport.clockOut, set: (v) => s.setClockOut(v), testid: 'clock-out', disabled: () => s.transport.source === 'external' }),
    extBox,
    posBox,
    h('div', { class: 'spacer' }),
    button('PANIC', 'All notes off on every channel (Shift+Esc)', () => s.panic(), { class: 'tbtn panic', 'data-testid': 'panic' }),
  );
  const updateTransport = () => {
    const st = s.transport.state;
    stateBox.textContent = STATE_TEXT[st];
    stateBox.className = 'state ' + st;
    const ext = s.transport.external;
    if (s.transport.source === 'external') {
      extBox.textContent = `${EXT_TEXT[ext.status]}${ext.bpm ? ` ~${ext.bpm.toFixed(1)} BPM` : ''}`;
      extBox.className = 'ext ' + ext.status;
    } else {
      extBox.textContent = s.transport.clockOut ? 'CLOCK OUT ON' : '';
      extBox.className = 'ext';
    }
    const seq = s.seq;
    const playing = st === 'running' || st === 'paused';
    const t = seq.theme;
    const left = t ? Math.ceil(seq.left / t.microbeat) : 0;
    posBox.textContent = playing && seq.item
      ? `${seq.item}${seq.queued ? ` → ${seq.queued}` : ''}  pass ${seq.pass + 1}  left ${left}${seq.arrangerPlaying ? `  step ${seq.arrangerIndex + 1}` : ''}`
      : `${p().selected} ready`;
    for (const [id, en] of [
      ['pause', st === 'running' || st === 'armed'],
      ['continue', st === 'paused' || (s.transport.source === 'external' && st !== 'running')],
      ['end', st === 'running'],
    ] as const) (transport.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).disabled = !en;
  };

  // ------------------------------------------------------------------ constraints
  const prm = <K extends keyof TVParams>(k: K, label: string, hint: string, min: number, max: number, extra: Partial<Parameters<typeof numField>[0]> = {}) =>
    numField({ label, hint, min, max, get: () => p().params[k] as number, set: (v) => s.setParam(k, v as TVParams[K]), testid: `p-${k}`, ...extra });
  const constraints = panel(
    'constraints',
    'CONSTRAINTS',
    group(
      'RHYTHM',
      prm('microbeat', 'Microbeat', 'Smallest note value, in MIDI clocks (24 = quarter, 6 = sixteenth)', 1, 96, { format: microbeatLabel, parse: (x) => parseInt(x, 10) }),
      prm('length', 'Length', 'Theme length in microbeats', 1, 256, { big: 8 }),
      prm('pulse', 'Pulse', 'Every Pulse-th microbeat is strong: accents and the Onbeat weight table apply there', 1, 16),
      prm('rest', 'Rest %', 'Chance of rests while building microrhythms', 0, 99, { big: 10 }),
      selectField({ label: 'Algorithm', hint: 'Rhythm algorithm: how microrhythms are made and combined', options: () => RHYTHM_ALGS.map((n, i) => [i + 1, `${i + 1} ${n}`]), get: () => p().params.rhythmAlg, set: (v) => s.setParam('rhythmAlg', v), testid: 'p-rhythmAlg' }),
      prm('rhythmVariant', 'Variant', 'Second Order: number of different microrhythms. Single/Preset: microrhythm length in pulses', 1, 16),
    ),
    group(
      'PITCH',
      prm('firstNote', 'First note', 'Scale position of the first note (0 = free)', 0, 7, { format: (v) => (v === 0 ? 'free' : String(v)), parse: (x) => (x === 'free' ? 0 : Number(x)) }),
      prm('pitchLoop', 'Pitch loop', 'Repeat the first N pitches (99 = no loop)', 1, 99, { format: (v) => (v >= 99 ? 'off' : String(v)), parse: (x) => (x === 'off' ? 99 : Number(x)) }),
      prm('low', 'Low', 'Lowest scale degree (named as in C major)', 0, 69, { format: degreeName, parse: parseDegree, big: 7 }),
      prm('high', 'High', 'Highest scale degree (named as in C major)', 0, 69, { format: degreeName, parse: parseDegree, big: 7 }),
      prm('maxStep', 'Max step', 'After an interval larger than this (in degrees), the next interval is at most this', 1, 69),
      prm('maxLeap', 'Max leap', 'Largest interval, in degrees', 1, 69),
      prm('maxRepeats', 'Max repeats', 'Most identical notes in a row', 1, 99),
      prm('onbeatTable', 'Onbeat W', 'Scale-weight table for notes starting on a pulse (see Weights tab)', 1, 8),
      prm('offbeatTable', 'Offbeat W', 'Scale-weight table for notes starting off the pulse', 1, 8),
    ),
    group(
      'VARIATION',
      selectField({ label: 'Rhythm var', hint: 'How a variation changes the rhythm of its theme', options: () => RHYTHM_VARS.map((n, i) => [i, `${i} ${n}`]), get: () => p().params.rhythmVarAlg, set: (v) => s.setParam('rhythmVarAlg', v), testid: 'p-rhythmVarAlg' }),
      selectField({ label: 'Pitch var', hint: 'How a variation changes the pitches of its theme', options: () => PITCH_VARS.map((n, i) => [i, `${i} ${n}`]), get: () => p().params.pitchVarAlg, set: (v) => s.setParam('pitchVarAlg', v), testid: 'p-pitchVarAlg' }),
      prm('varVariant', 'Variant V', 'V for the variation algorithms (0 = all pitches)', 0, 99, { format: (v) => (v === 0 ? 'all' : String(v)) }),
    ),
    presetStrip({
      label: 'T&V',
      hint: 'Theme parameter presets A-Z: click recalls (or stores into an empty slot), Shift-click stores, Alt-click clears',
      has: (i) => !!p().tvPresets[i],
      recall: (i) => s.recallTvPreset(i),
      store: (i) => s.storeTvPreset(i),
      remove: (i) => s.deleteTvPreset(i),
      testid: 'tv-presets',
    }),
  );

  // ------------------------------------------------------------------ bank
  const grid = h('div', { class: 'bankgrid', role: 'grid', 'aria-label': 'Themes and variations', 'data-testid': 'bank' });
  const cells = new Map<ItemId, { btn: HTMLButtonElement; mini: SVGSVGElement }>();
  grid.append(h('div', { class: 'colhead' }), ...['THEME', 'VAR 1', 'VAR 2', 'VAR 3'].map((c) => h('div', { class: 'colhead' }, c)));
  ITEM_IDS.forEach((id, n) => {
    if (n % 4 === 0) grid.append(h('div', { class: 'rowhead' }, id[1]));
    const mini = svg('svg', { class: 'mini', 'aria-hidden': 'true' });
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'slot',
        'data-id': id,
        'data-testid': `slot-${id}`,
        tabindex: id === 'TA' ? 0 : -1,
        hint: `${id}: click to play (Shift: switch now), double-click / right-click / G to generate, Ctrl-click to copy the viewed item here, Alt-click to view only`,
        onclick: (e: MouseEvent) => {
          if (e.ctrlKey || e.metaKey) s.copyItem(s.focus, id);
          else if (e.altKey) s.view(id);
          else s.select(id, e.shiftKey);
        },
        ondblclick: () => s.generate(id),
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          s.generate(id);
          s.select(id);
        },
      },
      h('span', { class: 'sid' }, id),
      mini,
      h('span', { class: 'badges' }),
    );
    cells.set(id, { btn, mini });
    grid.append(btn);
  });
  grid.addEventListener('keydown', (e) => {
    const cur = (document.activeElement as HTMLElement)?.dataset?.id as ItemId | undefined;
    if (!cur) return;
    const i = ITEM_IDS.indexOf(cur);
    const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
    if (e.key in move) {
      e.preventDefault();
      const j = Math.max(0, Math.min(19, i + move[e.key]));
      const next = cells.get(ITEM_IDS[j])!.btn;
      cells.forEach((c) => (c.btn.tabIndex = -1));
      next.tabIndex = 0;
      next.focus();
      s.view(ITEM_IDS[j]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      s.select(cur, e.shiftKey);
    }
  });
  const miniKeys = new Map<ItemId, unknown>();
  const renderBank = () => {
    for (const id of ITEM_IDS) {
      const c = cells.get(id)!;
      const t = p().bank[id];
      if (miniKeys.get(id) !== t) {
        miniKeys.set(id, t);
        drawTheme(c.mini, t, { width: 84, height: 26, mini: true });
      }
      const playing = (s.transport.state === 'running' || s.transport.state === 'paused') && s.seq.item === id;
      c.btn.classList.toggle('empty', !t);
      c.btn.classList.toggle('playing', playing);
      c.btn.classList.toggle('queued', s.seq.queued === id || (!playing && s.transport.state === 'stopped' && p().selected === id));
      c.btn.classList.toggle('focus', s.focus === id);
      c.btn.setAttribute('aria-pressed', String(s.focus === id));
      const badges = c.btn.querySelector('.badges')!;
      badges.textContent = playing ? '▶' : s.seq.queued === id ? '◆' : '';
    }
  };
  let copyTarget: ItemId = 'TB';
  const bankActions = h(
    'div',
    { class: 'actions' },
    button('GENERATE', 'Generate a new theme or variation in the viewed slot with the current constraints (G)', () => s.generate(s.focus), { 'data-testid': 'generate' }),
    button('PLAY THIS', 'Play the viewed slot next (Shift: switch now)', (e) => s.select(s.focus, e.shiftKey), { 'data-testid': 'play-this' }),
    selectField<ItemId>({ label: 'Copy to', hint: 'Target slot for Copy', options: () => ITEM_IDS.map((i) => [i, i]), get: () => copyTarget, set: (v) => (copyTarget = v) }),
    button('COPY', 'Copy the viewed item to the chosen slot', () => s.copyItem(s.focus, copyTarget), { 'data-testid': 'copy' }),
    button('CLEAR', 'Empty the viewed slot', () => s.clearItem(s.focus), { 'data-testid': 'clear' }),
  );

  // ------------------------------------------------------------------ theme view
  const viewSvg = svg('svg', { class: 'roll', role: 'img', 'aria-label': 'Theme view' });
  const viewBox = h('div', { class: 'rollwrap', tabindex: 0, 'data-testid': 'theme-view', hint: 'Click a note to select it. Up/Down pitch (Shift: octave), A accent, R rest, [ ] length, Left/Right select' }, viewSvg);
  const viewTitle = h('div', { class: 'vtitle', 'data-testid': 'view-title' });
  const viewInfo = h('div', { class: 'vinfo', 'data-testid': 'view-info' });
  let xOf: (mb: number) => number = () => 0;
  let lastViewKey = '';
  const renderView = (force = false) => {
    const t = s.focused;
    const cmp = s.isExtended && s.compare ? p().bank[s.compare] ?? null : null;
    const width = Math.max(320, viewBox.clientWidth || 640);
    const key = JSON.stringify([s.focus, t?.events, t?.cells, s.selectedEvent, p().extended.locks[s.focus], cmp?.events, width, s.isExtended]);
    if (!force && key === lastViewKey) return;
    lastViewKey = key;
    xOf = drawTheme(viewSvg, t, { width, height: 210, selected: s.selectedEvent, locks: s.isExtended ? p().extended.locks[s.focus] : [], compare: cmp }).x;
    viewTitle.textContent = `THEME VIEW  ${s.focus}${isVariation(s.focus) ? ` (variation of T${s.focus[1]})` : ''}${cmp ? `  compared with ${s.compare}` : ''}`;
    if (!t) viewInfo.textContent = 'Empty slot.';
    else {
      const notes = t.events.filter((e) => !e.rest).length;
      const sel = s.selectedEvent !== null ? t.events[s.selectedEvent] : null;
      const selText = sel ? `  ·  event ${s.selectedEvent! + 1}: ${sel.rest ? 'rest' : degreeName(sel.degree) + ' ' + (sel.accent === 1 ? 'accented' : sel.accent === 0 ? 'normal' : 'de-accented')}, ${sel.len} mb` : '';
      const origin = t.origin.kind === 'generated' ? 'generated' : `${t.origin.kind}${t.origin.from ? ' from ' + t.origin.from : ''}${t.origin.note ? ': ' + t.origin.note : ''}`;
      viewInfo.textContent = `${notes} notes, ${t.events.length - notes} rests, ${t.length} microbeats of ${t.microbeat} clocks, pulse ${t.pulse}  ·  ${origin}${s.isExtended ? `  ·  seed ${t.seed}` : ''}${selText}`;
    }
  };
  viewSvg.addEventListener('click', (e) => {
    const tgt = e.target as Element;
    const i = tgt.getAttribute('data-i');
    s.selectEvent(i === null ? null : Number(i));
    viewBox.focus();
  });
  viewBox.addEventListener('keydown', (e) => {
    const t = s.focused;
    if (!t) return;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const n = t.events.length;
      const cur = s.selectedEvent ?? (k === 'ArrowRight' ? -1 : n);
      s.selectEvent(Math.max(0, Math.min(n - 1, cur + (k === 'ArrowRight' ? 1 : -1))));
    } else if (k === 'ArrowUp') s.editEvent(e.shiftKey ? 'octaveUp' : 'up');
    else if (k === 'ArrowDown') s.editEvent(e.shiftKey ? 'octaveDown' : 'down');
    else if (k === 'a' || k === 'A') s.editEvent('accent');
    else if (k === 'r' || k === 'R') s.editEvent('rest');
    else if (k === ']') s.editEvent('longer');
    else if (k === '[') s.editEvent('shorter');
    else if ((k === 'l' || k === 'L') && s.isExtended) s.toggleLock();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  const editBar = h(
    'div',
    { class: 'actions edit' },
    h('span', { class: 'lbl' }, 'EDIT'),
    button('▲', 'Selected note up a degree (Up)', () => s.editEvent('up'), { 'data-testid': 'ed-up' }),
    button('▼', 'Selected note down a degree (Down)', () => s.editEvent('down'), { 'data-testid': 'ed-down' }),
    button('8va▲', 'Selected note up an octave (Shift+Up)', () => s.editEvent('octaveUp')),
    button('8va▼', 'Selected note down an octave (Shift+Down)', () => s.editEvent('octaveDown')),
    button('ACCENT', 'Cycle accent: accented, normal, de-accented (A)', () => s.editEvent('accent'), { 'data-testid': 'ed-accent' }),
    button('REST', 'Turn the selected note into a rest, or a rest into a note (R)', () => s.editEvent('rest'), { 'data-testid': 'ed-rest' }),
    button('−LEN', 'Shorten the selected event by a microbeat ([)', () => s.editEvent('shorter')),
    button('+LEN', 'Lengthen the selected event by a microbeat (])', () => s.editEvent('longer')),
    button('TRANSP −', 'Transpose the whole item down a degree', () => s.transposeFocused(-1)),
    button('TRANSP +', 'Transpose the whole item up a degree', () => s.transposeFocused(1)),
  );
  const bank = panel('bank', 'THEMES & VARIATIONS', grid, bankActions, h('div', { class: 'viewhead' }, viewTitle), viewBox, viewInfo, editBar);

  // ------------------------------------------------------------------ tonality
  const userScaleBox = h('div', { class: 'userscale' });
  const tonality = panel(
    'tonality',
    'TONALITY',
    h(
      'div',
      { class: 'row' },
      selectField({
        label: 'Scale',
        hint: '38 preset scales (every 7-note scale with steps of 1-3 semitones) and 8 user scales',
        options: () => Array.from({ length: SCALE_COUNT }, (_, i) => [i, `${i + 1} ${scaleName(i)}`]),
        get: () => p().tonality.scale,
        set: (v) => s.setTonality({ scale: v }),
        testid: 'scale',
        cls: 'wide',
      }),
    ),
    h(
      'div',
      { class: 'row' },
      numField({ label: 'Mode', hint: 'Which scale position the scale starts from (rooted on Key)', min: 1, max: 7, get: () => p().tonality.mode, set: (v) => s.setTonality({ mode: v }), testid: 'mode' }),
      numField({ label: 'Key', hint: 'Root note', min: 0, max: 11, get: () => p().tonality.key, set: (v) => s.setTonality({ key: v }), format: (v) => KEY_NAMES[v], parse: (x) => { const i = KEY_NAMES.findIndex((k) => k.toLowerCase() === x.toLowerCase()); return i >= 0 ? i : Number(x); }, testid: 'key' }),
      numField({ label: 'Octave', hint: 'Transpose everything by octaves', min: -4, max: 4, get: () => p().tonality.octave, set: (v) => s.setTonality({ octave: v }), testid: 'octave' }),
    ),
    userScaleBox,
  );
  const userOffsets = (i: number) => p().userScales[i].slice(0, 7);
  bind(() => {
    const sc = p().tonality.scale;
    userScaleBox.hidden = sc < PRESET_SCALES;
  });
  userScaleBox.append(
    h('div', { class: 'lbl' }, 'USER SCALE (semitones of positions 1-7, copied to every octave)'),
    h(
      'div',
      { class: 'row' },
      ...Array.from({ length: 7 }, (_, j) =>
        numField({
          label: String(j + 1),
          hint: `Position ${j + 1}: semitones above the octave start`,
          min: 0,
          max: 23,
          get: () => userOffsets(Math.max(0, p().tonality.scale - PRESET_SCALES))[j],
          set: (v) => {
            const i = p().tonality.scale - PRESET_SCALES;
            if (i < 0) return;
            const o = userOffsets(i);
            o[j] = v;
            s.setUserScale(i, entriesFromOctave(o));
          },
          cls: 'tiny',
        }),
      ),
    ),
  );

  // ------------------------------------------------------------------ side tabs
  const tabs: Record<string, HTMLElement> = {};
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const tabBody = h('div', { class: 'tabbody' });
  const addTab = (id: string, label: string, area: string, body: HTMLElement, visible: () => boolean = () => true) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'tab', 'data-testid': `tab-${id}`, onclick: () => s.setPrefs({ sideTab: id }) }, label);
    const pane = h('div', { role: 'tabpanel', class: 'pane', 'data-area': area, 'aria-label': label }, body);
    tabs[id] = pane;
    tabBar.append(b);
    tabBody.append(pane);
    bind(() => {
      const vis = visible();
      b.hidden = !vis;
      const active = s.prefs.sideTab === id && vis;
      b.setAttribute('aria-selected', String(active));
      b.classList.toggle('on', active);
      pane.hidden = !active;
      if (s.prefs.sideTab === id && !vis) s.prefs.sideTab = 'midi';
    });
  };

  // MIDI tab
  const portOptions = (kind: 'in' | 'out', none: string): [string, string][] => [['', none], ...(kind === 'out' ? s.midi.outputs() : s.midi.inputs()).map((x): [string, string] => [x.id, x.name + (x.connected ? '' : ' (disconnected)')])];
  const monitorList = h('ol', { class: 'monitor', 'data-testid': 'monitor', 'aria-label': 'MIDI monitor' });
  const clockSummary = h('div', { class: 'clocksum', 'data-testid': 'clock-summary' });
  const midiStatusText = h('p', { class: 'note', 'data-testid': 'midi-message' });
  bind(() => {
    const st = s.midi.status;
    midiStatusText.textContent =
      st === 'unsupported' ? 'This browser has no Web MIDI. Use Chrome, Edge, Opera or Firefox, or the Audio preview.'
        : st === 'denied' ? 'MIDI access was refused. Allow MIDI for this site in the browser settings and reload.'
          : st === 'pending' ? 'Waiting for MIDI access…'
            : s.midi.outputs().length ? '' : 'No MIDI outputs found. Connect a device; ANVIL picks it up automatically.';
  });
  const midiTab = h(
    'div',
    {},
    midiStatusText,
    selectField<string>({ label: 'Output', hint: 'MIDI output for all voices', options: () => portOptions('out', '(none)'), get: () => s.prefs.outputId ?? '', set: (v) => s.selectOutput(v || null), testid: 'midi-out', cls: 'wide' }),
    selectField<string>({ label: 'Clock to', hint: 'Where MIDI clock goes (normally the same output)', options: () => portOptions('out', 'same as output'), get: () => s.prefs.clockOutputId ?? '', set: (v) => s.selectClockOutput(v || null), testid: 'clock-port', cls: 'wide' }),
    selectField<string>({ label: 'Input', hint: 'MIDI input: external clock source, and shown in the monitor', options: () => portOptions('in', '(none)'), get: () => s.prefs.inputId ?? '', set: (v) => s.selectInput(v || null), testid: 'midi-in', cls: 'wide' }),
    h(
      'div',
      { class: 'row' },
      toggle({ label: 'AUDIO PREVIEW', hint: 'Hear ANVIL through the browser (the same notes it sends to MIDI)', get: () => s.preview.enabled, set: (v) => void s.setAudioPreview(v), testid: 'audio-preview' }),
      numField({ label: 'Vol', hint: 'Audio preview volume', min: 0, max: 100, step: 5, get: () => Math.round(s.prefs.previewVolume * 100), set: (v) => { s.preview.setVolume(v / 100); s.setPrefs({ previewVolume: v / 100 }); } }),
    ),
    h(
      'div',
      { class: 'row' },
      toggle({ label: 'PROGRAMS AT START', hint: 'Send each voice\'s program change when playback starts', get: () => p().options.sendProgramsAtStart, set: (v) => s.setOption('sendProgramsAtStart', v) }),
    ),
    h('h3', {}, 'MONITOR'),
    clockSummary,
    h(
      'div',
      { class: 'row' },
      toggle({ label: 'IN', hint: 'Show incoming messages', get: () => s.monitor.filter.in, set: (v) => { s.monitor.filter.in = v; s.monitor.version++; refreshAll(); } }),
      toggle({ label: 'OUT', hint: 'Show outgoing messages', get: () => s.monitor.filter.out, set: (v) => { s.monitor.filter.out = v; s.monitor.version++; refreshAll(); } }),
      toggle({ label: 'HOLD', hint: 'Pause the monitor log', get: () => s.monitor.paused, set: (v) => { s.monitor.paused = v; refreshAll(); } }),
      button('CLEAR', 'Clear the monitor', () => { s.monitor.clear(); refreshAll(); }),
    ),
    monitorList,
  );
  let monVersion = -1;
  const renderMonitor = () => {
    const m = s.monitor;
    clockSummary.textContent = `Clock out: ${m.clock.out.count} (${m.clock.out.rate}/s)   Clock in: ${m.clock.in.count} (${m.clock.in.rate}/s)`;
    if (m.version === monVersion || tabs.midi.hidden) return;
    monVersion = m.version;
    const items = m.visible().slice(-80).reverse();
    monitorList.replaceChildren(...items.map((e) => h('li', { class: e.dir }, h('span', { class: 'dir' }, e.dir === 'in' ? 'IN ' : 'OUT'), h('span', { class: 'hex' }, e.hex), h('span', {}, e.text))));
  };
  addTab('midi', 'MIDI', 'midi', midiTab);

  // Weights tab
  const weightsGrid = h('div', { class: 'weights', 'data-testid': 'weights' });
  weightsGrid.append(h('span', {}), ...[1, 2, 3, 4, 5, 6, 7].map((n) => h('span', { class: 'lbl' }, String(n))), h('span', {}));
  for (let t = 0; t < 8; t++) {
    const mark = h('span', { class: 'lbl wmark' });
    bind(() => {
      const on = p().params.onbeatTable === t + 1;
      const off = p().params.offbeatTable === t + 1;
      mark.textContent = on && off ? 'ON/OFF' : on ? 'ON' : off ? 'OFF' : '';
    });
    weightsGrid.append(h('span', { class: 'lbl' }, String(t + 1)));
    for (let j = 0; j < 7; j++) {
      const cell = h('button', {
        type: 'button',
        class: 'wcell',
        'aria-label': `Table ${t + 1} position ${j + 1}`,
        hint: 'Weight 0-8: click +1, Shift-click -1, wheel to change',
        onclick: (e: MouseEvent) => s.setWeight(t, j, (p().weights[t][j] + (e.shiftKey ? 8 : 1)) % 9),
      });
      cell.addEventListener('wheel', (e) => {
        e.preventDefault();
        s.setWeight(t, j, Math.max(0, Math.min(8, p().weights[t][j] + (e.deltaY < 0 ? 1 : -1))));
      }, { passive: false });
      bind(() => {
        const w = p().weights[t][j];
        cell.textContent = String(w);
        cell.style.setProperty('--w', String(w / 8));
      });
      weightsGrid.append(cell);
    }
    weightsGrid.append(mark);
  }
  const drums = h(
    'div',
    { class: 'row wrap' },
    ...Array.from({ length: 7 }, (_, i) => numField({ label: `D${i + 1}`, hint: `Drum table entry ${i + 1} (MIDI note, 0 = off)`, min: 0, max: 127, get: () => p().drums[i], set: (v) => s.setDrum(i, v), format: (v) => (v === 0 ? 'off' : String(v)), cls: 'tiny' })),
  );
  addTab('weights', 'WEIGHTS', 'tonality', h('div', {}, h('p', { class: 'note' }, 'Scale weights: 8 tables x 7 scale positions. Higher weight = chosen more often; 0 = never. The Onbeat and Offbeat tables are chosen in Constraints.'), weightsGrid, h('h3', {}, 'DRUM TABLE'), h('p', { class: 'note' }, 'Notes used by drum harmonies D1-D5. Never transposed.'), drums));

  // Arranger tab
  const stepList = h('div', { class: 'steps', 'data-testid': 'arranger-steps' });
  const renderSteps = () => {
    const steps = p().arranger.steps;
    const cur = s.seq.arrangerPlaying ? s.seq.arrangerIndex : -1;
    clear(stepList);
    if (!steps.length) stepList.append(h('p', { class: 'note' }, 'No steps. Add the current state, or Record while playing.'));
    steps.forEach((st, i) => {
      const itemSel = h('select', { 'aria-label': `Step ${i + 1} item`, onchange: () => s.updateStep(i, { item: (itemSel.value || null) as ItemId | null }) }, h('option', { value: '' }, '-'), ...ITEM_IDS.map((id) => h('option', { value: id }, id)));
      itemSel.value = st.item ?? '';
      const keySel = h('select', { 'aria-label': `Step ${i + 1} key`, onchange: () => s.updateStep(i, { key: keySel.value === '' ? null : Number(keySel.value) }) }, h('option', { value: '' }, '-'), ...KEY_NAMES.map((k, n) => h('option', { value: String(n) }, k)));
      keySel.value = st.key === null ? '' : String(st.key);
      const presetSel = h('select', { 'aria-label': `Step ${i + 1} preset`, onchange: () => s.updateStep(i, { preset: presetSel.value === '' ? null : Number(presetSel.value) }) }, h('option', { value: '' }, '-'), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((L, n) => h('option', { value: String(n) }, L)));
      presetSel.value = st.preset === null ? '' : String(st.preset);
      const beats = h('input', { type: 'number', min: 0.25, step: 0.25, value: String(st.clocks / 24), 'aria-label': `Step ${i + 1} length in beats`, class: 'beats', onchange: () => s.updateStep(i, { clocks: Math.max(1, Math.round(Number(beats.value) * 24)) }) });
      stepList.append(
        h(
          'div',
          { class: 'step' + (i === cur ? ' cur' : '') },
          h('span', { class: 'idx' }, String(i + 1)),
          itemSel,
          presetSel,
          keySel,
          h('span', { class: 'lbl', title: 'scale / mode / octave' }, `${st.scale === null ? '-' : st.scale + 1}/${st.mode ?? '-'}/${st.octave ?? '-'}`),
          beats,
          h('span', { class: 'lbl' }, clocksLabel(st.clocks)),
          button('↑', 'Move up', () => s.moveStep(i, -1)),
          button('↓', 'Move down', () => s.moveStep(i, 1)),
          button('×', 'Delete step', () => s.removeStep(i)),
        ),
      );
    });
  };
  const en = (k: keyof ReturnType<typeof p>['arranger']['enable'], label: string) => toggle({ label, hint: `Arranger changes ${label.toLowerCase()} when playing`, get: () => p().arranger.enable[k], set: (v) => s.setArrangerEnable(k, v) });
  addTab(
    'arranger',
    'ARRANGER',
    'arranger',
    h(
      'div',
      {},
      h(
        'div',
        { class: 'row' },
        button('▶ PLAY ARRANGER', 'Start playback from the first step', () => s.playArranger(), { 'data-testid': 'arr-play' }),
        button('■', 'Stop following the arranger (playback continues)', () => s.stopArranger()),
        toggle({ label: '● REC', hint: 'Record: each item, tonality or preset change while playing becomes a step (replaces the list)', get: () => s.recording, set: (v) => (v ? s.startRecording() : s.stopRecording()), testid: 'arr-rec' }),
        toggle({ label: 'LOOP', hint: 'Loop the arranger', get: () => p().options.arrangerLoop, set: (v) => s.setOption('arrangerLoop', v) }),
      ),
      h('div', { class: 'row' }, en('theme', 'THEME'), en('preset', 'PRESET'), en('scale', 'SCALE'), en('mode', 'MODE'), en('keyOctave', 'KEY/OCT')),
      h('div', { class: 'row' }, button('+ ADD STEP', 'Add a step from the current item, preset and tonality', () => s.addStep(), { 'data-testid': 'arr-add' })),
      h('div', { class: 'stephead lbl' }, '#  item  preset  key  scale/mode/oct  beats  bars:beats'),
      stepList,
    ),
  );

  // Project tab
  const fileInput = h('input', { type: 'file', accept: '.json,.anvil.json,application/json', hidden: true, 'data-testid': 'file-input' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      s.importText(await f.text());
    } catch (e) {
      s.say(`Could not open the file: ${e instanceof Error ? e.message : e}`);
    }
    fileInput.value = '';
  });
  const libList = h('div', { class: 'library', 'data-testid': 'library' });
  const renderLibrary = () => {
    clear(libList);
    const lib = s.storage.library();
    if (!lib.length) libList.append(h('p', { class: 'note' }, 'Nothing saved in this browser yet.'));
    for (const e of lib) libList.append(h('div', { class: 'row' }, button(e.name, `Open "${e.name}" (saved ${new Date(e.saved).toLocaleString()})`, () => s.openFromLibrary(e.id), { class: 'libitem' }), button('×', `Delete "${e.name}" from this browser`, () => { s.storage.remove(e.id); renderLibrary(); })));
  };
  let exportPasses = 4;
  const warningsBox = h('div', { class: 'warnings', 'data-testid': 'load-warnings' });
  bind(() => {
    warningsBox.replaceChildren(...(s.warnings.length ? [h('h3', {}, 'REPAIRS ON LAST OPEN'), h('ul', {}, ...s.warnings.slice(0, 30).map((w) => h('li', {}, w)))] : []));
  });
  const algList = h('ul', { class: 'algs' }, ...ALGORITHMS.map((a) => h('li', {}, h('code', {}, a.id), ` ${a.evidence}: ${a.summary}`)));
  const notesArea = h('textarea', { rows: 4, 'aria-label': 'Project notes', onchange: () => s.setNotes(notesArea.value) });
  bind(() => {
    if (document.activeElement !== notesArea) notesArea.value = p().notes;
  });
  const alignOpts = (withOff: boolean): [string, string][] => [['mbeat', 'Microbeat'], ['pulse', 'Pulse'], ['theme', 'Theme end'], ...(withOff ? ([['off', 'Immediate']] as [string, string][]) : [])];
  addTab(
    'project',
    'PROJECT',
    'constraints',
    h(
      'div',
      {},
      h(
        'div',
        { class: 'row wrap' },
        button('SAVE IN BROWSER', 'Keep a named copy in this browser', () => { s.saveToLibrary(); renderLibrary(); }, { 'data-testid': 'save-browser' }),
        button('DOWNLOAD', 'Download the project as a file', () => download(s.fileName(), s.serialize(), 'application/json'), { 'data-testid': 'download' }),
        button('OPEN FILE', 'Open a project file', () => fileInput.click(), { 'data-testid': 'open-file' }),
        button('NEW', 'Start a new project (the current one stays autosaved until you change the new one)', () => s.newProject(), { 'data-testid': 'new-project' }),
        fileInput,
      ),
      libList,
      h('h3', {}, 'MIDI FILE'),
      h(
        'div',
        { class: 'row wrap' },
        numField({ label: 'Passes', hint: 'How many times to play the item into the file', min: 1, max: 64, get: () => exportPasses, set: (v) => (exportPasses = v) }),
        button('EXPORT ITEM', 'Export the playing item and accompaniment as a Standard MIDI File', () => download(`${s.fileName().replace('.anvil.json', '')}-${p().selected}.mid`, s.exportMidi({ item: p().selected, passes: exportPasses }) as BlobPart, 'audio/midi'), { 'data-testid': 'export-midi' }),
        button('EXPORT ARRANGER', 'Export one pass through the arranger', () => download(`${s.fileName().replace('.anvil.json', '')}-arranger.mid`, s.exportMidi({ arranger: true }) as BlobPart, 'audio/midi')),
      ),
      h('h3', {}, 'DEMOS (original to ANVIL)'),
      h('div', { class: 'demos' }, ...DEMOS.map((d) => button(d.name, d.description, () => s.loadDemo(d.id), { 'data-testid': `demo-${d.id}` }))),
      h('h3', {}, 'OPTIONS'),
      selectField<string>({ label: 'Theme change', hint: 'When a newly selected item starts', options: () => alignOpts(false), get: () => p().options.themeAlign, set: (v) => s.setOption('themeAlign', v as 'theme') }),
      selectField<string>({ label: 'Tonality change', hint: 'When scale/mode/key/octave changes take effect while playing', options: () => alignOpts(true), get: () => p().options.tonalityAlign, set: (v) => s.setOption('tonalityAlign', v as 'off') }),
      selectField<string>({ label: 'Preset change', hint: 'When accompaniment preset recalls take effect while playing', options: () => alignOpts(true), get: () => p().options.presetAlign, set: (v) => s.setOption('presetAlign', v as 'off') }),
      h('div', { class: 'row' }, toggle({ label: 'FEEL', hint: 'Small random velocity variation toward the base velocity (off by default)', get: () => p().options.feel, set: (v) => s.setOption('feel', v), testid: 'feel' })),
      h('h3', {}, 'NOTES'),
      notesArea,
      warningsBox,
      h('details', { class: 'algdetails' }, h('summary', {}, 'Algorithm versions in this build'), h('p', { class: 'note' }, `Project seed ${p().seed}. Every approximated algorithm has a version id, saved in project files so a later ANVIL can keep old projects sounding the same.`), algList),
    ),
  );

  // Look tab (palettes)
  const lookBody = h('div', {});
  const renderLook = () => {
    const pal = palettes.find(s.prefs.palette);
    const warn = contrastWarnings(pal.colors);
    lookBody.replaceChildren(
      h('p', { class: 'note' }, 'Palettes are a preference of this browser, not part of a project. Changing a colour of a built-in palette makes a custom copy.'),
      ...ROLES.map((r: Role) => {
        const inp = h('input', { type: 'color', value: pal.colors[r], 'aria-label': `${r} colour`, onchange: () => { const np = palettes.setColor(pal.id, r, inp.value); s.setPrefs({ palette: np.id }); applyCurrentPalette(); renderLook(); refreshAll(); } });
        return h('label', { class: 'colorrow', hint: ROLE_INFO[r] }, inp, h('span', {}, r), h('span', { class: 'lbl' }, ROLE_INFO[r]));
      }),
      warn.length ? h('p', { class: 'note warn' }, `Low contrast: ${warn.map((w) => `${w.role} (${w.ratio.toFixed(1)}:1)`).join(', ')}`) : h('span'),
      pal.builtIn ? h('span') : button('DELETE THIS PALETTE', 'Remove this custom palette', () => { palettes.remove(pal.id); s.setPrefs({ palette: 'classic' }); applyCurrentPalette(); renderLook(); refreshAll(); }),
    );
  };
  addTab('look', 'LOOK', 'midi', lookBody);

  // Extended tab
  const seedInput = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'new', 'aria-label': 'Seed', class: 'seed', 'data-testid': 'ext-seed' });
  const seedVal = () => (seedInput.value.trim() === '' ? undefined : Number(seedInput.value) >>> 0);
  const ancestry = h('div', { class: 'note', 'data-testid': 'ancestry' });
  bind(() => {
    const t = s.focused;
    if (!t) return void (ancestry.textContent = '');
    const chain = [t.origin, t.origin.parent].filter(Boolean).map((o) => `${o!.kind}${o!.from ? ' from ' + o!.from : ''}${o!.note ? ' (' + o!.note + ')' : ''}`);
    ancestry.textContent = `${s.focus} seed ${t.seed}: ${chain.join('  ←  ')}`;
  });
  addTab(
    'extended',
    'EXTENDED',
    'extended',
    h(
      'div',
      {},
      h('p', { class: 'note' }, 'Tools beyond the original instrument. They act on the viewed item using the current constraints.'),
      h(
        'div',
        { class: 'row wrap' },
        button('NEW RHYTHM', 'New rhythm with the current rhythm constraints; the pitch sequence is kept', () => s.extRegenerate('rhythm', seedVal()), { 'data-testid': 'ext-rhythm' }),
        button('NEW PITCHES', 'New pitches; the rhythm is kept', () => s.extRegenerate('pitches', seedVal()), { 'data-testid': 'ext-pitches' }),
        button('NEW ACCENTS', 'New accent levels; notes and rhythm kept', () => s.extRegenerate('accents', seedVal()), { 'data-testid': 'ext-accents' }),
        button('NEW PITCHES FROM SELECTED', 'New pitches from the selected event to the end', () => s.extRegenerate('range', seedVal())),
      ),
      h('div', { class: 'row wrap' }, toggle({ label: 'KEEP CONTOUR', hint: 'New pitches follow the old up/down shape where the rules allow', get: () => p().extended.preserveContour, set: (v) => s.setExtended('preserveContour', v), testid: 'ext-contour' })),
      h(
        'div',
        { class: 'row wrap' },
        numField({ label: 'Depth %', hint: 'How much Mutate changes', min: 0, max: 100, step: 5, get: () => p().extended.mutationDepth, set: (v) => s.setExtended('mutationDepth', v) }),
        button('MUTATE', 'Change about Depth % of the pitches and half as many microrhythms', () => s.extMutate(seedVal()), { 'data-testid': 'ext-mutate' }),
      ),
      h('div', { class: 'row wrap' }, h('span', { class: 'lbl' }, 'SEED'), seedInput, button('REGENERATE WITH SEED', 'Generate the viewed slot again with this seed (blank: a new seed)', () => s.generate(s.focus, seedVal()), { 'data-testid': 'ext-seed-gen' })),
      h(
        'div',
        { class: 'row wrap' },
        button('LOCK / UNLOCK', 'Lock the selected event so regeneration and mutation keep it (L)', () => s.toggleLock(), { 'data-testid': 'ext-lock' }),
        button('CLEAR LOCKS', 'Unlock every event of the viewed item', () => s.clearLocks()),
      ),
      selectField<string>({
        label: 'Compare with',
        hint: 'Draw another item as an outline in the theme view',
        options: () => [['', '(none)'], ...ITEM_IDS.filter((i) => p().bank[i]).map((i): [string, string] => [i, i])],
        get: () => s.compare ?? '',
        set: (v) => { s.compare = (v || null) as ItemId | null; s.emit('bank'); },
        testid: 'ext-compare',
      }),
      h('h3', {}, 'ANCESTRY'),
      ancestry,
    ),
    () => s.isExtended,
  );

  const side = h('div', { class: 'side' }, tonality, h('section', { class: 'panel tabbed' }, tabBar, tabBody));

  // ------------------------------------------------------------------ voices
  const vt = h('table', { class: 'voices', 'data-testid': 'voices' });
  vt.append(
    h('thead', {}, h('tr', {}, ...['#', 'M', 'S', 'L', 'Ch', 'Prog', 'Oct', 'Vel', 'Acc', 'Articulation', 'Delay', 'Rhythm', 'Div', 'Harmony', 'Tran', ''].map((c) => h('th', {}, c)))),
  );
  const tbody = h('tbody', {});
  vt.append(tbody);
  const vf = <K extends keyof Voice>(i: number, k: K, label: string, hint: string, min: number, max: number, format?: (v: number) => string) =>
    numField({ label, hint, min, max, get: () => p().voices[i][k] as number, set: (v) => s.setVoice(i, k, v as Voice[K]), format, cls: 'cellnum', testid: `v${i + 1}-${k}` });
  const vsel = <K extends keyof Voice>(i: number, k: K, label: string, hint: string, opts: [number, string][], disabled?: () => boolean) =>
    selectField<number>({ label, hint, options: () => opts, get: () => p().voices[i][k] as number, set: (v) => s.setVoice(i, k, v as Voice[K]), cls: 'cellsel', testid: `v${i + 1}-${k}`, disabled });
  for (let i = 0; i < 6; i++) {
    const vb = <K extends 'mute' | 'solo' | 'locked'>(k: K, label: string, hint: string) => toggle({ label, hint, get: () => p().voices[i][k], set: (v) => s.setVoice(i, k, v), testid: `v${i + 1}-${k}`, cls: 'mini-t' });
    const isTheme = i === 0;
    const td = (...c: (Node | string)[]) => h('td', {}, ...c);
    const row = h(
      'tr',
      { class: isTheme ? 'theme' : '' },
      td(h('span', { class: 'vnum' }, String(i + 1))),
      td(vb('mute', 'M', `Mute voice ${i + 1}`)),
      td(vb('solo', 'S', `Solo voice ${i + 1}`)),
      td(vb('locked', 'L', `Lock voice ${i + 1} against accompaniment preset changes`)),
      td(vf(i, 'channel', 'Ch', 'MIDI channel', 1, 16)),
      td(vf(i, 'program', 'Prog', 'Program change (0 = none; sent at start if enabled)', 0, 128, (v) => (v === 0 ? '-' : String(v)))),
      td(vf(i, 'octave', 'Oct', 'Octave shift', -4, 4)),
      td(vf(i, 'velocity', 'Vel', 'Base velocity', 1, 127)),
      td(vf(i, 'accent', 'Acc', 'Accent: added for accented notes, subtracted for de-accented (negative inverts)', -64, 64)),
      td(vsel(i, 'art', 'Art', 'Articulation: note length from staccato to legato', ARTS.map((n, k) => [k + 1, `${k + 1} ${n}`]))),
      td(vf(i, 'delay', 'Delay', 'Delay in MIDI clocks', 0, 96)),
      td(isTheme ? h('span', { class: 'lbl' }, 'theme') : vsel(i, 'rhythm', 'Rhythm', 'Which theme positions trigger this voice', ACC_RHYTHMS.map((n, k) => [k + 1, `${k + 1} ${n}`]))),
      td(isTheme ? h('span', { class: 'lbl' }, '-') : vsel(i, 'divide', 'Divide', 'Every nth trigger; ½ = each twice at half value; negative = randomly about one in n', DIVIDES)),
      td(isTheme ? h('span', { class: 'lbl' }, 'theme') : vsel(i, 'harmony', 'Harmony', 'Pitch of each note, or drums D1-D5', HARMONIES.map((n, k) => [k + 1, k + 1 >= HARMONY_DRUM_BASE ? n : `${k + 1} ${n}`]))),
      td(isTheme ? h('span', { class: 'lbl' }, '-') : vf(i, 'tran', 'Tran', 'Diatonic interval (1 = unison); fixed harmonies: scale position; arpeggios: octaves', 1, 15)),
      td(isTheme ? h('span') : button('⇐1', `Copy voice 1's settings to voice ${i + 1} (except program and mute)`, () => s.copyVoice(0, i))),
    );
    bind(() => row.classList.toggle('muted', p().voices.some((v) => v.solo) ? !p().voices[i].solo : p().voices[i].mute));
    tbody.append(row);
  }
  const voices = panel(
    'voices',
    'ACCOMPANIMENT',
    vt,
    presetStrip({
      label: 'ACC',
      hint: 'Accompaniment presets A-Z: click recalls (Shift: stores, Alt: clears). Recall while playing follows Preset change alignment',
      has: (i) => !!p().accPresets[i],
      active: (i) => s.lastPreset === i,
      recall: (i, e) => s.recallAccPreset(i, e.ctrlKey || e.metaKey),
      store: (i) => s.storeAccPreset(i),
      remove: (i) => s.deleteAccPreset(i),
      testid: 'acc-presets',
    }),
  );

  // ------------------------------------------------------------------ footer
  const hintLine = h('div', { class: 'hint', 'data-testid': 'hint', 'aria-live': 'polite' });
  const footer = h('footer', { class: 'hintbar' }, hintLine, h('span', { class: 'lbl' }, 'ANVIL · independent instrument · not affiliated with Dr. T\'s or Jim Johnson'));
  let hovering = '';
  root.addEventListener('mouseover', (e) => {
    const el = (e.target as Element).closest('[data-hint]') as HTMLElement | null;
    hovering = el?.dataset.hint ?? '';
    hintLine.textContent = hovering || s.notice;
  });
  root.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest('[data-hint]') as HTMLElement | null;
    if (el?.dataset.hint) hintLine.textContent = el.dataset.hint;
  });

  root.replaceChildren(
    header,
    transport,
    h('main', { class: 'work' }, constraints, bank, side),
    voices,
    footer,
    help,
  );
  root.classList.add('anvil');
  bind(() => root.classList.toggle('extended', s.isExtended));
  bind(() => root.classList.toggle('no-tips', !s.prefs.tips));

  // ------------------------------------------------------------------ updates
  const renderAll = () => {
    refreshAll();
    renderBank();
    renderView();
    renderSteps();
    updateTransport();
  };
  s.on((c) => {
    if (c === 'notice') {
      if (!hovering) hintLine.textContent = s.notice;
      return;
    }
    if (c === 'prefs') applyCurrentPalette();
    renderAll();
    if (c === 'project') renderLibrary();
  });
  renderLibrary();
  renderLook();
  renderAll();
  new ResizeObserver(() => renderView(true)).observe(viewBox);

  // animation: playhead, transport position, monitor
  let lastItem: string | null = null;
  const frame = () => {
    const seq = s.seq;
    const ph = viewSvg.querySelector('#playhead') as SVGLineElement | null;
    const running = s.transport.state === 'running';
    if (ph) {
      if ((running || s.transport.state === 'paused') && seq.item === s.focus && seq.theme) {
        const mb = Math.max(0, seq.offset) / seq.theme.microbeat;
        const x = xOf(Math.min(seq.theme.length, mb));
        ph.setAttribute('x1', String(x));
        ph.setAttribute('x2', String(x));
        ph.setAttribute('visibility', 'visible');
      } else ph.setAttribute('visibility', 'hidden');
    }
    updateTransport();
    if (seq.item !== lastItem) {
      lastItem = seq.item;
      renderBank();
    }
    renderMonitor();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------ keyboard
  document.addEventListener('keydown', (e) => {
    if (help.open) return;
    if (typing() || (e.target as HTMLElement).tagName === 'SELECT') return;
    const st = s.transport.state;
    if (e.key === ' ') {
      e.preventDefault();
      if (st === 'running') s.pause();
      else if (st === 'paused' || (st === 'armed' && s.transport.source === 'external')) s.cont();
      else if (st === 'stopped') s.start();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (e.shiftKey) s.panic();
      else s.stop();
    } else if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey) {
      s.generate(s.focus);
    } else if (e.key === '?' || e.key === 'F1') {
      e.preventDefault();
      help.showModal();
    }
  });

  (window as unknown as { anvil: Session }).anvil = s;
}
