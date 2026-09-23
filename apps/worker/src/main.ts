import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  createQueue,
  identifier,
  rows,
  sql,
} from '@zazie/database';
import { loadConfig, storageFromConfig, PlatformService } from '@zazie/api';
import { WorkerTasks, type DossierJob } from './index.js';

export async function startWorker() {
  const config = loadConfig();
  const database = createDatabase(config.DATABASE_URL);
  const queue = createQueue(config.DATABASE_URL, true);
  const workerId = identifier();
  let lastError: string | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const log = (
    level: string,
    event: string,
    fields: Record<string, unknown> = {},
  ) => {
    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, workerId, ...fields })}\n`,
    );
  };
  const beat = async () => {
    await database.db.execute(
      sql`INSERT INTO worker_status(id,heartbeat_at,last_error) VALUES(${workerId},now(),${lastError}) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now(),last_error=${lastError}`,
    );
  };
  queue.on('error', () => {
    lastError = 'queue_error';
    log('error', 'queue.error');
  });
  try {
    const versions = await rows(
      database.db,
      sql`SELECT version FROM schema_migrations ORDER BY version`,
    );
    if (versions.length !== 1 || versions[0]?.version !== 1)
      throw new Error(
        'Run the matching database migration before starting the worker',
      );
    await queue.start();
    const storage = storageFromConfig(config);
    const tasks = new WorkerTasks(
      database.db,
      new PlatformService(database.db, queue, storage),
      storage,
      config.ARTIFACT_MAX_BYTES,
    );
    async function run<T>(
      name: string,
      jobId: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      try {
        const result = await fn();
        lastError = null;
        log('info', 'job.completed', { queue: name, jobId });
        return result;
      } catch (error) {
        lastError = `${name}_failed`;
        log('error', 'job.failed', { queue: name, jobId });
        // pg-boss stores the error; keep its message free of payloads and database details.
        throw new Error(
          `Zazie ${name} job failed; inspect the referenced records and service health.`,
          { cause: error instanceof Error ? error.name : 'unknown_error' },
        );
      } finally {
        await beat();
      }
    }
    await queue.work(
      'dossier',
      { batchSize: 1, includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) {
          const data = job.data as DossierJob;
          try {
            await run('dossier', job.id, () => tasks.dossier(data));
          } catch (error) {
            await tasks.recordDossierFailure(
              data,
              job.retryCount + 1,
              job.retryCount >= job.retryLimit,
            );
            throw error;
          }
        }
      },
    );
    await queue.work('freshness', { batchSize: 1 }, async (jobs) => {
      for (const job of jobs)
        await run('freshness', job.id, () => tasks.freshness());
    });
    await queue.work('housekeeping', { batchSize: 1 }, async (jobs) => {
      for (const job of jobs)
        await run('housekeeping', job.id, () => tasks.housekeeping());
    });
    // pg-boss persists schedules and coordinates the scheduler across worker replicas.
    await queue.schedule(
      'freshness',
      '0 * * * *',
      {},
      { tz: 'UTC', singletonKey: 'hourly-freshness' },
    );
    await queue.schedule(
      'housekeeping',
      '15 * * * *',
      {},
      { tz: 'UTC', singletonKey: 'hourly-housekeeping' },
    );
    await beat();
    heartbeat = setInterval(() => {
      void beat().catch(() => log('error', 'heartbeat.failed'));
    }, 15_000);
    heartbeat.unref();
    log('info', 'worker.started');
    return {
      tasks,
      async close() {
        if (heartbeat) clearInterval(heartbeat);
        await queue.stop({ graceful: true, timeout: 30_000 });
        await database.close();
      },
    };
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    await queue.stop().catch(() => undefined);
    await database.close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const worker = await startWorker();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void worker.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
}
