import { describe, expect, it } from 'vitest';
import {
  EXPORT_TOLERANCE, basisFunctions, concat, evaluate, findSpan, fitSupport, normalDistance, supportCircle, transform,
} from '../../src/core/bspline.js';
import { createSupport, eccentricCircle, ellipse, offset, splineSupport } from '../../src/core/support.js';

/** @typedef {import('../../src/core/bspline.js').BSpline} BSpline */

/** Non-uniform clamped knots of a 7-point cubic spline. */
const KNOTS = Float64Array.from([0, 0, 0, 0, 0.3, 0.45, 1.1, 2, 2, 2, 2]);

/** Cubic polynomial curve and its derivative, coefficients lowest order first. */
const CX = [0.01, -0.2, 0.05, 0.03];
const CY = [-0.02, 0.1, -0.04, 0.02];
/** @param {number[]} c @param {number} u */
const poly = (c, u) => c[0] + u * (c[1] + u * (c[2] + u * c[3]));
/** @param {number[]} c @param {number} u */
const dpoly = (c, u) => c[1] + u * (2 * c[2] + 3 * u * c[3]);
/** Blossom of the cubic: its control point on the knots x, y, z. */
const blossom = (/** @type {number[]} */ c, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
  c[0] + (c[1] * (x + y + z)) / 3 + (c[2] * (x * y + y * z + z * x)) / 3 + c[3] * x * y * z;

/**
 * The polynomial curve as a B-spline on KNOTS.
 * @returns {BSpline}
 */
function polynomialSpline() {
  const count = KNOTS.length - 4;
  const points = new Float64Array(2 * count);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [KNOTS[i + 1], KNOTS[i + 2], KNOTS[i + 3]];
    points[2 * i] = blossom(CX, x, y, z);
    points[2 * i + 1] = blossom(CY, x, y, z);
  }
  return { degree: 3, knots: KNOTS, points, closed: false, maxDeviation: 0 };
}

/**
 * Open Bézier spline on [0, 1] through four points.
 * @param {number[]} xy eight coordinates
 * @returns {BSpline}
 */
function bezier(xy) {
  return { degree: 3, knots: Float64Array.from([0, 0, 0, 0, 1, 1, 1, 1]), points: Float64Array.from(xy), closed: false, maxDeviation: 1e-6 };
}

