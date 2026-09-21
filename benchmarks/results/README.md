# Exploratory run — 21 September 2026

These are measurements on Zazie's **45 author-created synthetic development cases**, with one reference label per case. Labels have not been independently reviewed, and the cases are neither representative production data nor a held-out benchmark. The results do not establish legal coverage, real-world accuracy, or suitability for a domain.

The [live Jev report](jev-1.13.0-2026-09-21.json) records `jev-1.13.0` with pack `0.1.0-draft.1`. The [offline always-abstain report](always-abstain-2026-09-21.json) demonstrates the reporting floor. Both include corpus fingerprints and individual measurements. The live source is recorded in implementation commit `7dd0fdb`; the corpus and hypothesis definitions were unchanged during the integration runs.

| Measure                                                     | Recorded live result                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Cases / labeled pairs                                       | 45 / 45                                                                    |
| Findings returned                                           | 540 (12 per case)                                                          |
| Hosted evaluations                                          | 44; the explicit image case was classified locally as unsupported          |
| Failed cases / finding errors, including unlabeled findings | 0 / 0                                                                      |
| Exact status agreement with draft labels                    | 41 / 45                                                                    |
| Resolved binary findings / binary reference labels          | 27 / 29                                                                    |
| Resolved positive / negative matches                        | 15 / 12                                                                    |
| All inability-to-assess outcomes on labeled pairs           | 18 / 45, including deliberately non-applicable and unsupported cases       |
| Conditional detected-class Brier score                      | 0.00747 on 27 resolved binary findings                                     |
| Mean / median / p95 case latency                            | 378 / 346 / 508 ms on this local run, including the local unsupported case |

The apparently perfect binary agreement among resolved predictions describes a tiny selected subset. Two negative reference cases were left unresolved. The conditional calibration statistic omits unresolved predictions; it cannot establish population calibration. Latency is a measurement of this run, not a service guarantee. Evidence-citation correctness remains unmeasured.

## Unresolved disagreements

All four disagreements are retained unchanged for independent review:

| Case                            | Draft reference         | Actual finding   |
| ------------------------------- | ----------------------- | ---------------- |
| `education-disclosure-negative` | `no_signal_detected`    | `not_applicable` |
| `electricity-records-negative`  | `no_signal_detected`    | `not_applicable` |
| `benefits-certainty-missing`    | `insufficient_evidence` | `not_applicable` |
| `electricity-records-missing`   | `insufficient_evidence` | `not_applicable` |

These expose the applicability boundary as a research question. A difference may indicate a model error, an ambiguous definition, or a draft label needing review. The labels were not changed to match Jev.

## Integration observation

Earlier integration runs exposed valid provider probability triples totaling 0.99 because of observed two-decimal rounding. A strict 0.001 sum tolerance incorrectly rejected them. The recorded final run uses a bounded rounding allowance, preserves raw values, and includes a regression test for the observed response. No hypothesis wording or reference label changed for this fix. The official SDK also treats normalization as approximate; see [provider notes](../../docs/jev.md).

The always-abstain baseline is a coverage floor, not a substantive simple-rule competitor. Independent labels, a held-out corpus, meaningful rule/model comparisons, more languages, domain-specific analysis, and wider adversarial evaluation remain open [research gates](../../docs/research.md).

To reproduce the method, use the pinned dependency lockfile and the same corpus hash, then follow the [benchmark commands](../README.md). Network timing and model results can vary between runs.
