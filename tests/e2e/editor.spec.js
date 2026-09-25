import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openTable, pointCentre } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test('dragging a point with the mouse moves it, undo restores it', async ({ page }) => {
  const app = page.locator('#app');
  await openTable(page);
  const force = page.getByTestId('point-f-4');
  await expect(force).toHaveValue('267.0');
  const c = await pointCentre(page, 4);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + 30, { steps: 6 });
  const readout = page.getByTestId('chart-readout');
  await expect(readout).toBeVisible();
  await expect(readout).toHaveText(/^Point 4: \d+\.\d in, \d+ N$/);
  await expect(readout).not.toHaveText(/ 267 N$/);
  await page.mouse.up();
  await expect(readout).toBeHidden();
  await expect(force).not.toHaveValue('267.0');
  // Dragging down lowers the force; the draw length stays.
  expect(Number(await force.inputValue())).toBeLessThan(267);
  await expect(page.getByTestId('point-x-4')).toHaveValue('22.99');
  await expect(app).toHaveAttribute('data-curve-mode', 'custom');
  await expect(page.getByTestId('curve-mode')).toHaveText('Custom');

  await page.getByTestId('btn-undo').click();
  await expect(force).toHaveValue('267.0');
  await expect(app).toHaveAttribute('data-curve-mode', 'parametric');
  await expect(page.getByTestId('btn-undo')).toBeDisabled();
  await page.getByTestId('btn-redo').click();
  await expect(force).not.toHaveValue('267.0');
});

test('arrow keys move a focused point by 1 N, Shift by 10 N, Ctrl+Z undoes', async ({ page }) => {
  await openTable(page);
  const point = page.getByTestId('chart-point-3');
  await point.focus();
  await expect(page.locator('#app')).toHaveAttribute('data-selected', '3');
  await page.keyboard.press('ArrowUp');
  await expect(point).toHaveAttribute('aria-label', /^Point 3: 14\.5 in, 268 N\. Arrow keys move it\.$/);
  await expect(page.getByTestId('point-f-3')).toHaveValue('268.0');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByTestId('point-f-3')).toHaveValue('278.0');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('point-x-3')).toHaveValue('14.57');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('point-x-3')).toHaveValue('14.47');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('point-x-3')).toHaveValue('14.57');
});

test('the toolbar adds a point and the Delete key removes it', async ({ page }) => {
  const app = page.locator('#app');
  await page.getByTestId('btn-add-point').click();
  await expect(app).toHaveAttribute('data-point-count', '8');
  await expect(page.getByTestId('chart-point-4')).toBeFocused();
  await expect(page.getByTestId('edit-status')).toHaveText('Point 4 added');
  await page.keyboard.press('Delete');
  await expect(app).toHaveAttribute('data-point-count', '7');
  await expect(page.getByTestId('edit-status')).toHaveText('Point 4 removed');
  await expect(page.getByTestId('chart-point-3')).toBeFocused();
  await page.keyboard.press('+');
  await expect(app).toHaveAttribute('data-point-count', '8');
  await expect(page.getByTestId('chart-point-4')).toBeFocused();
});

test('the brace and full-draw points cannot be removed', async ({ page }) => {
  await page.getByTestId('chart-point-7').focus();
  await expect(page.getByTestId('btn-delete-point')).toBeDisabled();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('edit-status')).toHaveText('The full-draw point cannot be removed');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test('double-click on empty chart space adds a point', async ({ page, isMobile }) => {
  test.skip(isMobile, 'double-click is a desktop gesture');
  const chart = page.getByTestId('force-chart');
  const box = await chart.boundingBox();
  if (!box) throw new Error('chart is not visible');
  await chart.dblclick({ position: { x: box.width * 0.55, y: box.height * 0.75 } });
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '8');
  await expect(page.getByTestId('chart-point-4')).toBeFocused();
});

test('right-click on a point removes it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'right-click is a desktop gesture');
  const c = await pointCentre(page, 5);
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '6');
});

test('touch: tap Add point, then select a point and tap Delete point', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch test runs in the mobile project');
  const app = page.locator('#app');
  await page.getByTestId('btn-add-point').tap();
  await expect(app).toHaveAttribute('data-point-count', '8');
  await page.getByTestId('chart-point-4').tap();
  await expect(app).toHaveAttribute('data-selected', '4');
  await expect(page.getByTestId('btn-delete-point')).toBeEnabled();
  await page.getByTestId('btn-delete-point').tap();
  await expect(app).toHaveAttribute('data-point-count', '7');
  await expect(page.getByTestId('btn-delete-point')).toBeDisabled();
});

test('switching units changes axis labels, table and stats', async ({ page }) => {
  await openTable(page);
  await page.getByTestId('unit-force').selectOption('lbf');
  await expect(page.getByTestId('axis-y-label')).toHaveText('Draw force, lbf');
  await expect(page.getByTestId('point-f-3')).toHaveValue('60.0');
  await expect(page.getByTestId('stat-peak')).toHaveText('60.0 lbf');
  await page.getByTestId('unit-draw').selectOption('mm');
  await expect(page.getByTestId('axis-x-label')).toHaveText('Draw length (AMO), mm');
  await expect(page.getByTestId('point-x-7')).toHaveText('736.6');
  await page.getByTestId('unit-energy').selectOption('ft·lbf');
  await expect(page.getByTestId('stat-energy')).toHaveText(/ ft·lbf$/);
});

