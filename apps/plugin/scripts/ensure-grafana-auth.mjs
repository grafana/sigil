import fs from 'node:fs/promises';
import path from 'node:path';
import { newAuthenticatedPage, pluginDir } from './grafana-playwright-auth.mjs';

const authDir = path.join(pluginDir, 'playwright', '.auth');
const authPath = path.join(authDir, 'admin.json');

async function main() {
  await fs.mkdir(authDir, { recursive: true });

  const { browser, context, page } = await newAuthenticatedPage();

  try {
    await page.goto('about:blank');
    await context.storageState({ path: authPath });
    console.log(authPath);
  } finally {
    await browser.close();
  }
}

await main();
