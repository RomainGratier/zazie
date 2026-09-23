import { describe, expect, it, vi } from 'vitest';
import { ZazieClient } from '@zazie/sdk-typescript';
import { runCli } from '../src/index.js';

const args = [
  'releases',
  'check',
  '--system',
  'system-1',
  '--version',
  'version-1',
  '--deployment',
  'deployment-1',
  '--json',
];
const client = (body: unknown) =>
  new ZazieClient({
    baseUrl: 'https://zazie.example.test/api/v1',
    maxAttempts: 1,
    fetch: async () => new Response(JSON.stringify(body), { status: 200 }),
  });

describe('release CLI gate', () => {
  it('checks actual readiness and API compatibility without inventing a missing version', async () => {
    expect(
      await runCli(['doctor', '--json'], {
        client: client({ status: 'ready', apiVersion: '1.0' }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(0);
    expect(
      await runCli(['doctor', '--json'], {
        client: client({ status: 'ready' }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(2);
    expect(
      await runCli(['doctor', '--json'], {
        client: client({ status: 'degraded', apiVersion: '1.0' }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(2);
  });
  it('returns 1 for ready but unapproved deployment, and defaults to deploy', async () => {
    const api = client({
      purpose: 'deploy',
      satisfied: false,
      approvedForDeployment: false,
      readyForReview: true,
    });
    const request = vi.spyOn(api, 'checkRelease');
    expect(
      await runCli(args, { client: api, stdout: vi.fn(), stderr: vi.fn() }),
    ).toBe(1);
    expect(request).toHaveBeenCalledWith(
      'system-1',
      'version-1',
      'deployment-1',
      'deploy',
    );
  });
  it('returns 0 only when the requested gate is satisfied', async () => {
    expect(
      await runCli(args, {
        client: client({
          purpose: 'deploy',
          satisfied: true,
          approvedForDeployment: true,
          readyForReview: true,
        }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(0);
    expect(
      await runCli([...args, '--purpose', 'review'], {
        client: client({
          purpose: 'review',
          satisfied: true,
          approvedForDeployment: false,
          readyForReview: true,
        }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(0);
  });
  it('returns 2 for an unreachable or malformed response rather than success', async () => {
    const failing = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      maxAttempts: 1,
      fetch: async () => {
        throw new Error('unreachable');
      },
    });
    expect(
      await runCli(args, { client: failing, stdout: vi.fn(), stderr: vi.fn() }),
    ).toBe(2);
    expect(
      await runCli(args, {
        client: client({}),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(2);
    expect(
      await runCli(args, {
        client: client({
          purpose: 'deploy',
          satisfied: true,
          readyForReview: true,
          approvedForDeployment: false,
        }),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(2);
  });
  it('redacts the integration token from propagated diagnostics', async () => {
    const api = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      maxAttempts: 1,
      fetch: async () => {
        throw new Error('bad token secret-token');
      },
    });
    const stderr = vi.fn();
    await runCli(args, {
      client: api,
      environment: { ZAZIE_API_TOKEN: 'secret-token' },
      stdout: vi.fn(),
      stderr,
    });
    expect(stderr.mock.calls.flat().join('')).not.toContain('secret-token');
    expect(stderr.mock.calls.flat().join('')).toContain('[redacted]');
  });
});
