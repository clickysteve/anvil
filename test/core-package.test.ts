/**
 * ANVIL uses the shared Slop Factory Core package: a pinned version tag of its own repository,
 * installed and imported by name. No copy of Core lives in ANVIL.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '@slopfactory/core';

const ROOT = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; resolved?: string }> };
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe('Slop Factory Core dependency', () => {
  it('is an immutable commit (or version tag) of the Core repository, the same commit in the lockfile', () => {
    const spec = pkg.dependencies['@slopfactory/core'];
    expect(spec).toMatch(/^(github:clickysteve\/slopfactory-core|git\+https:\/\/github\.com\/clickysteve\/slopfactory-core\.git)#([0-9a-f]{40}|v\d+\.\d+\.\d+)$/);
    const entry = lock.packages['node_modules/@slopfactory/core'];
    expect(entry?.resolved).toMatch(/github\.com\/clickysteve\/slopfactory-core\.git#[0-9a-f]{40}$/);
    const ref = spec.split('#')[1]!;
    if (/^[0-9a-f]{40}$/.test(ref)) expect(entry!.resolved!.endsWith(ref)).toBe(true);
    else expect(`v${entry?.version}`).toBe(ref);
  });

  it('is the installed version', () => {
    expect(CORE_VERSION).toBe(lock.packages['node_modules/@slopfactory/core']?.version);
  });

  it('has no local copy in ANVIL, and ANVIL imports it only by package name', () => {
    expect(existsSync(join(ROOT, 'src/core'))).toBe(false);
    const offenders = walk(join(ROOT, 'src'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /from\s+['"](\.\.?\/)+core\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
