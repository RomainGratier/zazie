import { text, titleOf, type RecordData } from './api';
import type { Field, FormSpec } from './components';

export type Collections = Record<string, RecordData[]>;

const choices = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value
      .replace(/_/g, ' ')
      .replace(/^./, (letter) => letter.toUpperCase()),
  }));
const description = (key: string, label: string, required = true): Field => ({
  key,
  label,
  kind: 'textarea',
  required,
});

export function resourceForm(
  resource: string,
  records: Collections,
  userId: string,
): FormSpec {
  const options = (key: string) =>
    (records[key] ?? []).map((record) => ({
      value: text(record.id),
      label: `${titleOf(record)} · ${text(record.id).slice(0, 10)}`,
    }));
  const reference = (
    key: string,
    label: string,
    collection: string,
    required = true,
  ): Field => ({
    key,
    label,
    kind: 'select',
    required,
    options: options(collection),
  });
  const references = (
    key: string,
    label: string,
    collection: string,
  ): Field => ({
    key,
    label,
    kind: 'multiselect',
    options: options(collection),
  });
  const owner: Field = {
    key: 'ownerId',
    label: 'Accountable owner reference',
    required: true,
    initial: userId,
  };
  const version = reference('versionId', 'System version', 'versions');
  const forms: Record<string, FormSpec> = {
    versions: {
      title: 'Record a system version',
      description:
        'This immutable manifest identifies the components evaluated together. A changed component requires a new version.',
      fields: [
        {
          key: 'label',
          label: 'Version label',
          required: true,
          placeholder: '0.1.0',
        },
        {
          key: 'components',
          label: 'Versioned components',
          kind: 'json',
          required: true,
          initial:
            '{\n  "model": "model-version",\n  "prompt": "prompt-version",\n  "application": "commit-or-release"\n}',
          description:
            'Map each relevant component to its exact version or digest. Do not include raw prompts or personal data.',
        },
        description('changeSummary', 'What changed?'),
      ],
    },
    deployments: {
      title: 'Record deployment context',
      description:
        'Connect a version to the environment and operating conditions under review.',
      fields: [
        version,
        { key: 'name', label: 'Deployment name', required: true },
        {
          key: 'environment',
          label: 'Environment',
          required: true,
          placeholder: 'staging',
        },
        description('context', 'Operating context and limitations'),
        owner,
      ],
    },
    risks: {
      title: 'Record a risk',
      description:
        'Describe a concrete harm, the people affected, and the accountable decision about remaining risk.',
      fields: [
        { key: 'title', label: 'Risk title', required: true },
        description('harm', 'Potential harm'),
        description('affectedGroups', 'Affected groups'),
        description('foreseeableMisuse', 'Foreseeable misuse', false),
        {
          key: 'likelihood',
          label: 'Likelihood',
          kind: 'select',
          required: true,
          initial: 'unknown',
          options: choices(['low', 'medium', 'high', 'unknown']),
        },
        {
          key: 'severity',
          label: 'Severity',
          kind: 'select',
          required: true,
          initial: 'unknown',
          options: choices(['low', 'medium', 'high', 'critical', 'unknown']),
        },
        owner,
        {
          key: 'residualRiskDecision',
          label: 'Residual-risk decision',
          kind: 'select',
          required: true,
          initial: 'pending',
          options: choices(['pending', 'accepted', 'unacceptable']),
        },
        {
          ...description('rationale', 'Decision rationale', false),
          description:
            'Required when accepting or rejecting the remaining risk.',
        },
      ],
    },
    controls: {
      title: 'Configure a control',
      description:
        'Link a concrete safeguard to its risks, evidence requirements, and operating procedure. Configuration alone does not prove operation.',
      fields: [
        { key: 'title', label: 'Control title', required: true },
        description('description', 'How this control works'),
        owner,
        {
          key: 'requirementIds',
          label: 'Workflow requirements addressed',
          kind: 'multiselect',
          options: [
            { value: 'risk-management', label: 'Risk management' },
            { value: 'evaluation-evidence', label: 'Evaluation evidence' },
            { value: 'human-oversight', label: 'Human oversight' },
            {
              value: 'monitoring-follow-up',
              label: 'Monitoring and follow-up',
            },
          ],
          description:
            'The draft starter profile covers these four configured workflow requirements.',
        },
        references('riskIds', 'Risks addressed', 'risks'),
        references(
          'evaluationDefinitionIds',
          'Required evaluations',
          'evaluation-definitions',
        ),
        references('procedureIds', 'Required procedures', 'procedures'),
        {
          key: 'configured',
          label: 'The control is configured',
          kind: 'checkbox',
        },
        {
          key: 'maxEvidenceAgeDays',
          label: 'Maximum evidence age in days',
          kind: 'number',
          initial: '90',
          required: true,
        },
      ],
    },
    datasets: {
      title: 'Record a dataset version',
      description:
        'Describe provenance and coverage without uploading raw personal data.',
      fields: [
        { key: 'name', label: 'Dataset name', required: true },
        { key: 'version', label: 'Dataset version', required: true },
        description('provenance', 'Provenance'),
        description('coverage', 'Coverage and limitations'),
        description('notes', 'Additional notes', false),
      ],
    },
    'evaluation-definitions': {
      title: 'Define an evaluation',
      description:
        'Set acceptance criteria before importing measurements. Definitions are immutable and outcomes are calculated by Zazie.',
      fields: [
        { key: 'name', label: 'Evaluation name', required: true },
        reference('datasetId', 'Dataset version', 'datasets', false),
        {
          key: 'criteria',
          label: 'Metric acceptance criteria',
          kind: 'json',
          required: true,
          initial:
            '[\n  { "metric": "accuracy", "operator": "gte", "threshold": 0.95 }\n]',
          description:
            'Operators: gte (at least), lte (at most), eq (exactly). Each metric needs one criterion.',
        },
      ],
    },
    procedures: {
      title: 'Record a procedure version',
      description:
        'Record the operating procedure, then adopt it for this system with an explicit scope and owner.',
      fields: [
        { key: 'name', label: 'Procedure name', required: true },
        { key: 'version', label: 'Procedure version', required: true },
        description('content', 'Procedure instructions'),
        owner,
      ],
    },
    'procedure-adoptions': {
      title: 'Adopt an operating procedure',
      description:
        'Confirm which immutable procedure revision applies to this system.',
      fields: [
        reference('procedureId', 'Procedure', 'procedures'),
        {
          key: 'procedureRevision',
          label: 'Procedure revision',
          kind: 'number',
          initial: '1',
          required: true,
        },
        owner,
        description('scope', 'Scope of adoption'),
        description('rationale', 'Adoption rationale'),
      ],
    },
    evaluations: {
      title: 'Import evaluation measurements',
      description:
        'Imported results are externally supplied evidence. Zazie checks measurements against the recorded criteria; it does not verify execution.',
      submitLabel: 'Import measurements',
      fields: [
        version,
        reference(
          'definitionId',
          'Evaluation definition',
          'evaluation-definitions',
        ),
        {
          key: 'definitionRevision',
          label: 'Definition revision',
          kind: 'number',
          initial: '1',
          required: true,
        },
        reference('datasetId', 'Dataset version', 'datasets', false),
        {
          key: 'datasetRevision',
          label: 'Dataset revision',
          kind: 'number',
          description: 'Required if a dataset is selected.',
        },
        {
          key: 'measurements',
          label: 'Measurements',
          kind: 'json',
          required: true,
          initial: '{\n  "accuracy": 0.96\n}',
        },
        references('artifactIds', 'Supporting stored artifacts', 'artifacts'),
        {
          key: 'producer',
          label: 'Evaluation producer',
          required: true,
          placeholder: 'Test suite or team responsible for execution',
        },
        {
          key: 'startedAt',
          label: 'Execution started',
          kind: 'datetime-local',
          required: true,
        },
        {
          key: 'completedAt',
          label: 'Execution completed',
          kind: 'datetime-local',
          required: true,
        },
      ],
    },
    findings: {
      title: 'Create a finding',
      description:
        'Assign a concrete issue and identify whether it blocks a release.',
      fields: [
        { key: 'title', label: 'Finding title', required: true },
        description('description', 'Issue and expected follow-up'),
        owner,
        {
          key: 'severity',
          label: 'Severity',
          kind: 'select',
          required: true,
          initial: 'medium',
          options: choices(['low', 'medium', 'high', 'critical']),
        },
        {
          key: 'blocksRelease',
          label: 'This finding blocks release',
          kind: 'checkbox',
          initial: true,
        },
        { key: 'dueAt', label: 'Due date', kind: 'datetime-local' },
      ],
    },
    incidents: {
      title: 'Record an incident',
      description:
        'Record when the organisation became aware, affected deployments, and immediate corrective actions. This does not submit a regulatory notification.',
      fields: [
        { key: 'title', label: 'Incident title', required: true },
        description('description', 'Incident description'),
        owner,
        references('versionIds', 'Affected system versions', 'versions'),
        references('deploymentIds', 'Affected deployments', 'deployments'),
        {
          key: 'awareAt',
          label: 'Organisation became aware at',
          kind: 'datetime-local',
          required: true,
        },
        description('correctiveActions', 'Corrective actions', false),
      ],
    },
    events: {
      title: 'Record an oversight event',
      description:
        'Include only the metadata necessary for the evidence record. Do not include raw personal data.',
      fields: [
        {
          key: 'eventId',
          label: 'Source event reference',
          required: true,
          initial: crypto.randomUUID(),
        },
        { key: 'source', label: 'Source integration', required: true },
        {
          key: 'type',
          label: 'Event type',
          required: true,
          initial: 'oversight.override_recorded',
        },
        version,
        reference('deploymentId', 'Deployment', 'deployments', false),
        {
          key: 'occurredAt',
          label: 'Event occurred at',
          kind: 'datetime-local',
          required: true,
        },
        { key: 'correlationId', label: 'Related decision reference' },
        {
          key: 'payload',
          label: 'Event metadata',
          kind: 'json',
          required: true,
          initial: '{\n  "reason": "Describe the oversight action"\n}',
        },
      ],
    },
    'evidence-reuse': {
      title: 'Assess evidence reuse',
      description:
        'Record why existing evaluation evidence supports a different manifest. Reuse still requires a new release decision.',
      fields: [
        reference('evaluationId', 'Original evaluation', 'evaluations'),
        reference('targetVersionId', 'Target version', 'versions'),
        description('rationale', 'Impact assessment and justification'),
      ],
    },
  };
  const result = forms[resource];
  if (!result) throw new Error(`No form configured for ${resource}.`);
  return result;
}

