import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  createDossierArchive,
  createFilesystemStore,
  sha256,
  validateStorageKey,
} from '../src/index.js';

const roots: string[] = [];
async function fixture(maxBytes = 1024) {
  const root = await mkdtemp(join(tmpdir(), 'zazie-storage-'));
  roots.push(root);
  return { root, store: createFilesystemStore({ root, maxBytes }) };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('filesystem artifact storage', () => {
  it('publishes immutable bytes and supports concurrent identical retries', async () => {
    const { store } = await fixture();
    const bytes = new TextEncoder().encode('evidence');
    const receipts = await Promise.all([
      store.put('org/system/report', bytes),
      store.put('org/system/report', bytes),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(
      await store.get('org/system/report', { expectedSha256: sha256(bytes) }),
    ).toEqual(Buffer.from(bytes));
    await expect(
      store.put('org/system/report', new Uint8Array([1])),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.exists('org/system/report')).toBe(true);
    await store.delete('org/system/report');
    expect(await store.exists('org/system/report')).toBe(false);
    await store.delete('org/system/report');
  });

  it('fails closed for corruption, missing evidence, and size limits', async () => {
    const { root, store } = await fixture(5);
    await expect(
      store.put('oversized', new Uint8Array(6)),
    ).rejects.toMatchObject({ code: 'too_large' });
    await expect(store.get('missing')).rejects.toMatchObject({
      code: 'not_found',
    });
    const receipt = await store.put('report', new Uint8Array([1, 2]));
    await writeFile(join(root, 'report'), new Uint8Array([3, 4]));
    await expect(
      store.get('report', { expectedSha256: receipt.sha256 }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects path traversal, unsafe encodings and symbolic links', async () => {
    for (const key of [
      '../secret',
      '/secret',
      'a/../secret',
      'a//b',
      'a\\b',
      'a/%2e%2e',
      '.',
      'a/./b',
      'a\0b',
    ]) {
      expect(() => validateStorageKey(key)).toThrow();
    }
    const { root, store } = await fixture();
    const outside = await fixture();
    await symlink(outside.root, join(root, 'linked'));
    await expect(
      store.put('linked/file', new Uint8Array([1])),
    ).rejects.toMatchObject({ code: 'invalid_key' });
    await outside.store.put('file', new Uint8Array([2]));
    await symlink(join(outside.root, 'file'), join(root, 'linked-file'));
    await expect(store.get('linked-file')).rejects.toMatchObject({
      code: 'invalid_key',
    });
  });
});

describe('dossier export', () => {
  it('is byte reproducible, escapes untrusted HTML and includes verifiable evidence', async () => {
    const { store } = await fixture();
    const receipt = await store.put(
      'evidence',
      new TextEncoder().encode('evaluation measurements'),
    );
    const input = {
      id: 'dossier-1',
      createdAt: '2026-09-23T10:00:00.000Z',
      store,
      snapshot: { manifest: { model: '<script>bad()</script>' }, revision: 2 },
      sections: [
        {
          id: 'risk',
          title: 'Risk review',
          status: 'unreviewed' as const,
          note: 'Owner review pending',
        },
      ],
      evidence: [
        {
          id: 'e1',
          key: receipt.key,
          sha256: receipt.sha256,
          name: '../../evil.html',
        },
      ],
    };
    const first = await createDossierArchive(input);
    const second = await createDossierArchive(input);
    expect(first.sha256).toBe(second.sha256);
    const files = unzipSync(first.bytes);
    expect(Object.keys(files)).toEqual([
      'dossier.html',
      'evidence/00001.bin',
      'manifest.json',
      'sections.json',
      'snapshot.json',
    ]);
    expect(strFromU8(files['dossier.html']!)).toContain('&lt;script&gt;');
    expect(strFromU8(files['dossier.html']!)).not.toContain('<script>');
    for (const file of first.manifest.files)
      expect(sha256(files[file.path]!)).toBe(file.sha256);
    expect(first.manifest.omissions).toContain(
      'Risk review: unreviewed — Owner review pending',
    );
  });

  it('records unavailable or corrupted artifacts without pretending the archive is complete', async () => {
    const { store, root } = await fixture();
    const receipt = await store.put('bad', new Uint8Array([1]));
    await writeFile(join(root, 'bad'), new Uint8Array([2]));
    const result = await createDossierArchive({
      id: 'dossier-2',
      createdAt: '2026-09-23T10:00:00.000Z',
      store,
      snapshot: {},
      sections: [],
      evidence: [
        { id: 'bad', name: 'bad', key: 'bad', sha256: receipt.sha256 },
        {
          id: 'missing',
          name: 'missing',
          key: 'missing',
          sha256: '0'.repeat(64),
        },
      ],
    });
    expect(result.manifest.evidence.map((entry) => entry.status)).toEqual([
      'integrity_failure',
      'unavailable',
    ]);
    expect(result.manifest.omissions).toHaveLength(2);
  });
});
