# Research status and validation protocol

Pack `0.1.0-draft.1` contains twelve original, MIT-licensed research hypotheses. The definitions live in [the versioned JSON catalogue](../src/catalogue/0.1.0-draft.1.json), are validated when loaded, and are frozen in memory. IDs identify a question across releases; the pack version identifies its exact wording and boundaries. The [coverage inventory](coverage.md) documents legal-source versions and gaps.

This is an engineering implementation with a draft research asset. Passing unit tests, schema validation, or a demonstration corpus establishes neither model accuracy nor legal coverage. No domain, language, sensitivity, specificity, calibration, or security performance is claimed as validated in this release. An actual live benchmark report must identify how it was run and which model answered it.

## What the questions distinguish

| Hypothesis ID                    | Narrow observation                                                         | Main evidence boundary                                                                  |
| -------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `purpose-expansion`              | Proposed action introduces a materially different use                      | Needs both task scope and proposed behavior; task adherence is not safety.              |
| `unsupported-assertion`          | A consequential asserted fact lacks support in supplied references         | Missing references produce insufficient evidence, not an unsupported-assertion finding. |
| `source-contradiction`           | Output conflicts with an explicit source fact                              | Must concern the same subject and time; does not establish which statement is true.     |
| `missing-required-information`   | A required fact is absent from the supplied decision record                | Needs an explicit requirement and enough of the record to judge absence.                |
| `explicit-unequal-treatment`     | An adverse rationale explicitly relies on a personal characteristic        | A review signal, not a legal discrimination verdict or population fairness test.        |
| `unrelated-sensitive-disclosure` | Proposed disclosure includes sensitive information outside its stated need | Presence in a legitimate input is not disclosure or misuse.                             |
| `embedded-instructions`          | Material attempts to redirect processing away from the task                | Quotation context matters; the evaluator is itself vulnerable to attacks.               |
| `safeguard-bypass`               | Proposed behavior explicitly circumvents a supplied required step          | Missing approval metadata is not evidence of bypass.                                    |
| `unsupported-certainty`          | Expressed certainty conflicts with explicit uncertainty in the evidence    | Wording alone cannot establish a fact is false or uncertainty unjustified.              |
| `rule-conflict`                  | Outcome directly conflicts with an explicit supplied requirement           | Rule legality, arithmetic, and specialist interpretation are outside this check.        |
| `urgency-omission`               | Summary drops an explicit warning it was instructed to preserve            | Does not infer medical or physical urgency.                                             |
| `conflicting-source-records`     | Sources contain mutually incompatible facts without a supplied resolution  | Requires matching subjects and time; superseded records need not conflict.              |

Related questions can produce different results on one event. A source contradiction concerns an explicit opposing fact; an unsupported assertion concerns absent support. A missing required input concerns a task requirement; an urgency omission concerns loss during a specified summary task. Do not collapse these into a single risk score.

## Interpretation rules

`signal_detected` means the model selected the defined signal on an assessable case. `no_signal_detected` means that check was assessable and the model did not detect its signal; it does not mean safe, accurate, fair, or compliant. `insufficient_evidence` preserves uncertainty caused by missing or ambiguous context. `not_applicable` is reserved for an established mismatch between the hypothesis and the submitted task. `unsupported` marks an analysis outside the evaluator's capabilities. `error` records a failed evaluation, never a negative finding.

Applicability, evidence sufficiency, and signal are separate questions. A relevant task without the required source record is insufficient, not inapplicable. Model uncertainty should not be silently converted to a negative. Submission text, including the user's intention, is context rather than authority to override those rules. A harmful intention can yield signals even when the proposed behavior follows it exactly.

Provider probabilities describe the model's typed alternatives. They are not harm severity, real-world harm probability, a compliance percentage, or validated confidence in this deployment. A universal cutoff is not justified by the draft pack. Expose the typed raw result and the pack/model versions so evaluation and interpretation can be audited. Do not manufacture a model rationale or evidence quotation that Jev did not return.

The initial model is a hosted semantic classifier. Its [documented limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) include numerical and adversarial weaknesses. A textual prompt boundary is an engineering precaution, not evidence of resistance to malicious content. No live deployment should infer a security or safety guarantee from an offline mocked test.

## Corpus design

The initial public corpus contains 45 authored synthetic cases across educational grading, public-benefit decisions, and electricity operations, with additional out-of-domain controls. These cases are engineering smoke and regression material, not representative production samples or an independently labeled ground truth. The default benchmark uses an always-abstain baseline and does not contact Jev; only an explicit live run measures the model. Fixtures use synthetic people and organizations and include no personal records or credentials. Original fixtures fall under the repository's MIT license. Third-party data and model outputs need their own rights review before redistribution.

