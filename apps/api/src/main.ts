import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Export telemetry only when the installation explicitly configures a collector.
const telemetry = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new NodeSDK({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          // Authorization callbacks contain short-lived codes in their query string.
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (request) =>
              request.url?.startsWith('/auth/') ?? false,
          },
        }),
      ],
    })
  : undefined;
telemetry?.start();
const { loadConfig } = await import('./config.js');
const { createApplication } = await import('./server.js');
const config = loadConfig();
const runtime = await createApplication(config);
await runtime.application.listen(config.PORT, '0.0.0.0');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void runtime
      .close()
      .then(() => telemetry?.shutdown())
      .then(() => process.exit(0));
  });
