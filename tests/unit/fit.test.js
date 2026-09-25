import { describe, expect, it } from 'vitest';
import { fitCableTrack } from '../../src/core/fit.js';
import { createSupport, eccentricCircle } from '../../src/core/support.js';

const DEG = Math.PI / 180;

/**
 * Samples of p on [a, b].
 * @param {(psi: number) => number} p
 * @param {number} a
 * @param {number} b
 * @param {number} count
 */
function samples(p, a, b, count) {
  const psi = Float64Array.from({ length: count + 1 }, (_, k) => a + ((b - a) * k) / count);
  return { psi, p: Float64Array.from(psi, p) };
}

/**
 * Smallest ρ and p of a fitted spline on a fine grid.
 * @param {import('../../src/core/support.js').SplineData} spline
 * @param {number} a
 * @param {number} b
 */
function extremes(spline, a, b) {
  const s = createSupport(spline);
  let minRho = Infinity;
  let minP = Infinity;
  for (let k = 0; k <= 4000; k++) {
    const psi = a + ((b - a) * k) / 4000;
    minRho = Math.min(minRho, s.rho(psi));
    minP = Math.min(minP, s.p(psi));
  }
  return { minRho, minP, s };
}

describe('constrained cable track fit', () => {
  const start = 3.3;
  const end = start + 250 * DEG;

  it('reproduces a track that meets the limits, with no active constraint', () => {
    const circle = createSupport(eccentricCircle({ radius: 0.02, offset: 0.008, phase: 1 }));
    const data = samples((psi) => circle.p(psi), start, end, 500);
    const r = fitCableTrack({ ...data, start, end, rhoMin: 0.005, pMin: 0.008 });
    expect(r.status).toBe('optimal');
    expect(r.active).toBe(0);
    expect(r.unknowns).toBeGreaterThanOrEqual(20);
    expect(r.unknowns).toBeLessThanOrEqual(40);
    expect(r.maxDeviation).toBeLessThan(1e-7);
    expect(r.rms).toBeLessThan(r.maxDeviation + 1e-18);
  });

  it('meets ρ ≥ ρ_min and p ≥ p_min where the samples violate them', () => {
    // p = 20 mm + 10 mm·cos 3ψ has ρ = 20 mm − 80 mm·cos 3ψ, negative in places,
    // and dips to 10 mm.
    const wavy = (/** @type {number} */ psi) => 0.02 + 0.01 * Math.cos(3 * psi);
    const data = samples(wavy, start, end, 600);
    const rhoMin = 0.005;
    const pMin = 0.013;
    const before = { minRho: Math.min(...Array.from(data.psi, (psi) => 0.02 - 0.08 * Math.cos(3 * psi))), minP: Math.min(...data.p) };
    expect(before.minRho).toBeLessThan(0);
    expect(before.minP).toBeLessThan(pMin);
    const r = fitCableTrack({ ...data, start, end, rhoMin, pMin });
    expect(r.status).toBe('optimal');
    expect(r.active).toBeGreaterThan(0);
    const e = extremes(/** @type {any} */ (r.spline), start, end);
    // The constraints hold on the constraint grid; between grid points the
    // cubic pieces may dip by a few micrometres.
    expect(e.minRho).toBeGreaterThan(rhoMin - 5e-6);
    expect(e.minP).toBeGreaterThan(pMin - 1e-7);
    expect(r.minRho).toBeCloseTo(e.minRho, 6);
    // Still close to the samples where they are feasible.
    expect(Math.abs(e.s.p(start + 0.5) - wavy(start + 0.5))).toBeLessThan(0.005);
  });

  it('passes through prescribed points with prescribed integrals', () => {
    const circle = createSupport(eccentricCircle({ radius: 0.025, offset: 0.006, phase: -0.4 }));
    const noisy = (/** @type {number} */ psi) => circle.p(psi) + 0.0004 * Math.sin(40 * psi);
    const data = samples(noisy, start, end, 400);
    const through = [start + 60 * DEG, start + 170 * DEG, end].map((psi) => ({
      psi,
      p: circle.p(psi),
      integral: circle.P(psi) - circle.P(start),
    }));
    const r = fitCableTrack({ ...data, start, end, rhoMin: 0.005, pMin: 0.008, startValue: circle.p(start), through });
    expect(r.status).toBe('optimal');
    const s = createSupport(/** @type {any} */ (r.spline));
    expect(s.p(start)).toBeCloseTo(circle.p(start), 12);
    for (const q of through) {
      expect(Math.abs(s.p(q.psi) - q.p)).toBeLessThan(1e-12);
      expect(Math.abs(s.P(q.psi) - s.P(start) - q.integral)).toBeLessThan(1e-12);
    }
    // Points outside (start, end] are ignored.
    const outside = fitCableTrack({ ...data, start, end, rhoMin: 0.005, pMin: 0.008, through: [{ psi: start - 1, p: 1, integral: 1 }] });
    expect(outside.status).toBe('optimal');
  });

  it('handles sparse samples and reports contradictory limits and invalid input', () => {
    const half = samples((psi) => 0.02 + 0.002 * psi, start, start + 80 * DEG, 100);
    const sparse = fitCableTrack({ ...half, start, end, rhoMin: 0.005, pMin: 0.008 });
    expect(sparse.status).toBe('optimal');
    const data = samples(() => 0.02, start, end, 100);
    // p(ψ_0) = 5 mm contradicts p ≥ 8 mm.
    expect(fitCableTrack({ ...data, start, end, rhoMin: 0.005, pMin: 0.008, startValue: 0.005 }).status).toBe('infeasible');
    expect(fitCableTrack({ ...data, start: end, end: start, rhoMin: 0.005, pMin: 0.008 }).status).toBe('invalid');
    expect(fitCableTrack({ psi: [1], p: [0.02], start, end, rhoMin: 0.005, pMin: 0.008 }).status).toBe('invalid');
    expect(fitCableTrack({ psi: [1, 2], p: [0.02], start, end, rhoMin: 0.005, pMin: 0.008 }).spline).toBeNull();
    // Non-finite samples are skipped.
    const holes = { psi: Float64Array.from(data.psi), p: Float64Array.from(data.p) };
    holes.p[10] = NaN;
    expect(fitCableTrack({ ...holes, start, end, rhoMin: 0.005, pMin: 0.008 }).status).toBe('optimal');
  });

  it('returns invalid instead of throwing or ignoring a limit for out-of-range input', () => {
    const data = samples(() => 0.02, start, end, 100);
    const base = { ...data, start, end, rhoMin: 0.005, pMin: 0.008 };
    expect(fitCableTrack(base).status).toBe('optimal');
    /** @type {Partial<import('../../src/core/fit.js').FitInput>[]} */
    const bad = [
      { intervals: 0 },
      { intervals: -1 },
      { intervals: NaN },
      { intervals: 1.5 },
      { intervals: 201 },
      { gridPerInterval: -1 },
      { gridPerInterval: 0 },
      { gridPerInterval: 2.5 },
      { gridPerInterval: 51 },
      { end: Infinity },
      { start: -Infinity },
      { start: NaN },
      { end: 2e6 },
      { start: 1, end: 1 + 1e-15 },
      { rhoMin: NaN },
      { rhoMin: Infinity },
      { pMin: NaN },
      { pMin: -Infinity },
      { startValue: Infinity },
      { startValue: NaN },
      { margin: NaN },
      { p: Float64Array.from(data.p, () => NaN) },
      { ends: { start: [0.02, NaN, 0], end: [0.02, 0, 0] } },
      { ends: { start: [0.02, 0, 0], end: [0.02, 0] } },
    ];
    for (const change of bad) {
      const r = fitCableTrack({ ...base, ...change });
      expect(r.status).toBe('invalid');
      expect(r.spline).toBeNull();
    }
    // The smallest accepted knot spacing is 1e-9·max(1, |start|, |end|).
    expect(fitCableTrack({ ...base, start: 1, end: 1 + 2e-9, intervals: 1 }).status).toBe('optimal');
    expect(fitCableTrack({ ...base, start: 1, end: 1 + 5e-10, intervals: 1 }).status).toBe('invalid');
    expect(fitCableTrack({ ...base, intervals: 200, gridPerInterval: 1 }).status).toBe('optimal');
  });
});
