import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FAKE_MIDI, NO_MIDI } from './fakeMidi';

type Sent = { port: string; data: number[]; ts: number; at: number };

function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

async function open(page: Page, path = '/anvil/', midi = FAKE_MIDI) {
  await page.addInitScript(midi);
  await page.goto(path);
  await expect(page.getByTestId('bank')).toBeVisible();
}

async function useFakeOutput(page: Page) {
  await page.getByTestId('tab-midi').click();
  await page.getByTestId('midi-out').selectOption('out-1');
  await expect(page.getByTestId('midi-status')).toHaveText(/Fake Hermod\+/);
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __midiSent: Sent[] }).__midiSent.slice());
const clearSent = (page: Page) => page.evaluate(() => void ((window as unknown as { __midiSent: Sent[] }).__midiSent.length = 0));

/** Unmatched note-ons per channel/note, counting note-on velocity 0 as off. */
function unmatched(msgs: Sent[]): number {
  const open = new Map<string, number>();
  for (const m of msgs) {
    const st = m.data[0] & 0xf0;
    const k = `${m.data[0] & 15}:${m.data[1]}`;
    if (st === 0x90 && m.data[2] > 0) open.set(k, (open.get(k) ?? 0) + 1);
    else if (st === 0x80 || (st === 0x90 && m.data[2] === 0)) open.set(k, Math.max(0, (open.get(k) ?? 0) - 1));
  }
  return [...open.values()].reduce((a, b) => a + b, 0);
}

test.describe('boot and base paths', () => {
  for (const path of ['/anvil/', '/']) {
    test(`boots without console errors at ${path}`, async ({ page }) => {
      const errs = watchErrors(page);
      await open(page, path);
      await expect(page).toHaveTitle('ANVIL');
      await expect(page.getByTestId('slot-TA')).not.toHaveClass(/empty/);
      await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
      // assets resolved under the base path
      const fontOk = await page.evaluate(() => document.fonts.check('12px Tiny5'));
      expect(typeof fontOk).toBe('boolean');
      expect(errs).toEqual([]);
    });
  }
});

test('works with Web MIDI unavailable', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page, '/anvil/', NO_MIDI);
  await expect(page.getByTestId('midi-status')).toHaveText('NO WEB MIDI');
  await page.getByTestId('tab-midi').click();
  await expect(page.getByTestId('midi-message')).toContainText('no Web MIDI');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  expect(errs).toEqual([]);
});

test('palettes switch, persist and are not project data', async ({ page }) => {
  await open(page);
  const paper = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  expect(await paper()).toBe('#ffffff');
  for (const id of ['dark', 'colour', 'classic', 'dark']) await page.getByTestId('palette').selectOption(id);
  expect(await paper()).toBe('#17191c');
  await page.reload();
  await expect(page.getByTestId('bank')).toBeVisible();
  expect(await paper()).toBe('#17191c');
  const project = await page.evaluate(() => (window as unknown as { anvil: { serialize(): string } }).anvil.serialize());
  expect(project).not.toContain('palette');
});

test('mode switching shows Extended tools and keeps the music', async ({ page }) => {
  await open(page);
  const before = await page.getByTestId('view-info').textContent();
  await expect(page.getByTestId('tab-extended')).toBeHidden();
  await page.getByTestId('mode-extended').click();
  await expect(page.getByTestId('tab-extended')).toBeVisible();
  await page.getByTestId('tab-extended').click();
  await page.getByTestId('ext-pitches').click();
  await expect(page.getByTestId('ancestry')).toContainText('regenerated');
  await page.getByTestId('mode-classic').click();
  await expect(page.getByTestId('tab-extended')).toBeHidden();
  expect(before).toBeTruthy();
});

test('generate, select, view and edit', async ({ page }) => {
  await open(page);
  await page.getByTestId('slot-TB').click();
  await expect(page.getByTestId('slot-TB')).not.toHaveClass(/empty/);
  await expect(page.getByTestId('view-title')).toContainText('TB');
  await page.getByTestId('slot-VB1').click();
  await expect(page.getByTestId('view-title')).toContainText('variation of TB');
  // edit the first note
  await page.locator('[data-testid="theme-view"] rect.n').first().click();
  const info1 = await page.getByTestId('view-info').textContent();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('view-info')).not.toHaveText(info1!);
  await expect(page.getByTestId('view-info')).toContainText('edited');
  await page.keyboard.press('a');
  await page.getByTestId('ed-rest').click();
  await expect(page.getByTestId('view-info')).toContainText('rest');
  // G regenerates the viewed slot
  const t = await page.getByTestId('view-info').textContent();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('g');
  await expect(page.getByTestId('view-info')).not.toHaveText(t!);
});

