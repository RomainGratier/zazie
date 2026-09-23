import { spawnSync } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const generated = resolve(fixture, 'dist');
const image =
  process.env.ZAZIE_EDGE_RUNTIME_IMAGE ??
  'public.ecr.aws/supabase/edge-runtime:v1.73.13';
const require = createRequire(import.meta.url);
// tsx is a pinned development dependency whose bundler is already installed in the workspace.
const { build } = require(
  createRequire(require.resolve('tsx')).resolve('esbuild'),
);
await access(resolve(root, 'packages/sdk-typescript/dist/index.js'));
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [resolve(root, 'packages/sdk-typescript/dist/index.js')],
  outfile: resolve(generated, 'sdk.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
});

function docker(...args) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0)
    throw new Error(
      result.stderr ||
        result.error?.message ||
        `Docker exited ${result.status}`,
    );
  return result.stdout.trim();
}

const name = `zazie-sdk-edge-smoke-${process.pid}`;
let started = false;
try {
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--memory',
    '512m',
    '--cpus',
    '1',
    '--pids-limit',
    '128',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '-p',
    '127.0.0.1::9000',
    '--mount',
    `type=bind,source=${fixture},target=/fixture,readonly`,
    '-e',
    'DENO_DIR=/tmp/deno-cache',
    image,
    'start',
    '--main-service',
    '/fixture/main',
  );
  started = true;
  const address = docker('port', name, '9000/tcp').split('\n')[0];
  const url = `http://${address}/sdk-smoke`;
  let result;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          `Edge runtime returned HTTP ${response.status}: ${await response.text()}`,
        );
      result = await response.json();
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (
    !result?.passed ||
    result.runtime !== 'supabase-edge-user-worker' ||
    result.eventAttempts !== 2
  )
    throw new Error('Unexpected Edge runtime test response');
  process.stdout.write(`${JSON.stringify({ image, ...result }, null, 2)}\n`);
} catch (error) {
  if (started) process.stderr.write(`${docker('logs', name)}\n`);
  throw error;
} finally {
  if (started) docker('stop', '--time', '2', name);
}
