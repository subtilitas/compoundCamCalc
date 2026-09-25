import { expect, test } from '@playwright/test';
import { nextFrames, openTable, pointCentre } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test.describe('chart', () => {
  test('a drag stops at the top of the frozen scale and the readout stays in the chart', async ({ page }) => {
    const c = await pointCentre(page, 3);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y - 250, { steps: 10 });
    const chart = await page.getByTestId('force-chart').boundingBox();
    const point = await page.getByTestId('chart-point-3').locator('.pt-dot').boundingBox();
    const readout = await page.getByTestId('chart-readout').boundingBox();
    if (!chart || !point || !readout) throw new Error('chart elements are not visible');
    // Plot top: 30 px below the top of the chart.
    expect(point.y + point.height / 2).toBeGreaterThanOrEqual(chart.y + 29);
    expect(readout.y).toBeGreaterThanOrEqual(chart.y - 0.5);
    await expect(page.getByTestId('chart-readout')).toHaveText(/^Point 3: 17\.8 in, 307 N$/);
    await page.mouse.up();
  });

  test('a change of the chart width during a drag does not move the point sideways', async ({ page }) => {
    await openTable(page);
    const c = await pointCentre(page, 4);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 10, { steps: 3 });
    await page.evaluate(() => {
      const wrap = /** @type {HTMLElement} */ (document.getElementById('chart-wrap'));
      wrap.style.width = `${wrap.clientWidth - 17}px`;
    });
    await nextFrames(page);
    await page.mouse.move(c.x, c.y + 40, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('#app')).toHaveAttribute('data-curve-mode', 'custom');
    await expect(page.getByTestId('point-x-4')).toHaveValue('21.13');
  });

  test('Ctrl+Z during a drag is ignored, so the drag stays one undo entry', async ({ page }) => {
    const app = page.locator('#app');
    const undo = page.getByTestId('btn-undo');
    const c = await pointCentre(page, 4);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 20, { steps: 4 });
    await page.keyboard.press('Control+z');
    await expect(app).toHaveAttribute('data-curve-mode', 'custom');
    await page.mouse.move(c.x, c.y + 40, { steps: 4 });
    await page.mouse.up();
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(app).toHaveAttribute('data-curve-mode', 'parametric');
    await expect(undo).toBeDisabled();
  });

  test('the selected point is drawn above its neighbours without changing the tab order', async ({ page }) => {
    await page.getByTestId('chart-point-6').focus();
    const mark = page.getByTestId('chart-selected-mark');
    await expect(mark).toBeVisible();
    const lastChild = await page.getByTestId('force-chart').evaluate((svg) => svg.lastElementChild?.getAttribute('data-testid'));
    expect(lastChild).toBe('chart-selected-mark');
    const a = await mark.locator('.pt-dot').boundingBox();
    const b = await page.getByTestId('chart-point-6').locator('.pt-dot').boundingBox();
    if (!a || !b) throw new Error('points are not visible');
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('chart-point-7')).toBeFocused();
  });

  test('a touch drag shows the readout well above the finger', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch drag runs in the mobile project');
    const c = await pointCentre(page, 4);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    for (let k = 1; k <= 5; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y + 4 * k }] });
    }
    const readout = page.getByTestId('chart-readout');
    await expect(readout).toBeVisible();
    const box = await readout.boundingBox();
    if (!box) throw new Error('readout is not visible');
    expect(box.y + box.height).toBeLessThanOrEqual(c.y + 20 - 40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(readout).toBeHidden();
  });
});

