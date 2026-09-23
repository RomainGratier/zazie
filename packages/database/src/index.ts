import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { canonicalJson } from '@zazie/domain';
import type { Resource, Role } from '@zazie/contracts';

export { sql };
export function textArray(values: readonly string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}
export type Database = NodePgDatabase;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Connection = Database | Transaction;
export interface Actor {
  id: string;
  organizationId: string;
  displayName: string;
  roles: Role[];
  systemIds: string[];
  allSystems: boolean;
  actions?: string[];
}
export interface StoredRecord<T = Record<string, unknown>> extends Resource<T> {
  kind: string;
}
export interface SystemRecord extends Resource<Record<string, unknown>> {
  evidenceRevision: number;
}
export const identifier = () => randomUUID();
export const digest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  return { pool, db: drizzle(pool), close: () => pool.end() };
}
export async function rows<T = Record<string, unknown>>(
  connection: Connection,
  query: SQL,
): Promise<T[]> {
  return (await connection.execute(query)).rows as T[];
}
export function createQueue(connectionString: string, worker = false) {
  return new PgBoss({
    connectionString,
    migrate: false,
    supervise: worker,
    schedule: worker,
  });
}
export async function enqueue(
  boss: PgBoss,
  tx: Transaction,
  name: string,
  data: object,
  singletonKey?: string,
) {
  return boss.send(name, data, {
    db: fromDrizzle(tx, sql),
    ...(singletonKey ? { singletonKey } : {}),
  });
}
export function record(row: Record<string, unknown>): StoredRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    systemId: String(row.system_id),
    kind: String(row.kind),
    revision: Number(row.revision),
    data: row.data as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
    createdBy: String(row.created_by),
  };
}
export async function getSystem(
  connection: Connection,
  organizationId: string,
  id: string,
  lock = false,
): Promise<SystemRecord> {
  const [row] = await rows(
    connection,
    sql`SELECT * FROM systems WHERE organization_id=${organizationId} AND id=${id} ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  if (!row) throw new DomainError('not_found', 'System not found', 404);
  return {
    id,
    organizationId,
    systemId: null,
    revision: Number(row.revision),
    evidenceRevision: Number(row.evidence_revision),
    data: row.data as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
    createdBy: String(row.created_by),
  };
}
export async function listRecords(
  connection: Connection,
  organizationId: string,
  systemId: string,
  kind?: string,
): Promise<StoredRecord[]> {
  return (
    await rows(
      connection,
      sql`SELECT * FROM records WHERE organization_id=${organizationId} AND system_id=${systemId} ${kind ? sql`AND kind=${kind}` : sql``} ORDER BY created_at,id`,
    )
  ).map(record);
}
export async function getRecord(
  connection: Connection,
  organizationId: string,
  systemId: string,
  id: string,
  kind?: string,
): Promise<StoredRecord> {
  const [row] = await rows(
    connection,
    sql`SELECT * FROM records WHERE organization_id=${organizationId} AND system_id=${systemId} AND id=${id} ${kind ? sql`AND kind=${kind}` : sql``}`,
  );
  if (!row)
    throw new DomainError('not_found', 'Record not found in this system', 404);
  return record(row);
}
export async function insertRecord(
  tx: Transaction,
  actor: Actor,
  systemId: string,
  kind: string,
  data: object,
  id = identifier(),
): Promise<StoredRecord> {
  const [row] = await rows(
    tx,
    sql`INSERT INTO records(id,organization_id,system_id,kind,data,created_by) VALUES(${id},${actor.organizationId},${systemId},${kind},${JSON.stringify(data)}::jsonb,${actor.id}) RETURNING *`,
  );
  const result = record(row!);
  await tx.execute(
    sql`INSERT INTO record_revisions(organization_id,system_id,record_id,revision,data,created_by) VALUES(${actor.organizationId},${systemId},${id},1,${JSON.stringify(data)}::jsonb,${actor.id})`,
  );
  return result;
}
export async function reviseRecord(
  tx: Transaction,
  actor: Actor,
  existing: StoredRecord,
  data: object,
  expectedRevision: number,
): Promise<StoredRecord> {
  if (existing.revision !== expectedRevision)
    throw new DomainError(
      'revision_conflict',
      'The record changed. Reload before saving.',
      409,
    );
  const [row] = await rows(
    tx,
    sql`UPDATE records SET data=${JSON.stringify(data)}::jsonb,revision=revision+1 WHERE organization_id=${actor.organizationId} AND id=${existing.id} AND revision=${expectedRevision} RETURNING *`,
  );
  if (!row)
    throw new DomainError('revision_conflict', 'The record changed', 409);
  const updated = record(row);
  await tx.execute(
    sql`INSERT INTO record_revisions(organization_id,system_id,record_id,revision,data,created_by) VALUES(${actor.organizationId},${existing.systemId},${existing.id},${updated.revision},${JSON.stringify(data)}::jsonb,${actor.id})`,
  );
  return updated;
}
export async function linkRecord(
  tx: Transaction,
  source: StoredRecord,
  target: StoredRecord,
  relation: string,
) {
  if (
    source.organizationId !== target.organizationId ||
    source.systemId !== target.systemId
  )
    throw new DomainError(
      'scope_mismatch',
      'Evidence links must remain within one system',
      403,
    );
  await tx.execute(
    sql`INSERT INTO record_links(organization_id,system_id,source_id,source_revision,target_id,target_revision,relation) VALUES(${source.organizationId},${source.systemId},${source.id},${source.revision},${target.id},${target.revision},${relation}) ON CONFLICT DO NOTHING`,
  );
}
export async function audit(
  tx: Connection,
  actor: Actor,
  systemId: string | null,
  action: string,
  objectId: string,
  requestId: string,
  revision?: number,
  metadata: object = {},
) {
  await tx.execute(
    sql`INSERT INTO audit_events(id,organization_id,system_id,actor_id,action,object_id,revision,request_id,metadata) VALUES(${identifier()},${actor.organizationId},${systemId},${actor.id},${action},${objectId},${revision ?? null},${requestId},${JSON.stringify(metadata)}::jsonb)`,
  );
}
export function authorize(
  actor: Actor,
  systemId: string | null,
  action: string,
  role: 'read' | 'edit' | 'review' | 'admin' = 'read',
) {
  if (actor.actions) {
    if (
      !systemId ||
      !actor.systemIds.includes(systemId) ||
      !actor.actions.includes(action)
    )
      throw new DomainError(
        'forbidden',
        'Integration credential lacks this scope',
        403,
      );
  } else {
    if (systemId && !actor.allSystems && !actor.systemIds.includes(systemId))
      throw new DomainError('forbidden', 'System access is not granted', 403);
    const permitted =
      role === 'read' ||
      (role === 'review'
        ? actor.roles.includes('reviewer')
        : role === 'admin'
          ? actor.roles.includes('admin')
          : actor.roles.includes('editor') || actor.roles.includes('admin'));
    if (!permitted)
      throw new DomainError(
        'forbidden',
        'This action requires explicit permission',
        403,
      );
  }
}
export async function idempotent<T>(
  db: Database,
  actor: Actor,
  systemId: string | null,
  operation: string,
  key: string,
  payload: unknown,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key))
    throw new DomainError(
      'idempotency_required',
      'Provide an Idempotency-Key header (1–128 characters)',
    );
  const fingerprint = digest({ actor: actor.id, payload });
  return db.transaction(async (tx) => {
    const scope = systemId ?? 'organization';
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.organizationId}:${scope}:${operation}:${key}`},0))`,
    );
    const [previous] = await rows(
      tx,
      sql`SELECT fingerprint,response FROM idempotency WHERE organization_id=${actor.organizationId} AND scope=${scope} AND operation=${operation} AND key=${key}`,
    );
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new DomainError(
          'idempotency_conflict',
          'This key was already used with a different payload or actor',
          409,
        );
      return previous.response as T;
    }
    if (systemId) await getSystem(tx, actor.organizationId, systemId, true);
    const response = await fn(tx);
    await tx.execute(
      sql`INSERT INTO idempotency(organization_id,scope,operation,key,fingerprint,response) VALUES(${actor.organizationId},${scope},${operation},${key},${fingerprint},${JSON.stringify(response)}::jsonb)`,
    );
    return response;
  });
}
