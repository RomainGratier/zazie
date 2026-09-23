import {
  audit,
  getRecord,
  getSystem,
  identifier,
  insertRecord,
  listRecords,
  reviseRecord,
  rows,
  sql,
  type Actor,
  type Database,
  type StoredRecord,
} from '@zazie/database';
import { evaluateReadiness } from '@zazie/domain';
import { retentionPolicyFromSettings } from '@zazie/contracts';
import { PlatformService } from '@zazie/api';
import {
  createDossierArchive,
  type ArtifactStore,
  type DossierEvidence,
  type DossierSection,
} from '@zazie/storage';

export interface DossierJob {
  organizationId: string;
  systemId: string;
  dossierId: string;
  requestId: string;
}

function workerActor(organizationId: string): Actor {
  return {
    id: 'zazie-worker',
    organizationId,
    displayName: 'Zazie worker',
    roles: [],
    systemIds: [],
    allSystems: true,
  };
}

function field(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== 'string')
    throw new Error(`Stored job record requires ${name}`);
  return value;
}

function snapshotRecords(snapshot: Record<string, unknown>): StoredRecord[] {
  if (!Array.isArray(snapshot.records))
    throw new Error('The release snapshot has no record collection');
  return snapshot.records as StoredRecord[];
}

function sectionsFor(
  snapshot: Record<string, unknown>,
  decisions: StoredRecord[],
): DossierSection[] {
  const records = snapshotRecords(snapshot);
  const sections: DossierSection[] = [
    {
      id: 'release-decision',
      title: 'Internal release decision',
      status: decisions.length ? 'provided' : 'unreviewed',
      content: decisions,
      note: decisions.length
        ? 'An internal decision for this exact recorded snapshot.'
        : 'No human release decision was recorded when this dossier was requested.',
    },
  ];
  for (const [kind, title] of [
    ['risks', 'Risk assessment'],
    ['controls', 'Configured controls'],
    ['evaluations', 'Imported evaluation evidence'],
    ['procedures', 'Procedure versions'],
    ['procedure-adoptions', 'Procedure adoptions'],
    ['events', 'Recorded operational events'],
  ]) {
    const content = records.filter((record) => record.kind === kind);
    sections.push({
      id: kind!,
      title: title!,
      status: content.length ? 'provided' : 'missing',
      content,
      note: 'Availability of records does not establish the effectiveness or legal sufficiency of these controls.',
    });
  }
  const pack = snapshot.workflowPack as Record<string, unknown> | undefined;
  if (pack) {
    sections.push({
      id: 'workflow-profile',
      title: 'Workflow profile and legal review status',
      status: pack.status === 'reviewed' ? 'provided' : 'unreviewed',
      content: pack,
    });
    for (const [index, omission] of (
      (pack.omissions as string[] | undefined) ?? []
    ).entries()) {
      sections.push({
        id: `profile-omission-${index + 1}`,
        title: omission,
        status: 'missing',
        note: 'Outside this starter profile; assess separately for this system.',
      });
    }
  }
  return sections;
}

/** Application workers use the same persistence and readiness rules as interactive requests. */
export class WorkerTasks {
  constructor(
    readonly db: Database,
    readonly service: PlatformService,
    readonly storage: ArtifactStore,
    readonly maxDossierBytes = 10 * 1024 * 1024,
  ) {}

