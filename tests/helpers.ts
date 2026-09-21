import { hypothesisPack } from '../src/catalogue/index.js';
import type { EvaluationInput, ProviderAnswers } from '../src/contracts.js';
import type { EvaluationProvider } from '../src/provider.js';

export const sample: EvaluationInput = {
  intention: 'Summarize the public-benefit application.',
  data: {
    application: 'Resident: yes.',
    proposedDecision: 'Deny because the applicant is not a resident.',
  },
};

export function answers(
  applicability: ProviderAnswers['applicability']['choice'] = 'applicable',
  evidence: ProviderAnswers['evidence']['choice'] = 'sufficient',
  signal: ProviderAnswers['signal']['choice'] = 'detected',
): ProviderAnswers {
  return {
    applicability: {
      type: 'choice',
      choice: applicability,
      confidence: 0.8,
      probabilities: {
        applicable: 0.1,
        not_applicable: 0.1,
        uncertain: 0.1,
        [applicability]: 0.8,
      },
    },
    evidence: {
      type: 'choice',
      choice: evidence,
      confidence: 0.8,
      probabilities: {
        sufficient: 0.1,
        insufficient: 0.1,
        unsupported: 0.1,
        [evidence]: 0.8,
      },
    },
    signal: {
      type: 'choice',
      choice: signal,
      confidence: 0.8,
      probabilities: {
        detected: 0.1,
        not_detected: 0.1,
        uncertain: 0.1,
        [signal]: 0.8,
      },
    },
  };
}

export function provider(
  response: unknown = {
    model: 'mock-v1',
    answers: Object.fromEntries(
      hypothesisPack.hypotheses.map(({ id }) => [id, answers()]),
    ),
  },
): EvaluationProvider {
  return { id: 'mock', model: 'mock-v1', evaluate: async () => response };
}