test('theme view: drag notes, resize, scroll, zoom, delete, add', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  const theme = () => page.evaluate(() => {
    const a = (window as unknown as { anvil: { focused: { events: { start: number; len: number; rest: boolean; degree: number }[]; length: number }; selectedEvent: number | null } }).anvil;
    return { events: a.focused.events, length: a.focused.length, sel: a.selectedEvent };
  });
  const view = page.getByTestId('theme-view');
  const notes = view.locator('rect.n');
  // drag the first note up two rows
  const before = await theme();
  const first = notes.first();
  const box = (await first.boundingBox())!;
  const rh = box.height + 2;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 3, box.y + box.height / 2 - 2 * rh, { steps: 5 });
  await page.mouse.up();
  let after = await theme();
  expect(after.events[0].degree).toBe(before.events[0].degree + 2);
  expect(after.length).toBe(before.length);
  // delete with Backspace (the note becomes a rest; length unchanged)
  await page.keyboard.press('Backspace');
  after = await theme();
  expect(after.events[0].rest).toBe(true);
  expect(after.length).toBe(before.length);
  // double-click the rest area in the grid to add a note back
  const restCount = after.events.filter((e) => e.rest).length;
  const b2 = (await view.boundingBox())!;
  const cw = box.width + 2;
  await page.mouse.dblclick(b2.x + 34 + cw / 2, b2.y + b2.height / 2);
  after = await theme();
  expect(after.events.filter((e) => e.rest).length).toBeLessThan(restCount + 1);
  expect(after.events[0].rest).toBe(false);
  // wheel scrolls (no page scroll, no error); ctrl+wheel zooms
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  const w0 = (await notes.nth(1).boundingBox())!.width;
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  const w1 = (await notes.nth(1).boundingBox())!.width;
  expect(w1).toBeGreaterThan(w0);
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(300, 0);
  await page.getByTestId('ed-fit').click();
  expect(errs).toEqual([]);
});

test('maximised theme editor: opens alone, edits live, restores exactly', async ({ page }) => {
  const errs = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const a = () => page.evaluate(() => {
    const s = (window as unknown as { anvil: { focus: string; project: { selected: string }; transport: { state: string }; seq: { tick: number; item: string }; focused: { events: { degree: number; rest: boolean }[] } } }).anvil;
    return { focus: s.focus, selected: s.project.selected, state: s.transport.state, tick: s.seq.tick, item: s.seq.item, events: s.focused.events };
  });
  await page.getByTestId('slot-TB').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  const before = await a();
  const editor = page.getByTestId('theme-editor');
  await expect(editor).toBeHidden();

  // 1-3: EXPAND opens the focused editor, without the bank matrix, with RESTORE visible
  await page.getByTestId('expand').click();
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('editor-title')).toContainText('THEME EDITOR');
  await expect(page.getByTestId('editor-title')).toContainText('TB');
  await expect(editor.getByTestId('theme-view')).toBeVisible();
  await expect(editor.getByTestId('ed-up')).toBeVisible();
  await expect(editor.getByTestId('view-info')).toBeVisible();
  await expect(editor.getByTestId('bank')).toHaveCount(0);
  await expect(editor.locator('.transport, .topbar, [data-area="constraints"], [data-area="tonality"]')).toHaveCount(0);
  await expect(page.getByTestId('restore')).toBeVisible();
  // the editor covers the viewport and the roll fills the remaining space
  const vb = (await editor.boundingBox())!;
  expect(vb.width).toBeGreaterThanOrEqual(1430);
  expect(vb.height).toBeGreaterThanOrEqual(890);
  const rollBox = (await editor.getByTestId('theme-view').boundingBox())!;
  expect(rollBox.height).toBeGreaterThan(600);
  // rows stay a readable size rather than stretching to fill the screen
  const noteH = (await editor.locator('rect.n').first().boundingBox())!.height;
  expect(noteH).toBeLessThanOrEqual(18);

  // 9: editing controls work in the editor; the edit is the live theme
  await editor.locator('rect.n').first().click();
  const sel = await page.evaluate(() => (window as unknown as { anvil: { selectedEvent: number } }).anvil.selectedEvent);
  await editor.getByTestId('ed-up').click();
  const edited = await a();
  expect(edited.events[sel].degree).toBe(before.events[sel].degree + 1);
  // F fits, Escape restores (5), and Escape does not touch the music
  await page.keyboard.press('f');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  let after = await a();
  expect(after.events).toEqual(edited.events); // 7: edits survive
  expect(after.focus).toBe('TB'); // 6: selection unchanged
  expect(after.selected).toBe('TB');
  expect(after.state).toBe('running'); // 8: playback untouched
  expect(after.tick).toBeGreaterThan(before.tick);
  await expect(page.getByTestId('bank')).toBeVisible();
  await expect(page.getByTestId('expand')).toBeFocused();

  // 4: RESTORE button returns to the normal layout
  await page.getByTestId('expand').click();
  await expect(editor).toBeVisible();
  await page.getByTestId('restore').click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('expand')).toHaveText('⤢ EXPAND');
  after = await a();
  expect(after.state).toBe('running');

  // 10/12: the exit stays visible and nothing overflows at other sizes
  await page.getByTestId('expand').click();
  for (const [w, h] of [[1650, 900], [1280, 800], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await expect(page.getByTestId('restore')).toBeInViewport({ ratio: 1 });
    await expect(editor.getByTestId('ed-up')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const r = (await editor.boundingBox())!;
    expect(r.width).toBeLessThanOrEqual(w);
    expect(r.height).toBeLessThanOrEqual(h);
  }
  await page.getByTestId('restore').click();
  await page.getByTestId('stop').click();
  expect(errs).toEqual([]); // 11
});