export const systemForm: FormSpec = {
  title: 'Register an AI system',
  description:
    'Start with its purpose and accountable owner. You can add version manifests and evidence next.',
  submitLabel: 'Register system',
  fields: [
    {
      key: 'name',
      label: 'System name',
      required: true,
      placeholder: 'e.g. Candidate review assistant',
    },
    {
      key: 'intendedUse',
      label: 'Intended use',
      kind: 'textarea',
      required: true,
      description:
        'Describe the task, users, boundaries, and decisions the system supports.',
    },
    {
      key: 'ownerId',
      label: 'Accountable owner reference',
      required: true,
      placeholder: 'Person or team reference',
    },
    {
      key: 'highRiskCategory',
      label: 'Supplied high-risk classification',
      required: true,
      placeholder: 'e.g. Annex III — employment',
      description:
        'Your organisation supplies and remains responsible for this classification.',
    },
    {
      key: 'actorRoles',
      label: 'Your organisation’s role',
      kind: 'multiselect',
      initial: 'provider',
      required: true,
      options: [
        { value: 'provider', label: 'Provider' },
        { value: 'deployer', label: 'Deployer' },
      ],
    },
    {
      key: 'affectedPopulation',
      label: 'Affected population',
      kind: 'textarea',
      required: true,
      placeholder: 'Whose interests or decisions can be affected?',
    },
    {
      key: 'workflowPackId',
      label: 'Workflow pack ID',
      initial: 'eu-ai-act-provider-starter',
      required: true,
    },
    {
      key: 'workflowPackVersion',
      label: 'Workflow pack version',
      initial: '0.1.0',
      required: true,
    },
    {
      key: 'synthetic',
      label: 'This system contains synthetic demonstration data',
      kind: 'checkbox',
    },
  ],
};
