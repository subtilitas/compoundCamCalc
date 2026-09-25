import { beforeAll, describe, expect, it } from 'vitest';
import { createLayout } from '../../src/core/layout.js';
import { solve } from '../../src/core/solve.js';
import { AMO_OFFSET, INCH, LBF } from '../../src/core/units.js';
import { CSV_LABELS, formatFixed, writeCsv } from '../../src/export/csv.js';
import { defaultState } from '../../src/state/presets.js';

const HEADER_IN_N = 'Draw length AMO (in),Nock to pivot point (in),Target force (N),Draw force (N),'
  + 'Cam rotation from brace (deg),Limb rotation (deg),String tension (N),Tension of each cable (N),'
  + 'Load on each limb tip (N)';

/** @type {import('../../src/core/solve.js').SolveResult} */
let result;
/** @type {import('../../src/core/layout.js').LayoutContext} */
let layout;
const state = defaultState();

beforeAll(() => {
  result = solve(state, { resolution: 'full' });
  const r = createLayout(result, state.geometry);
  if (!r.layout) throw new Error(String(r.error));
  layout = r.layout;
});

/**
 * @param {{ draw: 'in' | 'mm' | 'cm', force: 'N' | 'lbf' }} units
 * @param {any} [labels]
 */
function table(units, labels) {
  const r = writeCsv(result, layout, /** @type {any} */ (units), labels);
  expect(r.error).toBeNull();
  const text = /** @type {string} */ (r.text);
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  expect(text).toMatch(/^[\x20-\x7e\r\n]*$/);
  expect(text.split('\r\n').slice(1).join('')).toMatch(/^[-\d.,]*$/);
  const lines = text.slice(0, -2).split('\r\n');
  return { header: lines[0], rows: lines.slice(1).map((l) => l.split(',')) };
}

