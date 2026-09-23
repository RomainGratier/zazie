import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  asRecord,
  flatten,
  items,
  request,
  resourcePath,
  text,
  titleOf,
  type RecordData,
  type Session,
} from './api';
import {
  AddButton,
  Badge,
  Details,
  Empty,
  ErrorNotice,
  formatDate,
  Loading,
  PageHeader,
  PrimaryButton,
  RecordForm,
  RecordTable,
  Section,
  Status,
  SummaryCard,
  type Column,
  type FormSpec,
} from './components';
import { resourceForm, systemForm, type Collections } from './forms';
import { ProcedureTemplates, WorkflowProfile } from './WorkflowProfile';
import { TourPanel, TourReturnLink, TourStartButton } from './SystemTour';

const tabs = [
  ['configuration', 'Risks & configuration'],
  ['operations', 'Operations'],
  ['evidence', 'Evaluations & evidence'],
  ['release', 'Release review'],
  ['documents', 'Documents'],
] as const;
const resourceKeys: Record<string, string> = {
  versions: 'versions',
  deployments: 'deployments',
  risks: 'risks',
  controls: 'controls',
  datasets: 'datasets',
  'evaluation-definitions': 'evaluationDefinitions',
  procedures: 'procedures',
  'procedure-adoptions': 'procedureAdoptions',
  evaluations: 'evaluations',
  artifacts: 'artifacts',
  events: 'events',
  'release-reviews': 'releaseReviews',
  'control-reviews': 'controlReviews',
  decisions: 'decisions',
  'applicability-decisions': 'applicabilityDecisions',
  findings: 'findings',
  incidents: 'incidents',
  dossiers: 'dossiers',
};
interface ActiveForm {
  spec: FormSpec;
  path: string;
  transform?: (values: RecordData) => RecordData;
  method?: string;
}

