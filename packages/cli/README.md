# Zazie CLI

Build the workspace with `pnpm build`. Run the local executable with
`node packages/cli/dist/index.js`; no published npm package is required.

Set `ZAZIE_API_URL` to your installation's `/api/v1` URL and `ZAZIE_API_TOKEN` to
an explicitly scoped integration credential. The token is never a command-line
argument and diagnostics redact it.

```sh
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js init manifest.json
node packages/cli/dist/index.js validate manifest manifest.json
node packages/cli/dist/index.js versions submit --system SYSTEM_ID manifest.json
node packages/cli/dist/index.js artifacts submit --system SYSTEM_ID \
  --provenance 'Synthetic test runner' --type application/json evidence.json
node packages/cli/dist/index.js evaluations submit --system SYSTEM_ID evaluation.json
node packages/cli/dist/index.js releases check --system SYSTEM_ID \
  --version VERSION_ID --deployment DEPLOYMENT_ID --purpose deploy --json
```

Release checks default to deployment approval. `--purpose review` checks readiness
only. Exit codes are **0** satisfied, **1** blocked/pending, and **2** unknown/error.
An unreachable API cannot make a release gate pass. Your CI must enforce the exit
status for this command to be an actual deployment gate.

Evaluation reports reference already-uploaded artifact IDs, exact version IDs,
criteria revisions and dataset revisions. Their measurements are imported
execution evidence, not independent validation by Zazie.

`dossiers export --system SYSTEM_ID --review REVIEW_ID --out dossier.zip` requests
an export and downloads it when ready. The credential must have `dossiers:write`
and `systems:read`; exports cannot be created by a read-only credential. All output
files use exclusive creation so existing work is not overwritten.

Human approvals and applicability decisions remain in the authenticated reviewer
workflow. The CLI does not grant reviewer authority to integration credentials.
