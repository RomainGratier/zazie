# Zazie — AI Act hypothesis engine

Adapted from revision 3, 21 September 2026. This is the core-product specification. The initial TypeScript implementation now exists with a draft twelve-hypothesis pack and offline engineering tests. Live model accuracy and independent legal/domain validation remain unestablished. Earlier customer-configured monitor proposals are superseded.

Project name selected by the user: **Zazie**. Original project code, hypothesis definitions and original evaluation assets are MIT licensed; third-party rights remain separate.

## The contract

The customer supplies exactly two required inputs:

1. **Intention:** what the originating AI system is trying to do.
2. **Data:** the material to judge in relation to that intention.

The engine evaluates the data using the project's fixed, versioned set of risk hypotheses and returns typed findings. The customer does not author hypotheses, research the law, build prompts or configure a monitor before their first call.

Implemented public API:

```ts
const report = await evaluate({
  intention:
    'Assess eligibility for a public benefit using the supplied rules.',
  data: {
    eligibilityRules,
    application,
    proposedDecision,
  },
});
```

`data` may instead be a single text or structured record. A source/response pair, processing stage, logging configuration and system registration are not mandatory API inputs. The richness of the supplied data limits what can be assessed. Source documents, reference rules and intended downstream actions can be included inside `data` when available.

Output: one result per fixed hypothesis, including applicability, evidence sufficiency, a finding or explicit inability to assess, the relevant raw Jev result when evaluated, hypothesis-pack version and evaluator-model version. Expose errors separately from negative findings.

The engine returns signals. Decisions about logging, review, blocking, retrying or continuing belong to the integrating workflow. Optional adapters can help with those actions later.

## The actual product asset

The main asset is a research-maintained, openly licensed hypothesis library with an evaluator and validation corpus. Jev executes the questions; the project does the work of deciding which questions are useful, how they relate to risks and requirements, and how reliably they can be answered.

The project owns:

- The reviewed mapping from legal requirements to observable risks and evidence needs.
- Exact hypothesis definitions, question wording and boundary cases.
- Consistent applicability and insufficient-evidence behavior.
- Positive, negative, ambiguous, adversarial and out-of-domain examples.
- Validation by domain, language, processing stage and model version.
- Maintenance as legislation, guidance and models change.

Customers retain responsibility for accurately describing their use and integrating findings appropriately. Their intention is context, not an instruction to ignore safeguards. A harmful intention must remain detectable; good intentions do not establish safe outcomes.

## One fixed catalogue, contextual findings

V1 uses the same hypothesis IDs and definitions for every call. Do not introduce customer-authored packs or a hypothesis builder as an onboarding requirement.

The evaluator must distinguish:

- `signal_detected`: evidence of the defined signal is present.
- `no_signal_detected`: the check was assessable and no defined signal was identified.
- `insufficient_evidence`: the data cannot support the judgment.
- `not_applicable`: the hypothesis does not apply to the described use/data.
- `unsupported`: the required modality or analysis is outside the engine's capabilities.
- `error`: evaluation failed.

An incomplete intention may make applicability unresolved. Do not infer absent controls, downstream use, legal roles or population outcomes from silence. A universal threshold such as 0.9 is not automatically appropriate across hypotheses or domains.

Where a question is answerable, expose its typed Choice/Noul/Score result with documented interpretation. Probability of a signal is distinct from severity, real-world harm probability and legal non-compliance. No overall “percent compliant” score.

### Candidate hypothesis families for research

These are candidates, not a validated or exhaustive release pack. Each requires decomposition into narrow questions and expert-reviewed boundary cases.

| Family                                  | Example observable question                                                                               | Evidence limitation                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Purpose mismatch                        | Does the proposed behavior exceed the task described in the intention?                                    | Raw source data may contain no proposed behavior.                                    |
| Unsupported assertion                   | Does a consequential assertion lack support in supplied source material?                                  | Without the source, report insufficient evidence.                                    |
| Source contradiction                    | Does the recommendation conflict with a material fact in the provided record?                             | Semantic checking does not replace numerical verification.                           |
| Missing material information            | Does the supplied rule require a fact that is absent from the decision record?                            | Required fields cannot be invented from an underspecified intention.                 |
| Explicit unequal-treatment rationale    | Does the rationale explicitly rely on a protected characteristic in a potentially adverse decision?       | A signal for contextual review, not proof of illegality or a complete fairness test. |
| Sensitive information beyond purpose    | Does the proposed disclosure include sensitive information unrelated to the stated task?                  | Presence in a legitimate input is not itself misuse; relevance can be uncertain.     |
| Instructions embedded in untrusted data | Does the material attempt to redirect processing away from the stated task?                               | Jev itself must be validated against such attacks.                                   |
| Bypassing stated safeguards             | Does the proposed behavior explicitly skip a required approval or safety step supplied in context?        | Missing approval metadata is not proof no approval occurred.                         |
| Unsupported certainty                   | Does a consequential recommendation express certainty despite explicit contradictory or missing evidence? | Requires contextual evidence; cannot establish truth from wording alone.             |

