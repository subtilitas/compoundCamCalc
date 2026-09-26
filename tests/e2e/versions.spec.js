import { expect, test } from '@playwright/test';
import { decodeShare } from '../../src/state/share.js';

const MANIFEST = {
  versions: [{ id: 'main', path: '' }, { id: 'v0.2.0', path: 'v0.2.0/' }, { id: 'v0.1.0', path: 'v0.1.0/' }],
};

test('no version select without a version list', async ({ page }) => {
  await page.route('**/versions.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('./');
  await expect(page.getByTestId('file-menu')).toBeVisible();
  await expect(page.getByTestId('version-area')).toBeHidden();
});

test('no version select for a damaged version list', async ({ page }) => {
  await page.route('**/versions.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"versions":[{"id":"x"}]}' }));
  await page.goto('./');
  await expect(page.getByTestId('file-menu')).toBeVisible();
  await expect(page.getByTestId('version-area')).toBeHidden();
});

test('the version select opens a release with the open design', async ({ page }) => {
  await page.route('**/versions.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFEST) }));
  await page.route('**/v0.1.0/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>v0.1.0</title><p>release</p>' }));
  await page.goto('./');
  const select = page.getByTestId('version-select');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('main');
  await expect(select.locator('option')).toHaveText([/^main, newest \(\d+\.\d+\.\d+\)$/, 'v0.2.0', 'v0.1.0']);
  await expect(page.getByText('Releases keep their own saved designs; the open design goes along.')).toBeVisible();

  const ata = page.getByTestId('field-ata');
  await ata.fill('34');
  await ata.press('Enter');

  await select.selectOption('v0.1.0');
  await page.waitForURL(/\/v0\.1\.0\/#design=/);
  const url = new URL(page.url());
  expect(url.pathname).toMatch(/\/v0\.1\.0\/$/);
  const shared = decodeShare(url.hash.slice('#design='.length));
  expect(shared.error).toBeNull();
  expect(shared.state?.geometry.ata).toBeCloseTo(34 * 0.0254, 12);
});
