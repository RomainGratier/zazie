import { createHash } from 'node:crypto';

export type StorageErrorCode =
  'invalid_key' | 'too_large' | 'not_found' | 'integrity' | 'conflict';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface ArtifactReceipt {
  key: string;
  sha256: string;
  size: number;
}

export interface IntegrityOptions {
  expectedSha256?: string;
}

/** Authorization and retention decisions belong to the caller, never to a storage key. */
export interface ArtifactStore {
  /** Create immutable content; an identical retry is accepted, a replacement is rejected. */
  put(
    key: string,
    bytes: Uint8Array,
    options?: IntegrityOptions,
  ): Promise<ArtifactReceipt>;
  get(key: string, options?: IntegrityOptions): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  /** Internal cleanup only. Do not expose this method as an unrestricted artifact endpoint. */
  delete(key: string): Promise<void>;
}

export const DEFAULT_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export function validateStorageKey(key: string): string {
  if (
    key.length === 0 ||
    key.length > 512 ||
    key
      .split('/')
      .some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part))
  ) {
    throw new StorageError(
      'invalid_key',
      'Artifact keys must contain safe, relative path segments.',
    );
  }
  return key;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateMaxBytes(maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError('maxBytes must be a positive integer.');
  return maxBytes;
}

export function verifyBytes(
  bytes: Uint8Array,
  maxBytes: number,
  options: IntegrityOptions = {},
): string {
  if (bytes.byteLength > maxBytes)
    throw new StorageError(
      'too_large',
      'Artifact exceeds the configured size limit.',
    );
  const digest = sha256(bytes);
  if (
    options.expectedSha256 !== undefined &&
    options.expectedSha256 !== digest
  ) {
    throw new StorageError(
      'integrity',
      'Artifact content does not match its recorded SHA-256.',
    );
  }
  return digest;
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