The research should examine both behavior inconsistent with intention and harmful behavior that follows the intention. Purpose adherence alone is not safety.

## What “covers all high-risk requirements” means

Build a coverage matrix for the complete applicable high-risk framework, with versioned sources. Every requirement is mapped to an assessable hypothesis, a required additional evidence type, or an explicit non-assessable category. A full catalogue is a research deliverable; the current candidate list is not that catalogue.

Do not promise that every requirement can be verified from one intention/data submission. Training-data governance and an organizational quality-management system require evidence beyond an individual event. [Article 10](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-10), [Article 17](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-17)

Use four evidence categories internally:

1. **Event-assessable:** supported by the submitted material and intention.
2. **Needs references/documents:** assessment requires supplied policies, source records, specifications or governance evidence.
3. **Needs datasets/outcomes:** representative samples and quantitative analysis, such as population-level performance or fairness.
4. **Needs organizational or specialist verification:** facts a semantic classifier cannot establish.

These categories are maintained by the project, not configured by customers. They make omissions explicit without complicating the two-input API.

Article 9 provides a direct foundation for intended-purpose risk assessment and testing, but also requires foreseeable misuse and lifecycle risk management. This engine supplies evaluated signals and reusable tests toward that process. [Article 9](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-9)

## Where users insert it

The function is stage-neutral. Placement changes the available evidence, not the fixed catalogue.

| Placement               | Material judged                                                                    | Useful for                                                                                                  | Cannot establish                                    |
| ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Before a model          | Input records, documents or proposed instructions                                  | Embedded instructions, visible contradictions, relevance, missing information against supplied requirements | What the model will eventually output               |
| After a model           | Generated response, recommendation or proposed action; sources optionally included | Purpose mismatch, explicit adverse rationale, unsupported or contradictory claims                           | Source-grounding when sources were not provided     |
| Both                    | Separate input and output submissions, with available context                      | Comparing observed concerns before and after processing                                                     | Causal proof that the model introduced a harm       |
| Parallel / asynchronous | A copy of an available input or completed event                                    | Monitoring without blocking the primary flow                                                                | Prevention of an action that has already happened   |
| Offline replay          | Historical events or labeled test cases                                            | Benchmarks, regression tests, comparisons and investigation                                                 | Real-world reliability beyond the test distribution |

Users may insert a gate wherever justified. An integration that waits for the evaluator before an action can prevent that action; an asynchronous integration observes it. The API should not prescribe the customer's business response.

Flags describe data or proposed behavior. They must not label a person as inherently risky or automatically disqualify someone because their record contains sensitive information.

## Cross-domain value hypotheses

These are test scenarios for research, not measured detection claims. Assume the customer has established the originating use's regulatory scope.

| Use                                | Before processing                                                                                           | After processing                                                                               | Research boundary                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Creditworthiness / loan decisions  | Conflicting income descriptions, missing evidence required by supplied lending rules, embedded instructions | Rationale contradicts supplied facts or explicitly invokes an irrelevant personal attribute    | Statistical discrimination and affordability calculations need additional methods.                        |
| Public-benefit eligibility         | Missing required facts, contradictory records                                                               | Denial conflicts with a supplied eligibility rule or asserts a missing fact as known           | Rules must be current and correctly interpreted; legal eligibility is not established by a generic judge. |
| Educational grading                | Instructions hidden in a student submission that attempt to alter grading                                   | Feedback contradicts the submitted answer or a supplied rubric                                 | Subject correctness and scoring may need specialist references or deterministic calculation.              |
| Emergency patient triage           | Contradictory case summaries or absence of fields required by a supplied protocol                           | Generated summary omits explicitly supplied urgency information or conflicts with the protocol | Research-only until clinically validated; no claim to diagnose, assess images or validate treatment.      |
| Electricity-network operations     | Conflicting maintenance instructions or attempts to bypass a stated safeguard                               | Proposed action explicitly skips an isolation/approval step supplied in the procedure          | Physical safety, control timing and numerical limits require engineering validation.                      |
| Life/health insurance underwriting | Conflicting application facts or missing stated evidence                                                    | Rationale introduces an unsupported fact or an explicit potentially discriminatory basis       | Actuarial validity, lawful exceptions and group-level outcomes need specialist assessment.                |

The most reusable initial questions concern purpose, evidence support, contradiction, embedded instructions and stated safeguards. A fixed catalogue can be reused across sectors; claimed reliability must still be established separately in each supported domain.

## What Jev can process now

