# Connect your AI system to Zazie

Start with the [README's first event](../README.md#send-data-from-your-ai-system). This guide continues from a running installation and explains what to connect in your application and evaluation jobs.

Your AI system keeps running where it does today. Add server-side requests at the points where useful evidence is produced: after an evaluation finishes, when a reviewer intervenes, and when your deployment pipeline checks release approval. Zazie does not intercept model calls or collect source data automatically.

## Decide what to send and when

| Where your team adds the integration                                         | What to send                                                                                                               | What Zazie does with it                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Your application backend, after a human intervention                         | An event describing the action and its system version; include a deployment and an opaque decision reference when relevant | Records it under **Operations → Events**, with its occurrence and receipt times            |
| Your evaluation job, after running tests                                     | A supporting report file, followed by measurements for the exact version, definition revision and dataset revision         | Stores the evidence and calculates whether the configured criteria are satisfied           |
| Your release pipeline, when the model, prompt, code or configuration changes | A new immutable version manifest identifying the changed components                                                        | Gives that release its own evidence and review history                                     |
| Your deployment pipeline, immediately before deployment                      | A release check for the version and deployment being released                                                              | Reports blockers or an applicable internal approval; your pipeline must enforce the result |

For example, a CV-filtering backend can emit an event after a recruiter changes a recommendation. Its evaluation job can separately measure how often qualified candidates remain eligible for human review. Your engineers implement the intervention and tests; your domain and review teams decide whether their behaviour and evidence are adequate.

**An event is a record, not an assessment.** Event types and their JSON metadata are supplied by your integration. Sending a type such as `oversight.override_recorded` does not prove the override worked. Zazie does not automatically interpret arbitrary event payloads, create a finding from them, or invalidate an approval because an event was received. Use **Operations → Findings** or **Incidents** for accountable follow-up. The worker separately checks configured evidence freshness and availability.

## Set up the system's evidence requirements once

Register the system and its responsible people using the [onboarding steps](../README.md#set-up-your-first-real-ai-system). Before submitting evaluations, prepare these records:

1. In **Risks & configuration**, add a **Version** describing the exact model, prompt, application and configuration being assessed. Add a **Deployment** for that version and its operating context.
2. In **Evaluations & evidence**, add a **Dataset** describing its provenance, coverage, limitations and version. Add an **Evaluation definition** linked to that dataset, with the metric names, comparison operators and thresholds your team has justified.
3. In **Risks & configuration**, record risks and adopted procedures, then connect them and the evaluation definitions to **Controls**, with responsible owners. Mark a control configured only when its configuration actually exists in your system.

A test report can be stored before every control is complete. It will not establish release readiness until the relevant controls, procedures, evidence and human reviews are in place. See [the workflow concepts](concepts.md) for the distinction between configuration, evidence of operation and review.

The local demo already contains these records. For its CV-filtering example, use:

| Value for your integration | Where to find it in **AI systems → Synthetic CV filtering**                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| System ID                  | The browser URL contains `#/systems/SYSTEM_ID`; copy only the ID segment                                                                    |
| Version ID                 | **Risks & configuration → Versions → synthetic-v1 → Inspect record → Id**                                                                   |
| Deployment ID, when needed | **Risks & configuration → Deployments → Synthetic staging → Inspect record → Id**                                                           |
| Dataset ID and revision    | **Evaluations & evidence → Datasets → Generated applicant qualification cases → Inspect record → Id / Revision**                            |
| Definition ID and revision | **Evaluations & evidence → Evaluation definitions → Synthetic quality, oversight and monitoring exercise → Inspect record → Id / Revision** |

IDs identify stored records. Revisions are positive integers identifying their exact content; a dataset's free-text version label is a different field. Record both when configuring the job, and change that configuration deliberately when adopting new criteria or data. Do not silently fetch the newest revision after running an evaluation against an older one.

For automated discovery, `GET /api/v1/systems` lists systems and `GET /api/v1/systems/SYSTEM_ID/overview` lists their records. These requests require `systems:read`. Overview records have the shape `{ "id": "...", "revision": 1, "data": { ... } }`, in collections such as `versions`, `deployments`, `datasets` and `evaluationDefinitions`.

## Give each integration only the permissions it needs

In **Administration → Create credential**, choose an **Integration name**, **Permitted systems**, **Permitted actions** and **Expires at**. Save the secret shown once in your backend or CI secret store.

| Integration task                            | Required action, as shown in the UI                     | API scope                              |
| ------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| Send operational events                     | Submit events                                           | `events:write`                         |
| Upload a report and submit its measurements | Upload artifacts **and** Submit evaluation measurements | `artifacts:write`, `evaluations:write` |
| Discover IDs or read stored records         | Read system records                                     | `systems:read`                         |
| Submit a new manifest                       | Submit version manifests                                | `versions:write`                       |
| Check a release before deployment           | Read release readiness                                  | `releases:read`                        |

Keep credentials server-side. Do not embed them in a browser bundle, mobile application, source repository or model prompt. Use HTTPS outside the local demo. Integration credentials can submit evidence and check readiness; they cannot approve a release. Administrator access alone also does not confer human reviewer permission.

## Send a report and its measurements

This example uses Node's built-in Fetch and Buffer APIs; it needs no npm package. Use the project's supported Node runtime if running it from this checkout. Put the script in your evaluation job, or save it locally as `submit-evaluation.mjs` for the synthetic demo.

Set `ZAZIE_API_URL` to your installation's URL including `/api/v1`, and inject `ZAZIE_API_TOKEN` from your secret store. Replace the four placeholder IDs and two revisions in the script with the demo records above. A token with `artifacts:write` and `evaluations:write` for that system is sufficient.

Choose a run ID and timestamp **once** for this submission. Keep both values unchanged if retrying after an interruption:

```sh
export ZAZIE_RUN_ID="synthetic-cv-check-$(date -u +%Y%m%dT%H%M%SZ)"
export ZAZIE_RUN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node submit-evaluation.mjs
```

```js
// submit-evaluation.mjs — synthetic values, not a real model evaluation.
const required = (name) => {
  if (!process.env[name])
    throw new Error(`Set ${name} before running this script`);
  return process.env[name];
};
const baseUrl = required('ZAZIE_API_URL').replace(/\/$/, '');
const token = required('ZAZIE_API_TOKEN');
const runId = required('ZAZIE_RUN_ID');
const runAt = required('ZAZIE_RUN_AT');
const systemId = 'REPLACE_SYSTEM_ID';
const versionId = 'REPLACE_VERSION_ID';
const definitionId = 'REPLACE_DEFINITION_ID';
const definitionRevision = 1; // Replace with the inspected Revision.
const datasetId = 'REPLACE_DATASET_ID';
const datasetRevision = 1; // Replace with the inspected Revision.

const measurements = {
  qualified_candidate_recall: 0.95,
  reviewer_intervention_success: 1,
  follow_up_recorded: 1,
};

async function submit(resource, body, key) {
  const response = await fetch(
    `${baseUrl}/systems/${encodeURIComponent(systemId)}/${resource}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    },
  );
  if (!response.ok) {
    throw new Error(
      `${resource}: HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

const artifact = await submit(
  'artifacts',
  {
    filename: 'synthetic-cv-results.json',
    contentType: 'application/json',
    provenance: 'Synthetic demonstration generated locally; no model was run.',
    contentBase64: Buffer.from(
      JSON.stringify({
        synthetic: true,
        runId,
        completedAt: runAt,
        measurements,
      }),
    ).toString('base64'),
  },
  `${runId}:artifact`,
);

const evaluation = await submit(
  'evaluations',
  {
    versionId,
    definitionId,
    definitionRevision,
    datasetId,
    datasetRevision,
    producer: 'synthetic-cv-fetch-example',
    startedAt: runAt,
    completedAt: runAt,
    measurements,
    artifactIds: [artifact.id],
  },
  `${runId}:evaluation`,
);

console.log(
  JSON.stringify(
    {
      artifactId: artifact.id,
      evaluationId: evaluation.id,
      results: evaluation.data.results,
      executionVerification: evaluation.data.executionVerification,
    },
    null,
    2,
  ),
);
```

The first request is `POST /systems/SYSTEM_ID/artifacts`. It stores the report in Zazie's artifact storage and returns a record whose top-level `id` is used in the evaluation's `artifactIds`. The second request is `POST /systems/SYSTEM_ID/evaluations`. Its response includes server-calculated criteria in `data.results` and `data.executionVerification: "imported_unverified"`.

All IDs must belong to the same system and organisation. The dataset must match the definition; both supplied revisions must match the referenced records. Send actual execution times for a real evaluation, with completion at or after the start and no later than the present. Replace the generated report with your runner's report and the synthetic measurements with its measured results. The example definition requires all three metrics; they and its thresholds are illustrative, not recommendations for hiring decisions.

Refresh **Evaluations & evidence** to see the stored artifact and evaluation marked **Imported · execution unverified**. Inspect the evaluation record to see which configured criteria passed or failed. Zazie recalculates those comparisons; it does not verify the runner's execution or the adequacy of its dataset. A submitted `passed: true` is not an accepted substitute for measurements.

**Adding evidence changes the review basis.** If you send this to the already-approved demo, the historical approval remains readable, but current control reviews and a fresh release decision are required. In **Release review**, inspect the concrete blockers and owners. An authorised reviewer resolves the review work and decides against a newly frozen snapshot; passing this example does not automatically approve anything.

## Handle changed models, prompts and criteria deliberately

When your scoring prompt changes, submit a new manifest with `versions:write`, for example:

```json
{
  "label": "cv-filter-v2",
  "components": {
    "model": "YOUR_IMMUTABLE_MODEL_VERSION",
    "prompt": "YOUR_PROMPT_CONTENT_HASH",
    "code": "YOUR_COMMIT_ID"
  },
  "changeSummary": "Changed the scoring prompt; evaluate and review this release."
}
```

Send it to `POST /api/v1/systems/SYSTEM_ID/versions` with a new idempotency key. Save the response's `id`, create the deployment context for that version, and bind new evaluations and events to it. Do not keep using the previous version ID for changed behaviour.

Changed datasets, criteria or policies may also require reassessment. A reviewer can explicitly assess reuse of earlier evidence through **Evaluations & evidence → Assess evidence reuse**, recording the impact assessment. Reuse still requires a new release decision; an old approval does not transfer to a new manifest.

## Enforce approval in your deployment pipeline

Use a credential with `releases:read`. A read-only request to `/api/v1/systems/SYSTEM_ID/releases/check?versionId=VERSION_ID&deploymentId=DEPLOYMENT_ID&purpose=deploy` returns `satisfied` and concrete `blockers`. The HTTP request succeeding is not an approval: your integration must inspect the body.

The built CLI makes the CI exit status explicit. From a built checkout, with `ZAZIE_API_URL` and `ZAZIE_API_TOKEN` injected:

```sh
node packages/cli/dist/index.js releases check \
  --system SYSTEM_ID --version VERSION_ID --deployment DEPLOYMENT_ID \
  --purpose deploy --json
```

Only exit **0** permits the next deployment step; **1** means blocked and **2** means error or unknown. Configure CI to stop on either nonzero status, including an unavailable API. `--purpose review` only checks readiness for review. `--purpose deploy` also requires an applicable human approval without blocking reassessment. Zazie does not block a deployment unless your pipeline enforces this check.

## Preserve delivery and retry safely

- Store the run or event ID, exact request body, timestamps and delivery state in your application's durable job/outbox storage when losing evidence would matter. A timeout can happen after the server accepted the request.
- Retry the same operation with the **same credential identity, idempotency key and payload**. Keys are scoped to organisation, system and operation; use 1–128 letters, digits, `.`, `_`, `:` or `-`. The example's run ID must leave room for its suffixes. Changed payloads or actors return a conflict rather than silently overwriting the earlier record.
- For events, preserve `source` and `eventId` as well. Reusing that source event ID with different content also causes a conflict. A new evaluation run or a genuinely new event needs its own identity.
- Retry transient failures with finite limits and backoff, and surface permanent failures to an owner. Do not retry authentication failures or revision conflicts indefinitely. A revision conflict requires checking which dataset or criteria actually governed the run.
- Revoke expired or compromised credentials in **Administration** and replace them in your secret store. Do not log bearer tokens. Decide which evidence and opaque references are necessary before sending content; no raw CVs, prompts, outputs or video need to accompany the first event.

The [TypeScript SDK](../packages/sdk-typescript/README.md) adds contract validation, finite request retries and bounded event buffering. Its memory buffer is not durable across process termination. The [CLI](../packages/cli/README.md) supports local validation, submissions and release checks. Both are currently supplied from this checkout, without a published npm package. Other languages can call the same [OpenAPI contract](../openapi.json), also served at `/api/v1/openapi.json`.