describe('writeCsv on the default preset', () => {
  it('writes the header and one row per solved sample in inches and newtons', () => {
    const { header, rows } = table({ draw: 'in', force: 'N' });
    expect(header).toBe(HEADER_IN_N);
    expect(layout.valid).toBe(1500);
    expect(rows.length).toBe(layout.valid);
    for (const row of rows) expect(row.length).toBe(9);
    expect(rows[0][0]).toBe('8.25000');
    expect(rows[0][1]).toBe('6.50000');
    expect(rows[0][4]).toBe('0.00000');
    expect(rows.at(-1)?.[0]).toBe('29.00000');
    expect(rows.at(-1)?.[1]).toBe((29 - 1.75).toFixed(5));
    const a = /** @type {NonNullable<typeof result.achieved>} */ (result.achieved);
    const i = 700;
    expect(Number(rows[i][0])).toBeCloseTo((a.x[i] + AMO_OFFSET) / INCH, 5);
    expect(Number(rows[i][2])).toBeCloseTo(/** @type {any} */ (result.target).F[i], 4);
    expect(Number(rows[i][3])).toBeCloseTo(a.F[i], 4);
    expect(Number(rows[i][4])).toBeCloseTo((a.theta[i] - a.theta[0]) * 180 / Math.PI, 5);
    expect(Number(rows[i][5])).toBeCloseTo(a.alpha[i] * 180 / Math.PI, 5);
    expect(Number(rows[i][6])).toBeCloseTo(a.Ts[i], 4);
    expect(Number(rows[i][7])).toBeCloseTo(a.Tc[i], 4);
    expect(Number(rows[i][8])).toBeCloseTo(layout.loads.axleLoad[i], 4);
    for (const row of rows) {
      for (const [k, cell] of row.entries()) {
        const decimals = k < 2 ? 5 : k === 4 || k === 5 ? 5 : 4;
        expect(cell).toMatch(new RegExp(`^-?\\d+\\.\\d{${decimals}}$`));
      }
    }
  });

  it('switches to millimetres and pound-force consistently', () => {
    const base = table({ draw: 'in', force: 'N' });
    const { header, rows } = table({ draw: 'mm', force: 'lbf' });
    expect(header).toBe(HEADER_IN_N.replace(/\(in\)/g, '(mm)').replace(/\(N\)/g, '(lbf)'));
    expect(rows.length).toBe(base.rows.length);
    expect(rows[0][0]).toBe('209.550');
    expect(rows.at(-1)?.[0]).toBe('736.600');
    for (const i of [0, 400, 1499]) {
      expect(Number(rows[i][1])).toBeCloseTo(Number(base.rows[i][1]) * 25.4, 2);
      for (const k of [2, 3, 6, 7, 8]) {
        expect(rows[i][k]).toMatch(/^\d+\.\d{4}$/);
        expect(Number(rows[i][k])).toBeCloseTo(Number(base.rows[i][k]) / LBF, 3);
      }
      expect(rows[i][4]).toBe(base.rows[i][4]);
    }
    const cm = table({ draw: 'cm', force: 'N' });
    expect(cm.rows[0][0]).toBe('20.9550');
  });

  it('replaces labels and quotes header cells with a comma or quote', () => {
    const { header } = table({ draw: 'in', force: 'N' }, { drawForce: 'Force "F"', limbTipLoad: 'Tip' });
    expect(header).toContain(',"Force ""F"" (N)",');
    expect(header.endsWith(',Tip (N)')).toBe(true);
    expect(Object.keys(CSV_LABELS).length).toBe(9);
  });

  it('leaves the target cells empty when the target grid differs', () => {
    const noTarget = writeCsv({ ...result, target: null }, layout, { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' });
    const row = /** @type {string} */ (noTarget.text).split('\r\n')[1].split(',');
    expect(row[2]).toBe('');
    const short = /** @type {any} */ ({ ...result, target: { x: new Float64Array(3), F: new Float64Array(3) } });
    expect(/** @type {string} */ (writeCsv(short, layout, state.units).text).split('\r\n')[5].split(',')[2]).toBe('');
  });

  it('writes empty cells for non-finite values and no exponent for large ones', () => {
    const a = /** @type {any} */ (result.achieved);
    const F = Float64Array.from(a.F);
    F[1] = NaN;
    F[2] = 1e25;
    F[3] = -1e-12;
    const r = writeCsv(/** @type {any} */ ({ ...result, achieved: { ...a, F } }), layout, state.units);
    const lines = /** @type {string} */ (r.text).split('\r\n');
    expect(lines[2].split(',')[3]).toBe('');
    expect(lines[3].split(',')[3]).toBe('');
    expect(lines[4].split(',')[3]).toBe('0.0000');
  });

  it('rejects malformed input with an error', () => {
    const u = state.units;
    /** @type {any[]} */
    const bad = [
      [result, layout, null],
      [result, layout, { draw: 'ft', force: 'N' }],
      [result, layout, { draw: 'in', force: 'kgf' }],
      [{ ...result, achieved: null }, layout, u],
      [result, { ...layout, valid: 0 }, u],
      [result, { ...layout, valid: 1.5 }, u],
      [result, { ...layout, valid: 5000 }, u],
      [{ ...result, achieved: { ...result.achieved, Tc: undefined } }, layout, u],
      [result, { ...layout, loads: null }, u],
      [result, layout, u, null],
      [result, layout, u, 'labels'],
      [result, layout, u, { unknown: 'x' }],
      [result, layout, u, { drawForce: 'Kraft ä' }],
      [result, layout, u, { drawForce: 5 }],
    ];
    for (const args of bad) {
      const r = /** @type {any} */ (writeCsv)(...args);
      expect(r.text).toBeNull();
      expect(typeof r.error).toBe('string');
    }
  });
});

describe('formatFixed', () => {
  it('drops the sign of negative zero and never writes an exponent', () => {
    expect(formatFixed(-0, 3)).toBe('0.000');
    expect(formatFixed(-0.00001, 4)).toBe('0.0000');
    expect(formatFixed(-1.5, 2)).toBe('-1.50');
    expect(formatFixed(1e-12, 5)).toBe('0.00000');
    expect(formatFixed(1e21, 2)).toBe('');
    expect(formatFixed(Infinity, 2)).toBe('');
    expect(formatFixed(NaN, 2)).toBe('');
  });
});