describe('basis functions', () => {
  it('finds the spans at the ends and inside', () => {
    expect(findSpan(KNOTS, 0)).toBe(3);
    expect(findSpan(KNOTS, -1)).toBe(3);
    expect(findSpan(KNOTS, 2)).toBe(6);
    expect(findSpan(KNOTS, 5)).toBe(6);
    expect(findSpan(KNOTS, 0.3)).toBe(4);
    expect(findSpan(KNOTS, 0.5)).toBe(5);
    expect(findSpan(KNOTS, 1.5)).toBe(6);
  });

  it('sum to 1 and are not negative', () => {
    const out = new Float64Array(4);
    for (let k = 0; k <= 200; k++) {
      const u = (2 * k) / 200;
      basisFunctions(KNOTS, findSpan(KNOTS, u), u, out);
      expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 14);
      for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('evaluate', () => {
  it('reproduces a cubic polynomial curve and its derivatives', () => {
    const s = polynomialSpline();
    const out = new Float64Array(6);
    for (let k = 0; k <= 100; k++) {
      const u = (2 * k) / 100;
      evaluate(s, u, out);
      expect(out[0]).toBeCloseTo(poly(CX, u), 14);
      expect(out[1]).toBeCloseTo(poly(CY, u), 14);
      expect(out[2]).toBeCloseTo(dpoly(CX, u), 13);
      expect(out[3]).toBeCloseTo(dpoly(CY, u), 13);
      expect(out[4]).toBeCloseTo(2 * CX[2] + 6 * CX[3] * u, 12);
      expect(out[5]).toBeCloseTo(2 * CY[2] + 6 * CY[3] * u, 12);
    }
  });

  it('clamps the parameter and writes 4 values to a short buffer', () => {
    const s = polynomialSpline();
    const out = new Float64Array(4);
    evaluate(s, 3, out);
    expect(out[0]).toBeCloseTo(poly(CX, 2), 14);
    evaluate(s, -1, out);
    expect(out[0]).toBe(s.points[0]);
    expect(out[1]).toBe(s.points[1]);
  });
});

describe('transform', () => {
  it('maps the curve exactly by the affine map', () => {
    const s = polynomialSpline();
    const [a, b, c, d, e, f] = [0.6, -0.8, 0.8, 0.6, 0.12, -0.05];
    const t = transform(s, a, b, c, d, e, f);
    const p = new Float64Array(4);
    const q = new Float64Array(4);
    for (let k = 0; k <= 50; k++) {
      const u = (2 * k) / 50;
      evaluate(s, u, p);
      evaluate(t, u, q);
      expect(q[0]).toBeCloseTo(a * p[0] + b * p[1] + e, 15);
      expect(q[1]).toBeCloseTo(c * p[0] + d * p[1] + f, 15);
      expect(q[2]).toBeCloseTo(a * p[2] + b * p[3], 14);
      expect(q[3]).toBeCloseTo(c * p[2] + d * p[3], 14);
    }
    expect(t.knots).toEqual(s.knots);
    expect(t.knots).not.toBe(s.knots);
  });

  it('keeps a mirrored closed spline closed and scales the deviation by the stretch', () => {
    const { spline } = fitSupport(eccentricCircle({ radius: 0.04, offset: 0.01, phase: 0.5 }), 0, 2 * Math.PI, EXPORT_TOLERANCE);
    if (!spline) throw new Error('fit failed');
    const m = transform(spline, -1, 0, 0, 1, 0.3, 0);
    const n = m.points.length;
    expect(m.closed).toBe(true);
    expect(m.points[n - 2]).toBe(m.points[0]);
    expect(m.points[n - 1]).toBe(m.points[1]);
    expect(m.maxDeviation).toBeCloseTo(spline.maxDeviation, 20);
    expect(transform(spline, 2, 0, 0, 0.5, 0, 0).maxDeviation).toBeCloseTo(2 * spline.maxDeviation, 20);
  });
});

describe('concat', () => {
  it('joins open splines with triple knots into a continuous curve', () => {
    const first = polynomialSpline();
    const out = new Float64Array(4);
    evaluate(first, 2, out);
    const second = bezier([out[0], out[1], out[0] + 0.01, out[1], out[0] + 0.02, out[1] + 0.01, out[0] + 0.03, out[1] + 0.03]);
    second.knots = Float64Array.from([5, 5, 5, 5, 5.5, 5.5, 5.5, 5.5]);
    const third = bezier([out[0] + 0.03, out[1] + 0.03, 0, 0, 0, 0, -0.01, 0.05]);
    const joined = concat([first, second, third]);
    const count = joined.points.length / 2;
    expect(count).toBe(7 + 4 + 4 - 2);
    expect(joined.knots.length).toBe(count + 4);
    expect(Array.from(joined.knots)).toEqual([0, 0, 0, 0, 0.3, 0.45, 1.1, 2, 2, 2, 2.5, 2.5, 2.5, 3.5, 3.5, 3.5, 3.5]);
    expect(joined.closed).toBe(false);
    expect(joined.maxDeviation).toBe(1e-6);
    for (let k = 1; k < joined.knots.length; k++) expect(joined.knots[k]).toBeGreaterThanOrEqual(joined.knots[k - 1]);
    // Continuous at the joins, and each piece reproduced.
    const a = new Float64Array(4);
    const b = new Float64Array(4);
    for (const [u, piece, v] of /** @type {[number, BSpline, number][]} */ ([[2, second, 5], [2.5, third, 1]])) {
      evaluate(joined, u - 1e-12, a);
      evaluate(joined, u, b);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-12);
      evaluate(piece, piece === second ? 5 : 0, a);
      expect(b[0]).toBeCloseTo(a[0], 15);
      evaluate(joined, u + 0.25, b);
      evaluate(piece, (piece === second ? 5 : 0) + 0.25 * (v === 5 ? 1 : 1), a);
      expect(b[0]).toBeCloseTo(a[0], 14);
      expect(b[1]).toBeCloseTo(a[1], 14);
    }
  });

  it('rejects an empty list and closed or malformed pieces', () => {
    expect(() => concat([])).toThrow(RangeError);
    expect(() => concat({ ...[] })).toThrow(RangeError);
    expect(() => concat([{ ...bezier([0, 0, 1, 0, 1, 1, 0, 1]), closed: true }])).toThrow(RangeError);
    expect(() => concat([{ ...bezier([0, 0, 1, 0, 1, 1, 0, 1]), knots: new Float64Array(7) }])).toThrow(RangeError);
  });
});

describe('closed fits', () => {
  it('copy the first control point to the last and match the end tangents', () => {
    for (const data of [eccentricCircle({ radius: 0.04, offset: 0.012, phase: -1 }), ellipse({ a: 0.05, b: 0.035, axisAngle: 0.3 })]) {
      const { spline, error } = fitSupport(data, 0.7, 0.7 + 2 * Math.PI, EXPORT_TOLERANCE);
      expect(error).toBe(null);
      if (!spline) throw new Error('fit failed');
      const P = spline.points;
      const n = P.length;
      expect(spline.closed).toBe(true);
      expect(spline.knots.length).toBe(n / 2 + 4);
      expect(P[n - 2]).toBe(P[0]);
      expect(P[n - 1]).toBe(P[1]);
      // P_(m−1) = P_0 − (P_1 − P_0): one rounding of the subtraction.
      expect(Math.abs(P[n - 2] - P[n - 4] - (P[2] - P[0]))).toBeLessThan(1e-17);
      expect(Math.abs(P[n - 1] - P[n - 3] - (P[3] - P[1]))).toBeLessThan(1e-17);
      expect(spline.knots[0]).toBe(0);
      expect(spline.knots[spline.knots.length - 1]).toBeCloseTo(2 * Math.PI, 14);
      expect(spline.maxDeviation).toBeLessThanOrEqual(EXPORT_TOLERANCE / 2);
    }
  });

  it('scale the end tangent of a closed Hermite fit to the length of the last piece', () => {
    const knots = Array.from({ length: 9 }, (_, i) => (2 * Math.PI * i) / 8);
    const data = splineSupport(knots, knots.map((x) => 0.03 + 0.003 * Math.cos(x)), { periodic: true });
    // Start between two knots: the first and last pieces differ in length.
    const { spline } = fitSupport(data, 0.2, 0.2 + 2 * Math.PI, EXPORT_TOLERANCE);
    if (!spline) throw new Error('fit failed');
    const P = spline.points;
    const n = P.length;
    const K = spline.knots;
    const m = n / 2 - 1;
    const hFirst = K[4] - K[3];
    const hLast = K[m + 1] - K[m];
    expect((P[n - 2] - P[n - 4]) / hLast).toBeCloseTo((P[2] - P[0]) / hFirst, 12);
    expect(P[n - 2]).toBe(P[0]);
  });
});

describe('normalDistance', () => {
  const circle = createSupport(eccentricCircle({ radius: 0.04, offset: 0.01, phase: 0.3 }));
  const [cx, cy] = [0.01 * Math.cos(0.3), 0.01 * Math.sin(0.3)];

  it('equals |S − c| − r for a circle', () => {
    for (let k = 0; k < 60; k++) {
      const angle = 0.37 * k;
      const dist = 0.005 + 0.001 * k;
      const x = cx + dist * Math.cos(angle);
      const y = cy + dist * Math.sin(angle);
      const d = normalDistance(circle, x, y, angle + 0.3 * Math.sin(k), 0.5);
      expect(d).toBeCloseTo(dist - 0.04, 14);
    }
    // About the axle: |S| − r.
    const centred = createSupport(eccentricCircle({ radius: 0.03 }));
    expect(normalDistance(centred, 0.03, 0.04, 0.9, 0.2)).toBeCloseTo(0.02, 15);
  });

  it('stays finite for a far point and for a bracket without a root', () => {
    const d = normalDistance(circle, 5, 3, Math.atan2(3, 5) + 2, 0.5);
    expect(Number.isFinite(d)).toBe(true);
    expect(Math.abs(d)).toBeLessThanOrEqual(Math.hypot(5, 3) + 0.05);
    const far = normalDistance(circle, 5, 3, Math.atan2(3, 5), 0.5);
    expect(far).toBeCloseTo(Math.hypot(5 - cx, 3 - cy) - 0.04, 12);
    // Roots at the ends of the bracket.
    expect(normalDistance(circle, cx + 0.05, cy, -0.5, 0.5)).toBeCloseTo(0.01, 14);
    expect(normalDistance(circle, cx + 0.05, cy, 0.5, 0.5)).toBeCloseTo(0.01, 14);
  });

  it('does not diverge for the points of a bad control polygon', () => {
    const zigzag = [];
    for (let i = 0; i < 12; i++) zigzag.push(0.05 * Math.cos(i) * (i % 2 ? 3 : -0.2), 0.08 * Math.sin(3 * i) * (i % 3 ? 1 : -4));
    const knots = [0, 0, 0, ...Array.from({ length: 10 }, (_, i) => i * 0.5), 4.5, 4.5, 4.5];
    const bad = { degree: /** @type {3} */ (3), knots: Float64Array.from(knots), points: Float64Array.from(zigzag), closed: false, maxDeviation: 0 };
    expect(bad.knots.length).toBe(bad.points.length / 2 + 4);
    const out = new Float64Array(4);
    for (let k = 0; k <= 400; k++) {
      const u = (4.5 * k) / 400;
      evaluate(bad, u, out);
      const d = normalDistance(circle, out[0], out[1], u, 0.3);
      expect(Number.isFinite(d)).toBe(true);
      expect(Math.abs(d)).toBeLessThanOrEqual(Math.hypot(out[0], out[1]) + 0.05);
    }
  });

  it('returns NaN for non-finite input', () => {
    expect(normalDistance(circle, NaN, 0, 0, 0.1)).toBeNaN();
    expect(normalDistance(circle, 0.05, 0, 0, 0)).toBeNaN();
    expect(normalDistance(circle, 0.05, 0, Infinity, 0.1)).toBeNaN();
  });
});

describe('supportCircle', () => {
  it('gives the circle of an eccentric track through offsets', () => {
    const c = supportCircle(offset(offset(eccentricCircle({ radius: 0.04, offset: 0.01, phase: Math.PI / 2 }), 0.001), -0.003));
    expect(c?.r).toBeCloseTo(0.038, 15);
    expect(c?.cx).toBeCloseTo(0, 15);
    expect(c?.cy).toBeCloseTo(0.01, 15);
  });

  it('is null for other kinds and malformed data', () => {
    expect(supportCircle(ellipse({ a: 0.05, b: 0.04 }))).toBe(null);
    expect(supportCircle(/** @type {any} */ (null))).toBe(null);
    expect(supportCircle(/** @type {any} */ ({ kind: 'eccentric', radius: NaN, offset: 0, phase: 0 }))).toBe(null);
  });
});

describe('fitSupport', () => {
  it('halves Hermite pieces of a coarse spline track until they pass', () => {
    const knots = Array.from({ length: 5 }, (_, i) => (2 * Math.PI * i) / 4);
    const data = splineSupport(knots, knots.map((x) => 0.03 + 0.004 * Math.cos(x)), { periodic: true });
    const { spline, error } = fitSupport(data, 0, 2 * Math.PI, 1e-7);
    expect(error).toBe(null);
    expect(spline && spline.points.length / 2).toBeGreaterThan(3 * 4 + 1);
    expect(spline?.maxDeviation).toBeLessThanOrEqual(5e-8);
  });

  it('fits an open range of an open spline track', () => {
    const knots = [0, 0.4, 0.9, 1.5];
    const data = offset(splineSupport(knots, knots.map((x) => 0.03 + 0.002 * x * x)), 0.001);
    const { spline, error } = fitSupport(data, 0.1, 1.4, EXPORT_TOLERANCE);
    expect(error).toBe(null);
    expect(spline?.closed).toBe(false);
    // The track knots 0.4 and 0.9 (u = 0.3 and 0.8) are triple knots; the
    // first piece, where ρ is smallest, may be halved.
    const K = Array.from(spline?.knots ?? []);
    expect(K.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(K.slice(-4)).toEqual([1.3, 1.3, 1.3, 1.3].map((v) => expect.closeTo(v, 14)));
    for (const u of [0.3, 0.8]) expect(K.filter((k) => Math.abs(k - u) < 1e-12)).toHaveLength(3);
    expect(K.length).toBe((spline?.points.length ?? 0) / 2 + 4);
  });

  it('keeps a full turn of an open spline track open', () => {
    const knots = Array.from({ length: 9 }, (_, i) => (2 * Math.PI * i) / 8);
    const data = splineSupport(knots, knots.map((x) => 0.03 + 0.003 * Math.cos(x)));
    const { spline, error } = fitSupport(data, 0, 2 * Math.PI, EXPORT_TOLERANCE);
    expect(error).toBe(null);
    expect(spline?.closed).toBe(false);
    expect(spline?.maxDeviation).toBeLessThanOrEqual(EXPORT_TOLERANCE / 2);
  });

  it('returns an error when no fit meets the tolerance', () => {
    const knots = [0, 0.4, 0.9, 1.5];
    const spline = splineSupport(knots, knots.map((x) => 0.03 + 0.002 * x * x));
    expect(fitSupport(spline, 0.1, 0.2, 1e-19)).toEqual({ spline: null, error: expect.stringMatching(/halvings/) });
    expect(fitSupport(eccentricCircle({ radius: 0.04 }), 0, 1, 1e-19)).toEqual({ spline: null, error: expect.stringMatching(/4096/) });
  });

  it('rejects ranges outside the track, longer than a turn, and tracks that are not strictly convex', () => {
    const open = splineSupport([0, 0.4, 0.9, 1.5], [0.03, 0.031, 0.032, 0.033]);
    expect(fitSupport(open, 0.1, 2, EXPORT_TOLERANCE).error).toMatch(/outside/);
    expect(fitSupport(eccentricCircle({ radius: 0.04 }), 0, 7, EXPORT_TOLERANCE).error).toMatch(/one turn/);
    expect(fitSupport(eccentricCircle({ radius: 0 }), 0, 1, EXPORT_TOLERANCE).error).toMatch(/convex/);
  });
});
