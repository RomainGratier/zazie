import { z } from 'zod';

export const API_VERSION = '1.0' as const;
export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const TimestampSchema = z.iso.datetime({ offset: true });
export const RevisionSchema = z.number().int().positive();
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(20_000);
const title = z.string().trim().min(1).max(240);
const ids = z.array(IdSchema).max(200);
const notes = z.string().max(20_000).default('');
const uniqueIds = ids.refine(
  (values) => new Set(values).size === values.length,
  'IDs must be unique',
);

export const RoleSchema = z.enum(['admin', 'editor', 'reviewer', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const SystemInputSchema = z.strictObject({
  name: title,
  intendedUse: text,
  ownerId: IdSchema,
  highRiskCategory: title,
  actorRoles: z
    .array(z.enum(['provider', 'deployer']))
    .min(1)
    .max(2),
  affectedPopulation: text,
  workflowPackId: IdSchema,
  workflowPackVersion: title,
  synthetic: z.boolean().default(false),
});
export type SystemInput = z.infer<typeof SystemInputSchema>;

export const VersionInputSchema = z.strictObject({
  label: title,
  components: z
    .record(title, title)
    .refine(
      (value) => Object.keys(value).length > 0,
      'At least one versioned component is required',
    ),
  changeSummary: text,
});
export const ManifestSchema = VersionInputSchema;
export type VersionInput = z.infer<typeof VersionInputSchema>;

export const DeploymentInputSchema = z.strictObject({
  versionId: IdSchema,
  name: title,
  environment: title,
  context: text,
  ownerId: IdSchema,
});
export type DeploymentInput = z.infer<typeof DeploymentInputSchema>;

export const RiskInputSchema = z
  .strictObject({
    title,
    harm: text,
    affectedGroups: text,
    foreseeableMisuse: notes,
    likelihood: z.enum(['low', 'medium', 'high', 'unknown']),
    severity: z.enum(['low', 'medium', 'high', 'critical', 'unknown']),
    ownerId: IdSchema,
    residualRiskDecision: z
      .enum(['pending', 'accepted', 'unacceptable'])
      .default('pending'),
    rationale: notes,
  })
  .refine(
    (risk) =>
      risk.residualRiskDecision === 'pending' ||
      risk.rationale.trim().length > 0,
    {
      message: 'A residual-risk decision requires a rationale',
      path: ['rationale'],
    },
  );
export type RiskInput = z.infer<typeof RiskInputSchema>;

export const ControlInputSchema = z.strictObject({
  title,
  description: text,
  ownerId: IdSchema,
  requirementIds: uniqueIds.default([]),
  riskIds: uniqueIds.default([]),
  evaluationDefinitionIds: uniqueIds.default([]),
  procedureIds: uniqueIds.default([]),
  configured: z.boolean().default(false),
  maxEvidenceAgeDays: z.number().int().min(1).max(3650).default(90),
});
export type ControlInput = z.infer<typeof ControlInputSchema>;

export const MetricCriterionSchema = z.strictObject({
  metric: title,
  operator: z.enum(['gte', 'lte', 'eq']),
  threshold: z.number().finite(),
});
export type MetricCriterion = z.infer<typeof MetricCriterionSchema>;

export const EvaluationDefinitionInputSchema = z
  .strictObject({
    name: title,
    criteria: z.array(MetricCriterionSchema).min(1).max(100),
    datasetId: IdSchema.optional(),
  })
  .refine(
    (definition) =>
      new Set(definition.criteria.map((criterion) => criterion.metric)).size ===
      definition.criteria.length,
    {
      message: 'Each metric must have one acceptance criterion',
      path: ['criteria'],
    },
  );
export type EvaluationDefinitionInput = z.infer<
  typeof EvaluationDefinitionInputSchema
>;

export const DatasetInputSchema = z.strictObject({
  name: title,
  version: title,
  provenance: text,
  coverage: text,
  notes,
});
export type DatasetInput = z.infer<typeof DatasetInputSchema>;

export const ProcedureInputSchema = z.strictObject({
  name: title,
  version: title,
  content: text,
  ownerId: IdSchema,
});
export type ProcedureInput = z.infer<typeof ProcedureInputSchema>;

export const ProcedureAdoptionInputSchema = z.strictObject({
  procedureId: IdSchema,
  procedureRevision: RevisionSchema,
  ownerId: IdSchema,
  scope: text,
  rationale: text,
});
export type ProcedureAdoptionInput = z.infer<
  typeof ProcedureAdoptionInputSchema
>;

export const EvaluationInputSchema = z
  .strictObject({
    versionId: IdSchema,
    definitionId: IdSchema,
    definitionRevision: RevisionSchema,
    datasetId: IdSchema.optional(),
    datasetRevision: RevisionSchema.optional(),
    measurements: z
      .record(title, z.number().finite())
      .refine(
        (value) => Object.keys(value).length <= 100,
        'At most 100 measurements are allowed',
      ),
    artifactIds: uniqueIds.min(1),
    producer: title,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
  })
  .superRefine((evaluation, context) => {
    if (
      (evaluation.datasetId === undefined) !==
      (evaluation.datasetRevision === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['datasetRevision'],
        message: 'Dataset ID and revision must be provided together',
      });
    }
    if (Date.parse(evaluation.completedAt) < Date.parse(evaluation.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Completion cannot precede execution start',
      });
    }
  });
