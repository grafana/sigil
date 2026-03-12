import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(__filename);
const pluginDir = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(pluginDir, '..', '..');
const worktreeName = path.basename(repoRoot);
const requireFromPlugin = createRequire(path.join(pluginDir, 'package.json'));
const { chromium } = requireFromPlugin('@playwright/test');

const grafanaUrl = process.env.GRAFANA_URL ?? `http://grafana.${worktreeName}.orb.local`;
const defaultAppPath = process.env.SIGIL_CAPTURE_PATH ?? '/a/grafana-sigil-app/conversations';

async function maybeClick(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return true;
    }
  }

  return false;
}

async function ensureLoggedIn(page, appPath = defaultAppPath) {
  await page.goto(`${grafanaUrl}${appPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const usernameField = page.locator('input[name="user"]').first();
  const passwordField = page.locator('input[name="password"]').first();
  const signInControl = page.locator('a,button').filter({ hasText: /^Sign in$/i }).first();

  if (!(await usernameField.isVisible().catch(() => false)) && (await signInControl.isVisible().catch(() => false))) {
    await signInControl.click();
    await usernameField.waitFor({ state: 'visible', timeout: 15000 });
  }

  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill(process.env.GRAFANA_ADMIN_USER ?? 'admin');
    await passwordField.fill(process.env.GRAFANA_ADMIN_PASSWORD ?? 'admin');
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await page.waitForTimeout(1000);
  }

  await maybeClick(page, [
    'button:has-text("Skip")',
    'button:has-text("Skip for now")',
    'a:has-text("Skip")',
  ]);

  await page.waitForTimeout(1000);
}

async function newAuthenticatedPage(options = {}) {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1600, height: 1200 },
    storageState: options.storageState,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await ensureLoggedIn(page, options.appPath ?? defaultAppPath);
  return { browser, context, page };
}

export {
  chromium,
  defaultAppPath,
  ensureLoggedIn,
  grafanaUrl,
  newAuthenticatedPage,
  pluginDir,
  repoRoot,
  worktreeName,
};
