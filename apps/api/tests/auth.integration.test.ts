import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identifier, rows, sql, textArray } from '@zazie/database';
import { providerStarterPack } from '@zazie/workflow-packs';
import { createApplication } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite('HTTPS sessions behind a trusted reverse proxy', () => {
  it('sets a Secure session cookie only when forwarded HTTPS comes from a trusted proxy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zazie-proxy-'));
    const secret = 'synthetic-proxy-session-secret-more-than-32';
    let runtime: Awaited<ReturnType<typeof createApplication>> | undefined;
    try {
      runtime = await createApplication(
        loadConfig({
          DATABASE_URL: connectionString!,
          SESSION_SECRET: secret,
          OIDC_ISSUER: 'https://identity.example.test',
          OIDC_CLIENT_ID: 'test',
          PUBLIC_URL: 'https://zazie.example.test',
          COOKIE_SECURE: 'true',
          TRUST_PROXY: '127.0.0.1/32',
          ARTIFACT_ROOT: root,
        }),
      );
      const organizationId = identifier();
      const memberId = identifier();
      const sessionId = identifier();
      await runtime.database.db.execute(
        sql`INSERT INTO organizations(id,name) VALUES(${organizationId},'Proxy session test organisation')`,
      );
      await runtime.database.db.execute(
        sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${memberId},${organizationId},'https://identity.example.test',${memberId},'Proxy test viewer',${textArray(['viewer'])},true)`,
      );
      await runtime.database.db.execute(
        sql`INSERT INTO sessions(id,data,expires_at) VALUES(${sessionId},${JSON.stringify({ membershipId: memberId, csrfToken: 'synthetic-proxy-csrf', cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), secure: true, httpOnly: true, sameSite: 'lax', path: '/' } })}::jsonb,now()+interval '1 hour')`,
      );
      const request = {
        method: 'GET' as const,
        url: '/api/v1/session',
        headers: {
          cookie: `zazie_session=${encodeURIComponent(sign(sessionId, secret))}`,
          'x-forwarded-proto': 'https',
        },
      };
      const trusted = await runtime.app.inject({
        ...request,
        remoteAddress: '127.0.0.1',
      });
      expect(trusted.statusCode, trusted.body).toBe(200);
      expect(trusted.headers['set-cookie']).toEqual(
        expect.stringContaining('zazie_session='),
      );
      expect(trusted.headers['set-cookie']).toEqual(
        expect.stringContaining('; Secure'),
      );

      const untrusted = await runtime.app.inject({
        ...request,
        remoteAddress: '203.0.113.10',
      });
      expect(untrusted.statusCode, untrusted.body).toBe(200);
      expect(untrusted.headers['set-cookie']).toBeUndefined();
    } finally {
      await runtime?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
suite('HTTP authentication, browser sessions and scoped credentials', () => {
  let runtime: Awaited<ReturnType<typeof createApplication>>;
  let root: string;
  let organizationId: string;
  let ownerId: string;
  let systemId: string;
  const secret = 'synthetic-test-session-secret-more-than-32';
  const csrf = 'synthetic-csrf-value';
  let cookie: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'zazie-http-'));
    runtime = await createApplication(
      loadConfig({
        DATABASE_URL: connectionString!,
        SESSION_SECRET: secret,
        OIDC_ISSUER: 'https://identity.example.test',
        OIDC_CLIENT_ID: 'test',
        PUBLIC_URL: 'http://localhost:3000',
        COOKIE_SECURE: 'false',
        ARTIFACT_ROOT: root,
      }),
    );
    organizationId = identifier();
    ownerId = identifier();
    const sessionId = identifier();
    await runtime.database.db.execute(
      sql`INSERT INTO organizations(id,name) VALUES(${organizationId},'HTTP test organisation')`,
    );
    await runtime.database.db.execute(
      sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${ownerId},${organizationId},'https://identity.example.test',${ownerId},'HTTP reviewer',${textArray(['admin', 'editor', 'reviewer'])},true)`,
    );
    await runtime.database.db.execute(
      sql`INSERT INTO sessions(id,data,expires_at) VALUES(${sessionId},${JSON.stringify({ membershipId: ownerId, csrfToken: csrf, cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), secure: false, httpOnly: true, sameSite: 'lax', path: '/' } })}::jsonb,now()+interval '1 hour')`,
    );
    cookie = `zazie_session=${encodeURIComponent(sign(sessionId, secret))}`;
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: {
        cookie,
        'x-csrf-token': csrf,
        'idempotency-key': identifier(),
      },
      payload: {
        name: 'HTTP synthetic system',
        intendedUse: 'Test the HTTP boundary with synthetic records.',
        ownerId,
        highRiskCategory: 'Customer-supplied test category',
        actorRoles: ['provider'],
        affectedPopulation: 'Synthetic records only',
        workflowPackId: providerStarterPack.id,
        workflowPackVersion: providerStarterPack.version,
        synthetic: true,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    systemId = response.json().id;
  });
  afterAll(async () => {
    await runtime?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  const headers = () => ({
    cookie,
    'x-csrf-token': csrf,
    'idempotency-key': identifier(),
  });
  it('uses the consistent error envelope and rejects CSRF/origin violations', async () => {
    const anonymous = await runtime.app.inject({
      method: 'GET',
      url: '/api/v1/session',
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({
      code: 'unauthenticated',
      requestId: expect.any(String),
    });
    const missing = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      headers: { cookie },
      payload: {},
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().code).toBe('csrf_invalid');
    const foreign = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      headers: { ...headers(), origin: 'https://attacker.example.test' },
      payload: {},
    });
    expect(foreign.statusCode).toBe(403);
  });
  it('mints a credential once, never persists its secret in replay metadata, and enforces revocation', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/tokens',
      headers: headers(),
      payload: {
        name: 'Read-only fixture',
        systemIds: [systemId],
        actions: ['systems:read'],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    };
    const created = await runtime.app.inject(request);
    expect(created.statusCode, created.body).toBe(200);
    const token = created.json().token as string;
    expect(token).toMatch(/^zazie_/);
    const replay = await runtime.app.inject(request);
    expect(replay.json()).toMatchObject({
      id: created.json().id,
      secretAlreadyIssued: true,
    });
    expect(replay.json().token).toBeUndefined();
    const cached = await rows(
      runtime.database.db,
      sql`SELECT response FROM idempotency WHERE organization_id=${organizationId} AND key=${request.headers['idempotency-key']}`,
    );
    expect(JSON.stringify(cached)).not.toContain(token);
    const read = await runtime.app.inject({
      method: 'GET',
      url: `/api/v1/systems/${systemId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    const forbidden = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/systems/${systemId}/versions`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': identifier(),
      },
      payload: {
        label: 'v1',
        components: { model: 'test' },
        changeSummary: 'Test',
      },
    });
    expect(forbidden.statusCode).toBe(403);
    await runtime.app.inject({
      method: 'DELETE',
      url: `/api/v1/tokens/${created.json().id}`,
      headers: headers(),
    });
    const revoked = await runtime.app.inject({
      method: 'GET',
      url: `/api/v1/systems/${systemId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoked.statusCode).toBe(401);
  });
  it('provisions one membership per retry and prevents removing the final administrator', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/memberships',
      headers: headers(),
      payload: {
        issuer: 'https://identity.example.test',
        subject: identifier(),
        displayName: 'Synthetic viewer',
        roles: ['viewer'],
        systemIds: [systemId],
        allSystems: false,
      },
    };
    const first = await runtime.app.inject(request);
    const second = await runtime.app.inject(request);
    expect(first.statusCode, first.body).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    const bad = await runtime.app.inject({
      method: 'PUT',
      url: `/api/v1/memberships/${ownerId}`,
      headers: headers(),
      payload: {
        issuer: 'https://identity.example.test',
        subject: ownerId,
        displayName: 'HTTP reviewer',
        roles: ['viewer'],
        systemIds: [],
        allSystems: true,
        active: true,
      },
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().code).toBe('last_administrator');
  });
  it('serializes concurrent administrator revocations so one administrator survives', async () => {
    const secondId = identifier();
    const secondSession = identifier();
    await runtime.database.db.execute(
      sql`INSERT INTO memberships(id,organization_id,issuer,subject,display_name,roles,all_systems) VALUES(${secondId},${organizationId},'https://identity.example.test',${secondId},'Second synthetic admin',${textArray(['admin'])},true)`,
    );
    await runtime.database.db.execute(
      sql`INSERT INTO sessions(id,data,expires_at) VALUES(${secondSession},${JSON.stringify({ membershipId: secondId, csrfToken: csrf, cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), secure: false, path: '/' } })}::jsonb,now()+interval '1 hour')`,
    );
    const secondCookie = `zazie_session=${encodeURIComponent(sign(secondSession, secret))}`;
    const attempts = await Promise.all([
      runtime.app.inject({
        method: 'DELETE',
        url: `/api/v1/memberships/${secondId}`,
        headers: headers(),
      }),
      runtime.app.inject({
        method: 'DELETE',
        url: `/api/v1/memberships/${ownerId}`,
        headers: { ...headers(), cookie: secondCookie },
      }),
    ]);
    expect(attempts.filter((result) => result.statusCode === 204)).toHaveLength(
      1,
    );
    const remaining = await rows(
      runtime.database.db,
      sql`SELECT id FROM memberships WHERE organization_id=${organizationId} AND active=true AND 'admin'=ANY(roles)`,
    );
    expect(remaining).toHaveLength(1);
  });
});