test.describe('keyboard', () => {
  test('arrow keys report the new position in the status line', async ({ page }) => {
    await page.getByTestId('chart-point-3').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('edit-status')).toHaveText('Point 3: 17.8 in, 268 N');
  });

  test('a refused move reports the reason and changes nothing', async ({ page }) => {
    const app = page.locator('#app');
    const status = page.getByTestId('edit-status');
    await page.getByTestId('chart-point-7').focus();
    await page.keyboard.press('ArrowRight');
    await expect(status).toHaveText('The full-draw point moves only up and down');
    await expect(app).toHaveAttribute('data-curve-mode', 'parametric');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();

    await page.getByTestId('chart-point-6').focus();
    for (let k = 0; k < 3; k++) await page.keyboard.press('Shift+ArrowRight');
    await expect(status).toHaveText('Point 6 stays at least 0.1 in from point 7');
  });

  test('a repeated message is announced again', async ({ page }) => {
    await page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.querySelector('[data-testid="edit-status"]'));
      /** @type {any} */ (window).statusSets = 0;
      new MutationObserver(() => {
        if (el.textContent) /** @type {any} */ (window).statusSets++;
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.getByTestId('chart-point-7').focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).statusSets)).toBe(1);
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).statusSets)).toBe(2);
    await expect(page.getByTestId('edit-status')).toHaveText('The full-draw point cannot be removed');
  });

  test('undo clears the status line', async ({ page }) => {
    const status = page.getByTestId('edit-status');
    await page.getByTestId('btn-add-point').click();
    // The largest gap of the default curve lies between points 2 and 3.
    await expect(status).toHaveText('Point 3 added');
    await page.getByTestId('btn-undo').click();
    await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
    await expect(status).toHaveText('');
  });
});

test.describe('point table', () => {
  test('a focused field selects its point, so Delete point removes the highlighted point', async ({ page, isMobile }) => {
    test.skip(isMobile, 'uses a mouse click on the chart');
    const app = page.locator('#app');
    await openTable(page);
    const c = await pointCentre(page, 5);
    await page.mouse.click(c.x, c.y);
    await expect(app).toHaveAttribute('data-selected', '5');
    const f3 = page.getByTestId('point-f-3');
    await f3.focus();
    await expect(app).toHaveAttribute('data-selected', '3');
    await f3.fill('300');
    await page.getByTestId('btn-delete-point').click();
    await expect(app).toHaveAttribute('data-point-count', '6');
    await expect(page.getByTestId('edit-status')).toHaveText('Point 3 removed');
  });

  test('an invalid entry gives way to the current value when the point moves', async ({ page }) => {
    await openTable(page);
    const f3 = page.getByTestId('point-f-3');
    await f3.fill('abc');
    await f3.press('Tab');
    await expect(f3).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('point-f-3-msg')).toHaveAttribute('aria-live', 'polite');
    await page.getByTestId('chart-point-3').focus();
    await page.keyboard.press('ArrowUp');
    await expect(f3).toHaveValue('268.0');
    await expect(f3).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByTestId('point-f-3-msg')).toHaveText('');
  });

  test('a draw length bound named in the message is accepted', async ({ page }) => {
    await openTable(page);
    const x3 = page.getByTestId('point-x-3');
    await x3.fill('16.10');
    await x3.press('Enter');
    const x4 = page.getByTestId('point-x-4');
    await x4.fill('10');
    await x4.press('Enter');
    const message = page.getByTestId('point-x-4-msg');
    await expect(message).toHaveText(/^Enter a draw length between 16\.20 and \d+\.\d\d in$/);
    await x4.fill('16.20');
    await x4.press('Enter');
    await expect(message).toHaveText('');
    await expect(x4).toHaveValue('16.20');
  });
});

