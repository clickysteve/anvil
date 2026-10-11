/**
 * Browser-local sample storage.
 *
 * Samples are stored as the original file bytes, keyed by the SHA-256 of those bytes, so the
 * same file imported twice (or used by several projects or slots) is stored once. Projects
 * keep only the id and a display name. Nothing leaves the browser.
 */

export interface SampleMeta {
  /** SHA-256 of the bytes, lower-case hex */
  id: string;
  /** original file name */
  name: string;
  /** MIME type, if known */
  type: string;
  size: number;
  /** ms since 1970, when first stored */
  added: number;
}

export interface StoredSample extends SampleMeta {
  bytes: ArrayBuffer;
}

export type StorageErrorCode = 'quota' | 'unavailable' | 'failed';

export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface SampleStore {
  /** store (no-op if the id is already stored); returns the stored metadata */
  put(sample: StoredSample): Promise<SampleMeta>;
  get(id: string): Promise<StoredSample | null>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  list(): Promise<SampleMeta[]>;
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new StorageError('unavailable', 'This browser cannot fingerprint samples (no Web Crypto: the page must be served over https or from localhost).');
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a StoredSample from file bytes. */
export async function sampleFromBytes(bytes: ArrayBuffer, name: string, type = ''): Promise<StoredSample> {
  return { id: await sha256Hex(bytes), name, type, size: bytes.byteLength, added: Date.now(), bytes };
}

const meta = (s: StoredSample): SampleMeta => ({ id: s.id, name: s.name, type: s.type, size: s.size, added: s.added });

export class MemorySampleStore implements SampleStore {
  private items = new Map<string, StoredSample>();
  /** set to simulate a full disk */
  quotaBytes = Infinity;

  async put(s: StoredSample): Promise<SampleMeta> {
    const existing = this.items.get(s.id);
    if (existing) return meta(existing);
    const used = [...this.items.values()].reduce((a, x) => a + x.size, 0);
    if (used + s.size > this.quotaBytes) throw new StorageError('quota', 'Browser storage is full: the sample was not saved.');
    this.items.set(s.id, { ...s, bytes: s.bytes.slice(0) });
    return meta(s);
  }
  async get(id: string) {
    const s = this.items.get(id);
    return s ? { ...s, bytes: s.bytes.slice(0) } : null;
  }
  async has(id: string) {
    return this.items.has(id);
  }
  async delete(id: string) {
    this.items.delete(id);
  }
  async list() {
    return [...this.items.values()].map(meta);
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function wrap(e: unknown): StorageError {
  const name = (e as DOMException | null)?.name ?? '';
  if (name === 'QuotaExceededError') return new StorageError('quota', 'Browser storage is full: the sample was not saved. Free some space or remove unused samples.');
  return new StorageError('failed', `Browser storage failed: ${(e as Error | null)?.message ?? name ?? 'unknown error'}.`);
}

/** IndexedDB store: one database per application, one object store of samples. */
export class IndexedDbSampleStore implements SampleStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(readonly dbName: string, private factory: IDBFactory | null = globalThis.indexedDB ?? null) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const f = this.factory;
      if (!f) return Promise.reject(new StorageError('unavailable', 'This browser has no IndexedDB, so samples cannot be kept between visits.'));
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        let r: IDBOpenDBRequest;
        try {
          r = f.open(this.dbName, 1);
        } catch (e) {
          reject(new StorageError('unavailable', `Browser storage is unavailable (${(e as Error).message}).`));
          return;
        }
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('samples')) r.result.createObjectStore('samples', { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(new StorageError('unavailable', `Browser storage is unavailable (${r.error?.message ?? 'blocked'}).`));
        r.onblocked = () => reject(new StorageError('unavailable', 'Browser storage is blocked by another tab.'));
      });
      this.db.catch(() => (this.db = null));
    }
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      const t = db.transaction('samples', mode);
      const result = await req(fn(t.objectStore('samples')));
      await new Promise<void>((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      return result;
    } catch (e) {
      throw e instanceof StorageError ? e : wrap(e);
    }
  }

  async put(s: StoredSample): Promise<SampleMeta> {
    const existing = await this.tx('readonly', (st) => st.get(s.id) as IDBRequest<StoredSample | undefined>);
    if (existing) return meta(existing);
    await this.tx('readwrite', (st) => st.put(s));
    return meta(s);
  }
  async get(id: string): Promise<StoredSample | null> {
    return (await this.tx('readonly', (st) => st.get(id) as IDBRequest<StoredSample | undefined>)) ?? null;
  }
  async has(id: string): Promise<boolean> {
    return (await this.tx('readonly', (st) => st.count(id))) > 0;
  }
  async delete(id: string): Promise<void> {
    await this.tx('readwrite', (st) => st.delete(id));
  }
  async list(): Promise<SampleMeta[]> {
    const all = await this.tx('readonly', (st) => st.getAll() as IDBRequest<StoredSample[]>);
    return all.map(meta);
  }
}
