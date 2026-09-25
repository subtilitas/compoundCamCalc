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
 * Type a value into a settings field and commit it with Enter.
 * @param {Page} page
 * @param {string} id field id without the "field-" prefix
 * @param {string} value
 */
async function setField(page, id, value) {
  const input = page.getByTestId(`field-${id}`);
  await input.fill(value);
  await input.press('Enter');
}

test.describe('solver in the page', () => {
  test('the default preset builds a cam that meets every check', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('./');
    await solved(page);
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok');
    await expect(page.getByTestId('results-status')).toHaveText('The cam meets the target and every check');
    await expect(page.getByTestId('metric-peak')).toHaveText(/^2\d\d\.\d N$/);
    await expect(page.getByTestId('metric-camMaxDimension')).toHaveText(/^\d+\.\d mm$/);
    await expect(page.getByTestId('results-diagnostics')).toBeHidden();
    // Cam view: both tracks, the bore and the posts.
    await expect(page.getByTestId('cam-cableFlange')).toHaveCount(1);
    await expect(page.getByTestId('cam-stringFlange')).toHaveCount(1);
    await expect(page.getByTestId('cam-bore')).toHaveCount(1);
    await expect(page.getByTestId('cam-view')).not.toHaveClass(/cam-stale/);
    // Chart: the achieved curve over the target, with its legend entry.
    await expect(page.getByTestId('chart-achieved')).toHaveCount(1);
    await expect(page.getByTestId('chart-legend-achieved')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an infeasible input shows the problem and keeps the last cam, dimmed', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await setField(page, 'lead-in', '150');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 20_000 });
    await expect(page.getByTestId('results-status')).toContainText('The cam does not meet every check: 1 problem');
    await expect(page.getByTestId('results-status')).toContainText('The cam shown is the last one that met every check.');
    const diag = page.getByTestId('diag-cable-wrap');
    await expect(diag).toContainText('lead-in wrap');
    await expect(diag).toContainText(/Suggestion: Reduce the lead-in wrap to at most \d+\.\d°/);
    await expect(page.getByTestId('cam-view')).toHaveClass(/cam-stale/);
    await expect(page.getByTestId('cam-cableFlange')).toHaveCount(1);
    // Undo restores the buildable state.
    await page.getByTestId('btn-undo').click();
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok', { timeout: 20_000 });
    await expect(page.getByTestId('cam-view')).not.toHaveClass(/cam-stale/);
  });

  test('the chart legend stays inside a 320 px wide chart', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('./');
    await solved(page);
    await setField(page, 'lead-in', '150');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 20_000 });
    await expect(page.getByTestId('chart-legend-achieved')).toHaveText('Achieved, last valid cam');
    const fits = await page.evaluate(() => {
      const chart = /** @type {SVGSVGElement} */ (document.querySelector('[data-testid="force-chart"]'));
      const bg = /** @type {SVGRectElement} */ (chart.querySelector('.chart-legend-bg'));
      return Number(bg.getAttribute('x')) + Number(bg.getAttribute('width')) <= Number(chart.getAttribute('width'));
    });
    expect(fits).toBe(true);
  });

  test('switching the dimension unit re-labels the results', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    // The cached values switch at once, in the same task as the change,
    // before the next solve can finish.
    const text = await page.evaluate(() => {
      const select = /** @type {HTMLSelectElement} */ (document.querySelector('[data-testid="unit-dims"]'));
      select.value = 'in';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return document.querySelector('[data-testid="metric-camMaxDimension"]')?.textContent;
    });
    expect(text).toMatch(/^\d+\.\d{3} in$/);
    await expect(page.getByTestId('metric-camMaxDimension')).toHaveText(/^\d+\.\d{3} in$/, { timeout: 20_000 });
    await expect(page.getByTestId('field-bore')).toHaveValue(/^0\.3\d+$/);
  });

  test('settings show the fields of the chosen limb mode and track shape', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await expect(page.getByTestId('field-limb-stiffness')).toBeVisible();
    await expect(page.getByTestId('field-limb-travel')).toBeHidden();
    await page.locator('#c-limb-mode').selectOption('travel');
    await expect(page.getByTestId('field-limb-travel')).toBeVisible();
    await expect(page.getByTestId('field-limb-stiffness')).toBeHidden();
    await expect(page.getByTestId('field-track-radius')).toBeVisible();
    await page.locator('#c-track-shape').selectOption('ellipse');
    await expect(page.getByTestId('field-track-semi-major')).toBeVisible();
    await expect(page.getByTestId('field-track-radius')).toBeHidden();
    await solved(page);
  });

  test('the cam view zooms with its buttons and fits again', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const view = page.getByTestId('cam-view');
    const fitted = await view.getAttribute('viewBox');
    const scale = await page.getByTestId('camview-scale').textContent();
    await page.getByTestId('camview-zoom-in').click();
    await expect(view).not.toHaveAttribute('viewBox', /** @type {string} */ (fitted));
    await expect(page.getByTestId('camview-scale')).not.toHaveText(/** @type {string} */ (scale));
    await page.getByTestId('camview-fit').click();
    await expect(view).toHaveAttribute('viewBox', /** @type {string} */ (fitted));
  });

  test('the stale state is labelled in the results and the cam view, and the status link follows', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await expect(page.getByTestId('solve-chip')).toHaveText('Cam: meets every check');
    await expect(page.getByTestId('results-caption')).toBeHidden();
    await setField(page, 'lead-in', '150');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 20_000 });
    await expect(page.getByTestId('solve-chip')).toHaveText('Cam: 1 problem, see Results');
    await expect(page.getByTestId('results-caption')).toBeVisible();
    await expect(page.getByTestId('camview-caption')).toContainText('Last cam that met every check');
    await expect(page.getByTestId('cam-view')).toHaveAttribute('aria-label', /last cam that met every check/);
    await expect(page.getByTestId('camview-legend')).toContainText('Cable track');
  });

  test('a continuous drag shows coarse results before the pointer stops', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    await page.getByTestId('force-chart').scrollIntoViewIfNeeded();
    const box = await page.getByTestId('chart-point-3').boundingBox();
    if (!box) throw new Error('point 3 is not visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(() => {
      /** @type {any} */ (window).coarseSeen = 0;
      new MutationObserver(() => {
        if (document.getElementById('app')?.dataset.solveResolution === 'coarse') /** @type {any} */ (window).coarseSeen++;
      }).observe(/** @type {HTMLElement} */ (document.getElementById('app')), { attributes: true, attributeFilter: ['data-solve-resolution'] });
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    // About 3 s of steady movement, never pausing.
    for (let i = 1; i <= 90; i++) {
      await page.mouse.move(x + (i % 30) * 0.5, y - (i % 20));
      await page.waitForTimeout(30);
    }
    const seen = await page.evaluate(() => /** @type {any} */ (window).coarseSeen);
    await page.mouse.up();
    expect(seen).toBeGreaterThan(0);
    await solved(page);
  });

  test('Ctrl+wheel over the cam view never zooms the page, also at a zoom limit', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const view = page.getByTestId('cam-view');
    await view.scrollIntoViewIfNeeded();
    const box = await view.boundingBox();
    if (!box) throw new Error('the cam view is not visible');
    await page.evaluate(() => {
      /** @type {any} */ (window).wheelDefault = [];
      window.addEventListener('wheel', (e) => /** @type {any} */ (window).wheelDefault.push(e.defaultPrevented), { passive: false });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const fitted = await view.getAttribute('viewBox');
    await page.keyboard.down('Control');
    // Zoom out at the fitted view: the cam cannot zoom out further.
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).wheelDefault)).toEqual([true]);
    await expect(view).toHaveAttribute('viewBox', /** @type {string} */ (fitted));
  });

  test('the zoomed cam view pans with the arrow keys', async ({ page }) => {
    await page.goto('./');
    await solved(page);
    const view = page.getByTestId('cam-view');
    await page.getByTestId('camview-zoom-in').click();
    const zoomed = /** @type {string} */ (await view.getAttribute('viewBox'));
    await view.focus();
    await page.keyboard.press('ArrowRight');
    await expect(view).not.toHaveAttribute('viewBox', zoomed);
    await page.keyboard.press('0');
    await expect(page.getByTestId('camview-zoom-out')).toBeDisabled();
  });

  for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
    test(`the solved page has no detectable accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('./');
      await solved(page);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
