import { createEvaluator } from './evaluator.js';
import { createJevProvider } from './providers/jev.js';

/** Evaluate the fixed research pack with exactly two inputs: intention and data. */
export const evaluate = createEvaluator(createJevProvider());

export { createEvaluator } from './evaluator.js';
export { createJevProvider, JEV_MODEL } from './providers/jev.js';
export type { JevProviderOptions } from './providers/jev.js';
export { hypothesisPack } from './catalogue/index.js';
export {
  InputValidationError,
  parseInput,
  MAX_INPUT_BYTES,
  MAX_INPUT_DEPTH,
} from './input.js';
export { ProviderError } from './provider.js';
export type { EvaluationProvider } from './provider.js';
export * from './contracts.js';
