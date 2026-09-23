import * as c from '@zazie/contracts';
import {
  evaluateMeasurements,
  evaluateReadiness,
  type ReadinessContext,
} from '@zazie/domain';
import {
  type Actor,
  type Connection,
  type Database,
  type Transaction,
  type StoredRecord,
  DomainError,
  authorize,
  audit,
  digest,
  enqueue,
  getRecord,
  getSystem,
  identifier,
  idempotent,
  insertRecord,
  linkRecord,
  listRecords,
  reviseRecord,
  rows,
  sql,
} from '@zazie/database';
import type { ArtifactStore } from '@zazie/storage';
import { providerStarterPack, procedureTemplates } from '@zazie/workflow-packs';
import type { PgBoss } from 'pg-boss';
import {
  evidenceChanging,
  mutableResources,
  overviewKeys,
  resourceSchemas,
} from './resources.js';

type Data = Record<string, unknown>;
const string = (data: Data, key: string): string => {
  if (typeof data[key] !== 'string')
    throw new DomainError('invalid_record', `Missing ${key}`);
  return data[key];
};
export class PlatformService {
  constructor(
    public db: Database,
    public boss: PgBoss,
    public storage: ArtifactStore,
  ) {}
  async systems(actor: Actor) {
    if (actor.actions && !actor.actions.includes('systems:read'))
      throw new DomainError('forbidden', 'Read scope required', 403);
    const items = await rows(
      this.db,
      sql`SELECT id FROM systems WHERE organization_id=${actor.organizationId} ORDER BY created_at,id`,
    );
    return {
      items: await Promise.all(
        items
          .filter(
            (row) =>
              actor.allSystems || actor.systemIds.includes(String(row.id)),
          )
          .map((row) =>
            getSystem(this.db, actor.organizationId, String(row.id)),
          ),
      ),
    };
  }
  async createSystem(
    actor: Actor,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, null, 'systems:write', 'edit');
    if (!actor.allSystems)
      throw new DomainError(
        'forbidden',
        'Creating systems requires organisation-wide editor permission',
        403,
      );
    const data = c.SystemInputSchema.parse(body);
    this.checkPack(data);
    return idempotent(
      this.db,
      actor,
      null,
      'systems.create',
      key,
      data,
      async (tx) => {
        await this.owner(tx, actor, data.ownerId);
        const id = identifier();
        await tx.execute(
          sql`INSERT INTO systems(id,organization_id,data,created_by) VALUES(${id},${actor.organizationId},${JSON.stringify(data)}::jsonb,${actor.id})`,
        );
        await tx.execute(
          sql`INSERT INTO system_revisions(organization_id,system_id,revision,data,created_by) VALUES(${actor.organizationId},${id},1,${JSON.stringify(data)}::jsonb,${actor.id})`,
        );
        await audit(tx, actor, id, 'system.created', id, requestId, 1);
        return getSystem(tx, actor.organizationId, id);
      },
    );
  }
  checkPack(data: c.SystemInput) {
    if (
      data.workflowPackId !== providerStarterPack.id ||
      data.workflowPackVersion !== providerStarterPack.version
    )
      throw new DomainError(
        'unsupported_pack',
        'Select the installed draft workflow pack',
      );
  }
  async updateSystem(
    actor: Actor,
    systemId: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, systemId, 'systems:write', 'edit');
    const input = body as { expectedRevision: number; data: unknown };
    const data = c.SystemInputSchema.parse(input?.data);
    this.checkPack(data);
    return idempotent(
      this.db,
      actor,
      systemId,
      'system.update',
      key,
      body,
      async (tx) => {
        const system = await getSystem(tx, actor.organizationId, systemId);
        if (input.expectedRevision !== system.revision)
          throw new DomainError(
            'revision_conflict',
            'System changed; reload before saving',
            409,
          );
        await this.owner(tx, actor, data.ownerId, systemId);
        await tx.execute(
          sql`UPDATE systems SET data=${JSON.stringify(data)}::jsonb,revision=revision+1,evidence_revision=evidence_revision+1 WHERE id=${systemId} AND organization_id=${actor.organizationId}`,
        );
        await tx.execute(
          sql`INSERT INTO system_revisions(organization_id,system_id,revision,data,created_by) VALUES(${actor.organizationId},${systemId},${system.revision + 1},${JSON.stringify(data)}::jsonb,${actor.id})`,
        );
        await this.impact(
          tx,
          actor,
          systemId,
          requestId,
          'Intended use or applicability changed',
        );
        await audit(
          tx,
          actor,
          systemId,
          'system.updated',
          systemId,
          requestId,
          system.revision + 1,
        );
        return getSystem(tx, actor.organizationId, systemId);
      },
    );
  }
  async owner(
    tx: Connection,
    actor: Actor,
    ownerId: string,
    systemId?: string,
  ) {
    const [membership] = await rows(
      tx,
      sql`SELECT * FROM memberships WHERE id=${ownerId} AND organization_id=${actor.organizationId} AND active=true`,
    );
    if (
      !membership ||
      (systemId &&
        !membership.all_systems &&
        !(membership.system_ids as string[]).includes(systemId))
    )
      throw new DomainError(
        'owner_unavailable',
        'The responsible person needs membership and access to this system',
      );
  }
  async overview(actor: Actor, systemId: string) {
    authorize(actor, systemId, 'systems:read');
    const system = await getSystem(this.db, actor.organizationId, systemId);
    this.checkPack(c.SystemInputSchema.parse(system.data));
    const records = await listRecords(this.db, actor.organizationId, systemId);
    const result: Data = {
      system,
      workflowPack: providerStarterPack,
      procedureTemplates,
    };
    for (const kind of [
      ...Object.keys(resourceSchemas),
      'events',
      'control-reviews',
      'decisions',
      'finding-resolutions',
    ])
      result[overviewKeys[kind] ?? kind] = records
        .filter((r) => r.kind === kind)
        .map((r) => this.publicRecord(r));
    return result;
  }
  publicRecord(record: StoredRecord): StoredRecord {
    const { storageKey: _, ...data } = record.data;
    return { ...record, data };
  }
  async create(
    actor: Actor,
    systemId: string,
    kind: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    const schema = resourceSchemas[kind];
    if (!schema) throw new DomainError('not_found', 'Unknown resource', 404);
    authorize(
      actor,
      systemId,
      `${kind}:write`,
      ['evidence-reuse', 'applicability-decisions'].includes(kind)
        ? 'review'
        : 'edit',
    );
    const parsed = schema.parse(body) as Data;
    return idempotent(
      this.db,
      actor,
      systemId,
      `${kind}.create`,
      key,
      parsed,
      async (tx) => {
        let data: Data = { ...parsed };
        const linked = await this.references(tx, actor, systemId, kind, data);
        if (typeof data.ownerId === 'string')
          await this.owner(tx, actor, data.ownerId, systemId);
        if (kind === 'controls') {
          const valid = new Set(
            providerStarterPack.requirements.map((r) => r.id),
          );
          if ((data.requirementIds as string[]).some((id) => !valid.has(id)))
            throw new DomainError(
              'unknown_requirement',
              'Control refers to an unknown requirement',
            );
        }
        if (kind === 'versions')
          data = { ...data, manifestDigest: digest(parsed) };
        if (kind === 'evaluations') {
          const definition = linked.find(
            (r) => r.kind === 'evaluation-definitions',
          )!;
          const results = evaluateMeasurements(
            (definition.data as unknown as c.EvaluationDefinitionInput)
              .criteria,
            data.measurements as Record<string, number>,
          );
          data = {
            ...data,
            results,
            executionVerification: 'imported_unverified',
            manifestDigest: linked.find((r) => r.kind === 'versions')!.data
              .manifestDigest,
          };
        }
        if (kind === 'artifacts') {
          const bytes = Buffer.from(string(data, 'contentBase64'), 'base64');
          const receipt = await this.storage.put(
            `${actor.organizationId}/${systemId}/${identifier()}`,
            bytes,
          );
          const { contentBase64: _, ...metadata } = data;
          data = {
            ...metadata,
            storageKey: receipt.key,
            sha256: receipt.sha256,
            size: receipt.size,
            availability: 'available',
          };
        }
        if (kind === 'release-reviews') {
          const context = await this.context(
            tx,
            actor,
            systemId,
            string(data, 'versionId'),
            string(data, 'deploymentId'),
          );
          const readiness = evaluateReadiness(context, 'review');
          if (!readiness.satisfied)
            throw new DomainError(
              'release_blocked',
              'Resolve release blockers before requesting review',
              409,
              readiness,
            );
          const system = await getSystem(tx, actor.organizationId, systemId);
          const records = await listRecords(tx, actor.organizationId, systemId);
          const snapshot = {
            schemaVersion: '1.0',
            system,
            workflowPack: providerStarterPack,
            versionId: data.versionId,
            deploymentId: data.deploymentId,
            evidenceRevision: system.evidenceRevision,
            records: records
              .filter(
                (r) =>
                  !['release-reviews', 'decisions', 'dossiers'].includes(
                    r.kind,
                  ),
              )
              .map((r) => this.publicRecord(r)),
            readiness,
          };
          data = {
            ...data,
            snapshot,
            snapshotDigest: digest(snapshot),
            evidenceRevision: system.evidenceRevision,
            status: 'pending',
          };
        }
        if (kind === 'evidence-reuse') {
          const system = await getSystem(tx, actor.organizationId, systemId);
          if (data.expectedSystemRevision !== system.evidenceRevision)
            throw new DomainError(
              'revision_conflict',
              'Evidence changed; review it again',
              409,
            );
          data = {
            ...data,
            reviewerId: actor.id,
            reviewerRoles: actor.roles,
            systemRevision: system.evidenceRevision + 1,
            policyDigest: this.policyDigest(
              system.data,
              await listRecords(tx, actor.organizationId, systemId),
            ),
          };
        }
        if (kind === 'applicability-decisions') {
          const system = await getSystem(tx, actor.organizationId, systemId);
          if (data.expectedSystemRevision !== system.evidenceRevision)
            throw new DomainError(
              'revision_conflict',
              'Applicability or evidence changed; review again',
              409,
            );
          if (
            !providerStarterPack.requirements.some(
              (r) => r.id === data.requirementId,
            )
          )
            throw new DomainError(
              'unknown_requirement',
              'This requirement is not part of the selected profile',
            );
          data = {
            ...data,
            reviewerId: actor.id,
            reviewerRoles: actor.roles,
            reviewedAt: new Date().toISOString(),
            packId: providerStarterPack.id,
            packVersion: providerStarterPack.version,
          };
        }
        if (kind === 'findings') data = { ...data, resolved: false };
        if (kind === 'dossiers')
          data = {
            ...data,
            status: 'queued',
            decisionIds: (
              await listRecords(tx, actor.organizationId, systemId, 'decisions')
            )
              .filter((r) => r.data.reviewId === data.releaseReviewId)
              .map((r) => r.id),
          };
        const created = await insertRecord(tx, actor, systemId, kind, data);
        for (const target of linked)
          await linkRecord(tx, created, target, target.kind);
        if (evidenceChanging.has(kind))
          await this.bumpEvidence(tx, actor, systemId);
        await audit(
          tx,
          actor,
          systemId,
          `${kind}.created`,
          created.id,
          requestId,
          1,
        );
        if (kind === 'dossiers')
          await enqueue(
            this.boss,
            tx,
            'dossier',
            {
              organizationId: actor.organizationId,
              systemId,
              dossierId: created.id,
              requestId,
            },
            created.id,
          );
        return this.publicRecord(created);
      },
    );
  }
  async update(
    actor: Actor,
    systemId: string,
    kind: string,
    id: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, systemId, `${kind}:write`, 'edit');
    if (!mutableResources.has(kind))
      throw new DomainError(
        'immutable_record',
        'This record is immutable',
        405,
      );
    const input = body as { expectedRevision: number; data: unknown };
    const data = resourceSchemas[kind]!.parse(input?.data) as Data;
    return idempotent(
      this.db,
      actor,
      systemId,
      `${kind}.${id}.update`,
      key,
      body,
      async (tx) => {
        const existing = await getRecord(
          tx,
          actor.organizationId,
          systemId,
          id,
          kind,
        );
        const links = await this.references(tx, actor, systemId, kind, data);
        if (typeof data.ownerId === 'string')
          await this.owner(tx, actor, data.ownerId, systemId);
        const updated = await reviseRecord(
          tx,
          actor,
          existing,
          data,
          input.expectedRevision,
        );
        for (const target of links)
          await linkRecord(tx, updated, target, target.kind);
        await this.bumpEvidence(tx, actor, systemId);
        await this.impact(
          tx,
          actor,
          systemId,
          requestId,
          `${kind} changed; assess the impact on approved releases`,
        );
        await audit(
          tx,
          actor,
          systemId,
          `${kind}.updated`,
          id,
          requestId,
          updated.revision,
        );
        return updated;
      },
    );
  }
  async references(
    tx: Connection,
    actor: Actor,
    systemId: string,
    kind: string,
    data: Data,
  ): Promise<StoredRecord[]> {
    const linked: StoredRecord[] = [];
    const add = async (id: unknown, targetKind: string, revision?: unknown) => {
      if (typeof id !== 'string') return;
      const target = await getRecord(
        tx,
        actor.organizationId,
        systemId,
        id,
        targetKind,
      );
      if (revision !== undefined && target.revision !== revision)
        throw new DomainError(
          'revision_conflict',
          `${targetKind} revision does not match the current record`,
          409,
        );
      linked.push(target);
      return target;
    };
    for (const [field, target] of [
      ['versionId', 'versions'],
      ['targetVersionId', 'versions'],
      ['deploymentId', 'deployments'],
      ['datasetId', 'datasets'],
      ['definitionId', 'evaluation-definitions'],
      ['procedureId', 'procedures'],
      ['releaseReviewId', 'release-reviews'],
      ['evaluationId', 'evaluations'],
    ] as const) {
      await add(
        data[field],
        target,
        field === 'datasetId'
          ? data.datasetRevision
          : field === 'definitionId'
            ? data.definitionRevision
            : field === 'procedureId'
              ? data.procedureRevision
              : undefined,
      );
    }
    for (const [field, target] of [
      ['artifactIds', 'artifacts'],
      ['riskIds', 'risks'],
      ['evaluationDefinitionIds', 'evaluation-definitions'],
      ['procedureIds', 'procedures'],
      ['versionIds', 'versions'],
      ['deploymentIds', 'deployments'],
    ] as const)
      for (const id of (data[field] as string[] | undefined) ?? [])
        await add(id, target);
    if (
      data.versionId &&
      data.deploymentId &&
      linked.find((r) => r.kind === 'deployments')?.data.versionId !==
        data.versionId
    )
      throw new DomainError(
        'deployment_version_mismatch',
        'Deployment does not use the submitted version',
      );
    if (kind === 'evaluations') {
      const def = linked.find((r) => r.kind === 'evaluation-definitions')!;
      if (def.data.datasetId !== data.datasetId)
        throw new DomainError(
          'dataset_mismatch',
          'Evaluation dataset must match the definition',
        );
      if (Date.parse(String(data.completedAt)) > Date.now())
        throw new DomainError(
          'future_evaluation',
          'Evaluation completion is in the future',
        );
      for (const artifact of linked.filter((r) => r.kind === 'artifacts'))
        await this.storage.get(string(artifact.data, 'storageKey'), {
          expectedSha256: string(artifact.data, 'sha256'),
        });
    }
    return linked;
  }
  async bumpEvidence(tx: Transaction, actor: Actor, systemId: string) {
    await tx.execute(
      sql`UPDATE systems SET evidence_revision=evidence_revision+1 WHERE organization_id=${actor.organizationId} AND id=${systemId}`,
    );
  }
  async impact(
    tx: Transaction,
    actor: Actor,
    systemId: string,
    requestId: string,
    title: string,
  ) {
    const records = await listRecords(
      tx,
      actor.organizationId,
      systemId,
      'decisions',
    );
    if (!records.some((r) => r.data.decision === 'approve')) return;
    const system = await getSystem(tx, actor.organizationId, systemId);
    const finding = await insertRecord(tx, actor, systemId, 'findings', {
      title,
      description:
        'Review changed policy and evidence, record corrective evidence, resolve this finding, then request a fresh release review.',
      ownerId: system.data.ownerId,
      severity: 'high',
      blocksRelease: true,
      resolved: false,
      source: 'impact-review',
    });
    await audit(
      tx,
      actor,
      systemId,
      'impact-review.required',
      finding.id,
      requestId,
    );
  }
  async controlReview(
    actor: Actor,
    systemId: string,
    controlId: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, systemId, 'controls:review', 'review');
    const data = c.ControlReviewInputSchema.parse(
      body,
    ) as c.ControlReviewInput & { versionId: string };
    return idempotent(
      this.db,
      actor,
      systemId,
      `controls.${controlId}.review`,
      key,
      data,
      async (tx) => {
        const control = await getRecord(
          tx,
          actor.organizationId,
          systemId,
          controlId,
          'controls',
        );
        const version = await getRecord(
          tx,
          actor.organizationId,
          systemId,
          data.versionId,
          'versions',
        );
        if (control.revision !== data.expectedRevision)
          throw new DomainError(
            'revision_conflict',
            'Control changed; reload before review',
            409,
          );
        const system = await getSystem(tx, actor.organizationId, systemId);
        if (data.expectedSystemRevision !== system.evidenceRevision)
          throw new DomainError(
            'revision_conflict',
            'Evidence or policy changed since it was loaded; inspect the current evidence before reviewing',
            409,
          );
        const reviewed = await insertRecord(
          tx,
          actor,
          systemId,
          'control-reviews',
          {
            controlId,
            controlRevision: control.revision,
            systemRevision: system.evidenceRevision,
            versionId: version.id,
            reviewerId: actor.id,
            reviewerRoles: actor.roles,
            reviewedAt: new Date().toISOString(),
            rationale: data.rationale,
          },
        );
        await linkRecord(tx, reviewed, control, 'control');
        await linkRecord(tx, reviewed, version, 'version');
        await audit(
          tx,
          actor,
          systemId,
          'control.reviewed',
          reviewed.id,
          requestId,
        );
        return reviewed;
      },
    );
  }
  async decision(
    actor: Actor,
    systemId: string,
    reviewId: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, systemId, 'releases:review', 'review');
    const data = c.ReviewDecisionInputSchema.parse(body);
    return idempotent(
      this.db,
      actor,
      systemId,
      `review.${reviewId}.decision`,
      key,
      data,
      async (tx) => {
        const review = await getRecord(
          tx,
          actor.organizationId,
          systemId,
          reviewId,
          'release-reviews',
        );
        const system = await getSystem(tx, actor.organizationId, systemId);
        if (
          review.revision !== data.expectedRevision ||
          review.data.evidenceRevision !== system.evidenceRevision
        )
          throw new DomainError(
            'revision_conflict',
            'The evidence or policy changed after this snapshot; request a new review',
            409,
          );
        const decisions = await listRecords(
          tx,
          actor.organizationId,
          systemId,
          'decisions',
        );
        if (decisions.some((r) => r.data.reviewId === reviewId))
          throw new DomainError(
            'review_decided',
            'This review already has a decision',
            409,
          );
        if (data.decision === 'approve') {
          const readiness = evaluateReadiness(
            await this.context(
              tx,
              actor,
              systemId,
              string(review.data, 'versionId'),
              string(review.data, 'deploymentId'),
            ),
            'review',
          );
          if (!readiness.satisfied)
            throw new DomainError(
              'release_blocked',
              'Current evidence no longer meets release requirements',
              409,
              readiness,
            );
        }
        const decision = await insertRecord(tx, actor, systemId, 'decisions', {
          ...data,
          reviewId,
          snapshotDigest: review.data.snapshotDigest,
          versionId: review.data.versionId,
          deploymentId: review.data.deploymentId,
          systemRevision: system.evidenceRevision,
          reviewerId: actor.id,
          reviewerRoles: actor.roles,
          decidedAt: new Date().toISOString(),
        });
        await linkRecord(tx, decision, review, 'snapshot');
        await audit(
          tx,
          actor,
          systemId,
          `release.${data.decision}`,
          decision.id,
          requestId,
        );
        return decision;
      },
    );
  }
  async resolveFinding(
    actor: Actor,
    systemId: string,
    id: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, systemId, 'findings:resolve', 'review');
    const data = c.FindingResolutionInputSchema.parse(body);
    return idempotent(
      this.db,
      actor,
      systemId,
      `finding.${id}.resolve`,
      key,
      data,
      async (tx) => {
        const finding = await getRecord(
          tx,
          actor.organizationId,
          systemId,
          id,
          'findings',
        );
        const links = await this.references(
          tx,
          actor,
          systemId,
          'finding-resolutions',
          data,
        );
        for (const artifact of links) {
          await this.storage.get(string(artifact.data, 'storageKey'), {
            expectedSha256: string(artifact.data, 'sha256'),
          });
        }
        const updated = await reviseRecord(
          tx,
          actor,
          finding,
          {
            ...finding.data,
            resolved: true,
            resolution: data.rationale,
            resolvedBy: actor.id,
          },
          data.expectedRevision,
        );
        const resolution = await insertRecord(
          tx,
          actor,
          systemId,
          'finding-resolutions',
          {
            ...data,
            findingId: id,
            reviewerId: actor.id,
            reviewerRoles: actor.roles,
          },
        );
        for (const target of links)
          await linkRecord(tx, resolution, target, 'resolution-evidence');
        await linkRecord(tx, resolution, updated, 'finding');
        await this.bumpEvidence(tx, actor, systemId);
        await audit(
          tx,
          actor,
          systemId,
          'finding.resolved',
          id,
          requestId,
          updated.revision,
        );
        return updated;
      },
    );
  }
  async events(
    actor: Actor,
    systemId: string,
    body: unknown,
    key: string,
    requestId: string,
  ) {
    authorize(actor, systemId, 'events:write', 'edit');
    const data = c.EventBatchInputSchema.parse(body);
    return idempotent(
      this.db,
      actor,
      systemId,
      'events.batch',
      key,
      data,
      async (tx) => {
        const items: StoredRecord[] = [];
        for (const event of data.events) {
          const fingerprint = digest(event);
          const [previous] = await rows(
            tx,
            sql`SELECT * FROM event_receipts WHERE organization_id=${actor.organizationId} AND system_id=${systemId} AND source=${event.source} AND event_id=${event.eventId}`,
          );
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              throw new DomainError(
                'event_conflict',
                'Source event ID already has different content',
                409,
              );
            items.push(
              await getRecord(
                tx,
                actor.organizationId,
                systemId,
                String(previous.record_id),
                'events',
              ),
            );
            continue;
          }
          const links = await this.references(
            tx,
            actor,
            systemId,
            'events',
            event,
          );
          const created = await insertRecord(tx, actor, systemId, 'events', {
            ...event,
            receivedAt: new Date().toISOString(),
          });
          for (const target of links)
            await linkRecord(tx, created, target, target.kind);
          await tx.execute(
            sql`INSERT INTO event_receipts(organization_id,system_id,source,event_id,fingerprint,record_id) VALUES(${actor.organizationId},${systemId},${event.source},${event.eventId},${fingerprint},${created.id})`,
          );
          await audit(
            tx,
            actor,
            systemId,
            'event.received',
            created.id,
            requestId,
          );
          items.push(created);
        }
        return { items };
      },
    );
  }
  async readiness(
    actor: Actor,
    systemId: string,
    versionId: string,
    deploymentId: string,
    purpose: 'review' | 'deploy',
  ) {
    authorize(actor, systemId, 'releases:read');
    return this.db.transaction(async (tx) => {
      await getSystem(tx, actor.organizationId, systemId, true);
      return evaluateReadiness(
        await this.context(tx, actor, systemId, versionId, deploymentId),
        purpose,
      );
    });
  }
  /** Reuse remains valid across evidence collection, but not changes to its assessed policies. */
  policyDigest(systemData: Data, records: StoredRecord[]): string {
    const policyKinds = new Set([
      'risks',
      'controls',
      'evaluation-definitions',
      'datasets',
      'procedures',
      'procedure-adoptions',
      'applicability-decisions',
    ]);
    return digest({
      system: systemData,
      policies: records
        .filter((record) => policyKinds.has(record.kind))
        .map((record) => ({
          id: record.id,
          kind: record.kind,
          revision: record.revision,
          data: record.data,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  async context(
    tx: Connection,
    actor: Actor,
    systemId: string,
    versionId: string,
    deploymentId: string,
    now = new Date().toISOString(),
  ): Promise<ReadinessContext> {
    const system = await getSystem(tx, actor.organizationId, systemId);
    this.checkPack(c.SystemInputSchema.parse(system.data));
    const version = await getRecord(
      tx,
      actor.organizationId,
      systemId,
      versionId,
      'versions',
    );
    const deployment = await getRecord(
      tx,
      actor.organizationId,
      systemId,
      deploymentId,
      'deployments',
    );
    const records = await listRecords(tx, actor.organizationId, systemId);
    const of = <T>(kind: string) =>
      records.filter((r) => r.kind === kind) as unknown as Array<{
        id: string;
        revision: number;
        createdAt: string;
        data: T;
      }>;
    const latest = (kind: string, predicate: (data: Data) => boolean) =>
      records.filter((r) => r.kind === kind && predicate(r.data)).at(-1)?.data;
    const controls = of<c.ControlInput>('controls').map((r) => ({
      ...r,
      ...(latest(
        'control-reviews',
        (d) => d.controlId === r.id && d.versionId === versionId,
      )
        ? {
            review: latest(
              'control-reviews',
              (d) => d.controlId === r.id && d.versionId === versionId,
            ) as unknown as NonNullable<
              ReadinessContext['controls'][number]['review']
            >,
          }
        : {}),
    }));
    const procedures = of<c.ProcedureInput>('procedures').map((r) => ({
      ...r,
      ...(latest('procedure-adoptions', (d) => d.procedureId === r.id)
        ? {
            adoption: latest(
              'procedure-adoptions',
              (d) => d.procedureId === r.id,
            ) as unknown as NonNullable<
              ReadinessContext['procedures'][number]['adoption']
            >,
          }
        : {}),
    }));
    const artifactRecords = of<Data>('artifacts');
    const artifacts: ReadinessContext['artifacts'] = [];
    // Storage adapters verify full contents. Bound simultaneous reads and retain
    // only metadata so a long evidence history cannot load every file at once.
    const artifactReadConcurrency = 4;
    for (
      let offset = 0;
      offset < artifactRecords.length;
      offset += artifactReadConcurrency
    ) {
      artifacts.push(
        ...(await Promise.all(
          artifactRecords
            .slice(offset, offset + artifactReadConcurrency)
            .map(async (r) => {
              let available = false;
              try {
                await this.storage.get(string(r.data, 'storageKey'), {
                  expectedSha256: string(r.data, 'sha256'),
                });
                available = true;
              } catch {
                /* A failed integrity/availability check is a release blocker. */
              }
              return { id: r.id, sha256: String(r.data.sha256), available };
            }),
        )),
      );
    }
    const approval = latest(
      'decisions',
      (d) => d.versionId === versionId && d.deploymentId === deploymentId,
    );
    return {
      versionId: version.id,
      deploymentId,
      deploymentVersionId: String(deployment.data.versionId),
      systemRevision: system.evidenceRevision,
      policyDigest: this.policyDigest(system.data, records),
      now,
      controls,
      procedures,
      risks: of<c.RiskInput>('risks'),
      definitions: of<c.EvaluationDefinitionInput>('evaluation-definitions'),
      datasets: of<c.DatasetInput>('datasets'),
      evaluations: of<c.EvaluationInput>('evaluations').map((r) => ({
        ...r.data,
        id: r.id,
        receivedAt: r.createdAt,
      })),
      artifacts,
      findings: of<Data>('findings').map((r) => ({
        id: r.id,
        title: String(r.data.title),
        ownerId: String(r.data.ownerId),
        blocksRelease: r.data.blocksRelease === true,
        resolved: r.data.resolved === true,
      })),
      requirements: providerStarterPack.requirements.map((r) => {
        const decision = latest(
          'applicability-decisions',
          (d) => d.requirementId === r.id,
        );
        return {
          id: r.id,
          title: r.title,
          applicability:
            decision?.applicability === 'not_applicable'
              ? ('not_applicable' as const)
              : ('applicable' as const),
          ...(decision?.applicability === 'not_applicable'
            ? {
                nonApplicability: {
                  ownerId: String(decision.ownerId),
                  rationale: String(decision.rationale),
                  scope: String(decision.scope),
                },
              }
            : {}),
        };
      }),
      evidenceReuse: of<
        ReadinessContext['evidenceReuse'] extends Array<infer T> | undefined
          ? T
          : never
      >('evidence-reuse').map((r) => r.data),
      ...(approval
        ? {
            approval: approval as unknown as NonNullable<
              ReadinessContext['approval']
            >,
          }
        : {}),
    };
  }
}
