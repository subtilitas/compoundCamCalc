import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RANGE_TOLERANCE, buildCurveData, createCurve, fromCurveData, pchipSlopes, quarticRangeOnUnit, toCurveData,
} from '../../src/core/interp.js';

/** @typedef {import('../../src/core/interp.js').CurvePoint} CurvePoint */
/** @typedef {import('../../src/core/interp.js').Curve} Curve */

/**
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {CurvePoint[]}
 */
const pts = (xs, ys) => xs.map((x, i) => ({ x, F: ys[i] }));

const forceCurve = pts([0.1651, 0.19, 0.24, 0.3, 0.45, 0.6, 0.6921], [0, 180, 250, 267, 200, 60, 53]);

/**
 * Value and scaled derivatives of interval k at local t from the coefficients.
 * @param {Curve} curve
 * @param {number} k
 * @param {number} t
 */
function local(curve, k, t) {
  const c = curve.coeffs.subarray(6 * k, 6 * k + 6);
  const h = curve.knots[k + 1] - curve.knots[k];
  const f0 = c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5]))));
  const f1 = (c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5])))) / h;
  const f2 = (2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5]))) / (h * h);
  return [f0, f1, f2];
}

/**
 * Adaptive Simpson quadrature.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {number} tol
 */
function simpson(f, a, b, tol) {
  /**
   * @param {number} lo
   * @param {number} hi
   * @param {number} flo
   * @param {number} fmid
   * @param {number} fhi
   * @param {number} whole
   * @param {number} eps
   * @param {number} depth
   * @returns {number}
   */
  function step(lo, hi, flo, fmid, fhi, whole, eps, depth) {
    const mid = 0.5 * (lo + hi);
    const lm = 0.5 * (lo + mid);
    const rm = 0.5 * (mid + hi);
    const flm = f(lm);
    const frm = f(rm);
    const left = ((mid - lo) / 6) * (flo + 4 * flm + fmid);
    const right = ((hi - mid) / 6) * (fmid + 4 * frm + fhi);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return step(lo, mid, flo, flm, fmid, left, eps / 2, depth - 1) + step(mid, hi, fmid, frm, fhi, right, eps / 2, depth - 1);
  }
  const fa = f(a);
  const fb = f(b);
  const fm = f(0.5 * (a + b));
  return step(a, b, fa, fm, fb, ((b - a) / 6) * (fa + 4 * fm + fb), tol, 50);
}

/**
 * Worst violation of monotonicity and range per interval, relative to the
 * interval secant and the data scale.
 * @param {Curve} curve
 * @param {number} perInterval
 */
function shapeReport(curve, perInterval) {
  let slope = 0;
  let overshoot = 0;
  const { knots, values } = curve;
  const scale = Math.max(...Array.from(values, Math.abs), 1e-300);
  for (let k = 0; k < knots.length - 1; k++) {
    const h = knots[k + 1] - knots[k];
    const delta = values[k + 1] - values[k];
    const sign = Math.sign(delta);
    const lo = Math.min(values[k], values[k + 1]);
    const hi = Math.max(values[k], values[k + 1]);
    const secant = Math.abs(delta) / h;
    for (let j = 0; j <= perInterval; j++) {
      const x = j === perInterval ? knots[k + 1] : knots[k] + (h * j) / perInterval;
      const F = curve.evaluate(x);
      const d = curve.derivative(x);
      overshoot = Math.max(overshoot, (lo - F) / scale, (F - hi) / scale);
      if (sign !== 0) slope = Math.max(slope, -(sign * d) / secant);
      else slope = Math.max(slope, Math.abs(d) / (scale / h));
    }
  }
  return { slope, overshoot };
}

/** Random data sets with strictly increasing x. */
const steps = (/** @type {fc.Arbitrary<number>} */ dy) =>
  fc.array(fc.record({ dx: fc.double({ min: 1e-3, max: 1, noNaN: true }), dy }), { minLength: 1, maxLength: 15 });

/**
 * @param {{ dx: number, dy: number }[]} s
 * @param {number} [y0]
 * @param {number} [sign]
 */
