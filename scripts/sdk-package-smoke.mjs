import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'zazie-sdk-package-'));
const tarballs = join(temporary, 'tarballs');
const consumer = join(temporary, 'consumer');
const packages = ['contracts', 'domain', 'sdk-typescript'];

/** Spawn argument arrays: package paths are data, never interpolated shell code. */
function run(command, args, cwd, env = process.env) {
  process.stdout.write(`Package smoke: ${command} ${args[0]}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`,
  );
}

function tarballName(manifest) {
  return `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
}

const smoke = String.raw`
import assert from 'node:assert/strict';
import { access, lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { ZazieClient } from '@zazie/sdk-typescript';
import { evaluateMeasurements } from '@zazie/domain';

for (const name of ['@zazie/contracts', '@zazie/domain', '@zazie/sdk-typescript']) {
  const resolved = fileURLToPath(import.meta.resolve(name));
  assert.ok(resolved.startsWith(resolve('node_modules') + sep), name + ' resolves inside this isolated consumer');
  assert.ok(resolved.endsWith(sep + 'dist' + sep + 'index.js'), name + ' resolves compiled JavaScript');
  assert.equal((await lstat(resolve('node_modules', name))).isSymbolicLink(), false, 'No workspace links');
  const manifest = JSON.parse(await readFile(resolve('node_modules', name, 'package.json'), 'utf8'));
  async function checkExportTargets(value) {
    if (typeof value === 'string' && value.startsWith('./')) {
      await access(resolve('node_modules', name, value));
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) await checkExportTargets(child);
    }
  }
  await checkExportTargets(manifest.exports);
}

let requests = 0;
const client = new ZazieClient({
  baseUrl: 'https://synthetic-package-test.invalid/api/v1',
  token: 'synthetic-test-token',
  maxAttempts: 1,
  fetch: async (input, init) => {
    requests += 1;
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer synthetic-test-token');
    if (init.method === 'POST') {
      assert.equal(url.pathname, '/api/v1/systems/sys-package-smoke/versions');
      assert.equal(headers.get('idempotency-key'), 'package-smoke-version');
      const submitted = JSON.parse(init.body);
      assert.deepEqual(submitted.components, { prompt: 'synthetic-v1' });
      return Response.json({
        id: 'version-package-smoke',
        organizationId: 'org-package-smoke',
        systemId: 'sys-package-smoke',
        revision: 1,
        createdAt: '2026-09-23T00:00:00.000Z',
        createdBy: 'integration-package-smoke',
        data: { ...submitted, manifestDigest: '0'.repeat(64) },
      });
    }
    assert.equal(url.pathname, '/api/v1/systems/sys-package-smoke/releases/check');
    assert.equal(url.searchParams.get('purpose'), 'deploy');
    assert.equal(url.searchParams.get('versionId'), 'version-package-smoke');
    assert.equal(url.searchParams.get('deploymentId'), 'deployment-package-smoke');
    return Response.json({
      purpose: 'deploy', satisfied: true, readyForReview: true,
      approvedForDeployment: true, status: 'approved', blockers: [], controls: [],
      scope: 'Synthetic packaging check only',
    });
  },
});

assert.throws(() => client.submitVersion('sys-package-smoke', {
  label: '', components: {}, changeSummary: '',
}));
assert.equal(requests, 0, 'Installed Zod validates inputs before transport');
const version = await client.submitVersion('sys-package-smoke', {
  label: '1.0', components: { prompt: 'synthetic-v1' }, changeSummary: 'Synthetic package fixture',
}, 'package-smoke-version');
assert.equal(version.id, 'version-package-smoke');
const gate = await client.checkRelease('sys-package-smoke', version.id, 'deployment-package-smoke');
assert.equal(gate.approvedForDeployment, true);
assert.equal(requests, 2);
assert.equal(evaluateMeasurements([{ metric: 'accuracy', operator: 'gte', threshold: 0.95 }], { accuracy: 0.96 })[0].passed, true);
`;

try {
  await mkdir(tarballs);
  await mkdir(consumer);
  const archivePaths = [];
  for (const name of packages) {
    const folder = join(repository, 'packages', name);
    const manifest = JSON.parse(
      await readFile(join(folder, 'package.json'), 'utf8'),
    );
    run('pnpm', ['--filter', manifest.name, 'build'], repository);
    run('pnpm', ['pack', '--pack-destination', tarballs], folder, {
      ...process.env,
      npm_config_ignore_scripts: 'true',
    });
    archivePaths.push(join(tarballs, tarballName(manifest)));
  }

  const contractsRequire = createRequire(
    join(repository, 'packages', 'contracts', 'package.json'),
  );
  const zod = dirname(
    await realpath(contractsRequire.resolve('zod/package.json')),
  );
  const zodManifest = JSON.parse(
    await readFile(join(zod, 'package.json'), 'utf8'),
  );
  const offlineEnvironment = {
    ...process.env,
    NODE_OPTIONS: '',
    NODE_PATH: '',
    npm_config_cache: join(temporary, 'empty-npm-cache'),
    npm_config_registry: 'http://127.0.0.1:9',
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
  run(
    'pnpm',
    ['pack', '--pack-destination', tarballs],
    zod,
    offlineEnvironment,
  );
  archivePaths.push(join(tarballs, tarballName(zodManifest)));

  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'zazie-isolated-sdk-consumer',
      version: '1.0.0',
      private: true,
      type: 'module',
    }),
  );
  run(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      ...archivePaths,
    ],
    consumer,
    offlineEnvironment,
  );
  await writeFile(join(consumer, 'smoke.mjs'), smoke);
  run(process.execPath, ['smoke.mjs'], consumer, offlineEnvironment);
  process.stdout.write(
    'SDK package smoke passed: tarballs install offline and compiled SDK requests work outside the workspace.\n',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
