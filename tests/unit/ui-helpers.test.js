import { describe, expect, it } from 'vitest';
import { generateCurve, pointMetrics } from '../../src/core/curve.js';
import { INCH, toSI } from '../../src/core/units.js';
import { chipText, meetsEveryCheck, solveView } from '../../src/ui/app.js';
import { moveLimitMessage, niceStep, ticks } from '../../src/ui/chart.js';
import { amo, drawText, fixed, forceText, inward, lengthLabel, metricsOf, plain, pointLabel } from '../../src/ui/display.js';

/** @type {import('../../src/state/schema.js').Units} */
const inches = { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {import('../../src/state/schema.js').Units} */
const metric = { ...inches, draw: 'mm', force: 'lbf' };

describe('chart ticks', () => {
  it('picks the nearest round step', () => {
    expect(niceStep(1.02)).toBe(1);
    expect(niceStep(2.4)).toBe(2);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(8)).toBe(10);
    expect(niceStep(102)).toBe(100);
    expect(niceStep(0.3)).toBeCloseTo(0.2, 15);
  });

  it('lists round values inside the range with matching decimals', () => {
    expect(ticks(8.25, 29, 4)).toEqual({ values: [10, 15, 20, 25], step: 5, decimals: 0 });
    const t = ticks(0, 1.1, 4);
    expect(t.step).toBeCloseTo(0.2, 15);
    expect(t.decimals).toBe(1);
    expect(t.values).toHaveLength(6);
  });
});

describe('display', () => {
  it('shows AMO draw length of a nock position', () => {
    expect(amo(27.25 * INCH, inches)).toBeCloseTo(29, 12);
    expect(drawText(27.25 * INCH, inches)).toBe('29.00');
    expect(drawText(27.25 * INCH, metric)).toBe('736.6');
  });

  it('formats forces, lengths and point labels', () => {
    expect(forceText(267, inches)).toBe('267.0');
    expect(forceText(267, metric)).toBe('60.0');
    expect(lengthLabel(1.25 * INCH, inches)).toBe('1.25 in');
    expect(pointLabel({ x: 22.25 * INCH, F: 251.2 }, inches)).toBe('24.0 in, 251 N');
    expect(fixed(-0.001, 1)).toBe('0.0');
  });
});

describe('range bounds and messages', () => {
  it('rounds bounds inwards so that the printed value is inside the range', () => {
    const lo = 50 / 4.4482216152605;
    const hi = 900 / 4.4482216152605;
    expect(inward(lo, 1, 1)).toBe('11.3');
    expect(inward(hi, 1, -1)).toBe('202.3');
    expect(toSI(Number(inward(lo, 1, 1)), 'force', 'lbf')).toBeGreaterThanOrEqual(50);
    expect(toSI(Number(inward(hi, 1, -1)), 'force', 'lbf')).toBeLessThanOrEqual(900);
    expect(inward(863.6, 1, -1)).toBe('863.6');
    expect(inward(508, 1, 1)).toBe('508.0');
    expect(plain(508.0)).toBe('508');
    expect(plain(0.0254 * 100, 3)).toBe('2.54');
  });

  it('names the limit of a refused arrow-key move', () => {
    expect(moveLimitMessage(6, 6, 'ArrowRight', inches)).toBe('The full-draw point moves only up and down');
    expect(moveLimitMessage(5, 6, 'ArrowRight', inches)).toBe('Point 6 stays at least 0.1 in from point 7');
    expect(moveLimitMessage(5, 6, 'ArrowLeft', metric)).toBe('Point 6 stays at least 2.54 mm from point 5');
    expect(moveLimitMessage(2, 6, 'ArrowUp', inches)).toBe('Forces stay between 1 N and 5000 N');
    expect(moveLimitMessage(2, 6, 'ArrowDown', metric)).toBe('Forces stay between 0.2248 lbf and 1124 lbf');
  });

  it('computes the metrics of a points array once', () => {
    const points = generateCurve({ xBrace: 6.5 * INCH, xFull: 27.25 * INCH, peak: 267, letOff: 0.8 });
    const m = metricsOf(points);
    expect(metricsOf(points)).toBe(m);
    expect(m).toEqual(pointMetrics(points));
    expect(metricsOf(points.slice())).not.toBe(m);
  });
});

