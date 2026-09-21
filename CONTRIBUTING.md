# Contributing to Zazie

Zazie is a research preview. Useful contributions include small implementation fixes, precise hypothesis counterexamples, independent labels, and honest measurements of where a question fails.

## Local checks

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run check
npm run benchmark -- --report baseline-report.json
```

The standard suite is offline. Transport tests exercise the official SDK with an injected HTTP transport; they do not measure Jev accuracy. Live evaluation is explicit and needs `TYPESAFE_API_KEY`. Never include credentials, personal records, or private operational material in fixtures, logs, issues, or pull requests.

Run `npm run format` after editing and `npm run schemas` after changing contract schemas. Commit regenerated schemas together with their source. Keep all strict compiler options enabled, validate external values at runtime, and prefer small functions over new abstraction layers. Use provider injection for tests; the default pack stays fixed.

## Changes and review

Make atomic commits: each commit should explain one coherent change and include its meaningful tests and documentation. A larger initial feature can still be coherent. Use descriptive imperative messages, for example `fix: retain missing answers as evaluation errors`.

In pull requests, describe the concrete behavior before and after, why it matters, and the commands actually run. Explain remaining limits. Review error handling, evidence sufficiency, missing responses, raw result interpretation, input privacy, backwards compatibility, and package exports. Avoid broad refactors alongside behavior changes.

## Research changes

Hypothesis wording, applicability, evidence requirements, counterexamples, composition rules, and model versions can change evaluation behavior. Version the pack whenever its content changes. Keep stable IDs for the same observable question; introduce a new ID when its meaning changes. Update the corpus and source mappings together, record why labels changed, and run regressions. A successful unit test does not validate a hypothesis.

Corpus additions must be original or have documented redistribution rights compatible with their inclusion. Prefer fictional cases with minimal decisive evidence. Include counterexamples, omissions, non-applicability, and adversarial examples. Document label reasoning and reviewer provenance. Independently reviewed, held-out cases must remain separate from public development examples; do not silently promote synthetic labels to ground truth.

See [research gates](docs/research.md) before making reliability or legal coverage claims. Source mappings are project interpretations and must distinguish legal text, guidance, and research inference.

Contributions of original work are accepted under the repository's MIT license. External sources and provider terms are separate.
