import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('navigating sigil app', () => {
  test('conversations page should render', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Conversations}`);
    await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
  });

  test('conversation explore page should handle a missing conversation', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Conversations}/__missing-conversation__/explore`);
    await expect(page.getByText('Failed to load conversation')).toBeVisible();
  });
});