test('invalid table entries show an inline message and are not applied', async ({ page }) => {
  await openTable(page);
  const x = page.getByTestId('point-x-3');
  const message = page.getByTestId('point-x-3-msg');
  await x.fill('abc');
  await x.press('Enter');
  await expect(message).toHaveText('Enter a number, for example 24.5 or 24,5');
  await expect(x).toHaveAttribute('aria-invalid', 'true');
  await x.fill('40');
  await x.press('Enter');
  await expect(message).toHaveText(/^Enter a draw length between 10\.84 and 22\.88 in$/);
  await expect(page.locator('#app')).toHaveAttribute('data-curve-mode', 'parametric');
  await x.fill('15,5');
  await x.press('Enter');
  await expect(message).toBeHidden();
  await expect(x).toHaveValue('15.50');
  await expect(x).toHaveAttribute('aria-invalid', 'false');

  const f = page.getByTestId('point-f-3');
  await f.fill('9000');
  await f.press('Enter');
  await expect(page.getByTestId('point-f-3-msg')).toHaveText('Enter a force between 1.00 and 5000.0 N');
  await f.fill('60 lbf');
  await f.press('Enter');
  await expect(f).toHaveValue('266.9');
});

test('settings fields validate and sliders update the curve live', async ({ page }) => {
  const brace = page.getByTestId('field-brace');
  await brace.fill('12');
  await brace.press('Enter');
  await expect(page.getByTestId('field-brace-msg')).toHaveText('Brace height must be between 4 and 10 in');
  await brace.fill('7');
  await brace.press('Enter');
  await expect(page.getByTestId('field-brace-msg')).toHaveText('');
  await expect(page.getByTestId('stat-stroke')).toHaveText('20.25 in');
  await page.getByRole('button', { name: 'Increase brace height' }).click();
  await expect(brace).toHaveValue('7.25');
  await expect(page.getByTestId('stat-stroke')).toHaveText('20.00 in');

  await page.getByTestId('slider-peak').fill('300');
  await expect(page.getByTestId('stat-peak')).toHaveText('300 N');
  await expect(page.getByTestId('field-peak')).toHaveValue('300.0');
  await page.getByTestId('field-letoff').fill('70');
  await page.getByTestId('field-letoff').press('Enter');
  await expect(page.getByTestId('stat-letoff')).toHaveText('70.0 %');
  await page.getByTestId('btn-undo').click();
  await expect(page.getByTestId('stat-letoff')).toHaveText('80.0 %');
});

test('the peak slider reaches the bounds of its field in lbf', async ({ page }) => {
  await page.getByTestId('unit-force').selectOption('lbf');
  const slider = page.getByTestId('slider-peak');
  await expect(slider).toHaveAttribute('min', '11.3');
  await expect(slider).toHaveAttribute('max', '202.3');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('field-peak')).toHaveValue('202.3');
  await page.keyboard.press('Home');
  await expect(page.getByTestId('field-peak')).toHaveValue('11.3');
});

test('a cancelled slider gesture ends its undo entry', async ({ page }) => {
  const slider = page.getByTestId('slider-peak');
  await slider.evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = '300';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
  });
  await expect(page.getByTestId('stat-peak')).toHaveText('300 N');
  await expect(page.getByTestId('btn-undo')).toBeEnabled();
  await page.getByTestId('btn-undo').click();
  await expect(page.getByTestId('stat-peak')).toHaveText('267 N');
});

test('Reset curve regenerates a custom curve and keeps keyboard focus in the toolbar', async ({ page }) => {
  await page.getByTestId('chart-point-3').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('curve-mode')).toHaveText('Custom');
  const reset = page.getByTestId('btn-reset-curve');
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('curve-mode')).toHaveText('Parametric');
  await expect(reset).toBeDisabled();
  await expect(page.getByTestId('btn-add-point')).toBeFocused();
  await expect(page.getByTestId('edit-status')).toHaveText('Curve regenerated from the parameters');
});

test('Undo that empties the history moves keyboard focus to Redo', async ({ page }) => {
  await page.getByTestId('chart-point-3').focus();
  await page.keyboard.press('ArrowUp');
  const undo = page.getByTestId('btn-undo');
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(undo).toBeDisabled();
  await expect(page.getByTestId('btn-redo')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('btn-redo')).toBeDisabled();
  await expect(undo).toBeFocused();
});

test('glossary buttons show a definition', async ({ page }) => {
  const button = page.getByTestId('info-letOff').first();
  await button.click();
  const pop = page.getByTestId('glossary-letOff').first();
  await expect(pop).toBeVisible();
  await expect(pop).toHaveText(/^Let-off: drop from the peak draw force to the holding weight/);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
});

test('autosave keeps an edited point across a reload', async ({ page }) => {
  const app = page.locator('#app');
  await page.getByTestId('chart-point-3').focus();
  await page.keyboard.press('ArrowUp');
  await expect(app).toHaveAttribute('data-autosave', 'saved');
  await page.reload();
  await expect(app).toHaveAttribute('data-curve-mode', 'custom');
  await openTable(page);
  await expect(page.getByTestId('point-f-3')).toHaveValue('268.0');
});

test('invalid saved data falls back to the default with a dismissible notice', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('compoundCamCalc.project', '{"schemaVersion":9}'));
  await page.reload();
  const notice = page.getByTestId('notice');
  await expect(notice).toContainText('The saved project could not be loaded: The project was saved by a newer version');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
  await page.getByTestId('notice-close').click();
  await expect(notice).toHaveCount(0);
});

test('the editor has no detectable accessibility violations', async ({ page }) => {
  await openTable(page);
  await page.getByTestId('chart-point-3').focus();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test.describe('dark colour scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('the editor has no detectable accessibility violations', async ({ page }) => {
    await openTable(page);
    await page.getByTestId('chart-point-3').focus();
    await page.keyboard.press('ArrowUp');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('320 px viewport', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the editor with open table has no horizontal scroll', async ({ page }) => {
    await openTable(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