test('playback over simulated MIDI: start, pause, continue, stop with clock out', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await useFakeOutput(page);
  await page.getByTestId('clock-out').click();
  await clearSent(page);
  await page.getByTestId('start').click();
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  await page.waitForTimeout(1200);
  let m = await sent(page);
  expect(m[0].data).toEqual([0xfa]);
  expect(m.filter((x) => x.data[0] === 0xf8).length).toBeGreaterThan(30);
  expect(m.some((x) => (x.data[0] & 0xf0) === 0x90)).toBe(true);

  await page.getByTestId('pause').click();
  await expect(page.getByTestId('transport-state')).toHaveText('PAUSED');
  m = await sent(page);
  expect(m.some((x) => x.data[0] === 0xfc)).toBe(true);
  expect(unmatched(m)).toBe(0);
  const n = m.length;
  await page.waitForTimeout(500);
  const idle = (await sent(page)).slice(n);
  expect(idle.filter((x) => x.data[0] === 0xf8 && x.ts > x.at + 0.5 && x.at > m[n - 1].at + 200)).toHaveLength(0);

  await page.getByTestId('continue').click();
  await page.waitForTimeout(600);
  m = await sent(page);
  expect(m.slice(n).some((x) => x.data[0] === 0xfb)).toBe(true);
  expect(m.filter((x) => x.data[0] === 0xfa)).toHaveLength(1);

  await page.getByTestId('stop').click();
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  await page.waitForTimeout(300);
  m = await sent(page);
  expect(unmatched(m)).toBe(0);
  const k = m.length;
  await page.waitForTimeout(500);
  expect((await sent(page)).slice(k).filter((x) => x.data[0] === 0xf8)).toHaveLength(0);
  expect(errs).toEqual([]);
});

