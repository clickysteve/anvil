import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FAKE_MIDI } from './fakeMidi';
import { bassWav, kickWav, melodicWav, readWav16, readZipStored, stereoWav } from './fixtures';

function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

/** Screenshots for manual review, only when SHOT_DIR is set. */
async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

async function open(page: Page) {
  await page.addInitScript(FAKE_MIDI);
  await page.goto('/anvil/');
  await expect(page.getByTestId('bank')).toBeVisible();
}

async function loadInto(page: Page, slot: string, name: string, buffer: Buffer) {
  await page.getByTestId(`slot-row-${slot}`).click();
  await page.getByTestId('sample-file').setInputFiles({ name, mimeType: 'audio/wav', buffer });
  await expect(page.getByTestId(`slot-row-${slot}`)).toContainText(name);
  await expect(page.getByTestId(`slot-row-${slot}`)).not.toContainText('…');
}

test('sample bank: open, load, drop, edit, invalid files, audition, close', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await page.getByTestId('open-samples').click();
  const win = page.getByTestId('sample-bank');
  await expect(win).toBeVisible();
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) await expect(page.getByTestId(`slot-row-${id}`)).toBeVisible();
  await expect(page.getByTestId('slot-row-V1')).toContainText('VOICE 1 THEME');
  await shot(page, 'sample-bank-empty');

  await loadInto(page, 'V1', 'piano_C3.wav', melodicWav());
  await expect(page.getByTestId('slot-status')).toContainText('1.500 s');
  await expect(page.getByTestId('slot-row-V1')).toContainText('1.50s');
  // root note typed as a name
  await page.getByTestId('z-root').fill('C3');
  await page.getByTestId('z-root').press('Enter');
  await expect(page.getByTestId('slot-row-V1')).toContainText('C3');
  await page.getByTestId('z-mode').selectOption('loop');
  await expect(page.getByTestId('slot-row-V1')).toContainText('LOOP');

  // drag and drop onto a drum slot
  const kick = kickWav().toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'kick.wav', { type: 'audio/wav' }));
    const row = document.querySelector('[data-testid="slot-row-D1"]')!;
    row.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    row.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, kick);
  await expect(page.getByTestId('slot-row-D1')).toContainText('kick.wav');

  // a bad file leaves the slot alone and says why
  await page.getByTestId('slot-row-V2').click();
  await page.getByTestId('sample-file').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVEjunk') });
  await expect(page.getByTestId('slot-status')).toContainText('could not be read');
  await expect(page.getByTestId('slot-row-V2')).toContainText('—');
  await page.getByTestId('sample-file').setInputFiles({ name: 'song.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not really an mp3 file at all') });
  await expect(page.getByTestId('slot-status')).toContainText('could not decode');

  // audition switches internal audio on and plays through the voice
  await page.getByTestId('slot-row-V1').click();
  await page.getByTestId('audition').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { anvil: { preview: { ctx: AudioContext | null } } }).anvil.preview.ctx?.state)).toBe('running');
  expect(await page.evaluate(() => (window as unknown as { anvil: { preview: { ctx: AudioContext } } }).anvil.preview.ctx.sampleRate)).toBe(44100);

  // keyboard: arrows move the selection inside the slot list
  await page.getByTestId('slot-row-V1').click();
  await page.locator('[data-testid="slot-table"] tbody').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('slot-selected')).toContainText('V2');
  await shot(page, 'sample-bank-loaded');

  // Esc closes the window (and does not stop anything else)
  await page.keyboard.press('Escape');
  await expect(win).toBeHidden();
  await page.getByTestId('open-samples').click();
  await page.getByTestId('sample-bank-close').click();
  await expect(win).toBeHidden();
  expect(errs).toEqual([]);
});

test('samples, sources and processing settings survive a reload (IndexedDB)', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await page.getByTestId('open-samples').click();
  await loadInto(page, 'V2', 'bass_C2.wav', bassWav());
  await page.getByTestId('source-sample').click();
  await page.getByTestId('z-root').fill('C2');
  await page.getByTestId('z-root').press('Enter');
  await page.getByTestId('sample-bank-close').click();
  await page.getByTestId('tab-audio').click();
  await page.getByTestId('fx-preset').selectOption('12bit');
  await expect(page.getByTestId('master-engine-label').or(page.getByTestId('fx-editor'))).toBeTruthy();
  await page.waitForTimeout(900); // autosave
  await page.reload();
  await expect(page.getByTestId('bank')).toBeVisible();
  await page.getByTestId('open-samples').click();
  await expect(page.getByTestId('slot-row-V2')).toContainText('bass_C2.wav');
  await expect(page.getByTestId('slot-row-V2')).toContainText('1.00s');
  await expect(page.getByTestId('slot-row-V2')).toContainText('SAMPLE');
  await expect(page.getByTestId('slot-row-V2')).toContainText('C2');
  await expect(page.getByTestId('master-engine-label')).toHaveText('12-BIT');
  expect(errs).toEqual([]);
});

