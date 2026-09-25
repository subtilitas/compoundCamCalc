import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
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
 * Click an export button and read the downloaded file.
 * @param {Page} page
 * @param {string} testid
 */
async function save(page, testid) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testid).click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), bytes: await readFile(path) };
}

test.describe('export', () => {
  test('saves the plate, drawing, table and ZIP files of the current cam', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await expect(page.getByTestId('export-status')).toHaveText(/^Exports the current cam, design [0-9a-f]{6}$/);
    await expect(page.getByTestId('export-note')).toHaveText('DXF files are in millimetres at 1:1. After import, the axle bore measures 8.00 mm.');
    const plate = await save(page, 'export-plate1-string-flange');
    expect(plate.name).toMatch(/^cam-\d{8}-[0-9a-f]{6}-plate1-string-flange\.dxf$/);
    const dxf = plate.bytes.toString('latin1');
    expect(dxf).toContain('AC1015');
    expect(dxf).toMatch(/\$INSUNITS\r\n 70\r\n4\r\n/);
    await expect(page.getByTestId('export-status')).toHaveText(`Saved ${plate.name}`);
    const ref = await save(page, 'export-reference');
    expect(ref.bytes.toString('latin1')).toContain('SPLINE');
    const csv = await save(page, 'export-force-curve');
    const lines = csv.bytes.toString('latin1').trim().split('\r\n');
    expect(lines[0]).toMatch(/^Draw length AMO \(in\),/);
    expect(lines).toHaveLength(1501);
    const zip = await save(page, 'export-zip');
    expect(zip.name).toMatch(/^cam-\d{8}-[0-9a-f]{6}\.zip$/);
    expect(zip.bytes.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    expect(zip.bytes.toString('latin1')).toContain('README.txt');
    // Plates 3 and 5 get a boss around the cable stop, so no plate warns.
    await expect(page.getByTestId('export-warnings')).toBeHidden();
    expect(zip.bytes.toString('latin1')).toContain('boss around the cable stop');
  });

  test('dates every file of a set by the day of the click', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 8, 25, 23, 59, 0));
    await page.goto('./');
    await solved(page);
    // Show the panel and give the background build time to run on the first day.
    await page.getByTestId('export-zip').scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000);
    await page.clock.setFixedTime(new Date(2026, 8, 26, 0, 1, 0));
    const zip = await save(page, 'export-zip');
    expect(zip.name).toMatch(/^cam-20260926-[0-9a-f]{6}\.zip$/);
    const text = zip.bytes.toString('latin1');
    expect(text).toContain('cam-20260926-');
    expect(text).not.toContain('cam-20260925-');
    const plate = await save(page, 'export-plate1-string-flange');
    expect(plate.name).toMatch(/^cam-20260926-/);
  });

  test('keeps exporting the last valid cam after an input fails a check', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const input = page.getByTestId('field-lead-in');
    await input.fill('150');
    await input.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 20_000 });
    await expect(page.getByTestId('export-status')).toHaveText(/^Exports the last cam that met every check, design [0-9a-f]{6}; later edits are not included$/);
    const plate = await save(page, 'export-plate3-middle-flange');
    expect(plate.name).toMatch(/plate3-middle-flange\.dxf$/);
  });

  test('offers no export before a cam meets every check', async ({ page }) => {
    /** @type {(() => Promise<void>)[]} */
    const held = [];
    await page.route(/solver\.worker/, (route) => {
      held.push(() => route.continue());
    });
    await page.goto('./');
    await expect(page.getByTestId('export-zip')).toHaveAttribute('aria-disabled', 'true');
    // Playwright treats aria-disabled as disabled; the button still answers a click.
    await page.getByTestId('export-zip').click({ force: true });
    await expect(page.getByTestId('export-status')).toHaveText(/^Solving… exports are available once a cam meets every check$|^No cam meets every check yet/);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    for (const release of held) await release();
    await solved(page);
    await expect(page.getByTestId('export-zip')).not.toHaveAttribute('aria-disabled', 'true');
  });

  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    test(`the export panel has no detectable accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('./');
      await solved(page);
      const results = await new AxeBuilder({ page }).include('.panel-export').analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
