import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('page loads without console errors and shows the version', async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./');
  await expect(page).toHaveTitle('Compound Cam Calculator');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compound Cam Calculator');
  await expect(page.locator('#app-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  expect(errors).toEqual([]);
});

test('page has no detectable accessibility violations', async ({ page }) => {
  await page.goto('./');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('page has no horizontal scroll', async ({ page }) => {
  await page.goto('./');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