test.describe('settings', () => {
  test('let-off 0 % on a custom curve can be undone by a higher let-off', async ({ page }) => {
    await page.getByTestId('chart-point-3').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#app')).toHaveAttribute('data-curve-mode', 'custom');
    const slider = page.getByTestId('slider-letoff');
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('stat-letoff')).toHaveText('0.0 %');
    await page.keyboard.press('End');
    await expect(page.getByTestId('stat-letoff')).toHaveText('95.0 %');
    await expect(page.getByTestId('field-letoff-msg')).toHaveText('');
  });

  test('a field follows the state after a refused entry', async ({ page }) => {
    const brace = page.getByTestId('field-brace');
    await brace.fill('12');
    await brace.press('Tab');
    await expect(page.getByTestId('field-brace-msg')).toHaveText('Brace height must be between 4 and 10 in');
    await page.getByTestId('unit-draw').selectOption('mm');
    await expect(brace).toHaveValue('165.1');
    await expect(page.getByTestId('field-brace-msg')).toHaveText('');
    await expect(brace).toHaveAttribute('aria-invalid', 'false');
  });

  test('the bounds printed in a range hint are accepted', async ({ page }) => {
    await page.getByTestId('unit-draw').selectOption('mm');
    await expect(page.locator('#f-draw-range')).toHaveText('508 to 863.6 mm, step 5');
    const draw = page.getByTestId('field-draw');
    await draw.fill('863.6');
    await draw.press('Enter');
    await expect(page.getByTestId('field-draw-msg')).toHaveText('');
    await expect(draw).toHaveValue('863.6');

    await page.getByTestId('unit-force').selectOption('lbf');
    await expect(page.locator('#f-peak-range')).toHaveText('11.3 to 202.3 lbf, step 0.5');
    const peak = page.getByTestId('field-peak');
    await peak.fill('11.3');
    await peak.press('Enter');
    await expect(page.getByTestId('field-peak-msg')).toHaveText('');
    await expect(page.getByTestId('stat-peak')).toHaveText('11.3 lbf');
  });

  test('the valley width field names the width the curve reaches', async ({ page }) => {
    const message = page.getByTestId('field-valley-msg');
    await expect(message).toHaveText('');
    const letOff = page.getByTestId('field-letoff');
    await letOff.fill('20');
    await letOff.press('Enter');
    await expect(message).toHaveText(/^Valley width is limited to \d+\.\d\d in by the let-off, rise and power stroke$/);
    await expect(page.getByTestId('field-valley')).toHaveValue('1.20');
  });

  test('peak and let-off fields name a custom curve outside their ranges', async ({ page }) => {
    await openTable(page);
    const f4 = page.getByTestId('point-f-4');
    // Peak 1600 N over a holding weight of 66.75 N: let-off 95.8 %.
    await f4.fill('1600');
    await f4.press('Enter');
    await expect(page.getByTestId('stat-peak')).toHaveText('1600 N');
    await expect(page.getByTestId('field-peak')).toHaveValue('900.0');
    await expect(page.getByTestId('field-peak-msg')).toHaveText('The custom curve peaks at 1600 N, outside this range; Reset curve uses 900 N');
    await expect(page.getByTestId('field-letoff-msg')).toHaveText('The custom curve has a let-off of 95.8 %, outside this range; Reset curve uses 95 %');
    await page.getByTestId('btn-reset-curve').click();
    await expect(page.getByTestId('field-peak-msg')).toHaveText('');
    await expect(page.getByTestId('stat-peak')).toHaveText('900 N');
  });
});

test.describe('glossary', () => {
  test('a definition near the bottom edge opens above its button and closes on scroll', async ({ page }) => {
    const button = page.getByTestId('stats').getByTestId('info-peak');
    const b = await button.boundingBox();
    const size = page.viewportSize();
    if (!b || !size) throw new Error('info button is not visible');
    // Viewport ends 4 px below the button; the width, and so the layout, stays.
    await page.setViewportSize({ width: size.width, height: Math.ceil(b.y + b.height + 4) });
    await button.click();
    const pop = page.getByTestId('stats').getByTestId('glossary-peak');
    await expect(pop).toBeVisible();
    const box = await pop.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('popover is not visible');
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(b.y);
    await page.evaluate(() => window.scrollBy(0, 100));
    await expect(pop).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('without the Popover API a definition closes with Escape and a click outside', async ({ page }) => {
    await page.addInitScript(() => {
      delete (/** @type {any} */ (HTMLElement.prototype).popover);
    });
    await page.reload();
    const button = page.getByTestId('info-letOff').first();
    const pop = page.getByTestId('glossary-letOff').first();
    await expect(pop).not.toHaveAttribute('popover');
    await button.click();
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await expect(pop).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(pop).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('saving', () => {
  test('a change right before a reload is saved', async ({ page }) => {
    await page.getByTestId('chart-point-3').focus();
    await page.keyboard.press('ArrowUp');
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-curve-mode', 'custom');
  });

  test('unreadable saved data is kept as a copy before the next change replaces it', async ({ page }) => {
    const seeded = '{"schemaVersion":9}';
    await page.evaluate((text) => localStorage.setItem('compoundCamCalc.project', text), seeded);
    await page.reload();
    await expect(page.getByTestId('notice')).toContainText('A copy of the saved data is kept in the browser');
    await page.getByTestId('btn-add-point').click();
    await expect(page.locator('#app')).toHaveAttribute('data-autosave', 'saved');
    const stored = await page.evaluate(() => [
      localStorage.getItem('compoundCamCalc.project.unreadable'),
      JSON.parse(localStorage.getItem('compoundCamCalc.project') ?? '{}').schemaVersion,
    ]);
    expect(stored).toEqual([seeded, 1]);
  });
});
