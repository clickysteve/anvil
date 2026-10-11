/**
 * EXPORT AUDIO window: render an item (theme or variation, N passes) or the arrangement to a
 * master WAV and/or one stem per voice, 44.1 kHz 16-bit, packed in a ZIP when there are
 * several files.
 */
import type { Session } from '../app/session';
import { defaultExportOptions, planExport, type AudioExportOptions, type ExportOutputs } from '../audio/exportAudio';
import { RenderCancelled } from '../core/render/offline';
import { isVariation } from '../engine/theme';
import { ITEM_IDS, type ItemId } from '../engine/types';
import { bind, download, h, refreshAll } from './dom';
import { button, numField, selectField, toggle } from './widgets';
import { gemWindow, type GemWindow } from './window';

export function exportWindow(s: Session): GemWindow {
  const p = () => s.project;
  const win = gemWindow({ title: 'EXPORT AUDIO', testid: 'export-audio', area: 'transport', width: 520, onOpen: () => refreshAll() });
  const opts: AudioExportOptions = defaultExportOptions('TA');
  let rangeKind: 'item' | 'arranger' = 'item';
  let item: ItemId = 'TA';
  let passes = 1;
  let busy: AbortController | null = null;
  const sync = () => {
    opts.range = rangeKind === 'arranger' ? { kind: 'arranger' } : { kind: 'item', item, passes };
  };

  const plan = h('div', { class: 'note', 'data-testid': 'export-plan' });
  const files = h('ul', { class: 'filelist', 'data-testid': 'export-files' });
  const bar = h('div');
  const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Export progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const statusLine = h('div', { class: 'status', 'data-testid': 'export-status', role: 'status', 'aria-live': 'polite' });
  const result = h('ul', { class: 'filelist', 'data-testid': 'export-result' });

  const renderPlan = () => {
    sync();
    try {
      const pl = planExport(p(), opts);
      const secs = pl.timeline.length * (60 / (pl.timeline.tempo.changes[0].bpm * pl.timeline.tempo.ppq));
      plan.textContent = `${opts.range.kind === 'arranger' ? 'Arrangement, once through' : `${item}${isVariation(item) ? ` (variation of T${item[1]})` : ' (theme)'} x ${passes}`}  ·  ${secs.toFixed(2)} s + ${opts.tailSeconds} s tail  ·  ${pl.names.length} file${pl.names.length > 1 ? 's' : ''}${pl.names.length > 1 ? ' in one ZIP' : ''}`;
      files.replaceChildren(...pl.names.map((n) => h('li', {}, h('span', { class: 'fname' }, n))));
      plan.classList.remove('warn');
    } catch (e) {
      plan.textContent = (e as Error).message;
      plan.classList.add('warn');
      files.replaceChildren();
    }
  };

  const render = async () => {
    if (busy) return;
    sync();
    busy = new AbortController();
    refreshAll();
    result.replaceChildren();
    statusLine.classList.remove('err');
    try {
      const r = await s.exportAudio(opts, (f, stage) => {
        bar.style.width = `${Math.round(f * 100)}%`;
        progress.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        statusLine.textContent = `${stage}… ${Math.round(f * 100)}%`;
      }, busy.signal);
      download(r.download.name, r.download.bytes as BlobPart, r.download.type);
      statusLine.textContent = `Exported ${r.download.name} (${r.render.seconds.toFixed(2)} s, ${r.render.sampleRate} Hz, 16-bit, ${r.files.length} file${r.files.length > 1 ? 's' : ''})${r.render.processed ? '' : '. Output processing was unavailable in this browser: files are unprocessed.'}`;
      result.replaceChildren(
        ...r.files.map((f) =>
          h(
            'li',
            {},
            h('span', { class: 'fname' }, f.name),
            h('span', {}, f.stats.silent ? 'silent' : `peak ${f.stats.peakDb.toFixed(1)} dBFS`),
            f.stats.clipped ? h('span', { class: 'warn' }, `${f.stats.clipped} clipped`) : h('span', {}, ''),
          ),
        ),
      );
    } catch (e) {
      statusLine.textContent = e instanceof RenderCancelled ? 'Export cancelled.' : `Export failed: ${(e as Error).message}`;
      statusLine.classList.add('err');
      bar.style.width = '0';
    } finally {
      busy = null;
      refreshAll();
    }
  };

  const itemOptions = (): [ItemId, string][] => ITEM_IDS.filter((i) => p().bank[i]).map((i): [ItemId, string] => [i, `${i} ${isVariation(i) ? `variation of T${i[1]}` : 'theme'}`]);
  win.body.append(
    h(
      'div',
      { class: 'row wrap' },
      selectField<string>({ label: 'RANGE', hint: 'What to render: one item (a theme or a variation) or the arrangement', options: () => [['item', 'ITEM'], ['arranger', 'ARRANGEMENT']], get: () => rangeKind, set: (v) => ((rangeKind = v as 'item'), refreshAll()), testid: 'ex-range' }),
      selectField<ItemId>({ label: 'ITEM', hint: 'The theme or variation, played from START exactly as ONCE plays it', options: itemOptions, get: () => item, set: (v) => ((item = v), refreshAll()), testid: 'ex-item', disabled: () => rangeKind !== 'item' }),
      numField({ label: 'PASSES', hint: 'How many times the item plays', min: 1, max: 64, get: () => passes, set: (v) => ((passes = v), refreshAll()), testid: 'ex-passes', disabled: () => rangeKind !== 'item' }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      selectField<ExportOutputs>({ label: 'OUTPUT', hint: 'The master mix, one stem per voice, or both', options: () => [['master', 'MASTER'], ['stems', 'STEMS'], ['both', 'MASTER + STEMS']], get: () => opts.outputs, set: (v) => ((opts.outputs = v), refreshAll()), testid: 'ex-outputs' }),
      numField({ label: 'TAIL s', hint: 'Shared tail after the music, the same for every file', min: 0, max: 30, step: 0.5, get: () => opts.tailSeconds, set: (v) => ((opts.tailSeconds = v), refreshAll()), testid: 'ex-tail' }),
    ),
    h(
      'div',
      { class: 'row wrap' },
      toggle({ label: 'BAKE PROCESSING INTO STEMS', hint: 'Stems include their voice\'s output processing. Master processing is only ever applied to the master file', get: () => opts.bake, set: (v) => ((opts.bake = v), refreshAll()), testid: 'ex-bake', disabled: () => opts.outputs === 'master' }),
      toggle({ label: 'ALL VOICES', hint: 'A stem for every voice, including muted ones (they are silent)', get: () => opts.allVoices, set: (v) => ((opts.allVoices = v), refreshAll()), testid: 'ex-all', disabled: () => opts.outputs === 'master' }),
    ),
    h('p', { class: 'note' }, 'WAV · 44.1 kHz · 16-bit PCM · stereo. Every file starts at the same sample, has the same length and is never trimmed or normalised, so stems line up in a DAW.'),
    h('p', { class: 'note' }, 'Stems carry each voice\'s own processing; master processing is applied to the master file only. Summing the stems rebuilds the mix before master processing. A non-linear master processor cannot be rebuilt from stems.'),
    h('p', { class: 'note' }, 'Only ANVIL\'s internal synth and samples are rendered. External MIDI instruments are not: record them separately.'),
    plan,
    files,
    h(
      'div',
      { class: 'row' },
      button('RENDER', 'Render and download', () => void render(), { 'data-testid': 'ex-render' }),
      button('CANCEL', 'Stop the render', () => busy?.abort(), { 'data-testid': 'ex-cancel' }),
    ),
    progress,
    statusLine,
    result,
  );
  bind(() => {
    if (!win.isOpen) return;
    if (!p().bank[item]) item = itemOptions()[0]?.[0] ?? 'TA';
    renderPlan();
    (win.body.querySelector('[data-testid="ex-render"]') as HTMLButtonElement).disabled = !!busy;
    (win.body.querySelector('[data-testid="ex-cancel"]') as HTMLButtonElement).disabled = !busy;
  });
  // start from the item being played
  const baseOpen = win.open;
  win.open = () => {
    if (!win.isOpen) item = p().selected;
    baseOpen();
  };
  return win;
}
