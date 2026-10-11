import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve(__dirname, '../../src/core');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts') ? [p] : [];
  });
}

describe('Slop Factory Core boundary', () => {
  it('never imports application code (it can be extracted to its own package unchanged)', () => {
    const offenders: string[] = [];
    for (const f of files(CORE)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        if (!spec.startsWith('.')) {
          offenders.push(`${relative(CORE, f)} imports package "${spec}"`);
          continue;
        }
        const target = resolve(dirname(f), spec.replace(/\?.*$/, ''));
        if (!target.startsWith(CORE)) offenders.push(`${relative(CORE, f)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('mentions no application by name in its code', () => {
    const hits = files(CORE)
      .filter((f) => !f.includes('/vendor/'))
      .filter((f) => /\b(anvil|downbeat|emmm|feelers|frakmc)\b/i.test(readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
      .map((f) => relative(CORE, f));
    expect(hits).toEqual([]);
  });
});
