import { expect, test, type Locator, type Page } from '@playwright/test';

const steps = [
  ['Your workspace at a glance', '/'],
  ['Your AI systems', '/systems'],
  ['Understand the flow', 'overview'],
  ['Start with a system version', 'configuration'],
  ['Define what a release must satisfy', 'configuration'],
  ['Connect your application', 'operations'],
  ['Turn observations into follow-up', 'operations'],
  ['Bring the evidence', 'evidence'],
  ['Review, then approve', 'release'],
  ['Keep a shareable record', 'documents'],
] as const;

const systemNames: Record<string, string> = {
  'tour-system': 'Empty synthetic system',
  'second-system': 'Another synthetic system',
  'unavailable-system': 'Unavailable synthetic system',
};

// Exercise the real router and UI through their HTTP boundary. These empty,
// read-only fixtures require neither seeded evidence nor a running API or IdP.
async function mockWorkspace(
  page: Page,
  options: {
    systemIds?: string[];
    loadSystem?: (id: string) => Promise<number>;
  } = {},
) {
  const identity = {
    userId: 'tour-viewer',
    organizationId: 'tour-organization',
  };
  const systemIds = options.systemIds ?? ['tour-system'];
  const unexpectedRequests: string[] = [];
  const mutations: string[] = [];
  const systemData = (id: string) => ({
    name: systemNames[id],
    intendedUse: 'Explain the workflow without changing records.',
    ownerId: 'tour-owner',
    highRiskCategory: 'Supplied synthetic classification',
    actorRoles: ['provider'],
    affectedPopulation: 'Fictional people only',
    workflowPackId: 'synthetic-tour-profile',
    workflowPackVersion: '1.0',
    synthetic: true,
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 405,
        json: { message: 'Read-only fixture' },
      });
    } else if (path === '/api/v1/session') {
      await route.fulfill({
        json: {
          user: { id: identity.userId, displayName: 'Tour viewer' },
          organization: { id: identity.organizationId, name: 'Tour workspace' },
          roles: ['viewer'],
          systemIds,
          allSystems: false,
          csrfToken: 'synthetic-test-only',
        },
      });
    } else if (path === '/api/v1/systems') {
      await route.fulfill({
        json: { items: systemIds.map((id) => ({ id, ...systemData(id) })) },
      });
    } else if (path === '/api/v1/overview') {
      await route.fulfill({
        json: { openFindings: 0, pendingReviews: 0, staleEvidence: 0 },
      });
    } else if (
      systemIds.some((id) => path === `/api/v1/systems/${id}/overview`)
    ) {
      const id = path.split('/')[4]!;
      const status = (await options.loadSystem?.(id)) ?? 200;
      await route.fulfill({
        status,
        json:
          status !== 200
            ? { message: 'This synthetic system is temporarily unavailable.' }
            : {
                system: {
                  id,
                  revision: 1,
                  evidenceRevision: 1,
                  data: systemData(id),
                },
                workflowPack: {
                  title: 'Synthetic draft profile',
                  requirements: [],
                },
              },
      });
    } else {
      unexpectedRequests.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 404,
        json: { message: 'Unexpected request' },
      });
    }
  });
  return { identity, unexpectedRequests, mutations };
}

const guide = (page: Page) =>
  page.getByRole('dialog', { name: 'Guided tour', exact: true });

const target = (page: Page) => page.locator('[data-tour-active="true"]');

