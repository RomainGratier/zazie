import type {
  ControlInput,
  DatasetInput,
  EvaluationDefinitionInput,
  EvaluationInput,
  MetricCriterion,
  ProcedureInput,
  RiskInput,
  Role,
} from '@zazie/contracts';

export interface Revision<T> {
  id: string;
  revision: number;
  data: T;
}

export interface HumanReview {
  reviewerId: string;
  reviewedAt: string;
  rationale: string;
  controlRevision: number;
  systemRevision: number;
  versionId: string;
}

export interface ReadinessControl extends Revision<ControlInput> {
  review?: HumanReview;
}
export interface ReadinessProcedure extends Revision<ProcedureInput> {
  adoption?: {
    procedureRevision: number;
    ownerId: string;
    rationale: string;
    scope: string;
  };
}
export interface ReadinessEvaluation extends EvaluationInput {
  id: string;
  receivedAt: string;
}
export interface ReadinessArtifact {
  id: string;
  sha256: string;
  available: boolean;
}
export interface EvidenceReuse {
  evaluationId: string;
  targetVersionId: string;
  reviewerId: string;
  rationale: string;
  systemRevision: number;
  policyDigest: string;
}
export interface ReadinessFinding {
  id: string;
  title: string;
  ownerId: string;
  blocksRelease: boolean;
  resolved: boolean;
}
export interface ReadinessRequirement {
  id: string;
  title: string;
  applicability: 'applicable' | 'not_applicable';
  nonApplicability?: { ownerId: string; rationale: string; scope: string };
}

/** Normalized read model: the persistence adapter supplies records within one system. */
export interface ReadinessContext {
  versionId: string;
  deploymentId: string;
  deploymentVersionId: string;
  systemRevision: number;
  policyDigest: string;
  now: string;
  controls: ReadinessControl[];
  risks: Revision<RiskInput>[];
  definitions: Revision<EvaluationDefinitionInput>[];
  datasets: Revision<DatasetInput>[];
  procedures: ReadinessProcedure[];
  evaluations: ReadinessEvaluation[];
  artifacts: ReadinessArtifact[];
  findings: ReadinessFinding[];
  requirements?: ReadinessRequirement[];
  evidenceReuse?: EvidenceReuse[];
  approval?: {
    decision: 'approve' | 'reject';
    versionId: string;
    deploymentId: string;
    systemRevision: number;
  };
}

export interface Blocker {
  code: string;
  message: string;
  ownerId?: string;
  subjectId?: string;
}
export interface ControlState {
  id: string;
  configuration: 'not_configured' | 'configured';
  operation: 'unknown' | 'observed_working' | 'failing' | 'stale';
  review: 'pending' | 'reviewed' | 'needs_reassessment';
  evaluationIds: string[];
}
export interface ReadinessResult {
  purpose: 'review' | 'deploy';
  satisfied: boolean;
  readyForReview: boolean;
  approvedForDeployment: boolean;
  status: 'blocked' | 'ready_for_review' | 'approved';
  blockers: Blocker[];
  controls: ControlState[];
  scope: string;
}

export interface MetricResult extends MetricCriterion {
  actual: number | null;
  passed: boolean;
}

/** Imported execution is not independently verified; only configured criteria are calculated here. */
export function evaluateMeasurements(
  criteria: MetricCriterion[],
  measurements: Record<string, number>,
): MetricResult[] {
  return criteria.map((criterion) => {
    const supplied = measurements[criterion.metric];
    const actual =
      typeof supplied === 'number' && Number.isFinite(supplied)
        ? supplied
        : null;
    const passed =
      actual !== null &&
      (criterion.operator === 'gte'
        ? actual >= criterion.threshold
        : criterion.operator === 'lte'
          ? actual <= criterion.threshold
          : actual === criterion.threshold);
    return { ...criterion, actual, passed };
  });
}

function nonBlank(value: string | undefined): boolean {
  return Boolean(value?.trim());
}
function validTime(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result))
    throw new Error('Readiness requires valid timestamps');
  return result;
}

