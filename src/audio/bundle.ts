/**
 * ANVIL portable project bundles (.anvilpack): the project file plus every sample it uses,
 * via Slop Factory Core's bundle format. Plain .anvil.json downloads never contain audio.
 */
import { readBundle, writeBundle } from '../core/storage/bundle';
import type { SampleStore, StoredSample } from '../core/storage/samples';
import type { Project } from '../engine/types';
import { projectFileName, serializeProject } from '../persistence/format';
import { referencedSamples } from './settings';

export const BUNDLE_APP = 'ANVIL';
export const BUNDLE_EXT = '.anvilpack';

export async function makeBundle(project: Project, store: SampleStore | null): Promise<{ name: string; bytes: Uint8Array; missing: string[] }> {
  const samples: StoredSample[] = [];
  const missing: string[] = [];
  for (const id of referencedSamples(project.audio)) {
    const s = store ? await store.get(id) : null;
    if (s) samples.push(s);
    else missing.push(project.audio.slots.find((x) => x.sampleId === id)?.name || id.slice(0, 8));
  }
  const name = projectFileName(project);
  return { name: name.replace(/\.anvil\.json$/, BUNDLE_EXT), bytes: writeBundle(BUNDLE_APP, { name, text: serializeProject(project) }, samples), missing };
}

/** Store the bundle's samples and return the project text to open, with any problems. */
export async function unpackBundle(bytes: Uint8Array, store: SampleStore | null): Promise<{ projectText: string; problems: string[]; stored: number }> {
  const b = await readBundle(bytes, BUNDLE_APP);
  const problems = [...b.problems];
  let stored = 0;
  for (const s of b.samples) {
    if (!store) {
      problems.push(`Sample "${s.name}" could not be kept: browser storage is unavailable.`);
      continue;
    }
    try {
      await store.put(s);
      stored++;
    } catch (e) {
      problems.push(`Sample "${s.name}" could not be stored: ${(e as Error).message}`);
    }
  }
  return { projectText: b.projectText, problems, stored };
}