async function expectStep(
  page: Page,
  index: number,
  systemId = 'tour-system',
): Promise<Locator> {
  const [title, destination] = steps[index]!;
  const panel = guide(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-modal', 'false');
  await expect(
    panel.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  const route = index < 2 ? destination : `/systems/${systemId}/${destination}`;
  // A normal system card may retain the equivalent route without a tab suffix.
  const hash =
    index === 2 ? `#/systems/${systemId}(?:/overview)?$` : `#${route}$`;
  await expect(page).toHaveURL(new RegExp(hash));
  await expect(panel.getByRole('button', { name: 'Back', exact: true }))[
    index === 0 ? 'toBeDisabled' : 'toBeEnabled'
  ]();
  return panel;
}

async function expectAnchored(page: Page) {
  const panel = guide(page);
  const anchor = target(page);
  await expect(anchor).toHaveCount(1);
  await expect(anchor).toBeInViewport();
  await expect
    .poll(async () => {
      const a = await anchor.boundingBox();
      const p = await panel.boundingBox();
      if (!a || !p) return false;
      // The floating card must leave the actual target exposed, with a gap.
      return (
        p.x + p.width + 3 <= a.x ||
        a.x + a.width + 3 <= p.x ||
        p.y + p.height + 3 <= a.y ||
        a.y + a.height + 3 <= p.y
      );
    })
    .toBe(true);
  await expect(panel.locator('.tour-pointer')).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.width).toBeLessThanOrEqual(520);
  if (viewport.width >= 935) expect(bounds.width).toBeGreaterThanOrEqual(480);
  expect(
    await panel
      .locator('h2')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(24);
  expect(
    await panel
      .locator('.tour-introduction')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(15);
  await expect(panel.locator('details, summary')).toHaveCount(0);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(
    await panel.evaluate((element) => getComputedStyle(element).position),
  ).toBe('fixed');
  expect(
    await page.evaluate(() => getComputedStyle(document.body).overflow),
  ).not.toBe('hidden');
  expect(
    await anchor.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const visible = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return (
        visible !== null && (element === visible || element.contains(visible))
      );
    }),
  ).toBe(true);
}

const tabSteps = [4, 5, 7, 8, 9];

async function expectStepAnchor(page: Page, index: number) {
  const selector =
    index === 2
      ? '#system-context > header h2'
      : index === 3
        ? '#section-versions > header h2'
        : index === 6
          ? '#section-findings > header h2'
          : '#system-tabs [aria-current="page"]';
  await expect(page.locator(selector)).toHaveAttribute(
    'data-tour-active',
    'true',
  );
  if (tabSteps.includes(index)) await expectTabRowExposed(page);
}

async function expectTabRowExposed(page: Page) {
  const activeTab = page.locator('#system-tabs [aria-current="page"]');
  const row = page.locator('#system-tabs');
  await expect(activeTab).toHaveAttribute('data-tour-active', 'true');
  await expect(activeTab).toBeInViewport();
  await expect(row).toBeInViewport();
  await expect
    .poll(async () => {
      const current = (await row.boundingBox())!;
      const panel = (await guide(page).boundingBox())!;
      return (
        panel.x + panel.width <= current.x ||
        current.x + current.width <= panel.x ||
        panel.y + panel.height <= current.y ||
        current.y + current.height <= panel.y
      );
    })
    .toBe(true);
}

async function start(page: Page) {
  await page.goto('/#/');
  await page
    .getByRole('button', { name: 'Start guided tour', exact: true })
    .click();
  return expectStep(page, 0);
}

async function chooseSystem(page: Page) {
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expectStep(page, 1);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  return expectStep(page, 2);
}

async function documentPosition(locator: Locator) {
  return locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x + scrollX,
      y: bounds.y + scrollY,
      width: bounds.width,
      height: bounds.height,
    };
  });
}

test('a viewer follows the complete anchored tour without changing records or cluttering history', async ({
  page,
}) => {
  const fixture = await mockWorkspace(page);
  await page.goto('/#/systems/tour-system/documents');
  await expect(guide(page)).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Start tour from Overview', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/$/);
  await page
    .getByRole('button', { name: 'Start guided tour', exact: true })
    .click();
  const initialHistoryLength = await page.evaluate(() => history.length);
  const first = await expectStep(page, 0);
  await expectAnchored(page);
  await first.getByRole('button', { name: 'Next', exact: true }).click();
  const choice = await expectStep(page, 1);
  await expectAnchored(page);
  await expect(
    choice.getByRole('button', { name: 'Next', exact: true }),
  ).toBeEnabled();
  await expect(choice.getByRole('combobox')).toHaveCount(0);
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);
  await choice.getByRole('button', { name: 'Next', exact: true }).click();
  const selectedHistoryLength = await page.evaluate(() => history.length);
  expect(selectedHistoryLength).toBe(initialHistoryLength);

  for (let index = 2; index < steps.length; index++) {
    const panel = await expectStep(page, index);
    await expectAnchored(page);
    await expectStepAnchor(page, index);
    if (index === 2) {
      await expect(page.locator('#system-tabs a')).toHaveText([
        'Risks & configuration',
        'Operations',
        'Evaluations & evidence',
        'Release review',
        'Documents',
      ]);
    }
    await expect(panel.getByRole('button')).toHaveText([
      'End tour',
      'Back',
      index === steps.length - 1 ? 'Finish tour' : 'Next',
    ]);
    if (index === 3) {
      await panel.getByRole('button', { name: 'Back', exact: true }).click();
      const previous = await expectStep(page, 2);
      await previous.getByRole('button', { name: 'Next', exact: true }).click();
      await expectStep(page, index);
    }
    if (index === 5) {
      await expect(
        panel.getByText(/oversight\.override_recorded/),
      ).toBeVisible();
      await expectAnchored(page);
    }
    await panel
      .getByRole('button', {
        name: index === steps.length - 1 ? 'Finish tour' : 'Next',
        exact: true,
      })
      .click();
  }

  await expect(guide(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/systems\/tour-system\/documents$/);
  expect(await page.evaluate(() => history.length)).toBe(selectedHistoryLength);
  expect(fixture.mutations).toEqual([]);
  expect(fixture.unexpectedRequests).toEqual([]);
});