/** This is a configured internal release gate, never a legal certification. */
export function evaluateReadiness(
  context: ReadinessContext,
  purpose: 'review' | 'deploy' = 'review',
): ReadinessResult {
  const blockers: Blocker[] = [];
  const controls: ControlState[] = [];
  const now = validTime(context.now);
  const definitions = new Map(
    context.definitions.map((definition) => [definition.id, definition]),
  );
  const datasets = new Map(
    context.datasets.map((dataset) => [dataset.id, dataset]),
  );
  const artifacts = new Map(
    context.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const procedures = new Map(
    context.procedures.map((procedure) => [procedure.id, procedure]),
  );
  const risks = new Map(context.risks.map((risk) => [risk.id, risk]));
  const add = (
    code: string,
    message: string,
    subjectId?: string,
    ownerId?: string,
  ) => {
    blockers.push({
      code,
      message,
      ...(subjectId ? { subjectId } : {}),
      ...(ownerId ? { ownerId } : {}),
    });
  };

  if (context.deploymentVersionId !== context.versionId) {
    add(
      'deployment_version_mismatch',
      'The requested version does not match this deployment.',
      context.deploymentId,
    );
  }
  if (context.controls.length === 0)
    add(
      'controls_missing',
      'Define the release controls and required evidence.',
    );
  if (context.risks.length === 0)
    add(
      'risk_assessment_missing',
      'Record and review the risks for the intended use.',
    );

  for (const requirement of context.requirements ?? []) {
    if (requirement.applicability === 'not_applicable') {
      const decision = requirement.nonApplicability;
      if (
        !decision ||
        !nonBlank(decision.ownerId) ||
        !nonBlank(decision.rationale) ||
        !nonBlank(decision.scope)
      ) {
        add(
          'applicability_unreviewed',
          `Record the responsible person, rationale, and scope for excluding “${requirement.title}”.`,
          requirement.id,
        );
      }
    } else if (
      !context.controls.some((control) =>
        control.data.requirementIds.includes(requirement.id),
      )
    ) {
      add(
        'requirement_uncovered',
        `No control addresses “${requirement.title}”.`,
        requirement.id,
      );
    }
  }

  for (const risk of context.risks) {
    if (
      risk.data.residualRiskDecision !== 'accepted' ||
      !nonBlank(risk.data.rationale)
    ) {
      add(
        'residual_risk_unaccepted',
        `Review and record an acceptable residual-risk decision for “${risk.data.title}”.`,
        risk.id,
        risk.data.ownerId,
      );
    }
    if (
      !context.controls.some((control) =>
        control.data.riskIds.includes(risk.id),
      )
    ) {
      add(
        'risk_control_missing',
        `Link a mitigating control to “${risk.data.title}”.`,
        risk.id,
        risk.data.ownerId,
      );
    }
  }

  for (const control of context.controls) {
    const { data } = control;
    const state: ControlState = {
      id: control.id,
      configuration: data.configured ? 'configured' : 'not_configured',
      operation: 'unknown',
      review: 'pending',
      evaluationIds: [],
    };
    controls.push(state);
    const block = (code: string, message: string) =>
      add(code, `${data.title}: ${message}`, control.id, data.ownerId);
    if (!data.configured)
      block('control_not_configured', 'implement and configure the control.');
    if (data.evaluationDefinitionIds.length === 0)
      block(
        'criteria_missing',
        'define the required evaluation and acceptance criteria.',
      );
    for (const riskId of data.riskIds)
      if (!risks.has(riskId))
        block('linked_risk_missing', `risk ${riskId} is unavailable.`);

    let everyEvaluationWorks = data.evaluationDefinitionIds.length > 0;
    let failed = false;
    let stale = false;
    for (const definitionId of data.evaluationDefinitionIds) {
      const definition = definitions.get(definitionId);
      if (!definition || definition.data.criteria.length === 0) {
        everyEvaluationWorks = false;
        block(
          'evaluation_definition_missing',
          `evaluation definition ${definitionId} is missing or has no criteria.`,
        );
        continue;
      }
      const dataset = definition.data.datasetId
        ? datasets.get(definition.data.datasetId)
        : undefined;
      if (definition.data.datasetId && !dataset) {
        everyEvaluationWorks = false;
        block(
          'dataset_missing',
          `the dataset for “${definition.data.name}” is unavailable.`,
        );
        continue;
      }
      const candidates = context.evaluations
        .filter((evaluation) => {
          if (
            evaluation.definitionId !== definition.id ||
            evaluation.definitionRevision !== definition.revision
          )
            return false;
          if (
            dataset &&
            (evaluation.datasetId !== dataset.id ||
              evaluation.datasetRevision !== dataset.revision)
          )
            return false;
          if (!dataset && evaluation.datasetId !== undefined) return false;
          if (evaluation.versionId === context.versionId) return true;
          return (context.evidenceReuse ?? []).some(
            (reuse) =>
              reuse.evaluationId === evaluation.id &&
              reuse.targetVersionId === context.versionId &&
              reuse.policyDigest === context.policyDigest &&
              nonBlank(reuse.reviewerId) &&
              nonBlank(reuse.rationale),
          );
        })
        .sort(
          (a, b) =>
            validTime(b.completedAt) - validTime(a.completedAt) ||
            validTime(b.receivedAt) - validTime(a.receivedAt) ||
            b.id.localeCompare(a.id),
        );
      const evaluation = candidates[0];
      if (!evaluation) {
        everyEvaluationWorks = false;
        block(
          'evaluation_missing',
          `submit “${definition.data.name}” for this manifest and current criteria/dataset revisions.`,
        );
        continue;
      }
      state.evaluationIds.push(evaluation.id);
      const completedAt = validTime(evaluation.completedAt);
      if (completedAt > now || validTime(evaluation.startedAt) > completedAt) {
        everyEvaluationWorks = false;
        block(
          'evaluation_time_invalid',
          `“${definition.data.name}” has an invalid or future execution time.`,
        );
      } else if (now - completedAt > data.maxEvidenceAgeDays * 86_400_000) {
        everyEvaluationWorks = false;
        stale = true;
        block(
          'evidence_stale',
          `“${definition.data.name}” is older than the configured ${data.maxEvidenceAgeDays}-day evidence window.`,
        );
      }
      const results = evaluateMeasurements(
        definition.data.criteria,
        evaluation.measurements,
      );
      const failures = results.filter((result) => !result.passed);
      if (failures.length > 0) {
        everyEvaluationWorks = false;
        failed = true;
        block(
          'evaluation_failed',
          failures
            .map(
              (result) =>
                `${result.metric}: ${result.actual === null ? 'missing' : result.actual}; requires ${result.operator} ${result.threshold}`,
            )
            .join('; '),
        );
      }
      if (
        evaluation.artifactIds.length === 0 ||
        evaluation.artifactIds.some((id) => !artifacts.get(id)?.available)
      ) {
        everyEvaluationWorks = false;
        block(
          'evidence_unavailable',
          `stored evidence for “${definition.data.name}” is missing or unavailable.`,
        );
      }
    }

    for (const procedureId of data.procedureIds) {
      const procedure = procedures.get(procedureId);
      if (
        !procedure ||
        !procedure.adoption ||
        procedure.adoption.procedureRevision !== procedure.revision ||
        !nonBlank(procedure.adoption.rationale) ||
        !nonBlank(procedure.adoption.ownerId) ||
        !nonBlank(procedure.adoption.scope)
      ) {
        block(
          'procedure_not_adopted',
          `adopt and review the current version of procedure ${procedureId}.`,
        );
      }
    }
    state.operation = failed
      ? 'failing'
      : stale
        ? 'stale'
        : everyEvaluationWorks
          ? 'observed_working'
          : 'unknown';
    const review = control.review;
    if (
      review &&
      review.controlRevision === control.revision &&
      review.systemRevision === context.systemRevision &&
      review.versionId === context.versionId &&
      nonBlank(review.reviewerId) &&
      nonBlank(review.rationale) &&
      validTime(review.reviewedAt) <= now
    ) {
      state.review = 'reviewed';
    } else {
      state.review = review ? 'needs_reassessment' : 'pending';
      block(
        'control_review_required',
        'an authorised reviewer must review the current control, evidence, and candidate version.',
      );
    }
  }

  for (const finding of context.findings) {
    if (finding.blocksRelease && !finding.resolved)
      add('blocking_finding', finding.title, finding.id, finding.ownerId);
  }
  const readyForReview = blockers.length === 0;
  const approval = context.approval;
  const approvedForDeployment =
    readyForReview &&
    approval?.decision === 'approve' &&
    approval.versionId === context.versionId &&
    approval.deploymentId === context.deploymentId &&
    approval.systemRevision === context.systemRevision;
  if (purpose === 'deploy' && !approvedForDeployment) {
    add(
      'release_approval_required',
      'An authorised release approval for this exact manifest, deployment, and evidence revision is required.',
    );
  }
  return {
    purpose,
    satisfied: purpose === 'review' ? readyForReview : approvedForDeployment,
    readyForReview,
    approvedForDeployment,
    status: approvedForDeployment
      ? 'approved'
      : readyForReview
        ? 'ready_for_review'
        : 'blocked',
    blockers,
    controls,
    scope:
      'Configured internal release requirements. Imported evaluation execution is not independently verified. This is not a regulatory certification.',
  };
}

export function mayReview(roles: readonly Role[]): boolean {
  return roles.includes('reviewer');
}

/** Stable JSON for immutable evidence/snapshot digests. Reject values JSON would silently discard. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${Array.from(value, canonicalJson).join(',')}]`;
  if (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical evidence must not contain symbol keys');
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  throw new TypeError(
    'Canonical evidence must contain only finite JSON values',
  );
}
