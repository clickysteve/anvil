import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { readBundle, writeBundle } from '../../src/core/storage/bundle';
import { IndexedDbSampleStore, MemorySampleStore, sampleFromBytes, sha256Hex, StorageError } from '../../src/core/storage/samples';
import { createZip, readZip } from '../../src/core/export/zip';

const bytes = (...v: number[]) => new Uint8Array(v).buffer;

describe('sample stores', () => {
  it('identifies samples by the SHA-256 of their bytes', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const a = await sampleFromBytes(bytes(1, 2, 3), 'kick.wav', 'audio/wav');
    const b = await sampleFromBytes(bytes(1, 2, 3), 'copy of kick.wav');
    expect(a.id).toBe(b.id);
    expect(a.size).toBe(3);
  });

  for (const [label, make] of [
    ['IndexedDB', () => new IndexedDbSampleStore(`test-${Math.random()}`, new IDBFactory())],
    ['memory', () => new MemorySampleStore()],
  ] as const) {
    it(`${label}: stores, deduplicates, lists, reads back and deletes`, async () => {
      const st = make();
      const a = await sampleFromBytes(bytes(9, 8, 7), 'snare.wav', 'audio/wav');
      await st.put(a);
      const again = await st.put({ ...(await sampleFromBytes(bytes(9, 8, 7), 'other-name.wav')) });
      expect(again.name).toBe('snare.wav'); // first stored copy wins; stored once
      expect((await st.list()).length).toBe(1);
      expect(await st.has(a.id)).toBe(true);
      const back = await st.get(a.id);
      expect(new Uint8Array(back!.bytes)).toEqual(new Uint8Array([9, 8, 7]));
      expect(await st.get('missing')).toBeNull();
      await st.delete(a.id);
      expect(await st.has(a.id)).toBe(false);
    });
  }

  it('IndexedDB data survives reopening (a page reload)', async () => {
    const factory = new IDBFactory();
    const s1 = new IndexedDbSampleStore('reload-test', factory);
    const a = await sampleFromBytes(bytes(5, 5, 5, 5), 'pad.wav');
    await s1.put(a);
    const s2 = new IndexedDbSampleStore('reload-test', factory);
    expect((await s2.get(a.id))?.name).toBe('pad.wav');
  });

  it('reports quota and unavailable storage as StorageErrors', async () => {
    const st = new MemorySampleStore();
    st.quotaBytes = 2;
    await expect(st.put(await sampleFromBytes(bytes(1, 2, 3), 'x.wav'))).rejects.toMatchObject({ code: 'quota' });
    const none = new IndexedDbSampleStore('x', null);
    await expect(none.list()).rejects.toBeInstanceOf(StorageError);
    await expect(none.list()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('portable bundles', () => {
  it('round-trips the project file and each referenced sample once', async () => {
    const kick = await sampleFromBytes(bytes(1, 1, 1), 'Kick 01.WAV');
    const pad = await sampleFromBytes(bytes(2, 2, 2, 2), 'pad');
    const zip = writeBundle('ANVIL', { name: 'song.anvil.json', text: '{"a":1}' }, [kick, pad, kick]);
    const files = (await readZip(zip)).map((f) => f.name);
    expect(files).toEqual(['manifest.json', 'song.anvil.json', `samples/${kick.id}.wav`, `samples/${pad.id}.bin`]);
    const r = await readBundle(zip, 'ANVIL');
    expect(r.projectText).toBe('{"a":1}');
    expect(r.samples.map((s) => s.name)).toEqual(['Kick 01.WAV', 'pad']);
    expect(r.problems).toEqual([]);
    expect(new Uint8Array(r.samples[1].bytes)).toEqual(new Uint8Array([2, 2, 2, 2]));
  });

  it('reports missing and damaged samples but still opens the project', async () => {
    const kick = await sampleFromBytes(bytes(1, 1, 1), 'kick.wav');
    const good = await readZip(writeBundle('ANVIL', { name: 'p.json', text: '{}' }, [kick]));
    const damaged = createZip(good.map((f) => (f.name.startsWith('samples/') ? { ...f, data: new Uint8Array([7, 7, 7]) } : f)));
    expect((await readBundle(damaged, 'ANVIL')).problems[0]).toContain('damaged');
    const missing = createZip(good.filter((f) => !f.name.startsWith('samples/')));
    const r = await readBundle(missing, 'ANVIL');
    expect(r.problems[0]).toContain('missing');
    expect(r.projectText).toBe('{}');
  });

  it('refuses things that are not bundles for this application', async () => {
    const zip = writeBundle('DOWNBEAT', { name: 'p.json', text: '{}' }, []);
    await expect(readBundle(zip, 'ANVIL')).rejects.toThrow(/belongs to DOWNBEAT/);
    await expect(readBundle(new Uint8Array(40), 'ANVIL')).rejects.toThrow(/not a readable project bundle/);
    await expect(readBundle(createZip([{ name: 'x', data: new Uint8Array(1) }]), 'ANVIL')).rejects.toThrow(/no manifest/);
  });
});