export const EvaluationReportSchema = EvaluationInputSchema;
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export const EventInputSchema = z.strictObject({
  schemaVersion: z.literal(API_VERSION),
  eventId: IdSchema,
  source: title,
  type: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
  versionId: IdSchema,
  deploymentId: IdSchema.optional(),
  occurredAt: TimestampSchema,
  correlationId: IdSchema.optional(),
  payload: z.record(z.string().max(240), z.json()),
});
export type EventInput = z.infer<typeof EventInputSchema>;
export const EventBatchInputSchema = z.strictObject({
  events: z.array(EventInputSchema).min(1).max(100),
});

export const ReleaseReviewInputSchema = z.strictObject({
  versionId: IdSchema,
  deploymentId: IdSchema,
});
export type ReleaseReviewInput = z.infer<typeof ReleaseReviewInputSchema>;
export const ReviewDecisionInputSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  rationale: text,
  expectedRevision: RevisionSchema,
});
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInputSchema>;
export const ControlReviewInputSchema = z.strictObject({
  versionId: IdSchema,
  rationale: text,
  expectedRevision: RevisionSchema,
  expectedSystemRevision: RevisionSchema,
});
export type ControlReviewInput = z.infer<typeof ControlReviewInputSchema>;
export const EvidenceReuseInputSchema = z.strictObject({
  evaluationId: IdSchema,
  targetVersionId: IdSchema,
  rationale: text,
  expectedSystemRevision: RevisionSchema,
});
export type EvidenceReuseInput = z.infer<typeof EvidenceReuseInputSchema>;

export const ApplicabilityDecisionInputSchema = z.strictObject({
  requirementId: IdSchema,
  applicability: z.enum(['applicable', 'not_applicable']),
  ownerId: IdSchema,
  rationale: text,
  scope: text,
  expectedSystemRevision: RevisionSchema,
});
export type ApplicabilityDecisionInput = z.infer<
  typeof ApplicabilityDecisionInputSchema
>;

export const FindingInputSchema = z.strictObject({
  title,
  description: text,
  ownerId: IdSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  blocksRelease: z.boolean().default(true),
  dueAt: TimestampSchema.optional(),
  source: title.default('manual'),
});
export type FindingInput = z.infer<typeof FindingInputSchema>;
export const FindingResolutionInputSchema = z.strictObject({
  rationale: text,
  artifactIds: uniqueIds.min(1),
  expectedRevision: RevisionSchema,
});
export const IncidentInputSchema = z.strictObject({
  title,
  description: text,
  ownerId: IdSchema,
  versionIds: uniqueIds.min(1),
  deploymentIds: uniqueIds.default([]),
  awareAt: TimestampSchema,
  correctiveActions: notes,
});
export type IncidentInput = z.infer<typeof IncidentInputSchema>;

export const MembershipInputSchema = z.strictObject({
  issuer: z.url(),
  subject: z.string().min(1).max(500),
  displayName: title,
  roles: z.array(RoleSchema).min(1).max(4),
  systemIds: uniqueIds,
  allSystems: z.boolean().default(false),
});
export type MembershipInput = z.infer<typeof MembershipInputSchema>;
export const MembershipUpdateInputSchema = MembershipInputSchema.extend({
  active: z.boolean(),
});
export type MembershipUpdateInput = z.infer<typeof MembershipUpdateInputSchema>;
export const MembershipResponseSchema = MembershipInputSchema.extend({
  id: IdSchema,
  active: z.boolean().optional(),
});
export const MembershipListResponseSchema = z.strictObject({
  items: z.array(MembershipResponseSchema.extend({ active: z.boolean() })),
});
export const SessionResponseSchema = z.strictObject({
  user: z.strictObject({ id: IdSchema, displayName: title }),
  roles: z.array(RoleSchema),
  systemIds: ids,
  allSystems: z.boolean(),
  csrfToken: z.string().min(1),
  organization: z.strictObject({ id: IdSchema, name: title }),
  synthetic: z.boolean(),
});
export const TokenActionSchema = z.enum([
  'systems:read',
  'versions:write',
  'evaluations:write',
  'events:write',
  'artifacts:write',
  'releases:read',
  'dossiers:write',
]);
export const TokenInputSchema = z.strictObject({
  name: title,
  systemIds: uniqueIds.min(1),
  actions: z.array(TokenActionSchema).min(1).max(7),
  expiresAt: TimestampSchema,
});
export type TokenInput = z.infer<typeof TokenInputSchema>;
/** Secrets are returned once; idempotent retries contain metadata and a recovery marker only. */
export const TokenCreationResponseSchema = z.union([
  TokenInputSchema.extend({ id: IdSchema, token: z.string().min(1) }),
  TokenInputSchema.extend({
    id: IdSchema,
    secretAlreadyIssued: z.literal(true),
  }),
]);
export type TokenCreationResponse = z.infer<typeof TokenCreationResponseSchema>;
export const TokenListResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: IdSchema,
      name: title,
      systemIds: ids,
      actions: z.array(TokenActionSchema),
      expiresAt: TimestampSchema,
      revokedAt: TimestampSchema.nullable(),
    }),
  ),
});

