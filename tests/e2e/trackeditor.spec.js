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
 * Open the app, switch the string track to free-form and wait for its solve.
 * @param {Page} page
 */
async function freeform(page) {
  await page.goto('./');
  await solved(page);
  await page.getByTestId('choice-track-shape').selectOption('freeform');
  await expect(page.getByTestId('track-editor')).toBeVisible();
  await solved(page);
}

/**
 * Open the values table.
 * @param {Page} page
 */
async function openValues(page) {
  const details = page.getByTestId('track-values');
  if (!(await details.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open))) {
    await details.locator('summary').click();
  }
  await expect(details).toHaveAttribute('open', '');
}

/**
 * Values of the table as text, in the dimension unit.
 * @param {Page} page
 */
async function tableValues(page) {
  const inputs = page.getByTestId('track-values').locator('tbody input');
  return inputs.evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value));
}

/** Values of the default eccentric track at 12 points (mm). */
const DEFAULT_VALUES = ['33.34', '25.58', '23.01', '26.34', '34.67', '45.77', '56.66', '64.42', '66.99', '63.66', '55.33', '44.23'];

test.describe('free-form track editor', () => {
  test('shows the values, the handles and the working arc of the latest result', async ({ page }) => {
    await freeform(page);
    await openValues(page);
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES);
    await expect(page.locator('[data-testid^="track-handle-"]')).toHaveCount(12);
    await expect(page.getByTestId('track-arc-brace')).toBeAttached();
    await expect(page.getByTestId('track-arc-full')).toBeAttached();
    // The string leaves point 1 (0°) at brace, 8.25 in AMO; point 12 (330°)
    // lies beyond the full-draw contact and shapes the outline only.
    await expect(page.getByTestId('track-draw-1')).toHaveText('8.25');
    await expect(page.getByTestId('track-draw-12')).toHaveText('');
    await expect(page.getByTestId('track-handle-12')).toHaveClass(/outside/);
    await expect(page.getByTestId('track-handle-12')).toHaveAttribute('aria-label', 'Point 12 at 330°, outline only');
    await expect(page.getByTestId('track-editor-bend')).toHaveText(/^Sharpest bend \d+\.\d mm, limit 5\.0 mm\.$/);
    // The info button of the working arc shows its glossary entry.
    await page.getByTestId('info-workingArc').click();
    await expect(page.getByTestId('glossary-workingArc')).toContainText('Working arc: part of the string track');
  });

  test('applies a shape preset to the eccentric track as one undo step', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const undo = page.getByTestId('btn-undo');
    await expect(undo).toBeDisabled();
    await expect(page.getByTestId('track-editor')).toBeHidden();
    const presets = page.getByTestId('track-presets');
    await expect(presets).toBeVisible();
    await expect(page.getByTestId('preset-select').locator('option')).toHaveText(
      ['Oval', 'Rounded triangle', 'Rounded square', 'Egg', 'Size', 'Shift']);
    await page.getByTestId('preset-select').selectOption('triangle');
    await expect(page.getByTestId('preset-amount')).toHaveValue('1.00');
    await expect(page.getByTestId('preset-largest')).toHaveText(/margin: \d+\.\d\d mm$/);
    await page.getByTestId('preset-apply').click();
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('freeform');
    await expect(page.getByTestId('track-freeform-summary')).toHaveText('Free-form track, 12 points');
    await expect(page.getByTestId('preset-msg')).toContainText('Rounded triangle of 1.00 mm at 0° applied: 12 points. Sharpest bend');
    await solved(page);
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok');
    await openValues(page);
    // cos 3ψ adds 1 mm at 0°, −1 mm at 60°.
    const values = await tableValues(page);
    expect(values[0]).toBe('34.34');
    expect(values[2]).toBe('22.01');

    await undo.click();
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('eccentric');
    await expect(undo).toBeDisabled();
    await expect(page.getByTestId('preset-msg')).toHaveText('');

    // The rounded square needs 16 points; Size has no angle.
    await page.getByTestId('preset-select').selectOption('square');
    await page.getByTestId('preset-angle').fill('45');
    await page.getByTestId('preset-angle').press('Enter');
    await page.getByTestId('preset-apply').click();
    await expect(page.getByTestId('track-freeform-summary')).toHaveText('Free-form track, 16 points');
    await page.getByTestId('preset-select').selectOption('size');
    await expect(page.getByTestId('preset-angle')).toBeHidden();
    await expect(page.getByTestId('preset-amount')).toHaveValue('1.00');
    await page.getByTestId('preset-amount').fill('abc');
    await page.getByTestId('preset-apply').click();
    await expect(page.getByTestId('preset-error')).toHaveText('The amount must be a number from −30 to 30 mm');
  });

  test('a typed preset amount keeps its length when the dimension unit changes', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await page.getByTestId('preset-select').selectOption('size');
    const amount = page.getByTestId('preset-amount');
    await amount.fill('1');
    await page.getByTestId('unit-dims').selectOption('in');
    await expect(amount).toHaveValue('0.0393701');
    await page.getByTestId('unit-dims').selectOption('mm');
    await expect(amount).toHaveValue('1');
    await page.getByTestId('unit-dims').selectOption('in');
    await page.getByTestId('preset-apply').click();
    await expect(page.getByTestId('preset-msg')).toContainText('Size of 0.0394 in applied');
    await page.getByTestId('unit-dims').selectOption('mm');
    await openValues(page);
    // Size adds 1 mm to every point.
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES.map((v) => (Number(v) + 1).toFixed(2)));
  });

  test('a drag moves a smooth bump, stops at the bend limit and is one undo step', async ({ page }) => {
    await freeform(page);
    await openValues(page);
    const handle = page.getByTestId('track-handle-1');
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    if (!box) throw new Error('handle 1 is not visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // Point 1 sits at 0°: outwards is to the right. 200 px is far beyond
    // the bend limit.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y, { steps: 20 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute('data-stopped', 'bend');
    await expect(handle).toHaveClass(/stopped/);
    await expect(page.getByTestId('track-editor-live')).toContainText('stopped at the bend limit');
    await expect(page.getByTestId('track-editor-bend')).toHaveText('Sharpest bend 5.0 mm, limit 5.0 mm.');
    const values = (await tableValues(page)).map(Number);
    // The bump: the point moves most, its neighbours 0.75 and 0.25 as far.
    const moved = values.map((v, i) => v - Number(DEFAULT_VALUES[i]));
    expect(moved[0]).toBeGreaterThan(0.5);
    expect(moved[1] / moved[0]).toBeCloseTo(0.75, 1);
    expect(moved[11] / moved[0]).toBeCloseTo(0.75, 1);
    expect(moved[2] / moved[0]).toBeCloseTo(0.25, 1);
    expect(moved[6]).toBe(0);
    await solved(page);
    await expect(page.getByTestId('diag-string-radius')).toHaveCount(0);

    // One undo step for the whole drag; the switch to free-form stays.
    await page.getByTestId('btn-undo').click();
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES);
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('freeform');
    await expect(handle).not.toHaveAttribute('data-stopped');
    await expect(page.getByTestId('btn-undo')).toBeEnabled();
  });

  test('keyboard: one tab stop, Left and Right pick a point, Up and Down change it', async ({ page }) => {
    await freeform(page);
    await openValues(page);
    const handles = page.locator('[data-testid^="track-handle-"]');
    await expect(page.locator('[data-testid^="track-handle-"][tabindex="0"]')).toHaveCount(1);
    await page.getByTestId('track-handle-1').focus();
    await expect(page.getByTestId('track-editor-live')).toHaveText(/^Point 1 at 0°: 33\.34 mm\. Sharpest bend/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('track-handle-2')).toBeFocused();
    await expect(page.getByTestId('track-handle-2')).toHaveAttribute('tabindex', '0');
    await expect(page.getByTestId('track-handle-1')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('track-handle-12')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('track-value-2')).toHaveValue('25.68');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('track-value-2')).toHaveValue('25.18');
    await expect(page.getByTestId('track-editor-live')).toHaveText(/^Point 2 at 30°: 25\.18 mm\. Sharpest bend/);
    await expect(page.getByTestId('track-handle-2')).toBeFocused();
    await expect(page.getByTestId('track-handle-2')).toHaveAttribute('aria-valuetext', '25.18 mm');
    // Only the focused point changed.
    const values = await tableValues(page);
    expect(values.filter((v, i) => v !== DEFAULT_VALUES[i])).toEqual(['25.18']);
    await expect(handles).toHaveCount(12);
    // Each key step is one undo step.
    await page.getByTestId('btn-undo').click();
    await expect(page.getByTestId('track-value-2')).toHaveValue('25.68');
    await page.getByTestId('btn-undo').click();
    await expect(page.getByTestId('track-value-2')).toHaveValue('25.58');
  });

  test('table edit, offset of all points and resampling', async ({ page }) => {
    await freeform(page);
    await openValues(page);
    await expect(page.getByTestId('track-values-note')).toContainText('half the string diameter larger (1.3 mm)');
    await expect(page.getByTestId('track-values-note')).toContainText('The column "String leaves here at" is blank');
    const cell = page.getByTestId('track-value-3');
    await cell.fill('1');
    await cell.press('Enter');
    await expect(page.getByTestId('track-values-msg')).toHaveText('Point 3: the groove radius must be a number from 2 to 150 mm');
    await expect(cell).toHaveAttribute('aria-invalid', 'true');
    await cell.fill('30');
    await cell.press('Enter');
    await expect(cell).toHaveValue('30.00');
    await expect(page.getByTestId('track-values-msg')).toHaveText('');
    await expect(page.getByTestId('track-handle-3')).toHaveAttribute('aria-valuetext', '30.00 mm');
    await page.getByTestId('btn-undo').click();
    await expect(cell).toHaveValue('23.01');

    await expect(page.getByTestId('track-offset')).toHaveValue('0.5');
    await page.getByTestId('track-offset-apply').click();
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES.map((v) => (Number(v) + 0.5).toFixed(2)));
    await page.getByTestId('btn-undo').click();
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES);
    // An offset beyond the value range names the allowed range and changes nothing.
    await page.getByTestId('track-offset').fill('-25');
    await page.getByTestId('track-offset-apply').click();
    await expect(page.getByTestId('track-offset-msg')).toHaveText(
      'The offset must be from −21.01 to 83.01 mm, so every groove radius stays from 2 to 150 mm');
    await expect(page.getByTestId('track-offset')).toHaveAttribute('aria-invalid', 'true');
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES);

    const points = page.getByTestId('track-points');
    await expect(points.locator('option')).toHaveText(['8', '12', '16']);
    await points.selectOption('8');
    await expect(page.getByTestId('track-freeform-summary')).toHaveText('Free-form track, 8 points');
    await expect(page.locator('[data-testid^="track-handle-"]')).toHaveCount(8);
    await expect(page.getByTestId('track-values').locator('tbody tr')).toHaveCount(8);
    await expect(page.getByTestId('track-editor-live')).toContainText('Resampled to 8 points. Sharpest bend');
    await points.selectOption('16');
    await expect(page.locator('[data-testid^="track-handle-"]')).toHaveCount(16);
    await solved(page);
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok');
    await page.getByTestId('btn-undo').click();
    await expect(points).toHaveValue('8');
    await page.getByTestId('btn-undo').click();
    await expect(points).toHaveValue('12');
    expect(await tableValues(page)).toEqual(DEFAULT_VALUES);
  });

  test('fits a 320 px wide screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await freeform(page);
    await openValues(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const view = await page.getByTestId('track-editor-view').boundingBox();
    expect(view?.width).toBeGreaterThan(150);
    expect(view?.width).toBeLessThanOrEqual(280);
    for (const id of ['track-offset-apply', 'preset-apply', 'track-points', 'preset-select']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height, id).toBeGreaterThanOrEqual(44);
    }
  });
});
