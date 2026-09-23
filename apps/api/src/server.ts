import 'reflect-metadata';
import { Module, type ArgumentsHost } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import {
  DomainError,
  authorize,
  createDatabase,
  createQueue,
  getRecord,
  getSystem,
  listRecords,
  rows,
  sql,
  type Actor,
} from '@zazie/database';
import { ListQuerySchema } from '@zazie/contracts';
import { providerStarterPack, procedureTemplates } from '@zazie/workflow-packs';
import { loadConfig, storageFromConfig, type Config } from './config.js';
import { registerAuth, requestActor } from './auth.js';
import { PlatformService } from './service.js';

@Module({})
class ApplicationModule {}
type Params = { systemId: string; kind: string; id: string };

export async function createApplication(config: Config = loadConfig()) {
  const database = createDatabase(config.DATABASE_URL);
  const migration = await rows(
    database.db,
    sql`SELECT version FROM schema_migrations ORDER BY version`,
  ).catch(() => []);
  if (migration.length !== 1 || migration[0]?.version !== 1) {
    await database.close();
    throw new Error(
      'Run the dedicated database migration command before starting Zazie',
    );
  }
  const boss = createQueue(config.DATABASE_URL);
  boss.on('error', (error) =>
    process.stderr.write(
      `${JSON.stringify({ level: 'error', component: 'queue', message: error.message })}\n`,
    ),
  );
  await boss.start();
  const storage = storageFromConfig(config);
  const service = new PlatformService(database.db, boss, storage);
  // Nest registers a fallback handler; route and global filters share one error format.
  const adapter = new FastifyAdapter({
    allowErrorHandlerOverride: true,
    bodyLimit: Math.ceil(config.ARTIFACT_MAX_BYTES * 1.4) + 100_000,
    logger: {
      serializers: {
        req: (request: { method: string; url: string }) => ({
          method: request.method,
          url: request.url.split('?')[0] ?? '/',
        }),
      },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'body.token',
        'body.contentBase64',
      ],
    },
    ...(config.TRUST_PROXY
      ? { trustProxy: config.TRUST_PROXY.split(',') }
      : {}),
  });
  const application = await NestFactory.create<NestFastifyApplication>(
    ApplicationModule,
    adapter,
    { logger: ['error', 'warn'] },
  );
  const app = adapter.getInstance();
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (_request.url.startsWith('/api/') || _request.url.startsWith('/auth/'))
      reply.header('cache-control', 'no-store');
    return payload;
  });
  const errorHandler: Parameters<typeof app.setErrorHandler>[0] = (
    error,
    request,
    reply,
  ) => {
    const known = error instanceof DomainError;
    const validation = error instanceof ZodError;
    const status = known
      ? error.status
      : validation
        ? 400
        : typeof (error as { statusCode?: number }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 500;
    if (status >= 500)
      request.log.error(
        {
          errorType: error instanceof Error ? error.name : 'unknown',
          requestId: request.id,
        },
        'Request failed',
      );
    return reply.code(status).send({
      code: known
        ? error.code
        : validation
          ? 'validation_error'
          : status === 429
            ? 'rate_limited'
            : 'request_failed',
      message: known
        ? error.message
        : validation
          ? 'Check the highlighted input values'
          : status >= 500
            ? 'The request could not be completed'
            : 'Request rejected',
      requestId: request.id,
      ...(known && error.details
        ? { details: error.details }
        : validation
          ? { details: error.issues }
          : {}),
    });
  };
  application.useGlobalFilters({
    catch(error: unknown, host: ArgumentsHost) {
      const http = host.switchToHttp();
      return errorHandler.call(
        app,
        error as Error,
        http.getRequest(),
        http.getResponse(),
      );
    },
  });
  app.setErrorHandler(errorHandler);
  await registerAuth(app, database.db, config);
  const live = async () => ({
    status: 'live',
    version: '0.2.0',
    apiVersion: '1.0',
  });
  const ready = async () => {
    await rows(database.db, sql`SELECT 1`);
    await boss.getQueue('dossier');
    return { status: 'ready', version: '0.2.0', apiVersion: '1.0' };
  };
  app.get('/health/live', live);
  app.get('/health/ready', ready);
  app.get('/api/v1/health/live', live);
  app.get('/api/v1/health/ready', ready);
  app.get('/api/v1/openapi.json', async () =>
    JSON.parse(
      await readFile(new URL('../../../openapi.json', import.meta.url), 'utf8'),
    ),
  );
  app.get('/api/v1/workflow-packs', async () => ({
    items: [providerStarterPack],
  }));
  app.get('/api/v1/procedure-templates', async () => ({
    items: procedureTemplates,
  }));
  const key = (headers: Record<string, unknown>) =>
    typeof headers['idempotency-key'] === 'string'
      ? headers['idempotency-key']
      : '';
  app.get('/api/v1/systems', async (request) =>
    service.systems(requestActor(request)),
  );
  app.post('/api/v1/systems', async (request) =>
    service.createSystem(
      requestActor(request),
      request.body,
      key(request.headers),
      request.id,
    ),
  );
  app.get<{ Params: { systemId: string } }>(
    '/api/v1/systems/:systemId',
    async (request) => {
      const actor = requestActor(request);
      authorize(actor, request.params.systemId, 'systems:read');
      return getSystem(
        database.db,
        actor.organizationId,
        request.params.systemId,
      );
    },
  );
  app.put<{ Params: { systemId: string } }>(
    '/api/v1/systems/:systemId',
    async (request) =>
      service.updateSystem(
        requestActor(request),
        request.params.systemId,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  app.get<{ Params: { systemId: string } }>(
    '/api/v1/systems/:systemId/overview',
    async (request) =>
      service.overview(requestActor(request), request.params.systemId),
  );
  app.get('/api/v1/overview', async (request) => {
    const actor = requestActor(request);
    const systems = await service.systems(actor);
    const all = await Promise.all(
      systems.items.map((system) =>
        listRecords(database.db, actor.organizationId, system.id),
      ),
    );
    const records = all.flat();
    const decisions = new Set(
      records.filter((r) => r.kind === 'decisions').map((r) => r.data.reviewId),
    );
    return {
      systems: systems.items,
      findings: records.filter(
        (r) => r.kind === 'findings' && !r.data.resolved,
      ),
      pendingReviews: records.filter(
        (r) => r.kind === 'release-reviews' && !decisions.has(r.id),
      ),
      workflowPack: providerStarterPack,
      health: actor.roles.includes('admin')
        ? await operationalHealth(database.db)
        : { status: 'available' },
    };
  });
  app.get<{
    Params: { systemId: string };
    Querystring: {
      versionId?: string;
      deploymentId?: string;
      purpose?: string;
    };
  }>('/api/v1/systems/:systemId/releases/check', async (request) => {
    const query = z
      .object({
        versionId: z.string().min(1),
        deploymentId: z.string().min(1),
        purpose: z.enum(['review', 'deploy']).default('deploy'),
      })
      .parse(request.query);
    return service.readiness(
      requestActor(request),
      request.params.systemId,
      query.versionId,
      query.deploymentId,
      query.purpose,
    );
  });
  app.post<{ Params: { systemId: string } }>(
    '/api/v1/systems/:systemId/events',
    async (request) =>
      service.events(
        requestActor(request),
        request.params.systemId,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  app.post<{ Params: { systemId: string; id: string } }>(
    '/api/v1/systems/:systemId/controls/:id/reviews',
    async (request) =>
      service.controlReview(
        requestActor(request),
        request.params.systemId,
        request.params.id,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  app.post<{ Params: { systemId: string; id: string } }>(
    '/api/v1/systems/:systemId/release-reviews/:id/decisions',
    async (request) =>
      service.decision(
        requestActor(request),
        request.params.systemId,
        request.params.id,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  app.post<{ Params: { systemId: string; id: string } }>(
    '/api/v1/systems/:systemId/findings/:id/resolutions',
    async (request) =>
      service.resolveFinding(
        requestActor(request),
        request.params.systemId,
        request.params.id,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  for (const suffix of ['download', 'content'])
    app.get<{ Params: Params }>(
      `/api/v1/systems/:systemId/:kind/:id/${suffix}`,
      async (request, reply) => {
        const { systemId, kind, id } = request.params;
        const actor = requestActor(request);
        authorize(actor, systemId, 'systems:read');
        if (!['artifacts', 'dossiers'].includes(kind))
          throw new DomainError('not_found', 'Download not found', 404);
        const record = await getRecord(
          database.db,
          actor.organizationId,
          systemId,
          id,
          kind,
        );
        if (typeof record.data.storageKey !== 'string')
          throw new DomainError(
            'artifact_pending',
            'The export is not ready',
            409,
          );
        const content = await storage.get(record.data.storageKey, {
          expectedSha256: String(record.data.sha256),
        });
        reply.header(
          'content-disposition',
          `attachment; filename="${kind === 'dossiers' ? 'dossier.zip' : 'evidence.bin'}"`,
        );
        reply.type(
          kind === 'dossiers' ? 'application/zip' : 'application/octet-stream',
        );
        return reply.send(Buffer.from(content));
      },
    );
  app.get<{ Params: Params; Querystring: { limit?: string; offset?: string } }>(
    '/api/v1/systems/:systemId/:kind',
    async (request) => {
      const actor = requestActor(request);
      const { systemId, kind } = request.params;
      authorize(actor, systemId, 'systems:read');
      await getSystem(database.db, actor.organizationId, systemId);
      const { limit, offset } = ListQuerySchema.parse(request.query);
      const records = await listRecords(
        database.db,
        actor.organizationId,
        systemId,
        kind,
      );
      return {
        items: records
          .slice(offset, offset + limit)
          .map((r) => service.publicRecord(r)),
        ...(records.length > offset + limit
          ? { nextCursor: String(offset + limit) }
          : {}),
      };
    },
  );
  app.get<{ Params: Params }>(
    '/api/v1/systems/:systemId/:kind/:id',
    async (request) => {
      const actor = requestActor(request);
      const { systemId, kind, id } = request.params;
      authorize(actor, systemId, 'systems:read');
      return service.publicRecord(
        await getRecord(database.db, actor.organizationId, systemId, id, kind),
      );
    },
  );
  app.post<{ Params: Params }>(
    '/api/v1/systems/:systemId/:kind',
    async (request) =>
      service.create(
        requestActor(request),
        request.params.systemId,
        request.params.kind,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  app.put<{ Params: Params }>(
    '/api/v1/systems/:systemId/:kind/:id',
    async (request) =>
      service.update(
        requestActor(request),
        request.params.systemId,
        request.params.kind,
        request.params.id,
        request.body,
        key(request.headers),
        request.id,
      ),
  );
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      wildcard: false,
    });
    app.get('/*', (request, reply) =>
      request.url.startsWith('/api/') ||
      request.url.startsWith('/auth/') ||
      request.url.startsWith('/assets/')
        ? reply.code(404).send({
            code: 'not_found',
            message: 'Route not found',
            requestId: request.id,
          })
        : reply.sendFile('index.html'),
    );
  }
  await application.init();
  return {
    application,
    app,
    service,
    database,
    boss,
    async close() {
      await application.close();
      await boss.stop();
      await database.close();
    },
  };
}
async function operationalHealth(db: PlatformService['db']) {
  const workers = await rows(
    db,
    sql`SELECT id,heartbeat_at AS "heartbeatAt",last_error AS "lastError" FROM worker_status`,
  );
  const jobs = await rows(
    db,
    sql`SELECT id,name,state,retry_count AS attempts,created_on AS "createdAt",started_on AS "startedAt",completed_on AS "completedAt" FROM pgboss.job WHERE state='failed' ORDER BY created_on DESC LIMIT 20`,
  );
  return {
    workers,
    jobs,
    storage: 'configured',
    identity: 'OIDC',
    version: '0.2.0',
  };
}