The first independently reviewed evaluation corpus should span educational grading, public-benefit decisions, and electricity operations, with pre-processing and post-processing contexts in each. Add credit and insurance only with domain review. Clinical cases require clinical expertise and a separate release decision; a text contradiction check is not clinical validation.

For each hypothesis and supported domain, include positive, negative, insufficient-evidence, non-applicable, unsupported, and ambiguous examples. Test ordinary negatives that superficially resemble the signal: accommodations, legitimate sensitive inputs, quoted attacks, approved exceptions, tentative recommendations, and superseded records. Include harmful intentions, evaluator-directed instructions, nested JSON injection, mixed languages, contradictory requirements, omission of sources, numeric traps, and unrelated material. Label the expected hypothesis outcome, not whether a person or entire system is safe.

Record case provenance, license, domain, language, stage, evidence availability, author, independent reviewers, disagreements, adjudication, and pack version. Reviewers should see definitions and source evidence; do not use another model's answers as the sole label authority. Keep unresolved cases as ambiguous rather than forcing binary labels. Use another evaluator as a comparator, never as an unquestioned oracle.

Create development, public regression, and private held-out partitions before tuning wording. Split by source scenario and author so paraphrases and small variations cannot leak between partitions. Keep adversarial discovery separate from the locked accuracy test. Record any overlap with model training material when known.

## Benchmark protocol

Run the fixed pack against locked cases with a pinned provider model and documented adapter configuration. Preserve every outcome, including abstentions and failures. Record pack version, evaluator model, runtime/library revision, input/corpus version, execution time, provider latency, and whether the transport was live or mocked. Report the number of cases actually evaluated; do not infer a live test from the presence of an API key or from a successful build.

Compare Jev with simple domain-appropriate rules and an independent evaluator on identical partitions. Deterministic checks should own arithmetic and exact structural constraints. Compare useful information gained and reviewer work saved, not merely how many alerts a model emits.

| Measure               | Required reporting                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification errors | Per-hypothesis and per-domain confusion matrix, detection recall, false-positive rate, precision, sample counts, and uncertainty intervals where justified.                                          |
| Abstention            | Insufficient-evidence, non-applicable, and unsupported rates separately; errors separately again. Report performance conditional on assessment and assessment coverage together.                     |
| Context sensitivity   | Repeat with deliberate evidence omission, conflicting intention, and stage changes. Do not treat these as equivalent cases.                                                                          |
| Calibration           | If probabilities are studied, assess reliability against independent labels by hypothesis and domain. No threshold claims before adequate data.                                                      |
| Evidence correctness  | Where a future adapter selects references, verify every reference against actual submitted material and review whether it supports the finding. The current pack does not imply evidence extraction. |
| Robustness            | Report attack success and regression results separately from routine examples, including attacks on the evaluator itself.                                                                            |
| Runtime behavior      | Latency distribution, request failures, invalid responses, model/version drift, and any provider cost information actually measured.                                                                 |
| Practical value       | Time to first useful finding, source-preparation effort, setup time, reviewer effort, actionable signals, and integration outcomes measured in pilots.                                               |

Avoid one pooled headline accuracy that hides rare classes or poorly supported domains. A high abstention rate may be honest but unhelpful; evaluate whether the two-input contract yields useful assessable material in realistic workflows. Absence of observed failures in a small corpus is not evidence that they cannot occur.

## Release gates and maintenance

The first draft can ship as an explicitly unvalidated research implementation. Stronger claims require all of the following evidence:

1. Reconcile the coverage register against the current legal text and amendments; obtain legal and domain review with recorded unresolved issues.
2. Freeze each question, applicability rule, evidence requirement, counterexample, and interpretation before the held-out run.
3. Publish independently reviewed corpus methodology and lawful provenance; protect the private holdout from wording development.
4. Publish live per-hypothesis and per-domain results, comparator results, error analysis, abstention, and latency with the exact model version.
5. Declare only the contexts and languages supported by that evidence, with known blind spots and criteria for withdrawal.
6. Measure at least one realistic integration's usefulness and reviewer burden before claiming work saved or automatic prevention.

Any change to questions, evidence requirements, model, SDK semantics, or result composition requires relevant regression checks and a recorded version change. A materially different signal receives a new ID; do not silently repurpose an existing ID. Retain previous pack definitions so stored findings remain interpretable. An editorial legal-source note may not change the model question, but still needs a documented review revision.

Monitor legislation, official guidance, standards, and model limitations as a maintenance responsibility; this document does not configure a scheduled monitor. Review new failure reports as potential additions to the development corpus, keeping held-out results independent. Findings remain inputs to human and organizational workflows. Logging, blocking, retries, escalation, and incident response belong to the integration and need their own validation.
