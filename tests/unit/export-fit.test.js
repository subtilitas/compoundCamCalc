import { beforeAll, describe, expect, it } from 'vitest';
import { EXPORT_TOLERANCE, evaluate, fitSupport } from '../../src/core/bspline.js';
import { solve } from '../../src/core/solve.js';
import { createSupport, stringTrackSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';

/** @typedef {import('../../src/core/bspline.js').BSpline} BSpline */
/** @typedef {import('../../src/core/support.js').SupportData} SupportData */
/** @typedef {import('../../src/core/support.js').Support} Support */

const TURN = 2 * Math.PI;
/** Check points per knot interval. */
const SAMPLES = 64;
/** Allowed shortfall of the radius of curvature below the smallest ρ of the track (m). */
const RHO_SHORTFALL = 1e-6;
const GOLDEN = (Math.sqrt(5) - 1) / 2;
const BUF = new Float64Array(3);

/**
 * Signed distance of S from the convex track, independent of core/bspline:
 * the largest S·n(ψ) − p(ψ) near psiGuess (the support function of a convex
 * curve gives its signed distance), by golden-section search.
 * @param {Support} support
 * @param {number} x
 * @param {number} y
 * @param {number} psiGuess
 */
function signedDistance(support, x, y, psiGuess) {
  const f = (/** @type {number} */ psi) => x * Math.cos(psi) + y * Math.sin(psi) - support.evaluate(psi, BUF)[0];
  let a = psiGuess - 0.02;
  let b = psiGuess + 0.02;
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = f(c);
  let fd = f(d);
  // 0.04 rad·0.618^24 ≈ 4e-7 rad; the error of d is quadratic in it.
  for (let i = 0; i < 24; i++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = f(d);
    }
  }
  // The maximum lies inside the window, not at its edge.
  if (!(Math.abs((a + b) / 2 - psiGuess) < 0.019)) return Infinity;
  return Math.max(fc, fd);
}

/**
 * Checks a fitted spline against its track at SAMPLES points per knot
 * interval: normal deviation, convexity, radius of curvature, closure.
 * @param {SupportData} data
 * @param {BSpline} spline
 * @param {number} psiStart
 * @param {number} tol
 * @returns {{ deviation: number, radius: number }} largest deviation and smallest radius found (m)
 */
function verify(data, spline, psiStart, tol) {
  const support = createSupport(data);
  const rhoMin = support.minRho(psiStart, psiStart + TURN).value;
  const { knots, points } = spline;
  expect(knots.length).toBe(points.length / 2 + 4);
  expect(spline.closed).toBe(true);
  expect(points[points.length - 2]).toBe(points[0]);
  expect(points[points.length - 1]).toBe(points[1]);
  expect(knots[knots.length - 1]).toBeCloseTo(TURN, 12);
  const out = new Float64Array(6);
  let deviation = 0;
  let radius = Infinity;
  let convex = true;
  for (let s = 3; s < knots.length - 4; s++) {
    const [ua, ub] = [knots[s], knots[s + 1]];
    if (!(ub > ua)) continue;
    for (let k = 0; k < SAMPLES; k++) {
      const u = ua + ((ub - ua) * k) / SAMPLES;
      evaluate(spline, u, out);
      deviation = Math.max(deviation, Math.abs(signedDistance(support, out[0], out[1], psiStart + u)));
      const cross = out[2] * out[5] - out[3] * out[4];
      if (!(cross > 0)) convex = false;
      radius = Math.min(radius, Math.hypot(out[2], out[3]) ** 3 / cross);
    }
  }
  expect(convex).toBe(true);
  expect(deviation).toBeLessThanOrEqual(tol);
  expect(radius).toBeGreaterThanOrEqual(rhoMin - RHO_SHORTFALL);
  return { deviation, radius };
}

