import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  StorageError,
  validateMaxBytes,
  validateStorageKey,
  verifyBytes,
  type ArtifactStore,
  type IntegrityOptions,
} from './types.js';

export interface S3StoreOptions extends Pick<
  S3ClientConfig,
  'region' | 'endpoint' | 'forcePathStyle' | 'credentials'
> {
  bucket: string;
  maxBytes?: number;
}

function status(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error))
    return undefined;
  const metadata = error.$metadata;
  return typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    typeof metadata.httpStatusCode === 'number'
    ? metadata.httpStatusCode
    : undefined;
}

export function createS3Store(options: S3StoreOptions): ArtifactStore {
  if (!options.bucket) throw new TypeError('An S3 bucket is required.');
  const { bucket, maxBytes: configuredMaxBytes, ...clientOptions } = options;
  const maxBytes = validateMaxBytes(
    configuredMaxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
  );
  const client = new S3Client(clientOptions);

  async function get(
    key: string,
    integrity: IntegrityOptions = {},
  ): Promise<Uint8Array> {
    validateStorageKey(key);
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!response.Body)
        throw new StorageError('not_found', 'Artifact is unavailable.');
      if (
        response.ContentLength !== undefined &&
        response.ContentLength > maxBytes
      ) {
        // Destroy a Node response stream without buffering an oversized body.
        if (
          'destroy' in response.Body &&
          typeof response.Body.destroy === 'function'
        )
          response.Body.destroy();
        throw new StorageError(
          'too_large',
          'Artifact exceeds the configured size limit.',
        );
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes)
          throw new StorageError(
            'too_large',
            'Artifact exceeds the configured size limit.',
          );
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, size);
      verifyBytes(bytes, maxBytes, integrity);
      return bytes;
    } catch (error) {
      if (status(error) === 404)
        throw new StorageError('not_found', 'Artifact is unavailable.');
      throw error;
    }
  }

  return {
    async put(key, bytes, integrity = {}) {
      validateStorageKey(key);
      const digest = verifyBytes(bytes, maxBytes, integrity);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentLength: bytes.byteLength,
            ContentType: 'application/octet-stream',
            Metadata: { sha256: digest },
            IfNoneMatch: '*',
          }),
        );
      } catch (error) {
        if (status(error) !== 412 && status(error) !== 409) throw error;
        if (verifyBytes(await get(key), maxBytes) !== digest) {
          throw new StorageError(
            'conflict',
            'An artifact key cannot be replaced with different content.',
          );
        }
      }
      return { key, sha256: digest, size: bytes.byteLength };
    },
    get,
    async exists(key) {
      validateStorageKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (status(error) === 404) return false;
        throw error;
      }
    },
    async delete(key) {
      validateStorageKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