test('page navigation remains clickable and unrelated navigation ends the tour', async ({
  page,
}) => {
  const { mutations } = await mockWorkspace(page);
  await start(page);
  await chooseSystem(page);
  const operations = page
    .getByRole('navigation', { name: 'System sections' })
    .getByRole('link', { name: 'Operations', exact: true });
  await operations.click();
  const panel = await expectStep(page, 5);
  await expectAnchored(page);
  await panel.getByRole('button', { name: 'End tour', exact: true }).click();
  await expect(guide(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Events', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Start tour from Overview', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Start guided tour', exact: true })
    .click();
  await expectStep(page, 0);
  // A viewer does not have an Administration navigation link. Direct navigation
  // to an unrelated route must still end the guide and preserve access checks.
  await page.evaluate(() => {
    location.hash = '#/administration';
  });
  await expect(guide(page)).toHaveCount(0);
  await expect(
    page.getByText('Administrator access required', { exact: true }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test('both Overview pages always expose Start guided tour and replay begins at workspace Overview', async ({
  page,
}) => {
  await mockWorkspace(page);
  for (const route of ['/#/', '/#/systems/tour-system/overview']) {
    await page.goto(route);
    const launcher = page.getByRole('button', {
      name: 'Start guided tour',
      exact: true,
    });
    await expect(launcher).toBeInViewport();
    await launcher.click();
    await expectStep(page, 0);
    await page.keyboard.press('Escape');
    await expect(guide(page)).toHaveCount(0);
    await expect(launcher).toBeVisible();
    await page.reload();
    await expect(launcher).toBeVisible();
    await launcher.click();
    await expectStep(page, 0);
    await guide(page)
      .getByRole('button', { name: 'End tour', exact: true })
      .click();
    await expect(guide(page)).toHaveCount(0);
    await expect(launcher).toBeVisible();
  }
});

test('an empty registry explains registration without selecting or creating a system', async ({
  page,
}) => {
  const fixture = await mockWorkspace(page, { systemIds: [] });
  await start(page);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  const panel = await expectStep(page, 1);
  await expectAnchored(page);
  await expect(panel).toContainText(/administrator|editor/i);
  await expect(page.locator('.system-card')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Register system', exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Back', exact: true }).click();
  await expectStep(page, 0);
  await guide(page)
    .getByRole('button', { name: 'End tour', exact: true })
    .click();
  expect(fixture.mutations).toEqual([]);
  expect(fixture.unexpectedRequests).toEqual([]);
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 935, height: 763 },
]) {
  test(`the ${viewport.width}px popover floats beside its visible target without shifting page content`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockWorkspace(page);
    await page.goto('/#/');
    const launcher = page.getByRole('button', {
      name: 'Start guided tour',
      exact: true,
    });
    await expect(launcher).toBeInViewport();
    await expect(page.locator('.system-card')).toBeVisible();
    const before = await documentPosition(page.locator('#system-list'));
    await launcher.click();
    await expectStep(page, 0);
    await expectAnchored(page);
    expect(await documentPosition(page.locator('#system-list'))).toEqual(
      before,
    );
    await chooseSystem(page);
    for (let index = 2; index < steps.length; index++) {
      const panel = await expectStep(page, index);
      await expectAnchored(page);
      await expectStepAnchor(page, index);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (index === 5) {
        await page.screenshot({
          path: testInfo.outputPath(`tour-events-${viewport.width}.png`),
        });
      }
      if (index === 7) {
        // All teaching copy is present by default. The body scrolls while the
        // target, heading and navigation controls remain available.
        const reminder = panel.getByText(
          'Zazie does not run these tests or verify their execution. Your team must assess whether the tests and thresholds are appropriate.',
          { exact: true },
        );
        await reminder.scrollIntoViewIfNeeded();
        await expect(reminder).toBeInViewport();
        await expectAnchored(page);
        await expectStepAnchor(page, index);
        await expect(
          panel.getByRole('button', { name: 'Next', exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: testInfo.outputPath(`tour-full-copy-${viewport.width}.png`),
        });
      }
      if (index >= 3) {
        await panel.getByRole('button', { name: 'Back', exact: true }).click();
        await expectStep(page, index - 1);
        await expectStepAnchor(page, index - 1);
        await guide(page)
          .getByRole('button', { name: 'Next', exact: true })
          .click();
        await expectStep(page, index);
        await expectStepAnchor(page, index);
      }
      await panel
        .getByRole('button', {
          name: index === steps.length - 1 ? 'Finish tour' : 'Next',
          exact: true,
        })
        .click();
    }
    await expect(guide(page)).toHaveCount(0);
  });
}

test('the anchored card tracks scrolling and responsive layout changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 935, height: 763 });
  await mockWorkspace(page);
  await start(page);
  await chooseSystem(page);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expectStep(page, 3);
  await expectAnchored(page);
  const anchorBefore = (await target(page).boundingBox())!;
  const pointerBefore = (await guide(page)
    .locator('.tour-pointer')
    .boundingBox())!;
  await page.evaluate(() => scrollBy(0, 24));
  await expectAnchored(page);
  // Near a viewport edge the card can stay clamped while its arrow moves.
  await expect
    .poll(async () => {
      const anchorAfter = (await target(page).boundingBox())!;
      const pointerAfter = (await guide(page)
        .locator('.tour-pointer')
        .boundingBox())!;
      return Math.abs(
        pointerAfter.y - pointerBefore.y - (anchorAfter.y - anchorBefore.y),
      );
    })
    .toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page
    .getByRole('button', { name: 'Return to tour', exact: true })
    .click();
  await expectAnchored(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo(0, 0));
  await expectAnchored(page);
});

test('loading and unavailable systems keep a compact dismissible guide without advancing to absent content', async ({
  page,
}) => {
  let releaseLoad!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const fixture = await mockWorkspace(page, {
    systemIds: ['tour-system', 'second-system', 'unavailable-system'],
    loadSystem: async (id) => {
      if (id === 'second-system') await pending;
      return id === 'unavailable-system' ? 503 : 200;
    },
  });
  await start(page);
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await page
    .locator('.system-card')
    .filter({ hasText: systemNames['second-system']! })
    .click();
  await expect(
    page.getByText('Loading system workspace…', { exact: true }),
  ).toBeVisible();
  await expect(guide(page)).toBeVisible();
  await expect(
    guide(page).getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  expect((await guide(page).boundingBox())!.width).toBeLessThanOrEqual(520);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).overflow),
  ).not.toBe('hidden');
  releaseLoad();
  await expectStep(page, 2, 'second-system');
  await expectAnchored(page);
  await expect(
    page.getByRole('heading', {
      name: systemNames['second-system']!,
      exact: true,
    }),
  ).toBeVisible();
  await guide(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expectStep(page, 3, 'second-system');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'AI systems', exact: true })
    .click();
  await expectStep(page, 1);
  await page
    .locator('.system-card')
    .filter({ hasText: systemNames['unavailable-system']! })
    .click();
  await expect(
    page.getByText('This synthetic system is temporarily unavailable.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    /#\/systems\/unavailable-system(?:\/overview)?$/,
  );
  await expect(
    guide(page).getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  await guide(page)
    .getByRole('button', { name: 'End tour', exact: true })
    .click();
  await expect(guide(page)).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
  expect(fixture.unexpectedRequests).toEqual([]);
});
