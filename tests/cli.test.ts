import { describe, expect, it } from 'vitest';
import type { EvaluationInput, EvaluationReport } from '../src/contracts.js';
import { alwaysAbstain } from '../src/benchmark.js';
import { MAX_INPUT_BYTES, runCli, type CliOptions } from '../src/cli.js';

const input: EvaluationInput = {
  intention: 'Summarize the supplied record.',
  data: 'A fictional record.',
};
const json = JSON.stringify(input);

async function* stream(chunks: readonly (string | Uint8Array)[]) {
  yield* chunks;
}

async function run(
  args: string[],
  chunks: (string | Uint8Array)[] = [],
  options: CliOptions = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: EvaluationInput[] = [];
  const code = await runCli(args, {
    stdin: stream(chunks),
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    evaluator: async (value) => {
      calls.push(value);
      return alwaysAbstain(value);
    },
    ...options,
  });
  return { code, stdout: stdout.join(''), stderr: stderr.join(''), calls };
}

describe('CLI', () => {
  it('evaluates JSON from stdin without requiring a provider in offline tests', async () => {
    const result = await run(
      ['evaluate', '-'],
      [json.slice(0, 5), json.slice(5)],
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.calls).toEqual([input]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      evaluator: { model: 'always-abstain-v1' },
    });
  });

  it('opens the requested file and keeps paths out of read errors', async () => {
    let opened: string | undefined;
    const success = await run(['evaluate', 'example.json'], [], {
      openFile: (path) => {
        opened = path;
        return stream([json]);
      },
    });
    expect(opened).toBe('example.json');
    expect(success.code).toBe(0);
    const failure = await run(['evaluate', '/private/secret.json'], [], {
      openFile: () => {
        throw new Error('/private/secret.json includes api-key-secret');
      },
    });
    expect(failure.code).toBe(1);
    expect(failure.stderr).toBe('Unable to read input or write output.\n');
    expect(failure.stdout).toBe('');
  });

  it('continues after invalid JSON and schema errors with accurate physical line numbers', async () => {
    const result = await run(
      ['batch', '-'],
      [
        `\n${json}\r\n{secret-invalid}\n`,
        '{"intention":"missing data"}\n',
        `  \n${json}`,
      ],
    );
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([input, input]);
    expect(result.stderr).toBe('');
    const rows: unknown[] = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      line: 2,
      report: { schemaVersion: '1.0.0' },
    });
    expect(rows[1]).toMatchObject({
      line: 3,
      error: { code: 'invalid_input' },
    });
    expect(rows[2]).toMatchObject({
      line: 4,
      error: { code: 'invalid_input' },
    });
    expect(rows[3]).toMatchObject({
      line: 6,
      report: { schemaVersion: '1.0.0' },
    });
    expect(result.stdout).not.toContain('secret-invalid');
  });

  it('discards oversized input lines across chunks and resumes at the next line', async () => {
    const result = await run(
      ['batch', '-'],
      ['x'.repeat(MAX_INPUT_BYTES), 'x'.repeat(MAX_INPUT_BYTES), `\n${json}\n`],
    );
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([input]);
    const rows: unknown[] = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(rows[0]).toEqual({
      line: 1,
      error: {
        code: 'input_too_large',
        message: 'Input exceeds the 24000-byte transport limit.',
      },
    });
    expect(rows[1]).toMatchObject({
      line: 2,
      report: { schemaVersion: '1.0.0' },
    });
  });

  it('rejects oversized unterminated lines and single inputs before evaluation', async () => {
    for (const command of ['evaluate', 'batch']) {
      const result = await run(
        [command, '-'],
        ['x'.repeat(MAX_INPUT_BYTES + 1)],
      );
      expect(result.code).toBe(1);
      expect(result.calls).toHaveLength(0);
      expect(result.stdout + result.stderr).toContain('24000');
    }
  });

  it('preserves multibyte Unicode across chunk boundaries and rejects malformed UTF-8', async () => {
    const unicode = Buffer.from(
      JSON.stringify({ ...input, data: 'Électricité' }),
    );
    const index = unicode.indexOf(Buffer.from('É')) + 1;
    const valid = await run(
      ['evaluate', '-'],
      [unicode.subarray(0, index), unicode.subarray(index)],
    );
    expect(valid.code).toBe(0);
    expect(valid.calls[0]?.data).toBe('Électricité');
    const malformed = Buffer.concat([
      Buffer.from('{"intention":"Task","data":"'),
      Buffer.from([0xc3]),
      Buffer.from('"}'),
    ]);
    const rejected = await run(['evaluate', '-'], [malformed]);
    expect(rejected.code).toBe(1);
    expect(rejected.calls).toHaveLength(0);
  });

  it('does not leak thrown evaluator messages and continues a batch', async () => {
    let call = 0;
    const result = await run(['batch', '-'], [`${json}\n${json}\n`], {
      evaluator: async (value) => {
        if (call++ === 0)
          throw new Error('secret-provider-key and private input');
        return alwaysAbstain(value);
      },
    });
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('secret');
    expect(result.stdout).not.toContain('private input');
    expect(result.stdout).toContain('evaluation_failed');
    expect(call).toBe(2);
    const single = await run(['evaluate', '-'], [json], {
      evaluator: async () => {
        throw new Error('secret');
      },
    });
    expect(single.stderr).toBe('Evaluation failed.\n');
    expect(single.stdout).toBe('');
  });

  it('returns nonzero for provider error findings without hiding the typed report', async () => {
    const report: EvaluationReport = {
      ...(await alwaysAbstain(input)),
      findings: [
        {
          hypothesisId: 'source-contradiction',
          status: 'error',
          applicability: 'unresolved',
          evidence: 'unresolved',
          raw: null,
          summary: 'Evaluation failed.',
          error: { code: 'provider_failure', message: 'Evaluation failed.' },
        },
      ],
    };
    for (const command of ['evaluate', 'batch']) {
      const result = await run([command, '-'], [json], {
        evaluator: async () => report,
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('provider_failure');
      expect(result.stdout).not.toContain('no_signal_detected');
    }
  });

  it('awaits each output write before evaluating the next record', async () => {
    const events: string[] = [];
    const result = await run(['batch', '-'], [`${json}\n${json}\n`], {
      evaluator: async (value) => {
        events.push('evaluate');
        return alwaysAbstain(value);
      },
      stdout: async () => {
        await Promise.resolve();
        events.push('written');
      },
    });
    expect(result.code).toBe(0);
    expect(events).toEqual(['evaluate', 'written', 'evaluate', 'written']);
  });

  it('skips blank batches and distinguishes help from invalid arguments', async () => {
    expect((await run(['batch', '-'], ['\n \n\r\n'])).code).toBe(0);
    const help = await run(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('TYPESAFE_API_KEY');
    for (const args of [
      [],
      ['evaluate'],
      ['unknown', '-'],
      ['batch', '-', '--extra'],
    ]) {
      const invalid = await run(args);
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain('Usage:');
    }
  });
});
