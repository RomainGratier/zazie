import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

type RecordResponse = {
  id: string;
  revision: number;
  evidenceRevision?: number;
  data: Record<string, unknown>;
};

async function login(page: Page, role: 'owner' | 'viewer') {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in to your workspace' }).click();
  await page.getByLabel('Username or email').fill(`demo-${role}`);
  await page
    .getByLabel('Password', { exact: true })
    .fill(`local-demo-${role}-only`);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A clear view of what needs you.' }),
  ).toBeVisible();
}

async function post(
  page: Page,
  path: string,
  body: unknown,
): Promise<RecordResponse> {
  const session = (await (
    await page.request.get('/api/v1/session')
  ).json()) as { csrfToken: string };
  const response = await page.request.post(`/api/v1${path}`, {
    data: body,
    headers: {
      'x-csrf-token': session.csrfToken,
      'idempotency-key': randomUUID(),
    },
  });
  expect(
    response.ok(),
    `${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return response.json() as Promise<RecordResponse>;
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.ZAZIE_E2E_URL ?? 'http://localhost:3000',
  });
  const page = await context.newPage();
  try {
    await login(page, 'owner');
    const session = (await (
      await page.request.get('/api/v1/session')
    ).json()) as { user: { id: string } };
    const members = (await (
      await page.request.get('/api/v1/memberships')
    ).json()) as {
      items: Array<{
        id: string;
        issuer: string;
        subject: string;
        active: boolean;
      }>;
    };
    const viewer = members.items.find(
      (member) => member.subject === '22222222-2222-4222-8222-222222222222',
    );
    if (!viewer) {
      const issuer = members.items.find(
        (member) => member.id === session.user.id,
      )?.issuer;
      expect(issuer, 'Owner has a provisioned OIDC identity').toBeTruthy();
      await post(page, '/memberships', {
        issuer,
        subject: '22222222-2222-4222-8222-222222222222',
        displayName: 'Demo Viewer',
        roles: ['viewer'],
        systemIds: [],
        allSystems: true,
      });
    }
    expect(
      viewer?.active ?? true,
      'The synthetic viewer membership is active',
    ).toBeTruthy();
  } finally {
    await context.close();
  }
});

test('OIDC owner journey freezes and approves evidence, then blocks a changed prompt', async ({
  page,
}, testInfo) => {
  await login(page, 'owner');
  const session = (await (
    await page.request.get('/api/v1/session')
  ).json()) as { user: { id: string } };
  const name = `Synthetic browser system ${randomUUID().slice(0, 8)}`;
  await page
    .getByRole('button', { name: 'Register system', exact: true })
    .first()
    .click();
  const form = page.getByRole('dialog');
  await form.getByLabel('System name', { exact: true }).fill(name);
  await form
    .getByLabel('Intended use', { exact: true })
    .fill(
      'Synthetic decision-support test with an authorised reviewer and no real personal data.',
    );
  await form
    .getByLabel('Supplied high-risk classification', { exact: true })
    .fill('Customer-supplied employment classification for synthetic tests');
  await form
    .getByLabel('Affected population', { exact: true })
    .fill('Fictional candidates only');
  await form
    .getByLabel('This system contains synthetic demonstration data')
    .check();
  await form
    .getByRole('button', { name: 'Register system', exact: true })
    .click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const systemId = new URL(page.url()).hash.split('/')[2]!;
  const base = `/systems/${systemId}`;
  const version = await post(page, `${base}/versions`, {
    label: '1.0',
    components: { prompt: 'prompt-v1', model: 'synthetic-model-v1' },
    changeSummary: 'Initial synthetic manifest',
  });
  const deployment = await post(page, `${base}/deployments`, {
    versionId: version.id,
    name: 'Synthetic staging',
    environment: 'staging',
    context: 'Synthetic browser acceptance test only',
    ownerId: session.user.id,
  });
  const risk = await post(page, `${base}/risks`, {
    title: 'Incorrect synthetic recommendation',
    harm: 'A fictional candidate is incorrectly excluded',
    affectedGroups: 'Fictional candidates',
    likelihood: 'low',
    severity: 'high',
    ownerId: session.user.id,
    residualRiskDecision: 'accepted',
    rationale:
      'A human reviews every recommendation in this synthetic example.',
  });
  const definition = await post(page, `${base}/evaluation-definitions`, {
    name: 'Synthetic accuracy acceptance',
    criteria: [{ metric: 'accuracy', operator: 'gte', threshold: 0.95 }],
  });
  await post(page, `${base}/controls`, {
    title: 'Human oversight and evaluated recommendations',
    description:
      'Review recommendations and test accuracy before every release.',
    ownerId: session.user.id,
    requirementIds: [
      'risk-management',
      'evaluation-evidence',
      'human-oversight',
      'monitoring-follow-up',
    ],
    riskIds: [risk.id],
    evaluationDefinitionIds: [definition.id],
    procedureIds: [],
    configured: true,
    maxEvidenceAgeDays: 90,
  });
  const artifact = await post(page, `${base}/artifacts`, {
    filename: 'synthetic-evaluation.txt',
    contentType: 'text/plain',
    provenance: 'Deterministic synthetic browser acceptance fixture',
    contentBase64: Buffer.from(
      'Synthetic execution artifact. No personal data.',
    ).toString('base64'),
  });
  const timestamp = new Date(Date.now() - 10_000).toISOString();
  const evaluation = {
    versionId: version.id,
    definitionId: definition.id,
    definitionRevision: definition.revision,
    artifactIds: [artifact.id],
    producer: 'synthetic-browser-fixture',
    startedAt: timestamp,
    completedAt: timestamp,
  };
  await post(page, `${base}/evaluations`, {
    ...evaluation,
    measurements: { accuracy: 0.6 },
  });
  await page.goto(`/#/systems/${systemId}/release`);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'This release needs follow-up' }),
  ).toBeVisible();
  await expect(
    page.getByText(/accuracy: 0.6; requires gte 0.95/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Request release review', exact: true }),
  ).toHaveCount(0);

  await post(page, `${base}/evaluations`, {
    ...evaluation,
    completedAt: new Date(Date.now() - 1000).toISOString(),
    measurements: { accuracy: 0.98 },
  });
  await page.reload();
  await page
    .getByRole('button', { name: 'Review control', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Review rationale', { exact: true })
    .fill(
      'Reviewed the synthetic artifact, criteria, current version, and oversight procedure.',
    );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record review', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Ready for a human release decision' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Request release review', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Freeze review snapshot', exact: true })
    .click();
  await page
    .getByText('Inspect frozen review snapshot', { exact: true })
    .click();
  await expect(
    page.getByText('Snapshot SHA-256', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review and decide' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Decision', { exact: true })
    .selectOption('approve');
  await page
    .getByRole('dialog')
    .getByLabel('Decision rationale', { exact: true })
    .fill(
      'Approved only for this synthetic staging context and the exact reviewed evidence.',
    );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record decision', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Approved for this deployment' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review and decide' }),
  ).toHaveCount(0);
  await page
    .getByText('Inspect frozen review snapshot', { exact: true })
    .click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('approved-release.png'),
    fullPage: false,
  });

  const changed = await post(page, `${base}/versions`, {
    label: '2.0',
    components: { prompt: 'prompt-v2', model: 'synthetic-model-v1' },
    changeSummary: 'Changed scoring prompt requires fresh review',
  });
  await post(page, `${base}/deployments`, {
    versionId: changed.id,
    name: 'Changed staging',
    environment: 'staging',
    context: 'Synthetic changed prompt',
    ownerId: session.user.id,
  });
  await page.reload();
  await page
    .getByRole('combobox', { name: 'System version', exact: true })
    .selectOption(changed.id);
  await expect(
    page.getByRole('heading', { name: 'This release needs follow-up' }),
  ).toBeVisible();
  await expect(
    page.getByText(/submit “Synthetic accuracy acceptance” for this manifest/),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'System version', exact: true })
    .selectOption(version.id);
  await expect(
    page.getByRole('heading', { name: 'Approved for this deployment' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page
    .getByRole('button', { name: 'Request dossier', exact: true })
    .click();
  const reviewSelect = page
    .getByRole('dialog')
    .getByLabel('Release review', { exact: true });
  const reviewValue = await reviewSelect
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await reviewSelect.selectOption(reviewValue!);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Request export', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Download dossier', exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  const download = await page.request.get(
    (await page
      .getByRole('link', { name: 'Download dossier', exact: true })
      .getAttribute('href'))!,
  );
  expect(download.ok()).toBeTruthy();
  expect(download.headers()['content-type']).toContain('application/zip');
  expect((await download.body()).subarray(0, 2).toString()).toBe('PK');
});

test('viewer OIDC session cannot edit or approve and mobile navigation remains usable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'viewer');
  await expect(
    page.getByRole('button', { name: 'Register system', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Administration', exact: true }),
  ).toHaveCount(0);
  const session = (await (
    await page.request.get('/api/v1/session')
  ).json()) as { csrfToken: string };
  const denied = await page.request.post('/api/v1/systems', {
    data: {},
    headers: {
      'x-csrf-token': session.csrfToken,
      'idempotency-key': randomUUID(),
    },
  });
  expect(denied.status()).toBe(403);
  await page.getByRole('link', { name: 'AI systems', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your AI systems', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath('viewer-mobile.png'),
    fullPage: true,
  });
});
