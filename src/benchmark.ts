import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { hypothesisPack } from './catalogue/index.js';
import {
  EvaluationReportSchema,
  type EvaluationInput,
  type EvaluationReport,
  type Finding,
} from './contracts.js';
import { parseInput } from './index.js';

const statuses = [
  'signal_detected',
  'no_signal_detected',
  'insufficient_evidence',
  'not_applicable',
  'unsupported',
  'error',
] as const;
type Status = Finding['status'];
type ReferenceStatus = Exclude<Status, 'error'>;

export interface BenchmarkCase {
  readonly id: string;
  readonly domain: string;
  readonly stage: 'pre' | 'post';
  readonly tags: readonly string[];
  readonly input: EvaluationInput;
  /** Only explicitly annotated hypothesis/case pairs enter the metrics. */
  readonly expected: Readonly<Record<string, ReferenceStatus>>;
  readonly rationale: string;
}

const caseSchema = z.strictObject({
  id: z.string().min(1).max(100),
  domain: z.string().min(1).max(100),
  stage: z.enum(['pre', 'post']),
  tags: z.array(z.string().min(1).max(100)),
  input: z.unknown(),
  expected: z.record(
    z.string(),
    z.enum([
      'signal_detected',
      'no_signal_detected',
      'insufficient_evidence',
      'not_applicable',
      'unsupported',
    ]),
  ),
  rationale: z.string().min(1),
});

/** Validate corpus structure, IDs, and two-input payloads before any paid requests. */
export function parseBenchmarkCases(value: unknown): BenchmarkCase[] {
  const parsed = z.array(caseSchema).min(1).parse(value);
  const seen = new Set<string>();
  const known = new Set(hypothesisPack.hypotheses.map(({ id }) => id));
  return parsed.map((item) => {
    if (seen.has(item.id))
      throw new Error('Benchmark case IDs must be unique.');
    seen.add(item.id);
    const ids = Object.keys(item.expected);
    if (ids.length === 0 || ids.some((id) => !known.has(id))) {
      throw new Error(
        'Each benchmark case needs known hypothesis reference labels.',
      );
    }
    return { ...item, input: parseInput(item.input) };
  });
}

export interface Measurement {
  readonly caseId: string;
  readonly domain: string;
  readonly stage: 'pre' | 'post';
  readonly hypothesisId: string;
  readonly expected: ReferenceStatus;
  readonly actual: Status;
  readonly signalProbability: number | null;
  readonly latencyMs: number;
}

interface Rate {
  readonly value: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

function rate(numerator: number, denominator: number): Rate {
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
  };
}

function isBinary(status: Status): boolean {
  return status === 'signal_detected' || status === 'no_signal_detected';
}

function isAbstention(status: Status): boolean {
  return (
    status === 'insufficient_evidence' ||
    status === 'not_applicable' ||
    status === 'unsupported'
  );
}

function latency(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number): number | null =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    count: sorted.length,
    mean:
      sorted.length === 0
        ? null
        : sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: percentile(0.5),
    p95: percentile(0.95),
  };
}

/** Errors and inability-to-assess outcomes never enter the negative prediction cell. */
export function summarizeMeasurements(measurements: readonly Measurement[]) {
  const statusCounts: Record<Status, number> = {
    signal_detected: 0,
    no_signal_detected: 0,
    insufficient_evidence: 0,
    not_applicable: 0,
    unsupported: 0,
    error: 0,
  };
  const confusion: Record<string, Record<Status, number>> = {};
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let positiveReferences = 0;
  let binaryReferences = 0;
  let binaryAbstentions = 0;
  let binaryErrors = 0;
  let squaredError = 0;
  let calibrationCount = 0;
  let exactMatches = 0;
  const caseLatencies = new Map<string, number>();

  for (const measurement of measurements) {
    const { actual, expected, signalProbability } = measurement;
    statusCounts[actual] += 1;
    confusion[expected] ??= {
      ...Object.fromEntries(statuses.map((status) => [status, 0])),
    } as Record<Status, number>;
    const row = confusion[expected];
    if (row) row[actual] += 1;
    exactMatches += Number(actual === expected);
    caseLatencies.set(measurement.caseId, measurement.latencyMs);
    if (!isBinary(expected)) continue;
    binaryReferences += 1;
    positiveReferences += Number(expected === 'signal_detected');
    binaryAbstentions += Number(isAbstention(actual));
    binaryErrors += Number(actual === 'error');
    if (!isBinary(actual)) continue;
    if (expected === 'signal_detected') {
      if (actual === 'signal_detected') truePositive += 1;
      else falseNegative += 1;
    } else if (actual === 'signal_detected') falsePositive += 1;
    else trueNegative += 1;
    if (
      signalProbability !== null &&
      Number.isFinite(signalProbability) &&
      signalProbability >= 0 &&
      signalProbability <= 1
    ) {
      squaredError +=
        (signalProbability - Number(expected === 'signal_detected')) ** 2;
      calibrationCount += 1;
    }
  }
  const resolved = truePositive + falsePositive + falseNegative + trueNegative;
  return {
    labeledPairs: measurements.length,
    statusCounts,
    confusion,
    exactStatusAgreement: rate(exactMatches, measurements.length),
    abstention: rate(
      statusCounts.insufficient_evidence +
        statusCounts.not_applicable +
        statusCounts.unsupported,
      measurements.length,
    ),
    errors: rate(statusCounts.error, measurements.length),
    binary: {
      references: binaryReferences,
      positiveReferences,
      resolved,
      abstentions: binaryAbstentions,
      errors: binaryErrors,
      truePositive,
      falsePositive,
      falseNegative,
      trueNegative,
      coverage: rate(resolved, binaryReferences),
      precisionAmongResolved: rate(truePositive, truePositive + falsePositive),
      recallAmongResolved: rate(truePositive, truePositive + falseNegative),
      falsePositiveRateAmongResolved: rate(
        falsePositive,
        falsePositive + trueNegative,
      ),
      positiveReferenceDetectionRate: rate(truePositive, positiveReferences),
    },
    calibration: {
      brier: calibrationCount === 0 ? null : squaredError / calibrationCount,
      denominator: calibrationCount,
      interpretation:
        'One-vs-rest detected-class Brier on binary references with resolved binary findings and raw signal probabilities; uncertain probability mass is not renormalized. This is conditional on assessment coverage.',
    },
    evidenceCorrectness: null,
    latencyMs: latency([...caseLatencies.values()]),
  };
}

