# Synthetic CV-filtering integration

This example exercises evidence collection for a fictional CV-filtering AI system. Every candidate reference, metric, threshold, and result is synthetic. No CVs, personal data, model API key, or actual model execution are used.

Start the installation, apply migrations, explicitly bootstrap an editor/reviewer, and sign in. Then preserve the first seed command's JSON output:

```sh
pnpm --silent seed > /tmp/zazie-synthetic-demo.json
```

The seeded system contains a failing imported report, a corrected report, reviewed controls and procedures, an authorised internal release decision, a queued dossier, and a new scoring-prompt version that remains blocked. Existing synthetic systems are preserved on subsequent seed runs; they are not silently reset.

In Administration, create a short-lived integration token for this system with `artifacts:write`, `evaluations:write`, `events:write`, and `releases:read`. Export it as `ZAZIE_API_TOKEN` in your shell and set `ZAZIE_API_URL` to the installation's `/api/v1` URL. Never commit the token.

```sh
node --conditions=development --import tsx examples/cv-filtering/run.ts /tmp/zazie-synthetic-demo.json
```

This script uses only the public TypeScript SDK. It uploads a generated report, submits its measurements against the seeded version and criterion revisions, sends a synthetic recruiter intervention, explicitly flushes the bounded event buffer, and prints deployment blockers.

Submitting new evidence changes the basis for review. The prior snapshot remains preserved, while fresh control reviews and a release decision are required. No integration token can approve a release. Return to the UI as an authorised reviewer to complete those actions.

These tests establish the software's workflow behaviour, not the quality or legal compliance of a real hiring system. The configured draft provider profile displays its coverage and omissions in the application.