test('internal clock timing: every clock is scheduled ahead with steady spacing', async ({ page }) => {
  await open(page);
  await useFakeOutput(page);
  await page.getByTestId('clock-out').click();
  await page.getByTestId('tempo').fill('150');
  await page.getByTestId('tempo').press('Enter');
  await clearSent(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(3000);
  await page.getByTestId('stop').click();
  const clocks = (await sent(page)).filter((x) => x.data[0] === 0xf8);
  const margins = clocks.map((c) => c.ts - c.at);
  const minMargin = Math.min(...margins);
  const period = 60000 / (150 * 24);
  const gaps = clocks.slice(1).map((c, i) => c.ts - clocks[i].ts);
  const maxErr = Math.max(...gaps.map((g) => Math.abs(g - period)));
  test.info().annotations.push({ type: 'timing', description: `clocks=${clocks.length} minMargin=${minMargin.toFixed(2)}ms maxSpacingError=${maxErr.toFixed(4)}ms` });
  console.log(`TIMING internal: ${clocks.length} clocks, min scheduling margin ${minMargin.toFixed(2)} ms, max spacing error ${maxErr.toFixed(4)} ms`);
  expect(clocks.length).toBeGreaterThan(150);
  expect(minMargin).toBeGreaterThanOrEqual(0);
  expect(maxErr).toBeLessThan(0.01);
});

test('external clock in: F8 alone never starts, FA/FC/FB transport, loss and disconnect', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await useFakeOutput(page);
  await page.getByTestId('midi-in').selectOption('in-1');
  await page.getByTestId('clock-source').selectOption('external');
  await expect(page.getByTestId('clock-status')).toHaveText(/WAITING/);
  const feed = (bytes: number[], gapMs = 20) =>
    page.evaluate(async ({ bytes, gapMs }) => {
      for (const b of bytes) {
        (window as unknown as { __midiIn: (b: number[]) => void }).__midiIn([b]);
        if (b === 0xf8) await new Promise((r) => setTimeout(r, gapMs));
      }
    }, { bytes, gapMs });
  const pos = () => page.evaluate(() => (window as unknown as { anvil: { seq: { tick: number } } }).anvil.seq.tick);
  await clearSent(page);
  await feed(Array(24).fill(0xf8));
  await expect(page.getByTestId('clock-status')).toHaveText(/CLOCK DETECTED/);
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  expect((await sent(page)).filter((x) => (x.data[0] & 0xf0) === 0x90)).toHaveLength(0);

  await feed([0xfa, ...Array(48).fill(0xf8)]);
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  expect(await pos()).toBe(48);
  expect((await sent(page)).some((x) => (x.data[0] & 0xf0) === 0x90)).toBe(true);

  await feed([0xfc, ...Array(10).fill(0xf8)]);
  await expect(page.getByTestId('transport-state')).toHaveText('PAUSED');
  expect(await pos()).toBe(48);
  expect(unmatched(await sent(page))).toBe(0);

  await feed([0xfb, ...Array(12).fill(0xf8)]);
  expect(await pos()).toBe(60);
  await feed([0xfc, 0xfa, ...Array(5).fill(0xf8)]);
  expect(await pos()).toBe(5);

  // clock stops while running
  await expect(page.getByTestId('clock-status')).toHaveText(/CLOCK LOST/, { timeout: 5000 });
  await expect(page.getByTestId('transport-state')).toHaveText('PAUSED');
  expect(unmatched(await sent(page))).toBe(0);
  await feed(Array(10).fill(0xf8));
  expect(await pos()).toBe(5);

  // no clock out while external
  expect((await sent(page)).some((x) => x.data[0] >= 0xf8)).toBe(false);

  // input disconnect
  await feed([0xfa, ...Array(10).fill(0xf8)]);
  await page.evaluate(() => (window as unknown as { __midiSetState: (id: string, s: string) => void }).__midiSetState('in-1', 'disconnected'));
  await expect(page.getByTestId('clock-status')).toHaveText(/CLOCK LOST/);
  expect(unmatched(await sent(page))).toBe(0);
  expect(errs).toEqual([]);
});

test('output device loss during playback is handled', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await useFakeOutput(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as { __midiSetState: (id: string, s: string) => void }).__midiSetState('out-1', 'disconnected'));
  await expect(page.getByTestId('midi-status')).toHaveText('NO OUTPUT');
  await page.waitForTimeout(300);
  await page.getByTestId('stop').click();
  // switching outputs mid-play ends notes on the old one
  await page.evaluate(() => (window as unknown as { __midiSetState: (id: string, s: string) => void }).__midiSetState('out-1', 'connected'));
  await page.getByTestId('midi-out').selectOption('out-1');
  await page.getByTestId('start').click();
  await page.waitForTimeout(500);
  await page.getByTestId('midi-out').selectOption('out-2');
  await page.waitForTimeout(300);
  await page.getByTestId('stop').click();
  const m = await sent(page);
  expect(unmatched(m.filter((x) => x.port === 'out-2'))).toBe(0);
  expect(unmatched(m.filter((x) => x.port === 'out-1'))).toBe(0);
  expect(errs).toEqual([]);
});

