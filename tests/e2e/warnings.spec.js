import { expect, test } from '@playwright/test';
import { sampleState } from '../../src/state/samples.js';
import { toJSON } from '../../src/state/schema.js';

test('an oversized cam shows plausibility warnings in the results', async ({ page }) => {
  // The mini bow with 30 mm of limb travel: a cam about 524 mm across on a
  // 254 mm axle-to-axle length.
  const state = sampleState('mini');
  state.limb = { ...state.limb, mode: 'travel', travel: 0.03 };
  await page.goto('./');
  await page.evaluate((text) => localStorage.setItem('compoundCamCalc.project', text), toJSON(state));
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-solve-state', 'ok', { timeout: 30_000 });
  const warnings = page.getByTestId('results-warnings');
  await expect(warnings.getByTestId('warn-cam-size')).toContainText('of the 254.0 mm axle-to-axle length; this app warns above 35 %');
  await expect(warnings.getByTestId('warn-cam-overlap')).toContainText('The two cams overlap');
  await expect(page.getByTestId('results-status')).toContainText('; 2 warnings');
});

test('a sample design shows no warnings', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-solve-state', 'ok', { timeout: 30_000 });
  await expect(page.getByTestId('results-warnings')).toBeHidden();
  await expect(page.getByTestId('results-status')).not.toContainText('warning');
});
