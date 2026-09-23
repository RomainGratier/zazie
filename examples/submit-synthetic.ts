import { readFile } from 'node:fs/promises';
import { ZazieClient } from '@zazie/sdk-typescript';
import type { DemoKind, DemoReferences } from './synthetic-fixture.js';

/** Integration example: only public SDK calls, with no database or platform-service access. */
export async function submitSyntheticExample(
  kind: DemoKind,
  configPath: string | undefined,
): Promise<void> {
  if (!configPath)
    throw new Error(
      'Pass the JSON file produced by the seed command as the first argument.',
    );
  const input = JSON.parse(await readFile(configPath, 'utf8')) as {
    systems?: DemoReferences[];
  };
  const config = input.systems?.find((system) => system.kind === kind);
  if (
    !config ||
    ![
      'systemId',
      'versionId',
      'deploymentId',
      'datasetId',
      'definitionId',
    ].every((key) => typeof config[key as keyof DemoReferences] === 'string')
  )
    throw new Error(
      'Seed configuration is missing this system or its evidence references. Preserve the output from the first seed run.',
    );
  if (!process.env['ZAZIE_API_TOKEN'])
    throw new Error(
      'Set ZAZIE_API_TOKEN to an integration token scoped to this system; never commit it.',
    );
  const client = new ZazieClient({
    baseUrl: process.env['ZAZIE_API_URL'] ?? 'http://localhost:3000/api/v1',
    token: process.env['ZAZIE_API_TOKEN'],
  });
  const exam = kind === 'exam-monitoring';
  const measurements = {
    [exam ? 'false_flag_rate' : 'qualified_candidate_recall']: exam
      ? 0.05
      : 0.95,
    reviewer_intervention_success: 1,
    follow_up_recorded: 1,
  };
  const artifact = await client.uploadArtifact(
    config.systemId,
    {
      filename: `${kind}-generated-results.json`,
      contentType: 'application/json',
      provenance:
        'Synthetic example values created locally; no actual AI model was evaluated.',
    },
    new TextEncoder().encode(
      JSON.stringify({
        synthetic: true,
        measurements,
        limitations: [
          'Illustrative thresholds only',
          'Not real-system validation',
        ],
      }),
    ),
  );
  const now = new Date().toISOString();
  const evaluation = await client.submitEvaluation(config.systemId, {
    versionId: config.versionId,
    definitionId: config.definitionId,
    definitionRevision: config.definitionRevision,
    datasetId: config.datasetId,
    datasetRevision: config.datasetRevision,
    producer: `${kind}-sdk-example`,
    startedAt: now,
    completedAt: now,
    measurements,
    artifactIds: [artifact.id],
  });
  const buffer = client.bufferEvents(config.systemId, {
    onDeliveryFailure: (error, retainedEvents) =>
      process.stderr.write(
        `Evidence delivery failed; ${retainedEvents} event(s) remain in memory: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      ),
  });
  buffer.enqueue({
    schemaVersion: '1.0',
    eventId: crypto.randomUUID(),
    source: `${kind}-sdk-example`,
    type: 'oversight.override_recorded',
    versionId: config.versionId,
    deploymentId: config.deploymentId,
    occurredAt: now,
    payload: exam
      ? {
          synthetic: true,
          flagRef: 'generated-flag-002',
          timestampSeconds: 75,
          action: 'dismiss_false_flag',
        }
      : {
          synthetic: true,
          candidateRef: 'generated-applicant-002',
          action: 'advance_to_human_review',
        },
  });
  await buffer.close();
  const release = await client.checkRelease(
    config.systemId,
    config.versionId,
    config.deploymentId,
    'deploy',
  );
  process.stdout.write(
    `${JSON.stringify({ synthetic: true, evaluationId: evaluation.id, artifactId: artifact.id, release, nextStep: 'New evidence requires fresh human review and a release decision against a new snapshot. Inspect the concrete blockers in Zazie.' }, null, 2)}\n`,
  );
}
