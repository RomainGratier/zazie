import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { hypothesisPack } from '../src/catalogue/index.js';
import {
  EvaluationReportSchema,
  FindingSchema,
  ProviderAnswersSchema,
} from '../src/contracts.js';
import { createEvaluator } from '../src/evaluator.js';
import { answers, provider, sample } from './helpers.js';

describe('portable contracts', () => {
  it('rejects a finding that contradicts its raw status or evidence judgments', async () => {
    const finding = (await createEvaluator(provider())(sample)).findings[0]!;
    for (const patch of [
      { status: 'no_signal_detected' },
      { status: 'insufficient_evidence' },
      { evidence: 'insufficient' },
      { applicability: 'uncertain' },
    ])
      expect(FindingSchema.safeParse({ ...finding, ...patch }).success).toBe(
        false,
      );
  });

  it('allows maximum-probability ties without inventing a confidence threshold', () => {
    const raw = answers();
    raw.signal = {
      type: 'choice',
      choice: 'detected',
      confidence: 0.2,
      probabilities: { detected: 0.5, not_detected: 0.5, uncertain: 0 },
    };
    expect(ProviderAnswersSchema.safeParse(raw).success).toBe(true);
  });

  it('preserves observed two-decimal provider rounding without accepting invalid distributions', () => {
    const raw = answers();
    raw.signal = {
      type: 'choice',
      choice: 'not_detected',
      confidence: 0.72,
      probabilities: { detected: 0.14, not_detected: 0.81, uncertain: 0.04 },
    };
    expect(ProviderAnswersSchema.parse(raw).signal.probabilities).toEqual(
      raw.signal.probabilities,
    );
    raw.signal.probabilities.detected = 0.16;
    expect(ProviderAnswersSchema.safeParse(raw).success).toBe(true);
    raw.signal.probabilities.detected = 0.1;
    expect(ProviderAnswersSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a portable report missing provenance, containing extra scores, or an invalid timestamp', async () => {
    const report = await createEvaluator(provider())(sample);
    for (const patch of [
      { evaluator: undefined },
      { complianceScore: 100 },
      { evaluatedAt: 'yesterday' },
      { durationMs: -1 },
      { pack: { version: report.pack.version, status: 'validated' } },
    ])
      expect(
        EvaluationReportSchema.safeParse({ ...report, ...patch }).success,
      ).toBe(false);
  });

  it('published JSON Schemas accept real contracts and reject malformed wire shapes', async () => {
    // Zod uses required keys plus propertyNames for records, which is valid JSON
    // Schema but incompatible with Ajv's optional strictRequired lint rule.
    const ajv = new Ajv2020({
      strict: true,
      strictRequired: false,
    });
    formats.default(ajv);
    const checks = [
      ['evaluation-input.v1.json', sample, { intention: 'Assess' }],
      [
        'evaluation-report.v1.json',
        await createEvaluator(provider())(sample),
        { findings: [] },
      ],
      ['hypothesis-pack.v1.json', hypothesisPack, { hypotheses: [] }],
    ] as const;
    for (const [file, valid, invalid] of checks) {
      const schema: object = JSON.parse(
        await readFile(new URL(`../schemas/${file}`, import.meta.url), 'utf8'),
      );
      const validate = ajv.compile(schema);
      expect(
        validate(valid),
        `${file}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
      expect(validate(invalid)).toBe(false);
    }
  });
});
