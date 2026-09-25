import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { defaultState } from '../../src/state/presets.js';

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
 * Save the working copy under a name through Save as.
 * @param {Page} page
 * @param {string} name
 */
async function saveAs(page, name) {
  await menu(page, 'save-as');
  await page.getByTestId('dialog-name').fill(name);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('file-status')).toHaveText(`Saved "${name}"`);
}

/** @param {Page} page */
async function changeAta(page, value = '34') {
  const ata = page.getByTestId('field-ata');
  await ata.fill(value);
  await ata.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-point-count', '7');
});

test.describe('File menu', () => {
  test('a first visit shows Untitled, and Save asks for a name that survives a reload', async ({ page }) => {
    await expect(page.getByTestId('design-name')).toHaveText('Untitled');
    await expect(page.getByTestId('design-marker')).toHaveText('');
    await changeAta(page);
    await expect(page.getByTestId('design-marker')).toHaveText('(unsaved changes)');
    await menu(page, 'save');
    await expect(page.getByTestId('dialog-name')).toHaveValue('');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('dialog-error')).toHaveText('Enter a name');
    await page.getByTestId('dialog-name').fill('  Bow   A ');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('design-name')).toHaveText('Bow A');
    await expect(page.getByTestId('design-marker')).toHaveText('');
    await expect(page.getByTestId('file-menu')).toBeFocused();
    await page.reload();
    await expect(page.getByTestId('design-name')).toHaveText('Bow A');
    await expect(page.getByTestId('design-marker')).toHaveText('');
    await expect(page.getByTestId('field-ata')).toHaveValue('34.00');
  });

  test('a taken name shows an error with Replace', async ({ page }) => {
    await saveAs(page, 'Bow A');
    await changeAta(page);
    await menu(page, 'save-as');
    await page.getByTestId('dialog-name').fill('Other');
    await page.getByTestId('dialog-ok').click();
    await menu(page, 'save-as');
    await page.getByTestId('dialog-name').fill('bow a');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('dialog-error')).toHaveText('A design named "Bow A" already exists');
    await expect(page.getByTestId('dialog-name')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('dialog-replace').click();
    await expect(page.getByTestId('design-name')).toHaveText('bow a');
    await menu(page, 'open');
    await expect(page.getByTestId('design-row')).toHaveCount(2);
  });

  test('Open asks before it discards changes, and clears the undo history', async ({ page }) => {
    await saveAs(page, 'Bow A');
    await changeAta(page);
    await saveAs(page, 'Bow B');
    await changeAta(page, '35');
    await menu(page, 'open');
    await expect(page.getByTestId('file-dialog')).toContainText('"Bow B" has unsaved changes. Discard them?');
    await page.getByTestId('dialog-no').click();
    await expect(page.getByTestId('field-ata')).toHaveValue('35.00');
    await expect(page.getByTestId('file-menu')).toBeFocused();
    await menu(page, 'open');
    await page.getByTestId('dialog-yes').click();
    await page.getByRole('button', { name: 'Open Bow A' }).click();
    await expect(page.getByTestId('design-name')).toHaveText('Bow A');
    await expect(page.getByTestId('field-ata')).toHaveValue('33.00');
    await expect(page.getByTestId('btn-undo')).toBeDisabled();
    await expect(page.getByTestId('file-status')).toHaveText('Opened "Bow A"');
  });

  test('Reset to default is one undo step and keeps the name', async ({ page }) => {
    await changeAta(page);
    await saveAs(page, 'Bow A');
    await menu(page, 'reset');
    await expect(page.getByTestId('field-ata')).toHaveValue('33.00');
    await expect(page.getByTestId('design-name')).toHaveText('Bow A');
    await expect(page.getByTestId('design-marker')).toHaveText('(unsaved changes)');
    await page.getByTestId('btn-undo').click();
    await expect(page.getByTestId('field-ata')).toHaveValue('34.00');
    await expect(page.getByTestId('design-marker')).toHaveText('');
  });

  test('deleting the open design keeps its inputs as an unsaved design', async ({ page }) => {
    await saveAs(page, 'Bow A');
    await menu(page, 'open');
    await page.getByRole('button', { name: 'Delete Bow A' }).click();
    await expect(page.getByTestId('file-dialog').last()).toContainText('Its inputs stay open as an unsaved design');
    await page.getByTestId('dialog-yes').click();
    await expect(page.getByTestId('design-row')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('design-name')).toHaveText('Bow A');
    await expect(page.getByTestId('design-marker')).toHaveText('(not saved)');
  });

  test('inputs of a deleted design are never discarded without a question', async ({ page }) => {
    await saveAs(page, 'Bow A');
    await menu(page, 'open');
    await page.getByRole('button', { name: 'Delete Bow A' }).click();
    await page.getByTestId('dialog-yes').click();
    const openDialog = page.locator('dialog').filter({ has: page.getByTestId('design-list') });
    await expect(openDialog.getByTestId('dialog-status')).toHaveText('Deleted "Bow A"');
    await page.keyboard.press('Escape');
    await menu(page, 'sample');
    await expect(page.getByTestId('file-dialog')).toContainText('"Bow A" is not saved. Discard them?');
    await page.getByTestId('dialog-no').click();
    await expect(page.getByTestId('design-name')).toHaveText('Bow A');
  });

  test('replacing the open design through Rename leaves it unsaved, and Save asks for a name', async ({ page }) => {
    await saveAs(page, 'Bow A');
    await changeAta(page);
    await saveAs(page, 'Bow B');
    await menu(page, 'open');
    await page.getByRole('button', { name: 'Rename Bow A' }).click();
    await page.getByTestId('dialog-name').fill('Bow B');
    await page.getByTestId('dialog-ok').click();
    await page.getByTestId('dialog-replace').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('design-marker')).toHaveText(/^\(not saved/);
    await menu(page, 'save');
    await expect(page.getByTestId('dialog-name')).toHaveValue('Bow B');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('dialog-error')).toHaveText('A design named "Bow B" already exists');
  });

  test('Save to file and Open from file give the same inputs', async ({ page }, testInfo) => {
    await changeAta(page, '31');
    await saveAs(page, 'Bow: 31/in');
    const [file] = await Promise.all([page.waitForEvent('download'), menu(page, 'to-file')]);
    expect(file.suggestedFilename()).toBe('Bow- 31-in.json');
    const path = testInfo.outputPath('bow.json');
    await file.saveAs(path);
    await menu(page, 'reset');
    await expect(page.getByTestId('field-ata')).toHaveValue('33.00');
    await page.getByTestId('file-input').setInputFiles(path);
    // The reset left unsaved changes: confirm first.
    await page.getByTestId('dialog-yes').click();
    await expect(page.getByTestId('field-ata')).toHaveValue('31.00');
    await expect(page.getByTestId('design-name')).toHaveText('bow');
    await expect(page.getByTestId('design-marker')).toHaveText('(not saved)');
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1);
  });

  test('a file that is not a project changes nothing', async ({ page }) => {
    for (const [name, text, message] of [
      ['plate.json', '  0\r\nSECTION', 'Could not open plate.json: The project data is not valid JSON'],
      ['new.json', '{"schemaVersion":9}', 'Could not open new.json: The project was saved by a newer version'],
      ['empty.json', '', 'Could not open empty.json: The file is empty'],
    ]) {
      await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
      await expect(page.getByTestId('file-status')).toContainText(message);
      await expect(page.getByTestId('design-name')).toHaveText('Untitled');
    }
    await page.getByTestId('file-input').setInputFiles({ name: 'part.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1}') });
    await expect(page.getByTestId('file-status')).toHaveText('Opened part.json. Missing values in part.json were set to their defaults');
  });

  test('a solve still running for the previous design does not come back after Open', async ({ page }) => {
    await expect(page.locator('#app')).toHaveAttribute('data-solve-resolution', 'full', { timeout: 30_000 });
    // A design that never meets every check: 150° of lead-in wrap.
    const state = defaultState();
    state.body.leadInWrap = (150 * Math.PI) / 180;
    // Start a full solve of changed inputs, then open the file at once.
    await changeAta(page, '34');
    await page.getByTestId('file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
    await page.getByTestId('dialog-yes').click();
    await expect(page.getByTestId('design-name')).toHaveText('bad');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'infeasible', { timeout: 30_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-solve-state', /ok|idle/);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('export-status')).toHaveText(/^No cam meets every check yet/);
    await expect(page.getByTestId('export-zip')).toHaveAttribute('aria-disabled', 'true');
  });

  test('a sample opens as an unsaved design and solves', async ({ page }) => {
    await menu(page, 'sample');
    await page.getByTestId('sample-crossbow').click();
    await expect(page.getByTestId('design-name')).toHaveText('Crossbow (169 lbf)');
    await expect(page.getByTestId('design-marker')).toHaveText('(not saved)');
    await expect(page.getByTestId('field-ata')).toHaveValue('16.00');
    // The export panel waits for a cam of the opened design.
    await expect(page.getByTestId('export-status')).not.toContainText('later edits');
    await expect(page.locator('#app')).toHaveAttribute('data-solve-state', 'ok', { timeout: 30_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-solve-resolution', 'full', { timeout: 30_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-solve-status', 'ok');
    await expect(page.getByTestId('export-status')).toHaveText(/^Exports the current cam/);
    // Another sample without changes opens without a question.
    await menu(page, 'sample');
    await page.getByTestId('sample-mini').click();
    await expect(page.getByTestId('design-name')).toHaveText('Mini bow for FDM printing');
  });

  test('Escape closes the menu and returns focus to the File button', async ({ page }) => {
    await page.getByTestId('file-menu').click();
    await expect(page.getByTestId('file-save')).toBeFocused();
    await expect(page.getByTestId('file-menu')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('file-panel')).toBeHidden();
    await expect(page.getByTestId('file-menu')).toBeFocused();
    await expect(page.getByTestId('file-menu')).toHaveAttribute('aria-expanded', 'false');
  });

  test('two pages share the library', async ({ page, context }) => {
    const other = await context.newPage();
    await other.goto('./');
    await saveAs(page, 'Shared');
    await other.getByTestId('file-menu').click();
    await other.getByTestId('file-open').click();
    await expect(other.getByRole('button', { name: 'Open Shared' })).toBeVisible();
    await other.close();
  });

  test('the menu fits a 320 px wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByTestId('file-menu').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const id of ['file-menu', 'file-save', 'file-open', 'file-from-file']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('File menu storage failures', () => {
  test('autosave writes the inputs and their design together or not at all', async ({ page }) => {
    await page.goto('./');
    await saveAs(page, 'Bow A');
    const before = await page.evaluate(() => localStorage.getItem('compoundCamCalc.project'));
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'compoundCamCalc.current') throw new DOMException('full', 'QuotaExceededError');
        set.call(this, key, value);
      };
    });
    await changeAta(page, '35');
    await expect(page.locator('#app')).toHaveAttribute('data-autosave', 'error');
    expect(await page.evaluate(() => localStorage.getItem('compoundCamCalc.project'))).toBe(before);
  });

  test('a save that storage refuses turns Save off', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'compoundCamCalc.designs') throw new DOMException('full', 'QuotaExceededError');
        set.call(this, key, value);
      };
    });
    await menu(page, 'save-as');
    await page.getByTestId('dialog-name').fill('Bow A');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('file-status')).toContainText('not saved');
    await page.getByTestId('file-menu').click();
    await expect(page.getByTestId('file-save')).toBeDisabled();
    await expect(page.getByTestId('file-note')).toContainText('storage is full');
  });

  test('Open asks again when another tab deletes the open design meanwhile', async ({ page, context }) => {
    await page.goto('./');
    await saveAs(page, 'Bow A');
    await changeAta(page, '34');
    await saveAs(page, 'Bow B');
    await menu(page, 'open');
    const other = await context.newPage();
    await other.goto('./');
    await other.getByTestId('file-menu').click();
    await other.getByTestId('file-open').click();
    await other.getByRole('button', { name: 'Delete Bow B' }).click();
    await other.getByTestId('dialog-yes').click();
    // The delete runs under a lock: wait for it before the page closes.
    await expect(other.locator('dialog').filter({ has: other.getByTestId('design-list') }).getByTestId('dialog-status')).toHaveText('Deleted "Bow B"');
    await other.close();
    await expect(page.getByTestId('design-marker')).toHaveText('(not saved)');
    await page.getByRole('button', { name: 'Open Bow A' }).click();
    await expect(page.getByTestId('file-dialog').last()).toContainText('"Bow B" is not saved. Discard them?');
  });
});

