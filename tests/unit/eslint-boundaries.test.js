import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

/**
 * @param {string} code
 * @param {string} filePath
 */
async function ruleIds(code, filePath) {
  return (await messages(code, filePath)).map((m) => m.ruleId);
}

/**
 * @param {string} code
 * @param {string} filePath
 */
async function messages(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

describe('module boundaries', () => {
  for (const dir of ['src/core', 'src/state', 'src/export']) {
    it(`${dir} rejects browser globals`, async () => {
      const code = [
        'export const a = sessionStorage;',
        'export const b = getComputedStyle;',
        'export const c = requestAnimationFrame;',
        'export const d = window;',
        'export const e = self;',
      ].join('\n');
      const flagged = new Set(
        (await messages(code, `${dir}/probe.js`))
          .filter((m) => m.ruleId === 'no-undef' || m.ruleId === 'no-restricted-globals')
          .map((m) => m.line),
      );
      expect([...flagged].sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it(`${dir} rejects static and dynamic UI imports`, async () => {
      const code = "import '../ui/editor.js';\nexport const m = import('../worker/solver.js');\n";
      const ids = await ruleIds(code, `${dir}/probe.js`);
      expect(ids).toContain('no-restricted-imports');
      expect(ids).toContain('no-restricted-syntax');
    });
  }

  it('src/ui may use browser globals', async () => {
    const ids = await ruleIds('export const a = window.localStorage;\n', 'src/ui/probe.js');
    expect(ids).toEqual([]);
  });
});
