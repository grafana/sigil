import path from 'node:path';
import fs from 'node:fs/promises';
import { defaultAppPath as appPath, grafanaUrl, newAuthenticatedPage, repoRoot, worktreeName } from './grafana-playwright-auth.mjs';

const screenshotDir = path.join(repoRoot, 'output', 'playwright');
const screenshotName = `sigil-ui-proof-${worktreeName}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.png`;
const screenshotPath = path.join(screenshotDir, screenshotName);

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });

  const { browser, page } = await newAuthenticatedPage();

  try {
    console.log(`open-app ${grafanaUrl}${appPath}`);
    await page.goto(`${grafanaUrl}${appPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (await page.locator('a,button').filter({ hasText: /^Sign in$/i }).first().isVisible().catch(() => false)) {
      throw new Error('authentication did not stick; Sign in is still visible');
    }
    console.log('wait-for-heading Conversation activity');
    await page.getByRole('heading', { name: 'Conversation activity' }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(screenshotPath);
  } finally {
    await browser.close();
  }
}

await main();
