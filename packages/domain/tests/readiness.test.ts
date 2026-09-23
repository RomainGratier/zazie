import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  evaluateMeasurements,
  evaluateReadiness,
  mayReview,
  type ReadinessContext,
} from '../src/index.js';

function fixture(): ReadinessContext {
  return {
    versionId: 'version-a',
    deploymentId: 'staging',
    deploymentVersionId: 'version-a',
    systemRevision: 8,
    policyDigest: 'policy-v1',
    now: '2026-09-23T12:00:00Z',
    controls: [
      {
        id: 'control-1',
        revision: 1,
        data: {
          title: 'Recall control',
          description: 'Measure incorrect exclusions',
          ownerId: 'owner-1',
          requirementIds: ['test-requirement'],
          riskIds: ['risk-1'],
          evaluationDefinitionIds: ['definition-1'],
          procedureIds: ['procedure-1'],
          configured: true,
          maxEvidenceAgeDays: 30,
        },
        review: {
          reviewerId: 'reviewer-1',
          reviewedAt: '2026-09-23T11:00:00Z',
          rationale: 'Reviewed source evidence',
          controlRevision: 1,
          systemRevision: 8,
          versionId: 'version-a',
        },
      },
    ],
    risks: [
      {
        id: 'risk-1',
        revision: 1,
        data: {
          title: 'Wrong exclusion',
          harm: 'Lost opportunity',
          affectedGroups: 'Applicants',
          foreseeableMisuse: '',
          likelihood: 'medium',
          severity: 'high',
          ownerId: 'owner-1',
          residualRiskDecision: 'accepted',
          rationale: 'Synthetic test decision with manual review safeguard',
        },
      },
    ],
    definitions: [
      {
        id: 'definition-1',
        revision: 1,
        data: {
          name: 'False exclusions',
          criteria: [{ metric: 'recall', operator: 'gte', threshold: 0.9 }],
          datasetId: 'dataset-1',
        },
      },
    ],
    datasets: [
      {
        id: 'dataset-1',
        revision: 1,
        data: {
          name: 'Synthetic applicants',
          version: '1',
          provenance: 'Entirely synthetic',
          coverage: 'Illustrative test only',
          notes: '',
        },
      },
    ],
    procedures: [
      {
        id: 'procedure-1',
        revision: 1,
        data: {
          name: 'Oversight',
          version: '1',
          ownerId: 'owner-1',
          content: 'A reviewer investigates contested outcomes.',
        },
        adoption: {
          procedureRevision: 1,
          ownerId: 'owner-1',
          rationale: 'Reviewed for pilot',
          scope: 'Synthetic staging',
        },
      },
    ],
    evaluations: [
      {
        id: 'run-1',
        versionId: 'version-a',
        definitionId: 'definition-1',
        definitionRevision: 1,
        datasetId: 'dataset-1',
        datasetRevision: 1,
        measurements: { recall: 0.95 },
        artifactIds: ['artifact-1'],
        producer: 'synthetic-ci',
        startedAt: '2026-09-23T09:00:00Z',
        completedAt: '2026-09-23T10:00:00Z',
        receivedAt: '2026-09-23T10:01:00Z',
      },
    ],
    artifacts: [{ id: 'artifact-1', sha256: 'a'.repeat(64), available: true }],
    findings: [],
    requirements: [
      {
        id: 'test-requirement',
        title: 'Configured testing requirement',
        applicability: 'applicable',
      },
    ],
  };
}
function codes(context: ReadinessContext) {
  return evaluateReadiness(context).blockers.map((blocker) => blocker.code);
}

