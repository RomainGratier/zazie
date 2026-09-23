import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  IdSchema,
  RetentionPolicySchema,
  retentionPolicyFromSettings,
} from '@zazie/contracts';
import {
  audit,
  createDatabase,
  identifier,
  rows,
  sql,
  type Actor,
  type Database,
} from '@zazie/database';

/** Called only by a deployment operator with a database credential, never from an HTTP route. */
export async function configureRetention(
  db: Database,
  organizationId: string,
  input: unknown,
  reason: string,
) {
  IdSchema.parse(organizationId);
  const policy = RetentionPolicySchema.parse(input);
  const rationale = reason.trim();
  if (!rationale || rationale.length > 2000)
    throw new Error(
      'Provide a retention rationale between 1 and 2000 characters',
    );
  return db.transaction(async (tx) => {
    const [organization] = await rows(
      tx,
      sql`SELECT id,settings FROM organizations WHERE id=${organizationId} FOR UPDATE`,
    );
    if (!organization) throw new Error('Organisation not found');
    const previous = retentionPolicyFromSettings(organization.settings);
    const actor: Actor = {
      id: 'zazie-deployment-operator',
      organizationId,
      displayName: 'Deployment operator',
      roles: [],
      systemIds: [],
      allSystems: true,
    };
    await tx.execute(
      sql`UPDATE organizations SET settings=jsonb_set(settings,'{retentionPolicy}',${JSON.stringify(policy)}::jsonb,true) WHERE id=${organizationId}`,
    );
    await audit(
      tx,
      actor,
      null,
      'retention.policy-configured',
      organizationId,
      identifier(),
      undefined,
      {
        previous,
        policy,
        rationale,
        authority: 'deployment-controlled command',
      },
    );
    return policy;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      organization: { type: 'string' },
      policy: { type: 'string' },
      reason: { type: 'string' },
    },
  });
  if (!values.organization || !values.policy || !values.reason)
    throw new Error(
      'Usage: pnpm retention --organization ID --policy FILE.json --reason "Change rationale"',
    );
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const bytes = await readFile(values.policy);
  if (bytes.byteLength > 64 * 1024)
    throw new Error('Retention policy file must not exceed 64 KiB');
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    await configureRetention(
      database.db,
      values.organization,
      JSON.parse(bytes.toString('utf8')) as unknown,
      values.reason,
    );
    process.stdout.write(
      `Retention policy recorded for ${values.organization}.\n`,
    );
  } finally {
    await database.close();
  }
}
