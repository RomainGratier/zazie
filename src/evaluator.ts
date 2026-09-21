import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { hypothesisPack } from './catalogue/index.js';
import {
  ErrorCodeSchema,
  ProviderAnswersSchema,
  type ErrorCode,
  type EvaluationInput,
  type EvaluationReport,
  type Finding,
  type ProviderAnswers,
} from './contracts.js';
import { hasEvidence, isUnsupportedModality, parseInput } from './input.js';
import { ProviderError, type EvaluationProvider } from './provider.js';
import { statusForAnswers } from './interpretation.js';

const envelopeSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
});
const errorMessages: Record<ErrorCode, string> = {
  configuration:
    'Jev is not configured. Set TYPESAFE_API_KEY in the environment.',
  provider_failure: 'The evaluator provider failed. No conclusion was drawn.',
  timeout: 'The evaluator provider timed out. No conclusion was drawn.',
  invalid_response:
    'The evaluator returned an invalid response. No conclusion was drawn.',
};

function errorFinding(hypothesisId: string, code: ErrorCode): Finding {
  return {
    hypothesisId,
    status: 'error',
    applicability: 'unresolved',
    evidence: 'unresolved',
    summary: errorMessages[code],
    raw: null,
    error: { code, message: errorMessages[code] },
  };
}

function interpret(hypothesisId: string, raw: ProviderAnswers): Finding {
  const status = statusForAnswers(raw);
  const base = {
    hypothesisId,
    applicability: raw.applicability.choice,
    evidence: raw.evidence.choice,
    raw,
  };
  if (status === 'not_applicable') {
    return {
      ...base,
      applicability: 'not_applicable',
      status: 'not_applicable',
      summary:
        'The model judged this hypothesis outside the supplied use or material.',
    };
  }
  if (status === 'unsupported') {
    return {
      ...base,
      evidence: 'unsupported',
      status: 'unsupported',
      summary:
        'The required analysis is outside this text evaluator’s capabilities.',
    };
  }
  if (status === 'insufficient_evidence') {
    return {
      ...base,
      status: 'insufficient_evidence',
      summary:
        'The model could not resolve applicability or establish the signal from the supplied evidence.',
    };
  }
  return {
    ...base,
    applicability: 'applicable',
    evidence: 'sufficient',
    status,
    summary:
      status === 'signal_detected'
        ? 'The model identified the defined signal in the supplied context. Review is needed to establish its significance.'
        : 'The check was judged assessable and the model did not identify the defined signal. This does not establish safety or compliance.',
  };
}

/** Inject infrastructure for tests or research; the public hypothesis pack stays fixed. */
export function createEvaluator(
  provider: EvaluationProvider,
): (input: EvaluationInput) => Promise<EvaluationReport> {
  // Snapshot provenance so caller mutation cannot alter a running report.
  const evaluator = z
    .strictObject({ provider: z.string().min(1), model: z.string().min(1) })
    .parse({ provider: provider.id, model: provider.model });
  return async (input) => {
    const parsed = parseInput(input);
    const started = performance.now();
    const evaluatedAt = new Date().toISOString();
    let findings: Finding[];
    if (isUnsupportedModality(parsed.data)) {
      findings = hypothesisPack.hypotheses.map(({ id }) => ({
        hypothesisId: id,
        status: 'unsupported',
        applicability: 'unresolved',
        evidence: 'unsupported',
        summary:
          'This release evaluates text and JSON representations, not image, audio, or video content.',
        raw: null,
      }));
    } else if (!hasEvidence(parsed.data)) {
      findings = hypothesisPack.hypotheses.map(({ id }) => ({
        hypothesisId: id,
        status: 'insufficient_evidence',
        applicability: 'unresolved',
        evidence: 'insufficient',
        summary: 'No substantive data was supplied for this hypothesis.',
        raw: null,
      }));
    } else {
      try {
        const envelope = envelopeSchema.safeParse(
          await provider.evaluate(parsed, hypothesisPack.hypotheses),
        );
        if (!envelope.success || envelope.data.model !== evaluator.model)
          throw new ProviderError('invalid_response');
        const expected = new Set(hypothesisPack.hypotheses.map(({ id }) => id));
        if (Object.keys(envelope.data.answers).some((id) => !expected.has(id)))
          throw new ProviderError('invalid_response');
        findings = hypothesisPack.hypotheses.map(({ id }) => {
          const answer = ProviderAnswersSchema.safeParse(
            envelope.data.answers[id],
          );
          return answer.success
            ? interpret(id, answer.data)
            : errorFinding(id, 'invalid_response');
        });
      } catch (error) {
        const parsedCode = ErrorCodeSchema.safeParse(
          error instanceof ProviderError ? error.code : undefined,
        );
        const code = parsedCode.success ? parsedCode.data : 'provider_failure';
        findings = hypothesisPack.hypotheses.map(({ id }) =>
          errorFinding(id, code),
        );
      }
    }
    return {
      schemaVersion: '1.0.0',
      pack: { version: hypothesisPack.version, status: hypothesisPack.status },
      evaluator: { ...evaluator },
      evaluatedAt,
      durationMs: performance.now() - started,
      findings,
    };
  };
}
