# Draft synthetic benchmark

`cases.json` contains 45 original, fictional examples written for Zazie's engineering regression suite under the project MIT license. Labels are author-created draft research references. They have **not** been independently reviewed or validated by domain specialists. An initial live Jev run is being documented as an exploratory result. These are public regression cases, not a held-out test set, and that exploratory run does not establish detection quality or readiness in a domain.

The corpus spans education, public benefits, electricity operations, and out-of-domain fiction/security analysis. It includes pre- and post-processing contexts, positive and negative examples for all 12 hypotheses, missing evidence, non-applicability, unsupported analysis, harmful intentions, prompt injection, a French language shift, and counterexamples involving quoted instructions or missing approval metadata. Each case explains its draft label. All people and equipment are fictional. Only explicitly labeled hypothesis/case pairs are scored; other findings have no reference label.

The exported `runBenchmark` function also accepts caller-supplied reference cases. Its optional `corpusDescription` records the caller's provenance description without verifying it. If omitted, reports state that provenance is not established. The bundled script explicitly identifies this corpus as synthetic and unreviewed.

Reports include a UTC `generatedAt` timestamp and `corpus.sha256`: SHA-256 of the UTF-8 `JSON.stringify` representation of the validated cases, captured before evaluation. The fingerprint includes inputs, reference labels, IDs, ordering, tags, and rationales. It ignores source-file whitespace but preserves ordering within validated arrays and JSON objects; it is a content fingerprint, not an order-independent semantic identifier.

`execution.findingErrors` counts error findings across all validated returned findings, including unlabeled hypotheses. `execution.failedCases` counts cases with any such error, a thrown evaluation, an invalid report, or a missing/duplicate labeled finding. The script exits nonzero when this count is nonzero. These execution totals do not add unlabeled findings to the reference-based metrics.

Run the deterministic baseline without a credential:

```sh
npm run benchmark
npm run benchmark -- --report baseline-report.json
```

The `always-abstain-v1` baseline always reports `insufficient_evidence`; it performs no content analysis. It demonstrates the coverage floor and exercises the reporting pipeline. It is not an offline substitute for Jev, a rule-based detector, or evidence of model accuracy.

Run the pinned hosted evaluator explicitly, with `TYPESAFE_API_KEY` already present in the environment:

```sh
npm run benchmark -- --live --report jev-report.json
```

Live mode sends all cases to TypeSafe and may incur provider charges. Output paths use exclusive creation: existing reports are not overwritten. A run containing evaluation errors exits nonzero and still produces its complete report. Reports contain case IDs, predictions, probabilities, versions, and aggregate measurements; they do not copy submitted evidence. The script does not load `.env` automatically.

Every aggregate reports denominators. The full status confusion table retains all six finding statuses. Binary confusion counts include only positive/negative reference labels with resolved positive/negative predictions. Abstentions (`insufficient_evidence`, `not_applicable`, `unsupported`) and errors have separate counts and never become true or false negatives. `precisionAmongResolved`, `recallAmongResolved`, and `falsePositiveRateAmongResolved` describe that resolved subset; inspect `coverage` and `positiveReferenceDetectionRate` to see how much evidence the evaluator leaves unresolved. Exact status agreement includes inability-to-assess labels but is not detection accuracy.

Calibration reports the one-vs-rest detected-class Brier score only for resolved binary findings with binary reference labels and valid raw signal probabilities. It does not renormalize uncertain probability mass, substitute Choice confidence for signal probability, or impute probabilities for abstentions/errors. This conditional score can conceal selective abstention; its denominator and coverage are essential. Evidence correctness remains `null` because the evaluator does not emit verified evidence citations. Latency measures wall-clock evaluation duration once per case, including failures; per-domain/per-hypothesis slices use the same measured case durations.

Before making a reliability claim, obtain independent expert labels, lock a held-out set without paraphrase leakage, collect representative domain/language distributions, compare a substantive simple-rule baseline and another evaluator, measure evidence correctness when supported, and rerun by pack and model version. Those research release gates remain open.
