import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createSupport, eccentricCircle, ellipse, offset, splineSupport, stringTrackSupport, toSupportData,
} from '../../src/core/support.js';
import { CONCAVITY_TOLERANCE } from '../../src/core/forward.js';
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
    // Turned by 90° towards 0; the ellipse repeats every π.
    expect(d.axisAngle).toBeCloseTo(0.1 - Math.PI / 2, 15);
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
    expect(() => splineSupport([0, 1, Infinity], [1, 2, 3])).toThrow(RangeError);
    expect(() => splineSupport([-Infinity, 0, 1], [1, 2, 3])).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, 2, 3], { endSlopes: [NaN, 0] })).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, 2, 3], { endSlopes: [0, Infinity] })).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, 2, 3], { endSlopes: /** @type {any} */ ([1]) })).toThrow(RangeError);
    expect(() => splineSupport([0, 1, 2], [1, 2, 1], { periodic: true })).toThrow(RangeError);
  });
});

describe('minRho', () => {
  it('is exact for circles, ellipses and offsets', () => {
    expect(createSupport(eccentricCircle({ radius: 0.03, offset: 0.01, phase: 1 })).minRho(0, 5).value).toBe(0.03);
    const e = createSupport(ellipse({ a: 0.05, b: 0.03, axisAngle: 0.4 }));
    expect(e.minRho(0, 1).value).toBeCloseTo(0.03 ** 2 / 0.05, 15);
    // A range that avoids ψ = axisAngle + k·π has its minimum at an end.
    const part = e.minRho(1.2, 1.5);
    expect(part.value).toBeCloseTo(Math.min(e.rho(1.2), e.rho(1.5)), 15);
    const o = createSupport(offset(ellipse({ a: 0.05, b: 0.03 }), -0.001));
    expect(o.minRho(0, 1).value).toBeCloseTo(0.03 ** 2 / 0.05 - 0.001, 15);
  });

  it('stores serialized ellipse data with a < b the way ellipse() does', () => {
    // Minor semi-axis 15 mm, major 20 mm: ρ_min = 0.015²/0.02 = 11.25 mm,
    // which an offset of −11.5 mm turns negative.
    const raw = { kind: 'ellipse', a: 0.015, b: 0.02, axisAngle: 0, offset: 0, offsetAngle: 0 };
    const s = createSupport(/** @type {any} */ ({ kind: 'offset', base: raw, delta: -0.0115 }));
    const m = s.minRho(-4, 4);
    expect(m.value).toBeCloseTo(0.015 ** 2 / 0.02 - 0.0115, 15);
    expect(m.value).toBeLessThan(0);
    expect(s.rho(m.psi)).toBeCloseTo(m.value, 15);
    const direct = createSupport(/** @type {any} */ (raw));
    expect([/** @type {any} */ (direct).a, /** @type {any} */ (direct).b]).toEqual([0.02, 0.015]);
    const built = createSupport(ellipse(raw));
    for (const psi of [-2, 0, 0.7, 3]) {
      expect(direct.p(psi)).toBe(built.p(psi));
      expect(direct.P(psi)).toBe(built.P(psi));
    }
  });

  it('matches dense sampling on random splines and never exceeds a sampled value', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 0.05, noNaN: true }), { minLength: 4, maxLength: 12 }),
        fc.boolean(),
        fc.double({ min: -3, max: 9, noNaN: true }),
        fc.double({ min: 0, max: 8, noNaN: true }),
        (vals, periodic, lo, width) => {
          const knots = vals.map((_, i) => i * 0.7);
          const values = periodic ? [...vals.slice(0, -1), vals[0]] : vals;
          const s = createSupport(splineSupport(knots, values, { periodic }));
          const hi = lo + width;
          const m = s.minRho(lo, hi);
          expect(m.psi).toBeGreaterThanOrEqual(lo - 1e-12);
          expect(m.psi).toBeLessThanOrEqual(hi + 1e-12);
          // ρ' jumps at the knots, so the knots are sampled too; between them
          // ρ is a smooth cubic and a spacing of width/4000 misses little.
          const psis = Array.from({ length: 4001 }, (_, j) => lo + (width * j) / 4000);
          const period = knots[knots.length - 1];
          for (const t of knots) {
            if (!periodic) psis.push(t);
            else for (let k = Math.floor((lo - t) / period); t + k * period <= hi; k++) psis.push(t + k * period);
          }
          let sampled = Infinity;
          for (const t of psis) if (t >= lo && t <= hi) sampled = Math.min(sampled, s.rho(t));
          expect(m.value).toBeLessThanOrEqual(sampled + 1e-12);
          expect(sampled - m.value).toBeLessThan(1e-6 + 1e-3 * Math.abs(m.value));
          expect(Math.abs(s.rho(m.psi) - m.value)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('serialized spline data', () => {
  const good = () => /** @type {any} */ (splineSupport([0, 1, 2, 3], [0.02, 0.03, 0.025, 0.028]));

  it('rejects non-finite or unordered knots, wrong lengths and discontinuous coefficients', () => {
    const nanKnot = good();
    nanKnot.knots = Float64Array.from([0, NaN, 2, 3]);
    expect(() => createSupport(nanKnot)).toThrow(RangeError);
    const short = good();
    short.coeffs = short.coeffs.slice(0, 8);
    expect(() => createSupport(short)).toThrow(/matching/);
    const jump = good();
    jump.coeffs = Float64Array.from(jump.coeffs);
    jump.coeffs[4] += 0.001;
    expect(() => createSupport(jump)).toThrow(/continuous/);
    const infinite = good();
    infinite.coeffs = Float64Array.from(infinite.coeffs);
    infinite.coeffs[1] = Infinity;
    expect(() => createSupport(infinite)).toThrow(/finite/);
  });

  it('checks each derivative order on its own scale', () => {
    // Knots 1e-3 rad apart with a 5 µm bump: the cubic
    // coefficient is about 1e4, so one tolerance scaled by the largest
    // coefficient (1e-5 m) would hide a 1 µm jump in the value.
    const make = () => /** @type {any} */ (splineSupport([0, 1e-3, 2e-3], [0.03, 0.030005, 0.03]));
    expect(Math.max(...Array.from(make().coeffs, Math.abs))).toBeGreaterThan(1e3);
    expect(() => createSupport(make())).not.toThrow();
    for (const [index, delta] of [[4, 1e-6], [5, 1e-6], [6, 1e-3]]) {
      const bad = make();
      bad.coeffs = Float64Array.from(bad.coeffs);
      bad.coeffs[index] += delta;
      expect(() => createSupport(bad)).toThrow(/continuous/);
    }
    // Splines built by splineSupport pass, also with 20000 intervals.
    const n = 20000;
    const knots = Array.from({ length: n + 1 }, (_, i) => (2 * Math.PI * i) / n);
    const values = knots.map((t) => 0.03 + 0.004 * Math.cos(t) + 0.001 * Math.sin(3 * t));
    values[n] = values[0];
    expect(() => createSupport(splineSupport(knots, values, { periodic: true }))).not.toThrow();
  });

  it('rejects tracks outside the input domain', () => {
    // p' of about 15 m (a 1 mm bump over 1e-4 rad) and p'' of 5e23 m.
    expect(() => createSupport(splineSupport([0, 1e-4, 2e-4], [0.03, 0.031, 0.03]))).toThrow(/at most 10 m/);
    const steep = /** @type {any} */ ({ kind: 'spline', knots: Float64Array.from([0, 1]), coeffs: Float64Array.from([0.03, 1e12, 5e23, 0]), cumulative: new Float64Array(2), periodic: false });
    expect(() => createSupport(steep)).toThrow(/at most/);
    expect(() => createSupport(ellipse({ a: 1e-200, b: 1e-200, offset: 0.03 }))).toThrow(/semi-axes/);
    expect(() => createSupport(ellipse({ a: 11, b: 0.03 }))).toThrow(/semi-axes/);
    expect(() => createSupport(eccentricCircle({ radius: 0.03, offset: 11 }))).toThrow(/offset/);
    expect(() => createSupport(offset(eccentricCircle({ radius: 0.03 }), -11))).toThrow(/offset/);
    expect(() => createSupport(eccentricCircle({ radius: 0 }))).not.toThrow();
    expect(() => createSupport(eccentricCircle({ radius: 0.03, phase: 2e4 }))).toThrow(/phase/);
    expect(() => createSupport(ellipse({ a: 0.05, b: 0.02, axisAngle: 1e16 }))).toThrow(/angles/);
    // An ellipse offset angle just beyond the limit; no π of slack.
    expect(() => createSupport(ellipse({ a: 0.05, b: 0.02, offsetAngle: 10001 }))).toThrow(/angles/);
    expect(() => createSupport(ellipse({ a: 0.02, b: 0.05, axisAngle: 1e4 }))).not.toThrow();
    expect(() => createSupport(ellipse({ a: 0.02, b: 0.05, axisAngle: -1e4 }))).not.toThrow();
    const beyond = { kind: 'ellipse', a: 0.02, b: 0.05, axisAngle: 1e4 + 0.1, offset: 0, offsetAngle: 0 };
    expect(() => createSupport(/** @type {any} */ (beyond))).toThrow(/angles/);
    // Knots at least 1e-6 rad apart: a period of 3e-320 rad breaks the wrap count.
    expect(() => createSupport(splineSupport([0, 1e-320, 2e-320, 3e-320], [0.03, 0.03, 0.03, 0.03], { periodic: true }))).toThrow(/at least 0\.000001 rad/);
    expect(() => createSupport(splineSupport([0, 1e-6, 2e-6, 3e-6], [0.03, 0.03, 0.03, 0.03], { periodic: true }))).not.toThrow();
    // At most 100000 intervals, checked before the knots are read.
    const long = { kind: 'spline', knots: { length: 100002 }, coeffs: { length: 400004 }, cumulative: [], periodic: false };
    expect(() => createSupport(/** @type {any} */ (long))).toThrow(/at most 100000 intervals/);
    expect(() => splineSupport(/** @type {any} */ ({ length: 100002 }), /** @type {any} */ ({ length: 100002 }))).toThrow(/100000 intervals/);
    // An iterator on the arguments is never called: exactly the declared
    // number of entries is copied.
    const endless = (/** @type {number} */ value) => ({
      length: 4,
      0: 0, 1: 1, 2: 2, 3: 3,
      *[Symbol.iterator]() { for (;;) yield value; },
    });
    const knotsLike = endless(0);
    const valuesLike = { ...endless(0.03), 0: 0.03, 1: 0.03, 2: 0.03, 3: 0.03 };
    const fromLike = splineSupport(/** @type {any} */ (knotsLike), /** @type {any} */ (valuesLike));
    expect(Array.from(fromLike.knots)).toEqual([0, 1, 2, 3]);
    expect(fromLike.coeffs.length).toBe(12);
    expect(() => splineSupport(/** @type {any} */ ({ length: 3.5 }), /** @type {any} */ ({ length: 3.5 }))).toThrow(RangeError);
    const farKnot = /** @type {any} */ (splineSupport([1e4, 1e4 + 1, 1e4 + 2], [0.03, 0.03, 0.03]));
    expect(() => createSupport(farKnot)).toThrow(/at most 10000 rad/);
  });

  it('finds a rounding-level minimum of a weakly convex track within the concavity tolerance', () => {
    // p + p'' = (t − a)² ≥ 0 with its zero inside [0, 0.5].
    const a = 3 / 100003;
    const weak = /** @type {any} */ ({ kind: 'spline', knots: Float64Array.from([0, 1]), coeffs: Float64Array.from([a * a - 2, -2 * a, 1, 0]), cumulative: new Float64Array(2), periodic: false });
    const m = createSupport(weak).minRho(0, 0.5);
    expect(Math.abs(m.value)).toBeLessThan(1e-15);
    expect(m.value).toBeGreaterThan(-CONCAVITY_TOLERANCE);
    expect(m.psi).toBeCloseTo(a, 6);
  });

  it('bounds spline values between the knots', () => {
    const open = (/** @type {number[]} */ knots, /** @type {number[]} */ coeffs) =>
      /** @type {any} */ ({ kind: 'spline', knots: Float64Array.from(knots), coeffs: Float64Array.from(coeffs), cumulative: new Float64Array(knots.length), periodic: false });
    // p = 10 + 10·t − (10/6)·t² on [0, 6]: 10 m at both ends, 25 m at t = 3.
    expect(() => createSupport(open([-3, 3], [10, 10, -10 / 6, 0]))).toThrow(/at most 10 m/);
    // p = −8 + 12·t² − 4·t³ on [0, 2]: |p| ≤ 8 m, p' = 0 at both ends, 12 m at t = 1.
    expect(() => createSupport(open([0, 2], [-8, 0, 12, -4]))).toThrow(/at most 10 m/);
    expect(() => createSupport(open([0, 2], [-6, 0, 9, -3]))).not.toThrow();
  });

  it('reduces the ellipse axis angle modulo π without changing the track', () => {
    const plain = createSupport(ellipse({ a: 0.05, b: 0.02, axisAngle: 0.3 }));
    const turned = createSupport(ellipse({ a: 0.05, b: 0.02, axisAngle: 0.3 + 3183 * Math.PI }));
    const swapped = createSupport(/** @type {any} */ ({ kind: 'ellipse', a: 0.02, b: 0.05, axisAngle: 0.3 - Math.PI / 2 - 1000 * Math.PI, offset: 0, offsetAngle: 0 }));
    for (const s of [turned, swapped]) {
      expect(Math.abs(/** @type {any} */ (s).axisAngle - 0.3)).toBeLessThan(1e-9);
      for (const psi of [-2, 0, 1, 4]) {
        expect(s.p(psi)).toBeCloseTo(plain.p(psi), 12);
        expect(s.P(psi)).toBeCloseTo(plain.P(psi), 12);
      }
    }
    // P is the integral of p from 0: about 0.035 m over [0, 1].
    let integral = 0;
    for (let k = 0; k < 2000; k++) integral += plain.p((k + 0.5) / 2000) / 2000;
    expect(turned.P(1)).toBeCloseTo(integral, 8);
  });

  it('recomputes the cumulative integrals from the coefficients', () => {
    const tampered = good();
    tampered.cumulative = Float64Array.from(tampered.cumulative, () => 1e9);
    expect(createSupport(tampered).P(2.5)).toBeCloseTo(createSupport(good()).P(2.5), 15);
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
