import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  type Actor,
  type Database,
  DomainError,
  audit,
  authorize,
  identifier,
  idempotent,
  textArray,
  rows,
  sql,
} from '@zazie/database';
import {
  MembershipInputSchema,
  MembershipUpdateInputSchema,
  TokenInputSchema,
} from '@zazie/contracts';
import type { Config } from './config.js';

declare module 'fastify' {
  interface Session {
    membershipId?: string;
    csrfToken?: string;
    oidc?: {
      verifier: string;
      state: string;
      nonce: string;
      createdAt: number;
    };
  }
  interface FastifyRequest {
    actor?: Actor;
  }
}
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
function toActor(row: Record<string, unknown>): Actor {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    displayName: String(row.display_name ?? row.name),
    roles: (row.roles ?? []) as Actor['roles'],
    systemIds: row.system_ids as string[],
    allSystems: row.all_systems === true,
    ...(row.actions ? { actions: row.actions as string[] } : {}),
  };
}
export function requestActor(request: FastifyRequest): Actor {
  if (!request.actor)
    throw new DomainError(
      'unauthenticated',
      'Sign in or provide an integration credential',
      401,
    );
  return request.actor;
}

export async function registerAuth(
  app: FastifyInstance,
  db: Database,
  config: Config,
) {
  const commandKey = (request: FastifyRequest) =>
    typeof request.headers['idempotency-key'] === 'string'
      ? request.headers['idempotency-key']
      : '';
  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET,
    cookieName: 'zazie_session',
    saveUninitialized: false,
    cookie: {
      secure: config.COOKIE_SECURE,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    },
    store: {
      set(id, value, callback) {
        void db
          .execute(
            sql`INSERT INTO sessions(id,data,expires_at) VALUES(${id},${JSON.stringify(value)}::jsonb,${new Date(Date.now() + 8 * 60 * 60 * 1000)}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at`,
          )
          .then(() => callback())
          .catch(callback);
      },
      get(id, callback) {
        void rows(
          db,
          sql`SELECT data FROM sessions WHERE id=${id} AND expires_at>now()`,
        )
          .then((result) =>
            callback(null, result[0]?.data as Parameters<typeof callback>[1]),
          )
          .catch(callback);
      },
      destroy(id, callback) {
        void db
          .execute(sql`DELETE FROM sessions WHERE id=${id}`)
          .then(() => callback())
          .catch(callback);
      },
    },
  });
  let discovery: Promise<oidc.Configuration> | undefined;
  const configuration = () =>
    (discovery ??= oidc
      .discovery(
        new URL(config.OIDC_ISSUER),
        config.OIDC_CLIENT_ID,
        config.OIDC_CLIENT_SECRET,
        undefined,
        {
          ...(config.OIDC_ALLOW_INSECURE_HTTP
            ? { execute: [oidc.allowInsecureRequests] }
            : {}),
        },
      )
      .catch((error) => {
        discovery = undefined;
        throw error;
      }));
  app.get('/auth/login', async (request, reply) => {
    const client = await configuration();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    request.session.oidc = { verifier, state, nonce, createdAt: Date.now() };
    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: `${config.PUBLIC_URL}/auth/callback`,
      scope: 'openid profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    await request.session.save();
    return reply.redirect(url.href);
  });
  app.get('/auth/callback', async (request, reply) => {
    const flow = request.session.oidc;
    delete request.session.oidc;
    await request.session.save();
    if (!flow || Date.now() - flow.createdAt > 10 * 60 * 1000)
      throw new DomainError('login_expired', 'Login expired; start again', 401);
    const client = await configuration();
    const tokens = await oidc.authorizationCodeGrant(
      client,
      new URL(request.raw.url!, config.PUBLIC_URL),
      {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims?.sub)
      throw new DomainError(
        'login_invalid',
        'No verified identity returned',
        401,
      );
    const [member] = await rows(
      db,
      sql`SELECT * FROM memberships WHERE issuer=${config.OIDC_ISSUER} AND subject=${claims.sub} AND active=true`,
    );
    if (!member)
      throw new DomainError(
        'membership_required',
        'An administrator must provision this identity before sign-in',
        403,
      );
    await request.session.regenerate();
    request.session.membershipId = String(member.id);
    request.session.csrfToken = randomBytes(32).toString('hex');
    await request.session.save();
    await audit(
      db,
      toActor(member),
      null,
      'identity.login',
      String(member.id),
      request.id,
    );
    return reply.redirect('/');
  });
  app.addHook('preHandler', async (request) => {
    if (
      !request.url.startsWith('/api/v1') ||
      request.url.startsWith('/api/v1/health/') ||
      request.url.startsWith('/api/v1/openapi')
    )
      return;
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice(7);
      if (token.length > 256)
        throw new DomainError(
          'unauthenticated',
          'Invalid integration credential',
          401,
        );
      const [row] = await rows(
        db,
        sql`SELECT * FROM credentials WHERE verifier=${tokenHash(token)} AND revoked_at IS NULL AND expires_at>now()`,
      );
      if (row) request.actor = toActor(row);
    } else if (request.session.membershipId) {
      const [row] = await rows(
        db,
        sql`SELECT * FROM memberships WHERE id=${request.session.membershipId} AND active=true`,
      );
      if (row) request.actor = toActor(row);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const supplied = request.headers['x-csrf-token'];
        const expected = request.session.csrfToken;
        if (
          typeof supplied !== 'string' ||
          !expected ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
        )
          throw new DomainError(
            'csrf_invalid',
            'Refresh the page before submitting this request',
            403,
          );
        if (
          request.headers.origin &&
          request.headers.origin !== new URL(config.PUBLIC_URL).origin
        )
          throw new DomainError(
            'origin_invalid',
            'Request origin is not permitted',
            403,
          );
      }
    }
    requestActor(request);
  });
  app.get('/api/v1/session', async (request) => {
    const actor = requestActor(request);
    if (actor.actions)
      throw new DomainError('forbidden', 'Browser session required', 403);
    const [organization] = await rows(
      db,
      sql`SELECT id,name FROM organizations WHERE id=${actor.organizationId}`,
    );
    return {
      user: { id: actor.id, displayName: actor.displayName },
      roles: actor.roles,
      systemIds: actor.systemIds,
      allSystems: actor.allSystems,
      csrfToken: request.session.csrfToken,
      organization,
      synthetic: false,
    };
  });
  app.delete('/api/v1/session', async (request, reply) => {
    await request.session.destroy();
    return reply.code(204).send();
  });
  app.get('/api/v1/memberships', async (request) => {
    const actor = requestActor(request);
    authorize(actor, null, 'memberships:read', 'admin');
    return {
      items: (
        await rows(
          db,
          sql`SELECT * FROM memberships WHERE organization_id=${actor.organizationId} ORDER BY display_name`,
        )
      ).map((row) => ({
        id: row.id,
        issuer: row.issuer,
        subject: row.subject,
        displayName: row.display_name,
        roles: row.roles,
        systemIds: row.system_ids,
        allSystems: row.all_systems,
        active: row.active,
      })),
    };
  });
  app.post('/api/v1/memberships', async (request) => {
    const actor = requestActor(request);
    authorize(actor, null, 'memberships:write', 'admin');
    const data = MembershipInputSchema.parse(request.body);
    if (data.issuer !== config.OIDC_ISSUER)
      throw new DomainError(
        'issuer_invalid',
        'Membership must use the configured identity provider',
      );
    return idempotent(
      db,
      actor,
      null,
      'membership.create',
      commandKey(request),
      data,
      async (tx) => {
        for (const systemId of data.systemIds) {
          const [system] = await rows(
            tx,
            sql`SELECT id FROM systems WHERE id=${systemId} AND organization_id=${actor.organizationId}`,
          );
          if (!system)
            throw new DomainError('not_found', 'System not found', 404);
        }
        const id = identifier();
        const [existing] = await rows(
          tx,
          sql`SELECT id FROM memberships WHERE issuer=${data.issuer} AND subject=${data.subject}`,
        );
        if (existing)
          throw new DomainError(
            'membership_exists',
            'This identity already has a membership; update it instead',
            409,
          );
        await tx.execute(
          sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,system_ids,all_systems) VALUES(${id},${actor.organizationId},${data.issuer},${data.subject},${data.displayName},${textArray(data.roles)},${textArray(data.systemIds)},${data.allSystems})`,
        );
        await audit(
          tx,
          actor,
          null,
          'membership.created',
          id,
          request.id,
          undefined,
          {
            roles: data.roles,
            systemIds: data.systemIds,
            allSystems: data.allSystems,
          },
        );
        return { id, ...data };
      },
    );
  });
  app.put<{ Params: { id: string } }>(
    '/api/v1/memberships/:id',
    async (request) => {
      const actor = requestActor(request);
      authorize(actor, null, 'memberships:write', 'admin');
      const data = MembershipUpdateInputSchema.parse(request.body);
      return idempotent(
        db,
        actor,
        null,
        `membership.${request.params.id}.update`,
        commandKey(request),
        data,
        async (tx) => {
          await tx.execute(
            sql`SELECT id FROM organizations WHERE id=${actor.organizationId} FOR UPDATE`,
          );
          const [existing] = await rows(
            tx,
            sql`SELECT * FROM memberships WHERE id=${request.params.id} AND organization_id=${actor.organizationId} FOR UPDATE`,
          );
          if (!existing)
            throw new DomainError('not_found', 'Membership not found', 404);
          if (
            data.issuer !== existing.issuer ||
            data.subject !== existing.subject
          )
            throw new DomainError(
              'identity_immutable',
              'An existing membership cannot be reassigned to another identity',
            );
          for (const systemId of data.systemIds) {
            const [system] = await rows(
              tx,
              sql`SELECT id FROM systems WHERE organization_id=${actor.organizationId} AND id=${systemId}`,
            );
            if (!system)
              throw new DomainError('not_found', 'System not found', 404);
          }
          if (
            (existing.roles as string[]).includes('admin') &&
            (!data.active || !data.roles.includes('admin'))
          ) {
            const admins = await rows(
              tx,
              sql`SELECT id FROM memberships WHERE organization_id=${actor.organizationId} AND active=true AND 'admin'=ANY(roles) AND id<>${request.params.id}`,
            );
            if (!admins.length)
              throw new DomainError(
                'last_administrator',
                'Keep at least one active administrator',
                409,
              );
          }
          await tx.execute(
            sql`UPDATE memberships SET display_name=${data.displayName},roles=${textArray(data.roles)},system_ids=${textArray(data.systemIds)},all_systems=${data.allSystems},active=${data.active} WHERE id=${request.params.id} AND organization_id=${actor.organizationId}`,
          );
          await audit(
            tx,
            actor,
            null,
            'membership.updated',
            request.params.id,
            request.id,
            undefined,
            {
              roles: data.roles,
              systemIds: data.systemIds,
              allSystems: data.allSystems,
              active: data.active,
            },
          );
          return { id: request.params.id, ...data };
        },
      );
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/memberships/:id',
    async (request, reply) => {
      const actor = requestActor(request);
      authorize(actor, null, 'memberships:write', 'admin');
      if (actor.id === request.params.id)
        throw new DomainError(
          'self_removal',
          'Cannot revoke your own membership',
        );
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM organizations WHERE id=${actor.organizationId} FOR UPDATE`,
        );
        const [target] = await rows(
          tx,
          sql`SELECT * FROM memberships WHERE id=${request.params.id} AND organization_id=${actor.organizationId} FOR UPDATE`,
        );
        if (!target || target.active !== true) return;
        if ((target.roles as string[]).includes('admin')) {
          const remaining = await rows(
            tx,
            sql`SELECT id FROM memberships WHERE organization_id=${actor.organizationId} AND active=true AND 'admin'=ANY(roles) AND id<>${request.params.id}`,
          );
          if (!remaining.length)
            throw new DomainError(
              'last_administrator',
              'Keep at least one active administrator',
              409,
            );
        }
        await tx.execute(
          sql`UPDATE memberships SET active=false WHERE organization_id=${actor.organizationId} AND id=${request.params.id}`,
        );
        await audit(
          tx,
          actor,
          null,
          'membership.revoked',
          request.params.id,
          request.id,
        );
      });
      return reply.code(204).send();
    },
  );
  app.get('/api/v1/tokens', async (request) => {
    const actor = requestActor(request);
    authorize(actor, null, 'tokens:read', 'admin');
    return {
      items: await rows(
        db,
        sql`SELECT id,name,system_ids AS "systemIds",actions,expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM credentials WHERE organization_id=${actor.organizationId} ORDER BY created_at`,
      ),
    };
  });
  app.post('/api/v1/tokens', async (request) => {
    const actor = requestActor(request);
    authorize(actor, null, 'tokens:write', 'admin');
    const data = TokenInputSchema.parse(request.body);
    if (Date.parse(data.expiresAt) <= Date.now())
      throw new DomainError(
        'expiry_invalid',
        'Credential expiry must be in the future',
      );
    let secret: string | undefined;
    const result = await idempotent(
      db,
      actor,
      null,
      'credential.create',
      commandKey(request),
      data,
      async (tx) => {
        const token = `zazie_${randomBytes(32).toString('base64url')}`;
        const id = identifier();
        for (const systemId of data.systemIds) {
          authorize(actor, systemId, 'tokens:write', 'admin');
          const [system] = await rows(
            tx,
            sql`SELECT id FROM systems WHERE organization_id=${actor.organizationId} AND id=${systemId}`,
          );
          if (!system)
            throw new DomainError('not_found', 'System not found', 404);
        }
        await tx.execute(
          sql`INSERT INTO credentials(id,organization_id,name,verifier,system_ids,actions,expires_at,created_by) VALUES(${id},${actor.organizationId},${data.name},${tokenHash(token)},${textArray(data.systemIds)},${textArray(data.actions)},${data.expiresAt},${actor.id})`,
        );
        await audit(tx, actor, null, 'credential.created', id, request.id);
        secret = token;
        return { id, ...data };
      },
    );
    // Retry metadata is durable; the secret is deliberately never persisted in a replay response.
    return {
      ...result,
      ...(secret ? { token: secret } : { secretAlreadyIssued: true }),
    };
  });
  app.delete<{ Params: { id: string } }>(
    '/api/v1/tokens/:id',
    async (request, reply) => {
      const actor = requestActor(request);
      authorize(actor, null, 'tokens:write', 'admin');
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE credentials SET revoked_at=now() WHERE organization_id=${actor.organizationId} AND id=${request.params.id}`,
        );
        await audit(
          tx,
          actor,
          null,
          'credential.revoked',
          request.params.id,
          request.id,
        );
      });
      return reply.code(204).send();
    },
  );
}
