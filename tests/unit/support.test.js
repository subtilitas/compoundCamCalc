import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createSupport, eccentricCircle, ellipse, offset, splineSupport, stringTrackSupport, toSupportData,
} from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { derivative, integrate } from './numeric.js';

/** @typedef {import('../../src/core/support.js').SupportData} SupportData */
/** @typedef {import('../../src/core/support.js').Support} Support */

/** Smooth periodic test function and its derivatives, for spline supports. */
const wave = {
  p: (/** @type {number} */ x) => 0.03 + 0.004 * Math.cos(x - 0.3) + 0.001 * Math.sin(2 * x),
  dp: (/** @type {number} */ x) => -0.004 * Math.sin(x - 0.3) + 0.002 * Math.cos(2 * x),
  d2p: (/** @type {number} */ x) => -0.004 * Math.cos(x - 0.3) - 0.004 * Math.sin(2 * x),
};

/**
 * @param {number} n intervals over one turn
 */
function periodicWave(n) {
  const knots = Array.from({ length: n + 1 }, (_, i) => -1 + (2 * Math.PI * i) / n);
  return splineSupport(knots, knots.map(wave.p), { periodic: true });
}

/** @type {[string, SupportData][]} */
const shapes = [
  ['eccentric circle', eccentricCircle({ radius: 0.036, offset: 0.006, phase: 0.4 })],
  ['ellipse', ellipse({ a: 0.042, b: 0.03, axisAngle: 0.7, offset: 0.005, offsetAngle: -1.1 })],
  ['offset ellipse', offset(ellipse({ a: 0.03, b: 0.04, axisAngle: -0.2, offset: 0.002, offsetAngle: 2 }), 0.00125)],
  ['periodic spline', periodicWave(48)],
  ['open spline', splineSupport([-1, 0, 0.8, 1.5, 3, 4], [0.03, 0.032, 0.035, 0.034, 0.03, 0.028])],
];

/**
 * Knots of a spline support repeated over [a, b], or none for analytic shapes.
 * @param {SupportData} data
 * @param {number} a
 * @param {number} b
 * @returns {number[]}
 */
function breaks(data, a, b) {
  if (data.kind !== 'spline') return [];
  const period = data.knots[data.knots.length - 1] - data.knots[0];
  const shifts = data.periodic ? Array.from({ length: 9 }, (_, k) => (k - 4) * period) : [0];
  return shifts.flatMap((shift) => Array.from(data.knots, (k) => k + shift)).filter((k) => k > a && k < b);
}

/**
 * Integral of p over [a, b], split at the spline knots so that every panel
 * sees a polynomial.
 * @param {SupportData} data
 * @param {Support} s
 * @param {number} a
 * @param {number} b
 */
function integrateP(data, s, a, b) {
  const points = [a, ...breaks(data, a, b).sort((u, v) => u - v), b];
  let sum = 0;
  for (let k = 0; k < points.length - 1; k++) sum += integrate(s.p, points[k], points[k + 1], data.kind === 'spline' ? 1 : 64);
  return sum;
}

describe('support functions: envelope identities', () => {
  for (const [name, data] of shapes) {
    const s = createSupport(data);
    it(`${name}: X lies on its tangent line, dX/dψ = ρ·t, P' = p, p' and p'' match differences`, () => {
      const h = 1e-3;
      fc.assert(
        fc.property(fc.double({ min: -8, max: 8, noNaN: true }), (psi) => {
          // Differences need a smooth neighbourhood: spline pieces join with a jump in p'''.
          fc.pre(breaks(data, psi - 3 * h, psi + 3 * h).length === 0);
          const n = [Math.cos(psi), Math.sin(psi)];
          const t = [-Math.sin(psi), Math.cos(psi)];
          const X = s.point(psi);
          expect(Math.abs(X.x * n[0] + X.y * n[1] - s.p(psi))).toBeLessThan(1e-16);
          expect(Math.abs(s.distance(psi) - Math.hypot(X.x, X.y))).toBeLessThan(1e-16);
          const dx = derivative((u) => s.point(u).x, psi, h);
          const dy = derivative((u) => s.point(u).y, psi, h);
          const rho = s.rho(psi);
          expect(Math.abs(dx - rho * t[0])).toBeLessThan(1e-11);
          expect(Math.abs(dy - rho * t[1])).toBeLessThan(1e-11);
          expect(Math.abs(derivative(s.P, psi, h) - s.p(psi))).toBeLessThan(1e-11);
          expect(Math.abs(derivative(s.p, psi, h) - s.dp(psi))).toBeLessThan(1e-11);
          expect(Math.abs(derivative(s.dp, psi, h) - s.d2p(psi))).toBeLessThan(1e-10);
        }),
        { numRuns: 60 },
      );
    });

    it(`${name}: P is the exact integral of p`, () => {
      for (const [a, b] of [[-2, 1.3], [0.1, 5.9], [-7.5, -0.2]]) {
        const exact = integrateP(data, s, a, b);
        expect(Math.abs(s.P(b) - s.P(a) - exact)).toBeLessThan(2e-15);
      }
      expect(s.P(s.reference)).toBeCloseTo(0, 15);
    });
  }
});

