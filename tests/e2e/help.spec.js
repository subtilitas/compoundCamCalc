import { expect, test } from '@playwright/test';
import { GLOSSARY } from '../../src/ui/glossary.js';

/** @typedef {import('@playwright/test').Page} Page */

/** @param {Page} page */
async function openHelp(page) {
  await page.getByTestId('help-button').click();
  const dialog = page.getByTestId('help-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test.describe('Help dialog', () => {
  test('opens from the header with the focus on its heading, and the page behind is inert', async ({ page }) => {
    const button = page.getByTestId('help-button');
    await expect(button).toHaveText('Help');
    // The Help button follows the File button in the header bar.
    const next = await page.getByTestId('file-menu').evaluate((el) => el.parentElement?.nextElementSibling?.getAttribute('data-testid'));
    expect(next).toBe('help-button');
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);

    const dialog = await openHelp(page);
    await expect(dialog.getByRole('heading', { level: 2, name: 'Help' })).toBeFocused();
    expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);
    // A click on the File button hits the backdrop of the dialog instead.
    const file = await page.getByTestId('file-menu').boundingBox();
    if (!file) throw new Error('no File button');
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
    }, { x: file.x + file.width / 2, y: file.y + file.height / 2 });
    expect(hit).not.toBe('file-menu');
    // Tab stays out of the page.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const outside = await page.evaluate(() => {
        const a = document.activeElement;
        return a !== null && a !== document.body && !a.closest('dialog');
      });
      expect(outside).toBe(false);
    }
  });

  test('Escape closes it and the focus returns to the Help button', async ({ page }) => {
    await openHelp(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-dialog')).toHaveCount(0);
    await expect(page.getByTestId('help-button')).toBeFocused();
  });

  for (const which of ['top', 'bottom']) {
    test(`the close button at the ${which} closes it`, async ({ page }) => {
      const dialog = await openHelp(page);
      await dialog.getByTestId(`help-close-${which}`).click();
      await expect(page.getByTestId('help-dialog')).toHaveCount(0);
      await expect(page.getByTestId('help-button')).toBeFocused();
    });
  }

  test('lists the quick start, the shortcuts and every glossary term', async ({ page }) => {
    const dialog = await openHelp(page);
    await expect(dialog.getByTestId('help-quick-start').locator('li')).toHaveCount(5);
    await expect(dialog.getByRole('heading', { level: 3, name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(dialog.getByText('Ctrl + Shift + Z')).toBeVisible();
    const keys = Object.keys(GLOSSARY);
    await expect(dialog.getByTestId('help-glossary').locator('dt')).toHaveCount(keys.length);
    for (const key of keys) {
      const dt = dialog.getByTestId(`help-term-${key}`);
      const text = await dt.evaluate((el) => `${el.textContent}: ${el.nextElementSibling?.textContent}`);
      expect(text).toBe(GLOSSARY[/** @type {keyof typeof GLOSSARY} */ (key)].text);
    }
  });

  test('links to the user guide in a new tab', async ({ page }) => {
    const dialog = await openHelp(page);
    const link = dialog.getByRole('link', { name: 'User guide on GitHub (opens a new tab)' });
    await expect(link).toHaveAttribute('href', 'https://github.com/subtilitas/compoundCamCalc/wiki/user-guide');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
  });

  test.describe('320 px viewport', () => {
    test.use({ viewport: { width: 320, height: 640 } });

    test('the dialog scrolls inside the window without horizontal scroll', async ({ page }) => {
      const overflowOf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflowOf()).toBe(0);
      const dialog = await openHelp(page);
      const size = await dialog.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        height: el.getBoundingClientRect().height,
        right: el.getBoundingClientRect().right,
      }));
      expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
      expect(size.right).toBeLessThanOrEqual(320);
      expect(size.height).toBeLessThanOrEqual(0.9 * 640 + 1);
      expect(size.scrollHeight).toBeGreaterThan(size.clientHeight);
      expect(await overflowOf()).toBe(0);
      // The bottom close button is reachable by scrolling.
      await dialog.getByTestId('help-close-bottom').click();
      await expect(page.getByTestId('help-dialog')).toHaveCount(0);
    });
  });
});

test.describe('info buttons of the new terms', () => {
  test('the minimum wall and minimum bend radius settings define their terms', async ({ page }) => {
    for (const key of /** @type {const} */ (['wall', 'bendRadius'])) {
      await page.getByTestId(`info-${key}`).click();
      await expect(page.getByTestId(`glossary-${key}`)).toHaveText(GLOSSARY[key].text);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(`glossary-${key}`)).toBeHidden();
    }
  });

  test('the results and the cam view legend define their terms', async ({ page }) => {
    await expect(page.locator('#app')).toHaveAttribute('data-solve-state', 'ok', { timeout: 20_000 });
    for (const [metric, key] of /** @type {const} */ ([
      ['peak', 'peak'], ['limbEnergy', 'limbEnergy'], ['axleTravel', 'axleTravel'], ['rotation', 'camRotation'],
      ['stringRho', 'radiusOfCurvature'], ['cableRho', 'radiusOfCurvature'],
    ])) {
      await page.getByTestId(`results-info-${metric}`).click();
      await expect(page.getByTestId(`results-glossary-${metric}`)).toHaveText(GLOSSARY[key].text);
      await page.keyboard.press('Escape');
    }
    const legend = page.getByTestId('camview-legend');
    await legend.getByTestId('info-leverArm').click();
    await expect(legend.getByTestId('glossary-leverArm')).toHaveText(GLOSSARY.leverArm.text);
  });
});
