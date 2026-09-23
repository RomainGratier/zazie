# Standalone Supabase Edge SDK smoke test

This fixture loads the **compiled Zazie SDK inside an actual Supabase Edge user worker**, through the standalone Docker runtime. It requires Docker and the workspace's installed build dependencies. It does not require a Supabase account, a running Supabase stack, an API key, or production credentials.

From the repository root:

```sh
pnpm build
node examples/supabase-edge/smoke.mjs
```

The script bundles the built SDK for a browser-compatible module environment, mounts only this fixture into a temporary container, binds its HTTP port to localhost, invokes the user worker, and removes the container afterward. The generated bundle is ignored by Git. The main runtime forwards the HTTP invocation to a separate user worker with explicit memory and execution limits; the SDK is imported and executed there.

The worker uses a synthetic in-process Fetch adapter. It checks a transient failure followed by a successful retry with the identical idempotency key and payload, scoped authorization forwarding, buffered event delivery and explicit flush, and binary artifact encoding. No evidence is sent to an external server. Tests against the real Zazie API and PostgreSQL live in the integration suite.

Validated locally on 23 September 2026 with `public.ecr.aws/supabase/edge-runtime:v1.73.13`, reporting compatibility with Deno 2.1.4. The smoke command returned:

```json
{
  "passed": true,
  "runtime": "supabase-edge-user-worker",
  "sdkLoaded": true,
  "requests": 3,
  "eventAttempts": 2,
  "sameIdempotencyKeyOnRetry": true,
  "bufferedEventsAfterFlush": 0,
  "artifactBinaryEncoding": "passed"
}
```

Set `ZAZIE_EDGE_RUNTIME_IMAGE` to test another explicit image version. Successful execution demonstrates compatibility with the tested local runtime and these SDK operations; it does not validate an application's hosted configuration, its JWT verification, outbound policy, or production delivery durability.

Runtime topology and standalone invocation follow the official [Supabase Edge Runtime architecture](https://github.com/supabase/edge-runtime) and [self-hosting instructions](https://supabase.com/docs/reference/self-hosting-functions/functions).
