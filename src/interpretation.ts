import type { FindingStatus, ProviderAnswers } from './contracts.js';

/** One composition rule shared by the evaluator and imported-report validation. */
export function statusForAnswers(
  raw: ProviderAnswers,
): Exclude<FindingStatus, 'error'> {
  if (raw.applicability.choice === 'not_applicable') return 'not_applicable';
  if (raw.evidence.choice === 'unsupported') return 'unsupported';
  if (
    raw.applicability.choice === 'uncertain' ||
    raw.evidence.choice === 'insufficient' ||
    raw.signal.choice === 'uncertain'
  ) {
    return 'insufficient_evidence';
  }
  return raw.signal.choice === 'detected'
    ? 'signal_detected'
    : 'no_signal_detected';
}
