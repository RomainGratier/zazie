import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createS3Store, sha256 } from '../src/index.js';

const endpoint = process.env['ZAZIE_TEST_S3_ENDPOINT'];

// Use an isolated pre-created bucket (for example MinIO). No cloud resources are provisioned here.
describe.skipIf(!endpoint)('S3-compatible storage parity', () => {
  it('supports immutable retries, integrity checks, unavailable evidence and cleanup', async () => {
    const store = createS3Store({
      endpoint: endpoint!,
      region: 'us-east-1',
      forcePathStyle: true,
      bucket: process.env['ZAZIE_TEST_S3_BUCKET'] ?? 'zazie-test',
      maxBytes: 1024,
      credentials: {
        accessKeyId: process.env['ZAZIE_TEST_S3_ACCESS_KEY'] ?? 'zazie-test',
        secretAccessKey:
          process.env['ZAZIE_TEST_S3_SECRET_KEY'] ?? 'zazie-test-secret',
      },
    });
    const key = `test/${randomUUID()}/evidence`;
    const bytes = new TextEncoder().encode('stored evaluation evidence');
    try {
      expect(await store.exists(key)).toBe(false);
      await expect(store.get(key)).rejects.toMatchObject({ code: 'not_found' });
      const receipt = await store.put(key, bytes);
      expect(await store.put(key, bytes)).toEqual(receipt);
      expect(await store.get(key, { expectedSha256: sha256(bytes) })).toEqual(
        Buffer.from(bytes),
      );
      await expect(
        store.get(key, { expectedSha256: '0'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'integrity' });
      await expect(store.put(key, new Uint8Array([1]))).rejects.toMatchObject({
        code: 'conflict',
      });
      await expect(
        store.put(`${key}-large`, new Uint8Array(1025)),
      ).rejects.toMatchObject({ code: 'too_large' });
    } finally {
      await store.delete(key);
    }
    expect(await store.exists(key)).toBe(false);
  });
});
