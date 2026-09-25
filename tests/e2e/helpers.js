import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * Open the point table if it is closed.
 * @param {Page} page
 */
export async function openTable(page) {
  const details = page.getByTestId('point-table');
  if (!(await details.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open))) {
    await details.locator('summary').click();
  }
  await expect(details).toHaveAttribute('open', '');
}

/**
 * Centre of a chart point in page coordinates.
 * @param {Page} page
 * @param {number} n 1-based point number
 */
export async function pointCentre(page, n) {
  await page.getByTestId('force-chart').scrollIntoViewIfNeeded();
  const box = await page.getByTestId(`chart-point-${n}`).boundingBox();
  if (!box) throw new Error(`point ${n} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Wait for two animation frames, so observers and deferred renders run.
 * @param {Page} page
 */
export async function nextFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
}
