import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  ArtifactInputSchema,
  ApplicabilityDecisionInputSchema,
  ControlReviewInputSchema,
  EvaluationInputSchema,
  EventInputSchema,
  MembershipInputSchema,
  MembershipUpdateInputSchema,
  TokenCreationResponseSchema,
  TokenInputSchema,
  MembershipListResponseSchema,
  TokenListResponseSchema,
  SessionResponseSchema,
  RiskInputSchema,
  jsonSchemas,
} from '../src/index.js';

const evaluation = {
  versionId: 'version-a',
  definitionId: 'definition-1',
  definitionRevision: 1,
  measurements: { recall: 0.95 },
  artifactIds: ['artifact-1'],
  producer: 'synthetic-ci',
  startedAt: '2026-09-23T09:00:00Z',
  completedAt: '2026-09-23T10:00:00Z',
};

describe('public evidence contracts', () => {
  it('validates actual flat administration rows and the browser session shape', () => {
    const membership = {
      id: 'member-1',
      issuer: 'https://identity.example.test',
      subject: 'subject-1',
      displayName: 'Reviewer',
      roles: ['reviewer'],
      systemIds: ['system-1'],
      allSystems: false,
      active: true,
    };
    expect(
      MembershipListResponseSchema.safeParse({ items: [membership] }).success,
    ).toBe(true);
    const token = {
      id: 'token-1',
      name: 'Scoped integration',
      systemIds: ['system-1'],
      actions: ['events:write'],
      expiresAt: '2027-01-01T00:00:00Z',
      revokedAt: null,
    };
    expect(TokenListResponseSchema.safeParse({ items: [token] }).success).toBe(
      true,
    );
    expect(
      TokenListResponseSchema.safeParse({
        items: [{ ...token, token: 'must-not-leak' }],
      }).success,
    ).toBe(false);
    expect(
      SessionResponseSchema.safeParse({
        user: { id: 'member-1', displayName: 'Reviewer' },
        roles: ['reviewer'],
        systemIds: ['system-1'],
        allSystems: false,
        csrfToken: 'synthetic-csrf',
        organization: { id: 'org-1', name: 'Synthetic org' },
        synthetic: false,
      }).success,
    ).toBe(true);
  });

  it('publishes the actual finding-resolution route, required PUT key, and non-resource administration responses', async () => {
    const document = JSON.parse(
      await readFile(new URL('../../../openapi.json', import.meta.url), 'utf8'),
    ) as {
      paths: Record<
        string,
        Record<
          string,
          {
            parameters: Array<{ name: string; required?: boolean }>;
            responses: Record<
              string,
              { content: Record<string, { schema: { $ref?: string } }> }
            >;
          }
        >
      >;
    };
    expect(
      document.paths['/systems/{systemId}/findings/{resourceId}/resolutions']?.[
        'post'
      ],
    ).toBeDefined();
    expect(
      document.paths['/systems/{systemId}/findings/{resourceId}/resolve'],
    ).toBeUndefined();
    for (const operations of Object.values(document.paths)) {
      if (operations['put'])
        expect(
          operations['put'].parameters.find(
            (parameter) => parameter.name === 'Idempotency-Key',
          )?.required,
        ).toBe(true);
    }
    for (const [path, schema] of [
      ['/memberships', 'MembershipListResponse'],
      ['/tokens', 'TokenListResponse'],
      ['/session', 'SessionResponse'],
    ] as const) {
      expect(
        document.paths[path]?.['get']?.responses['200']?.content[
          'application/json'
        ]?.schema.$ref,
      ).toBe(`#/components/schemas/${schema}`);
    }
  });
  it('documents successful logout and revocation as empty 204 responses', async () => {
    const document = JSON.parse(
      await readFile(new URL('../../../openapi.json', import.meta.url), 'utf8'),
    ) as {
      paths: Record<
        string,
        { delete?: { responses: Record<string, { content?: unknown }> } }
      >;
    };
    for (const path of [
      '/session',
      '/memberships/{resourceId}',
      '/tokens/{resourceId}',
    ]) {
      const responses = document.paths[path]?.delete?.responses;
      expect(responses?.['204']).toBeDefined();
      expect(responses?.['204']?.content).toBeUndefined();
      expect(responses?.['200']).toBeUndefined();
    }
  });
  it('allows scoped dossier generation without granting integration release approval', () => {
    const token = {
      name: 'Dossier exporter',
      systemIds: ['system-1'],
      expiresAt: '2027-01-01T00:00:00Z',
      actions: ['dossiers:write', 'systems:read'],
    };
    expect(TokenInputSchema.safeParse(token).success).toBe(true);
    expect(
      TokenInputSchema.safeParse({ ...token, actions: ['releases:review'] })
        .success,
    ).toBe(false);
  });
  it('updates memberships with the explicit raw active state and never invents a revision envelope', () => {
    const membership = {
      issuer: 'https://identity.example.test',
      subject: 'subject-1',
      displayName: 'Reviewer',
      roles: ['reviewer'],
      systemIds: ['system-1'],
      active: false,
    };
    expect(MembershipUpdateInputSchema.safeParse(membership).success).toBe(
      true,
    );
    expect(
      MembershipUpdateInputSchema.safeParse({
        expectedRevision: 1,
        data: membership,
      }).success,
    ).toBe(false);
  });

  it('models one-time credential secrets separately from idempotent replay metadata', () => {
    const metadata = {
      id: 'token-1',
      name: 'Synthetic token',
      systemIds: ['system-1'],
      actions: ['events:write'],
      expiresAt: '2027-01-01T00:00:00Z',
    };
    expect(
      TokenCreationResponseSchema.safeParse({
        ...metadata,
        token: 'synthetic-secret',
      }).success,
    ).toBe(true);
    expect(
      TokenCreationResponseSchema.safeParse({
        ...metadata,
        secretAlreadyIssued: true,
      }).success,
    ).toBe(true);
    expect(
      TokenCreationResponseSchema.safeParse({
        ...metadata,
        secretAlreadyIssued: true,
        token: 'should-not-replay',
      }).success,
    ).toBe(false);
  });
  it('requires both the control revision and evidence revision for human review', () => {
    const review = {
      versionId: 'version-a',
      expectedRevision: 1,
      rationale: 'Inspected current evidence',
    };
    expect(ControlReviewInputSchema.safeParse(review).success).toBe(false);
    expect(
      ControlReviewInputSchema.safeParse({
        ...review,
        expectedSystemRevision: 10,
      }).success,
    ).toBe(true);
  });

  it('requires accountable scope and rationale for non-applicability decisions', () => {
    const decision = {
      requirementId: 'requirement-1',
      applicability: 'not_applicable',
      ownerId: 'owner-1',
      rationale: 'Outside this deployment context',
      scope: 'Synthetic staging',
      expectedSystemRevision: 2,
    };
    expect(ApplicabilityDecisionInputSchema.safeParse(decision).success).toBe(
      true,
    );
    for (const key of ['ownerId', 'rationale', 'scope']) {
      expect(
        ApplicabilityDecisionInputSchema.safeParse({ ...decision, [key]: '' })
          .success,
      ).toBe(false);
    }
  });
  it('requires measurements and rejects producer-asserted pass flags', () => {
    expect(EvaluationInputSchema.safeParse(evaluation).success).toBe(true);
    expect(
      EvaluationInputSchema.safeParse({ ...evaluation, passed: true }).success,
    ).toBe(false);
    expect(
      EvaluationInputSchema.safeParse({
        ...evaluation,
        measurements: { recall: Infinity },
      }).success,
    ).toBe(false);
  });

  it('binds the dataset identifier and immutable revision together', () => {
    expect(
      EvaluationInputSchema.safeParse({ ...evaluation, datasetId: 'dataset-1' })
        .success,
    ).toBe(false);
    expect(
      EvaluationInputSchema.safeParse({ ...evaluation, datasetRevision: 1 })
        .success,
    ).toBe(false);
    expect(
      EvaluationInputSchema.safeParse({
        ...evaluation,
        datasetId: 'dataset-1',
        datasetRevision: 1,
      }).success,
    ).toBe(true);
  });

  it('rejects execution with completion before start or missing stored evidence', () => {
    expect(
      EvaluationInputSchema.safeParse({
        ...evaluation,
        completedAt: '2026-09-22T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      EvaluationInputSchema.safeParse({ ...evaluation, artifactIds: [] })
        .success,
    ).toBe(false);
  });

  it('requires a rationale when accepting or rejecting residual risk', () => {
    const risk = {
      title: 'Wrong exclusion',
      harm: 'Lost opportunity',
      affectedGroups: 'Applicants',
      likelihood: 'medium',
      severity: 'high',
      ownerId: 'owner-1',
      residualRiskDecision: 'accepted',
    };
    expect(RiskInputSchema.safeParse(risk).success).toBe(false);
    expect(
      RiskInputSchema.safeParse({
        ...risk,
        rationale: 'Reviewed synthetic pilot risk',
      }).success,
    ).toBe(true);
  });

  it('does not admit storage paths or control characters in artifact names', () => {
    const metadata = {
      contentType: 'application/json',
      provenance: 'Synthetic test report',
    };
    for (const filename of [
      '../secrets',
      'x/y',
      'x\\y',
      'report\r\nInjected: value',
      '..',
    ]) {
      expect(
        ArtifactInputSchema.safeParse({ ...metadata, filename }).success,
      ).toBe(false);
    }
    expect(
      ArtifactInputSchema.safeParse({ ...metadata, filename: 'report.json' })
        .success,
    ).toBe(true);
  });

  it('keeps event data JSON-compatible and system identity server scoped', () => {
    const event = {
      schemaVersion: '1.0',
      eventId: 'evt-1',
      source: 'synthetic-exam',
      type: 'oversight.flag_reviewed',
      versionId: 'v1',
      occurredAt: '2026-09-23T10:00:00Z',
      payload: { offsets: [1, 2], accepted: false },
    };
    expect(EventInputSchema.safeParse(event).success).toBe(true);
    expect(
      EventInputSchema.safeParse({
        ...event,
        organizationId: 'other-organization',
      }).success,
    ).toBe(false);
    expect(
      EventInputSchema.safeParse({ ...event, payload: { fn: () => null } })
        .success,
    ).toBe(false);
  });

  it('uses issuer and subject for membership rather than an email identity', () => {
    expect(
      MembershipInputSchema.safeParse({
        issuer: 'https://identity.example.test',
        subject: 'sub-1',
        displayName: 'Reviewer',
        roles: ['reviewer'],
        systemIds: ['system-1'],
      }).success,
    ).toBe(true);
    expect(
      MembershipInputSchema.safeParse({
        email: 'reviewer@example.test',
        roles: ['reviewer'],
        systemIds: [],
      }).success,
    ).toBe(false);
  });

  it('generates the same public shapes for OpenAPI without handwritten schema duplication', () => {
    const schemas = jsonSchemas();
    expect(schemas['EvaluationInput']).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(schemas['EventInput']).toMatchObject({ type: 'object' });
  });
});