describe('release readiness and immutable evidence scope', () => {
  it('distinguishes ready for human release review from approved for deployment', () => {
    const context = fixture();
    expect(evaluateReadiness(context)).toMatchObject({
      satisfied: true,
      readyForReview: true,
      approvedForDeployment: false,
      status: 'ready_for_review',
    });
    expect(evaluateReadiness(context, 'deploy')).toMatchObject({
      satisfied: false,
      readyForReview: true,
      approvedForDeployment: false,
    });
    context.approval = {
      decision: 'approve',
      versionId: 'version-a',
      deploymentId: 'staging',
      systemRevision: 8,
    };
    expect(evaluateReadiness(context, 'deploy').satisfied).toBe(true);
    context.approval.deploymentId = 'production';
    expect(evaluateReadiness(context, 'deploy').satisfied).toBe(false);
  });

  it('cannot use a previous manifest or old criterion/dataset revision without current evidence', () => {
    const context = fixture();
    context.versionId = 'version-b';
    context.deploymentVersionId = 'version-b';
    expect(codes(context)).toContain('evaluation_missing');
    context.versionId = 'version-a';
    context.deploymentVersionId = 'version-a';
    context.definitions[0]!.revision = 2;
    expect(codes(context)).toContain('evaluation_missing');
    context.definitions[0]!.revision = 1;
    context.datasets[0]!.revision = 2;
    expect(codes(context)).toContain('evaluation_missing');
  });

  it('permits explicitly reviewed evidence reuse but still requires new control and release review', () => {
    const context = fixture();
    context.versionId = 'version-b';
    context.deploymentVersionId = 'version-b';
    context.evidenceReuse = [
      {
        evaluationId: 'run-1',
        targetVersionId: 'version-b',
        reviewerId: 'reviewer-1',
        rationale: 'Impact assessment: documentation-only change',
        systemRevision: 8,
        policyDigest: 'policy-v1',
      },
    ];
    expect(codes(context)).not.toContain('evaluation_missing');
    expect(codes(context)).toContain('control_review_required');
    expect(evaluateReadiness(context, 'deploy').satisfied).toBe(false);
    context.evidenceReuse[0]!.policyDigest = 'old-policy';
    expect(codes(context)).toContain('evaluation_missing');
  });

  it('recalculates measurements, detects omitted metrics, and selects the latest run even when it fails', () => {
    const context = fixture();
    context.evaluations.push({
      ...context.evaluations[0]!,
      id: 'run-2',
      measurements: { recall: 0.4 },
      completedAt: '2026-09-23T11:00:00Z',
    });
    expect(codes(context)).toContain('evaluation_failed');
    expect(evaluateReadiness(context).controls[0]?.operation).toBe('failing');
    context.evaluations[1]!.measurements = {};
    expect(codes(context)).toContain('evaluation_failed');
  });

  it('keeps multiple assessed reuse decisions valid across evidence writes, but invalidates them when policy changes', () => {
    const context = fixture();
    context.versionId = 'version-b';
    context.deploymentVersionId = 'version-b';
    context.systemRevision = 12;
    context.definitions.push({
      ...context.definitions[0]!,
      id: 'definition-2',
      data: {
        ...context.definitions[0]!.data,
        name: 'Independent second test',
      },
    });
    context.controls[0]!.data.evaluationDefinitionIds.push('definition-2');
    context.evaluations.push({
      ...context.evaluations[0]!,
      id: 'run-2',
      definitionId: 'definition-2',
    });
    context.evidenceReuse = [
      {
        evaluationId: 'run-1',
        targetVersionId: 'version-b',
        reviewerId: 'reviewer-1',
        rationale: 'Assessed first test dependencies',
        systemRevision: 9,
        policyDigest: 'policy-v1',
      },
      {
        evaluationId: 'run-2',
        targetVersionId: 'version-b',
        reviewerId: 'reviewer-1',
        rationale: 'Assessed second test dependencies',
        systemRevision: 10,
        policyDigest: 'policy-v1',
      },
    ];
    expect(evaluateReadiness(context).controls[0]!.evaluationIds).toEqual([
      'run-1',
      'run-2',
    ]);
    expect(codes(context)).not.toContain('evaluation_missing');
    expect(codes(context)).toContain('control_review_required');
    context.policyDigest = 'policy-v2';
    expect(evaluateReadiness(context).controls[0]!.evaluationIds).toEqual([]);
    expect(codes(context)).toContain('evaluation_missing');
  });

  it('detects stale, missing and future evidence rather than treating hashes as availability', () => {
    const context = fixture();
    context.now = '2027-01-01T00:00:00Z';
    expect(codes(context)).toContain('evidence_stale');
    expect(evaluateReadiness(context).controls[0]?.operation).toBe('stale');
    context.now = '2026-09-23T12:00:00Z';
    context.artifacts[0]!.available = false;
    expect(codes(context)).toContain('evidence_unavailable');
    context.artifacts[0]!.available = true;
    context.evaluations[0]!.completedAt = '2027-01-01T00:00:00Z';
    expect(codes(context)).toContain('evaluation_time_invalid');
  });

  it('keeps configuration, operational evidence, and human review independent', () => {
    const context = fixture();
    delete context.controls[0]!.review;
    expect(evaluateReadiness(context).controls[0]).toMatchObject({
      configuration: 'configured',
      operation: 'observed_working',
      review: 'pending',
    });
    expect(codes(context)).toContain('control_review_required');
    context.controls[0]!.data.configured = false;
    expect(codes(context)).toContain('control_not_configured');
  });

  it('requires reassessment after policy/evidence changes without mutating the old approval', () => {
    const context = fixture();
    const approval = {
      decision: 'approve' as const,
      versionId: 'version-a',
      deploymentId: 'staging',
      systemRevision: 8,
    };
    context.approval = approval;
    context.systemRevision = 9;
    expect(evaluateReadiness(context).controls[0]?.review).toBe(
      'needs_reassessment',
    );
    expect(evaluateReadiness(context, 'deploy').satisfied).toBe(false);
    expect(approval.systemRevision).toBe(8);
  });

  it('blocks unresolved risks, unadopted procedures, uncovered requirements, and operational findings', () => {
    const context = fixture();
    context.risks[0]!.data.residualRiskDecision = 'pending';
    context.procedures[0]!.revision = 2;
    context.requirements!.push({
      id: 'new-duty',
      title: 'Additional requirement',
      applicability: 'applicable',
    });
    context.findings.push({
      id: 'finding-1',
      title: 'Evidence unavailable',
      ownerId: 'owner-1',
      blocksRelease: true,
      resolved: false,
    });
    expect(codes(context)).toEqual(
      expect.arrayContaining([
        'residual_risk_unaccepted',
        'procedure_not_adopted',
        'requirement_uncovered',
        'blocking_finding',
      ]),
    );
  });

  it('cannot bypass a requirement with an undocumented non-applicability decision', () => {
    const context = fixture();
    context.requirements!.push({
      id: 'specific-duty',
      title: 'Scoped requirement',
      applicability: 'not_applicable',
    });
    expect(codes(context)).toContain('applicability_unreviewed');
    context.requirements![1]!.nonApplicability = {
      ownerId: 'owner-1',
      rationale: 'Only applies to a deployment context outside this release',
      scope: 'Synthetic staging only',
    };
    expect(codes(context)).not.toContain('applicability_unreviewed');
  });

  it('does not grant approval permission to an administrator without reviewer permission', () => {
    expect(mayReview(['admin'])).toBe(false);
    expect(mayReview(['editor'])).toBe(false);
    expect(mayReview(['admin', 'reviewer'])).toBe(true);
  });
});

describe('portable deterministic domain utilities', () => {
  it('makes evidence digests independent of object key order and preserves array order', () => {
    expect(canonicalJson({ z: 1, a: { c: 3, b: 2 } })).toBe(
      canonicalJson({ a: { b: 2, c: 3 }, z: 1 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    for (const value of [
      undefined,
      NaN,
      Infinity,
      new Date(),
      { absent: undefined },
      Array(1),
      { [Symbol('hidden')]: 'not JSON' },
    ])
      expect(() => canonicalJson(value)).toThrow();
  });

  it('treats non-finite and absent measurements as missing, not passing', () => {
    const criteria = [
      { metric: 'latency', operator: 'lte' as const, threshold: 100 },
    ];
    expect(evaluateMeasurements(criteria, { latency: 99 })[0]?.passed).toBe(
      true,
    );
    expect(
      evaluateMeasurements(criteria, { latency: Infinity })[0],
    ).toMatchObject({ actual: null, passed: false });
    expect(evaluateMeasurements(criteria, {})[0]?.passed).toBe(false);
  });
});
