// Run after building: deno run --allow-read=packages,node_modules --node-modules-dir=manual packages/sdk-typescript/tests/deno-smoke.ts
const { ZazieClient } = (await import(
  new URL('../dist/index.js', import.meta.url).href
)) as typeof import('../src/index.js');

const requests: Array<{ url: string; body: unknown }> = [];
const client = new ZazieClient({
  baseUrl: 'https://synthetic-zazie.invalid/api/v1',
  token: 'synthetic-scoped-token',
  fetch: async (url, options) => {
    requests.push({
      url: String(url),
      body: options?.body
        ? (JSON.parse(String(options.body)) as unknown)
        : null,
    });
    if (
      new Headers(options?.headers).get('Authorization') !==
      'Bearer synthetic-scoped-token'
    )
      throw new Error('Missing scoped authorization');
    return new Response(JSON.stringify({ items: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  },
});
const buffer = client.bufferEvents('synthetic-system', {
  flushIntervalMs: 0,
  onDeliveryFailure: (error) => {
    throw error;
  },
});
buffer.enqueue({
  schemaVersion: '1.0',
  eventId: 'synthetic-deno-event',
  source: 'deno-smoke',
  type: 'oversight.reviewed',
  versionId: 'synthetic-version',
  occurredAt: new Date().toISOString(),
  payload: { synthetic: true },
});
await buffer.close();
await client.uploadArtifact(
  'synthetic-system',
  {
    filename: 'synthetic.json',
    contentType: 'application/json',
    provenance: 'Deno runtime smoke test',
  },
  new TextEncoder().encode('{"synthetic":true}'),
);
if (
  requests.length !== 2 ||
  !requests[0]?.url.endsWith('/systems/synthetic-system/events') ||
  buffer.pendingCount !== 0
)
  throw new Error('Deno SDK delivery failed');
console.log(
  'Deno SDK loading, Fetch requests, event flushing, and binary encoding passed.',
);
