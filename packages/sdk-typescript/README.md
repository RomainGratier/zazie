# Zazie TypeScript SDK

This private workspace package sends evidence to a customer-controlled Zazie `/api/v1` endpoint. It does not connect to PostgreSQL, execute models, or approve releases. No package has been published to npm.

```ts
import { ZazieClient } from '@zazie/sdk-typescript';

const client = new ZazieClient({
  baseUrl: 'https://zazie.example.org/api/v1',
  token: scopedIntegrationToken,
});

await client.submitEvaluation(systemId, report);
const gate = await client.checkRelease(systemId, versionId, deploymentId);
// Deployment checks require the applicable authorised human approval.
```

Input contracts are validated locally and again by the API. Stored artifacts are uploaded explicitly; the SDK does not automatically collect prompts, CVs, model outputs, or video. Imported reports remain labelled as execution not independently verified by Zazie.

The transport uses generated route metadata from the checked-in OpenAPI generation process. Requests time out after 10 seconds and retry at most three attempts by default. An individual mutation keeps the same idempotency key and payload across retries. Authorization errors are not retried. Supply an explicit idempotency key when retrying a whole caller operation after an ambiguous result.

For runtime events, `bufferEvents` provides bounded asynchronous batching. Its required `onDeliveryFailure` callback reports delivery failure or a full buffer. Failed batches remain buffered; explicit `flush()` rejects when delivery fails. Always await `close()` during a controlled shutdown. Callers must decide how to handle a full buffer. **Memory buffering does not survive process termination**; evidence requiring durable delivery needs a customer-owned outbox or a future collector.

The implementation uses standard Fetch, URL, Web Crypto, Abort, and text/binary APIs. The automated Node tests exercise retries, cancellation, timeout, batching and failure handling. After building the workspace, a Deno smoke test can be run with:

```sh
deno run --allow-read=packages,node_modules --node-modules-dir=manual packages/sdk-typescript/tests/deno-smoke.ts
```

This verifies loading the built package and making Fetch calls in Deno with a synthetic in-process transport. The [standalone Supabase Edge fixture](../../examples/supabase-edge/README.md) separately validates the compiled SDK in a real local Edge user worker. Neither test certifies a hosted application's configuration. The two integration examples under `examples/` exercise the actual platform API.

To verify distributable package contents from the repository root:

```sh
node scripts/sdk-package-smoke.mjs
```

This builds the SDK, contracts, and domain packages, then packs them along with the installed Zod dependency. It installs those tarballs into a temporary consumer outside the workspace using npm offline mode, a fresh empty cache, and an unreachable registry. The check loads the compiled exports, rejects workspace symlinks, verifies input validation, and submits synthetic Fetch requests. It removes its temporary files when finished and does not publish packages or contact a model service. Run `pnpm install --frozen-lockfile` before this check so the build tools and Zod package are available locally.

Administrator token creation returns a secret only on the first successful issuance. Repeating the same idempotency key returns the credential metadata and `secretAlreadyIssued: true`, without the token. If the first response was lost, revoke that credential ID and issue a replacement with a new key. The server stores token verifiers and replay metadata, never recoverable token secrets.
