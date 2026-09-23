import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import { ApiError, asRecord, text, titleOf, type RecordData } from './api';

export function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Status({ value }: { value: unknown }) {
  const raw = text(value, 'Unknown');
  const label =
    (
      {
        approve: 'approved',
        reject: 'rejected',
        ready_for_review: 'ready for review',
      } as Record<string, string>
    )[raw] ?? raw;
  const normalized = label.toLowerCase();
  const tone = [
    'approved',
    'satisfied',
    'passed',
    'complete',
    'completed',
    'resolved',
    'observed_working',
    'ready',
  ].includes(normalized)
    ? 'success'
    : [
          'blocked',
          'failed',
          'failing',
          'rejected',
          'exhausted',
          'observed_failing',
        ].includes(normalized)
      ? 'danger'
      : [
            'pending',
            'stale',
            'reassessment',
            'open',
            'unknown',
            'review_required',
            'draft',
          ].includes(normalized)
        ? 'warning'
        : 'neutral';
  return <Badge tone={tone}>{humanize(label)}</Badge>;
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="notice notice-error">
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        <strong>
          {error instanceof Error
            ? error.message
            : 'Something went wrong. Please try again.'}
        </strong>
        {error instanceof ApiError && error.requestId && (
          <p>Request reference: {error.requestId}</p>
        )}
        {error instanceof ApiError && error.details !== undefined && (
          <details>
            <summary>Validation details</summary>
            <pre>{JSON.stringify(error.details, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading records…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Loader2 size={19} className="spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <FileText size={23} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="lede">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="panel"
      tabIndex={id ? -1 : undefined}
      aria-label={id ? title : undefined}
    >
      <header className="section-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      className="button button-primary"
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export interface Field {
  key: string;
  label: string;
  kind?:
    | 'text'
    | 'textarea'
    | 'json'
    | 'number'
    | 'select'
    | 'multiselect'
    | 'checkbox'
    | 'datetime-local';
  description?: string;
  placeholder?: string;
  required?: boolean;
  initial?: string | boolean;
  options?: { value: string; label: string }[];
}

export interface FormSpec {
  title: string;
  description: string;
  fields: Field[];
  submitLabel?: string;
}

export function RecordForm({
  spec,
  onSubmit,
  onClose,
}: {
  spec: FormSpec;
  onSubmit: (values: RecordData, key: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const key = useRef(crypto.randomUUID());
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.showModal();
    const element = dialog.current;
    return () => {
      element?.close();
      queueMicrotask(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected)
          trigger.focus();
        else document.getElementById('main-content')?.focus();
      });
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const values: RecordData = {};
    try {
      for (const field of spec.fields) {
        const raw = String(form.get(field.key) ?? '').trim();
        if (field.kind === 'multiselect') {
          values[field.key] = form.getAll(field.key).map(String);
          if (field.required && !(values[field.key] as string[]).length)
            throw new Error(
              `Select at least one option for ${field.label.toLowerCase()}.`,
            );
        } else if (field.kind === 'checkbox')
          values[field.key] = form.has(field.key);
        else if (raw !== '') {
          if (field.kind === 'json') {
            try {
              values[field.key] = JSON.parse(raw);
            } catch {
              throw new Error(`${field.label} must contain valid JSON.`);
            }
          } else if (field.kind === 'number') {
            const number = Number(raw);
            if (!Number.isFinite(number))
              throw new Error(`${field.label} must be a finite number.`);
            values[field.key] = number;
          } else if (field.kind === 'datetime-local')
            values[field.key] = new Date(raw).toISOString();
          else values[field.key] = raw;
        }
      }
      setPending(true);
      await onSubmit(values, key.current);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="form-dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onClose();
      }}
      aria-labelledby={`${formId}-title`}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Workspace record</p>
          <h2 id={`${formId}-title`}>{spec.title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close form"
          onClick={onClose}
          disabled={pending}
        >
          <X size={20} />
        </button>
      </div>
      <p className="dialog-description">{spec.description}</p>
      <form
        onSubmit={(event) => void submit(event)}
        onChange={() => {
          key.current = crypto.randomUUID();
        }}
      >
        <div className="form-fields">
          {spec.fields.map((field) => {
            const id = `${formId}-${field.key}`;
            const attributes = {
              id,
              name: field.key,
              required: field.required,
              disabled: pending,
              'aria-describedby': field.description ? `${id}-hint` : undefined,
            };
            return (
              <div className="field" key={field.key}>
                <label htmlFor={id}>
                  {field.label}
                  {!field.required && field.kind !== 'checkbox' && (
                    <span>Optional</span>
                  )}
                </label>
                {field.kind === 'multiselect' ? (
                  <div className="checkbox-group">
                    {field.options?.map((option) => (
                      <label key={option.value}>
                        <input
                          type="checkbox"
                          name={field.key}
                          value={option.value}
                          disabled={pending}
                          defaultChecked={String(field.initial ?? '')
                            .split(',')
                            .includes(option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                    {!field.options?.length && (
                      <p className="field-hint">
                        Create a related record first.
                      </p>
                    )}
                  </div>
                ) : field.kind === 'select' ? (
                  <select
                    {...attributes}
                    defaultValue={String(field.initial ?? '')}
                  >
                    <option value="">Choose…</option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.kind === 'textarea' || field.kind === 'json' ? (
                  <textarea
                    {...attributes}
                    spellCheck={field.kind !== 'json'}
                    className={field.kind === 'json' ? 'code-input' : ''}
                    rows={field.kind === 'json' ? 7 : 3}
                    defaultValue={String(field.initial ?? '')}
                    placeholder={field.placeholder}
                  />
                ) : field.kind === 'checkbox' ? (
                  <input
                    {...attributes}
                    type="checkbox"
                    defaultChecked={field.initial === true}
                  />
                ) : (
                  <input
                    {...attributes}
                    type={field.kind ?? 'text'}
                    step={field.kind === 'number' ? 'any' : undefined}
                    defaultValue={String(field.initial ?? '')}
                    placeholder={field.placeholder}
                  />
                )}
                {field.description && (
                  <p id={`${id}-hint`} className="field-hint">
                    {field.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <ErrorNotice error={error} />
        <footer className="dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            {pending ? 'Saving…' : (spec.submitLabel ?? 'Save record')}
          </PrimaryButton>
        </footer>
      </form>
    </dialog>
  );
}

export function Details({
  record,
  label = 'Inspect record',
}: {
  record: RecordData;
  label?: string;
}) {
  return (
    <details className="record-details">
      <summary>
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <dl>
        {Object.entries(record).map(([key, value]) => (
          <div key={key}>
            <dt>{humanize(key)}</dt>
            <dd>
              {typeof value === 'object' && value !== null ? (
                <pre>{JSON.stringify(value, null, 2)}</pre>
              ) : (
                text(value, '—')
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export interface Column {
  key: string;
  label: string;
  render?: (record: RecordData) => ReactNode;
}

export function RecordTable({
  records,
  columns,
  action,
}: {
  records: RecordData[];
  columns?: Column[];
  action?: (record: RecordData) => ReactNode;
}) {
  const fields = columns ?? [
    {
      key: 'name',
      label: 'Record',
      render: (record: RecordData) => <strong>{titleOf(record)}</strong>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (record: RecordData) => (
        <Status
          value={record.status ?? record.reviewState ?? record.operatingState}
        />
      ),
    },
  ];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {fields.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">Details and actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={text(record.id, String(index))}>
              {fields.map((column) => (
                <td key={column.key}>
                  {column.render
                    ? column.render(record)
                    : text(record[column.key], '—')}
                </td>
              ))}
              <td className="table-actions">
                <Details record={record} />
                {action?.(record)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AddButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="button button-secondary button-small"
      onClick={onClick}
    >
      <Plus size={15} aria-hidden="true" />
      {label}
    </button>
  );
}

export function SummaryCard({
  label,
  value,
  description,
  href,
}: {
  label: string;
  value: ReactNode;
  description: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="summary-label">{label}</span>
      <strong className="summary-value">{value}</strong>
      <span className="summary-description">
        {description}
        {href && <ArrowRight size={15} aria-hidden="true" />}
      </span>
    </>
  );
  return href ? (
    <a href={href} className="summary-card">
      {content}
    </a>
  ) : (
    <div className="summary-card">{content}</div>
  );
}

export function formatDate(value: unknown): string {
  if (typeof value !== 'string') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

export function recordValue(record: RecordData, field: string): unknown {
  return record[field] ?? asRecord(record.data)[field];
}
