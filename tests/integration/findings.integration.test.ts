import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  createDatabase,
  createQueue,
  identifier,
  getSystem,
  getRecord,
  sql,
  type Actor,
} from '@zazie/database';
import { createFilesystemStore } from '@zazie/storage';
import { PlatformService } from '../../apps/api/src/service.js';
import { createSyntheticFixture } from '../../examples/synthetic-fixture.js';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'finding history and release decisions',
  () => {
    it('a discovered and resolved issue cannot reactivate an older approval or frozen review', async () => {
      const database = createDatabase(url!);
      const boss = createQueue(url!);
      const root = await mkdtemp(join(tmpdir(), 'zazie-findings-'));
      boss.on('error', () => {});
      try {
        await boss.start();
        const organizationId = identifier();
        const ownerId = identifier();
        await database.db.execute(
          sql`INSERT INTO organizations(id,name) VALUES(${organizationId},'Finding regression fixture')`,
        );
        await database.db.execute(
          sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${ownerId},${organizationId},'https://synthetic.example.test',${ownerId},'Synthetic reviewer',ARRAY['admin','editor','reviewer'],true)`,
        );
        const actor: Actor = {
          id: ownerId,
          organizationId,
          displayName: 'Synthetic reviewer',
          roles: ['admin', 'editor', 'reviewer'],
          systemIds: [],
          allSystems: true,
        };
        const service = new PlatformService(
          database.db,
          boss,
          createFilesystemStore({ root }),
        );
        const fixture = await createSyntheticFixture(
          service,
          actor,
          'cv-filtering',
          ` ${identifier()}`,
        );
        const frozen = await service.create(
          actor,
          fixture.systemId,
          'release-reviews',
          { versionId: fixture.versionId, deploymentId: fixture.deploymentId },
          identifier(),
          identifier(),
        );
        const original = await getRecord(
          database.db,
          organizationId,
          fixture.systemId,
          fixture.reviewId,
          'release-reviews',
        );
        const before = await getSystem(
          database.db,
          organizationId,
          fixture.systemId,
        );
        const finding = await service.create(
          actor,
          fixture.systemId,
          'findings',
          {
            title: 'Investigate a missed requirement',
            description: 'Synthetic issue discovered after the first review.',
            ownerId,
            severity: 'high',
            blocksRelease: true,
          },
          identifier(),
          identifier(),
        );
        await service.resolveFinding(
          actor,
          fixture.systemId,
          finding.id,
          {
            expectedRevision: finding.revision,
            rationale: 'Synthetic corrective evidence reviewed.',
            artifactIds: [fixture.artifactId],
          },
          identifier(),
          identifier(),
        );
        const after = await getSystem(
          database.db,
          organizationId,
          fixture.systemId,
        );
        expect(after.evidenceRevision).toBe(before.evidenceRevision + 2);
        await expect(
          service.decision(
            actor,
            fixture.systemId,
            frozen.id,
            {
              decision: 'approve',
              rationale: 'Cannot approve this older snapshot.',
              expectedRevision: 1,
            },
            identifier(),
            identifier(),
          ),
        ).rejects.toMatchObject({ code: 'revision_conflict' });
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
        expect(
          (
            await getRecord(
              database.db,
              organizationId,
              fixture.systemId,
              fixture.reviewId,
              'release-reviews',
            )
          ).data,
        ).toEqual(original.data);
        for (const controlId of fixture.controlIds)
          await service.controlReview(
            actor,
            fixture.systemId,
            controlId,
            {
              versionId: fixture.versionId,
              expectedRevision: 1,
              expectedSystemRevision: after.evidenceRevision,
              rationale:
                'Reviewed the issue and its resolution with the evidence.',
            },
            identifier(),
            identifier(),
          );
        const replacement = await service.create(
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
          replacement.id,
          {
            decision: 'approve',
            expectedRevision: 1,
            rationale: 'Approve the new snapshot including the resolved issue.',
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
      } finally {
        await boss.stop();
        await database.close();
        await rm(root, { recursive: true, force: true });
      }
    });
  },
);
