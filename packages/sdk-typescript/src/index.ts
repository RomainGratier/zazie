import {
  ArtifactUploadInputSchema,
  EvaluationInputSchema,
  EventInputSchema,
  VersionInputSchema,
  type ArtifactInput,
  type ArtifactUploadInput,
  type EvaluationInput,
  type EventInput,
  type Resource,
  type VersionInput,
} from '@zazie/contracts';
import type { ReadinessResult } from '@zazie/domain';
import {
  GeneratedTransport,
  type RequestOptions,
  type TransportOptions,
} from './transport.js';
import type { OperationId } from './generated/operations.js';

export {
  GeneratedTransport,
  ZazieApiError,
  type RequestOptions,
  type TransportOptions,
} from './transport.js';
export type {
  Resource,
  EvaluationInput,
  EventInput,
  VersionInput,
} from '@zazie/contracts';
export type { ReadinessResult } from '@zazie/domain';
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export class ZazieClient {
  readonly transport: GeneratedTransport;
  constructor(options: TransportOptions) {
    this.transport = new GeneratedTransport(options);
  }

  /** Escape hatch for generated operations without introducing vendor-specific endpoints. */
  request<T>(
    operationId: OperationId,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.transport.request<T>(operationId, options);
  }

  submitVersion(
    systemId: string,
    input: VersionInput,
    idempotencyKey?: string,
  ): Promise<Resource<VersionInput & { manifestDigest: string }>> {
    return this.request('create:versions', {
      path: { systemId },
      body: VersionInputSchema.parse(input),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
  submitEvaluation(
    systemId: string,
    input: EvaluationInput,
    idempotencyKey?: string,
  ): Promise<Resource<EvaluationInput>> {
    return this.request('create:evaluations', {
      path: { systemId },
      body: EvaluationInputSchema.parse(input),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
  submitEvents(
    systemId: string,
    inputs: EventInput[],
    idempotencyKey?: string,
  ): Promise<Page<Resource<EventInput>>> {
    if (inputs.length < 1 || inputs.length > 100)
      throw new Error('An event batch must contain between 1 and 100 events');
    return this.request('submitEvents', {
      path: { systemId },
      body: { events: inputs.map((input) => EventInputSchema.parse(input)) },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
  uploadArtifact(
    systemId: string,
    metadata: ArtifactInput,
    contents: Uint8Array,
    idempotencyKey?: string,
  ): Promise<Resource<ArtifactInput & { sha256: string; size: number }>> {
    if (contents.byteLength > 50 * 1024 * 1024)
      throw new Error('Artifact exceeds the 50 MiB upload limit');
    let binary = '';
    for (let offset = 0; offset < contents.length; offset += 32_768)
      binary += String.fromCharCode(
        ...contents.subarray(offset, offset + 32_768),
      );
    return this.uploadArtifactBase64(
      systemId,
      { ...metadata, contentBase64: btoa(binary) },
      idempotencyKey,
    );
  }
  uploadArtifactBase64(
    systemId: string,
    input: ArtifactUploadInput,
    idempotencyKey?: string,
  ): Promise<Resource<ArtifactInput & { sha256: string; size: number }>> {
    return this.request('uploadArtifact', {
      path: { systemId },
      body: ArtifactUploadInputSchema.parse(input),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
  checkRelease(
    systemId: string,
    versionId: string,
    deploymentId: string,
    purpose: 'review' | 'deploy' = 'deploy',
  ): Promise<ReadinessResult> {
    return this.request('checkRelease', {
      path: { systemId },
      query: { versionId, deploymentId, purpose },
    });
  }
  submitResource<T>(
    systemId: string,
    resource: string,
    input: T,
    idempotencyKey?: string,
  ): Promise<Resource<T>> {
    return this.request(`create:${resource}` as OperationId, {
      path: { systemId },
      body: input,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
  listResources<T>(
    systemId: string,
    resource: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Page<Resource<T>>> {
    return this.request(`list:${resource}` as OperationId, {
      path: { systemId },
      query: options,
    });
  }
  bufferEvents(systemId: string, options: EventBufferOptions): EventBuffer {
    return new EventBuffer(this, systemId, options);
  }
}

export interface EventBufferOptions {
  maxBufferedEvents?: number;
  batchSize?: number;
  /** Zero disables timed flushing; callers must then call flush explicitly. */
  flushIntervalMs?: number;
  onDeliveryFailure: (error: unknown, retainedEvents: number) => void;
}

/** Bounded, asynchronous, in-memory delivery. Not durable across process termination. */
export class EventBuffer {
  private readonly queue: EventInput[] = [];
  private readonly maximum: number;
  private readonly batchSize: number;
  private readonly interval: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly client: ZazieClient,
    private readonly systemId: string,
    private readonly options: EventBufferOptions,
  ) {
    this.maximum = options.maxBufferedEvents ?? 500;
    this.batchSize = options.batchSize ?? 50;
    this.interval = options.flushIntervalMs ?? 1_000;
    if (
      !Number.isInteger(this.maximum) ||
      this.maximum < 1 ||
      this.maximum > 10_000
    )
      throw new Error('maxBufferedEvents must be between 1 and 10000');
    if (
      !Number.isInteger(this.batchSize) ||
      this.batchSize < 1 ||
      this.batchSize > 100 ||
      this.batchSize > this.maximum
    )
      throw new Error('batchSize must be between 1 and 100 and fit the buffer');
    if (
      !Number.isFinite(this.interval) ||
      this.interval < 0 ||
      this.interval > 60_000
    )
      throw new Error('flushIntervalMs must be between 0 and 60000');
  }
  get pendingCount(): number {
    return this.queue.length;
  }

  enqueue(input: EventInput): void {
    if (this.closed) throw new Error('Event buffer is closed');
    if (this.queue.length >= this.maximum) {
      const error = new Error(
        'Event buffer is full; the new event was not accepted',
      );
      this.options.onDeliveryFailure(error, this.queue.length);
      throw error;
    }
    this.queue.push(EventInputSchema.parse(input));
    if (this.interval > 0 && !this.timer && !this.flushing) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => {
          /* flush reports the failure and retains the batch */
        });
      }, this.interval);
    }
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.flushing = this.deliver().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  private async deliver(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, this.batchSize);
        // Source/event IDs additionally deduplicate explicit retries after a process response is lost.
        await this.client.submitEvents(this.systemId, batch);
        this.queue.splice(0, batch.length);
      }
    } catch (error) {
      this.options.onDeliveryFailure(error, this.queue.length);
      throw error;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
