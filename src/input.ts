import {
  EvaluationInputSchema,
  type EvaluationInput,
  type JsonValue,
} from './contracts.js';
import { types } from 'node:util';

export const MAX_INPUT_BYTES = 24_000;
export const MAX_INPUT_DEPTH = 32;

export class InputValidationError extends Error {
  constructor() {
    super(
      'Expected exactly intention (1–2000 characters) and JSON data; input must be at most 24000 UTF-8 bytes and 32 levels deep.',
    );
    this.name = 'InputValidationError';
  }
}

/** Reject values that JSON.stringify would silently drop, coerce, or execute. */
function assertJson(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  budget: { remaining: number },
): void {
  if (depth > MAX_INPUT_DEPTH) throw new InputValidationError();
  budget.remaining -=
    typeof value === 'string' ? Buffer.byteLength(value, 'utf8') + 2 : 1;
  if (budget.remaining < 0) throw new InputValidationError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null)
    throw new InputValidationError();
  if (types.isProxy(value)) throw new InputValidationError();
  if (ancestors.has(value)) throw new InputValidationError();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value) && prototype !== Array.prototype)
    throw new InputValidationError();
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new InputValidationError();
  }
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && keys.length !== value.length + 1)
    throw new InputValidationError();
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') throw new InputValidationError();
    if (key === '__proto__') throw new InputValidationError();
    if (!Array.isArray(value))
      budget.remaining -= Buffer.byteLength(key, 'utf8');
    if (budget.remaining < 0) throw new InputValidationError();
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
      throw new InputValidationError();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new InputValidationError();
    assertJson(descriptor.value, ancestors, depth + 1, budget);
  }
  ancestors.delete(value);
}

/** Runtime validation for JavaScript callers, files, and other untrusted boundaries. */
export function parseInput(value: unknown): EvaluationInput {
  try {
    assertJson(value, new Set(), 0, { remaining: MAX_INPUT_BYTES });
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_INPUT_BYTES)
      throw new InputValidationError();
    const result = EvaluationInputSchema.safeParse(value);
    if (!result.success) throw new InputValidationError();
    return result.data;
  } catch {
    // Validation errors never echo submitted values or getters' error messages.
    throw new InputValidationError();
  }
}

export function hasEvidence(value: JsonValue): boolean {
  if (value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value !== 'object') return true;
  return Object.values(value).some(hasEvidence);
}

/** Explicit modality descriptors only: ordinary text mentioning images is text. */
export function isUnsupportedModality(value: JsonValue): boolean {
  if (typeof value === 'string')
    return /^data:(image|audio|video)\//i.test(value.trim());
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  return (
    typeof value['modality'] === 'string' &&
    ['image', 'audio', 'video'].includes(value['modality'])
  );
}