The current official Jev model accepts text, JSON objects and arrays of text values. It does not directly accept image, audio or video. V1 should therefore accept text/JSON. OCR, transcription or visual extraction could later supply a textual representation, but that only permits assessment of the representation; it does not validate the original image or recording. [Model documentation](https://docs.typesafe.ai/models)

Jev supports multiple typed questions against a shared state, which matches a fixed hypothesis set. Complex hypotheses must be decomposed into atomic questions and composed in code. [Primitives](https://docs.typesafe.ai/primitives)

Numerical reasoning and adversarial inputs are documented weaknesses. Keep arithmetic in code, and return unsupported when a Jev-only evaluation cannot substantiate a required analysis. A future hybrid implementation can preserve the same API while adding validated specialist evaluators. [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

The host constructs evidence IDs and verifies any selected references. Jev does not generate free-text rationales; explanations must come from templates and actual source support.

## Research milestones and release gates

1. Build a requirement-to-risk-to-evidence matrix reviewed against current law; label guidance and project interpretation separately.
2. Draft an initial fixed pack, perhaps 10–20 atomic hypotheses after decomposition. This is a starting research size, not an estimate of complete legal coverage.
3. Construct independently labeled cases across at least three materially different domains and pre/post contexts. Include inadequate evidence and non-applicability cases deliberately.
4. Compare Jev to simple rules and another evaluator using the same locked cases. Include context omission, conflicting intentions, injection and domain/language shifts.
5. Publish per-hypothesis/domain detection errors, false alarms, abstention, calibration, evidence correctness and latency. Assess whether abstention is useful or makes the engine uninformative.
6. Release a pack version only with documented supported contexts, known blind spots and model pinning. Changes to wording, criteria or models require regression checks.

Use independently reviewed cases rather than another model's answers as the sole ground truth. Keep a held-out test set, avoid paraphrase leakage, and distinguish novel discovery tests from the public regression suite. Public research should preserve contribution/data rights and comply with model-provider terms.

## Value and MVP

The heavy lifting removed is the translation of broad risks into specific evaluable questions, prompt design, reference cases, calibration, version maintenance and a consistent output format. A generic evaluation framework often still requires customers to supply much of that expertise.

The v1 core is: a fixed MIT hypothesis pack, a two-input evaluator, a Jev adapter, typed/versioned results, a research benchmark, a batch runner and a portable JSON export. Optional logging sinks make results easier to retain. A review UI, blocking policies, long-term retention service and full monitoring dashboard are integrations/extensions rather than required onboarding.

This provides direct support for risk-based testing and produces evidence usable by logging, monitoring and review workflows. The evaluator alone does not implement those surrounding workflows or complete their legal obligations.

Validate value through time to first useful finding, research/setup time saved, per-hypothesis reliability, reviewer effort and evidence-preparation effort. A target such as halving selected recurring work needs pilot measurement; no percentage of compliance is claimed.

The adoption opportunity is a reusable, validated default library that gives companies a useful first assessment immediately. Its usefulness depends on whether two supplied fields contain enough information for enough important checks. That is a central research question, alongside Jev's accuracy.

## Selected implementation language

Selected and authorized: **TypeScript on Node.js** for the v1 core, Jev adapter, batch-evaluation runner, CLI and optional HTTP service. TypeSafe provides an official JavaScript/TypeScript SDK with answer types inferred from question definitions. [Official SDK](https://docs.typesafe.ai/sdk/javascript)

Use strict compiler settings, including `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; avoid unchecked `any` at boundaries. Model findings and failures as discriminated unions. Validate external input and provider responses at runtime: compile-time types do not validate network data. Publish versioned JSON Schemas for the two-input contract and result format so other languages can integrate.

Keep hypothesis content and source mappings in versioned, validated data files, with typed builders for question construction. Isolate model-specific behavior behind an adapter and keep the core independent of an HTTP framework. Test legal/hypothesis behavior and model accuracy separately from code correctness.

The current architecture calls a hosted model rather than running local inference. Rust would not accelerate that remote inference; measure actual local CPU, memory and latency before adding another implementation language. Rust is a possible later choice for a demonstrated compute-heavy or native-deployment component, not a planned rewrite. Python and Go clients can use the HTTP/JSON contract without changing the implementation language.

## Initial delivery status

The repository implements the two-input library, twelve draft hypotheses, pinned Jev SDK adapter, runtime and JSON Schema contracts, JSON/JSONL CLI, 45 authored synthetic cases, benchmark harness, and offline tests. Optional services and logging sinks are future integrations. [Coverage](coverage.md) distinguishes the source baseline and remaining amendment review; [research gates](research.md) separate working software from independently validated hypotheses. No npm publication, exhaustive legal coverage, or measured live accuracy is claimed.
