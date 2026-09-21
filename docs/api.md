# API and portable results

`evaluate({ intention, data })` returns `Promise<EvaluationReport>`. These are the only accepted top-level input keys. `intention` is a nonblank string, trimmed at the boundary. `data` is a JSON value, including text, arrays, records, numbers, booleans, and null. In practice, named records with sources, rules, and proposed behavior give the evaluator more useful context. No field names inside `data` are required.

`parseInput(unknown)` validates JavaScript callers and imported JSON. Invalid input rejects with `InputValidationError` before any network call. Limits apply to the whole serialized object: 24,000 UTF-8 bytes, 32 object/array nesting levels measured from its root, and 2,000 UTF-16 code units for the trimmed intention. The original input also counts toward the byte limit. Values must serialize without loss: no undefined, non-finite numbers, bigint, cycles, sparse arrays, symbols, non-enumerable properties, getters, custom class instances/prototypes, serialization hooks, or reserved `__proto__` keys. The library does not mutate caller data.

Null, empty strings/containers, and containers containing only empty values produce `insufficient_evidence` locally. False and zero are substantive JSON values. An explicit top-level data descriptor with `modality` equal to `image`, `audio`, or `video`, or a top-level media data URI, produces `unsupported`. These conventions are optional representations within `data`, not extra API inputs. Other strings are treated as text, and embedded URLs/binary encodings are not fetched or decoded. Text extracted from media can be judged as text; that does not validate the original media.

## Interpretation

Each hypothesis receives three independent Choice answers. Core composition has this precedence:

1. Invalid/missing provider answer → `error` for that hypothesis.
2. Applicability `not_applicable` → `not_applicable`.
3. Evidence `unsupported` → `unsupported`.
4. Applicability `uncertain`, evidence `insufficient`, or signal `uncertain` → `insufficient_evidence`.
5. Applicable + sufficient + detected/not_detected → `signal_detected` / `no_signal_detected`.

This precedence preserves a definite non-applicability judgment before interpreting evidence questions asked speculatively about that hypothesis. All raw choices remain visible for inspection. The choices may disagree or be wrong: deterministic composition cannot establish semantic accuracy.

Every raw answer has `type: 'choice'`, `choice`, `confidence`, and a probability map over exactly the question's three options. The runtime checks finite values in [0,1], a sum within rounding tolerance of one, and selection of a maximum-probability option (ties allowed). Live Jev responses observed during integration used two decimal places; three individually rounded probabilities can sum to 0.99 or 1.01. The tolerance is three times half of a 0.01 rounding unit, plus floating-point epsilon. Raw values are preserved without renormalization. Confidence is preserved separately. This serialization tolerance is not a detection threshold; there is no universal confidence cutoff inserted by the core.

Error codes are `configuration`, `provider_failure`, `timeout`, and `invalid_response`. Summaries/error messages come from fixed host templates; neither submitted text nor arbitrary error messages are echoed. Global transport/model-envelope failures produce errors for every hypothesis. A malformed individual answer affects only its own hypothesis. Provider responses must name the pinned model exactly.

`evaluatedAt` is evaluation start time in UTC; `durationMs` is elapsed local evaluation time after input validation. `pack.version`, `pack.status`, `evaluator.provider`, and `evaluator.model` record requested/validated provenance. Local abstentions have `raw: null`; their evaluator metadata records the configured evaluator, not an assertion that it ran. No source excerpts or evidence citations are generated. Retain your own input/result association if your workflow needs one.

## Schemas and extension boundary

Generated schemas in [`schemas/`](../schemas) use JSON Schema draft 2020-12:

- `evaluation-input.v1.json`
- `evaluation-report.v1.json`
- `hypothesis-pack.v1.json`

They describe wire structure. JavaScript serialization limits and cross-field invariants (probability sums/selection, consistency between status and raw answers, and duplicate catalogue IDs) are also enforced by runtime validators; JSON Schema alone does not express them. Regenerate with `npm run schemas` and verify drift with `npm run schemas:check`.

The TypeScript API exports the corresponding runtime schemas and inferred types, `hypothesisPack`, `createEvaluator`, and `createJevProvider`. `createEvaluator(provider)` is an infrastructure/research seam: providers return unknown values which the core validates. It does not replace the fixed catalogue or add inputs to `evaluate`. Custom providers own their transport timeout and credential policy. The default provider is always the pinned Jev adapter.