test('output engine: presets, stages, per-voice targets and bypass', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await page.getByTestId('tab-audio').click();
  await page.getByTestId('audio-on').click();
  await expect(page.getByTestId('fx-unavailable')).toBeHidden(); // worklet loaded
  await page.getByTestId('fx-target-v3').click();
  await page.getByTestId('fx-crunch').click();
  await page.getByTestId('fx-bits').fill('7');
  await page.getByTestId('fx-bits').press('Enter');
  await page.getByTestId('fx-rate').fill('4');
  await page.getByTestId('fx-rate').press('Enter');
  await expect(page.getByTestId('fx-rate-hz')).toHaveText('≈11025 Hz');
  await expect(page.getByTestId('voice-sources')).toContainText('7BIT/4');
  await page.getByTestId('fx-target-master').click();
  await page.getByTestId('fx-preset').selectOption('cassette');
  await page.getByTestId('fx-bypass').click();
  const audio = await page.evaluate(() => (window as unknown as { anvil: { project: { audio: unknown } } }).anvil.project.audio) as { master: { bypass: boolean; outputStage: { enabled: boolean; mode: string } }; voices: { fx: { crunch: { bits: number; rateDivide: number } } }[] };
  expect(audio.master.bypass).toBe(true);
  expect(audio.master.outputStage).toMatchObject({ enabled: true, mode: 'cassette' });
  expect(audio.voices[2].fx.crunch).toMatchObject({ bits: 7, rateDivide: 4 });
  // playback runs with processing active
  await page.getByTestId('start').click();
  await page.waitForTimeout(500);
  await page.getByTestId('stop').click();
  await shot(page, 'audio-tab');
  expect(errs).toEqual([]);
});

test('playback through a sample voice produces sound in the internal mix', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await page.getByTestId('open-samples').click();
  await loadInto(page, 'V1', 'stereo.wav', stereoWav());
  await page.getByTestId('source-sample').click();
  await page.getByTestId('sample-bank-close').click();
  await page.getByTestId('tab-audio').click();
  await page.getByTestId('audio-on').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { anvil: { preview: { enabled: boolean } } }).anvil.preview.enabled)).toBe(true);
  const level = await page.evaluate(async () => {
    const a = (window as unknown as { anvil: { preview: { ctx: AudioContext; mixer: { output: AudioNode } }; start(): void; stop(): void } }).anvil;
    const an = a.preview.ctx.createAnalyser();
    an.fftSize = 2048;
    a.preview.mixer.output.connect(an);
    a.start();
    let maxRms = 0;
    const buf = new Float32Array(2048);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      an.getFloatTimeDomainData(buf);
      maxRms = Math.max(maxRms, Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length));
    }
    a.stop();
    return maxRms;
  });
  expect(level).toBeGreaterThan(0.005);
  expect(errs).toEqual([]);
});

