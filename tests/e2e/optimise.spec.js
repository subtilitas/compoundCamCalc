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

/**
 * Open the page with a solve budget of Optimise (the test hook of
 * ui/optimise) and wait until Optimise can start.
 * @param {Page} page
 * @param {number} [budget]
 */
async function openWithBudget(page, budget) {
  await page.goto(budget ? `./?optimise-budget=${budget}` : './');
  await solved(page);
  await expect(page.getByTestId('optimise-run')).toBeEnabled();
}

/**
 * Start a run and wait for the result table.
 * @param {Page} page
 */
async function runToResult(page) {
  await page.getByTestId('optimise-run').click();
  await expect(page.getByTestId('optimise')).toHaveAttribute('data-phase', 'result', { timeout: 60_000 });
}

/** @param {Page} page */
const shapeField = (page) => page.locator('[data-testid="settings-string-track"] [data-field="track-shape"]');

test.describe('Optimise', () => {
  test('runs with a small budget, locks the String track group, and Apply is one undo step', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openWithBudget(page, 20);
    const goal = page.getByTestId('optimise-goal');
    await expect(goal.locator('option')).toHaveText([
      'Smallest cam, force curve no worse than now',
      'Closest force curve, cam no larger than now',
    ]);
    await expect(page.getByTestId('optimise-reason')).toBeHidden();
    const before = await camSize(page);

    await page.getByTestId('optimise-run').click();
    const section = page.getByTestId('optimise');
    await expect(section).toHaveAttribute('data-phase', 'running');
    await expect(page.getByTestId('optimise-stop')).toBeVisible();
    await expect(shapeField(page)).toHaveAttribute('inert', '');
    await expect(goal).toBeDisabled();
    await expect(page.getByTestId('optimise-progress')).toHaveText(/of 20 solves, step halved \d+ times?, \d+\.\d s; smallest cam so far \d+\.\d mm/,
      { timeout: 20_000 });
    await expect(section).toHaveAttribute('data-phase', 'result', { timeout: 60_000 });
    await expect(shapeField(page)).not.toHaveAttribute('inert', '');
    await expect(page.getByTestId('optimise-note')).toHaveText(/^A better free-form track was found\. The run used all 20 solves\./);

    const rows = page.getByTestId('optimise-table').locator('tbody tr');
    await expect(rows.locator('th')).toHaveText(['Largest cam dimension', 'Largest force difference', 'Let-off', 'Sharpest string bend']);
    await expect(rows.nth(0).locator('td').first()).toHaveText(`${before.toFixed(1)} mm`);
    const after = Number(/^(\d+\.\d) mm$/.exec((await rows.nth(0).locator('td').nth(1).textContent()) ?? '')?.[1]);
    expect(after).toBeLessThan(before);

    await page.getByTestId('optimise-apply').click();
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('freeform');
    await expect(page.getByTestId('track-freeform-summary')).toHaveText('Free-form track, 12 points');
    await expect(page.getByTestId('optimise-message')).toHaveText('Optimised free-form track applied, 12 points. Undo restores the previous track.');
    await expect(section).toHaveAttribute('data-phase', 'idle');
    await expect.poll(() => camSize(page), { timeout: 20_000 }).toBe(after);
    await solved(page);

    // One undo step restores the eccentric track.
    await page.getByTestId('btn-undo').click();
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('eccentric');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();
    await expect.poll(() => camSize(page), { timeout: 20_000 }).toBe(before);
    expect(errors).toEqual([]);
  });

  test('Discard keeps the track and adds no undo step', async ({ page }) => {
    await openWithBudget(page, 20);
    await page.getByTestId('optimise-goal').selectOption('force');
    await runToResult(page);
    await expect(page.getByTestId('optimise-progress')).toBeHidden();
    await page.getByTestId('optimise-discard').click();
    await expect(page.getByTestId('optimise-result')).toBeHidden();
    await expect(page.getByTestId('optimise-message')).toHaveText('Optimise result discarded. The track stays as it is.');
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('eccentric');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();
    await expect(page.getByTestId('optimise-run')).toBeEnabled();
  });

  test('Stop ends the run at once and keeps the best shape so far', async ({ page }) => {
    await openWithBudget(page);
    await page.getByTestId('optimise-run').click();
    const section = page.getByTestId('optimise');
    // The first improvement of the default design comes within a few solves.
    await expect(section).toHaveAttribute('data-improved', 'true', { timeout: 30_000 });
    await page.getByTestId('optimise-stop').click();
    await expect(section).toHaveAttribute('data-phase', 'result');
    await expect(page.getByTestId('optimise-note')).toHaveText(/Stopped after \d+ solves; the best shape so far is kept\./);
    await expect(page.getByTestId('optimise-apply')).toBeFocused();
    await expect(shapeField(page)).not.toHaveAttribute('inert', '');
    const solves = await section.getAttribute('data-solves');
    // A stopped worker posts nothing more.
    await page.waitForTimeout(500);
    expect(await section.getAttribute('data-solves')).toBe(solves);
    await expect(section).toHaveAttribute('data-phase', 'result');
  });

  test('a change of the design during a run stops it and discards the result', async ({ page }) => {
    await openWithBudget(page);
    await page.getByTestId('optimise-run').click();
    const section = page.getByTestId('optimise');
    await expect(section).toHaveAttribute('data-phase', 'running');
    const draw = page.getByTestId('field-draw');
    await draw.fill('28');
    await draw.press('Enter');
    await expect(page.getByTestId('optimise-message')).toHaveText('The design changed during the run, so the run stopped and its result is discarded.');
    await expect(section).toHaveAttribute('data-phase', 'idle');
    await expect(shapeField(page)).not.toHaveAttribute('inert', '');
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('eccentric');
  });

  test('opening another design discards a result that waits for Apply', async ({ page }) => {
    await openWithBudget(page, 20);
    await runToResult(page);
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-sample').click();
    await page.getByTestId('sample-crossbow').click();
    await expect(page.getByTestId('design-name')).toHaveText('Crossbow (169 lbf)');
    await expect(page.getByTestId('optimise-message')).toHaveText('Another design was opened, so the Optimise run is discarded.');
    await expect(page.getByTestId('optimise-result')).toBeHidden();
    await expect(page.getByTestId('choice-track-shape')).toHaveValue('eccentric');
  });

  test('says why it is disabled while the design fails a check', async ({ page }) => {
    await openWithBudget(page);
    const bend = page.getByTestId('field-bend-radius');
    await bend.fill('50');
    await bend.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 20_000 });
    await expect(page.getByTestId('optimise-run')).toBeDisabled();
    await expect(page.getByTestId('optimise-reason')).toHaveText('Optimise starts from a design that meets every check. See Results for the problems.');
    await page.getByTestId('btn-undo').click();
    await expect(page.getByTestId('optimise-run')).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId('optimise-reason')).toBeHidden();
  });
});
