import { z } from 'zod';
import { statusForAnswers } from './interpretation.js';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/** Additional resource and serialization constraints are enforced by parseInput. */
export const EvaluationInputSchema = z.strictObject({
  intention: z.string().trim().min(1).max(2_000),
  data: JsonValueSchema,
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export const HypothesisSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  title: z.string().min(1),
  question: z.string().min(1),
  applicability: z.string().min(1),
  evidenceRequirements: z.array(z.string().min(1)).min(1),
  counterexamples: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  sourceMappings: z
    .array(
      z.strictObject({
        article: z.string().min(1),
        url: z.url(),
        relationship: z.literal('research-mapping'),
        note: z.string().min(1),
      }),
    )
    .min(1),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const HypothesisPackSchema = z
  .strictObject({
    version: z.string().min(1),
    status: z.literal('draft-research'),
    sourceCheckedOn: z.iso.date(),
    hypotheses: z.array(HypothesisSchema).min(1),
  })
  .refine(
    (pack) =>
      new Set(pack.hypotheses.map((h) => h.id)).size === pack.hypotheses.length,
    {
      message: 'Hypothesis IDs must be unique.',
    },
  );
export type HypothesisPack = z.infer<typeof HypothesisPackSchema>;

const probability = z.number().min(0).max(1);

/** Jev Choice values are retained without reinterpreting confidence as severity. */
function choiceSchema<const T extends readonly [string, ...string[]]>(
  options: T,
) {
  // Live Jev responses round probabilities to two decimal places. Three
  // individually rounded probabilities can legitimately sum to 0.99 or 1.01.
  const roundingTolerance = options.length * 0.005 + Number.EPSILON;
  return z
    .strictObject({
      type: z.literal('choice'),
      choice: z.enum(options),
      confidence: probability,
      probabilities: z.record(z.enum(options), probability),
    })
    .refine(
      (answer) => {
        const probabilities = Object.values(answer.probabilities) as number[];
        const selected = answer.probabilities[answer.choice];
        return (
          Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) <=
            roundingTolerance &&
          typeof selected === 'number' &&
          probabilities.every((p) => selected >= p)
        );
      },
      {
        message:
          'Choice probabilities must sum to one within rounding tolerance and the choice must have maximum probability.',
      },
    );
}

export const ProviderAnswersSchema = z.strictObject({
  applicability: choiceSchema(['applicable', 'not_applicable', 'uncertain']),
  evidence: choiceSchema(['sufficient', 'insufficient', 'unsupported']),
  signal: choiceSchema(['detected', 'not_detected', 'uncertain']),
});
export type ProviderAnswers = z.infer<typeof ProviderAnswersSchema>;

export const FindingStatusSchema = z.enum([
  'signal_detected',
  'no_signal_detected',
  'insufficient_evidence',
  'not_applicable',
  'unsupported',
  'error',
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const ErrorCodeSchema = z.enum([
  'configuration',
  'provider_failure',
  'timeout',
  'invalid_response',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const findingBase = z.strictObject({
  hypothesisId: z.string().min(1),
  applicability: z.enum([
    'applicable',
    'not_applicable',
    'uncertain',
    'unresolved',
  ]),
  evidence: z.enum(['sufficient', 'insufficient', 'unsupported', 'unresolved']),
  summary: z.string().min(1),
  raw: ProviderAnswersSchema.nullable(),
});

export const FindingSchema = z
  .discriminatedUnion('status', [
    findingBase.extend({
      status: z.literal('signal_detected'),
      applicability: z.literal('applicable'),
      evidence: z.literal('sufficient'),
      raw: ProviderAnswersSchema,
    }),
    findingBase.extend({
      status: z.literal('no_signal_detected'),
      applicability: z.literal('applicable'),
      evidence: z.literal('sufficient'),
      raw: ProviderAnswersSchema,
    }),
    findingBase.extend({ status: z.literal('insufficient_evidence') }),
    findingBase.extend({
      status: z.literal('not_applicable'),
      applicability: z.literal('not_applicable'),
      raw: ProviderAnswersSchema,
    }),
    findingBase.extend({
      status: z.literal('unsupported'),
      evidence: z.literal('unsupported'),
    }),
    findingBase.extend({
      status: z.literal('error'),
      raw: z.null(),
      error: z.strictObject({
        code: ErrorCodeSchema,
        message: z.string().min(1),
      }),
    }),
  ])
  .refine(
    (finding) =>
      finding.raw === null ||
      (finding.status === statusForAnswers(finding.raw) &&
        finding.applicability === finding.raw.applicability.choice &&
        finding.evidence === finding.raw.evidence.choice),
    {
      message:
        'Finding status and evidence judgments must match the raw answers.',
    },
  );
export type Finding = z.infer<typeof FindingSchema>;

export const EvaluationReportSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  pack: z.strictObject({
    version: z.string().min(1),
    status: z.literal('draft-research'),
  }),
  evaluator: z.strictObject({
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
  evaluatedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  findings: z.array(FindingSchema).min(1),
});
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;
