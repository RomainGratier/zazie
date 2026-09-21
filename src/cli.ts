#!/usr/bin/env node
import { createReadStream, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { EvaluationInput, EvaluationReport } from './contracts.js';
import { evaluate, parseInput } from './index.js';
import { MAX_INPUT_BYTES } from './input.js';

/** A transport bound; the library applies its own semantic input limits as well. */
export { MAX_INPUT_BYTES };

const help = `Usage: zazie evaluate <file.json|->
       zazie batch <file.jsonl|->
       zazie --help

Supply exactly {"intention": "...", "data": ...}. Use - for standard input.
Live evaluation uses TYPESAFE_API_KEY and the pinned Jev model.
Batch emits one {line, report} or {line, error} JSON record per nonblank line.
Each input or batch line is limited to 24000 UTF-8 bytes. Blank lines are skipped.
Exit codes: 0 completed, 1 input/provider/I/O errors, 2 invalid usage.
Findings are draft research signals, not a compliance decision.
`;

type InputStream = AsyncIterable<Uint8Array | string>;
type Output = (text: string) => void | Promise<void>;

export interface CliOptions {
  readonly stdin?: InputStream;
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly openFile?: (path: string) => InputStream;
  readonly evaluator?: (input: EvaluationInput) => Promise<EvaluationReport>;
}

interface Line {
  readonly number: number;
  readonly bytes: Buffer | null;
}

/** Discard oversized lines until their newline without retaining their contents. */
async function* readLines(source: InputStream): AsyncGenerator<Line> {
  let parts: Buffer[] = [];
  let size = 0;
  let oversized = false;
  let number = 1;
  for await (const chunk of source) {
    const bytes =
      typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    let start = 0;
    while (start < bytes.length) {
      const newline = bytes.indexOf(10, start);
      const end = newline === -1 ? bytes.length : newline;
      const part = bytes.subarray(start, end);
      size += part.length;
      if (size > MAX_INPUT_BYTES) {
        oversized = true;
        parts = [];
      } else if (!oversized) {
        parts.push(part);
      }
      if (newline !== -1) {
        yield { number, bytes: oversized ? null : Buffer.concat(parts, size) };
        number += 1;
        parts = [];
        size = 0;
        oversized = false;
      }
      start = end + 1;
    }
  }
  if (size > 0 || oversized) {
    yield { number, bytes: oversized ? null : Buffer.concat(parts, size) };
  }
}

async function readSingle(source: InputStream): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

function parseBytes(bytes: Buffer): EvaluationInput {
  // Reject invalid UTF-8 rather than silently changing submitted evidence.
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return parseInput(JSON.parse(decoded) as unknown);
}

function writeTo(stream: NodeJS.WriteStream, text: string): Promise<void> {
  // Waiting for each write bounds memory when the output is a slow pipe.
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

const inputError = {
  code: 'invalid_input',
  message:
    'Expected valid UTF-8 JSON with exactly intention and data within the input limits.',
};
const sizeError = {
  code: 'input_too_large',
  message: 'Input exceeds the 24000-byte transport limit.',
};
const evaluationError = {
  code: 'evaluation_failed',
  message: 'Evaluation failed.',
};

/** Run without terminating the host process; injectable streams keep CLI behavior testable. */
export async function runCli(
  args: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  const stdout =
    options.stdout ?? ((text: string) => writeTo(process.stdout, text));
  const stderr =
    options.stderr ?? ((text: string) => writeTo(process.stderr, text));
  const evaluator = options.evaluator ?? evaluate;
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    await stdout(help);
    return 0;
  }
  const [command, path] = args;
  if (
    args.length !== 2 ||
    (command !== 'evaluate' && command !== 'batch') ||
    !path
  ) {
    await stderr(help);
    return 2;
  }

  let failed = false;
  try {
    const source =
      path === '-'
        ? (options.stdin ?? process.stdin)
        : (options.openFile ?? createReadStream)(path);
    if (command === 'evaluate') {
      const bytes = await readSingle(source);
      if (bytes === null) {
        await stderr(`${sizeError.message}\n`);
        return 1;
      }
      let input: EvaluationInput;
      try {
        input = parseBytes(bytes);
      } catch {
        await stderr(`${inputError.message}\n`);
        return 1;
      }
      let report: EvaluationReport;
      try {
        report = await evaluator(input);
      } catch {
        await stderr(`${evaluationError.message}\n`);
        return 1;
      }
      await stdout(`${JSON.stringify(report)}\n`);
      return report.findings.some((finding) => finding.status === 'error')
        ? 1
        : 0;
    }

    for await (const line of readLines(source)) {
      if (line.bytes?.toString('utf8').trim() === '') continue;
      if (line.bytes === null) {
        await stdout(
          `${JSON.stringify({ line: line.number, error: sizeError })}\n`,
        );
        failed = true;
        continue;
      }
      let input: EvaluationInput;
      try {
        input = parseBytes(line.bytes);
      } catch {
        await stdout(
          `${JSON.stringify({ line: line.number, error: inputError })}\n`,
        );
        failed = true;
        continue;
      }
      let report: EvaluationReport;
      try {
        report = await evaluator(input);
      } catch {
        await stdout(
          `${JSON.stringify({ line: line.number, error: evaluationError })}\n`,
        );
        failed = true;
        continue;
      }
      failed ||= report.findings.some((finding) => finding.status === 'error');
      await stdout(`${JSON.stringify({ line: line.number, report })}\n`);
    }
    return failed ? 1 : 0;
  } catch {
    // Never include filesystem paths, input content, or arbitrary thrown messages.
    await stderr('Unable to read input or write output.\n');
    return 1;
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // npm invokes package executables through symlinks in node_modules/.bin.
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
