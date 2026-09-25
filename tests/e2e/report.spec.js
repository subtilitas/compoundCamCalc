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
 * Build the report as the browser does before printing, and switch to the
 * print media.
 * @param {Page} page
 */
async function beforePrint(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
}

/**
 * Ids and test ids that occur more than once on the page: all of them, and
 * those of which one copy lies inside the report.
 * @param {Page} page
 */
function duplicates(page) {
  return page.evaluate(() => {
    /** @param {string} attr */
    const repeated = (attr) => {
      /** @type {Map<string | null, Element[]>} */
      const seen = new Map();
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        const v = el.getAttribute(attr);
        seen.set(v, [...(seen.get(v) ?? []), el]);
      }
      const twice = [...seen].filter(([, els]) => els.length > 1);
      return {
        all: twice.map(([v]) => v),
        report: twice.filter(([, els]) => els.some((el) => el.closest('.report'))).map(([v]) => v),
      };
    };
    const ids = repeated('id');
    const testids = repeated('data-testid');
    return { ids: ids.all, testids: testids.all, reportIds: ids.report, reportTestids: testids.report };
  });
}

const SECTIONS = ['inputs', 'target', 'results', 'force-chart', 'cam', 'plan', 'lengths', 'loads', 'table'];

test.describe('print report', () => {
  test('prints the current cam with every section and the values of the results card', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const peak = await page.getByTestId('metric-peak').textContent();
    const letOff = await page.getByTestId('metric-letOff').textContent();
    const stringLength = await page.getByTestId('metric-stringLength').textContent();
    const planString = await page.getByTestId('plan-string').textContent();
    const before = await duplicates(page);
    await beforePrint(page);

    const report = page.getByTestId('report');
    await expect(report).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/printing-report/);
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('.app-header')).toBeHidden();
    for (const key of SECTIONS) await expect(page.getByTestId(`report-${key}`)).toBeVisible();
    await expect(page.getByTestId('report-note')).toHaveText('Static model: string stretch, cam timing and dynamics are not modelled.');

    await expect(report.locator('h1')).toHaveText('Cam report: Untitled');
    await expect(report.locator('[data-key="version"]')).toHaveText(/^\d+\.\d+\.\d+$/);
    await expect(report.locator('[data-key="printed"]')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(report.locator('[data-key="status"]')).toHaveText(/^Exports the current cam, design [0-9a-f]{6}$/);

    const results = page.getByTestId('report-results');
    await expect(results.locator('[data-key="peak"]')).toHaveText(/** @type {string} */ (peak));
    await expect(results.locator('[data-key="letOff"]')).toHaveText(/** @type {string} */ (letOff));
    await expect(results.locator('[data-key="stringLength"]')).toHaveText(/** @type {string} */ (stringLength));
    await expect(page.getByTestId('report-lengths').locator('[data-key="string"]')).toHaveText(/** @type {string} */ (planString));
    await expect(page.getByTestId('report-inputs')).toContainText('Axle-to-axle length (ATA)');
    await expect(page.getByTestId('report-inputs')).toContainText('33.00 in');

    // Fresh views: the static chart, the cam at brace, the plan and the loads.
    const chart = page.getByTestId('report-force-chart').locator('svg');
    await expect(chart).toHaveAttribute('viewBox', '0 0 640 340');
    await expect(chart.locator('polyline.chart-curve')).not.toHaveCount(0);
    await expect(chart.locator('polyline.static-achieved')).not.toHaveCount(0);
    await expect(chart).toContainText('Draw length (AMO), in');
    await expect(page.getByTestId('report-cam').locator('svg.cam-view path').first()).toBeAttached();
    await expect(page.getByTestId('report-cam').locator('.camview-pose')).toHaveText(/^At [\d.]+ in: cam turned 0\.0°/);
    await expect(page.getByTestId('report-plan').locator('svg.plan-view use')).not.toHaveCount(0);
    await expect(page.getByTestId('report-loads').locator('svg.load-chart')).toHaveAttribute('width', '640');
    await expect(report.locator('.camview-controls')).toHaveCount(0);
    await expect(report.locator('[tabindex]')).toHaveCount(0);

    const table = page.getByTestId('report-table').locator('table');
    await expect(table.locator('thead th').first()).toHaveText('Draw (AMO), in');
    await expect(table.locator('tbody tr')).toHaveCount(11);
    await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('8.25');

    // Every use of the plan finds its own group inside the report.
    const hrefs = await page.getByTestId('report-plan').locator('use').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    for (const href of hrefs) await expect(page.getByTestId('report-plan').locator(/** @type {string} */ (href))).toHaveCount(1);
    // The report adds no id and no test id that the page has already.
    expect(await duplicates(page)).toEqual(before);
    const clashes = await duplicates(page);
    expect(clashes.reportIds).toEqual([]);
    expect(clashes.reportTestids).toEqual([]);
    expect(await page.getByTestId('report').locator('[id]').count()).toBeGreaterThan(0);

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('report')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/printing-report/);
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('.app-header')).toBeVisible();
  });

  test('names a stale cam and that later edits are not included', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await page.getByTestId('unit-force').selectOption('lbf');
    const input = page.getByTestId('field-lead-in');
    await input.fill('150');
    await input.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 20_000 });
    await beforePrint(page);
    await expect(page.getByTestId('report').locator('[data-key="status"]'))
      .toHaveText(/^Exports the last cam that met every check, design [0-9a-f]{6}; later edits are not included$/);
    // The cam of the report has the inputs of the last valid cam, in the current units.
    await expect(page.getByTestId('report-inputs')).not.toContainText('150.0°');
    await expect(page.getByTestId('report-results').locator('[data-key="peak"]')).toHaveText(/ lbf$/);
    await expect(page.getByTestId('report-results')).toContainText('No problems.');
  });

  test('is off before the first solve and the page prints unchanged', async ({ page }) => {
    /** @type {(() => Promise<void>)[]} */
    const held = [];
    await page.route(/solver\.worker/, (route) => {
      held.push(() => route.continue());
    });
    await page.goto('./');
    await page.evaluate(() => {
      const w = /** @type {Window & { printed?: number }} */ (window);
      w.printed = 0;
      window.print = () => {
        w.printed = (w.printed ?? 0) + 1;
      };
    });
    const button = page.getByTestId('export-print');
    await expect(button).toHaveText('Print report');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', /^No cam meets every check yet/);
    await button.click({ force: true });
    await expect(page.getByTestId('export-status')).toHaveText(/^Solving… exports are available once a cam meets every check$|^No cam meets every check yet/);
    expect(await page.evaluate(() => /** @type {Window & { printed?: number }} */ (window).printed)).toBe(0);

    await beforePrint(page);
    await expect(page.getByTestId('report')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/printing-report/);
    await expect(page.locator('#app')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });

    await expect.poll(() => held.length).toBeGreaterThan(0);
    for (const release of held) await release();
    await solved(page);
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('title');
    await button.click();
    expect(await page.evaluate(() => /** @type {Window & { printed?: number }} */ (window).printed)).toBe(1);
  });

  for (const how of /** @type {const} */ (['scheme', 'theme'])) {
    test(`prints light colours from a dark ${how === 'scheme' ? 'colour scheme' : 'theme'}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('./');
      if (how === 'theme') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await solved(page);
      const colours = () => page.evaluate(() => {
        const report = document.querySelector('.report') ?? document.body;
        const style = getComputedStyle(report);
        return {
          text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
          color: style.color,
          background: style.backgroundColor,
        };
      });
      // On screen the page is dark.
      expect((await colours()).text).toBe('#e6eae8');
      await beforePrint(page);
      expect(await colours()).toEqual({ text: '#1b1f1e', color: 'rgb(27, 31, 30)', background: 'rgb(255, 255, 255)' });
    });
  }

  test('saves as a PDF of at least one page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'page.pdf runs in the desktop project only');
    await page.goto('./');
    await solved(page);
    await beforePrint(page);
    await expect(page.getByTestId('report')).toBeVisible();
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });
});