describe('export fit of the default preset', () => {
  /** @type {[string, SupportData, number][]} */
  let curves = [];
  /** @type {Map<string, BSpline>} */
  const fits = new Map();
  let elapsed = 0;

  beforeAll(() => {
    const result = solve(defaultState());
    expect(result.status).toBe('ok');
    const t = result.tracks;
    const start = t.cable?.psiStart ?? NaN;
    const need = (/** @type {SupportData | null} */ d) => {
      if (!d) throw new Error('missing track');
      return d;
    };
    curves = [
      ['string pitch', need(t.stringPitch), 0],
      ['string groove', need(t.grooves.string), 0],
      ['string flange', need(t.flanges.string), 0],
      ['cable pitch', need(t.cablePitch), start],
      ['cable groove', need(t.grooves.cable), start],
      ['cable flange', need(t.flanges.cable), start],
    ];
    const t0 = performance.now();
    for (const [name, data, psiStart] of curves) {
      const { spline, error } = fitSupport(data, psiStart, psiStart + TURN, EXPORT_TOLERANCE);
      expect(error).toBe(null);
      if (spline) fits.set(name, spline);
    }
    elapsed = performance.now() - t0;
  });

  it('fits all six curves quickly', () => {
    expect(fits.size).toBe(6);
    // About 0.2 s on a desktop; the bound leaves room for coverage runs.
    expect(elapsed).toBeLessThan(2000);
  });

  for (const name of ['string pitch', 'string groove', 'string flange', 'cable pitch', 'cable groove', 'cable flange']) {
    it(`keeps the ${name} within tolerance, convex and closed`, () => {
      const entry = curves.find(([n]) => n === name);
      const spline = fits.get(name);
      if (!entry || !spline) throw new Error('fit missing');
      const { deviation } = verify(entry[1], spline, entry[2], EXPORT_TOLERANCE);
      expect(spline.maxDeviation).toBeLessThanOrEqual(EXPORT_TOLERANCE / 2);
      expect(spline.maxDeviation).toBeLessThanOrEqual(deviation + 1e-9);
    });
  }
});

describe('export fit of an ellipse string track', () => {
  it('meets a tolerance of 1e-6 m', () => {
    const state = structuredClone(defaultState());
    state.stringTrack.shape = 'ellipse';
    const data = stringTrackSupport(state.stringTrack, state.cords.stringDiameter);
    const tol = 1e-6;
    const { spline, error } = fitSupport(data, 0.4, 0.4 + TURN, tol);
    expect(error).toBe(null);
    if (!spline) throw new Error('fit failed');
    verify(data, spline, 0.4, tol);
  });
});

describe('fitSupport errors', () => {
  const circle = /** @type {SupportData} */ ({ kind: 'eccentric', radius: 0.04, offset: 0, phase: 0 });

  it('returns { spline: null, error } for bad data, ranges and tolerances', () => {
    for (const [data, a, b, tol] of /** @type {[any, number, number, number][]} */ ([
      [null, 0, 1, EXPORT_TOLERANCE],
      [{ kind: 'nope' }, 0, 1, EXPORT_TOLERANCE],
      [{ kind: 'offset', base: { kind: 'ellipse', a: -1, b: 0.02, axisAngle: 0, offset: 0, offsetAngle: 0 }, delta: 0 }, 0, 1, EXPORT_TOLERANCE],
      [circle, 1, 1, EXPORT_TOLERANCE],
      [circle, 1, 0.5, EXPORT_TOLERANCE],
      [circle, NaN, 1, EXPORT_TOLERANCE],
      [circle, 0, Infinity, EXPORT_TOLERANCE],
      [circle, 0, 1, NaN],
      [circle, 0, 1, Infinity],
      [circle, 0, 1, 0],
      [circle, 0, 1, -1e-5],
    ])) {
      const r = fitSupport(data, a, b, tol);
      expect(r.spline).toBe(null);
      expect(typeof r.error).toBe('string');
    }
  });
});
