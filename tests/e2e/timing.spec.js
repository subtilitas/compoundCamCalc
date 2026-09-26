import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { defaultState } from '../../src/state/presets.js';
import { decodeShare } from '../../src/state/share.js';

/** @typedef {import('@playwright/test').Page} Page */

/** @param {Page} page */
async function solved(page) {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-solve-state', 'ok', { timeout: 20_000 });
  await expect(app).toHaveAttribute('data-solve-resolution', 'full');
}

/**
 * @param {Page} page
 * @param {string} id
 * @param {string} value
 */
async function setField(page, id, value) {
  const input = page.getByTestId(`field-${id}`);
  await input.fill(value);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await solved(page);
});

test.describe('Timing', () => {
  test('shows unchanged cords in time, with the chart', async ({ page }) => {
    await expect(page.getByTestId('timing-timing-end')).toHaveText('0.00°, cams in time');
    await expect(page.getByTestId('timing-first-stop')).toHaveText('Both cams together');
    await expect(page.getByTestId('timing-sensitivity')).toHaveText('6.91°/mm');
    // Flat lines at 0: present, with no height to be visible.
    await expect(page.getByTestId('timing-chart')).toBeVisible();
    await expect(page.getByTestId('timing-nock')).toHaveCount(1);
    await expect(page.getByTestId('timing-dtheta')).toHaveCount(1);
    await expect(page.getByTestId('timing-hint')).toContainText('Analysis only');
  });

  test('a longer top cable puts the top cam ahead and on its stop first, without changing the cam', async ({ page }) => {
    const status = await page.getByTestId('results-status').textContent();
    const peak = await page.getByTestId('metric-peak').textContent();
    await setField(page, 'top-cable', '1');
    await solved(page);
    await expect(page.getByTestId('timing-timing-end')).toHaveText('+6.89°, top cam ahead');
    await expect(page.getByTestId('timing-first-stop')).toHaveText('Top cam; bottom cam gap 3.81 mm');
    await expect(page.getByTestId('timing-draw-change')).toHaveText('−5.45 mm');
    await expect(page.getByTestId('results-status')).toHaveText(/** @type {string} */ (status));
    await expect(page.getByTestId('metric-peak')).toHaveText(/** @type {string} */ (peak));

    // One undo step restores the cords.
    await page.getByTestId('btn-undo').click();
    await expect(page.getByTestId('field-top-cable')).toHaveValue('0.00');
    await solved(page);
    await expect(page.getByTestId('timing-timing-end')).toHaveText('0.00°, cams in time');
    await page.getByTestId('btn-redo').click();
    await expect(page.getByTestId('field-top-cable')).toHaveValue('1.00');
  });

  test('the string plan and the exports show the changed bow', async ({ page }) => {
    await expect(page.getByTestId('plan-caption')).toBeHidden();
    await expect(page.getByTestId('export-timing-table')).toBeHidden();
    await setField(page, 'top-cable', '1');
    await solved(page);
    await expect(page.getByTestId('plan-caption')).toHaveText(/^Bow with the timing settings; the cam and the lengths listed are those of the design/);
    await expect(page.getByTestId('string-plan')).toHaveAttribute('data-timing', 'changed');
    await expect(page.getByTestId('plan-current-bottom')).toHaveCount(1);
    await expect(page.getByTestId('plan-timing-end')).toHaveText(/ in$/);
    await expect(page.getByTestId('legend-plan-full')).toHaveText('At the first stop (dotted)');
    await expect(page.getByTestId('legend-plan-load')).toBeHidden();
    await expect(page.getByTestId('plan-load-text')).toHaveText(/^Timing settings at draw \d+\.\d+ in: nock height /);
    await page.getByTestId('export-timing-table').scrollIntoViewIfNeeded();
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-timing-table').click()]);
    expect(file.suggestedFilename()).toMatch(/^cam-\d{8}-[0-9a-f]{6}-timing-[0-9a-f]{6}\.csv$/);
    await expect(page.getByTestId('export-timing-string-plan')).toBeVisible();

    await setField(page, 'top-cable', '0');
    await solved(page);
    await expect(page.getByTestId('plan-caption')).toBeHidden();
    await expect(page.getByTestId('string-plan')).toHaveAttribute('data-timing', '');
    await expect(page.getByTestId('legend-plan-load')).toBeVisible();
    await expect(page.getByTestId('export-timing-table')).toBeHidden();
  });

  test('rejects a change outside its range', async ({ page }) => {
    await setField(page, 'top-cable', '25');
    await expect(page.getByTestId('field-top-cable-msg')).toContainText('Top cable length change');
    await expect(page.getByTestId('field-top-cable')).toHaveAttribute('aria-invalid', 'true');
  });

  test('a share link keeps the length changes', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setField(page, 'nock-height', '8');
    await setField(page, 'bottom-cable', '-0.5');
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-share').click();
    await expect(page.getByTestId('file-status')).toHaveText(/^Share link copied/);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const shared = decodeShare(new URL(link).hash.slice('#design='.length));
    expect(shared.state?.tuning).toEqual({ ...defaultState().tuning, nockHeight: 0.008, bottomCable: -0.0005 });
    const other = await context.newPage();
    await other.goto(`./${new URL(link).hash}`);
    await solved(other);
    await expect(other.getByTestId('field-nock-height')).toHaveValue('8.00');
    await expect(other.getByTestId('field-bottom-cable')).toHaveValue('-0.50');
    await expect(other.getByTestId('timing-first-stop')).toHaveText(/^Top cam; bottom cam gap /);
  });

  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    test(`the timing panel and settings have no detectable accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await setField(page, 'top-cable', '1');
      await solved(page);
      const results = await new AxeBuilder({ page }).include('.panel-timing').include('[data-testid="settings-timing"]').analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe('Timing at 320 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the timing panel fits without horizontal scroll', async ({ page }) => {
    await page.getByTestId('timing').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('timing-chart')).toBeVisible();
    const box = await page.getByTestId('timing-chart').boundingBox();
    expect(box?.width).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
