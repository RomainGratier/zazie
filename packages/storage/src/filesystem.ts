import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  errorCode,
  StorageError,
  validateMaxBytes,
  validateStorageKey,
  verifyBytes,
  type ArtifactStore,
  type IntegrityOptions,
} from './types.js';

export interface FilesystemStoreOptions {
  root: string;
  maxBytes?: number;
}

export function createFilesystemStore(
  options: FilesystemStoreOptions,
): ArtifactStore {
  const configuredRoot = resolve(options.root);
  const maxBytes = validateMaxBytes(
    options.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
  );

  async function pathFor(key: string, createParents = false): Promise<string> {
    validateStorageKey(key);
    await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
    const root = await realpath(configuredRoot);
    const parts = key.split('/');
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      if (createParents) {
        try {
          await mkdir(parent, { mode: 0o700 });
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error;
        }
      }
      const entry = await lstat(parent);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new StorageError(
          'invalid_key',
          'Artifact paths may not traverse symbolic links.',
        );
      }
    }
    return join(root, key);
  }

  async function get(
    key: string,
    integrity: IntegrityOptions = {},
  ): Promise<Uint8Array> {
    try {
      const path = await pathFor(key);
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile())
          throw new StorageError(
            'invalid_key',
            'Artifact is not a regular file.',
          );
        if (stat.size > maxBytes)
          throw new StorageError(
            'too_large',
            'Artifact exceeds the configured size limit.',
          );
        // A bounded read also handles a file growing between stat and read.
        const bytes = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
        let offset = 0;
        while (offset < bytes.byteLength) {
          const { bytesRead } = await file.read(
            bytes,
            offset,
            bytes.byteLength - offset,
            offset,
          );
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset !== stat.size)
          throw new StorageError(
            'integrity',
            'Artifact changed while being read.',
          );
        const result = bytes.subarray(0, offset);
        verifyBytes(result, maxBytes, integrity);
        return result;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        throw new StorageError('not_found', 'Artifact is unavailable.');
      if (errorCode(error) === 'ELOOP')
        throw new StorageError(
          'invalid_key',
          'Artifact may not be a symbolic link.',
        );
      throw error;
    }
  }

  return {
    async put(key, bytes, integrity = {}) {
      const digest = verifyBytes(bytes, maxBytes, integrity);
      const path = await pathFor(key, true);
      const temporary = join(dirname(path), `.upload-${randomUUID()}`);
      const file = await open(temporary, 'wx', 0o600);
      try {
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        try {
          // A hard link publishes a complete file without replacing an existing artifact.
          await link(temporary, path);
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error;
          const existing = await get(key);
          if (verifyBytes(existing, maxBytes) !== digest) {
            throw new StorageError(
              'conflict',
              'An artifact key cannot be replaced with different content.',
            );
          }
        }
      } finally {
        await unlink(temporary);
      }
      return { key, sha256: digest, size: bytes.byteLength };
    },
    get,
    async exists(key) {
      try {
        const path = await pathFor(key);
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new StorageError(
            'invalid_key',
            'Artifact is not a regular file.',
          );
        return true;
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return false;
        throw error;
      }
    },
    async delete(key) {
      try {
        await unlink(await pathFor(key));
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    },
  };
}
