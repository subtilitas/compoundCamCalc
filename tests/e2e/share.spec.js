import { expect, test } from '@playwright/test';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES } from '../../src/state/samples.js';
import { encodeShare } from '../../src/state/share.js';

/** @typedef {import('@playwright/test').Page} Page */

/**
 * @param {Page} page
 * @param {string} item test id without the "file-" prefix
 */
async function menu(page, item) {
  await page.getByTestId('file-menu').click();
  await page.getByTestId(`file-${item}`).click();
}

/** @param {Page} page */
async function changeAta(page, value = '34') {
  const ata = page.getByTestId('field-ata');
  await ata.fill(value);
  await ata.press('Enter');
}

/**
 * Relative link to a design.
 * @param {import('../../src/state/schema.js').ProjectState} state
 * @param {string} name
 */
const linkTo = (state, name) => `./#design=${encodeShare(state, name)}`;

const crossbow = () => SAMPLES.find((s) => s.id === 'crossbow')?.state() ?? defaultState();

/** @param {Page} page */
async function expectNoFragment(page) {
  await expect.poll(() => new URL(page.url()).hash).toBe('');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test.describe('Share link', () => {
  test('a copied link opens the same inputs and name with the units of the recipient', async ({ page, context, browser }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await changeAta(page, '31');
    await menu(page, 'save-as');
    await page.getByTestId('dialog-name').fill('Bow A');
    await page.getByTestId('dialog-ok').click();
    await menu(page, 'share');
    const status = page.getByTestId('file-status');
    await expect(status).toHaveText(/^Share link copied \(\d+ characters\)$/);
    await expect(page.getByTestId('file-menu')).toBeFocused();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/^http:\/\/localhost:\d+\/#design=v1\.[A-Za-z0-9_-]+$/);
    await expect(status).toHaveText(`Share link copied (${link.length} characters)`);

    // The recipient uses another browser profile with its own units.
    const other = await browser.newContext();
    const setup = await other.newPage();
    await setup.goto(new URL('./', link).href);
    await setup.getByTestId('unit-force').selectOption('lbf');
    await setup.getByTestId('unit-draw').selectOption('mm');
    await expect(setup.locator('#app')).toHaveAttribute('data-autosave', 'saved');
    await setup.close();
    const recipient = await other.newPage();
    await recipient.goto(link);
    await expect(recipient.getByTestId('design-name')).toHaveText('Bow A');
    await expect(recipient.getByTestId('design-marker')).toHaveText('(not saved)');
    await expect(recipient.getByTestId('field-ata')).toHaveValue('787.4');
    await expect(recipient.getByTestId('unit-force')).toHaveValue('lbf');
    await expect(recipient.getByTestId('file-status')).toHaveText('Opened the shared design "Bow A"');
    await expectNoFragment(recipient);
    await other.close();
  });

  test('a refused clipboard shows the link selected in a dialog', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } });
    });
    await menu(page, 'share');
    const field = page.getByTestId('share-link');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('readonly', '');
    const value = await field.inputValue();
    expect(value).toMatch(/#design=v1\./);
    expect(await field.evaluate((el) => [/** @type {HTMLInputElement} */ (el).selectionStart, /** @type {HTMLInputElement} */ (el).selectionEnd]))
      .toEqual([0, value.length]);
    await page.getByTestId('dialog-no').click();
    await expect(field).toHaveCount(0);
    await expect(page.getByTestId('file-menu')).toBeFocused();
  });

  test('a link opens directly over a clean working copy and leaves the address without the fragment', async ({ page }) => {
    await page.goto(linkTo(crossbow(), 'Crossbow of Ann'));
    await expect(page.getByTestId('design-name')).toHaveText('Crossbow of Ann');
    await expect(page.getByTestId('field-ata')).toHaveValue('16.00');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();
    await expectNoFragment(page);
    // A reload keeps the opened design and does not ask again.
    await page.reload();
    await expect(page.getByTestId('design-name')).toHaveText('Crossbow of Ann');
    await expect(page.getByTestId('file-dialog')).toHaveCount(0);
  });

  test('unsaved changes ask with three choices; Keep my design leaves a notice that opens the design', async ({ page }) => {
    await changeAta(page, '34');
    await page.goto(linkTo(crossbow(), 'Crossbow'));
    const dialog = page.getByTestId('file-dialog');
    await expect(dialog.getByRole('heading')).toHaveText('Open a shared design');
    await expect(dialog).toContainText('"Untitled" has unsaved changes');
    await expect(dialog.getByRole('button')).toHaveText(['Save mine first…', 'Open without saving', 'Keep my design']);
    await expect(page.getByTestId('share-keep')).toBeFocused();
    await page.getByTestId('share-keep').click();
    await expect(page.getByTestId('field-ata')).toHaveValue('34.00');
    await expect(page.getByTestId('design-name')).toHaveText('Untitled');
    const notice = page.getByTestId('notice');
    await expect(notice).toContainText('The shared design "Crossbow" was not opened; your design stays open.');
    await expectNoFragment(page);
    await notice.getByTestId('notice-action').click();
    // The changes are still unsaved: the same question comes again.
    await page.getByTestId('share-open').click();
    await expect(page.getByTestId('design-name')).toHaveText('Crossbow');
    await expect(page.getByTestId('field-ata')).toHaveValue('16.00');
    await expect(page.getByTestId('notice')).toHaveCount(0);
  });

  test('Save mine first saves the working copy, then opens the shared design', async ({ page }) => {
    await changeAta(page, '34');
    await page.goto(linkTo(crossbow(), 'Crossbow'));
    await page.getByTestId('share-save').click();
    await page.getByTestId('dialog-name').fill('Mine');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('design-name')).toHaveText('Crossbow');
    await expect(page.getByTestId('field-ata')).toHaveValue('16.00');
    await menu(page, 'open');
    await page.getByRole('button', { name: 'Open Mine' }).click();
    await expect(page.getByTestId('field-ata')).toHaveValue('34.00');
  });

  test('an invalid link shows a notice and keeps the working copy', async ({ page }) => {
    await changeAta(page, '34');
    const cut = linkTo(crossbow(), 'Crossbow');
    await page.goto(cut.slice(0, Math.floor(cut.length * 0.9)));
    await expect(page.getByTestId('notice')).toHaveText(/The shared design could not be opened\. The link is incomplete or damaged, often because a chat app shortened it\. Ask for the whole link, or for a project file\./);
    await expect(page.getByTestId('field-ata')).toHaveValue('34.00');
    await expect(page.getByTestId('file-dialog')).toHaveCount(0);
    await expectNoFragment(page);
    const newer = `./#design=v1.${Buffer.from(JSON.stringify({ name: 'x', state: { schemaVersion: 9 } })).toString('base64url')}`;
    await page.goto(newer);
    await expect(page.getByTestId('notice').last()).toContainText('The link was made with a newer version of the app. Open it with the newest version: choose "main, newest" in the Version select, or reload the page.');
    // The link stays, so a reload that loads the newer app opens it.
    expect(new URL(page.url()).hash).toMatch(/^#design=v1\./);
    // Page anchors are not links to designs.
    await page.goto('./#results-title');
    await expect(page.getByTestId('notice')).toHaveCount(2);
    expect(new URL(page.url()).hash).toBe('#results-title');
  });

  test('a name with markup stays text in the header', async ({ page }) => {
    const name = '<img src=x onerror=alert(1)>';
    page.on('dialog', () => {
      throw new Error('a script ran');
    });
    await page.goto(linkTo(defaultState(), name));
    await expect(page.getByTestId('design-name')).toHaveText(name);
    await expect(page.locator('header img, #file-area img')).toHaveCount(0);
  });

  test('a link that arrives while a dialog is open waits; only the newest applies', async ({ page }) => {
    await menu(page, 'sample');
    await expect(page.getByTestId('sample-list')).toBeVisible();
    const hunting = SAMPLES.find((s) => s.id === 'hunting')?.state() ?? defaultState();
    // The first link is damaged: had it applied, a notice would show.
    await page.evaluate((hash) => { location.hash = hash; }, linkTo(crossbow(), 'First').slice(2, -8));
    await page.evaluate((hash) => { location.hash = hash; }, linkTo(hunting, 'Second').slice(2));
    await expect(page.getByTestId('design-name')).toHaveText('Untitled');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('design-name')).toHaveText('Second');
    await expect(page.getByTestId('field-ata')).toHaveValue('31.00');
    await expect(page.getByTestId('notice')).toHaveCount(0);
    await expectNoFragment(page);
  });
});
