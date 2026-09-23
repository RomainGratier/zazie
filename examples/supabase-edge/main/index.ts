// Standalone local test gateway. No external identities, tokens, or services are configured.
Deno.serve(async (request: Request) => {
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath: '/fixture/function',
    memoryLimitMb: 150,
    workerTimeoutMs: 30_000,
    cpuTimeSoftLimitMs: 5_000,
    cpuTimeHardLimitMs: 10_000,
    noModuleCache: false,
    forceCreate: false,
    envVars: [],
  });
  return worker.fetch(request);
});