describe('eccentric circle', () => {
  it('is a circle of radius r about its centre, with ρ = r', () => {
    const r = 0.036;
    const e = 0.006;
    const phase = 0.4;
    const s = createSupport(eccentricCircle({ radius: r, offset: e, phase }));
    for (let psi = -4; psi < 4; psi += 0.37) {
      const X = s.point(psi);
      expect(Math.hypot(X.x - e * Math.cos(phase), X.y - e * Math.sin(phase))).toBeCloseTo(r, 15);
      expect(s.rho(psi)).toBeCloseTo(r, 15);
    }
    expect(s.p(phase)).toBeCloseTo(r + e, 15);
    expect(s.p(phase + Math.PI)).toBeCloseTo(r - e, 15);
    expect(eccentricCircle({ radius: r })).toEqual({ kind: 'eccentric', radius: r, offset: 0, phase: 0 });
  });
});

describe('ellipse', () => {
  const a = 0.042;
  const b = 0.03;
  const axisAngle = 0.7;
  const e = 0.005;
  const offsetAngle = -1.1;
  const s = createSupport(ellipse({ a, b, axisAngle, offset: e, offsetAngle }));
  const cx = e * Math.cos(offsetAngle);
  const cy = e * Math.sin(offsetAngle);

  it('has its contact points on the ellipse', () => {
    for (let psi = -4; psi < 4; psi += 0.29) {
      const X = s.point(psi);
      const u = (X.x - cx) * Math.cos(axisAngle) + (X.y - cy) * Math.sin(axisAngle);
      const v = -(X.x - cx) * Math.sin(axisAngle) + (X.y - cy) * Math.cos(axisAngle);
      expect((u / a) ** 2 + (v / b) ** 2).toBeCloseTo(1, 13);
    }
  });

  it('has radius of curvature b²/a at the ends of the major axis and a²/b at the ends of the minor axis', () => {
    expect(s.rho(axisAngle)).toBeCloseTo((b * b) / a, 15);
    expect(s.rho(axisAngle + Math.PI)).toBeCloseTo((b * b) / a, 15);
    expect(s.rho(axisAngle + Math.PI / 2)).toBeCloseTo((a * a) / b, 15);
    expect(s.p(axisAngle)).toBeCloseTo(a + e * Math.cos(axisAngle - offsetAngle), 15);
  });

  it('stores the larger semi-axis as a and turns the axis by 90°', () => {
    const d = ellipse({ a: 0.03, b: 0.04, axisAngle: 0.1 });
    expect(d.a).toBe(0.04);
    expect(d.b).toBe(0.03);
    expect(d.axisAngle).toBeCloseTo(0.1 + Math.PI / 2, 15);
    const swapped = createSupport(d);
    const plain = createSupport(ellipse({ a: 0.04, b: 0.03, axisAngle: 0.1 + Math.PI / 2 }));
    expect(swapped.p(0.9)).toBe(plain.p(0.9));
  });

  it('rejects an ellipse without finite, positive semi-axes', () => {
    expect(() => createSupport(ellipse({ a: 0.04, b: 0 }))).toThrow(RangeError);
    expect(() => createSupport(offset(ellipse({ a: 0.04, b: -0.01 }), 0.001))).toThrow(/semi-axes/);
    expect(() => createSupport(ellipse({ a: Infinity, b: 0.03 }))).toThrow(RangeError);
    expect(() => createSupport(ellipse({ a: NaN, b: 0.03 }))).toThrow(RangeError);
  });

  it('with a = b is the eccentric circle', () => {
    const el = createSupport(ellipse({ a: 0.03, b: 0.03, offset: 0.004, offsetAngle: 0.5 }));
    const ci = createSupport(eccentricCircle({ radius: 0.03, offset: 0.004, phase: 0.5 }));
    for (const psi of [-3, -1, 0, 0.5, 2, 6]) {
      expect(el.p(psi)).toBeCloseTo(ci.p(psi), 16);
      expect(el.P(psi)).toBeCloseTo(ci.P(psi), 16);
    }
  });
});

describe('offset', () => {
  it('adds delta to p and ρ and moves X along the normal', () => {
    const base = ellipse({ a: 0.04, b: 0.03 });
    const b = createSupport(base);
    const o = createSupport(offset(base, 0.00125));
    for (const psi of [-2, 0, 1, 3.5]) {
      expect(o.p(psi) - b.p(psi)).toBeCloseTo(0.00125, 16);
      expect(o.rho(psi) - b.rho(psi)).toBeCloseTo(0.00125, 16);
      expect(o.point(psi).x - b.point(psi).x).toBeCloseTo(0.00125 * Math.cos(psi), 16);
      expect(o.P(psi) - b.P(psi)).toBeCloseTo(0.00125 * psi, 16);
    }
  });
});

