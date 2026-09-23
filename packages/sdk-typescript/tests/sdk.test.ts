import { describe, expect, it, vi } from 'vitest';
import { EventBuffer, ZazieApiError, ZazieClient } from '../src/index.js';

const event = {
  schemaVersion: '1.0' as const,
  eventId: 'event-1',
  source: 'synthetic-exam',
  type: 'oversight.flag_reviewed',
  versionId: 'version-a',
  occurredAt: '2026-09-23T10:00:00Z',
  payload: { falsePositive: true },
};
const ok = (body: unknown = { items: [] }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('generated Fetch transport', () => {
  it('handles empty logout and credential or membership revocation responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
    });
    for (const operation of [
      'logout',
      'revokeToken',
      'revokeMembership',
    ] as const) {
      await expect(
        client.request(operation, { path: { resourceId: 'synthetic-id' } }),
      ).resolves.toBeUndefined();
    }
    expect(
      fetcher.mock.calls.map(([_url, request]) => request?.method),
    ).toEqual(['DELETE', 'DELETE', 'DELETE']);
  });
  it('uses the same idempotency key and payload for bounded transient retries', async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, request) => {
        requests.push(request!);
        return requests.length < 3
          ? new Response(
              JSON.stringify({
                message: 'Try again',
                code: 'temporary_unavailable',
              }),
              { status: 503 },
            )
          : ok();
      });
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      token: 'secret-token',
      fetch: fetcher,
      sleep: async () => {},
    });
    await client.submitEvents('system-a', [event]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const keys = requests.map((request) =>
      new Headers(request.headers).get('Idempotency-Key'),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(requests.map((request) => request.body)).size).toBe(1);
    expect(new Headers(requests[0]!.headers).get('Authorization')).toBe(
      'Bearer secret-token',
    );
  });

  it('does not retry authorization failures and exposes structured errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'System access denied',
          code: 'forbidden',
          requestId: 'request-1',
        }),
        { status: 403 },
      ),
    );
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
    });
    await expect(
      client.submitEvents('system-a', [event]),
    ).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      requestId: 'request-1',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after the configured maximum and handles request timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_url, request) =>
        new Promise((_resolve, reject) => {
          request!.signal!.addEventListener(
            'abort',
            () => reject(new Error('timeout')),
            { once: true },
          );
        }),
    );
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
      maxAttempts: 2,
      timeoutMs: 5,
      sleep: async () => {},
    });
    await expect(client.submitEvents('system-a', [event])).rejects.toThrow(
      'timeout',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('defaults release checks to deployment and encodes all caller-supplied path/query values', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok({ satisfied: false }));
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1/',
      fetch: fetcher,
    });
    await client.checkRelease('system/with slash', 'version-a', 'deployment-a');
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain('/systems/system%2Fwith%20slash/releases/check');
    expect(new URL(url).searchParams.get('purpose')).toBe('deploy');
  });

  it('uploads binary evidence without Node Buffer dependencies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok({ id: 'artifact-1' }));
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
    });
    await client.uploadArtifact(
      'system-a',
      {
        filename: 'report.bin',
        contentType: 'application/octet-stream',
        provenance: 'Synthetic fixture',
      },
      new Uint8Array([0, 1, 255]),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      contentBase64: string;
    };
    expect(body.contentBase64).toBe('AAH/');
  });

  it('rejects a caller cancellation without a second request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        options!.signal!.throwIfAborted();
        return ok();
      });
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
    });
    await expect(
      client.request('listSystems', { signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new ZazieApiError('failure', 500, 'internal_error').name).toBe(
      'ZazieApiError',
    );
  });
});

describe('bounded asynchronous event buffering', () => {
  it('delivers batches on explicit flush without losing their order', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => ok());
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
    });
    const buffer = client.bufferEvents('system-a', {
      maxBufferedEvents: 3,
      batchSize: 2,
      flushIntervalMs: 0,
      onDeliveryFailure: vi.fn(),
    });
    for (let i = 1; i <= 3; i++)
      buffer.enqueue({ ...event, eventId: `event-${i}` });
    expect(fetcher).not.toHaveBeenCalled();
    await buffer.flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(buffer.pendingCount).toBe(0);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      events: [{ eventId: 'event-1' }, { eventId: 'event-2' }],
    });
  });

  it('reports full buffers instead of silently dropping an accepted event', () => {
    const failure = vi.fn();
    const buffer = new EventBuffer(
      new ZazieClient({ baseUrl: 'https://zazie.example.test/api/v1' }),
      'system-a',
      {
        maxBufferedEvents: 1,
        batchSize: 1,
        flushIntervalMs: 0,
        onDeliveryFailure: failure,
      },
    );
    buffer.enqueue(event);
    expect(() => buffer.enqueue({ ...event, eventId: 'event-2' })).toThrow(
      'full',
    );
    expect(failure).toHaveBeenCalledTimes(1);
    expect(buffer.pendingCount).toBe(1);
  });

  it('retains failed batches and surfaces the failure to explicit and timed callers', async () => {
    const failure = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('unreachable'));
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
      maxAttempts: 1,
    });
    const buffer = client.bufferEvents('system-a', {
      maxBufferedEvents: 2,
      batchSize: 1,
      flushIntervalMs: 0,
      onDeliveryFailure: failure,
    });
    buffer.enqueue(event);
    await expect(buffer.flush()).rejects.toThrow('unreachable');
    expect(buffer.pendingCount).toBe(1);
    expect(failure).toHaveBeenCalledWith(expect.any(Error), 1);
    fetcher.mockResolvedValue(ok());
    await buffer.close();
    expect(buffer.pendingCount).toBe(0);
    expect(() => buffer.enqueue(event)).toThrow('closed');
  });

  it('shares concurrent flush calls and never sends an in-flight batch twice', async () => {
    let respond: (value: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const client = new ZazieClient({
      baseUrl: 'https://zazie.example.test/api/v1',
      fetch: fetcher,
    });
    const buffer = client.bufferEvents('system-a', {
      batchSize: 1,
      flushIntervalMs: 0,
      onDeliveryFailure: vi.fn(),
    });
    buffer.enqueue(event);
    const first = buffer.flush();
    const second = buffer.flush();
    expect(first).toBe(second);
    respond(ok());
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
