import { describe, expect, it, vi } from 'vitest';
import { hypothesisPack } from '../src/catalogue/index.js';
import {
  EvaluationReportSchema,
  type EvaluationInput,
  type ProviderAnswers,
} from '../src/contracts.js';
import { createEvaluator } from '../src/evaluator.js';
import { ProviderError } from '../src/provider.js';
import { answers, provider, sample } from './helpers.js';

const firstId = hypothesisPack.hypotheses[0]!.id;
function response(answer: unknown) {
  return {
    model: 'mock-v1',
    answers: Object.fromEntries(
      hypothesisPack.hypotheses.map(({ id }) => [id, answer]),
    ),
  };
}

describe('fixed pack evaluation', () => {
  it('emits one portable finding per fixed ID with model/pack provenance and raw choices', async () => {
    const report = await createEvaluator(provider())(sample);
    expect(
      EvaluationReportSchema.parse(JSON.parse(JSON.stringify(report))),
    ).toEqual(report);
    expect(report.findings.map((f) => f.hypothesisId)).toEqual(
      hypothesisPack.hypotheses.map((h) => h.id),
    );
    expect(report.pack.version).toBe('0.1.0-draft.1');
    expect(report.evaluator).toEqual({ provider: 'mock', model: 'mock-v1' });
    expect(report.findings[0]?.raw).toEqual(answers());
    expect(JSON.stringify(report)).not.toContain('public-benefit application');
    expect(report).not.toHaveProperty('complianceScore');
  });

  for (const applicability of [
    'applicable',
    'not_applicable',
    'uncertain',
  ] as const) {
    for (const evidence of [
      'sufficient',
      'insufficient',
      'unsupported',
    ] as const) {
      for (const signal of ['detected', 'not_detected', 'uncertain'] as const) {
        it(`composes ${applicability}/${evidence}/${signal} conservatively`, async () => {
          const expected =
            applicability === 'not_applicable'
              ? 'not_applicable'
              : evidence === 'unsupported'
                ? 'unsupported'
                : applicability === 'uncertain' ||
                    evidence === 'insufficient' ||
                    signal === 'uncertain'
                  ? 'insufficient_evidence'
                  : signal === 'detected'
                    ? 'signal_detected'
                    : 'no_signal_detected';
          const report = await createEvaluator(
            provider(response(answers(applicability, evidence, signal))),
          )(sample);
          expect(report.findings.every((f) => f.status === expected)).toBe(
            true,
          );
          expect(EvaluationReportSchema.safeParse(report).success).toBe(true);
        });
      }
    }
  }

  it.each([null, '', '  ', {}, [], { source: '', details: [null, {}] }])(
    'abstains without contacting a provider when evidence is empty %#',
    async (data) => {
      const mock = provider();
      mock.evaluate = vi.fn(mock.evaluate);
      const report = await createEvaluator(mock)({ intention: 'Assess', data });
      expect(mock.evaluate).not.toHaveBeenCalled();
      expect(
        report.findings.every(
          (f) => f.status === 'insufficient_evidence' && f.raw === null,
        ),
      ).toBe(true);
    },
  );

  it.each([
    { modality: 'image', content: 'placeholder' },
    { modality: 'audio' },
    { modality: 'video' },
    'data:image/png;base64,abc',
  ])('returns unsupported for explicit media %#', async (data) => {
    const mock = provider();
    mock.evaluate = vi.fn(mock.evaluate);
    const report = await createEvaluator(mock)({ intention: 'Assess', data });
    expect(mock.evaluate).not.toHaveBeenCalled();
    expect(report.findings.every((f) => f.status === 'unsupported')).toBe(true);
  });

  it.each([false, 0, 'a description of an image', ['source text']])(
    'does not confuse substantive JSON/text with missing data %#',
    async (data) => {
      const mock = provider();
      mock.evaluate = vi.fn(mock.evaluate);
      await createEvaluator(mock)({ intention: 'Assess', data });
      expect(mock.evaluate).toHaveBeenCalledOnce();
    },
  );

  it('rejects invalid input before provider calls', async () => {
    const mock = provider();
    mock.evaluate = vi.fn(mock.evaluate);
    await expect(
      createEvaluator(mock)({ intention: '', data: 'x' }),
    ).rejects.toThrow();
    expect(mock.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    'configuration',
    'timeout',
    'invalid_response',
    'provider_failure',
  ] as const)(
    'keeps %s failures separate from negative findings',
    async (code) => {
      const mock = provider();
      mock.evaluate = async () => {
        throw new ProviderError(code, 'SECRET-PAYLOAD');
      };
      const report = await createEvaluator(mock)(sample);
      expect(
        report.findings.every(
          (f) => f.status === 'error' && f.error.code === code,
        ),
      ).toBe(true);
      expect(JSON.stringify(report)).not.toContain('SECRET-PAYLOAD');
    },
  );

  it('sanitizes unexpected exceptions and ignores untrusted error codes', async () => {
    const mock = provider();
    mock.evaluate = async () => {
      throw { message: 'SECRET', code: 'no_signal_detected' };
    };
    const report = await createEvaluator(mock)(sample);
    expect(report.findings[0]).toMatchObject({
      status: 'error',
      error: { code: 'provider_failure' },
    });
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });

  it.each([
    null,
    [],
    {},
    { model: 'wrong-model', answers: {} },
    { model: 'mock-v1', answers: { unknown: answers() } },
  ])(
    'rejects malformed envelopes and wrong model provenance %#',
    async (value) => {
      const report = await createEvaluator(provider(value))(sample);
      expect(report.findings.every((f) => f.status === 'error')).toBe(true);
    },
  );

  it('isolates an absent answer and preserves valid peer findings', async () => {
    const value = response(answers());
    delete value.answers[firstId];
    const report = await createEvaluator(provider(value))(sample);
    expect(report.findings[0]?.status).toBe('error');
    expect(
      report.findings.slice(1).every((f) => f.status === 'signal_detected'),
    ).toBe(true);
  });

  it.each([
    (a: ProviderAnswers) => ({
      ...a,
      signal: { ...a.signal, confidence: NaN },
    }),
    (a: ProviderAnswers) => ({
      ...a,
      signal: { ...a.signal, choice: 'invented' },
    }),
    (a: ProviderAnswers) => ({
      ...a,
      signal: { ...a.signal, choice: 'not_detected' },
    }),
    (a: ProviderAnswers) => ({
      ...a,
      signal: {
        ...a.signal,
        probabilities: { detected: 0.1, not_detected: 0.1, uncertain: 0.1 },
      },
    }),
    (a: ProviderAnswers) => ({
      ...a,
      signal: { ...a.signal, probabilities: { detected: 1, not_detected: 0 } },
    }),
    (a: ProviderAnswers) => ({
      ...a,
      signal: {
        ...a.signal,
        probabilities: { detected: 1, not_detected: 0, uncertain: 0, other: 0 },
      },
    }),
    (a: ProviderAnswers) => ({
      ...a,
      signal: { ...a.signal, explanation: 'invented prose' },
    }),
    (a: ProviderAnswers) => ({ ...a, evidence: null }),
  ])(
    'rejects malformed or inconsistent Choice responses %#',
    async (corrupt) => {
      const report = await createEvaluator(
        provider(response(corrupt(answers()))),
      )(sample);
      expect(report.findings.every((f) => f.status === 'error')).toBe(true);
    },
  );

  it('validates provenance and snapshots it when constructing an evaluator', async () => {
    expect(() => createEvaluator({ ...provider(), model: '' })).toThrow();
    const mock = { ...provider() };
    const run = createEvaluator(mock);
    mock.id = 'changed';
    expect((await run(sample)).evaluator.provider).toBe('mock');
  });

  it('gives the provider validated input and immutable hypotheses', async () => {
    const mock = provider();
    mock.evaluate = vi.fn(mock.evaluate);
    const input: EvaluationInput = {
      intention: ' Assess ',
      data: { record: 'Original' },
    };
    await createEvaluator(mock)(input);
    expect(mock.evaluate).toHaveBeenCalledWith(
      { intention: 'Assess', data: input.data },
      hypothesisPack.hypotheses,
    );
    expect(
      Object.isFrozen(hypothesisPack.hypotheses[0]?.evidenceRequirements),
    ).toBe(true);
  });
});