export function SystemWorkspace({
  systemId,
  tab,
  session,
}: {
  systemId: string;
  tab: string;
  session: Session;
}) {
  const client = useQueryClient();
  const overview = useQuery({
    queryKey: ['system', systemId],
    queryFn: () => request<RecordData>(resourcePath(systemId, 'overview')),
    refetchInterval: 20_000,
  });
  const [form, setForm] = useState<ActiveForm>();
  const [uploading, setUploading] = useState(false);
  const data = asRecord(overview.data);
  const system = flatten(data.system);
  const collections = Object.fromEntries(
    Object.entries(resourceKeys).map(([key, value]) => [
      key,
      items(data[value]),
    ]),
  ) as Collections;
  const collection = (name: string) => collections[name] ?? [];
  const canEdit = session.roles.some(
    (role) => role === 'admin' || role === 'editor',
  );
  const canReview = session.roles.includes('reviewer');
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['system', systemId] });
    await client.invalidateQueries({ queryKey: ['overview'] });
    await client.invalidateQueries({ queryKey: ['readiness', systemId] });
  };
  const create = (resource: string) =>
    setForm({
      spec: resourceForm(resource, collections, session.user.id),
      path: resourcePath(systemId, resource),
      transform:
        resource === 'events'
          ? (values) => ({ events: [{ schemaVersion: '1.0', ...values }] })
          : resource === 'evidence-reuse'
            ? (values) => ({
                ...values,
                expectedSystemRevision: system.evidenceRevision,
              })
            : undefined,
    });
  const edit = (resource: string, record: RecordData) => {
    const spec = resourceForm(resource, collections, session.user.id);
    const values = asRecord(record.data);
    setForm({
      path: `${resourcePath(systemId, resource)}/${text(record.id)}`,
      method: 'PUT',
      spec: {
        ...spec,
        title: `Update ${resource === 'risks' ? 'risk' : 'control'}`,
        fields: spec.fields.map((field) => ({
          ...field,
          initial:
            field.kind === 'json'
              ? JSON.stringify(values[field.key] ?? [], null, 2)
              : field.kind === 'multiselect' && Array.isArray(values[field.key])
                ? (values[field.key] as unknown[]).join(',')
                : values[field.key] === undefined
                  ? field.initial
                  : typeof values[field.key] === 'boolean'
                    ? (values[field.key] as boolean)
                    : String(values[field.key]),
        })),
      },
      transform: (value) => ({
        expectedRevision: record.revision,
        data: value,
      }),
    });
  };
  const resource = (
    key: string,
    title: string,
    description: string,
    columns: Column[],
    action?: (record: RecordData) => ReactNode,
  ) => (
    <Section
      id={`section-${key}`}
      title={title}
      description={description}
      action={
        canEdit && (
          <AddButton
            label={`Add ${key === 'evaluation-definitions' ? 'definition' : key === 'procedure-adoptions' ? 'adoption' : title.toLowerCase().replace(/s$/, '')}`}
            onClick={() => create(key)}
          />
        )
      }
    >
      {collection(key).length ? (
        <RecordTable
          records={collection(key)}
          columns={columns}
          action={action}
        />
      ) : (
        <Empty title={`No ${title.toLowerCase()} yet`}>{description}</Empty>
      )}
    </Section>
  );
  if (overview.isPending)
    return (
      <>
        <TourPanel placement="system" unavailable="loading" />
        <Loading label="Loading system workspace…" />
      </>
    );
  if (overview.error)
    return (
      <>
        <a href="#/systems" className="back-link">
          <ArrowLeft size={16} />
          All systems
        </a>
        <TourPanel placement="system" unavailable="error" />
        <ErrorNotice error={overview.error} />
      </>
    );
  const named: Column = {
    key: 'name',
    label: 'Name',
    render: (record) => <strong>{titleOf(record)}</strong>,
  };
  const owner: Column = { key: 'ownerId', label: 'Owner' };
  const revision: Column = { key: 'revision', label: 'Revision' };
  const actions = (key: string) =>
    canEdit
      ? (record: RecordData) => (
          <button className="text-button" onClick={() => edit(key, record)}>
            Update
          </button>
        )
      : undefined;
  const systemBase = `#/systems/${encodeURIComponent(systemId)}`;
  return (
    <>
      <a href="#/systems" className="back-link">
        <ArrowLeft size={15} />
        All systems
      </a>
      <PageHeader
        eyebrow="System workspace"
        title={text(system.name, 'AI system')}
        description={text(system.intendedUse, '')}
        action={
          <div className="header-badges">
            {tab === 'overview' && <TourStartButton />}
            {system.synthetic === true && (
              <Badge tone="warning">Synthetic example</Badge>
            )}
            <Badge>Draft workflow profile</Badge>
            {canEdit && (
              <button
                className="button button-secondary button-small"
                onClick={() =>
                  setForm({
                    path: `/systems/${encodeURIComponent(systemId)}`,
                    method: 'PUT',
                    spec: {
                      ...systemForm,
                      title: 'Update system context',
                      description:
                        'Changes to intended use or applicability require a fresh impact assessment for previously approved releases.',
                      submitLabel: 'Save context revision',
                      fields: systemForm.fields.map((field) => ({
                        ...field,
                        initial:
                          field.kind === 'multiselect' &&
                          Array.isArray(system[field.key])
                            ? (system[field.key] as string[]).join(',')
                            : field.kind === 'checkbox'
                              ? system[field.key] === true
                              : text(system[field.key], ''),
                      })),
                    },
                    transform: (values) => ({
                      expectedRevision: system.revision,
                      data: values,
                    }),
                  })
                }
              >
                Edit system context
              </button>
            )}
          </div>
        }
      />
      {tab !== 'overview' && <TourReturnLink />}
      <nav id="system-tabs" className="tabs" aria-label="System sections">
        {tabs.map(([id, name]) => (
          <a
            key={id}
            href={`${systemBase}/${id}`}
            className={tab === id ? 'active' : ''}
            aria-current={tab === id ? 'page' : undefined}
          >
            {name}
          </a>
        ))}
      </nav>
      <TourPanel placement="system" />
      {tab === 'overview' && (
        <>
          <div className="summary-grid three">
            <SummaryCard
              label="Version manifests"
              value={collection('versions').length}
              description="Immutable component records"
              href={`${systemBase}/configuration`}
            />
            <SummaryCard
              label="Evaluation runs"
              value={collection('evaluations').length}
              description="Imported execution evidence"
              href={`${systemBase}/evidence`}
            />
            <SummaryCard
              label="Open findings"
              value={
                collection('findings').filter(
                  (record) =>
                    record.resolved !== true && record.status !== 'resolved',
                ).length
              }
              description="Assigned follow-up"
              href={`${systemBase}/operations`}
            />
          </div>
          <div className="two-column">
            <Section
              id="system-context"
              title="System context"
              description="The purpose and responsibility behind the evidence."
            >
              <dl className="context-list">
                <div>
                  <dt>Accountable owner</dt>
                  <dd>{text(system.ownerId)}</dd>
                </div>
                <div>
                  <dt>Supplied classification</dt>
                  <dd>{text(system.highRiskCategory)}</dd>
                </div>
                <div>
                  <dt>Organisation’s roles</dt>
                  <dd>
                    {Array.isArray(system.actorRoles)
                      ? system.actorRoles.join(', ')
                      : 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt>Affected population</dt>
                  <dd>{text(system.affectedPopulation)}</dd>
                </div>
                <div>
                  <dt>Workflow pack</dt>
                  <dd>
                    {text(system.workflowPackId)} ·{' '}
                    {text(system.workflowPackVersion)}
                  </dd>
                </div>
                <div>
                  <dt>Current evidence revision</dt>
                  <dd>{text(system.evidenceRevision ?? system.revision)}</dd>
                </div>
              </dl>
            </Section>
            <Section
              title="Build your release record"
              description="A practical path from intended use to human decision."
            >
              <ol className="journey">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Define what will be released</strong>
                    <p>
                      Record version components, deployment context, risks, and
                      controls.
                    </p>
                    <a href={`${systemBase}/configuration`}>
                      Open configuration <ArrowRight size={13} />
                    </a>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Connect the supporting evidence</strong>
                    <p>
                      Set criteria, store artifacts, and import measurements.
                    </p>
                    <a href={`${systemBase}/evidence`}>
                      Open evidence <ArrowRight size={13} />
                    </a>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Make an accountable decision</strong>
                    <p>Resolve blockers and review the exact snapshot.</p>
                    <a href={`${systemBase}/release`}>
                      Open release review <ArrowRight size={13} />
                    </a>
                  </div>
                </li>
              </ol>
            </Section>
          </div>
          <Section
            title="Recent follow-up"
            description="Open findings are assigned work, not a compliance score."
          >
            {collection('findings').length ? (
              <RecordTable
                records={collection('findings').slice(0, 5)}
                columns={[
                  named,
                  owner,
                  {
                    key: 'status',
                    label: 'Status',
                    render: (record) => (
                      <Status
                        value={record.resolved === true ? 'resolved' : 'open'}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <Empty title="No findings recorded">
                Freshness checks and human reviews will add actionable follow-up
                here.
              </Empty>
            )}
          </Section>
        </>
      )}
      {tab === 'configuration' && (
        <>
          <WorkflowProfile
            pack={asRecord(data.workflowPack)}
            decisions={collection('applicability-decisions')}
            onReview={
              canReview
                ? (requirement) =>
                    setForm({
                      path: resourcePath(systemId, 'applicability-decisions'),
                      spec: {
                        title: 'Review requirement applicability',
                        description: `Record the organisation’s reasoned applicability decision for “${text(requirement.title)}”. This is not an exception to an unmet legal obligation.`,
                        submitLabel: 'Record applicability decision',
                        fields: [
                          {
                            key: 'applicability',
                            label: 'Applicability',
                            kind: 'select',
                            required: true,
                            options: [
                              {
                                value: 'applicable',
                                label: 'Applicable to this system',
                              },
                              {
                                value: 'not_applicable',
                                label:
                                  'Not applicable within the recorded scope',
                              },
                            ],
                          },
                          {
                            key: 'ownerId',
                            label: 'Accountable owner reference',
                            required: true,
                            initial: session.user.id,
                          },
                          {
                            key: 'scope',
                            label: 'Scope and boundaries of this decision',
                            kind: 'textarea',
                            required: true,
                          },
                          {
                            key: 'rationale',
                            label: 'Applicability rationale',
                            kind: 'textarea',
                            required: true,
                          },
                        ],
                      },
                      transform: (values) => ({
                        ...values,
                        requirementId: requirement.id,
                        expectedSystemRevision: system.evidenceRevision,
                      }),
                    })
                : undefined
            }
          />
          {resource(
            'versions',
            'Versions',
            'Record the exact model, prompt, application, and other components in a release.',
            [
              named,
              { key: 'changeSummary', label: 'Change summary' },
              {
                key: 'createdAt',
                label: 'Recorded',
                render: (record) => formatDate(record.createdAt),
              },
            ],
          )}
          {resource(
            'deployments',
            'Deployments',
            'A release decision applies to a specific version and operating context.',
            [
              named,
              {
                key: 'versionId',
                label: 'Version',
                render: (record) =>
                  titleOf(
                    collection('versions').find(
                      (version) => version.id === record.versionId,
                    ) ?? { name: record.versionId },
                  ),
              },
              { key: 'environment', label: 'Environment' },
              owner,
            ],
          )}
          {resource(
            'risks',
            'Risks',
            'Record harms, mitigations, and the rationale for accepting residual risk.',
            [
              named,
              {
                key: 'severity',
                label: 'Severity',
                render: (record) => <Status value={record.severity} />,
              },
              {
                key: 'residualRiskDecision',
                label: 'Residual-risk decision',
                render: (record) => (
                  <Status value={record.residualRiskDecision} />
                ),
              },
              owner,
            ],
            actions('risks'),
          )}
          {resource(
            'controls',
            'Controls',
            'Configuration, observed operation, and human review are assessed separately.',
            [
              named,
              {
                key: 'configured',
                label: 'Configuration',
                render: (record) => (
                  <Status
                    value={record.configured ? 'configured' : 'not_configured'}
                  />
                ),
              },
              {
                key: 'maxEvidenceAgeDays',
                label: 'Evidence window',
                render: (record) => `${text(record.maxEvidenceAgeDays)} days`,
              },
              owner,
            ],
            actions('controls'),
          )}
          {resource(
            'procedures',
            'Procedures',
            'Keep immutable operating instructions and their accountable owner.',
            [named, { key: 'version', label: 'Version' }, revision, owner],
          )}
          {resource(
            'procedure-adoptions',
            'Procedure adoptions',
            'Record why and where a procedure applies to this system.',
            [
              {
                key: 'procedureId',
                label: 'Procedure',
                render: (record) =>
                  titleOf(
                    collection('procedures').find(
                      (procedure) => procedure.id === record.procedureId,
                    ) ?? record,
                  ),
              },
              { key: 'scope', label: 'Adoption scope' },
              owner,
            ],
          )}
        </>
      )}
      {tab === 'evidence' && (
        <>
          <div className="notice">
            <Info size={18} />
            <div>
              <strong>Execution provenance stays visible.</strong>
              <p>
                Imported measurements are externally supplied evidence. Passing
                configured criteria does not establish independent verification
                or legal compliance.
              </p>
            </div>
          </div>
          {resource(
            'datasets',
            'Datasets',
            'Describe the version, provenance, and limits of the evaluation dataset.',
            [
              named,
              { key: 'version', label: 'Version' },
              { key: 'coverage', label: 'Coverage' },
            ],
          )}
          {resource(
            'evaluation-definitions',
            'Evaluation definitions',
            'Fix the metrics and acceptance criteria before assessing submitted measurements.',
            [
              named,
              revision,
              {
                key: 'criteria',
                label: 'Criteria',
                render: (record) =>
                  Array.isArray(record.criteria)
                    ? `${record.criteria.length} metrics`
                    : '—',
              },
            ],
          )}
          <Section
            title="Stored artifacts"
            description="Release evidence is kept in this installation and checked for availability."
            action={
              canEdit && (
                <AddButton
                  label="Upload artifact"
                  onClick={() => setUploading(true)}
                />
              )
            }
          >
            {collection('artifacts').length ? (
              <RecordTable
                records={collection('artifacts')}
                columns={[
                  {
                    key: 'filename',
                    label: 'File',
                    render: (record) => (
                      <strong>{text(record.filename)}</strong>
                    ),
                  },
                  { key: 'provenance', label: 'Provenance' },
                  {
                    key: 'availability',
                    label: 'Availability',
                    render: (record) => (
                      <Status value={record.availability ?? 'unchecked'} />
                    ),
                  },
                ]}
                action={(record) => (
                  <a
                    className="text-button"
                    href={`/api/v1${resourcePath(systemId, 'artifacts')}/${text(record.id)}/download`}
                    download
                  >
                    <Download size={14} />
                    Download
                  </a>
                )}
              />
            ) : (
              <Empty title="No stored evidence yet">
                Upload a report or supporting artifact before importing an
                evaluation.
              </Empty>
            )}
          </Section>
          {resource(
            'evaluations',
            'Evaluations',
            'Import measurements with their definition, dataset, manifest, timestamps, and artifacts.',
            [
              { key: 'producer', label: 'Producer' },
              {
                key: 'definitionId',
                label: 'Evaluation',
                render: (record) =>
                  titleOf(
                    collection('evaluation-definitions').find(
                      (definition) => definition.id === record.definitionId,
                    ) ?? record,
                  ),
              },
              {
                key: 'completedAt',
                label: 'Completed',
                render: (record) => formatDate(record.completedAt),
              },
              {
                key: 'provenance',
                label: 'Provenance',
                render: () => (
                  <Badge tone="warning">Imported · execution unverified</Badge>
                ),
              },
            ],
          )}
          {canReview && (
            <div className="inline-action">
              <p>
                Reusing evidence for a changed manifest requires a recorded
                impact assessment and a new release decision.
              </p>
              <button
                className="button button-secondary"
                onClick={() => create('evidence-reuse')}
              >
                Assess evidence reuse
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'release' && (
        <ReleasePanel
          systemId={systemId}
          system={system}
          collections={collections}
          canEdit={canEdit}
          canReview={canReview}
          setForm={setForm}
        />
      )}
      {tab === 'operations' && (
        <>
          {resource(
            'events',
            'Events',
            'Inspect relevant runtime and human-oversight metadata without collecting raw source content by default.',
            [
              { key: 'type', label: 'Event type' },
              { key: 'source', label: 'Source' },
              {
                key: 'occurredAt',
                label: 'Occurred',
                render: (record) => formatDate(record.occurredAt),
              },
              {
                key: 'createdAt',
                label: 'Received',
                render: (record) => formatDate(record.createdAt),
              },
            ],
          )}
          {resource(
            'findings',
            'Findings',
            'Assign an issue and resolve it with a rationale and supporting evidence.',
            [
              named,
              owner,
              {
                key: 'severity',
                label: 'Severity',
                render: (record) => <Status value={record.severity} />,
              },
              {
                key: 'status',
                label: 'Status',
                render: (record) => (
                  <Status
                    value={
                      record.resolved === true || record.status === 'resolved'
                        ? 'resolved'
                        : 'open'
                    }
                  />
                ),
              },
              {
                key: 'dueAt',
                label: 'Due',
                render: (record) => formatDate(record.dueAt),
              },
            ],
            canReview
              ? (record) =>
                  record.resolved !== true &&
                  record.status !== 'resolved' && (
                    <button
                      className="text-button"
                      onClick={() =>
                        setForm({
                          path: `${resourcePath(systemId, 'findings')}/${text(record.id)}/resolutions`,
                          spec: {
                            title: 'Resolve finding',
                            description: `Record how “${titleOf(record)}” was addressed.`,
                            fields: [
                              {
                                key: 'rationale',
                                label: 'Resolution rationale',
                                kind: 'textarea',
                                required: true,
                              },
                              {
                                key: 'artifactIds',
                                label: 'Supporting evidence',
                                kind: 'multiselect',
                                options: collection('artifacts').map(
                                  (artifact) => ({
                                    value: text(artifact.id),
                                    label: text(artifact.filename),
                                  }),
                                ),
                              },
                            ],
                          },
                          transform: (values) => ({
                            ...values,
                            expectedRevision: record.revision,
                          }),
                        })
                      }
                    >
                      Resolve finding
                    </button>
                  )
              : undefined,
          )}
          {resource(
            'incidents',
            'Incidents',
            'Document awareness, affected systems, and corrective actions. Regulatory notification remains a separate responsibility.',
            [
              named,
              {
                key: 'awareAt',
                label: 'Aware since',
                render: (record) => formatDate(record.awareAt),
              },
              owner,
            ],
          )}
        </>
      )}
      {tab === 'documents' && (
        <>
          <Documents
            systemId={systemId}
            collections={collections}
            canEdit={canEdit}
            setForm={setForm}
          />
          <ProcedureTemplates
            templates={items(data.procedureTemplates)}
            onUse={
              canEdit
                ? (template) => {
                    const initial: RecordData = {
                      name: text(template.title),
                      version: '1.0',
                      content: items(template.sections)
                        .map(
                          (section) =>
                            `${text(section.title)}\n[Complete for your system: ${text(section.instructions)}]`,
                        )
                        .join('\n\n'),
                    };
                    const spec = resourceForm(
                      'procedures',
                      collections,
                      session.user.id,
                    );
                    setForm({
                      path: resourcePath(systemId, 'procedures'),
                      spec: {
                        ...spec,
                        title: 'Adapt a procedure template',
                        description:
                          'Replace the bracketed guidance with your actual operating instructions before saving and adopting this procedure.',
                        fields: spec.fields.map((field) =>
                          initial[field.key]
                            ? { ...field, initial: text(initial[field.key]) }
                            : field,
                        ),
                      },
                    });
                  }
                : undefined
            }
          />
        </>
      )}
      <div className="coverage-note">
        <ShieldCheck size={19} />
        <div>
          <strong>Configured internal requirements · draft profile</strong>
          <p>
            Review the selected profile’s applicability and omissions. An
            internal release decision is not a regulatory certification.
          </p>
        </div>
      </div>
      {form && (
        <RecordForm
          key={`${form.path}-${form.spec.title}`}
          spec={form.spec}
          onClose={() => setForm(undefined)}
          onSubmit={async (values, key) => {
            await request(form.path, {
              method: form.method ?? 'POST',
              body: JSON.stringify(
                form.transform ? form.transform(values) : values,
              ),
              headers: { 'idempotency-key': key },
            });
            await refresh();
          }}
        />
      )}
      {uploading && (
        <ArtifactUpload
          systemId={systemId}
          onClose={() => setUploading(false)}
          onUploaded={refresh}
        />
      )}
    </>
  );
}

function ReleasePanel({
  systemId,
  system,
  collections,
  canEdit,
  canReview,
  setForm,
}: {
  systemId: string;
  system: RecordData;
  collections: Collections;
  canEdit: boolean;
  canReview: boolean;
  setForm: (form: ActiveForm) => void;
}) {
  const versions = collections.versions ?? [];
  const deployments = collections.deployments ?? [];
  const [versionId, setVersionId] = useState(text(versions[0]?.id, ''));
  const relevantDeployments = deployments.filter(
    (deployment) => deployment.versionId === versionId,
  );
  const [deploymentId, setDeploymentId] = useState(
    text(relevantDeployments[0]?.id, ''),
  );
  const [purpose, setPurpose] = useState<'review' | 'deploy'>('deploy');
  useEffect(() => {
    if (!versions.some((version) => version.id === versionId))
      setVersionId(text(versions[0]?.id, ''));
    if (
      !relevantDeployments.some((deployment) => deployment.id === deploymentId)
    )
      setDeploymentId(text(relevantDeployments[0]?.id, ''));
  }, [versions, relevantDeployments, versionId, deploymentId]);
  const readiness = useQuery({
    queryKey: [
      'readiness',
      systemId,
      versionId,
      deploymentId,
      purpose,
      system.evidenceRevision,
    ],
    queryFn: () =>
      request<RecordData>(
        `${resourcePath(systemId, 'releases/check')}?${new URLSearchParams({ versionId, deploymentId, purpose })}`,
      ),
    enabled: Boolean(versionId && deploymentId),
    refetchInterval: 20_000,
  });
  const result = asRecord(readiness.data);
  const blockers = items(result.blockers);
  const states = items(result.controls);
  const reviews = collections['release-reviews'] ?? [];
  const controls = collections.controls ?? [];
  return (
    <>
      <Section
        id="release-check"
        title="Check a release candidate"
        description="Choose the exact version and deployment. Review readiness and deployment approval are distinct gates."
      >
        <div className="release-selectors">
          <label>
            System version
            <select
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">Choose a version</option>
              {versions.map((version) => (
                <option key={text(version.id)} value={text(version.id)}>
                  {titleOf(version)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Deployment context
            <select
              value={deploymentId}
              onChange={(event) => setDeploymentId(event.target.value)}
            >
              <option value="">Choose a deployment</option>
              {relevantDeployments.map((deployment) => (
                <option key={text(deployment.id)} value={text(deployment.id)}>
                  {titleOf(deployment)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Check purpose
            <select
              value={purpose}
              onChange={(event) =>
                setPurpose(event.target.value as 'review' | 'deploy')
              }
            >
              <option value="deploy">Approved for deployment</option>
              <option value="review">Ready for human review</option>
            </select>
          </label>
          <button
            className="button button-secondary"
            aria-label="Refresh release check"
            disabled={!versionId || !deploymentId || readiness.isFetching}
            onClick={() => void readiness.refetch()}
          >
            <RefreshCw
              size={16}
              className={readiness.isFetching ? 'spin' : ''}
            />
            Check
          </button>
        </div>
        {!versionId || !deploymentId ? (
          <Empty title="Select a release context">
            Record a version and its deployment in Risks & configuration first.
          </Empty>
        ) : readiness.isPending ? (
          <Loading label="Checking current release evidence…" />
        ) : (
          <>
            <ErrorNotice error={readiness.error} />
            {readiness.data && (
              <div
                className={`readiness-result ${result.satisfied ? 'readiness-ready' : ''}`}
              >
                <div className="readiness-heading">
                  <span className="readiness-icon">
                    {result.satisfied ? <CheckCircle2 /> : <ClipboardCheck />}
                  </span>
                  <div>
                    <h3>
                      {result.approvedForDeployment
                        ? 'Approved for this deployment'
                        : result.readyForReview
                          ? 'Ready for a human release decision'
                          : 'This release needs follow-up'}
                    </h3>
                    <p>
                      {result.approvedForDeployment
                        ? 'The recorded approval applies to this manifest, context, and current evidence.'
                        : result.readyForReview
                          ? 'The configured evidence requirements are met. Deployment still requires an authorised approval.'
                          : `${blockers.length} blocking item${blockers.length === 1 ? '' : 's'} to address.`}
                    </p>
                  </div>
                  <Status value={result.status} />
                </div>
                {blockers.length > 0 && (
                  <ul className="blocker-list">
                    {blockers.map((blocker, index) => (
                      <li key={`${text(blocker.code)}-${index}`}>
                        <span className="blocker-dot" />
                        <div>
                          <strong>{text(blocker.message)}</strong>
                          {typeof blocker.ownerId === 'string' && (
                            <span>Owner: {text(blocker.ownerId)}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="scope-note">
                  {text(
                    result.scope,
                    'This checks your configured internal release requirements.',
                  )}
                </p>
                {canEdit &&
                  result.readyForReview === true &&
                  result.approvedForDeployment !== true && (
                    <PrimaryButton
                      onClick={() =>
                        setForm({
                          path: resourcePath(systemId, 'release-reviews'),
                          spec: {
                            title: 'Request release review',
                            description:
                              'Freeze the current manifest, evidence, criteria, and context for an accountable human decision.',
                            submitLabel: 'Freeze review snapshot',
                            fields: [],
                          },
                          transform: () => ({ versionId, deploymentId }),
                        })
                      }
                    >
                      <Layers size={16} />
                      Request release review
                    </PrimaryButton>
                  )}
              </div>
            )}
          </>
        )}
      </Section>
      <Section
        title="Control review"
        description="An authorised reviewer records their assessment of each current control and this candidate version."
      >
        {controls.length ? (
          <RecordTable
            records={controls}
            columns={[
              { key: 'title', label: 'Control' },
              {
                key: 'configuration',
                label: 'Configuration',
                render: (record) => (
                  <Status
                    value={
                      states.find((state) => state.id === record.id)
                        ?.configuration ??
                      (record.configured ? 'configured' : 'not_configured')
                    }
                  />
                ),
              },
              {
                key: 'operation',
                label: 'Operation',
                render: (record) => (
                  <Status
                    value={
                      states.find((state) => state.id === record.id)
                        ?.operation ?? 'unknown'
                    }
                  />
                ),
              },
              {
                key: 'review',
                label: 'Review',
                render: (record) => (
                  <Status
                    value={
                      states.find((state) => state.id === record.id)?.review ??
                      'pending'
                    }
                  />
                ),
              },
            ]}
            action={
              canReview && versionId
                ? (record) => (
                    <button
                      className="text-button"
                      onClick={() =>
                        setForm({
                          path: `${resourcePath(systemId, 'controls')}/${text(record.id)}/reviews`,
                          spec: {
                            title: 'Review control',
                            description: `Review “${titleOf(record)}” and the evidence supporting version “${titleOf(versions.find((version) => version.id === versionId) ?? {})}”.`,
                            submitLabel: 'Record review',
                            fields: [
                              {
                                key: 'rationale',
                                label: 'Review rationale',
                                kind: 'textarea',
                                required: true,
                              },
                            ],
                          },
                          transform: (values) => ({
                            ...values,
                            expectedRevision: record.revision,
                            expectedSystemRevision: system.evidenceRevision,
                            versionId,
                          }),
                        })
                      }
                    >
                      Review control
                    </button>
                  )
                : undefined
            }
          />
        ) : (
          <Empty title="No controls configured">
            Record risks and controls before requesting a release review.
          </Empty>
        )}
      </Section>
      <Section
        title="Release reviews & decisions"
        description="Each decision remains tied to its frozen snapshot. Subsequent changes do not rewrite history."
      >
        {reviews.length ? (
          <div className="review-list">
            {reviews.map((review) => {
              const decision =
                (collections.decisions ?? [])
                  .filter((entry) => entry.reviewId === review.id)
                  .at(-1) ?? asRecord(review.decision);
              const status = decision.decision ?? review.status ?? 'pending';
              return (
                <article key={text(review.id)} className="review-card">
                  <div className="review-card-heading">
                    <FileCheck2 size={21} />
                    <div>
                      <h3>
                        {titleOf(
                          versions.find(
                            (version) => version.id === review.versionId,
                          ) ?? { name: 'Release review' },
                        )}
                      </h3>
                      <p>
                        Requested {formatDate(review.createdAt)} · revision{' '}
                        {text(review.revision)}
                      </p>
                    </div>
                    <Status value={status} />
                  </div>
                  <Details
                    record={asRecord(review.snapshot ?? review)}
                    label="Inspect frozen review snapshot"
                  />
                  {typeof review.snapshotDigest === 'string' && (
                    <p className="hash-label">
                      Snapshot SHA-256{' '}
                      <code>{text(review.snapshotDigest)}</code>
                    </p>
                  )}
                  {typeof decision.rationale === 'string' && (
                    <blockquote>{text(decision.rationale)}</blockquote>
                  )}
                  {canReview &&
                    !['approved', 'rejected', 'approve', 'reject'].includes(
                      text(status),
                    ) && (
                      <div className="review-actions">
                        <button
                          className="button button-primary"
                          onClick={() =>
                            setForm({
                              path: `${resourcePath(systemId, 'release-reviews')}/${text(review.id)}/decisions`,
                              spec: {
                                title: 'Record release decision',
                                description:
                                  'Your decision applies only to the frozen snapshot. Zazie rejects an approval if relevant records changed since this review was requested.',
                                submitLabel: 'Record decision',
                                fields: [
                                  {
                                    key: 'decision',
                                    label: 'Decision',
                                    kind: 'select',
                                    required: true,
                                    options: [
                                      {
                                        value: 'approve',
                                        label: 'Approve for this deployment',
                                      },
                                      {
                                        value: 'reject',
                                        label: 'Reject this release',
                                      },
                                    ],
                                  },
                                  {
                                    key: 'rationale',
                                    label: 'Decision rationale',
                                    kind: 'textarea',
                                    required: true,
                                  },
                                ],
                              },
                              transform: (values) => ({
                                ...values,
                                expectedRevision: review.revision,
                              }),
                            })
                          }
                        >
                          Review and decide
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="No release decisions yet">
            Address the blockers above, review the controls, then request a
            frozen release review.
          </Empty>
        )}
      </Section>
    </>
  );
}

function Documents({
  systemId,
  collections,
  canEdit,
  setForm,
}: {
  systemId: string;
  collections: Collections;
  canEdit: boolean;
  setForm: (form: ActiveForm) => void;
}) {
  const reviews = collections['release-reviews'] ?? [];
  const dossiers = collections.dossiers ?? [];
  return (
    <>
      <div className="document-intro">
        <span className="document-icon">
          <FileCheck2 size={30} />
        </span>
        <div>
          <h2>An evidence record you can take with you.</h2>
          <p>
            Export a readable dossier, structured records, supporting files, and
            a hash manifest. Missing and unreviewed sections remain visible.
          </p>
        </div>
      </div>
      <Section
        id="dossier-exports"
        title="Dossier exports"
        description="Exports run in the background. This list updates while a job is processing."
        action={
          canEdit &&
          reviews.length > 0 && (
            <AddButton
              label="Request dossier"
              onClick={() =>
                setForm({
                  path: resourcePath(systemId, 'dossiers'),
                  spec: {
                    title: 'Export a review dossier',
                    description:
                      'Choose the frozen release review to export. This creates a durable background job.',
                    submitLabel: 'Request export',
                    fields: [
                      {
                        key: 'releaseReviewId',
                        label: 'Release review',
                        kind: 'select',
                        required: true,
                        options: reviews.map((review) => ({
                          value: text(review.id),
                          label: `${formatDate(review.createdAt)} · ${text(review.status, 'Pending')} · ${text(review.id).slice(0, 12)}`,
                        })),
                      },
                    ],
                  },
                })
              }
            />
          )
        }
      >
        {dossiers.length ? (
          <RecordTable
            records={dossiers}
            columns={[
              {
                key: 'createdAt',
                label: 'Requested',
                render: (record) => formatDate(record.createdAt),
              },
              {
                key: 'status',
                label: 'Job status',
                render: (record) => <Status value={record.status} />,
              },
              { key: 'attempts', label: 'Attempts' },
              {
                key: 'error',
                label: 'Issue',
                render: (record) => text(record.error, '—'),
              },
            ]}
            action={(record) =>
              ['complete', 'completed', 'ready'].includes(
                text(record.status),
              ) && (
                <a
                  className="text-button"
                  href={`/api/v1${resourcePath(systemId, 'dossiers')}/${text(record.id)}/download`}
                  download
                >
                  <Download size={14} />
                  Download dossier
                </a>
              )
            }
          />
        ) : (
          <Empty title="No dossiers requested">
            {reviews.length
              ? 'Choose a frozen review above to generate its evidence archive.'
              : 'Create a release review first. Its snapshot is the basis for a reproducible dossier.'}
          </Empty>
        )}
      </Section>
    </>
  );
}

function ArtifactUpload({
  systemId,
  onClose,
  onUploaded,
}: {
  systemId: string;
  onClose: () => void;
  onUploaded: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const file = values.get('file');
    if (!(file instanceof File) || !file.size) {
      setError(new Error('Choose a non-empty file.'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(
        new Error(
          'The browser upload limit is 10 MiB. Use the API for larger permitted artifacts.',
        ),
      );
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 8192)
        chunks.push(
          String.fromCharCode(...bytes.subarray(offset, offset + 8192)),
        );
      await request(resourcePath(systemId, 'artifacts'), {
        method: 'POST',
        headers: { 'idempotency-key': key.current },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          provenance: String(values.get('provenance') ?? ''),
          contentBase64: btoa(chunks.join('')),
        }),
      });
      await onUploaded();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      className="form-dialog"
      ref={dialog}
      aria-labelledby="artifact-upload-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="artifact-upload-title">Store supporting evidence</h2>
      </div>
      <p className="dialog-description">
        The file is stored in your installation. Upload only the evidence
        necessary for this system, and remove unrelated personal data.
      </p>
      <form
        onSubmit={(event) => void upload(event)}
        onChange={() => {
          key.current = crypto.randomUUID();
        }}
      >
        <div className="form-fields">
          <div className="field">
            <label htmlFor="artifact-file">Evidence file</label>
            <input
              id="artifact-file"
              name="file"
              type="file"
              required
              disabled={pending}
            />
            <p className="field-hint">
              Maximum browser upload: 10 MiB. Files are downloaded as
              attachments.
            </p>
          </div>
          <div className="field">
            <label htmlFor="artifact-provenance">Provenance and purpose</label>
            <textarea
              id="artifact-provenance"
              name="provenance"
              required
              rows={4}
              disabled={pending}
              placeholder="Where did this file come from, and what does it support?"
            />
          </div>
        </div>
        <ErrorNotice error={error} />
        <footer className="dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Upload size={16} />
            )}
            {pending ? 'Uploading…' : 'Store artifact'}
          </PrimaryButton>
        </footer>
      </form>
    </dialog>
  );
}