describe('solve status link', () => {
  it('names the state and the number of problems', () => {
    expect(chipText('busy', 0)).toBe('Cam: solving…');
    expect(chipText('ok', 0)).toBe('Cam: meets every check');
    expect(chipText('infeasible', 1)).toBe('Cam: 1 problem, see Results');
    expect(chipText('infeasible', 3)).toBe('Cam: 3 problems, see Results');
    expect(chipText('no-convergence', 1)).toBe('Cam: the solver did not converge, see Results');
    expect(chipText('error', 0)).toBe('Cam: the solver stopped with an error');
  });
});

describe('solve view selection', () => {
  /**
   * @param {'ok' | 'infeasible' | 'no-convergence'} status
   * @param {boolean} [achieved]
   */
  const solved = (status, achieved = true) => ({
    result: /** @type {import('../../src/core/solve.js').SolveResult} */ (/** @type {unknown} */ ({
      status,
      achieved: achieved ? { x: new Float64Array(2), F: new Float64Array(2) } : null,
    })),
    state: status,
  });

  it('shows the current result when it meets every check', () => {
    const good = solved('ok');
    expect(solveView(good, good, 'idle')).toEqual({ current: good, stale: false, outdated: false, status: 'ok', shown: good, withCurve: good });
    expect(solveView(null, null, 'idle')).toEqual({ current: null, stale: false, outdated: false, status: 'idle', shown: null, withCurve: null });
  });

  it('keeps the last valid cam in view for a failing result', () => {
    const good = solved('ok');
    const bad = solved('infeasible');
    expect(solveView(bad, good, 'idle')).toEqual({ current: bad, stale: true, outdated: false, status: 'infeasible', shown: good, withCurve: bad });
    const noCurve = solved('no-convergence', false);
    expect(solveView(noCurve, good, 'busy')).toMatchObject({ current: noCurve, stale: true, status: 'busy', shown: good, withCurve: good });
    expect(solveView(bad, null, 'idle')).toMatchObject({ stale: false, shown: bad });
  });

  it('drops the older result after a solver error', () => {
    const good = solved('ok');
    const bad = solved('infeasible');
    expect(solveView(good, good, 'error')).toEqual({ current: null, stale: true, outdated: false, status: 'error', shown: good, withCurve: good });
    expect(solveView(bad, good, 'error')).toEqual({ current: null, stale: true, outdated: false, status: 'error', shown: good, withCurve: good });
    expect(solveView(bad, null, 'error')).toEqual({ current: null, stale: false, outdated: false, status: 'error', shown: null, withCurve: null });
  });
});

describe('outdated results', () => {
  it('marks the current result outdated only while a solve has run for a while', () => {
    const good = { result: /** @type {any} */ ({ status: 'ok', achieved: null }), state: 1 };
    expect(solveView(good, good, 'busy', true)).toMatchObject({ outdated: true, stale: false, shown: good, status: 'busy' });
    expect(solveView(good, good, 'busy', false).outdated).toBe(false);
    expect(solveView(good, good, 'idle', true).outdated).toBe(false);
    expect(solveView(null, null, 'busy', true).outdated).toBe(false);
  });
});

describe('last cam that met every check', () => {
  it('takes only full solves without problems', () => {
    /** @param {string} status @param {string} resolution */
    const r = (status, resolution) => /** @type {import('../../src/core/solve.js').SolveResult} */ (/** @type {unknown} */ ({ status, resolution }));
    expect(meetsEveryCheck(r('ok', 'full'))).toBe(true);
    expect(meetsEveryCheck(r('ok', 'coarse'))).toBe(false);
    expect(meetsEveryCheck(r('infeasible', 'full'))).toBe(false);
  });
});