function build(s, y0 = 0, sign = 1) {
  /** @type {CurvePoint[]} */
  const out = [{ x: 0, F: y0 }];
  for (const { dx, dy } of s) {
    const last = out[out.length - 1];
    out.push({ x: last.x + dx, F: last.F + sign * dy });
  }
  return out;
}

describe('pchipSlopes', () => {
  it('matches SciPy PchipInterpolator derivatives at the knots', () => {
    const cases = [
      [[0, 1, 2.5, 3, 5, 6], [0, 2, 3, 7, 7, 1], [2.533333333333333, 1.0344827586206897, 1.4328358208955225, 0, 0, -8]],
      [
        [0.1651, 0.19, 0.24, 0.3, 0.45, 0.6, 0.6921],
        [0, 180, 250, 267, 200, 60, 53],
        [9166.699374266089, 2537.161236658423, 480.9552969993877, 0, -604.1867954911434, -131.64794138415604, 0],
      ],
      [[0, 1, 2, 3], [1, -1, 2, -3], [-4.5, 0, 0, -9]],
      [[0, 0.5, 3], [0, 5, 5.5], [11.633333333333333, 0.4986149584487535, 0]],
      [[0, 2], [1, 5], [2, 2]],
    ];
    for (const [x, y, expected] of cases) {
      const d = pchipSlopes(x, y);
      expected.forEach((v, i) => expect(d[i]).toBeCloseTo(v, 9));
    }
  });

  it('caps the end slope at three times the end secant when the secants change sign', () => {
    // d = ((2h0 + h1)·m0 − h0·m1)/(h0 + h1) = (3·1 + 10)/2 = 6.5 > 3·m0.
    const d = pchipSlopes([0, 1, 2], [0, 1, -9]);
    expect(d[0]).toBe(3);
  });
});

describe('quarticRangeOnUnit', () => {
  it('finds interior minima and end maxima', () => {
    // (t − 0.3)²(t − 0.8)² − 0.01
    const r = quarticRangeOnUnit(0.0476, -0.528, 1.69, -2.2, 1);
    expect(r.min).toBeCloseTo(-0.01, 14);
    expect(r.max).toBeCloseTo(0.0476, 14);
  });

  it('handles lower degrees', () => {
    expect(quarticRangeOnUnit(1, -2, 0, 0, 0)).toEqual({ min: -1, max: 1 });
    expect(quarticRangeOnUnit(3, 0, 0, 0, 0)).toEqual({ min: 3, max: 3 });
    const r = quarticRangeOnUnit(0, 1, -1, 0, 0);
    expect(r.max).toBeCloseTo(0.25, 14);
    expect(r.min).toBe(0);
  });

  it('finds a root of the derivative on an end-to-end monotone piece', () => {
    // p = t⁴ − t: p' = 4t³ − 1 changes sign at t = 4^(−1/3); p'' has no root in (0, 1).
    const r = quarticRangeOnUnit(0, -1, 0, 0, 1);
    const t = 4 ** (-1 / 3);
    expect(r.min).toBeCloseTo(t ** 4 - t, 14);
    expect(r.max).toBe(0);
  });
});

