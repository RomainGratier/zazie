import { z } from 'zod';
import { createFilesystemStore, createS3Store } from '@zazie/storage';

const boolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_SECRET: z.string().min(32),
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_ALLOW_INSECURE_HTTP: boolean.default(false),
  COOKIE_SECURE: boolean.default(true),
  STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  ARTIFACT_ROOT: z.string().default('./.data/artifacts'),
  ARTIFACT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: boolean.default(false),
  TRUST_PROXY: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = ConfigSchema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')),
  );
  if (
    !config.COOKIE_SECURE &&
    !['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(config.PUBLIC_URL).hostname,
    )
  )
    throw new Error('Insecure cookies are only supported on localhost');
  if (
    config.OIDC_ALLOW_INSECURE_HTTP &&
    !['localhost', '127.0.0.1', 'keycloak.localhost', 'keycloak'].includes(
      new URL(config.OIDC_ISSUER).hostname,
    )
  )
    throw new Error('Insecure OIDC is restricted to local development hosts');
  return config;
}
export function storageFromConfig(
  config: Pick<
    Config,
    | 'STORAGE_DRIVER'
    | 'ARTIFACT_ROOT'
    | 'ARTIFACT_MAX_BYTES'
    | 'S3_BUCKET'
    | 'S3_REGION'
    | 'S3_ENDPOINT'
    | 'S3_FORCE_PATH_STYLE'
  >,
) {
  if (config.STORAGE_DRIVER === 'filesystem')
    return createFilesystemStore({
      root: config.ARTIFACT_ROOT,
      maxBytes: config.ARTIFACT_MAX_BYTES,
    });
  if (!config.S3_BUCKET) throw new Error('S3_BUCKET is required');
  return createS3Store({
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    maxBytes: config.ARTIFACT_MAX_BYTES,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
  });
}