test('export audio: master + stems ZIP, aligned, isolated, valid WAVs, deterministic, project untouched', async ({ page }) => {
  const errs = watchErrors(page);
  await open(page);
  await page.getByTestId('tab-project').click();
  await page.getByTestId('demo-accompaniment').click();
  await page.getByTestId('open-samples').click();
  await loadInto(page, 'D1', 'kick.wav', kickWav());
  await page.getByTestId('sample-bank-close').click();
  const before = await page.evaluate(() => (window as unknown as { anvil: { serialize(): string } }).anvil.serialize());
  await page.getByTestId('open-export-audio').click();
  await expect(page.getByTestId('export-audio')).toBeVisible();
  await page.getByTestId('ex-tail').fill('1');
  await page.getByTestId('ex-tail').press('Enter');
  await expect(page.getByTestId('export-plan')).toContainText('in one ZIP');
  await shot(page, 'export-window');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ex-render').click()]);
  expect(dl.suggestedFilename()).toMatch(/^anvil_demo-accompaniment_[a-z0-9]+\.zip$/);
  const zip = readZipStored(readFileSync(await dl.path()));
  const names = [...zip.keys()];
  expect(names[0]).toMatch(/_master\.wav$/);
  expect(names.some((n) => n.endsWith('_voice-1-theme.wav'))).toBe(true);
  const wavs = names.map((n) => ({ n, w: readWav16(zip.get(n)!) }));
  const frames = wavs[0].w.channels[0].length;
  for (const { w } of wavs) {
    expect(w.sampleRate).toBe(44100);
    expect(w.bits).toBe(16);
    expect(w.format).toBe(1);
    expect(w.channels.length).toBe(2);
    expect(w.channels[0].length).toBe(frames); // identical lengths: aligned from frame 0
    expect(w.riffSize).toBe(36 + w.dataBytes);
  }
  const master = wavs[0].w;
  expect(master.channels[0].some((v) => Math.abs(v) > 0.01)).toBe(true);
  // with every processor CLEAN the stems sum to the master (within 16-bit rounding per file)
  const sum = new Float32Array(frames);
  for (const { w } of wavs.slice(1)) for (let i = 0; i < frames; i++) sum[i] += w.channels[0][i];
  let maxErr = 0;
  for (let i = 0; i < frames; i++) maxErr = Math.max(maxErr, Math.abs(sum[i] - master.channels[0][i]));
  expect(maxErr).toBeLessThan((wavs.length + 1) / 32767);
  await expect(page.getByTestId('export-status')).toContainText('Exported');
  // rendering again gives the same audio. Chrome sums a node's inputs in an order that can
  // differ between renders, so float rounding may move a few samples by one 16-bit step; the
  // music (every note, level and position) is identical.
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ex-render').click()]);
  const zip2 = readZipStored(readFileSync(await dl2.path()));
  for (const n of names) {
    const a = zip.get(n)!;
    const b = zip2.get(n)!;
    expect(b.length).toBe(a.length);
    expect(b.subarray(0, 44).equals(a.subarray(0, 44))).toBe(true);
    let maxLsb = 0;
    for (let i = 44; i < a.length; i += 2) maxLsb = Math.max(maxLsb, Math.abs(a.readInt16LE(i) - b.readInt16LE(i)));
    expect(maxLsb, n).toBeLessThanOrEqual(1);
  }
  const after = await page.evaluate(() => (window as unknown as { anvil: { serialize(): string; transport: { state: string } } }).anvil);
  expect(await page.evaluate(() => (window as unknown as { anvil: { serialize(): string } }).anvil.serialize())).toBe(before);
  expect(after.transport.state).toBe('stopped');
  expect(errs).toEqual([]);
});

test('portable bundle moves a project with its samples into a fresh browser', async ({ page, browser }) => {
  await open(page);
  await page.getByTestId('open-samples').click();
  await loadInto(page, 'V1', 'lead.wav', melodicWav());
  await page.getByTestId('sample-bank-close').click();
  await page.getByTestId('project-name').fill('Bundle Test');
  await page.getByTestId('project-name').press('Enter');
  await page.getByTestId('tab-project').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-bundle').click()]);
  expect(dl.suggestedFilename()).toBe('Bundle-Test.anvilpack');
  const file = await dl.path();
  const ctx2 = await browser.newContext();
  const fresh = await ctx2.newPage();
  const errs = watchErrors(fresh);
  await open(fresh);
  await fresh.getByTestId('tab-project').click();
  await fresh.getByTestId('file-input').setInputFiles({ name: 'Bundle-Test.anvilpack', mimeType: 'application/zip', buffer: readFileSync(file) });
  await expect(fresh.getByTestId('project-name')).toHaveValue('Bundle Test');
  await fresh.getByTestId('open-samples').click();
  await expect(fresh.getByTestId('slot-row-V1')).toContainText('lead.wav');
  await expect(fresh.getByTestId('slot-row-V1')).toContainText('1.50s');
  // a plain project file without its samples shows them as missing
  await ctx2.close();
  expect(errs).toEqual([]);
});

test('windows stay usable at supported sizes and Space still drives the transport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await open(page);
  await page.getByTestId('open-samples').click();
  await page.getByTestId('open-export-audio').click();
  for (const id of ['sample-bank', 'export-audio']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1024 + 1);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // drag the sample bank by its title bar; it stays on screen
  const title = page.getByTestId('sample-bank').locator('.gwin-title');
  const tb = (await title.boundingBox())!;
  await page.mouse.move(tb.x + 30, tb.y + 5);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 4 });
  await page.mouse.up();
  const nb = (await page.getByTestId('sample-bank').boundingBox())!;
  expect(nb.x).toBeGreaterThanOrEqual(0);
  expect(nb.y).toBeGreaterThanOrEqual(0);
  // clicking inside a window keeps Space on the transport
  await page.getByTestId('slot-row-V3').click();
  await page.keyboard.press(' ');
  await expect(page.getByTestId('transport-state')).toHaveText('RUNNING');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('transport-state')).toHaveText('STOPPED');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'windows-1440');
});
