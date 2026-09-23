import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PgBoss } from 'pg-boss';
import { createDatabase, sql, rows } from './index.js';

export async function migrate(connectionString: string) {
  const database = createDatabase(connectionString);
  try {
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(873621)`);
      await tx.execute(
        sql`CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      const installed = await rows(
        tx,
        sql`SELECT version FROM schema_migrations ORDER BY version`,
      );
      if (installed.some((row) => row.version !== 1))
        throw new Error(
          'Database schema is newer than this application; use the matching release',
        );
      if (installed.length === 0) {
        const migration = await readFile(
          new URL('../migrations/001_foundation.sql', import.meta.url),
          'utf8',
        );
        await tx.execute(sql.raw(migration));
        await tx.execute(sql`INSERT INTO schema_migrations(version) VALUES(1)`);
      }
    });
    const boss = new PgBoss({
      connectionString,
      migrate: true,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (error) =>
      process.stderr.write(`Queue migration error: ${error.message}\n`),
    );
    await boss.start();
    for (const name of ['dossier', 'freshness', 'housekeeping'])
      await boss.createQueue(name, {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
      });
    await boss.stop();
    const runtimeRole = process.env.DATABASE_RUNTIME_ROLE;
    if (runtimeRole) {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole))
        throw new Error('Invalid DATABASE_RUNTIME_ROLE');
      // The identifier is deployment configuration, never request input.
      const role = sql.identifier(runtimeRole);
      await database.db.execute(
        sql`GRANT USAGE ON SCHEMA public,pgboss TO ${role}`,
      );
      await database.db.execute(
        sql`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,pgboss TO ${role}`,
      );
      await database.db.execute(
        sql`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,pgboss TO ${role}`,
      );
      await database.db.execute(
        sql`REVOKE UPDATE,DELETE ON audit_events,system_revisions,record_revisions,record_links FROM ${role}`,
      );
      await database.db.execute(
        sql`REVOKE DELETE ON records,systems FROM ${role}`,
      );
      await database.db.execute(
        sql`REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM ${role}`,
      );
    }
  } finally {
    await database.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  await migrate(connectionString);
  process.stdout.write('Database and queue migrations are current.\n');
}