describe('createCurve', () => {
  it('interpolates the points exactly', () => {
    const curve = createCurve(forceCurve);
    for (const p of forceCurve) expect(curve.evaluate(p.x)).toBeCloseTo(p.F, 10);
    expect(curve.shapePreserved).toBe(true);
  });

  it('is C2 at every knot', () => {
    for (const data of [forceCurve, pts([0, 1, 1.01, 2, 3], [0, 0.01, 10, 10.01, 10.02]), pts([0, 1, 2, 3, 4], [0, 3, 1, 4, 2])]) {
      const curve = createCurve(data);
      // Scale of each derivative order: data range, largest secant, largest secant / smallest step.
      const range = Math.max(...data.map((p) => Math.abs(p.F)));
      let secant = 0;
      let hMin = Infinity;
      for (let k = 1; k < data.length; k++) {
        const h = data[k].x - data[k - 1].x;
        secant = Math.max(secant, Math.abs(data[k].F - data[k - 1].F) / h);
        hMin = Math.min(hMin, h);
      }
      const scales = [range, secant, secant / hMin];
      for (let k = 1; k < data.length - 1; k++) {
        const left = local(curve, k - 1, 1);
        const right = local(curve, k, 0);
        for (let order = 0; order < 3; order++) {
          const scale = Math.max(Math.abs(left[order]), Math.abs(right[order]), scales[order]);
          expect(Math.abs(left[order] - right[order]) / scale).toBeLessThan(1e-9);
        }
        expect(curve.derivative(data[k].x)).toBeCloseTo(curve.slopes[k], 6);
        expect(curve.derivative(data[k].x, 2) / Math.max(1, Math.abs(curve.second[k]))).toBeCloseTo(
          curve.second[k] / Math.max(1, Math.abs(curve.second[k])),
          9,
        );
      }
    }
  });

  it('keeps monotone data monotone without overshoot (property)', () => {
    const dy = fc.oneof(fc.constant(0), fc.double({ min: 1e-3, max: 100, noNaN: true }));
    fc.assert(
      fc.property(steps(dy), fc.double({ min: -50, max: 50, noNaN: true }), fc.boolean(), (s, y0, down) => {
        const curve = createCurve(build(s, y0, down ? -1 : 1));
        expect(curve.shapePreserved).toBe(true);
        const r = shapeReport(curve, 64);
        expect(r.slope).toBeLessThan(1e-9);
        expect(r.overshoot).toBeLessThan(1e-12);
      }),
      { numRuns: 300 },
    );
  });

  it('stays within the end values of every interval on arbitrary data (property)', () => {
    const dy = fc.oneof(
      fc.constant(0),
      fc.double({ min: 1e-3, max: 100, noNaN: true }),
      fc.double({ min: -100, max: -1e-3, noNaN: true }),
    );
    fc.assert(
      fc.property(steps(dy), (s) => {
        const curve = createCurve(build(s));
        const r = shapeReport(curve, 32);
        expect(r.slope).toBeLessThan(1e-9);
        expect(r.overshoot).toBeLessThan(1e-12);
      }),
      { numRuns: 200 },
    );
  });

  it('places local extrema at knots where the secants change sign', () => {
    const data = pts([0, 1, 2, 3.5, 4, 6], [0, 5, 2, 2.5, -1, 3]);
    const curve = createCurve(data);
    for (let k = 1; k < data.length - 1; k++) {
      const m0 = data[k].F - data[k - 1].F;
      const m1 = data[k + 1].F - data[k].F;
      if (Math.sign(m0) === Math.sign(m1)) continue;
      expect(curve.derivative(data[k].x)).toBe(0);
      const isMax = m0 > 0;
      for (const x of [data[k].x - 1e-3, data[k].x + 1e-3, 0.5 * (data[k - 1].x + data[k].x), 0.5 * (data[k].x + data[k + 1].x)]) {
        if (isMax) expect(curve.evaluate(x)).toBeLessThanOrEqual(data[k].F);
        else expect(curve.evaluate(x)).toBeGreaterThanOrEqual(data[k].F);
      }
    }
  });

  it('keeps flat intervals flat', () => {
    const curve = createCurve(pts([0, 1, 2, 3, 4], [0, 4, 4, 4, 1]));
    for (let x = 1; x <= 3; x += 0.05) expect(curve.evaluate(x)).toBe(4);
  });

  it('computes the exact integral', () => {
    const curve = createCurve(forceCurve);
    const a = forceCurve[0].x;
    const b = forceCurve[forceCurve.length - 1].x;
    const exact = curve.integral(a, b);
    const reference = simpson(curve.evaluate, a, b, 1e-12);
    expect(Math.abs(exact - reference) / reference).toBeLessThan(1e-9);
    const part = curve.integral(0.2, 0.5);
    expect(Math.abs(part - simpson(curve.evaluate, 0.2, 0.5, 1e-12)) / part).toBeLessThan(1e-9);
    expect(curve.integral(0.5, 0.2)).toBeCloseTo(-part, 12);
    expect(curve.integral(0.3, 0.3)).toBe(0);
  });

  it('honours prescribed start slope and second derivative', () => {
    const curve = createCurve(forceCurve, { startSlope: 5000, startSecondDerivative: -2e4 });
    expect(curve.derivative(forceCurve[0].x)).toBeCloseTo(5000, 8);
    expect(curve.derivative(forceCurve[0].x, 2)).toBeCloseTo(-2e4, 6);
    for (const p of forceCurve) expect(curve.evaluate(p.x)).toBeCloseTo(p.F, 10);
    expect(curve.shapePreserved).toBe(true);
    expect(shapeReport(curve, 64).slope).toBeLessThan(1e-9);
  });

  it('honours a prescribed start slope or second derivative alone and keeps the other one free', () => {
    for (const startSlope of [3000, 30000]) {
      const curve = createCurve(forceCurve, { startSlope });
      expect(curve.derivative(forceCurve[0].x)).toBeCloseTo(startSlope, 8);
      expect(curve.shapePreserved).toBe(true);
      expect(shapeReport(curve, 64).slope).toBeLessThan(1e-9);
    }
    const curve = createCurve(forceCurve, { startSecondDerivative: 1e5 });
    expect(curve.derivative(forceCurve[0].x, 2)).toBeCloseTo(1e5, 6);
    expect(curve.shapePreserved).toBe(true);
  });

  it('reports lost shape preservation when prescribed values forbid it', () => {
    const curve = createCurve(forceCurve, { startSlope: -1000 });
    expect(curve.derivative(forceCurve[0].x)).toBeCloseTo(-1000, 8);
    expect(curve.shapePreserved).toBe(false);
    // Flat second interval: d1 = s1 = 0, so nothing is left to choose.
    expect(createCurve(pts([0, 1, 2], [0, 1, 1]), { startSlope: 5, startSecondDerivative: 0 }).shapePreserved).toBe(false);
    // A flat first interval cannot start with a slope.
    expect(createCurve(pts([0, 1, 2], [1, 1, 2]), { startSlope: 1 }).shapePreserved).toBe(false);
  });

  it('finds a monotone first interval when shrinking towards 0 does not', () => {
    // Each case has a monotone solution; shrinking the free values towards 0 misses it.
    const unit = pts([0, 1], [0, 1]);
    // A flat second interval needs d = s = 0 at knot 1: one free value remains.
    const plateau = pts([0, 1, 2], [0, 1, 1]);
    /** @type {[CurvePoint[], import('../../src/core/interp.js').CurveOptions][]} */
    const cases = [
      [unit, { startSecondDerivative: -30 }],
      [unit, { startSlope: 5 }],
      [unit, { startSlope: 3, startSecondDerivative: 0 }],
      [forceCurve, { startSlope: 22691.566, startSecondDerivative: -121500 }],
      [plateau, { startSlope: 5 }],
      [plateau, { startSecondDerivative: -30 }],
    ];
    for (const [data, options] of cases) {
      const curve = createCurve(data, options);
      expect(curve.shapePreserved).toBe(true);
      expect(shapeReport(curve, 2000).slope).toBeLessThan(1e-9);
      expect(shapeReport(curve, 2000).overshoot).toBeLessThan(1e-12);
      if (options.startSlope !== undefined) expect(curve.derivative(data[0].x)).toBeCloseTo(options.startSlope, 8);
      if (options.startSecondDerivative !== undefined) {
        expect(curve.derivative(data[0].x, 2)).toBeCloseTo(options.startSecondDerivative, 6);
      }
      for (const p of data) expect(curve.evaluate(p.x)).toBeCloseTo(p.F, 10);
    }
  });

  it('reports shape preservation only for monotone curves with prescribed start values (property)', () => {
    const dy = fc.oneof(
      fc.constant(0),
      fc.double({ min: 1e-3, max: 100, noNaN: true }),
      fc.double({ min: -100, max: -1e-3, noNaN: true }),
    );
    fc.assert(
      fc.property(
        steps(dy),
        fc.double({ min: -2, max: 10, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.integer({ min: 0, max: 2 }),
        (s, slopeFactor, secondFactor, mode) => {
          const data = build(s);
          const h = data[1].x - data[0].x;
          const secant = (data[1].F - data[0].F) / h;
          const startSlope = slopeFactor * secant;
          const startSecondDerivative = (secondFactor * secant) / h;
          const options = mode === 0 ? { startSlope } : mode === 1 ? { startSecondDerivative } : { startSlope, startSecondDerivative };
          const curve = createCurve(data, options);
          if (curve.shapePreserved) {
            const r = shapeReport(curve, 64);
            expect(r.slope).toBeLessThan(1e-9);
            expect(r.overshoot).toBeLessThan(1e-12);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects non-finite prescribed start values', () => {
    for (const options of [{ startSlope: NaN }, { startSecondDerivative: Infinity }, { startSlope: /** @type {any} */ (null) }]) {
      expect(() => createCurve(forceCurve, options)).toThrow(RangeError);
    }
  });

  it('treats non-finite coefficients as not monotone', () => {
    // h·d0 overflows to Infinity: the first interval cannot be checked.
    const curve = createCurve(pts([0, 2, 3], [0, 1, 2]), { startSlope: 1e308 });
    expect(curve.shapePreserved).toBe(false);
  });

  it('reproduces linear data exactly', () => {
    const data = pts([0.1, 0.13, 0.2, 0.41, 0.5], [0.1, 0.13, 0.2, 0.41, 0.5].map((x) => 12 + 300 * x));
    const curve = createCurve(data);
    for (let x = 0.1; x <= 0.5; x += 0.0137) {
      expect(curve.evaluate(x)).toBeCloseTo(12 + 300 * x, 10);
      expect(curve.derivative(x)).toBeCloseTo(300, 8);
      expect(curve.derivative(x, 2)).toBeCloseTo(0, 6);
    }
    const two = createCurve(pts([0, 2], [1, 5]));
    expect(two.evaluate(0.5)).toBe(2);
  });

  it('throws a RangeError outside the range', () => {
    const curve = createCurve(forceCurve);
    const a = forceCurve[0].x;
    const b = forceCurve[forceCurve.length - 1].x;
    expect(() => curve.evaluate(a - 1e-9)).toThrow(RangeError);
    expect(() => curve.evaluate(b + 1e-9)).toThrow(RangeError);
    expect(() => curve.derivative(b + 1e-6)).toThrow(RangeError);
    expect(() => curve.integral(a, b + 1e-6)).toThrow(RangeError);
    expect(() => curve.evaluate(NaN)).toThrow(RangeError);
    expect(curve.evaluate(a - RANGE_TOLERANCE / 2)).toBe(0);
    expect(curve.evaluate(b + RANGE_TOLERANCE / 2)).toBeCloseTo(53, 10);
  });

  it('rejects an unsupported derivative order', () => {
    const curve = createCurve(forceCurve);
    expect(() => curve.derivative(0.3, /** @type {any} */ (3))).toThrow(RangeError);
  });

  it('rejects invalid points', () => {
    expect(() => createCurve([{ x: 0, F: 0 }])).toThrow(/at least 2/);
    expect(() => createCurve(pts([0, 0], [0, 1]))).toThrow(/larger x/);
    expect(() => createCurve(pts([0, 1], [0, NaN]))).toThrow(/non-finite/);
  });

  it('samples uniformly including both ends', () => {
    const curve = createCurve(forceCurve);
    const s = curve.sample(11);
    expect(s.x.length).toBe(11);
    expect(s.x[0]).toBe(forceCurve[0].x);
    expect(s.x[10]).toBe(forceCurve[6].x);
    expect(s.F[10]).toBeCloseTo(53, 10);
    expect(() => curve.sample(1)).toThrow(RangeError);
  });

  it('survives structured cloning of its data', () => {
    const curve = createCurve(forceCurve);
    const clone = fromCurveData(structuredClone(toCurveData(curve)));
    for (const x of [0.17, 0.33, 0.61]) {
      expect(clone.evaluate(x)).toBe(curve.evaluate(x));
      expect(clone.integral(0.17, x)).toBe(curve.integral(0.17, x));
    }
    expect(buildCurveData(forceCurve).coeffs).toEqual(curve.coeffs);
  });
});
