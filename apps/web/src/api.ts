export type RecordData = Record<string, unknown>;

export interface Session {
  user: { id: string; displayName?: string; email?: string };
  organization: { id: string; name: string };
  roles: string[];
  systemIds?: string[];
  allSystems?: boolean;
  csrfToken: string;
  synthetic?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken = '';
export function setSessionCsrf(token: string) {
  csrfToken = token;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body && !(options.body instanceof FormData))
    headers.set('content-type', 'application/json');
  if (
    options.method &&
    !['GET', 'HEAD'].includes(options.method.toUpperCase())
  ) {
    headers.set('x-csrf-token', csrfToken);
    if (!headers.has('idempotency-key'))
      headers.set('idempotency-key', crypto.randomUUID());
  }
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  const body =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = asRecord(body);
    const nested = asRecord(error.error);
    throw new ApiError(
      response.status,
      String(
        error.message ??
          nested.message ??
          `Request failed (${response.status}).`,
      ),
      typeof error.requestId === 'string' ? error.requestId : undefined,
      error.details ?? nested.details,
    );
  }
  return body as T;
}

export function asRecord(value: unknown): RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordData)
    : {};
}

export function items(value: unknown): RecordData[] {
  const list = Array.isArray(value) ? value : asRecord(value).items;
  return Array.isArray(list) ? list.map(flatten) : [];
}

export function flatten(value: unknown): RecordData {
  const record = asRecord(value);
  return { ...asRecord(record.data), ...record };
}

export function text(value: unknown, fallback = 'Not recorded'): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  return fallback;
}

export function titleOf(record: RecordData): string {
  const flat = flatten(record);
  return text(
    flat.name ?? flat.title ?? flat.label ?? flat.type ?? flat.id,
    'Record',
  );
}

export function resourcePath(systemId: string, resource: string): string {
  return `/systems/${encodeURIComponent(systemId)}/${resource}`;
}
