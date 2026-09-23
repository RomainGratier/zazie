import {
  getSystem,
  identifier,
  type Actor,
  type StoredRecord,
} from '@zazie/database';
import { providerStarterPack, procedureTemplates } from '@zazie/workflow-packs';
import type { PlatformService } from '../apps/api/src/service.js';

export type DemoKind = 'cv-filtering' | 'exam-monitoring';
export interface DemoReferences {
  kind: DemoKind;
  systemId: string;
  versionId: string;
  deploymentId: string;
  datasetId: string;
  datasetRevision: number;
  definitionId: string;
  definitionRevision: number;
  artifactId: string;
  controlIds: string[];
  reviewId: string;
  dossierId: string;
  changedVersionId: string;
  changedDeploymentId: string;
}

/** Shared configuration exercises both modalities without adding sector branches to the platform. */
export async function createSyntheticFixture(
  service: PlatformService,
  actor: Actor,
  kind: DemoKind,
  suffix = '',
): Promise<DemoReferences> {
  const exam = kind === 'exam-monitoring';
  const name = exam
    ? 'Synthetic university exam monitoring'
    : 'Synthetic CV filtering';
  const createSystem = await service.createSystem(
    actor,
    {
      name: `${name}${suffix}`,
      intendedUse: exam
        ? 'Produce timestamped suspected-misconduct flags for a trained reviewer. No automatic disciplinary decision; no live surveillance in this demonstration.'
        : 'Support a recruiter reviewing CV evidence against role requirements. No automatic exclusion or hiring decision; all candidate records are synthetic.',
      ownerId: actor.id,
      highRiskCategory: exam
        ? 'Customer-supplied Annex III 3(d) illustration'
        : 'Customer-supplied Annex III 4(a) illustration',
      actorRoles: ['provider'],
      affectedPopulation: exam
        ? 'Fictional students in simulated exam events'
        : 'Fictional applicants in a generated test dataset',
      workflowPackId: providerStarterPack.id,
      workflowPackVersion: providerStarterPack.version,
      synthetic: true,
    },
    identifier(),
    identifier(),
  );
  const systemId = createSystem.id;
  const create = (resource: string, data: unknown) =>
    service.create(actor, systemId, resource, data, identifier(), identifier());
  const version = await create('versions', {
    label: 'synthetic-v1',
    components: {
      model: 'deterministic-fixture-v1',
      prompt: 'sha256:synthetic-prompt-v1',
      code: 'synthetic-code-v1',
    },
    changeSummary: 'Entirely synthetic demonstration; no model was executed.',
  });
  const deployment = await create('deployments', {
    versionId: version.id,
    name: 'Synthetic staging',
    environment: 'simulation',
    context: 'No actual hiring or academic decisions; generated events only.',
    ownerId: actor.id,
  });
  const dataset = await create('datasets', {
    name: exam
      ? 'Generated exam flag events'
      : 'Generated applicant qualification cases',
    version: '1.0',
    provenance:
      'Handwritten synthetic fixture; no personal data or real video.',
    coverage:
      'Illustrative edge cases only; not a representative population or real-system validation.',
    notes:
      'Thresholds and outcomes illustrate software behaviour and are not statutory or empirically validated.',
  });
  const risk = await create('risks', {
    title: exam
      ? 'False misconduct allegation'
      : 'Qualified candidate wrongly excluded',
    harm: exam
      ? 'A false flag could cause unfair disciplinary action.'
      : 'Incorrect extraction could cause loss of a relevant job opportunity.',
    affectedGroups: exam ? 'Fictional students' : 'Fictional applicants',
    foreseeableMisuse:
      'Treating a suggestion as a final decision without checking source evidence.',
    likelihood: 'medium',
    severity: 'high',
    ownerId: actor.id,
    residualRiskDecision: 'accepted',
    rationale:
      'Accepted only for this simulation. No real decisions occur; a qualified assessment and representative evidence are still required for production.',
  });
  const procedures: StoredRecord[] = [];
  for (const template of procedureTemplates) {
    const procedure = await create('procedures', {
      name: `Synthetic ${template.title}`,
      version: template.version,
      ownerId: actor.id,
      content: `${template.purpose}\n\n${template.sections.map((section) => `${section.title}: ${section.instructions}`).join('\n\n')}\n\nSynthetic adoption: the reviewer inspects the generated event, records an intervention, and assigns unresolved issues. No real people or production decisions.`,
    });
    procedures.push(procedure);
    await create('procedure-adoptions', {
      procedureId: procedure.id,
      procedureRevision: procedure.revision,
      ownerId: actor.id,
      scope: 'Synthetic staging only',
      rationale:
        'Reviewed the draft template and its simulation-specific steps. This adoption does not establish legal sufficiency.',
    });
  }
  const definition = await create('evaluation-definitions', {
    name: 'Synthetic quality, oversight and monitoring exercise',
    datasetId: dataset.id,
    criteria: [
      {
        metric: exam ? 'false_flag_rate' : 'qualified_candidate_recall',
        operator: exam ? 'lte' : 'gte',
        threshold: exam ? 0.1 : 0.9,
      },
      { metric: 'reviewer_intervention_success', operator: 'eq', threshold: 1 },
      { metric: 'follow_up_recorded', operator: 'eq', threshold: 1 },
    ],
  });
  const controls: StoredRecord[] = [];
  for (const requirement of providerStarterPack.requirements) {
    controls.push(
      await create('controls', {
        title: `Synthetic: ${requirement.title}`,
        description: `${requirement.interpretation} Simulation uses generated measurements and reviewed procedure exercises only.`,
        ownerId: actor.id,
        requirementIds: [requirement.id],
        riskIds: [risk.id],
        evaluationDefinitionIds: [definition.id],
        procedureIds: procedures.map((procedure) => procedure.id),
        configured: true,
        maxEvidenceAgeDays: 30,
      }),
    );
  }
  const makeReport = async (passing: boolean) => {
    const measurements = {
      [exam ? 'false_flag_rate' : 'qualified_candidate_recall']: exam
        ? passing
          ? 0.05
          : 0.3
        : passing
          ? 0.95
          : 0.4,
      reviewer_intervention_success: 1,
      follow_up_recorded: 1,
    };
    const artifact = await create('artifacts', {
      filename: `synthetic-${passing ? 'passing' : 'failing'}-report.json`,
      contentType: 'application/json',
      provenance:
        'Generated fixture values, not observed model execution. Thresholds are illustrative.',
      contentBase64: Buffer.from(
        JSON.stringify({
          synthetic: true,
          measurements,
          limitations: [
            'No real model was evaluated',
            'No representative population validation',
          ],
        }),
      ).toString('base64'),
    });
    await create('evaluations', {
      versionId: version.id,
      definitionId: definition.id,
      definitionRevision: definition.revision,
      datasetId: dataset.id,
      datasetRevision: dataset.revision,
      measurements,
      artifactIds: [artifact.id],
      producer: 'zazie-synthetic-seed',
      startedAt: new Date(
        Date.now() - (passing ? 2_000 : 20_000),
      ).toISOString(),
      completedAt: new Date(
        Date.now() - (passing ? 1_000 : 10_000),
      ).toISOString(),
    });
    return artifact;
  };
  await makeReport(false);
  const failed = await service.readiness(
    actor,
    systemId,
    version.id,
    deployment.id,
    'review',
  );
  if (!failed.blockers.some((blocker) => blocker.code === 'evaluation_failed'))
    throw new Error('The synthetic failing report did not block release');
  const artifact = await makeReport(true);
  await service.events(
    actor,
    systemId,
    {
      events: [
        {
          schemaVersion: '1.0',
          eventId: `synthetic-${kind}-oversight-1`,
          source: kind,
          type: 'oversight.override_recorded',
          versionId: version.id,
          deploymentId: deployment.id,
          occurredAt: new Date().toISOString(),
          correlationId: 'synthetic-decision-001',
          payload: exam
            ? {
                flagRef: 'synthetic-flag-001',
                timestampSeconds: 42,
                action: 'dismiss_flag',
                rationale:
                  'Generated event depicts a permitted movement, not misconduct.',
              }
            : {
                candidateRef: 'synthetic-candidate-001',
                action: 'advance_to_human_review',
                rationale:
                  'Relevant experience was missed by the generated extraction.',
              },
        },
      ],
    },
    identifier(),
    identifier(),
  );
  const evidenceRevision = (
    await getSystem(service.db, actor.organizationId, systemId)
  ).evidenceRevision;
  for (const control of controls)
    await service.controlReview(
      actor,
      systemId,
      control.id,
      {
        versionId: version.id,
        expectedRevision: control.revision,
        expectedSystemRevision: evidenceRevision,
        rationale:
          'Reviewed synthetic measurements, source artifact and procedure exercises. Demonstration approval only; no claim about a real AI system.',
      },
      identifier(),
      identifier(),
    );
  const review = await create('release-reviews', {
    versionId: version.id,
    deploymentId: deployment.id,
  });
  await service.decision(
    actor,
    systemId,
    review.id,
    {
      decision: 'approve',
      expectedRevision: review.revision,
      rationale:
        'Authorised synthetic staging exercise only. The exact snapshot includes draft legal mappings and illustrative measurements.',
    },
    identifier(),
    identifier(),
  );
  const approved = await service.readiness(
    actor,
    systemId,
    version.id,
    deployment.id,
    'deploy',
  );
  if (!approved.satisfied)
    throw new Error(
      `Synthetic approval failed: ${JSON.stringify(approved.blockers)}`,
    );
  const dossier = await create('dossiers', { releaseReviewId: review.id });
  const changed = await create('versions', {
    label: 'synthetic-v2-new-prompt',
    components: {
      model: 'deterministic-fixture-v1',
      prompt: 'sha256:synthetic-prompt-v2',
      code: 'synthetic-code-v1',
    },
    changeSummary:
      'Changed scoring/flagging instructions require a fresh evidence and release review.',
  });
  const changedDeployment = await create('deployments', {
    versionId: changed.id,
    name: 'Synthetic changed-prompt candidate',
    environment: 'simulation',
    context:
      'Fresh candidate version without approved evidence. Must remain blocked.',
    ownerId: actor.id,
  });
  const changedReadiness = await service.readiness(
    actor,
    systemId,
    changed.id,
    changedDeployment.id,
    'deploy',
  );
  if (
    changedReadiness.satisfied ||
    !changedReadiness.blockers.some(
      (blocker) => blocker.code === 'evaluation_missing',
    )
  )
    throw new Error('Changed prompt incorrectly reused previous approval');
  return {
    kind,
    systemId,
    versionId: version.id,
    deploymentId: deployment.id,
    datasetId: dataset.id,
    datasetRevision: dataset.revision,
    definitionId: definition.id,
    definitionRevision: definition.revision,
    artifactId: artifact.id,
    controlIds: controls.map((control) => control.id),
    reviewId: review.id,
    dossierId: dossier.id,
    changedVersionId: changed.id,
    changedDeploymentId: changedDeployment.id,
  };
}
