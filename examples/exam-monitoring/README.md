# Synthetic exam-monitoring integration

This example uses timestamped suspected-misconduct flags and reviewer interventions. It does not collect video, run live surveillance, identify real students, or make academic decisions.

The same seed command described in the [CV example](../cv-filtering/README.md) creates this second system through the same platform service. Its imported fixture measures a synthetic false-flag rate and oversight exercise. Thresholds are illustrative.

Create a system-scoped integration token with `artifacts:write`, `evaluations:write`, `events:write`, and `releases:read`, then set `ZAZIE_API_TOKEN` and `ZAZIE_API_URL`. Run:

```sh
node --conditions=development --import tsx examples/exam-monitoring/run.ts /tmp/zazie-synthetic-demo.json
```

The script uses the same public SDK and resource contracts as the CV example. The event payload includes a generated flag reference, a timestamp within a simulated recording, and a review outcome. Domain differences are confined to example configuration and payload data.

The result identifies the new evidence and any unresolved release blockers. New evidence requires an authorised human review against a new snapshot; the script cannot approve a deployment.
