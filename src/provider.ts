import type { ErrorCode, EvaluationInput, Hypothesis } from './contracts.js';

/** Network values remain unknown until the core validates them. */
export interface EvaluationProvider {
  readonly id: string;
  readonly model: string;
  evaluate(
    input: EvaluationInput,
    hypotheses: readonly Hypothesis[],
  ): Promise<unknown>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: ErrorCode,
    message = 'Provider evaluation failed.',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
