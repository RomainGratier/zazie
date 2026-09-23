import { ZazieClient } from '../dist/sdk.js';

// This imported bundle is generated from the compiled SDK, never a hand-written stand-in.
Deno.serve(async () => {
  const requests: Array<{
    url: string;
    key: string | null;
    body: string | null;
  }> = [];
  let eventAttempts = 0;
  const client = new ZazieClient({
    baseUrl: 'https://synthetic-zazie.invalid/api/v1',
    token: 'synthetic-scoped-token',
    maxAttempts: 2,
    sleep: async () => {},
    fetch: async (url: URL | RequestInfo, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      if (headers.get('Authorization') !== 'Bearer synthetic-scoped-token')
        throw new Error('Scoped authorization was not forwarded');
      requests.push({
        url: String(url),
        key: headers.get('Idempotency-Key'),
        body: typeof options?.body === 'string' ? options.body : null,
      });
      if (String(url).endsWith('/events') && ++eventAttempts === 1)
        return Response.json(
          { code: 'synthetic_retry', message: 'Retry the synthetic request' },
          { status: 503 },
        );
      return Response.json({ items: [] });
    },
  });
  const failures: string[] = [];
  const buffer = client.bufferEvents('synthetic-system', {
    flushIntervalMs: 0,
    onDeliveryFailure: (error: unknown) => failures.push(String(error)),
  });
  buffer.enqueue({
    schemaVersion: '1.0',
    eventId: 'edge-synthetic-event-1',
    source: 'supabase-edge-smoke',
    type: 'oversight.reviewed',
    versionId: 'synthetic-version',
    occurredAt: new Date().toISOString(),
    payload: { synthetic: true, timestampSeconds: 15 },
  });
  await buffer.close();
  await client.uploadArtifact(
    'synthetic-system',
    {
      filename: 'synthetic.json',
      contentType: 'application/json',
      provenance:
        'Local Supabase Edge runtime fixture; no actual model execution',
    },
    new TextEncoder().encode('{"synthetic":true}'),
  );
  if (
    requests.length !== 3 ||
    eventAttempts !== 2 ||
    !requests[0].key ||
    requests[0].key !== requests[1].key ||
    requests[0].body !== requests[1].body ||
    buffer.pendingCount !== 0 ||
    failures.length !== 0 ||
    JSON.parse(requests[2].body ?? '{}').contentBase64 !==
      'eyJzeW50aGV0aWMiOnRydWV9'
  )
    throw new Error('The Edge runtime SDK invariant checks failed');
  return Response.json({
    passed: true,
    runtime: 'supabase-edge-user-worker',
    denoVersion: Deno.version.deno,
    sdkLoaded: true,
    requests: requests.length,
    eventAttempts,
    sameIdempotencyKeyOnRetry: true,
    bufferedEventsAfterFlush: buffer.pendingCount,
    artifactBinaryEncoding: 'passed',
  });
});