describe('spline support', () => {
  it('interpolates its values and is C2 at the knots', () => {
    const knots = [-1, 0, 0.8, 1.5, 3, 4];
    const values = [0.03, 0.032, 0.035, 0.034, 0.03, 0.028];
    const s = createSupport(splineSupport(knots, values));
    const eps = 1e-9;
    knots.forEach((k, i) => {
      expect(s.p(k)).toBeCloseTo(values[i], 15);
      if (i > 0 && i < knots.length - 1) {
        expect(Math.abs(s.p(k - eps) - s.p(k + eps))).toBeLessThan(1e-10);
        expect(Math.abs(s.dp(k - eps) - s.dp(k + eps))).toBeLessThan(1e-9);
        expect(Math.abs(s.d2p(k - eps) - s.d2p(k + eps))).toBeLessThan(1e-8);
      }
    });
    // Natural end conditions.
    expect(s.d2p(-1)).toBeCloseTo(0, 14);
    expect(s.d2p(4)).toBeCloseTo(0, 14);
    expect(s.min).toBe(-1);
    expect(s.max).toBe(4);
  });

  it('with clamped ends reproduces a cubic exactly, including its integral', () => {
    const q = (/** @type {number} */ x) => 0.03 + 0.002 * x - 0.001 * x * x + 0.0003 * x ** 3;
    const dq = (/** @type {number} */ x) => 0.002 - 0.002 * x + 0.0009 * x * x;
    const Q = (/** @type {number} */ x) => 0.03 * x + 0.001 * x * x - (0.001 / 3) * x ** 3 + 0.000075 * x ** 4;
    const knots = [-0.5, 0.2, 1, 1.3, 2.5];
    const s = createSupport(splineSupport(knots, knots.map(q), { endSlopes: [dq(-0.5), dq(2.5)] }));
    for (let x = -1; x <= 3; x += 0.13) {
      expect(s.p(x)).toBeCloseTo(q(x), 15);
      expect(s.dp(x)).toBeCloseTo(dq(x), 14);
      expect(s.P(x) - s.P(0)).toBeCloseTo(Q(x), 15);
    }
  });

  it('periodic: repeats with its period and approximates a smooth track to fourth order', () => {
    const coarse = createSupport(periodicWave(36));
    const fine = createSupport(periodicWave(72));
    const period = 2 * Math.PI;
    let errCoarse = 0;
    let errFine = 0;
    for (let x = -1; x < 6; x += 0.011) {
      expect(fine.p(x + period)).toBeCloseTo(fine.p(x), 15);
      expect(fine.d2p(x - 2 * period)).toBeCloseTo(fine.d2p(x), 12);
      expect(fine.P(x + period) - fine.P(x)).toBeCloseTo(fine.P(period - 1) - fine.P(-1), 15);
      errCoarse = Math.max(errCoarse, Math.abs(coarse.p(x) - wave.p(x)));
      errFine = Math.max(errFine, Math.abs(fine.p(x) - wave.p(x)));
    }
    expect(errFine).toBeLessThan(1e-8);
    expect(Math.log2(errCoarse / errFine)).toBeGreaterThan(3.8);
    expect(fine.min).toBe(-Infinity);
    expect(fine.max).toBe(Infinity);
  });

  it('rejects malformed input', () => {
    expect(() => splineSupport([0], [1])).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, 2])).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 1], [1, 2, 3])).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, NaN, 3])).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, 2, 1], { periodic: true })).toThrow(RangeError);
  });
});

describe('createSupport and toSupportData', () => {
  it('round-trips every kind through plain data and structured cloning', () => {
    for (const [, data] of shapes) {
      const s = createSupport(data);
      const copy = createSupport(structuredClone(toSupportData(s)));
      for (const psi of [-3, 0.2, 2.9]) {
        expect(copy.p(psi)).toBe(s.p(psi));
        expect(copy.P(psi)).toBe(s.P(psi));
      }
    }
  });

  it('rejects an unknown kind', () => {
    expect(() => createSupport(/** @type {any} */ ({ kind: 'square' }))).toThrow(RangeError);
  });

  it('evaluate writes p, p′ and p″ into the output array', () => {
    const s = createSupport(eccentricCircle({ radius: 0.03, offset: 0.01, phase: 0 }));
    const out = s.evaluate(0, new Float64Array(3));
    expect(Array.from(out)).toEqual([0.04, -0, -0.01]);
  });
});

describe('stringTrackSupport', () => {
  it('offsets the groove bottom of the state by half the string diameter', () => {
    const state = defaultState();
    const d = state.cords.stringDiameter;
    const circle = createSupport(stringTrackSupport(state.stringTrack, d));
    const t = state.stringTrack;
    expect(circle.p(t.phase)).toBeCloseTo(t.radius + t.offset + d / 2, 15);
    expect(circle.rho(1)).toBeCloseTo(t.radius + d / 2, 15);

    const el = createSupport(stringTrackSupport({ ...t, shape: 'ellipse', phase: 0.3 }, d));
    expect(el.p(0.3)).toBeCloseTo(t.semiMajor + t.offset + d / 2, 15);
    expect(el.rho(0.3 + Math.PI / 2)).toBeCloseTo(t.semiMajor ** 2 / t.semiMinor + d / 2, 15);
  });
});
