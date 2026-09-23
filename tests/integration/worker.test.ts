import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createQueue,
  getRecord,
  getSystem,
  identifier,
  listRecords,
  rows,
  sql,
  type Actor,
} from '@zazie/database';
import { createFilesystemStore, sha256 } from '@zazie/storage';
import { DEFAULT_RETENTION_POLICY } from '@zazie/contracts';
import { PlatformService } from '../../apps/api/src/service.js';
import { WorkerTasks, type DossierJob } from '../../apps/worker/src/index.js';
import { migrate } from '../../packages/database/src/migrate.js';
import { createSyntheticFixture } from '../../examples/synthetic-fixture.js';
import { configureRetention } from '../../scripts/retention.js';

const connectionString = process.env['TEST_DATABASE_URL'];

describe.skipIf(!connectionString)(
  'durable worker operations with PostgreSQL',
  () => {
    let database: ReturnType<typeof createDatabase>;
    let queue: ReturnType<typeof createQueue>;
    let storage: ReturnType<typeof createFilesystemStore>;
    let service: PlatformService;
    let tasks: WorkerTasks;
    let root: string;
    let actor: Actor;

    beforeAll(async () => {
      await migrate(connectionString!);
      database = createDatabase(connectionString!);
      queue = createQueue(connectionString!);
      queue.on('error', () => undefined);
      await queue.start();
      root = await mkdtemp(join(tmpdir(), 'zazie-worker-'));
      storage = createFilesystemStore({ root });
      service = new PlatformService(database.db, queue, storage);
      tasks = new WorkerTasks(database.db, service, storage);
      actor = {
        id: identifier(),
        organizationId: identifier(),
        displayName: 'Worker test reviewer',
        roles: ['admin', 'editor', 'reviewer', 'viewer'],
        systemIds: [],
        allSystems: true,
      };
      await database.db.execute(
        sql`INSERT INTO organizations(id,name) VALUES(${actor.organizationId},'Synthetic worker test')`,
      );
      await database.db.execute(
        sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${actor.id},${actor.organizationId},'https://worker-test.invalid',${actor.id},${actor.displayName},ARRAY['admin','editor','reviewer','viewer'],true)`,
      );
    });

    afterAll(async () => {
      if (queue) await queue.stop();
      if (database) await database.close();
      if (root) await rm(root, { recursive: true, force: true });
    });

    it('survives queue restart and completes a delivered dossier exactly once', async () => {
      const fixture = await createSyntheticFixture(
        service,
        actor,
        'cv-filtering',
        ' worker restart',
      );
      const job: DossierJob = {
        organizationId: actor.organizationId,
        systemId: fixture.systemId,
        dossierId: fixture.dossierId,
        requestId: identifier(),
      };
      const name = `restart-${identifier()}`;
      const sender = createQueue(connectionString!);
      sender.on('error', () => undefined);
      await sender.start();
      await sender.createQueue(name, { retryLimit: 1, retryDelay: 0 });
      const jobId = await sender.send(name, job);
      await sender.stop();

      const restarted = createQueue(connectionString!);
      restarted.on('error', () => undefined);
      await restarted.start();
      try {
        const [delivered] = await restarted.fetch<DossierJob>(name);
        expect(delivered?.id).toBe(jobId);
        const first = await tasks.dossier(delivered!.data);
        // Delivery can recur after completion commits but before a queue acknowledgement.
        const retryTasks = new WorkerTasks(database.db, service, storage);
        expect(await retryTasks.dossier(delivered!.data)).toEqual(first);
        await restarted.complete(name, delivered!.id);
        expect(await restarted.fetch(name)).toHaveLength(0);
        const dossier = await getRecord(
          database.db,
          actor.organizationId,
          fixture.systemId,
          fixture.dossierId,
          'dossiers',
        );
        expect(dossier.revision).toBe(2);
        expect(dossier.data.status).toBe('completed');
        const bytes = await storage.get(String(dossier.data.storageKey), {
          expectedSha256: String(dossier.data.sha256),
        });
        expect(bytes.slice(0, 2)).toEqual(Buffer.from('PK'));
        expect(sha256(bytes)).toBe(first.sha256);
        expect(
          await rows(
            database.db,
            sql`SELECT id FROM audit_events WHERE object_id=${fixture.dossierId} AND action='dossier.completed'`,
          ),
        ).toHaveLength(1);
      } finally {
        await restarted.stop();
      }
    });

    it('deduplicates concurrent freshness findings and distinguishes unavailable evidence', async () => {
      const fixture = await createSyntheticFixture(
        service,
        actor,
        'exam-monitoring',
        ' worker freshness',
      );
      const originalSystem = await getSystem(
        database.db,
        actor.organizationId,
        fixture.systemId,
      );
      const future = new Date(Date.now() + 31 * 86_400_000).toISOString();
      await Promise.all([tasks.freshness(future), tasks.freshness(future)]);
      expect(
        (await getSystem(database.db, actor.organizationId, fixture.systemId))
          .evidenceRevision,
      ).toBe(originalSystem.evidenceRevision + 1);
      const stale = (
        await listRecords(
          database.db,
          actor.organizationId,
          fixture.systemId,
          'findings',
        )
      ).filter((finding) =>
        String(finding.data.source).endsWith(':evidence_stale'),
      );
      expect(stale).toHaveLength(fixture.controlIds.length);
      expect(
        stale.every(
          (finding) =>
            finding.data.ownerId === actor.id &&
            finding.data.blocksRelease === true,
        ),
      ).toBe(true);
      const artifact = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.artifactId,
        'artifacts',
      );
      const originalBytes = await storage.get(String(artifact.data.storageKey));
      await storage.delete(String(artifact.data.storageKey));
      await tasks.freshness(future);
      const missing = (
        await listRecords(
          database.db,
          actor.organizationId,
          fixture.systemId,
          'findings',
        )
      ).filter((finding) =>
        String(finding.data.source).endsWith(':evidence_unavailable'),
      );
      expect(missing).toHaveLength(fixture.controlIds.length);
      await tasks.freshness(future);
      const afterRetry = await listRecords(
        database.db,
        actor.organizationId,
        fixture.systemId,
        'findings',
      );
      expect(afterRetry).toHaveLength(stale.length + missing.length);
      expect(
        (await getSystem(database.db, actor.organizationId, fixture.systemId))
          .evidenceRevision,
      ).toBe(originalSystem.evidenceRevision + 2);

      await storage.put(String(artifact.data.storageKey), originalBytes, {
        expectedSha256: String(artifact.data.sha256),
      });
      for (const finding of afterRetry)
        await service.resolveFinding(
          actor,
          fixture.systemId,
          finding.id,
          {
            expectedRevision: finding.revision,
            artifactIds: [artifact.id],
            rationale:
              'Synthetic recovery: restored the verified artifact. At the real test clock the imported evidence remains within its freshness period.',
          },
          identifier(),
          identifier(),
        );
      const recoveredSystem = await getSystem(
        database.db,
        actor.organizationId,
        fixture.systemId,
      );
      for (const controlId of fixture.controlIds) {
        const control = await getRecord(
          database.db,
          actor.organizationId,
          fixture.systemId,
          controlId,
          'controls',
        );
        await service.controlReview(
          actor,
          fixture.systemId,
          control.id,
          {
            versionId: fixture.versionId,
            expectedRevision: control.revision,
            expectedSystemRevision: recoveredSystem.evidenceRevision,
            rationale:
              'Reviewed restored synthetic evidence and resolved findings.',
          },
          identifier(),
          identifier(),
        );
      }
      const recovered = await service.readiness(
        actor,
        fixture.systemId,
        fixture.versionId,
        fixture.deploymentId,
        'deploy',
      );
      expect(recovered.blockers.map((blocker) => blocker.code)).toEqual([
        'release_approval_required',
      ]);
      const review = await service.create(
        actor,
        fixture.systemId,
        'release-reviews',
        { versionId: fixture.versionId, deploymentId: fixture.deploymentId },
        identifier(),
        identifier(),
      );
      await service.decision(
        actor,
        fixture.systemId,
        review.id,
        {
          decision: 'approve',
          expectedRevision: review.revision,
          rationale:
            'Approve the new synthetic recovery snapshot after review.',
        },
        identifier(),
        identifier(),
      );
      expect(
        (
          await service.readiness(
            actor,
            fixture.systemId,
            fixture.versionId,
            fixture.deploymentId,
            'deploy',
          )
        ).satisfied,
      ).toBe(true);
    });

    it('exports explicit gaps when a referenced artifact has disappeared', async () => {
      const fixture = await createSyntheticFixture(
        service,
        actor,
        'cv-filtering',
        ' worker omissions',
      );
      const artifact = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.artifactId,
        'artifacts',
      );
      await storage.delete(String(artifact.data.storageKey));
      await tasks.dossier({
        organizationId: actor.organizationId,
        systemId: fixture.systemId,
        dossierId: fixture.dossierId,
        requestId: identifier(),
      });
      const dossier = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.dossierId,
        'dossiers',
      );
      expect(dossier.data.status).toBe('completed');
      expect(dossier.data.missing).toContain(
        `Evidence ${fixture.artifactId}: unavailable`,
      );
    });

    it('recovers an orphan archive write when evidence availability changes before retry', async () => {
      const fixture = await createSyntheticFixture(
        service,
        actor,
        'cv-filtering',
        ' worker upload crash',
      );
      const artifact = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.artifactId,
        'artifacts',
      );
      const evidenceKey = String(artifact.data.storageKey);
      const originalBytes = await storage.get(evidenceKey);
      await storage.delete(evidenceKey);
      let orphanKey: string | undefined;
      const crashingTasks = new WorkerTasks(database.db, service, {
        ...storage,
        async put(key, bytes, integrity) {
          await storage.put(key, bytes, integrity);
          orphanKey = key;
          throw new Error('Synthetic crash after archive publication');
        },
      });
      const job = {
        organizationId: actor.organizationId,
        systemId: fixture.systemId,
        dossierId: fixture.dossierId,
        requestId: identifier(),
      };
      await expect(crashingTasks.dossier(job)).rejects.toThrow(
        'Synthetic crash after archive publication',
      );
      expect(orphanKey).toBeDefined();
      const pending = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.dossierId,
        'dossiers',
      );
      expect(pending.data.status).toBe('queued');
      expect(pending.revision).toBe(1);

      await storage.put(evidenceKey, originalBytes);
      await tasks.dossier(job);
      const completed = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.dossierId,
        'dossiers',
      );
      expect(completed.data.status).toBe('completed');
      expect(completed.data.storageKey).not.toBe(orphanKey);
      expect(completed.data.storageKey).toContain(
        `${completed.data.sha256}.zip`,
      );
      expect(completed.data.missing).not.toContain(
        `Evidence ${fixture.artifactId}: unavailable`,
      );
      expect(await storage.exists(orphanKey!)).toBe(true);
      await storage.get(String(completed.data.storageKey), {
        expectedSha256: String(completed.data.sha256),
      });
      expect(await tasks.dossier(job)).toEqual({
        dossierId: fixture.dossierId,
        sha256: completed.data.sha256,
      });
    });

    it('bounds queue retries and retains a visible failed job and dossier status', async () => {
      const fixture = await createSyntheticFixture(
        service,
        actor,
        'cv-filtering',
        ' worker failed export',
      );
      const data: DossierJob = {
        organizationId: actor.organizationId,
        systemId: fixture.systemId,
        dossierId: fixture.dossierId,
        requestId: identifier(),
      };
      const failingTasks = new WorkerTasks(database.db, service, {
        ...storage,
        async put() {
          throw new Error('Synthetic storage outage');
        },
      });
      const name = `failure-${identifier()}`;
      await queue.createQueue(name, { retryLimit: 1, retryDelay: 0 });
      const id = await queue.send(name, data);
      const [first] = await queue.fetch<DossierJob>(name, {
        includeMetadata: true,
      });
      expect(first?.id).toBe(id);
      await expect(failingTasks.dossier(first!.data)).rejects.toThrow(
        'Synthetic storage outage',
      );
      await tasks.recordDossierFailure(
        first!.data,
        first!.retryCount + 1,
        first!.retryCount >= first!.retryLimit,
      );
      const retrying = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.dossierId,
        'dossiers',
      );
      expect(retrying.data.status).toBe('retrying');
      expect(retrying.data.attempts).toBe(1);
      await queue.fail(name, first!.id, { error: 'synthetic_failure' });
      const [retry] = await queue.fetch<DossierJob>(name, {
        includeMetadata: true,
      });
      expect(retry?.id).toBe(id);
      await expect(failingTasks.dossier(retry!.data)).rejects.toThrow(
        'Synthetic storage outage',
      );
      await tasks.recordDossierFailure(
        retry!.data,
        retry!.retryCount + 1,
        retry!.retryCount >= retry!.retryLimit,
      );
      await tasks.recordDossierFailure(
        retry!.data,
        retry!.retryCount + 1,
        retry!.retryCount >= retry!.retryLimit,
      );
      const dossier = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.dossierId,
        'dossiers',
      );
      expect(dossier.data.status).toBe('failed');
      expect(dossier.data.attempts).toBe(2);
      expect(dossier.revision).toBe(3);
      expect(dossier.data.errorCode).toBe('dossier_export_failed');
      await queue.fail(name, retry!.id, { error: 'synthetic_failure' });
      const failed = await queue.getJobById(name, id!);
      expect(failed?.state).toBe('failed');
      expect(failed?.retryCount).toBe(1);
      expect(await queue.fetch(name)).toHaveLength(0);
      await tasks.dossier(data);
      await tasks.recordDossierFailure(data, 3, true);
      const recovered = await getRecord(
        database.db,
        actor.organizationId,
        fixture.systemId,
        fixture.dossierId,
        'dossiers',
      );
      expect(recovered.data.status).toBe('completed');
      expect(recovered.data.errorCode).toBeNull();
      expect(recovered.revision).toBe(4);
    });

    it('honours organisation retention grace periods without deleting protected evidence or history', async () => {
      const recent = identifier();
      const expired = identifier();
      const active = identifier();
      const unaffiliated = identifier();
      const otherOrganization = identifier();
      const otherMember = identifier();
      const otherExpired = identifier();
      await database.db.execute(
        sql`INSERT INTO organizations(id,name) VALUES(${otherOrganization},'Synthetic default retention')`,
      );
      await database.db.execute(
        sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles) VALUES(${otherMember},${otherOrganization},'https://retention-test.invalid',${otherMember},'Synthetic retention member',ARRAY['viewer'])`,
      );
      await database.db.execute(
        sql`INSERT INTO sessions(id,data,expires_at) VALUES
        (${recent},${JSON.stringify({ membershipId: actor.id })}::jsonb,now()-interval '2 days'),
        (${expired},${JSON.stringify({ membershipId: actor.id })}::jsonb,now()-interval '4 days'),
        (${active},${JSON.stringify({ membershipId: actor.id })}::jsonb,now()+interval '1 day'),
        (${unaffiliated},'{}',now()-interval '1 day'),
        (${otherExpired},${JSON.stringify({ membershipId: otherMember })}::jsonb,now()-interval '1 day')`,
      );
      const recentRevoked = identifier();
      const oldRevoked = identifier();
      const oldExpired = identifier();
      const activeCredential = identifier();
      const otherRevoked = identifier();
      for (const credential of [
        {
          id: recentRevoked,
          organizationId: actor.organizationId,
          expiryDays: 1,
          revokedDays: -2,
        },
        {
          id: oldRevoked,
          organizationId: actor.organizationId,
          expiryDays: 1,
          revokedDays: -8,
        },
        {
          id: oldExpired,
          organizationId: actor.organizationId,
          expiryDays: -8,
          revokedDays: null,
        },
        {
          id: activeCredential,
          organizationId: actor.organizationId,
          expiryDays: 1,
          revokedDays: null,
        },
        {
          id: otherRevoked,
          organizationId: otherOrganization,
          expiryDays: 1,
          revokedDays: -1,
        },
      ]) {
        const expiresAt = new Date(
          Date.now() + credential.expiryDays * 86_400_000,
        ).toISOString();
        const revokedAt =
          credential.revokedDays === null
            ? null
            : new Date(
                Date.now() + credential.revokedDays * 86_400_000,
              ).toISOString();
        await database.db.execute(
          sql`INSERT INTO credentials(id,organization_id,name,verifier,system_ids,actions,expires_at,revoked_at,created_by) VALUES(${credential.id},${credential.organizationId},'Synthetic retention credential',${identifier()},ARRAY[]::text[],ARRAY[]::text[],${expiresAt},${revokedAt},${actor.id})`,
        );
      }
      await database.db.execute(
        sql`UPDATE organizations SET settings='{"otherSetting":"preserve"}'::jsonb WHERE id=${actor.organizationId}`,
      );
      const policy = {
        ...DEFAULT_RETENTION_POLICY,
        expiredSessions: { graceDays: 3 },
        inactiveIntegrationCredentials: { graceDays: 7 },
      };
      await configureRetention(
        database.db,
        actor.organizationId,
        policy,
        'Synthetic retention policy exercise',
      );
      const configured = await rows(
        database.db,
        sql`SELECT settings FROM organizations WHERE id=${actor.organizationId}`,
      );
      expect(configured[0]?.settings).toEqual({
        otherSetting: 'preserve',
        retentionPolicy: policy,
      });
      const policyAudit = await rows(
        database.db,
        sql`SELECT metadata FROM audit_events WHERE organization_id=${actor.organizationId} AND action='retention.policy-configured'`,
      );
      expect(policyAudit).toHaveLength(1);
      expect(
        (policyAudit[0]?.metadata as Record<string, unknown>).policy,
      ).toEqual(policy);
      await expect(
        configureRetention(
          database.db,
          actor.organizationId,
          {
            ...policy,
            auditHistory: { mode: 'delete', days: 1 },
          },
          'Invalid synthetic deletion policy',
        ),
      ).rejects.toThrow();
      const before = await rows(
        database.db,
        sql`SELECT (SELECT count(*) FROM records WHERE organization_id=${actor.organizationId}) AS records,(SELECT count(*) FROM record_revisions WHERE organization_id=${actor.organizationId}) AS revisions,(SELECT count(*) FROM audit_events WHERE organization_id=${actor.organizationId}) AS audit`,
      );
      await tasks.housekeeping();
      for (const id of [expired, unaffiliated, otherExpired])
        expect(
          await rows(database.db, sql`SELECT id FROM sessions WHERE id=${id}`),
        ).toHaveLength(0);
      for (const id of [recent, active])
        expect(
          await rows(database.db, sql`SELECT id FROM sessions WHERE id=${id}`),
        ).toHaveLength(1);
      for (const id of [oldRevoked, oldExpired, otherRevoked])
        expect(
          await rows(
            database.db,
            sql`SELECT id FROM credentials WHERE id=${id}`,
          ),
        ).toHaveLength(0);
      for (const id of [recentRevoked, activeCredential])
        expect(
          await rows(
            database.db,
            sql`SELECT id FROM credentials WHERE id=${id}`,
          ),
        ).toHaveLength(1);
      expect(
        await rows(
          database.db,
          sql`SELECT (SELECT count(*) FROM records WHERE organization_id=${actor.organizationId}) AS records,(SELECT count(*) FROM record_revisions WHERE organization_id=${actor.organizationId}) AS revisions,(SELECT count(*) FROM audit_events WHERE organization_id=${actor.organizationId}) AS audit`,
        ),
      ).toEqual(before);
      expect(
        await rows(
          database.db,
          sql`SELECT settings FROM organizations WHERE id=${actor.organizationId}`,
        ),
      ).toEqual(configured);
    });
  },
);