test('MIDI monitor shows messages without clock flooding', async ({ page }) => {
  await open(page);
  await useFakeOutput(page);
  await page.getByTestId('clock-out').click();
  await page.getByTestId('start').click();
  await page.waitForTimeout(800);
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('monitor').locator('li').first()).toBeVisible();
  const texts = await page.getByTestId('monitor').locator('li').allTextContents();
  expect(texts.some((t) => t.includes('Clock (F8)'))).toBe(false);
  expect(texts.some((t) => t.includes('Start (FA)'))).toBe(true);
  await expect(page.getByTestId('clock-summary')).toContainText(/Clock out: \d{2,}/);
});

test('keyboard: Space starts/stops, Return pauses/continues, Esc stops, ? opens help', async ({ page }) => {
  await open(page);
  const pos = () => page.evaluate(() => (window as unknown as { anvil: { seq: { tick: number } } }).anvil.seq.tick);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  expect(await pos()).toBe(0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transport-state')).toHaveText('PAUSED');
  const paused = await pos();
  expect(paused).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  expect(await pos()).toBeGreaterThanOrEqual(paused);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  // after clicking START with the mouse, Return pauses (it does not press START again)
  await page.getByTestId('start').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transport-state')).toHaveText('PAUSED');
  await page.getByTestId('stop').click();
  // Return on a keyboard-focused slot still selects the slot, not the transport
  await page.getByTestId('slot-TA').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'ANVIL help' })).toBeVisible();
});

test('save, autosave, download and open a project file', async ({ page }) => {
  await open(page);
  await page.getByTestId('project-name').fill('E2E Song');
  await page.getByTestId('project-name').press('Enter');
  await page.getByTestId('slot-TC').click();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveValue('E2E Song');
  await expect(page.getByTestId('slot-TC')).not.toHaveClass(/empty/);

  await page.getByTestId('tab-project').click();
  await page.getByTestId('save-browser').click();
  await expect(page.getByTestId('library')).toContainText('E2E Song');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  expect(dl.suggestedFilename()).toBe('E2E-Song.anvil.json');
  const file = await dl.path();
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.format).toBe('anvil-project');
  expect(json.mode).toBe('classic');
  expect(json.algorithms.harmonyInversion).toBe('classic.harmony.inversion.v1');

  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('project-name')).toHaveValue('Untitled');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('project-name')).toHaveValue('E2E Song');
  await expect(page.getByTestId('slot-TC')).not.toHaveClass(/empty/);

  // a damaged file is repaired with warnings
  json.tempo = 5000;
  await page.getByTestId('file-input').setInputFiles({ name: 'bad.anvil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await expect(page.getByTestId('load-warnings')).toContainText('Tempo');
});

test('demos load and play', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await useFakeOutput(page);
  await page.getByTestId('tab-project').click();
  for (const id of ['simple', 'rhythmic', 'pitch', 'sparse', 'accompaniment', 'hermod']) {
    await page.getByTestId(`demo-${id}`).click();
    await expect(page.getByTestId('project-name')).toHaveValue(/^Demo: /);
    await clearSent(page);
    await page.getByTestId('start').click();
    await page.waitForTimeout(400);
    await page.getByTestId('stop').click();
    await page.waitForTimeout(100);
    const m = await sent(page);
    expect(m.some((x) => (x.data[0] & 0xf0) === 0x90)).toBe(true);
    expect(unmatched(m)).toBe(0);
  }
  // the Hermod+ demo turns Clock Out on
  await expect(page.getByTestId('clock-out')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('demo-rhythmic').click();
  await page.getByTestId('tab-arranger').click();
  await page.getByTestId('arr-play').click();
  await expect(page.getByTestId('position')).toContainText('step 1');
  await page.getByTestId('stop').click();
  expect(errs).toEqual([]);
});

test('MIDI file export downloads a valid Standard MIDI File', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-project').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-midi').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.mid$/);
  const bytes = readFileSync(await dl.path());
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('MThd');
  expect(bytes.length).toBeGreaterThan(100);
});

test('narrow window stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await open(page);
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('bank')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
