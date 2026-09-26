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
 * Largest cam dimension shown in the results (mm).
 * @param {Page} page
 */
async function camSize(page) {
  const text = await page.getByTestId('metric-camMaxDimension').textContent();
  const match = /^(\d+\.\d) mm$/.exec(text ?? '');
  if (!match) throw new Error(`unexpected cam size "${text}"`);
  return Number(match[1]);
}

test.describe('free-form string track', () => {
  test('switching the shape to Free-form keeps the cam within 0.1 mm and is one undo step', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('./');
    await solved(page);
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok');
    const before = await camSize(page);
    const flange = page.getByTestId('cam-stringFlange');
    const outline = await flange.getAttribute('d');
    const undo = page.getByTestId('btn-undo');
    await expect(undo).toBeDisabled();
    const summary = page.getByTestId('track-freeform-summary');
    await expect(summary).toBeHidden();

    const shape = page.getByTestId('choice-track-shape');
    await expect(shape.locator('option')).toHaveText(['Eccentric circle', 'Ellipse', 'Free-form']);
    await shape.selectOption('freeform');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText('Free-form track, 12 points');
    // The fields of the analytic shapes do not apply.
    for (const id of ['track-radius', 'track-offset', 'track-phase', 'track-semi-major']) {
      await expect(page.getByTestId(`field-${id}`)).toBeHidden();
    }
    // The cam is rebuilt from the spline track: its outline changes by
    // micrometres, its size by less than 0.1 mm.
    await expect.poll(() => flange.getAttribute('d'), { timeout: 20_000 }).not.toBe(outline);
    await solved(page);
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok');
    await expect(page.getByTestId('results-status')).toHaveText('The cam meets the target and every check');
    expect(Math.abs((await camSize(page)) - before)).toBeLessThanOrEqual(0.1);

    // One undo step restores the eccentric track.
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(shape).toHaveValue('eccentric');
    await expect(summary).toBeHidden();
    await expect(page.getByTestId('field-track-radius')).toBeVisible();
    await expect(page.getByTestId('field-track-offset')).toBeVisible();
    await expect(undo).toBeDisabled();
    await expect.poll(() => flange.getAttribute('d'), { timeout: 20_000 }).toBe(outline);
    await solved(page);
    expect(await camSize(page)).toBe(before);
    expect(errors).toEqual([]);
  });
});
