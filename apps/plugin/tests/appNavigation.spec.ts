import { test, expect } from './fixtures';
import { ROUTES } from '../src/constants';

test.describe('navigating sigil app', () => {
  test('conversations page should render', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Conversations}`);
    await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
  });

  test('conversation detail page should render', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.Conversations}/conv-123/detail`);
    await expect(page.getByRole('heading', { name: 'Conversation detail' })).toBeVisible();
    await expect(page.getByText('conv-123')).toBeVisible();
  });

  test('conversations old page should render', async ({ gotoPage, page }) => {
    await gotoPage(`/${ROUTES.ConversationsOld}`);
    await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
    await expect(page.getByLabel('conversation filters')).toBeVisible();
  });
});