function grouped(
  measurements: readonly Measurement[],
  key: (item: Measurement) => string,
) {
  const groups = new Map<string, Measurement[]>();
  for (const measurement of measurements) {
    const group = key(measurement);
    const items = groups.get(group) ?? [];
    items.push(measurement);
    groups.set(group, items);
  }
  return Object.fromEntries(
    [...groups].map(([name, items]) => [name, summarizeMeasurements(items)]),
  );
}

function probability(finding: Finding | undefined): number | null {
  if (!finding || !isBinary(finding.status) || finding.raw === null)
    return null;
  const result = finding.raw.signal.probabilities.detected;
  return typeof result === 'number' &&
    Number.isFinite(result) &&
    result >= 0 &&
    result <= 1
    ? result
    : null;
}

/** A deterministic coverage floor, not a detector or a substitute for live Jev evaluation. */
export async function alwaysAbstain(
  _input: EvaluationInput,
): Promise<EvaluationReport> {
  return {
    schemaVersion: '1.0.0',
    pack: { version: hypothesisPack.version, status: 'draft-research' },
    evaluator: { provider: 'baseline', model: 'always-abstain-v1' },
    evaluatedAt: new Date().toISOString(),
    durationMs: 0,
    findings: hypothesisPack.hypotheses.map(({ id }) => ({
      hypothesisId: id,
      status: 'insufficient_evidence',
      applicability: 'unresolved',
      evidence: 'unresolved',
      summary: 'Always-abstain baseline: no content evaluation was performed.',
      raw: null,
    })),
  };
}

export interface BenchmarkOptions {
  readonly name: string;
  /** Caller-supplied provenance description; the harness does not verify it. */
  readonly corpusDescription?: string;
  readonly evaluator: (input: EvaluationInput) => Promise<EvaluationReport>;
  readonly now?: () => number;
}

export async function runBenchmark(
  cases: readonly BenchmarkCase[],
  options: BenchmarkOptions,
) {
  const checked = parseBenchmarkCases(cases);
  const corpusSha256 = createHash('sha256')
    .update(JSON.stringify(checked), 'utf8')
    .digest('hex');
  const now = options.now ?? (() => performance.now());
  const measurements: Measurement[] = [];
  let failedCases = 0;
  let findingErrors = 0;
  const versions = new Map<
    string,
    { provider: string; model: string; pack: string }
  >();
  for (const item of checked) {
    const start = now();
    let report: EvaluationReport | undefined;
    let failed = false;
    try {
      report = EvaluationReportSchema.parse(
        await options.evaluator(item.input),
      );
      const version = { ...report.evaluator, pack: report.pack.version };
      versions.set(JSON.stringify(version), version);
      const errors = report.findings.filter(
        (finding) => finding.status === 'error',
      ).length;
      findingErrors += errors;
      failed = errors > 0;
    } catch {
      // A failed event contributes one explicit error per labeled hypothesis.
      failed = true;
    }
    const elapsed = Math.max(0, now() - start);
    for (const [hypothesisId, expected] of Object.entries(item.expected)) {
      const matches =
        report?.findings.filter(
          (finding) => finding.hypothesisId === hypothesisId,
        ) ?? [];
      const finding = matches.length === 1 ? matches[0] : undefined;
      if (!finding) failed = true;
      measurements.push({
        caseId: item.id,
        domain: item.domain,
        stage: item.stage,
        hypothesisId,
        expected,
        actual: finding?.status ?? 'error',
        signalProbability: probability(finding),
        latencyMs: elapsed,
      });
    }
    if (failed) failedCases += 1;
  }
  return {
    schemaVersion: '1.0.0' as const,
    generatedAt: new Date().toISOString(),
    name: options.name,
    corpus: {
      cases: checked.length,
      sha256: corpusSha256,
      provenance:
        options.corpusDescription ??
        'Caller-supplied reference cases; validation provenance is not established by this harness.',
      labeling:
        'Only explicitly labeled case/hypothesis pairs are scored. Unlabeled findings are excluded.',
    },
    evaluatorVersions: [...versions.values()],
    execution: { failedCases, findingErrors },
    limitations: [
      'This harness does not establish reference-label validity, representativeness, real-world model reliability, legal compliance, or domain suitability.',
      'Precision and recall among resolved binary findings exclude abstentions and errors; inspect coverage and positiveReferenceDetectionRate alongside them.',
      'Evidence correctness is unmeasured because this evaluator does not return validated evidence citations.',
    ],
    overall: summarizeMeasurements(measurements),
    byHypothesis: grouped(measurements, (item) => item.hypothesisId),
    byDomain: grouped(measurements, (item) => item.domain),
    byDomainAndHypothesis: grouped(
      measurements,
      (item) => `${item.domain}/${item.hypothesisId}`,
    ),
    byStage: grouped(measurements, (item) => item.stage),
    measurements,
  };
}
