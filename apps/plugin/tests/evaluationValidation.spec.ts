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