  async dossier(
    job: DossierJob,
  ): Promise<{ dossierId: string; sha256: string }> {
    return this.db.transaction(async (tx) => {
      const actor = workerActor(job.organizationId);
      // Serialize export completion with other writes and concurrent job retries.
      await getSystem(tx, job.organizationId, job.systemId, true);
      const dossier = await getRecord(
        tx,
        job.organizationId,
        job.systemId,
        job.dossierId,
        'dossiers',
      );
      if (dossier.data.status === 'completed') {
        await this.storage.get(field(dossier.data, 'storageKey'), {
          expectedSha256: field(dossier.data, 'sha256'),
        });
        return { dossierId: dossier.id, sha256: field(dossier.data, 'sha256') };
      }
      const review = await getRecord(
        tx,
        job.organizationId,
        job.systemId,
        field(dossier.data, 'releaseReviewId'),
        'release-reviews',
      );
      const snapshot = review.data.snapshot as Record<string, unknown>;
      const records = snapshotRecords(snapshot);
      // Freeze the decision set at request time, not at eventual background execution time.
      if (
        !Array.isArray(dossier.data.decisionIds) ||
        dossier.data.decisionIds.some((id) => typeof id !== 'string')
      ) {
        throw new Error('The dossier request must freeze its decision IDs');
      }
      const decisions = await Promise.all(
        (dossier.data.decisionIds as string[]).map((id) =>
          getRecord(tx, job.organizationId, job.systemId, id, 'decisions'),
        ),
      );
      if (decisions.some((decision) => decision.data.reviewId !== review.id))
        throw new Error(
          'A frozen dossier decision belongs to another release review',
        );
      const evidence: DossierEvidence[] = await Promise.all(
        records
          .filter((record) => record.kind === 'artifacts')
          .map(async (record) => {
            const stored = await getRecord(
              tx,
              job.organizationId,
              job.systemId,
              record.id,
              'artifacts',
            );
            const expectedSha256 = field(record.data, 'sha256');
            if (stored.data.sha256 !== expectedSha256)
              throw new Error(
                'Artifact metadata differs from the frozen release snapshot',
              );
            return {
              id: record.id,
              name: field(record.data, 'filename'),
              key: field(stored.data, 'storageKey'),
              sha256: expectedSha256,
            };
          }),
      );
      const archive = await createDossierArchive({
        id: dossier.id,
        createdAt: dossier.createdAt,
        snapshot: {
          reviewId: review.id,
          snapshotDigest: review.data.snapshotDigest,
          snapshot,
          decisions,
        },
        sections: sectionsFor(snapshot, decisions),
        evidence,
        store: this.storage,
        maxTotalBytes: this.maxDossierBytes,
      });
      const receipt = await this.storage.put(
        `${job.organizationId}/${job.systemId}/dossiers/${dossier.id}/${archive.sha256}.zip`,
        archive.bytes,
        { expectedSha256: archive.sha256 },
      );
      const updated = await reviseRecord(
        tx,
        actor,
        dossier,
        {
          ...dossier.data,
          status: 'completed',
          storageKey: receipt.key,
          sha256: receipt.sha256,
          size: receipt.size,
          missing: archive.manifest.omissions,
          errorCode: null,
          completedAt: new Date().toISOString(),
        },
        dossier.revision,
      );
      await audit(
        tx,
        actor,
        job.systemId,
        'dossier.completed',
        dossier.id,
        job.requestId,
        updated.revision,
        {
          sha256: receipt.sha256,
          missingCount: archive.manifest.omissions.length,
        },
      );
      return { dossierId: dossier.id, sha256: receipt.sha256 };
    });
  }

  async recordDossierFailure(
    job: DossierJob,
    attempt: number,
    exhausted: boolean,
  ): Promise<void> {
    if (!Number.isSafeInteger(attempt) || attempt < 1)
      throw new RangeError('A job attempt must be a positive integer');
    await this.db.transaction(async (tx) => {
      const actor = workerActor(job.organizationId);
      await getSystem(tx, job.organizationId, job.systemId, true);
      const dossier = await getRecord(
        tx,
        job.organizationId,
        job.systemId,
        job.dossierId,
        'dossiers',
      );
      // A late failure acknowledgement must never replace a committed export.
      if (dossier.data.status === 'completed') return;
      const attempts =
        typeof dossier.data.attempts === 'number' ? dossier.data.attempts : 0;
      if (
        attempts > attempt ||
        (attempts === attempt &&
          (dossier.data.status === 'failed' || !exhausted))
      )
        return;
      const status = exhausted ? 'failed' : 'retrying';
      const updated = await reviseRecord(
        tx,
        actor,
        dossier,
        {
          ...dossier.data,
          status,
          attempts: attempt,
          errorCode: 'dossier_export_failed',
          lastAttemptAt: new Date().toISOString(),
        },
        dossier.revision,
      );
      await audit(
        tx,
        actor,
        job.systemId,
        `dossier.${status}`,
        dossier.id,
        job.requestId,
        updated.revision,
        { attempts: attempt, exhausted },
      );
    });
  }

