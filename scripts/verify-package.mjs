import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'zazie-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', ...options });

try {
  const [archive] = JSON.parse(
    run(npm, [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporary,
    ]),
  );
  assert(archive);
  const packagedPaths = archive.files.map((file) => file.path);
  assert(
    !packagedPaths.some(
      (path) => path.includes('.env') || path.startsWith('reports/'),
    ),
  );
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'zazie-consumer-check',
      private: true,
      type: 'module',
    }),
  );
  // npm ci caches tarballs, but a clean consumer may still need registry metadata.
  // Prefer cached artifacts while exercising a real install of the pinned package.
  run(
    npm,
    [
      'install',
      '--prefer-offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(temporary, archive.filename),
    ],
    { cwd: consumer },
  );
  await writeFile(
    join(consumer, 'smoke.mjs'),
    `
import assert from 'node:assert/strict';
import { evaluate, hypothesisPack, EvaluationReportSchema } from '@romaingratier/zazie';
import { alwaysAbstain } from '@romaingratier/zazie/benchmark';
import inputSchema from '@romaingratier/zazie/schemas/evaluation-input.v1.json' with { type: 'json' };
const input = { intention: 'Inspect supplied material.', data: null };
const report = EvaluationReportSchema.parse(await evaluate(input));
assert.equal(report.findings.length, 12);
assert(report.findings.every(finding => finding.status === 'insufficient_evidence'));
assert.equal(hypothesisPack.version, report.pack.version);
assert.equal((await alwaysAbstain(input)).findings.length, 12);
assert.deepEqual(inputSchema.required, ['intention', 'data']);
`,
  );
  run(process.execPath, ['smoke.mjs'], { cwd: consumer });
  const executable = join(
    consumer,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'zazie.cmd' : 'zazie',
  );
  assert.match(run(executable, ['--help']), /Usage: zazie evaluate/);
  const result = JSON.parse(
    run(executable, ['evaluate', '-'], {
      input: JSON.stringify({ intention: 'Inspect material.', data: null }),
    }),
  );
  assert.equal(result.findings.length, 12);
  assert(
    result.findings.every(
      (finding) => finding.status === 'insufficient_evidence',
    ),
  );
  console.log(
    'Packaged ESM exports, JSON Schema, benchmark import, npm executable, and offline evaluation passed.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