test.describe('File menu with two tabs', () => {
  /**
   * Delete a design in a second page of the same browser and wait for it.
   * @param {import('@playwright/test').BrowserContext} context
   * @param {string} name
   */
  async function deleteElsewhere(context, name) {
    const other = await context.newPage();
    await other.goto('./');
    await other.getByTestId('file-menu').click();
    await other.getByTestId('file-open').click();
    const dialog = other.getByTestId('file-dialog').last();
    if (await dialog.getByTestId('dialog-yes').isVisible()) await dialog.getByTestId('dialog-yes').click();
    await other.getByRole('button', { name: `Delete ${name}` }).click();
    await other.getByTestId('dialog-yes').click();
    await expect(other.locator('dialog').filter({ has: other.getByTestId('design-list') }).getByTestId('dialog-status')).toHaveText(`Deleted "${name}"`);
    await other.close();
  }

  test('Rename with Replace does nothing when the renamed design is gone meanwhile', async ({ page, context }) => {
    await page.goto('./');
    await saveAs(page, 'Bow A');
    await changeAta(page, '34');
    await saveAs(page, 'Bow B');
    await menu(page, 'open');
    await page.getByRole('button', { name: 'Rename Bow A' }).click();
    await page.getByTestId('dialog-name').fill('Bow B');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('dialog-replace')).toBeVisible();
    await deleteElsewhere(context, 'Bow A');
    await page.getByTestId('dialog-replace').click();
    const openDialog = page.locator('dialog').filter({ has: page.getByTestId('design-list') });
    await expect(openDialog.getByTestId('dialog-status')).toHaveText('"Bow A" was not renamed: another tab changed the designs. Try again.');
    await expect(openDialog.getByRole('button', { name: 'Open Bow B' })).toBeVisible();
  });

  test('Save as with Replace does nothing when another tab renames the replaced design meanwhile', async ({ page }) => {
    await page.goto('./');
    await saveAs(page, 'Bow A');
    await changeAta(page, '34');
    await saveAs(page, 'Bow B');
    await menu(page, 'save-as');
    await page.getByTestId('dialog-name').fill('Bow A');
    await page.getByTestId('dialog-ok').click();
    await expect(page.getByTestId('dialog-replace')).toBeVisible();
    // Another tab renames "Bow A" after the dialog closes and before this tab holds the lock.
    await page.evaluate(() => {
      const request = navigator.locks.request.bind(navigator.locks);
      /** @type {any} */ (navigator.locks).request = (/** @type {string} */ name, /** @type {() => unknown} */ run) => {
        const lib = JSON.parse(localStorage.getItem('compoundCamCalc.designs') ?? '{}');
        for (const d of lib.designs) if (d.name === 'Bow A') d.name = 'Bow C';
        localStorage.setItem('compoundCamCalc.designs', JSON.stringify(lib));
        return request(name, run);
      };
    });
    await page.getByTestId('dialog-replace').click();
    await expect(page.getByTestId('file-status')).toHaveText('"Bow A" was not saved: another tab changed the designs. Try again.');
    await expect(page.getByTestId('design-name')).toHaveText('Bow B');
    const designs = await page.evaluate(() => JSON.parse(localStorage.getItem('compoundCamCalc.designs') ?? '{}').designs);
    const c = designs.find((/** @type {{ name: string }} */ d) => d.name === 'Bow C');
    expect(c.state.geometry.ata).not.toBe(designs.find((/** @type {{ name: string }} */ d) => d.name === 'Bow B').state.geometry.ata);
  });

  test('Open sample asks again when another tab deletes the open design meanwhile', async ({ page, context }) => {
    await page.goto('./');
    await saveAs(page, 'Bow A');
    await menu(page, 'sample');
    await deleteElsewhere(context, 'Bow A');
    await expect(page.getByTestId('design-marker')).toHaveText('(not saved)');
    await page.getByTestId('sample-crossbow').click();
    await expect(page.getByTestId('file-dialog').last()).toContainText('"Bow A" is not saved. Discard them?');
  });
});

test.describe('File menu with full storage', () => {
  test('keeps Open for deleting designs and turns Save off', async ({ page }) => {
    await page.goto('./');
    await saveAs(page, 'Bow A');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });
    await page.getByTestId('file-menu').click();
    await expect(page.getByTestId('file-save')).toBeDisabled();
    await expect(page.getByTestId('file-open')).toBeEnabled();
    await expect(page.getByTestId('file-note')).toContainText('storage is full');
  });
});

test.describe('File menu with blocked storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Storage.prototype.getItem = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
    });
    await page.goto('./');
  });

  test('turns the library actions off and keeps Save to file', async ({ page }) => {
    await page.getByTestId('file-menu').click();
    await expect(page.getByTestId('file-save')).toBeDisabled();
    await expect(page.getByTestId('file-open')).toBeDisabled();
    await expect(page.getByTestId('file-note')).toContainText('blocks storage');
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('file-to-file').click()]);
    expect(file.suggestedFilename()).toBe('Untitled.json');
  });
});
