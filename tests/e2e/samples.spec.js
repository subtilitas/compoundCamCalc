import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * @param {Page} page
 * @param {string} item test id without the "file-" prefix
 */
async function menu(page, item) {
  await page.getByTestId('file-menu').click();
  await page.getByTestId(`file-${item}`).click();
}

/**
 * The samples added with the free-form track: name, axle to axle, brace
 * height and draw (in), cam size (mm) and whether the track is free-form.
 */
const ADDED = [
  { id: 'light-hunting', name: 'Compound bow, light hunting (50 lbf)', ata: '30.00', brace: '7.00', draw: '27.00', cam: 88.4, freeform: false },
  { id: 'short-brace', name: 'Compound bow, short-brace hunting (70 lbf)', ata: '31.00', brace: '6.00', draw: '30.00', cam: 109.6, freeform: true },
  { id: 'long-draw', name: 'Compound bow, long draw (80 lbf)', ata: '35.00', brace: '7.00', draw: '31.00', cam: 120.3, freeform: false },
  { id: 'youth', name: 'Compound bow, youth (20 lbf)', ata: '27.00', brace: '6.50', draw: '24.00', cam: 75.6, freeform: false },
];

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test('Open sample lists the compound bows first, then the crossbow and the mini bow', async ({ page }) => {
  await menu(page, 'sample');
  const list = page.getByTestId('sample-list');
  await expect(list.locator('.file-row-name')).toHaveCount(9);
  await expect(list.getByRole('button')).toHaveText(Array(9).fill('Open'));
  const ids = await list.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids).toEqual([
    'sample-target', 'sample-target-optimised', 'sample-hunting', 'sample-light-hunting', 'sample-short-brace',
    'sample-long-draw', 'sample-youth', 'sample-crossbow', 'sample-mini',
  ]);
});

for (const sample of ADDED) {
  test(`${sample.name} opens and solves without problems or warnings`, async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await menu(page, 'sample');
    await page.getByTestId(`sample-${sample.id}`).click();
    await expect(page.getByTestId('design-name')).toHaveText(sample.name);
    await expect(page.getByTestId('design-marker')).toHaveText('(not saved)');
    await expect(page.getByTestId('field-ata')).toHaveValue(sample.ata);
    await expect(page.getByTestId('field-brace')).toHaveValue(sample.brace);
    await expect(page.getByTestId('field-draw')).toHaveValue(sample.draw);
    const summary = page.getByTestId('track-freeform-summary');
    if (sample.freeform) await expect(summary).toHaveText('Free-form track, 12 points');
    else await expect(summary).toBeHidden();
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-solve-resolution', 'full', { timeout: 30_000 });
    await expect(app).toHaveAttribute('data-solve-state', 'ok', { timeout: 30_000 });
    await expect(app).toHaveAttribute('data-solve-status', 'ok');
    await expect(page.getByTestId('results-status')).toHaveText('The cam meets the target and every check');
    await expect(page.getByTestId('results-warnings')).toBeHidden();
    await expect(page.getByTestId('metric-camMaxDimension')).toHaveText(`${sample.cam.toFixed(1)} mm`);
    expect(errors).toEqual([]);
  });
}
