import { HypothesisPackSchema } from '../contracts.js';
import draftPack from './0.1.0-draft.1.json' with { type: 'json' };

/** Prevent callers from changing the fixed research definitions between evaluations. */
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freezeDeep(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** The only hypothesis pack used by the evaluator. Its content is draft research. */
export const hypothesisPack = freezeDeep(HypothesisPackSchema.parse(draftPack));
