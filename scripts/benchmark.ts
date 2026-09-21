import { readFile, writeFile } from 'node:fs/promises';
import {
  alwaysAbstain,
  parseBenchmarkCases,
  runBenchmark,
} from '../src/benchmark.js';
import { evaluate } from '../src/index.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let live = false;
  let reportPath: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--live' && !live) live = true;
    else if (
      argument === '--report' &&
      reportPath === undefined &&
      args[i + 1] &&
      !args[i + 1]?.startsWith('--')
    ) {
      reportPath = args[i + 1];
      i += 1;
    } else {
      process.stderr.write(
        'Usage: npm run benchmark -- [--live] [--report path.json]\n',
      );
      return 2;
    }
  }
  if (live && !process.env['TYPESAFE_API_KEY']?.trim()) {
    process.stderr.write(
      'Live benchmark requires TYPESAFE_API_KEY in the environment.\n',
    );
    return 1;
  }
  const value: unknown = JSON.parse(
    await readFile(
      new URL('../benchmarks/cases.json', import.meta.url),
      'utf8',
    ),
  );
  const cases = parseBenchmarkCases(value);
  const report = await runBenchmark(cases, {
    name: live ? 'jev-synthetic-draft' : 'always-abstain-synthetic-draft',
    corpusDescription:
      'Author-created synthetic draft references; not independently reviewed or a held-out accuracy benchmark.',
    evaluator: live ? evaluate : alwaysAbstain,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath !== undefined)
    await writeFile(reportPath, json, { flag: 'wx' });
  else process.stdout.write(json);
  return report.execution.failedCases > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write(
      'Benchmark failed: check the corpus and the output path (existing reports are not overwritten).\n',
    );
    process.exitCode = 1;
  },
);
