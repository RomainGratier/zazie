import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  identifier,
  rows,
  sql,
  type Database,
} from '@zazie/database';
import { bootstrap } from '../../scripts/bootstrap.js';

const url = process.env.TEST_DATABASE_URL;
const input = {
  issuer: 'https://synthetic.example.test',
  subject: 'demo-owner',
  displayName: 'Demo owner',
  roles: ['admin', 'editor', 'reviewer', 'viewer'] as const,
  organizationName: 'Synthetic demonstration',
};
const configuration = () => ({ ...input, roles: [...input.roles] });

// A fresh schema exercises installation-wide checks without touching other test data.
async function withInstallation(run: (database: Database) => Promise<void>) {
  const admin = createDatabase(url!);
  const schema = `bootstrap_${identifier().replaceAll('-', '')}`;
  const scopedUrl = new URL(url!);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const database = createDatabase(scopedUrl.toString());
  try {
    await admin.db.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
    const migration = await readFile(
      new URL(
        '../../packages/database/migrations/001_foundation.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await database.db.execute(sql.raw(migration));
    await run(database.db);
  } finally {
    await database.close();
    await admin.db.execute(
      sql`DROP SCHEMA IF EXISTS ${sql.identifier(schema)} CASCADE`,
    );
    await admin.close();
  }
}

(url ? describe : describe.skip)('installation bootstrap', () => {
  it('creates one administrator and one audit record, then refuses strict retries', async () => {
    await withInstallation(async (database) => {
      const result = await bootstrap(database, configuration());
      expect(result.created).toBe(true);
      expect(await rows(database, sql`SELECT id FROM organizations`)).toEqual([
        { id: result.organizationId },
      ]);
      expect(
        await rows(
          database,
          sql`SELECT id,roles,all_systems,active FROM memberships`,
        ),
      ).toEqual([
        {
          id: result.membershipId,
          roles: [...input.roles],
          all_systems: true,
          active: true,
        },
      ]);
      expect(
        await rows(database, sql`SELECT action,actor_id FROM audit_events`),
      ).toEqual([
        { action: 'installation.bootstrapped', actor_id: result.membershipId },
      ]);
      await expect(bootstrap(database, configuration())).rejects.toThrow(
        'empty installation',
      );
    });
  });

  it('serialises matching retries without creating duplicate organisations, memberships or audit entries', async () => {
    await withInstallation(async (database) => {
      const results = await Promise.all(
        [0, 1].map(() =>
          bootstrap(database, configuration(), { ifMatching: true }),
        ),
      );
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results[0]!.membershipId).toBe(results[1]!.membershipId);
      for (const table of ['organizations', 'memberships', 'audit_events'])
        expect(
          await rows(
            database,
            sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`,
          ),
        ).toEqual([{ count: 1 }]);
      const subset = await bootstrap(
        database,
        {
          ...configuration(),
          roles: ['admin'],
          displayName: 'Changed name',
          organizationName: 'Changed organisation',
        },
        { ifMatching: true },
      );
      expect(subset.created).toBe(false);
      expect(
        (
          await rows(database, sql`SELECT roles,display_name FROM memberships`)
        )[0],
      ).toEqual({ roles: [...input.roles], display_name: input.displayName });
      expect(
        (await rows(database, sql`SELECT name FROM organizations`))[0]!.name,
      ).toBe(input.organizationName);
    });
  });

  it('rejects a different identity without mutating the installation', async () => {
    await withInstallation(async (database) => {
      await bootstrap(database, configuration());
      const before = await rows(database, sql`SELECT * FROM memberships`);
      for (const mismatch of [
        { issuer: 'https://another.example.test' },
        { subject: 'another-owner' },
      ])
        await expect(
          bootstrap(
            database,
            { ...configuration(), ...mismatch },
            { ifMatching: true },
          ),
        ).rejects.toThrow('does not have');
      expect(await rows(database, sql`SELECT * FROM memberships`)).toEqual(
        before,
      );
      expect(
        await rows(
          database,
          sql`SELECT count(*)::int AS count FROM audit_events`,
        ),
      ).toEqual([{ count: 1 }]);
    });
  });

  it('selects the original identity after other administrators have been invited', async () => {
    await withInstallation(async (database) => {
      const original = await bootstrap(database, configuration());
      await database.execute(
        sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${identifier()},${original.organizationId},${input.issuer},'invited-owner','Another administrator',ARRAY['admin','editor','reviewer','viewer'],true)`,
      );
      const before = await rows(
        database,
        sql`SELECT * FROM memberships ORDER BY id`,
      );
      const retry = await bootstrap(database, configuration(), {
        ifMatching: true,
      });
      expect(retry).toEqual({ ...original, created: false });
      expect(
        await rows(database, sql`SELECT * FROM memberships ORDER BY id`),
      ).toEqual(before);
    });
  });

  it('does not restore missing roles, disabled memberships or restricted system access', async () => {
    await withInstallation(async (database) => {
      await bootstrap(database, configuration());
      for (const update of [
        sql`UPDATE memberships SET roles=ARRAY['admin']`,
        sql`UPDATE memberships SET roles=ARRAY['admin','editor','reviewer','viewer'],active=false`,
        sql`UPDATE memberships SET active=true,all_systems=false`,
      ]) {
        await database.execute(update);
        const before = await rows(database, sql`SELECT * FROM memberships`);
        await expect(
          bootstrap(database, configuration(), { ifMatching: true }),
        ).rejects.toThrow('does not have');
        expect(await rows(database, sql`SELECT * FROM memberships`)).toEqual(
          before,
        );
      }
    });
  });

  it('refuses an orphaned organisation or a multi-organisation installation', async () => {
    await withInstallation(async (database) => {
      await database.execute(
        sql`INSERT INTO organizations(id,name) VALUES(${identifier()},${input.organizationName})`,
      );
      await expect(
        bootstrap(database, configuration(), { ifMatching: true }),
      ).rejects.toThrow('does not have');
      expect(await rows(database, sql`SELECT id FROM memberships`)).toEqual([]);
    });
    await withInstallation(async (database) => {
      await bootstrap(database, configuration());
      await database.execute(
        sql`INSERT INTO organizations(id,name) VALUES(${identifier()},'Another organisation')`,
      );
      await expect(
        bootstrap(database, configuration(), { ifMatching: true }),
      ).rejects.toThrow('does not have');
    });
  });

  it('still requires an administrator role and the configured OIDC issuer', async () => {
    await withInstallation(async (database) => {
      await expect(
        bootstrap(
          database,
          { ...configuration(), roles: ['reviewer'] },
          { ifMatching: true },
        ),
      ).rejects.toThrow('administrator role');
      await expect(
        bootstrap(database, configuration(), {
          configuredIssuer: 'https://another.example.test',
          ifMatching: true,
        }),
      ).rejects.toThrow('configured OIDC_ISSUER');
      expect(await rows(database, sql`SELECT id FROM organizations`)).toEqual(
        [],
      );
    });
  });
});
