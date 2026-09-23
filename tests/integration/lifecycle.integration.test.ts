import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createQueue,
  identifier,
  getRecord,
  listRecords,
  getSystem,
  sql,
  rows,
  insertRecord,
  audit,
  enqueue,
  type Actor,
} from '@zazie/database';
import { createFilesystemStore, type ArtifactStore } from '@zazie/storage';
import { PlatformService } from '../../apps/api/src/service.js';
import {
  createSyntheticFixture,
  type DemoReferences,
} from '../../examples/synthetic-fixture.js';

const connectionString = process.env['TEST_DATABASE_URL'];
const suite = connectionString ? describe : describe.skip;
suite('real PostgreSQL evidence and release lifecycle', () => {
  const database = createDatabase(connectionString ?? 'postgresql://unused');
  const boss = createQueue(connectionString ?? 'postgresql://unused');
  let root: string;
  let storage: ArtifactStore;
  let service: PlatformService;
  let actor: Actor;
  let fixture: DemoReferences;
  const request = () => identifier();

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zazie-lifecycle-'));
    storage = createFilesystemStore({ root });
    const organizationId = identifier();
    const membershipId = identifier();
    await database.db.execute(
      sql`INSERT INTO organizations(id,name) VALUES(${organizationId},'Synthetic integration organisation')`,
    );
    await database.db.execute(
      sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${membershipId},${organizationId},'https://synthetic-id.example.test',${membershipId},'Synthetic reviewer',ARRAY['admin','editor','reviewer'],true)`,
    );
    actor = {
      id: membershipId,
      organizationId,
      displayName: 'Synthetic reviewer',
      roles: ['admin', 'editor', 'reviewer'],
      allSystems: true,
      systemIds: [],
    };
    boss.on('error', () => {});
    await boss.start();
    service = new PlatformService(database.db, boss, storage);
    fixture = await createSyntheticFixture(
      service,
      actor,
      'cv-filtering',
      ` ${identifier()}`,
    );
  }, 60_000);

  afterAll(async () => {
    await boss.stop();
    await database.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('persists a reviewed release, blocks a changed prompt, and serves the same state on a new connection', async () => {
    const second = createDatabase(connectionString!);
    try {
      const restarted = new PlatformService(second.db, boss, storage);
      expect(
        (
          await restarted.readiness(
            actor,
            fixture.systemId,
            fixture.versionId,
            fixture.deploymentId,
            'deploy',
          )
        ).satisfied,
      ).toBe(true);
      const changed = await restarted.readiness(
        actor,
        fixture.systemId,
        fixture.changedVersionId,
        fixture.changedDeploymentId,
        'deploy',
      );
      expect(changed.satisfied).toBe(false);
      expect(changed.blockers.map((blocker) => blocker.code)).toEqual(
        expect.arrayContaining([
          'evaluation_missing',
          'control_review_required',
          'release_approval_required',
        ]),
      );
    } finally {
      await second.close();
    }
  });

  it('bounds artifact integrity reads while checking all evidence and preserving unavailable status', async () => {
    const sample = await createSyntheticFixture(
      service,
      actor,
      'cv-filtering',
      ` bounded-artifacts-${identifier()}`,
    );
    for (let index = 0; index < 9; index++) {
      await service.create(
        actor,
        sample.systemId,
        'artifacts',
        {
          filename: `synthetic-history-${index}.txt`,
          contentType: 'text/plain',
          provenance:
            'Synthetic historical evidence for bounded-read regression',
          contentBase64: Buffer.from(`Synthetic record ${index}`).toString(
            'base64',
          ),
        },
        request(),
        request(),
      );
    }
    const missing = await getRecord(
      database.db,
      actor.organizationId,
      sample.systemId,
      sample.artifactId,
      'artifacts',
    );
    await storage.delete(String(missing.data.storageKey));
    let active = 0;
    let maximumActive = 0;
    let completed = 0;
    const observedStorage: ArtifactStore = {
      ...storage,
      async get(key, options) {
        active++;
        maximumActive = Math.max(maximumActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await storage.get(key, options);
        } finally {
          active--;
          completed++;
        }
      },
    };
    const checked = new PlatformService(database.db, boss, observedStorage);
    const context = await database.db.transaction((tx) =>
      checked.context(
        tx,
        actor,
        sample.systemId,
        sample.versionId,
        sample.deploymentId,
      ),
    );
    expect(context.artifacts.length).toBeGreaterThan(9);
    expect(completed).toBe(context.artifacts.length);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
    expect(
      context.artifacts.find((artifact) => artifact.id === sample.artifactId)
        ?.available,
    ).toBe(false);
    expect(
      context.artifacts.filter((artifact) => !artifact.available),
    ).toHaveLength(1);
    expect(
      context.artifacts.every(
        (artifact) =>
          Object.keys(artifact).sort().join(',') === 'available,id,sha256',
      ),
    ).toBe(true);
  });

  it('deduplicates identical concurrent events and rejects conflicting keys or source IDs', async () => {
    const body = {
      events: [
        {
          schemaVersion: '1.0',
          eventId: identifier(),
          source: 'integration-fixture',
          type: 'oversight.reviewed',
          versionId: fixture.versionId,
          deploymentId: fixture.deploymentId,
          occurredAt: new Date().toISOString(),
          payload: { accepted: false },
        },
      ],
    };
    const key = request();
    const [a, b] = await Promise.all([
      service.events(actor, fixture.systemId, body, key, request()),
      service.events(actor, fixture.systemId, body, key, request()),
    ]);
    expect(a.items[0]?.id).toBe(b.items[0]?.id);
    const third = await service.events(
      actor,
      fixture.systemId,
      body,
      request(),
      request(),
    );
    expect(third.items[0]?.id).toBe(a.items[0]?.id);
    const changed = {
      events: [{ ...body.events[0]!, payload: { accepted: true } }],
    };
    await expect(
      service.events(actor, fixture.systemId, changed, key, request()),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(
      service.events(actor, fixture.systemId, changed, request(), request()),
    ).rejects.toMatchObject({ code: 'event_conflict' });
  });

  it('rejects a viewer and an administrator without explicit reviewer permission', async () => {
    const body = {
      versionId: fixture.versionId,
      expectedRevision: 1,
      expectedSystemRevision: (
        await getSystem(database.db, actor.organizationId, fixture.systemId)
      ).evidenceRevision,
      rationale: 'Attempted unauthorised review',
    };
    for (const roles of [['viewer'], ['admin']] as Actor['roles'][]) {
      await expect(
        service.controlReview(
          { ...actor, roles },
          fixture.systemId,
          fixture.controlIds[0]!,
          body,
          request(),
          request(),
        ),
      ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    }
    const scoped = {
      ...actor,
      id: identifier(),
      roles: [] as Actor['roles'],
      allSystems: false,
      systemIds: [fixture.systemId],
      actions: ['events:write'],
    };
    await expect(
      service.events(
        scoped,
        identifier(),
        { events: [] },
        request(),
        request(),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects a control review based on an earlier evidence revision', async () => {
    const system = await getSystem(
      database.db,
      actor.organizationId,
      fixture.systemId,
    );
    await expect(
      service.controlReview(
        actor,
        fixture.systemId,
        fixture.controlIds[0]!,
        {
          versionId: fixture.versionId,
          expectedRevision: 1,
          expectedSystemRevision: system.evidenceRevision - 1,
          rationale: 'The reviewer loaded an older evidence set',
        },
        request(),
        request(),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict', status: 409 });
    const reviews = await listRecords(
      database.db,
      actor.organizationId,
      fixture.systemId,
      'control-reviews',
    );
    expect(reviews).toHaveLength(fixture.controlIds.length);
  });

  it('enforces organisation/system scope when reading or linking guessed evidence IDs', async () => {
    await expect(
      getRecord(
        database.db,
        identifier(),
        fixture.systemId,
        fixture.artifactId,
        'artifacts',
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const system = await getSystem(
      database.db,
      actor.organizationId,
      fixture.systemId,
    );
    const other = await service.createSystem(
      actor,
      { ...system.data, name: 'Synthetic isolated second system' },
      request(),
      request(),
    );
    await expect(
      service.create(
        actor,
        other.id,
        'evaluations',
        {
          versionId: fixture.versionId,
          definitionId: fixture.definitionId,
          definitionRevision: 1,
          datasetId: fixture.datasetId,
          datasetRevision: 1,
          measurements: {},
          artifactIds: [fixture.artifactId],
          producer: 'attempted-cross-link',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:00:01Z',
        },
        request(),
        request(),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      database.db.execute(
        sql`INSERT INTO record_links(organization_id,system_id,source_id,source_revision,target_id,target_revision,relation) VALUES(${actor.organizationId},${other.id},${fixture.reviewId},1,${fixture.artifactId},1,'forged-link')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects caller-asserted pass results before persistence', async () => {
    const runs = await listRecords(
      database.db,
      actor.organizationId,
      fixture.systemId,
      'evaluations',
    );
    const latest = runs.at(-1)!;
    await expect(
      service.create(
        actor,
        fixture.systemId,
        'evaluations',
        { ...latest.data, passed: true },
        request(),
        request(),
      ),
    ).rejects.toThrow();
    expect(
      (
        await listRecords(
          database.db,
          actor.organizationId,
          fixture.systemId,
          'evaluations',
        )
      ).length,
    ).toBe(runs.length);
  });

  it('rolls back domain records, audit entries and queued jobs together', async () => {
    const id = identifier();
    const correlation = identifier();
    await expect(
      database.db.transaction(async (tx) => {
        await insertRecord(
          tx,
          actor,
          fixture.systemId,
          'dossiers',
          { status: 'queued', releaseReviewId: fixture.reviewId },
          id,
        );
        await audit(
          tx,
          actor,
          fixture.systemId,
          'dossier.test',
          id,
          correlation,
        );
        await enqueue(
          boss,
          tx,
          'dossier',
          { dossierId: id, requestId: correlation },
          id,
        );
        throw new Error('Simulated failure before commit');
      }),
    ).rejects.toThrow('Simulated failure');
    expect(
      await rows(database.db, sql`SELECT id FROM records WHERE id=${id}`),
    ).toHaveLength(0);
    expect(
      await rows(
        database.db,
        sql`SELECT id FROM audit_events WHERE request_id=${correlation}`,
      ),
    ).toHaveLength(0);
    expect(
      await rows(
        database.db,
        sql`SELECT id FROM pgboss.job WHERE data->>'requestId'=${correlation}`,
      ),
    ).toHaveLength(0);
  });

  it('preserves snapshots and detects an approval race with changed criteria', async () => {
    const original = await getRecord(
      database.db,
      actor.organizationId,
      fixture.systemId,
      fixture.reviewId,
      'release-reviews',
    );
    const before = JSON.stringify(original.data.snapshot);
    expect(before).not.toContain('storageKey');
    expect(before).toContain('sha256');
    const review = await service.create(
      actor,
      fixture.systemId,
      'release-reviews',
      { versionId: fixture.versionId, deploymentId: fixture.deploymentId },
      request(),
      request(),
    );
    const definition = await getRecord(
      database.db,
      actor.organizationId,
      fixture.systemId,
      fixture.definitionId,
      'evaluation-definitions',
    );
    const outcomes = await Promise.allSettled([
      service.decision(
        actor,
        fixture.systemId,
        review.id,
        {
          decision: 'approve',
          expectedRevision: 1,
          rationale: 'Concurrent review attempt',
        },
        request(),
        request(),
      ),
      service.update(
        actor,
        fixture.systemId,
        'evaluation-definitions',
        definition.id,
        {
          expectedRevision: definition.revision,
          data: {
            ...definition.data,
            criteria: [
              {
                metric: 'qualified_candidate_recall',
                operator: 'gte',
                threshold: 0.99,
              },
            ],
          },
        },
        request(),
        request(),
      ),
    ]);
    expect(outcomes[1]?.status).toBe('fulfilled');
    if (outcomes[0]?.status === 'rejected')
      expect(outcomes[0].reason).toMatchObject({ code: 'revision_conflict' });
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
    ).toBe(false);
    const preserved = await getRecord(
      database.db,
      actor.organizationId,
      fixture.systemId,
      fixture.reviewId,
      'release-reviews',
    );
    expect(JSON.stringify(preserved.data.snapshot)).toBe(before);
    expect(preserved.data.snapshotDigest).toBe(original.data.snapshotDigest);
    await expect(
      database.db.execute(
        sql`UPDATE records SET data='{}',revision=revision+1 WHERE id=${fixture.reviewId}`,
      ),
    ).rejects.toThrow();
  });

  it('reuses the same backend for event-level exam evidence and detects unavailable artifacts', async () => {
    const exam = await createSyntheticFixture(
      service,
      actor,
      'exam-monitoring',
      ` ${identifier()}`,
    );
    const events = await listRecords(
      database.db,
      actor.organizationId,
      exam.systemId,
      'events',
    );
    expect(events[0]?.data.payload).toMatchObject({
      timestampSeconds: 42,
      action: 'dismiss_flag',
    });
    const artifact = await getRecord(
      database.db,
      actor.organizationId,
      exam.systemId,
      exam.artifactId,
      'artifacts',
    );
    await storage.delete(String(artifact.data.storageKey));
    const readiness = await service.readiness(
      actor,
      exam.systemId,
      exam.versionId,
      exam.deploymentId,
      'deploy',
    );
    expect(readiness.satisfied).toBe(false);
    expect(
      readiness.blockers.some(
        (blocker) => blocker.code === 'evidence_unavailable',
      ),
    ).toBe(true);
  }, 60_000);

  it('requires an authorised, current and scoped non-applicability decision while preserving earlier snapshots', async () => {
    const originalReview = await getRecord(
      database.db,
      actor.organizationId,
      fixture.systemId,
      fixture.reviewId,
      'release-reviews',
    );
    const originalSnapshot = JSON.stringify(originalReview.data.snapshot);
    const system = await getSystem(
      database.db,
      actor.organizationId,
      fixture.systemId,
    );
    const input = {
      requirementId: 'human-oversight',
      applicability: 'not_applicable',
      ownerId: actor.id,
      rationale:
        'Synthetic contract exercise only; no claim that oversight can be omitted for the real intended use.',
      scope:
        'Isolated synthetic scenario for testing recorded applicability changes',
      expectedSystemRevision: system.evidenceRevision,
    };
    await expect(
      service.create(
        { ...actor, roles: ['editor'] },
        fixture.systemId,
        'applicability-decisions',
        input,
        request(),
        request(),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    await expect(
      service.create(
        actor,
        fixture.systemId,
        'applicability-decisions',
        { ...input, expectedSystemRevision: system.evidenceRevision - 1 },
        request(),
        request(),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict', status: 409 });
    const excluded = await service.create(
      actor,
      fixture.systemId,
      'applicability-decisions',
      input,
      request(),
      request(),
    );
    expect(excluded.data).toMatchObject({
      applicability: 'not_applicable',
      reviewerId: actor.id,
      ownerId: actor.id,
      scope: input.scope,
    });
    const context = await service.context(
      database.db,
      actor,
      fixture.systemId,
      fixture.versionId,
      fixture.deploymentId,
    );
    expect(
      context.requirements?.find(
        (requirement) => requirement.id === input.requirementId,
      ),
    ).toMatchObject({
      applicability: 'not_applicable',
      nonApplicability: {
        ownerId: actor.id,
        rationale: input.rationale,
        scope: input.scope,
      },
    });
    await expect(
      service.update(
        actor,
        fixture.systemId,
        'applicability-decisions',
        excluded.id,
        { expectedRevision: 1, data: input },
        request(),
        request(),
      ),
    ).rejects.toMatchObject({ code: 'immutable_record' });
    const revisionAfterDecision = (
      await getSystem(database.db, actor.organizationId, fixture.systemId)
    ).evidenceRevision;
    await service.create(
      actor,
      fixture.systemId,
      'applicability-decisions',
      {
        ...input,
        applicability: 'applicable',
        rationale:
          'Restore the configured requirement after the synthetic history exercise.',
        expectedSystemRevision: revisionAfterDecision,
      },
      request(),
      request(),
    );
    expect(
      await listRecords(
        database.db,
        actor.organizationId,
        fixture.systemId,
        'applicability-decisions',
      ),
    ).toHaveLength(2);
    expect(
      (
        await getRecord(
          database.db,
          actor.organizationId,
          fixture.systemId,
          excluded.id,
          'applicability-decisions',
        )
      ).data.applicability,
    ).toBe('not_applicable');
    const preserved = await getRecord(
      database.db,
      actor.organizationId,
      fixture.systemId,
      fixture.reviewId,
      'release-reviews',
    );
    expect(JSON.stringify(preserved.data.snapshot)).toBe(originalSnapshot);
    expect(preserved.data.snapshotDigest).toBe(
      originalReview.data.snapshotDigest,
    );
  });

  it('retains multiple version-specific reuse assessments until their policy dependencies change', async () => {
    const sample = await createSyntheticFixture(
      service,
      actor,
      'cv-filtering',
      ` reuse ${identifier()}`,
    );
    const make = (kind: string, body: unknown) =>
      service.create(actor, sample.systemId, kind, body, request(), request());
    const secondDefinition = await make('evaluation-definitions', {
      name: 'Independent synthetic second evaluation',
      datasetId: sample.datasetId,
      criteria: [
        { metric: 'secondary_recall', operator: 'gte', threshold: 0.8 },
      ],
    });
    const secondRun = await make('evaluations', {
      versionId: sample.versionId,
      definitionId: secondDefinition.id,
      definitionRevision: secondDefinition.revision,
      datasetId: sample.datasetId,
      datasetRevision: sample.datasetRevision,
      measurements: { secondary_recall: 0.95 },
      artifactIds: [sample.artifactId],
      producer: 'synthetic-reuse-test',
      startedAt: new Date(Date.now() - 2000).toISOString(),
      completedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const control = await getRecord(
      database.db,
      actor.organizationId,
      sample.systemId,
      sample.controlIds[0]!,
      'controls',
    );
    const updatedControl = await service.update(
      actor,
      sample.systemId,
      'controls',
      control.id,
      {
        expectedRevision: control.revision,
        data: {
          ...control.data,
          evaluationDefinitionIds: [sample.definitionId, secondDefinition.id],
        },
      },
      request(),
      request(),
    );
    const runs = await listRecords(
      database.db,
      actor.organizationId,
      sample.systemId,
      'evaluations',
    );
    const firstRun = runs.find(
      (run) =>
        run.data.definitionId === sample.definitionId &&
        (run.data.measurements as Record<string, number>)[
          'qualified_candidate_recall'
        ] === 0.95,
    )!;
    const decisions = [];
    for (const evaluationId of [firstRun.id, secondRun.id]) {
      const system = await getSystem(
        database.db,
        actor.organizationId,
        sample.systemId,
      );
      decisions.push(
        await make('evidence-reuse', {
          evaluationId,
          targetVersionId: sample.changedVersionId,
          rationale:
            'Synthetic reviewer assessed unchanged validation dependencies for this target version.',
          expectedSystemRevision: system.evidenceRevision,
        }),
      );
    }
    expect(decisions[0]!.data.policyDigest).toBe(
      decisions[1]!.data.policyDigest,
    );
    expect(decisions[0]!.data.systemRevision).not.toBe(
      decisions[1]!.data.systemRevision,
    );
    await make('artifacts', {
      filename: 'additional-synthetic-note.txt',
      contentType: 'text/plain',
      provenance: 'Additional collected evidence, not a policy change',
      contentBase64: Buffer.from('synthetic').toString('base64'),
    });
    const retained = await service.readiness(
      actor,
      sample.systemId,
      sample.changedVersionId,
      sample.changedDeploymentId,
      'review',
    );
    expect(
      retained.controls.find((state) => state.id === control.id)?.evaluationIds,
    ).toEqual([firstRun.id, secondRun.id]);
    expect(
      retained.blockers.some(
        (blocker) => blocker.code === 'evaluation_missing',
      ),
    ).toBe(false);
    await service.update(
      actor,
      sample.systemId,
      'controls',
      control.id,
      {
        expectedRevision: updatedControl.revision,
        data: {
          ...updatedControl.data,
          description:
            'Changed control policy requires a fresh impact assessment.',
        },
      },
      request(),
      request(),
    );
    const invalidated = await service.readiness(
      actor,
      sample.systemId,
      sample.changedVersionId,
      sample.changedDeploymentId,
      'review',
    );
    expect(
      invalidated.controls.find((state) => state.id === control.id)
        ?.evaluationIds,
    ).toEqual([]);
    expect(
      invalidated.blockers.some(
        (blocker) => blocker.code === 'evaluation_missing',
      ),
    ).toBe(true);
    expect(
      (
        await getRecord(
          database.db,
          actor.organizationId,
          sample.systemId,
          decisions[0]!.id,
          'evidence-reuse',
        )
      ).data.policyDigest,
    ).toBe(decisions[0]!.data.policyDigest);
  }, 60_000);
});
