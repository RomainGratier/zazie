# Jev integration

Zazie uses the official `@typesafe-ai/sdk` package and pins every request to
`jev-1.13.0`. It does not use a moving model alias. The adapter checks the returned
model ID before the core interprets findings. The SDK dependency and lockfile pin
the client separately from the model.

Set `TYPESAFE_API_KEY` in the server process environment before evaluating. Do not
place credentials in source files, command arguments, browser code, or submitted
data. The default `evaluate({ intention, data })` API uses this environment
credential; configuring a provider is optional.

## Request and answer contract

The adapter calls `TypeSafeClient.systemOne` once per evaluation. `state` contains
only the submitted `intention` and `data`. For each fixed hypothesis, the adapter
uses the SDK's `choice` builder to ask three independent questions:

| Question             | Choices                                     |
| -------------------- | ------------------------------------------- |
| Applicability        | `applicable`, `not_applicable`, `uncertain` |
| Evidence sufficiency | `sufficient`, `insufficient`, `unsupported` |
| Defined signal       | `detected`, `not_detected`, `uncertain`     |

Each question contains the hypothesis definition, evidence requirements,
counterexamples, limitations, and explicit instructions to treat submitted
content as untrusted context. Unmentioned controls and approvals are not assumed
absent. A harmful intention is not treated as safe merely because a proposed
action follows it. These instructions are precautions, not a demonstrated defense
against adversarial content.

The SDK returns `model`, `answers`, and token `usage`. Each Choice answer contains
`type`, `choice`, `confidence`, and `probabilities`. Zazie retains these raw Choice
fields and groups them under the hypothesis ID. The core validates each answer
at runtime and composes the three judgments into a finding; SDK TypeScript types
alone do not validate a network response. Missing or malformed answers produce
errors for affected hypotheses while intact peers remain assessable. An invalid
response envelope or a different model ID fails the entire evaluation.

Probability normalization is approximate: the official [response type documentation](https://docs.typesafe.ai/sdk/python/api/types/responses#typesafe_sdk.ChoiceAnswer.probabilities)
describes this explicitly, and the SDK's [integration tests](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/test/integration/api.integration.ts)
check an approximate sum. Zazie's live integration observed two-decimal values
whose sum was 0.99. The validator permits the corresponding bounded rounding
error and retains the original values. This observed precision is not a provider
guarantee; materially unnormalized distributions still fail validation.

These probabilities describe the model's choice distribution. They are not
severity estimates, measured real-world harm rates, or legal compliance scores.
Jev does not generate prose explanations. Zazie does not invent model rationales
or evidence citations. See TypeSafe's [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
and [typed primitives](https://docs.typesafe.ai/primitives).

## Transport behavior

Requests use the official SDK's `https://api.typesafe.ai` endpoint, with one
10-second attempt and no automatic retries. Failures remain visible rather than
silently becoming negative findings. SDK logging is explicitly disabled, including
when `TYPESAFE_LOG_LEVEL` requests debug output. Zazie ignores SDK environment
overrides for the endpoint and model so they cannot redirect credentials or change
the pinned evaluator. Submitted context is sent to the hosted provider; review
TypeSafe's [data handling and legal terms](https://docs.typesafe.ai/legal) for your
deployment.

`createJevProvider` optionally accepts `apiKey`, `timeoutMs`, and the official SDK's
`fetch` transport type. Transport injection lets tests inspect actual SDK requests
and return controlled HTTP responses without a credential or live request. SDK
errors are replaced by fixed public error messages; upstream bodies, credentials,
and nested causes are not returned.

## Scope and validation

The pinned model accepts textual and JSON context. Image, audio, and video
inspection are outside this integration. A transcript or textual description can
only establish facts about that representation. The provider documents limitations
in arithmetic, date comparison, adversarial content, and multi-step reasoning.
Questions include an explicit `unsupported` outcome when the required judgment
depends on those capabilities. This is a model judgment, not a guaranteed detector
of every unsupported task. See [model capabilities](https://docs.typesafe.ai/models)
and [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Offline adapter tests cover the official SDK request shape, model pinning,
question boundaries, malformed responses, omissions, transport failures,
credential handling, logging, and deadlines. They establish integration behavior
under mocked HTTP responses. They do not establish Jev accuracy, calibration,
resistance to injection, legal coverage, or domain reliability. Live benchmark
results must be reported separately with the model and hypothesis-pack versions.

Official documentation and SDK behavior were checked on 21 September 2026.
