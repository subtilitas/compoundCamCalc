import { describe, expect, it } from 'vitest';
import { FT_LBF, INCH, LBF } from '../../src/core/units.js';
import {
  METRIC_KEYS, STALE_CAPTION, diagnosticItems, fitTolerance, metricItems, statusText,
} from '../../src/ui/results.js';

/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../../src/state/schema.js').Units} Units */

/** @type {Units} */
const si = { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {Units} */
const imperial = { draw: 'in', force: 'lbf', dims: 'in', energy: 'ft·lbf', stiffness: 'lbf/in' };

/**
 * A result with round metrics; only the fields the results card reads.
 * @param {Partial<SolveResult>} [over]
 * @returns {SolveResult}
 */
function fake(over = {}) {
  const r = {
    status: 'ok',
    diagnostics: [],
    target: { x: new Float64Array([0.1, 0.2, 0.3]), F: new Float64Array([100, 300, 120]) },
    fit: {
      used: false, reason: '', rms: 0, maxDeviation: 0, peakDifference: 0, letOffDifference: 0,
      energyDifference: 0, maxForceDifference: 0, withinTolerance: true, idealIssues: [], pointsMatched: 0,
    },
    metrics: {
      peak: 10 * LBF,
      holding: 2 * LBF,
      letOff: 0.8,
      drawEnergy: 5 * FT_LBF,
      limbEnergy: 80,
      axleTravel: 0.0254,
      rotation: Math.PI,
      limbRotation: 0.1,
      stringLength: 2 * INCH,
      cableLength: 0.9876,
      camMaxDimension: 0.1,
      stringMinRho: 0.005,
      stringRhoLimit: 0.005,
      cableMinRho: 0.0042,
      cableRhoLimit: 0.005,
      stringWrap: 1,
      cableWrap: 2,
    },
    ...over,
  };
  return /** @type {SolveResult} */ (/** @type {unknown} */ (r));
}

/** @param {{ key: string, text: string }[]} items */
const byKey = (items) => Object.fromEntries(items.map((i) => [i.key, i.text]));

describe('statusText', () => {
  it('names each status', () => {
    expect(statusText('idle', 0, false)).toBe('');
    expect(statusText('busy', 0, false)).toBe('Solving…');
    expect(statusText('ok', 0, false)).toBe('The cam meets the target and every check');
    expect(statusText('infeasible', 1, false)).toBe('The cam does not meet every check: 1 problem');
    expect(statusText('infeasible', 3, false)).toBe('The cam does not meet every check: 3 problems');
    expect(statusText('no-convergence', 1, false)).toBe('The solver did not converge');
    expect(statusText('error', 0, false)).toBe('The solver stopped with an error; change an input to try again');
    expect(statusText('preview', 0, false)).toMatch(/^Preview from 100 samples without problems/);
  });

  it('adds the stale sentence', () => {
    expect(statusText('infeasible', 2, true))
      .toBe('The cam does not meet every check: 2 problems. The cam shown is the last one that met every check.');
    expect(statusText('busy', 0, true)).toBe('Solving… The cam shown is the last one that met every check.');
    expect(statusText('idle', 0, true)).toBe('The cam shown is the last one that met every check.');
  });
});

describe('STALE_CAPTION', () => {
  it('says which cam the values belong to', () => {
    expect(STALE_CAPTION).toBe('These values belong to the latest attempt, which fails the checks; '
      + 'the cam view shows the last cam that met every check.');
  });
});

describe('metricItems', () => {
  it('formats metrics in N, mm and J', () => {
    const t = byKey(metricItems(fake(), si));
    expect(t.peak).toBe('44.5 N');
    expect(t.holding).toBe('8.9 N');
    expect(t.letOff).toBe('80.0 %');
    expect(t.drawEnergy).toBe('6.8 J');
    expect(t.limbEnergy).toBe('80.0 J');
    expect(t.axleTravel).toBe('25.4 mm');
    expect(t.rotation).toBe('180.0°');
    expect(t.stringLength).toBe('50.8 mm');
    expect(t.cableLength).toBe('987.6 mm');
    expect(t.camMaxDimension).toBe('100.0 mm');
    expect(t.stringRho).toBe('5.0 mm, limit 5.0 mm');
    expect(t.cableRho).toBe('4.2 mm, limit 5.0 mm');
    expect(t.fit).toBeUndefined();
  });

  it('switches to lbf, in and ft·lbf', () => {
    const t = byKey(metricItems(fake(), imperial));
    expect(t.peak).toBe('10.0 lbf');
    expect(t.holding).toBe('2.0 lbf');
    expect(t.drawEnergy).toBe('5.0 ft·lbf');
    expect(t.axleTravel).toBe('1.000 in');
    expect(t.stringLength).toBe('2.000 in');
    expect(t.stringRho).toBe('0.197 in, limit 0.197 in');
    expect(t.rotation).toBe('180.0°');
  });

  it('shows a dash for every value without metrics', () => {
    const items = metricItems(fake({ metrics: null }), si);
    expect(items.length).toBeGreaterThan(10);
    expect(items.every((i) => i.text === '—')).toBe(true);
    expect(metricItems(null, si).every((i) => i.text === '—')).toBe(true);
  });

  it('lists the metrics in order and shows a dash for a value that is not finite', () => {
    const r = fake();
    expect(metricItems(r, si).map((i) => i.key)).toEqual([...METRIC_KEYS]);
    expect(METRIC_KEYS).toEqual([
      'peak', 'holding', 'letOff', 'drawEnergy', 'limbEnergy', 'axleTravel', 'rotation',
      'stringLength', 'cableLength', 'camMaxDimension', 'stringRho', 'cableRho',
    ]);
    if (!r.metrics) throw new Error('metrics missing');
    r.metrics.letOff = NaN;
    r.metrics.cableMinRho = Infinity;
    const t = byKey(metricItems(r, si));
    expect(t.letOff).toBe('—');
    expect(t.cableRho).toBe('—, limit 5.0 mm');
  });

  it('leaves out the fit summary without metrics', () => {
    const r = fake({ metrics: null });
    r.fit.used = true;
    expect(byKey(metricItems(r, si)).fit).toBeUndefined();
  });

  it('adds the fit summary when the cable track is fitted', () => {
    const r = fake();
    r.fit.used = true;
    r.fit.maxForceDifference = 3.84;
    expect(fitTolerance(r)).toBeCloseTo(9, 12);
    const item = metricItems(r, si).find((i) => i.key === 'fit');
    expect(item?.text).toBe('Largest force difference 3.8 N, within the tolerance of 9.0 N');
    expect(item?.warn).toBe(false);
    expect(byKey(metricItems(r, imperial)).fit)
      .toBe('Largest force difference 0.9 lbf, within the tolerance of 2.0 lbf');
  });

  it('marks a fitted cable track outside the tolerance', () => {
    const r = fake();
    r.fit.used = true;
    r.fit.maxForceDifference = 25;
    r.fit.withinTolerance = false;
    const item = metricItems(r, si).find((i) => i.key === 'fit');
    expect(item?.text).toBe('Largest force difference 25.0 N, more than the tolerance of 9.0 N');
    expect(item?.warn).toBe(true);
    expect(metricItems(r, si).filter((i) => i.key !== 'fit').every((i) => !i.warn)).toBe(true);
  });

  it('names the draw energy when only the energy misses its tolerance', () => {
    const r = fake();
    r.fit.used = true;
    r.fit.maxForceDifference = 3.84;
    r.fit.withinTolerance = false;
    const item = metricItems(r, si).find((i) => i.key === 'fit');
    expect(item?.text).toBe('Largest force difference 3.8 N, within the tolerance of 9.0 N; the draw energy differs by more than 0.5 %');
    expect(item?.warn).toBe(true);
  });

  it('uses the force floor for a low target', () => {
    const r = fake({ target: { x: new Float64Array([0.1]), F: new Float64Array([10]) } });
    expect(fitTolerance(r)).toBe(2);
    expect(fitTolerance(fake({ target: null }))).toBeNaN();
  });
});

describe('diagnosticItems', () => {
  it('keeps the order and fields', () => {
    const r = fake({
      diagnostics: [
        { code: 'cable-radius', xRange: null, psiRange: [0, 1], message: 'Cable bends too tight', suggestion: 'Lower the peak' },
        { code: 'limb-rotation', xRange: [0.1, 0.2], psiRange: null, message: 'Limb turns too far', suggestion: 'Raise the preload' },
      ],
    });
    expect(diagnosticItems(r)).toEqual([
      { code: 'cable-radius', message: 'Cable bends too tight', suggestion: 'Lower the peak' },
      { code: 'limb-rotation', message: 'Limb turns too far', suggestion: 'Raise the preload' },
    ]);
    expect(diagnosticItems(null)).toEqual([]);
  });
});
