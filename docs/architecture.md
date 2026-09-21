# Architecture

Zazie is one ESM package for Node.js. There is no HTTP framework, database, background monitor, dashboard, or deployment service in the core.

```text
evaluate({ intention, data })
       │
       ├── input validation + local empty/modality checks
       │
       ├── fixed versioned JSON catalogue
       │       └── observable questions and evidence boundaries
       │
       ├── Jev adapter → official TypeSafe SDK → hosted model
       │       └── applicability / evidence / signal choices
       │
       └── response validation + conservative composition
               └── portable EvaluationReport
```

`src/contracts.ts` owns runtime schemas and inferred TypeScript types. `src/input.ts` rejects lossy or oversized input before a provider sees it. `src/catalogue/` owns the only pack and freezes it recursively. `src/evaluator.ts` owns status composition and redacted error handling. `src/provider.ts` is the small model-independent interface; only `src/providers/jev.ts` imports the SDK.

The adapter submits all 36 questions in one request sharing the supplied state. Each question repeats the trust and evidence rules because the choices are evaluated independently. Three atomic judgments let the core abstain even when a speculative signal question returns a positive or negative answer. A malformed peer response cannot silently become a negative finding.

`src/cli.ts` streams JSONL with bounded line buffers and output backpressure. `src/benchmark.ts` compares explicitly labeled pairs, preserving abstentions and errors. It accepts an evaluator function so future comparisons can reuse the same cases and metrics. The always-abstain baseline does not simulate a model's answers.

Tests exercise parsing, composition, provider wire requests with an injected HTTP transport, malformed responses, error redaction, corpus invariants, CLI behavior, and metric denominators. Live smoke tests are explicit; independent domain validation is a separate research activity.

The initial design favors readable functions and a single package. Add services, storage adapters, or another language only when a demonstrated integration or performance need justifies them. All workflows retain the two-input contract and fixed hypotheses.
