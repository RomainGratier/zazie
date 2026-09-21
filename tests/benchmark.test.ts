import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  alwaysAbstain,
  parseBenchmarkCases,
  runBenchmark,
  summarizeMeasurements,
  type BenchmarkCase,
  type Measurement,
} from '../src/benchmark.js';
import { hypothesisPack } from '../src/catalogue/index.js';
import {
  FindingSchema,
  type EvaluationReport,
  type Finding,
} from '../src/contracts.js';

const baseCase: BenchmarkCase = {
  id: 'case-a',
  domain: 'education',
  stage: 'post',
  tags: ['positive'],
  input: {
    intention: 'Review a student answer.',
    data: { answer: 'Photosynthesis', output: 'Photosynthesis is absent.' },
  },
  expected: { 'source-contradiction': 'signal_detected' },
  rationale: 'The output denies the supplied answer.',
};

function measurement(
  expected: Measurement['expected'],
  actual: Measurement['actual'],
  probability: number | null = null,
): Measurement {
  return {
    caseId: `${expected}-${actual}`,
    domain: 'education',
    stage: 'post',
    hypothesisId: 'source-contradiction',
    expected,
    actual,
    signalProbability: probability,
    latencyMs: 10,
  };
}

function finding(status: 'signal_detected' | 'no_signal_detected'): Finding {
  const detected = status === 'signal_detected' ? 0.8 : 0.2;
  return FindingSchema.parse({
    hypothesisId: 'source-contradiction',
    status,
    applicability: 'applicable',
    evidence: 'sufficient',
    summary: 'Offline test fixture.',
    raw: {
      applicability: {
        type: 'choice',
        choice: 'applicable',
        confidence: 1,
        probabilities: { applicable: 1, not_applicable: 0, uncertain: 0 },
      },
      evidence: {
        type: 'choice',
        choice: 'sufficient',
        confidence: 1,
        probabilities: { sufficient: 1, insufficient: 0, unsupported: 0 },
      },
      signal: {
        type: 'choice',
        choice: detected >= 0.5 ? 'detected' : 'not_detected',
        confidence: Math.max(detected, 1 - detected),
        probabilities: {
          detected,
          not_detected: 1 - detected,
          uncertain: 0,
        },
      },
    },
  });
}

async function report(findings: Finding[]): Promise<EvaluationReport> {
  return { ...(await alwaysAbstain(baseCase.input)), findings };
}

