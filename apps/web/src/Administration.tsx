import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, LockKeyhole } from 'lucide-react';
import {
  asRecord,
  items,
  request,
  text,
  titleOf,
  type RecordData,
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
  RecordForm,
  RecordTable,
  Section,
  Status,
  type FormSpec,
} from './components';

export function Administration() {
  const client = useQueryClient();
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => request('/memberships'),
  });
  const tokens = useQuery({
    queryKey: ['tokens'],
    queryFn: () => request('/tokens'),
  });
  const systems = useQuery({
    queryKey: ['systems'],
    queryFn: () => request('/systems'),
  });
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => request<RecordData>('/overview'),
    refetchInterval: 20_000,
  });
  const health = asRecord(overview.data?.health);
  const workers = items(health.workers);
  const failedJobs = items(health.jobs);
  const [form, setForm] = useState<'membership' | 'token'>();
  const [editingMember, setEditingMember] = useState<RecordData>();
  const [secretNotice, setSecretNotice] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [revoke, setRevoke] = useState<RecordData>();
  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      request(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setRevoke(undefined);
      await client.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
  const options = items(systems.data).map((system) => ({
    value: text(system.id),
    label: titleOf(system),
  }));
  const membershipForm: FormSpec = {
    title: 'Provision workspace membership',
    description:
      'Identify this person by the exact OIDC issuer and subject. Email addresses do not establish membership.',
    submitLabel: 'Create membership',
    fields: [
      { key: 'displayName', label: 'Display name', required: true },
      { key: 'issuer', label: 'OIDC issuer URL', required: true },
      { key: 'subject', label: 'OIDC subject', required: true },
      {
        key: 'roles',
        label: 'Permissions',
        kind: 'multiselect',
        required: true,
        options: [
          { value: 'viewer', label: 'Viewer — inspect records' },
          { value: 'editor', label: 'Editor — manage systems and evidence' },
          {
            value: 'reviewer',
            label: 'Reviewer — record control and release decisions',
          },
          { value: 'admin', label: 'Administrator — manage workspace access' },
        ],
        description:
          'Approval requires reviewer permission, including for administrators.',
      },
      {
        key: 'allSystems',
        label: 'Allow access to all current and future systems',
        kind: 'checkbox',
      },
      {
        key: 'systemIds',
        label: 'Limit access to selected systems',
        kind: 'multiselect',
        options,
      },
    ],
  };
  const tokenForm: FormSpec = {
    title: 'Create integration credential',
    description:
      'Choose the minimum system and action permissions the integration needs. The credential is shown once.',
    submitLabel: 'Create credential',
    fields: [
      { key: 'name', label: 'Integration name', required: true },
      {
        key: 'systemIds',
        label: 'Permitted systems',
        kind: 'multiselect',
        required: true,
        options,
      },
      {
        key: 'actions',
        label: 'Permitted actions',
        kind: 'multiselect',
        required: true,
        options: [
          { value: 'systems:read', label: 'Read system records' },
          { value: 'versions:write', label: 'Submit version manifests' },
          {
            value: 'evaluations:write',
            label: 'Submit evaluation measurements',
          },
          { value: 'events:write', label: 'Submit events' },
          { value: 'artifacts:write', label: 'Upload artifacts' },
          { value: 'releases:read', label: 'Read release readiness' },
          {
            value: 'dossiers:write',
            label: 'Request dossier exports (also select read system records)',
          },
        ],
      },
      {
        key: 'expiresAt',
        label: 'Expires at',
        kind: 'datetime-local',
        required: true,
      },
    ],
  };
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Access, integrations, and health."
        description="Keep credentials scoped, responsibilities explicit, and your installation observable."
      />
      {secretNotice && (
        <div className="notice" role="status">
          {secretNotice}
        </div>
      )}
      {secret && (
        <section className="secret-panel" role="status">
          <div>
            <KeyRound size={22} />
            <h2>Save this credential now</h2>
          </div>
          <p>
            It is shown only here and cannot be retrieved later. Store it in
            your integration’s secret manager.
          </p>
          <code className="secret-value">{secret}</code>
          <div className="secret-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy credential'}
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setSecret(undefined);
                setCopied(false);
              }}
            >
              I saved it · dismiss
            </button>
          </div>
        </section>
      )}
      <Section
        title="Workspace members"
        description="Authentication comes from your identity provider; access is controlled here."
        action={
          <AddButton
            label="Add member"
            onClick={() => {
              setEditingMember(undefined);
              setForm('membership');
            }}
          />
        }
      >
        <ErrorNotice error={memberships.error} />
        {memberships.isPending ? (
          <Loading />
        ) : items(memberships.data).length ? (
          <RecordTable
            records={items(memberships.data)}
            columns={[
              {
                key: 'displayName',
                label: 'Person',
                render: (record) => <strong>{text(record.displayName)}</strong>,
              },
              {
                key: 'roles',
                label: 'Roles',
                render: (record) =>
                  Array.isArray(record.roles) ? (
                    <div className="inline-badges">
                      {record.roles.map((role) => (
                        <Badge key={String(role)}>{String(role)}</Badge>
                      ))}
                    </div>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'systemIds',
                label: 'System scope',
                render: (record) =>
                  record.allSystems === true
                    ? 'All systems'
                    : Array.isArray(record.systemIds)
                      ? `${record.systemIds.length} selected systems`
                      : 'None',
              },
              {
                key: 'active',
                label: 'Access',
                render: (record) => (
                  <Status
                    value={record.active === false ? 'revoked' : 'active'}
                  />
                ),
              },
            ]}
            action={(record) => (
              <button
                className="text-button"
                onClick={() => {
                  setEditingMember(record);
                  setForm('membership');
                }}
              >
                Manage access
              </button>
            )}
          />
        ) : (
          <Empty title="No members returned">
            Workspace administrators can provision people using their OIDC
            identity.
          </Empty>
        )}
      </Section>
      <Section
        title="Integration credentials"
        description="Revocation prevents future requests. Previously recorded evidence remains available."
        action={
          <AddButton
            label="Create credential"
            onClick={() => setForm('token')}
          />
        }
      >
        <ErrorNotice error={tokens.error} />
        {tokens.isPending ? (
          <Loading />
        ) : items(tokens.data).length ? (
          <RecordTable
            records={items(tokens.data)}
            columns={[
              {
                key: 'name',
                label: 'Integration',
                render: (record) => <strong>{text(record.name)}</strong>,
              },
              {
                key: 'actions',
                label: 'Permissions',
                render: (record) =>
                  Array.isArray(record.actions)
                    ? record.actions.join(', ')
                    : '—',
              },
              {
                key: 'expiresAt',
                label: 'Expires',
                render: (record) => formatDate(record.expiresAt),
              },
              {
                key: 'revokedAt',
                label: 'Status',
                render: (record) => (
                  <Status
                    value={
                      record.revokedAt
                        ? 'revoked'
                        : Date.parse(text(record.expiresAt)) < Date.now()
                          ? 'expired'
                          : 'active'
                    }
                  />
                ),
              },
            ]}
            action={(record) =>
              !record.revokedAt && (
                <button
                  className="text-button text-danger"
                  onClick={() => setRevoke(record)}
                >
                  Revoke
                </button>
              )
            }
          />
        ) : (
          <Empty title="No integration credentials">
            Create a scoped credential when you are ready to submit evidence
            from your tools.
          </Empty>
        )}
      </Section>
      <Section
        title="Installation health"
        description="Inspect live service information without exposing credentials or connection secrets."
      >
        <ErrorNotice error={overview.error} />
        {overview.isPending ? (
          <Loading />
        ) : (
          <div className="health-content">
            <h3>Background workers</h3>
            {workers.length ? (
              <RecordTable
                records={workers}
                columns={[
                  { key: 'id', label: 'Worker' },
                  {
                    key: 'heartbeatAt',
                    label: 'Last heartbeat',
                    render: (record) => formatDate(record.heartbeatAt),
                  },
                  {
                    key: 'status',
                    label: 'Activity',
                    render: (record) => {
                      const age =
                        Date.now() - Date.parse(text(record.heartbeatAt));
                      return (
                        <Badge
                          tone={
                            Number.isFinite(age) && age >= 0 && age <= 60_000
                              ? 'success'
                              : 'warning'
                          }
                        >
                          {Number.isFinite(age) && age >= 0 && age <= 60_000
                            ? 'Recent heartbeat'
                            : 'Stale or unknown heartbeat'}
                        </Badge>
                      );
                    },
                  },
                  {
                    key: 'lastError',
                    label: 'Latest reported error',
                    render: (record) => text(record.lastError, 'None reported'),
                  },
                ]}
              />
            ) : (
              <Empty title="No worker heartbeat recorded">
                Start the worker service and check its connection to this
                installation’s database.
              </Empty>
            )}
            <h3>Exhausted jobs</h3>
            {failedJobs.length ? (
              <>
                <p>
                  Inspect each job’s correlation reference and worker logs.
                  Resolve the underlying failure, then request the affected
                  operation again.
                </p>
                <RecordTable
                  records={failedJobs}
                  columns={[
                    { key: 'name', label: 'Operation' },
                    {
                      key: 'state',
                      label: 'State',
                      render: (record) => <Status value={record.state} />,
                    },
                    { key: 'attempts', label: 'Retry attempts' },
                    {
                      key: 'createdAt',
                      label: 'Created',
                      render: (record) => formatDate(record.createdAt),
                    },
                  ]}
                />
              </>
            ) : (
              <p>No exhausted jobs are reported by the queue.</p>
            )}
            <Details
              record={health}
              label="Inspect service configuration and references"
            />
            <div className="health-links">
              <a href="/health/ready" target="_blank" rel="noreferrer">
                Readiness endpoint
              </a>
              <a href="/health/live" target="_blank" rel="noreferrer">
                Liveness endpoint
              </a>
              <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                OpenAPI contract
              </a>
            </div>
            <p>
              Identity-provider and storage settings are configured by the
              deployment operator. They are not editable through the browser.
            </p>
          </div>
        )}
      </Section>
      <div className="coverage-note">
        <LockKeyhole size={20} />
        <div>
          <strong>Least privilege, explicit human authority.</strong>
          <p>
            A reviewer can approve their own submitted work when authorised.
            Every decision still requires a rationale and an exact evidence
            snapshot.
          </p>
        </div>
      </div>
      {form && (
        <RecordForm
          spec={
            form === 'membership'
              ? editingMember
                ? {
                    ...membershipForm,
                    title: 'Manage member access',
                    description:
                      'Update this person’s permissions and system scope. Their verified issuer and subject remain unchanged.',
                    submitLabel: 'Save access changes',
                    fields: [
                      ...membershipForm.fields
                        .filter(
                          (field) => !['issuer', 'subject'].includes(field.key),
                        )
                        .map((field) => ({
                          ...field,
                          initial:
                            field.kind === 'multiselect' &&
                            Array.isArray(editingMember[field.key])
                              ? (editingMember[field.key] as string[]).join(',')
                              : field.kind === 'checkbox'
                                ? editingMember[field.key] === true
                                : text(editingMember[field.key], ''),
                        })),
                      {
                        key: 'active',
                        label: 'Membership is active',
                        kind: 'checkbox',
                        initial: editingMember.active !== false,
                      },
                    ],
                  }
                : membershipForm
              : tokenForm
          }
          onClose={() => {
            setForm(undefined);
            setEditingMember(undefined);
          }}
          onSubmit={async (values, key) => {
            const path =
              form === 'membership'
                ? editingMember
                  ? `/memberships/${text(editingMember.id)}`
                  : '/memberships'
                : '/tokens';
            const response = await request<RecordData>(path, {
              method: form === 'membership' && editingMember ? 'PUT' : 'POST',
              body: JSON.stringify(
                form === 'membership' && editingMember
                  ? {
                      ...values,
                      issuer: editingMember.issuer,
                      subject: editingMember.subject,
                    }
                  : values,
              ),
              headers: { 'idempotency-key': key },
            });
            if (form === 'token') {
              const credential = response.token ?? response.secret;
              if (typeof credential === 'string') setSecret(credential);
              if (response.secretAlreadyIssued === true)
                setSecretNotice(
                  'This credential was already issued and its secret cannot be shown again. If you did not save it, revoke the credential below and create a replacement.',
                );
            }
            await client.invalidateQueries({
              queryKey: [form === 'membership' ? 'memberships' : 'tokens'],
            });
            if (form === 'membership')
              await client.invalidateQueries({ queryKey: ['session'] });
          }}
        />
      )}
      {revoke && (
        <RecordForm
          spec={{
            title: 'Revoke integration credential',
            description: `Revoke “${titleOf(revoke)}”? This integration will no longer be able to authenticate with this credential.`,
            submitLabel: 'Revoke credential',
            fields: [],
          }}
          onClose={() => setRevoke(undefined)}
          onSubmit={async () => {
            await revokeMutation.mutateAsync(text(revoke.id));
          }}
        />
      )}
    </>
  );
}
