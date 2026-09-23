import { describe, expect, it } from 'vitest';
import { createDatabase, identifier, sql } from '@zazie/database';
import { migrate } from '../../packages/database/src/migrate.js';
import { createApplication } from '../../apps/api/src/server.js';
import { loadConfig } from '../../apps/api/src/config.js';

const connectionString = process.env.TEST_DATABASE_URL;
describe.skipIf(!connectionString)('schema compatibility', () => {
  it('refuses to start or migrate a database from a newer application release', async () => {
    const database = createDatabase(connectionString!);
    const schema = `future_${identifier().replaceAll('-', '')}`;
    const target = new URL(connectionString!);
    target.searchParams.set('options', `-c search_path=${schema}`);
    try {
      await database.db.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
      await database.db.execute(
        sql`CREATE TABLE ${sql.identifier(schema)}.schema_migrations(version integer PRIMARY KEY)`,
      );
      await database.db.execute(
        sql`INSERT INTO ${sql.identifier(schema)}.schema_migrations VALUES(1),(2)`,
      );
      await expect(migrate(target.href)).rejects.toThrow(
        'newer than this application',
      );
      await expect(
        createApplication(
          loadConfig({
            DATABASE_URL: target.href,
            SESSION_SECRET: 'synthetic-schema-test-at-least-32-characters',
            OIDC_ISSUER: 'https://identity.example.test',
            OIDC_CLIENT_ID: 'schema-test',
          }),
        ),
      ).rejects.toThrow('migration command');
    } finally {
      await database.db.execute(
        sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`,
      );
      await database.close();
    }
  });
});