export const ArtifactInputSchema = z.strictObject({
  filename: z
    .string()
    .min(1)
    .max(240)
    .refine(
      (name) => !/[\x00-\x1f/\\]/.test(name) && name !== '.' && name !== '..',
      'Use a filename without paths or control characters',
    ),
  contentType: z
    .string()
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .max(150),
  provenance: text,
});
export type ArtifactInput = z.infer<typeof ArtifactInputSchema>;
export const ArtifactUploadInputSchema = ArtifactInputSchema.extend({
  contentBase64: z
    .string()
    .max(70_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export type ArtifactUploadInput = z.infer<typeof ArtifactUploadInputSchema>;
export const ArtifactMetadataSchema = ArtifactInputSchema.extend({
  id: IdSchema,
  organizationId: IdSchema,
  systemId: IdSchema,
  sha256: Sha256Schema,
  size: z
    .number()
    .int()
    .nonnegative()
    .max(50 * 1024 * 1024),
  createdAt: TimestampSchema,
  availability: z.enum(['available', 'missing', 'unchecked']),
});

export const DossierInputSchema = z.strictObject({ releaseReviewId: IdSchema });
export const ListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export const ApiErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.json().optional(),
});

/** Stable public envelopes deliberately omit database/storage internals. */
export interface Resource<T> {
  id: string;
  organizationId: string;
  systemId: string | null;
  revision: number;
  createdAt: string;
  createdBy: string;
  data: T;
}

export const publicSchemas = {
  SystemInput: SystemInputSchema,
  VersionInput: VersionInputSchema,
  DeploymentInput: DeploymentInputSchema,
  RiskInput: RiskInputSchema,
  ControlInput: ControlInputSchema,
  DatasetInput: DatasetInputSchema,
  ProcedureInput: ProcedureInputSchema,
  ProcedureAdoptionInput: ProcedureAdoptionInputSchema,
  EvaluationDefinitionInput: EvaluationDefinitionInputSchema,
  EvaluationInput: EvaluationInputSchema,
  EventInput: EventInputSchema,
  EventBatchInput: EventBatchInputSchema,
  ReleaseReviewInput: ReleaseReviewInputSchema,
  ReviewDecisionInput: ReviewDecisionInputSchema,
  ControlReviewInput: ControlReviewInputSchema,
  EvidenceReuseInput: EvidenceReuseInputSchema,
  ApplicabilityDecisionInput: ApplicabilityDecisionInputSchema,
  FindingInput: FindingInputSchema,
  FindingResolutionInput: FindingResolutionInputSchema,
  IncidentInput: IncidentInputSchema,
  MembershipInput: MembershipInputSchema,
  MembershipUpdateInput: MembershipUpdateInputSchema,
  MembershipResponse: MembershipResponseSchema,
  MembershipListResponse: MembershipListResponseSchema,
  SessionResponse: SessionResponseSchema,
  TokenInput: TokenInputSchema,
  TokenCreationResponse: TokenCreationResponseSchema,
  TokenListResponse: TokenListResponseSchema,
  ArtifactInput: ArtifactInputSchema,
  ArtifactUploadInput: ArtifactUploadInputSchema,
  ArtifactMetadata: ArtifactMetadataSchema,
  DossierInput: DossierInputSchema,
  ApiError: ApiErrorSchema,
} as const;

export function jsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(publicSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { target: 'openapi-3.0' }),
    ]),
  );
}

export { routes, type RouteDefinition, type OperationId } from './routes.js';
export * from './retention.js';
