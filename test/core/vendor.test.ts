import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const BASE = join(__dirname, '../../src/core/dsp/vendor/goodbits');
const MARKER = '\n// --- ANVIL / Slop Factory Core vendoring addition';

function jsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? jsFiles(p) : f.endsWith('.js') ? [relative(BASE, p)] : [];
  });
}

describe('vendored Good Bits DSP', () => {
  const manifest = JSON.parse(readFileSync(join(BASE, 'vendor.json'), 'utf8')) as { commit: string; files: Record<string, string> };

  it('lists every vendored file', () => {
    expect(jsFiles(BASE).sort()).toEqual(Object.keys(manifest.files).sort());
  });

  it('is byte-identical to the recorded upstream commit (outputstage.js only gains an appended export)', () => {
    for (const [rel, hash] of Object.entries(manifest.files)) {
      let text = readFileSync(join(BASE, rel), 'utf8');
      if (rel === 'js/outputstage.js') {
        expect(text.includes(MARKER)).toBe(true);
        text = text.slice(0, text.indexOf(MARKER));
      }
      expect(createHash('sha256').update(text).digest('hex'), rel).toBe(hash);
    }
  });
});
