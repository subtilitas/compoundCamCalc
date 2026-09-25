import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * Wait until the full solve of the current state has been shown.
 * @param {Page} page
 */
async function solved(page) {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-solve-state', 'ok', { timeout: 20_000 });
  await expect(app).toHaveAttribute('data-solve-resolution', 'full');
}

/**
 * Cam rotation shown in the cam view (rad).
 * @param {Page} page
 */
const theta = (page) => page.getByTestId('cam-rotor').evaluate((el) => Number(el.getAttribute('data-theta')));

test.describe('draw position', () => {
  test('starts at brace and moves every view to full draw', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await expect(page.getByTestId('scrubber')).toBeVisible();
    expect(await theta(page)).toBe(0);
    await expect(page.getByTestId('scrubber-readout')).toContainText('(brace)');
    await expect(page.getByTestId('chart-marker')).toBeVisible();
    // Full draw: the cam turns by the rotation of the results card.
    await page.getByTestId('scrubber-full').click();
    await expect(page.getByTestId('scrubber-readout')).toContainText('(full draw)');
    const rotation = Number((await page.getByTestId('metric-rotation').textContent())?.replace(/[^\d.]/g, ''));
    await expect.poll(async () => ((await theta(page)) * 180) / Math.PI).toBeCloseTo(rotation, 0);
    await expect(page.getByTestId('scrubber-readout')).toContainText('Draw 29.00 in');
    await expect(page.getByTestId('scrubber-plus')).toBeDisabled();
    // The chart marker sits at the full-draw line on the right of the plot.
    const line = page.getByTestId('chart-marker').locator('line');
    const x = Number(await line.getAttribute('x1'));
    const width = Number(await page.getByTestId('force-chart').getAttribute('width'));
    expect(width - x).toBeLessThan(30);
  });

  test('the keyboard moves the slider in draw steps', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const slider = page.getByTestId('scrubber');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', /^Draw 8\.35 in/);
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', /\(full draw\)/);
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', /\(brace\)/);
  });

  test('after a unit change the slider and the readout show the same position', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const slider = page.getByTestId('scrubber');
    await slider.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', /^Draw 8\.55 in/);
    await page.getByTestId('unit-draw').selectOption('mm');
    await expect(page.getByTestId('scrubber-label')).toHaveText('Draw position (AMO, mm)');
    const readout = page.getByTestId('scrubber-readout');
    const before = await readout.textContent();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(readout).not.toHaveText(/** @type {string} */ (before));
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText(/** @type {string} */ (before));
  });

  test('moving the position changes no project state and starts no solve', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const app = page.locator('#app');
    const rev = await app.getAttribute('data-rev');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();
    const rotor = await page.getByTestId('cam-rotor').elementHandle();
    await page.getByTestId('scrubber-peak').click();
    await expect.poll(() => theta(page)).toBeGreaterThan(0);
    await expect(app).toHaveAttribute('data-rev', /** @type {string} */ (rev));
    await expect(app).toHaveAttribute('data-solve-state', 'ok');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();
    // The views update in place.
    expect(await rotor?.evaluate((el) => el.isConnected)).toBe(true);
  });

  test('a new result keeps the draw position', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await page.getByTestId('scrubber-full').click();
    await expect(page.getByTestId('scrubber-readout')).toContainText('(full draw)');
    const input = page.getByTestId('field-peak');
    await input.fill('280');
    await input.press('Enter');
    await solved(page);
    await expect(page.getByTestId('scrubber-readout')).toContainText('(full draw)');
    await page.getByTestId('unit-draw').selectOption('mm');
    await expect(page.getByTestId('scrubber-label')).toHaveText('Draw position (AMO, mm)');
    await expect(page.getByTestId('scrubber-readout')).toContainText('(full draw)');
  });

  test('the string plan and the loads show the lengths and the loads', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await expect(page.getByTestId('plan-string')).toHaveText(/^\d+\.\d mm \(\d+\.\d{3} in\)$/);
    await expect(page.getByTestId('plan-ataBrace')).toHaveText(/^\d+\.\d mm$/);
    await expect(page.getByTestId('plan-current')).toHaveCount(1);
    await expect(page.getByTestId('load-peak-axle')).toHaveText(/^\d+ N at \d+\.\d in$/);
    await expect(page.getByTestId('load-now-Ts')).toHaveText(/^\d+ N$/);
    await expect(page.getByTestId('load-Ts')).toHaveCount(1);
    await page.getByTestId('load-table').locator('summary').click();
    await expect(page.getByTestId('load-table').locator('tbody tr')).toHaveCount(11);
    await page.getByTestId('unit-dims').selectOption('in');
    await expect(page.getByTestId('plan-string')).toHaveText(/^\d+\.\d{3} in \(\d+\.\d mm\)$/);
    await page.getByTestId('plan-top-cam').click();
    await expect(page.getByTestId('plan-zoom-out')).toBeEnabled();
  });

  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    test(`the views have no detectable accessibility violations at full draw (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('./');
      await solved(page);
      await page.getByTestId('scrubber-full').click();
      await page.getByTestId('load-table').locator('summary').click();
      const results = await new AxeBuilder({ page }).include('.views').analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