describe('benchmark scoring', () => {
  it('counts errors and abstentions separately instead of treating them as negative predictions', () => {
    const summary = summarizeMeasurements([
      measurement('signal_detected', 'signal_detected', 0.8),
      measurement('signal_detected', 'no_signal_detected', 0.2),
      measurement('no_signal_detected', 'signal_detected', 0.7),
      measurement('no_signal_detected', 'no_signal_detected', 0.1),
      measurement('signal_detected', 'insufficient_evidence', 0.9),
      measurement('signal_detected', 'error'),
      measurement('no_signal_detected', 'unsupported'),
      measurement('not_applicable', 'not_applicable'),
    ]);
    expect(summary.binary).toMatchObject({
      references: 7,
      positiveReferences: 4,
      resolved: 4,
      abstentions: 2,
      errors: 1,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      trueNegative: 1,
      coverage: { numerator: 4, denominator: 7 },
      precisionAmongResolved: { value: 0.5, denominator: 2 },
      recallAmongResolved: { value: 0.5, denominator: 2 },
      positiveReferenceDetectionRate: { value: 0.25, denominator: 4 },
    });
    expect(summary.abstention.numerator).toBe(3);
    expect(summary.errors.numerator).toBe(1);
    expect(summary.calibration.denominator).toBe(4);
    expect(summary.calibration.brier).toBeCloseTo(
      (0.04 + 0.64 + 0.49 + 0.01) / 4,
    );
    expect(summary.evidenceCorrectness).toBeNull();
  });

  it('returns null for undefined denominators and excludes invalid probabilities from calibration', () => {
    const summary = summarizeMeasurements([
      measurement('signal_detected', 'insufficient_evidence'),
      measurement('no_signal_detected', 'error'),
    ]);
    expect(summary.binary.precisionAmongResolved.value).toBeNull();
    expect(summary.binary.recallAmongResolved.value).toBeNull();
    expect(summary.binary.positiveReferenceDetectionRate.value).toBe(0);
    expect(summary.calibration).toMatchObject({ brier: null, denominator: 0 });
    const invalid = summarizeMeasurements(
      [NaN, Infinity, -0.1, 1.1].map((value) =>
        measurement('signal_detected', 'signal_detected', value),
      ),
    );
    expect(invalid.calibration.brier).toBeNull();
    expect(summarizeMeasurements([]).latencyMs.median).toBeNull();
  });

  it('scores labeled pairs only and records evaluator/pack versions and per-case latency', async () => {
    const cases: BenchmarkCase[] = [
      baseCase,
      {
        ...baseCase,
        id: 'case-b',
        domain: 'public-benefits',
        stage: 'pre',
        expected: { 'source-contradiction': 'no_signal_detected' },
      },
    ];
    let time = 0;
    let count = 0;
    const result = await runBenchmark(cases, {
      name: 'offline-fixtures',
      now: () => (time += 5),
      evaluator: async () =>
        report([
          finding(count++ === 0 ? 'signal_detected' : 'no_signal_detected'),
        ]),
    });
    expect(result.overall.labeledPairs).toBe(2);
    expect(result.overall.exactStatusAgreement.value).toBe(1);
    expect(result.overall.latencyMs).toEqual({
      count: 2,
      mean: 5,
      median: 5,
      p95: 5,
    });
    expect(Object.keys(result.byDomain)).toEqual([
      'education',
      'public-benefits',
    ]);
    expect(Object.keys(result.byStage)).toEqual(['post', 'pre']);
    expect(result.evaluatorVersions).toEqual([
      {
        provider: 'baseline',
        model: 'always-abstain-v1',
        pack: hypothesisPack.version,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('Photosynthesis');
  });

  it('rejects a structurally typed external report whose status contradicts its raw answer', async () => {
    const malformed = await report([finding('signal_detected')]);
    // Simulate a caller or stored JSON report bypassing runtime validation.
    const inconsistent = malformed.findings[0];
    if (!inconsistent) throw new Error('Test fixture must contain a finding.');
    inconsistent.status = 'no_signal_detected';
    const result = await runBenchmark([baseCase], {
      name: 'contradictory-external-report',
      evaluator: async () => malformed,
    });
    expect(result.overall.statusCounts.error).toBe(1);
    expect(result.overall.binary.falseNegative).toBe(0);
    expect(result.overall.binary.errors).toBe(1);
    expect(result.overall.calibration.denominator).toBe(0);
    expect(result.evaluatorVersions).toEqual([]);
    expect(result.execution).toEqual({ failedCases: 1, findingErrors: 0 });
  });

  it('does not invent provenance for caller-supplied reference cases', async () => {
    const defaultReport = await runBenchmark([baseCase], {
      name: 'external-corpus',
      evaluator: alwaysAbstain,
    });
    expect(defaultReport.corpus.provenance).toBe(
      'Caller-supplied reference cases; validation provenance is not established by this harness.',
    );
    const describedReport = await runBenchmark([baseCase], {
      name: 'described-corpus',
      evaluator: alwaysAbstain,
      corpusDescription:
        'Project-owned synthetic draft references, unreviewed.',
    });
    expect(describedReport.corpus.provenance).toBe(
      'Project-owned synthetic draft references, unreviewed.',
    );
  });

  it('timestamps reports in UTC and fingerprints validated inputs and reference labels', async () => {
    const options = { name: 'fingerprint', evaluator: alwaysAbstain };
    const initial = await runBenchmark([baseCase], options);
    const repeated = await runBenchmark([structuredClone(baseCase)], options);
    const changedInput = await runBenchmark(
      [
        {
          ...baseCase,
          input: { ...baseCase.input, data: 'A changed source record.' },
        },
      ],
      options,
    );
    const changedReference = await runBenchmark(
      [
        {
          ...baseCase,
          expected: { 'source-contradiction': 'no_signal_detected' },
        },
      ],
      options,
    );
    expect(initial.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(new Date(initial.generatedAt).toISOString()).toBe(
      initial.generatedAt,
    );
    expect(initial.corpus.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.corpus.sha256).toBe(initial.corpus.sha256);
    expect(changedInput.corpus.sha256).not.toBe(initial.corpus.sha256);
    expect(changedReference.corpus.sha256).not.toBe(initial.corpus.sha256);
  });

  it('records thrown evaluations, missing findings, and duplicate findings as explicit errors', async () => {
    for (const evaluator of [
      async (): Promise<EvaluationReport> => {
        throw new Error('secret-key');
      },
      async () =>
        report([
          { ...finding('signal_detected'), hypothesisId: 'purpose-expansion' },
        ]),
      async () =>
        report([finding('signal_detected'), finding('no_signal_detected')]),
    ]) {
      const result = await runBenchmark([baseCase], {
        name: 'failures',
        evaluator,
      });
      expect(result.overall.statusCounts.error).toBe(1);
      expect(result.overall.binary.falseNegative).toBe(0);
      expect(result.overall.binary.errors).toBe(1);
      expect(result.overall.calibration.denominator).toBe(0);
      expect(JSON.stringify(result)).not.toContain('secret-key');
      expect(result.execution).toEqual({ failedCases: 1, findingErrors: 0 });
    }
  });

  it('counts unlabeled finding errors as execution failures without adding them to labeled metrics', async () => {
    const errorFinding = FindingSchema.parse({
      hypothesisId: 'purpose-expansion',
      status: 'error',
      applicability: 'unresolved',
      evidence: 'unresolved',
      raw: null,
      summary: 'Evaluation failed.',
      error: { code: 'provider_failure', message: 'Evaluation failed.' },
    });
    const result = await runBenchmark([baseCase], {
      name: 'unlabeled-failure',
      evaluator: async () => report([finding('signal_detected'), errorFinding]),
    });
    expect(result.execution).toEqual({ failedCases: 1, findingErrors: 1 });
    expect(result.overall.labeledPairs).toBe(1);
    expect(result.overall.statusCounts.error).toBe(0);
    expect(result.overall.binary.truePositive).toBe(1);
    expect(result.measurements.map((item) => item.hypothesisId)).toEqual([
      'source-contradiction',
    ]);
  });

  it('does not invent predictions or calibration for the always-abstain baseline', async () => {
    const result = await runBenchmark([baseCase], {
      name: 'baseline',
      evaluator: alwaysAbstain,
    });
    expect(result.overall.binary.coverage.value).toBe(0);
    expect(result.overall.binary.falseNegative).toBe(0);
    expect(result.overall.statusCounts.insufficient_evidence).toBe(1);
    expect(result.overall.calibration.brier).toBeNull();
    expect(result.execution).toEqual({ failedCases: 0, findingErrors: 0 });
  });
});

describe('draft corpus validation', () => {
  it('rejects duplicate IDs, unknown hypotheses, empty labels, invalid inputs, and reference errors', () => {
    for (const value of [
      [baseCase, baseCase],
      [{ ...baseCase, expected: { unknown: 'signal_detected' } }],
      [{ ...baseCase, expected: {} }],
      [{ ...baseCase, input: { intention: 'Task' } }],
      [{ ...baseCase, expected: { 'source-contradiction': 'error' } }],
    ])
      expect(() => parseBenchmarkCases(value)).toThrow();
  });

  it('includes original positive and negative references for every fixed hypothesis across multiple domains', async () => {
    const source: unknown = JSON.parse(
      await readFile(
        new URL('../benchmarks/cases.json', import.meta.url),
        'utf8',
      ),
    );
    const cases = parseBenchmarkCases(source);
    expect(cases.length).toBeGreaterThanOrEqual(36);
    expect(new Set(cases.map((item) => item.domain))).toEqual(
      new Set(['education', 'public-benefits', 'electricity', 'out-of-domain']),
    );
    expect(new Set(cases.map((item) => item.stage))).toEqual(
      new Set(['pre', 'post']),
    );
    for (const { id } of hypothesisPack.hypotheses) {
      const labels = cases.flatMap((item) => item.expected[id] ?? []);
      expect(labels, id).toContain('signal_detected');
      expect(labels, id).toContain('no_signal_detected');
    }
    const tags = new Set(cases.flatMap((item) => item.tags));
    for (const tag of [
      'adversarial',
      'missing-evidence',
      'not-applicable',
      'unsupported',
      'out-of-domain',
      'harmful-intention',
      'language-shift',
    ])
      expect(tags).toContain(tag);
  });
});
