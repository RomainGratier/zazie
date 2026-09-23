import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  rows,
  sql,
  identifier,
  textArray,
  audit,
  type Actor,
  type Database,
} from '../packages/database/src/index.js';
import { MembershipInputSchema } from '../packages/contracts/src/index.js';

interface BootstrapInput {
  issuer: string;
  subject: string;
  displayName: string;
  roles: Actor['roles'];
  organizationName: string;
}

/** Provision the first administrator, without changing an existing installation. */
export async function bootstrap(
  database: Database,
  input: BootstrapInput,
  options: { ifMatching?: boolean; configuredIssuer?: string } = {},
) {
  const data = MembershipInputSchema.parse({
    issuer: input.issuer,
    subject: input.subject,
    displayName: input.displayName,
    roles: input.roles,
    systemIds: [],
    allSystems: true,
  });
  if (!data.roles.includes('admin'))
    throw new Error(
      'The initial membership must include the administrator role',
    );
  if (!input.organizationName.trim())
    throw new Error('An organisation name is required');
  if (options.configuredIssuer && data.issuer !== options.configuredIssuer)
    throw new Error(
      'Bootstrap issuer must exactly match the configured OIDC_ISSUER',
    );

  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(873622)`);
    const organizations = await rows<{ id: string }>(
      tx,
      sql`SELECT id FROM organizations ORDER BY id`,
    );
    if (organizations.length > 0) {
      if (!options.ifMatching)
        throw new Error(
          'Bootstrap is only permitted for an empty installation. Use the authenticated administration screen.',
        );
      const [organization] = organizations;
      const [member] = await rows<{
        id: string;
        roles: Actor['roles'];
        active: boolean;
        all_systems: boolean;
      }>(
        tx,
        sql`SELECT id,roles,active,all_systems FROM memberships WHERE organization_id=${organization!.id} AND issuer=${data.issuer} AND subject=${data.subject}`,
      );
      if (
        organizations.length !== 1 ||
        !member?.active ||
        !member.all_systems ||
        !data.roles.every((role) => member.roles.includes(role))
      )
        throw new Error(
          'Existing installation does not have the requested active administrator and permissions in a single organisation. No changes were made; use the authenticated administration screen.',
        );
      return {
        membershipId: member.id,
        organizationId: organization!.id,
        created: false,
      };
    }

    const organizationId = identifier();
    const id = identifier();
    await tx.execute(
      sql`INSERT INTO organizations(id,name) VALUES(${organizationId},${input.organizationName})`,
    );
    await tx.execute(
      sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,system_ids,all_systems) VALUES(${id},${organizationId},${data.issuer},${data.subject},${data.displayName},${textArray(data.roles)},${textArray(data.systemIds)},true)`,
    );
    const actor: Actor = {
      id,
      organizationId,
      displayName: data.displayName,
      roles: data.roles,
      systemIds: [],
      allSystems: true,
    };
    await audit(tx, actor, null, 'installation.bootstrapped', id, identifier());
    return { membershipId: id, organizationId, created: true };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      issuer: { type: 'string' },
      subject: { type: 'string' },
      name: { type: 'string' },
      roles: { type: 'string', default: 'admin' },
      organization: { type: 'string', default: 'My organisation' },
      'if-matching': { type: 'boolean', default: false },
      'id-only': { type: 'boolean', default: false },
    },
  });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const data = MembershipInputSchema.parse({
    issuer: values.issuer,
    subject: values.subject,
    displayName: values.name,
    roles: values.roles!.split(','),
    systemIds: [],
    allSystems: true,
  });
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    const result = await bootstrap(
      database.db,
      { ...data, organizationName: values.organization! },
      {
        ifMatching: values['if-matching'],
        ...(process.env.OIDC_ISSUER
          ? { configuredIssuer: process.env.OIDC_ISSUER }
          : {}),
      },
    );
    process.stdout.write(
      values['id-only']
        ? `${result.membershipId}\n`
        : `${result.created ? 'Initial administrator provisioned' : 'Matching administrator already provisioned'}: ${result.membershipId}\n`,
    );
  } finally {
    await database.close();
  }
}
