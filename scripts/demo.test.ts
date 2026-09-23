import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const memberId = '11111111-2222-4333-8444-555555555555';
const roots: string[] = [];
const privateSettings = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'TRUST_PROXY',
  'ARTIFACT_MAX_BYTES',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_FORCE_PATH_STYLE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_SERVICE_NAME',
  'COMPOSE_ENV_FILES',
  'COMPOSE_PROFILES',
];
const demoSettings = [
  'POSTGRES_PASSWORD',
  'MIGRATION_PASSWORD',
  'APP_DATABASE_PASSWORD',
  'SESSION_SECRET',
  'PUBLIC_URL',
  'COOKIE_SECURE',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_ALLOW_INSECURE_HTTP',
  'STORAGE_DRIVER',
];
interface DockerCall {
  args: string[];
  env: Record<string, string>;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zazie-demo-launcher-'));
  roots.push(root);
  await Promise.all(
    ['scripts', 'deploy/compose', 'bin'].map((directory) =>
      mkdir(join(root, directory), { recursive: true }),
    ),
  );
  await copyFile(
    new URL('./demo.sh', import.meta.url),
    join(root, 'scripts/demo.sh'),
  );
  await copyFile(
    new URL('../deploy/compose/demo.env', import.meta.url),
    join(root, 'deploy/compose/demo.env'),
  );
  await writeFile(
    join(root, '.env'),
    'DATABASE_URL=production-dotenv-must-not-be-used\n',
  );
  const log = join(root, 'docker.jsonl');
  const settings = [
    ...privateSettings,
    ...demoSettings,
    'ZAZIE_PORT',
    'ZAZIE_IDENTITY_PORT',
  ];
  await writeFile(
    join(root, 'bin/docker'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const env = Object.fromEntries(${JSON.stringify(settings)}.map(key => [key, process.env[key]]));
fs.appendFileSync(process.env.ZAZIE_TEST_LOG, JSON.stringify({ args, env }) + '\\n');
if (args[0] === 'volume') process.exit(process.env.ZAZIE_TEST_VOLUME === 'exists' ? 0 : 1);
if (args.includes('ps') && args.includes('--quiet') && process.env.ZAZIE_TEST_IDENTITY_ENV)
  process.stdout.write('existing-demo-keycloak\\n');
if (args[0] === 'inspect' && args.at(-1) === 'existing-demo-keycloak')
  process.stdout.write(process.env.ZAZIE_TEST_IDENTITY_ENV + '\\n');
// Avoid real port probes; fresh-container availability is covered by acceptance tests.
if (args.includes('ps') && args.includes('--services')) process.stdout.write('api\\nkeycloak\\n');
if (args.includes('bootstrap')) {
  if (process.env.ZAZIE_TEST_BOOTSTRAP === 'fail') process.exit(7);
  process.stdout.write(process.env.ZAZIE_TEST_BOOTSTRAP === 'invalid' ? 'not-a-member-id\\n' : '${memberId}\\n');
}
`,
    { mode: 0o755 },
  );
  const poisoned = Object.fromEntries(
    settings.map((key) => [key, `production-sentinel-${key}`]),
  );
  return {
    root,
    run(args: string[] = [], extra: Record<string, string> = {}) {
      return new Promise<{ code: number; stdout: string; stderr: string }>(
        (resolve) => {
          execFile(
            'bash',
            ['scripts/demo.sh', ...args],
            {
              cwd: root,
              timeout: 10_000,
              env: {
                PATH: `${join(root, 'bin')}:${process.env.PATH}`,
                HOME: root,
                ...poisoned,
                ZAZIE_TEST_LOG: log,
                ...extra,
              },
            },
            (error, stdout, stderr) =>
              resolve({
                code: error
                  ? typeof error.code === 'number'
                    ? error.code
                    : -1
                  : 0,
                stdout,
                stderr,
              }),
          );
        },
      );
    },
    async calls(): Promise<DockerCall[]> {
      const contents = await readFile(log, 'utf8').catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        },
      );
      return contents
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as DockerCall);
    },
  };
}

const configuredCalls = (calls: DockerCall[]) =>
  calls.filter((call) => call.args.includes('--project-name'));

describe('local demo launcher', () => {
  it('isolates Compose from production connections, storage, telemetry and credentials', async () => {
    const demo = await fixture();
    const result = await demo.run();
    expect(result.code, result.stderr).toBe(0);
    const calls = configuredCalls(await demo.calls());
    expect(calls.some((call) => call.args.includes('seed'))).toBe(true);
    for (const call of calls) {
      expect(call.args).toEqual(
        expect.arrayContaining([
          '--project-name',
          'zazie-demo',
          '--env-file',
          'deploy/compose/demo.env',
          '--profile',
          'demo',
        ]),
      );
      for (const key of privateSettings)
        expect(call.env[key], key).toBeUndefined();
      for (const key of demoSettings)
        expect(call.env[key], key).not.toContain('production-sentinel');
      expect(call.env).toMatchObject({
        STORAGE_DRIVER: 'filesystem',
        SESSION_SECRET: 'local-demo-session-secret-not-for-production-00001',
        OIDC_CLIENT_SECRET: 'local-demo-client-secret',
        OIDC_ISSUER: 'http://keycloak.localhost:8080/realms/zazie-demo',
        PUBLIC_URL: 'http://localhost:3000',
      });
    }
  });

  it.each(['fail', 'invalid'])(
    'does not seed or start the app after bootstrap returns %s',
    async (mode) => {
      const demo = await fixture();
      const result = await demo.run([], { ZAZIE_TEST_BOOTSTRAP: mode });
      expect(result.code).not.toBe(0);
      const calls = configuredCalls(await demo.calls());
      expect(calls.some((call) => call.args.includes('bootstrap'))).toBe(true);
      expect(calls.some((call) => call.args.includes('seed'))).toBe(false);
      expect(
        calls.some(
          (call) => call.args.includes('up') && call.args.includes('api'),
        ),
      ).toBe(false);
      expect(result.stderr).toMatch(
        /provisioning the demo owner|seed was not run/,
      );
    },
  );

  it('remembers custom ports and seeds with the explicitly matched member on every run', async () => {
    const demo = await fixture();
    const first = await demo.run(['--port', '3107', '--identity-port', '8187']);
    expect(first.code, first.stderr).toBe(0);
    expect(await readFile(join(demo.root, '.data/demo-ports'), 'utf8')).toBe(
      '3107 8187\n',
    );
    const second = await demo.run([], { ZAZIE_TEST_VOLUME: 'exists' });
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain('http://localhost:3107');
    const calls = configuredCalls(await demo.calls());
    const bootstraps = calls.filter((call) => call.args.includes('bootstrap'));
    expect(bootstraps).toHaveLength(2);
    for (const call of bootstraps) {
      expect(call.args).toEqual(
        expect.arrayContaining([
          '--if-matching',
          '--id-only',
          '--issuer',
          'http://keycloak.localhost:8187/realms/zazie-demo',
        ]),
      );
      expect(call.env.ZAZIE_PORT).toBe('3107');
      expect(call.env.ZAZIE_IDENTITY_PORT).toBe('8187');
    }
    const seeds = calls.filter((call) => call.args.includes('seed'));
    expect(seeds).toHaveLength(2);
    for (const call of seeds)
      expect(call.args).toContain(`ZAZIE_SEED_MEMBER_ID=${memberId}`);
  });

  it('stops containers without building, seeding or removing data', async () => {
    const demo = await fixture();
    await mkdir(join(demo.root, '.data'));
    await writeFile(join(demo.root, '.data/demo-ports'), '3107 8187\n');
    const result = await demo.run(['stop']);
    expect(result.code, result.stderr).toBe(0);
    const calls = configuredCalls(await demo.calls());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.at(-1)).toBe('stop');
    expect(await readFile(join(demo.root, '.data/demo-ports'), 'utf8')).toBe(
      '3107 8187\n',
    );
  });

  it('refuses to change ports for an existing realm and preserves its saved configuration', async () => {
    const demo = await fixture();
    await mkdir(join(demo.root, '.data'));
    await writeFile(join(demo.root, '.data/demo-ports'), '3107 8187\n');
    const result = await demo.run(['--port', '3108'], {
      ZAZIE_TEST_VOLUME: 'exists',
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('previous ports');
    expect(configuredCalls(await demo.calls())).toEqual([]);
    expect(await readFile(join(demo.root, '.data/demo-ports'), 'utf8')).toBe(
      '3107 8187\n',
    );
  });

  it('adopts a manually started identity container when its custom public URLs match', async () => {
    const demo = await fixture();
    const result = await demo.run(
      ['--port', '3107', '--identity-port', '8187'],
      {
        ZAZIE_TEST_VOLUME: 'exists',
        ZAZIE_TEST_IDENTITY_ENV:
          'KC_HOSTNAME=http://keycloak.localhost:8187\nZAZIE_DEMO_PUBLIC_URL=http://localhost:3107',
      },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(await readFile(join(demo.root, '.data/demo-ports'), 'utf8')).toBe(
      '3107 8187\n',
    );
    expect(
      (await demo.calls()).some(
        (call) =>
          call.args[0] === 'inspect' &&
          call.args.at(-1) === 'existing-demo-keycloak',
      ),
    ).toBe(true);
    expect(
      configuredCalls(await demo.calls()).some((call) =>
        call.args.includes('seed'),
      ),
    ).toBe(true);
  });

  it('rejects mismatched existing identity or application URLs before changing anything', async () => {
    for (const mismatch of ['identity', 'application']) {
      const demo = await fixture();
      const saved = join(demo.root, '.data/demo-ports');
      if (mismatch === 'application') {
        await mkdir(join(demo.root, '.data'));
        await writeFile(saved, '3107 8187\n');
      }
      const result = await demo.run(
        ['--port', '3107', '--identity-port', '8187'],
        {
          ZAZIE_TEST_VOLUME: 'exists',
          ZAZIE_TEST_IDENTITY_ENV: `KC_HOSTNAME=http://keycloak.localhost:${mismatch === 'identity' ? '8188' : '8187'}\nZAZIE_DEMO_PUBLIC_URL=http://localhost:${mismatch === 'application' ? '3108' : '3107'}`,
        },
      );
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(
        'same ports as the existing demo identity container',
      );
      expect(
        configuredCalls(await demo.calls()).every((call) =>
          call.args.includes('ps'),
        ),
      ).toBe(true);
      if (mismatch === 'application')
        expect(await readFile(saved, 'utf8')).toBe('3107 8187\n');
      else
        await expect(readFile(saved)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each([
    ['--port', '0'],
    ['--port', '65536'],
    ['--port', 'not-a-port'],
    ['--port', '03000'],
    ['--identity-port'],
    ['--port', '8080'],
  ])('rejects invalid ports before calling Docker: %j', async (...args) => {
    const demo = await fixture();
    const result = await demo.run(args);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/port/i);
    expect(await demo.calls()).toEqual([]);
  });
});
