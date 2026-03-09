import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

async function mockJudgeProviders(page: Page) {
  await page.route('**/api/plugins/grafana-sigil-app/resources/eval/judge/providers*', async (route) => {
    await route.fulfill(jsonResponse({ providers: [] }));
  });
}

async function mockEvaluationIndexData(page: Page) {
  await page.route('**/api/plugins/grafana-sigil-app/resources/eval/evaluators?*', async (route) => {
    await route.fulfill(jsonResponse({ items: [], next_cursor: '' }));
  });
  await page.route('**/api/plugins/grafana-sigil-app/resources/eval/evaluators', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill(jsonResponse({ items: [], next_cursor: '' }));
      return;
    }
    await route.continue();
  });
  await page.route('**/api/plugins/grafana-sigil-app/resources/eval/predefined/evaluators*', async (route) => {
    await route.fulfill(jsonResponse({ items: [], next_cursor: '' }));
  });
  await page.route('**/api/plugins/grafana-sigil-app/resources/eval/templates*', async (route) => {
    await route.fulfill(jsonResponse({ items: [], next_cursor: '' }));
  });
  await page.route('**/api/plugins/grafana-sigil-app/resources/eval/rules*', async (route) => {
    await route.fulfill(jsonResponse({ items: [], next_cursor: '' }));
  });
}

test.describe('evaluation validation flows', () => {
  test('create evaluator blocks empty submit before sending a request', async ({ gotoPage, page }) => {
    await mockJudgeProviders(page);

    let createEvaluatorCalls = 0;
    await page.route('**/api/plugins/grafana-sigil-app/resources/eval/evaluators', async (route) => {
      if (route.request().method() === 'POST') {
        createEvaluatorCalls += 1;
        await route.fulfill(jsonResponse({}));
        return;
      }
      await route.continue();
    });

    await gotoPage('/evaluation/evaluators/new');
    await expect(page.getByRole('heading', { name: 'Create evaluator' })).toBeVisible();

    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Evaluator ID is required')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. custom.helpfulness')).toBeFocused();
    expect(createEvaluatorCalls).toBe(0);
  });

  test('create template blocks empty submit before sending a request', async ({ gotoPage, page }) => {
    await mockJudgeProviders(page);

    let createTemplateCalls = 0;
    await page.route('**/api/plugins/grafana-sigil-app/resources/eval/templates', async (route) => {
      if (route.request().method() === 'POST') {
        createTemplateCalls += 1;
        await route.fulfill(jsonResponse({}));
        return;
      }
      await route.continue();
    });

    await gotoPage('/evaluation/templates/new');
    await expect(page.getByRole('heading', { name: 'Create template' })).toBeVisible();

    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Template ID is required')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. my_org.helpfulness')).toBeFocused();
    expect(createTemplateCalls).toBe(0);
  });

  test('create evaluator surfaces backend conflict errors without navigating away', async ({ gotoPage, page }) => {
    await mockJudgeProviders(page);

    await page.route('**/api/plugins/grafana-sigil-app/resources/eval/evaluators', async (route) => {
      if (route.request().method() === 'POST') {
        const request = route.request().postDataJSON() as { evaluator_id?: string };
        const evaluatorID = request.evaluator_id ?? 'unknown';
        await route.fulfill(
          jsonResponse(
            {
              message: `evaluator "${evaluatorID}" already exists`,
            },
            409
          )
        );
        return;
      }
      await route.continue();
    });

    await gotoPage('/evaluation/evaluators/new');
    await expect(page.getByRole('heading', { name: 'Create evaluator' })).toBeVisible();

    await page.getByPlaceholder('e.g. custom.helpfulness').fill('dupe.eval');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(/\/evaluation\/evaluators\/new$/);
    await expect(page.getByText('evaluator "dupe.eval" already exists')).toBeVisible();
  });

  test('create evaluator submits heuristic config as a v2 rule tree', async ({ gotoPage, page }) => {
    await mockJudgeProviders(page);
    await mockEvaluationIndexData(page);

    let createPayload: Record<string, unknown> | undefined;
    await page.route('**/api/plugins/grafana-sigil-app/resources/eval/evaluators', async (route) => {
      if (route.request().method() === 'POST') {
        createPayload = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill(
          jsonResponse({
            tenant_id: 'fake',
            evaluator_id: createPayload.evaluator_id,
            version: createPayload.version,
            kind: createPayload.kind,
            description: createPayload.description ?? '',
            config: createPayload.config,
            output_keys: createPayload.output_keys,
            created_at: '2026-03-09T00:00:00Z',
            updated_at: '2026-03-09T00:00:00Z',
          })
        );
        return;
      }
      await route.fulfill(jsonResponse({ items: [], next_cursor: '' }));
    });

    await gotoPage('/evaluation/evaluators/new');
    await expect(page.getByRole('heading', { name: 'Create evaluator' })).toBeVisible();

    await page.getByPlaceholder('e.g. custom.helpfulness').fill('custom.heuristic.refund');
    await page.getByRole('combobox').first().click();
    await page.getByText('Heuristic', { exact: true }).click();

    await expect(page.getByText('Heuristic configuration')).toBeVisible();
    await expect(page.locator('input[value="heuristic_pass"]')).toBeVisible();

    await page.getByRole('combobox').nth(2).click();
    await page.getByText('contains', { exact: true }).click();
    await page.getByPlaceholder('e.g. refund').fill('refund');

    await page.getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => createPayload).toBeTruthy();
    expect(createPayload).toMatchObject({
      evaluator_id: 'custom.heuristic.refund',
      kind: 'heuristic',
      output_keys: [{ key: 'heuristic_pass', type: 'bool' }],
      config: {
        version: 'v2',
        root: {
          kind: 'group',
          operator: 'and',
          rules: [{ kind: 'rule', type: 'contains', value: 'refund' }],
        },
      },
    });
  });

  test('publish version surfaces backend conflict errors on template detail', async ({ gotoPage, page }) => {
    const templateID = 'template.validation';

    await page.route(`**/api/plugins/grafana-sigil-app/resources/eval/templates/${templateID}`, async (route) => {
      await route.fulfill(
        jsonResponse({
          tenant_id: 'fake',
          template_id: templateID,
          scope: 'tenant',
          kind: 'heuristic',
          description: 'Validation test template',
          latest_version: '2026-03-09',
          config: { not_empty: true },
          output_keys: [{ key: 'score', type: 'bool' }],
          versions: [{ version: '2026-03-09', changelog: 'Initial', created_at: '2026-03-09T00:00:00Z' }],
          created_at: '2026-03-09T00:00:00Z',
          updated_at: '2026-03-09T00:00:00Z',
        })
      );
    });

    await page.route(
      `**/api/plugins/grafana-sigil-app/resources/eval/templates/${templateID}/versions`,
      async (route) => {
        if (route.request().method() === 'POST') {
          const request = route.request().postDataJSON() as { version?: string };
          const version = request.version ?? 'unknown';
          await route.fulfill(
            jsonResponse(
              {
                message: `version "${version}" already exists for template "${templateID}"`,
              },
              409
            )
          );
          return;
        }
        await route.continue();
      }
    );

    await gotoPage(`/evaluation/templates/${templateID}`);
    await expect(page.getByRole('heading', { name: `Template ${templateID}` })).toBeVisible();

    await page.getByRole('button', { name: 'Publish New Version' }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();

    await expect(page).toHaveURL(/\/evaluation\/templates\/template\.validation$/);
    await expect(page.getByText(/version ".*" already exists for template "template\.validation"/)).toBeVisible();
  });
});
