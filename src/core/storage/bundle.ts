/**
 * Portable project bundles: one ZIP holding an application's project file and every sample it
 * references, so a project can move between computers with its audio. Each sample is stored
 * once (by content hash) however many times the project uses it, and hashes are checked on
 * import. The project file itself is the application's business: Core only carries it.
 *
 *   manifest.json        { format, version, app, project, samples: [{ id, name, type, size, file }] }
 *   <project file name>  the application's project document
 *   samples/<id>.<ext>   original sample bytes
 */
import { createZip, readZip } from '../export/zip';
import { sha256Hex, type SampleMeta, type StoredSample } from './samples';

export const BUNDLE_FORMAT = 'slopfactory-bundle';
export const BUNDLE_VERSION = 1;

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: number;
  /** the application that wrote it, e.g. its name */
  app: string;
  /** file name of the project document inside the bundle */
  project: string;
  samples: (Omit<SampleMeta, 'added'> & { file: string })[];
}

export interface BundleContents {
  manifest: BundleManifest;
  projectText: string;
  samples: StoredSample[];
  /** samples listed but missing or damaged (the project still opens; those slots are missing) */
  problems: string[];
}

const ext = (name: string) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m ? m[1].toLowerCase() : 'bin';
};

export function writeBundle(app: string, projectFile: { name: string; text: string }, samples: StoredSample[]): Uint8Array {
  const unique = new Map<string, StoredSample>();
  for (const s of samples) if (!unique.has(s.id)) unique.set(s.id, s);
  const list = [...unique.values()].map((s) => ({ id: s.id, name: s.name, type: s.type, size: s.size, file: `samples/${s.id}.${ext(s.name)}` }));
  const manifest: BundleManifest = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, app, project: projectFile.name, samples: list };
  const enc = new TextEncoder();
  return createZip([
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 1)) },
    { name: projectFile.name, data: enc.encode(projectFile.text) },
    ...list.map((m) => ({ name: m.file, data: new Uint8Array(unique.get(m.id)!.bytes) })),
  ]);
}

export async function readBundle(bytes: Uint8Array, app: string): Promise<BundleContents> {
  let files;
  try {
    files = await readZip(bytes);
  } catch (e) {
    throw new Error(`This is not a readable project bundle (${(e as Error).message}).`);
  }
  const byName = new Map(files.map((f) => [f.name, f.data]));
  const mf = byName.get('manifest.json');
  if (!mf) throw new Error('This ZIP is not a project bundle (no manifest.json).');
  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(mf));
  } catch {
    throw new Error('The bundle manifest is damaged.');
  }
  if (manifest.format !== BUNDLE_FORMAT) throw new Error('This ZIP is not a project bundle.');
  if (!(manifest.version >= 1) || manifest.version > BUNDLE_VERSION) throw new Error(`This bundle was written by a newer version (bundle format ${manifest.version}).`);
  if (manifest.app !== app) throw new Error(`This bundle belongs to ${manifest.app}, not ${app}.`);
  const proj = byName.get(manifest.project);
  if (!proj) throw new Error('The bundle has no project file.');
  const problems: string[] = [];
  const samples: StoredSample[] = [];
  for (const m of Array.isArray(manifest.samples) ? manifest.samples : []) {
    const data = byName.get(m.file);
    if (!data) {
      problems.push(`Sample "${m.name}" is missing from the bundle.`);
      continue;
    }
    const id = await sha256Hex(data);
    if (id !== m.id) {
      problems.push(`Sample "${m.name}" is damaged (its contents do not match its fingerprint).`);
      continue;
    }
    samples.push({ id, name: m.name, type: m.type ?? '', size: data.length, added: Date.now(), bytes: data.slice().buffer });
  }
  return { manifest, projectText: new TextDecoder().decode(proj), samples, problems };
}
