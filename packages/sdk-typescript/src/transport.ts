import { operations, type OperationId } from './generated/operations.js';

export interface TransportOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Browser sessions require this CSRF value for state-changing requests. */
  csrfToken?: string;
  sleep?: (milliseconds: number) => Promise<void>;
}
export interface RequestOptions {
  path?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
export class ZazieApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ZazieApiError';
  }
}

const transientStatuses = new Set([408, 429, 502, 503, 504]);

/** Executes generated routes using only standard Fetch, URL, Web Crypto, and Abort APIs. */
export class GeneratedTransport {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly attempts: number;
  private readonly timeout: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: TransportOptions) {
    const url = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Use an HTTP(S) API base URL without embedded credentials, query, or fragment',
      );
    this.baseUrl = url.toString().replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.attempts = options.maxAttempts ?? 3;
    this.timeout = options.timeoutMs ?? 10_000;
    if (
      !Number.isInteger(this.attempts) ||
      this.attempts < 1 ||
      this.attempts > 5
    )
      throw new Error('maxAttempts must be between 1 and 5');
    if (
      !Number.isFinite(this.timeout) ||
      this.timeout < 1 ||
      this.timeout > 120_000
    )
      throw new Error('timeoutMs must be between 1 and 120000');
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async request<T>(
    operationId: OperationId,
    options: RequestOptions = {},
  ): Promise<T> {
    const operation = operations[operationId];
    if (!operation) throw new Error(`Unknown API operation: ${operationId}`);
    const path = operation.path.replace(
      /\{([^}]+)\}/g,
      (_match, key: string) => {
        const value = options.path?.[key];
        if (!value) throw new Error(`Missing path parameter: ${key}`);
        return encodeURIComponent(value);
      },
    );
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const headers = new Headers({
      Accept:
        operation.response === 'binary'
          ? 'application/octet-stream'
          : 'application/json',
    });
    if (this.options.token)
      headers.set('Authorization', `Bearer ${this.options.token}`);
    if (this.options.csrfToken)
      headers.set('X-CSRF-Token', this.options.csrfToken);
    const serialized =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    if (serialized !== undefined)
      headers.set('Content-Type', 'application/json');
    // Generate once outside the retry loop. Retries must not create another record.
    if (operation.method !== 'GET')
      headers.set(
        'Idempotency-Key',
        options.idempotencyKey ?? crypto.randomUUID(),
      );
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('Zazie request timed out')),
        this.timeout,
      );
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      try {
        const response = await this.fetcher(url, {
          method: operation.method,
          headers,
          signal,
          credentials: 'same-origin',
          ...(serialized === undefined ? {} : { body: serialized }),
        });
        if (response.ok) {
          if (operation.response === 'binary')
            return (await response.arrayBuffer()) as T;
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        }
        const body = (await response.json().catch(() => ({}))) as {
          message?: unknown;
          code?: unknown;
          requestId?: unknown;
        };
        const error = new ZazieApiError(
          typeof body.message === 'string'
            ? body.message
            : `Zazie returned HTTP ${response.status}`,
          response.status,
          typeof body.code === 'string' ? body.code : 'http_error',
          typeof body.requestId === 'string' ? body.requestId : undefined,
        );
        if (
          !transientStatuses.has(response.status) ||
          attempt === this.attempts
        )
          throw error;
      } catch (error) {
        if (
          options.signal?.aborted ||
          error instanceof ZazieApiError ||
          attempt === this.attempts
        )
          throw error;
      } finally {
        clearTimeout(timer);
      }
      await this.sleep(Math.min(250 * 2 ** (attempt - 1), 2_000));
    }
    throw new Error('Request attempts exhausted');
  }
}
