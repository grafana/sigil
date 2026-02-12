import { test, expect } from './fixtures';

test('should be possible to save app configuration', async ({ appConfigPage, page }) => {
  await page.getByRole('textbox', { name: 'Sigil API URL' }).fill('http://sigil:8080');

  const saveResponse = appConfigPage.waitForSettingsResponse();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(saveResponse).toBeOK();
});