  async freshness(
    now = new Date().toISOString(),
  ): Promise<{ findingsCreated: number }> {
    const systems = await rows(
      this.db,
      sql`SELECT id,organization_id FROM systems ORDER BY organization_id,id`,
    );
    let findingsCreated = 0;
    for (const row of systems) {
      const organizationId = String(row.organization_id);
      const systemId = String(row.id);
      findingsCreated += await this.db.transaction(async (tx) => {
        const actor = workerActor(organizationId);
        const system = await getSystem(tx, organizationId, systemId, true);
        const deployments = await listRecords(
          tx,
          organizationId,
          systemId,
          'deployments',
        );
        const findings = await listRecords(
          tx,
          organizationId,
          systemId,
          'findings',
        );
        const openSources = new Set(
          findings
            .filter((finding) => finding.data.resolved !== true)
            .map((finding) => finding.data.source),
        );
        let created = 0;
        for (const deployment of deployments) {
          const context = await this.service.context(
            tx,
            actor,
            systemId,
            field(deployment.data, 'versionId'),
            deployment.id,
            now,
          );
          const readiness = evaluateReadiness(context, 'review');
          for (const blocker of readiness.blockers.filter(
            (item) =>
              item.code === 'evidence_stale' ||
              item.code === 'evidence_unavailable',
          )) {
            const source = `freshness:${deployment.id}:${blocker.subjectId ?? 'system'}:${blocker.code}`;
            if (openSources.has(source)) continue;
            const finding = await insertRecord(
              tx,
              actor,
              systemId,
              'findings',
              {
                title:
                  blocker.code === 'evidence_stale'
                    ? 'Review stale release evidence'
                    : 'Restore unavailable release evidence',
                description: blocker.message,
                ownerId: blocker.ownerId ?? system.data.ownerId,
                severity: 'high',
                blocksRelease: true,
                resolved: false,
                source,
                deploymentId: deployment.id,
                controlId: blocker.subjectId ?? null,
                detectedAt: now,
              },
            );
            await audit(
              tx,
              actor,
              systemId,
              'freshness.finding-created',
              finding.id,
              identifier(),
              finding.revision,
              { source },
            );
            openSources.add(source);
            created += 1;
          }
        }
        if (created > 0) await this.service.bumpEvidence(tx, actor, systemId);
        return created;
      });
    }
    return { findingsCreated };
  }

  async housekeeping(
    now = new Date().toISOString(),
  ): Promise<{ sessions: number; credentials: number }> {
    return this.db.transaction(async (tx) => {
      // Lock policy rows so a concurrent policy change and cleanup cannot use mixed settings.
      const organizations = await rows(
        tx,
        sql`SELECT id,settings FROM organizations ORDER BY id FOR UPDATE`,
      );
      const policies = organizations.map((organization) => ({
        organizationId: String(organization.id),
        policy: retentionPolicyFromSettings(organization.settings),
      }));
      const unaffiliated = await rows(
        tx,
        sql`DELETE FROM sessions s WHERE expires_at <= ${now}::timestamptz AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.id=s.data->>'membershipId') RETURNING s.id`,
      );
      let sessions = unaffiliated.length;
      let credentials = 0;
      for (const { organizationId, policy } of policies) {
        const sessionCutoff = new Date(
          Date.parse(now) - policy.expiredSessions.graceDays * 86_400_000,
        ).toISOString();
        const credentialCutoff = new Date(
          Date.parse(now) -
            policy.inactiveIntegrationCredentials.graceDays * 86_400_000,
        ).toISOString();
        sessions += (
          await rows(
            tx,
            sql`DELETE FROM sessions s USING memberships m WHERE s.data->>'membershipId'=m.id AND m.organization_id=${organizationId} AND s.expires_at<=${sessionCutoff}::timestamptz RETURNING s.id`,
          )
        ).length;
        credentials += (
          await rows(
            tx,
            sql`DELETE FROM credentials WHERE organization_id=${organizationId} AND LEAST(expires_at,COALESCE(revoked_at,expires_at))<=${credentialCutoff}::timestamptz RETURNING id`,
          )
        ).length;
      }
      return { sessions, credentials };
    });
  }
}
