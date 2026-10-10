/**
 * Browser storage: the autosaved working project and a named project library, in
 * localStorage. Every access is guarded; a private window or full storage just means nothing
 * is kept between sessions (ANVIL keeps working).
 */
import type { Project } from '../engine/types';
import { loadProject, serializeProject, type LoadResult } from './format';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const KEY_AUTOSAVE = 'anvil.autosave';
export const KEY_LIBRARY = 'anvil.library';
const KEY_ITEM = (id: string) => `anvil.project.${id}`;

export interface LibraryEntry {
  id: string;
  name: string;
  saved: number;
}

export function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class ProjectStorage {
  lastError = '';
  constructor(private store: KeyValueStore | null = defaultStore()) {}

  private get(k: string): string | null {
    try {
      return this.store?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }

  private set(k: string, v: string): boolean {
    try {
      if (!this.store) return false;
      this.store.setItem(k, v);
      this.lastError = '';
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'storage unavailable';
      return false;
    }
  }

  autosave(p: Project): boolean {
    return this.set(KEY_AUTOSAVE, serializeProject(p));
  }

  loadAutosave(): LoadResult | null {
    const raw = this.get(KEY_AUTOSAVE);
    if (!raw) return null;
    try {
      return loadProject(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  library(): LibraryEntry[] {
    try {
      const v = JSON.parse(this.get(KEY_LIBRARY) ?? '[]');
      return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Save under the project's name (replacing an entry with the same name). */
  saveNamed(p: Project): LibraryEntry | null {
    const lib = this.library();
    let entry = lib.find((e) => e.name === p.name);
    if (!entry) {
      entry = { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name: p.name, saved: Date.now() };
      lib.push(entry);
    }
    entry.saved = Date.now();
    if (!this.set(KEY_ITEM(entry.id), serializeProject(p))) return null;
    this.set(KEY_LIBRARY, JSON.stringify(lib));
    return entry;
  }

  loadNamed(id: string): LoadResult | null {
    const raw = this.get(KEY_ITEM(id));
    if (!raw) return null;
    return loadProject(JSON.parse(raw));
  }

  remove(id: string): void {
    const lib = this.library().filter((e) => e.id !== id);
    this.set(KEY_LIBRARY, JSON.stringify(lib));
    try {
      this.store?.removeItem(KEY_ITEM(id));
    } catch {
      /* ignore */
    }
  }
}
