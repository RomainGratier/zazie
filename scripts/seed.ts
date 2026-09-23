import {
  createDatabase,
  createQueue,
  rows,
  sql,
  type Actor,
} from '@zazie/database';
import { createFilesystemStore, createS3Store } from '@zazie/storage';
import { PlatformService } from '../apps/api/src/service.js';
import {
  createSyntheticFixture,
  type DemoKind,
} from '../examples/synthetic-fixture.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString)
  throw new Error(
    'DATABASE_URL is required. Run migrations and explicitly bootstrap/sign in an administrator before seeding.',
  );
const database = createDatabase(connectionString);
const queue = createQueue(connectionString);
queue.on('error', (error) =>
  process.stderr.write(`Seed queue error: ${error.message}\n`),
);
try {
  const requested = process.env['ZAZIE_SEED_MEMBER_ID'];
  const memberships = await rows(
    database.db,
    sql`SELECT * FROM memberships WHERE active=true AND all_systems=true AND 'reviewer'=ANY(roles) AND ('editor'=ANY(roles) OR 'admin'=ANY(roles)) ${requested ? sql`AND id=${requested}` : sql``} ORDER BY id`,
  );
  if (memberships.length !== 1)
    throw new Error(
      'Seed requires one explicitly provisioned organisation-wide editor/reviewer. Sign in as the bootstrapped reviewer first, or select a member with ZAZIE_SEED_MEMBER_ID.',
    );
  const member = memberships[0]!;
  const actor: Actor = {
    id: String(member.id),
    organizationId: String(member.organization_id),
    displayName: String(member.display_name),
    roles: member.roles as Actor['roles'],
    allSystems: true,
    systemIds: [],
  };
  // Storage configuration is shared with the API; evidence must remain readable after this command exits.
  const maxBytes = Number(
    process.env['ARTIFACT_MAX_BYTES'] ?? 10 * 1024 * 1024,
  );
  const storage =
    process.env['STORAGE_DRIVER'] === 's3'
      ? createS3Store({
          bucket: process.env['S3_BUCKET']!,
          region: process.env['S3_REGION'] ?? 'us-east-1',
          maxBytes,
          forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
          ...(process.env['S3_ENDPOINT']
            ? { endpoint: process.env['S3_ENDPOINT'] }
            : {}),
        })
      : createFilesystemStore({
          root: process.env['ARTIFACT_ROOT'] ?? './.data/artifacts',
          maxBytes,
        });
  await queue.start();
  const service = new PlatformService(database.db, queue, storage);
  const existing = await service.systems(actor);
  const results: unknown[] = [];
  for (const kind of [
    'cv-filtering',
    'exam-monitoring',
  ] as const satisfies readonly DemoKind[]) {
    const name =
      kind === 'cv-filtering'
        ? 'Synthetic CV filtering'
        : 'Synthetic university exam monitoring';
    const found = existing.items.find(
      (system) => system.data.name === name && system.data.synthetic === true,
    );
    if (found) {
      results.push({
        kind,
        systemId: found.id,
        skipped: true,
        reason:
          'Synthetic system already exists; existing evidence was preserved.',
      });
      continue;
    }
    results.push(await createSyntheticFixture(service, actor, kind));
  }
  process.stdout.write(
    `${JSON.stringify({ synthetic: true, systems: results }, null, 2)}\n`,
  );
} finally {
  await queue.stop();
  await database.close();
}
