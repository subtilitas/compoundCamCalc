import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cholesky, choleskySolve, solveLinear } from '../../src/core/linalg.js';
import { solveQP } from '../../src/core/qp.js';

/**
 * KKT residuals of a QP result: stationarity G·x + a − Cᵀ·λ, primal
 * feasibility, dual feasibility and complementarity.
 * @param {import('../../src/core/qp.js').QuadraticProgram} qp
 * @param {import('../../src/core/qp.js').QPResult} r
 */
function kkt(qp, r) {
  const { n, G, a, C, b } = qp;
  const meq = qp.meq ?? 0;
  const m = b.length;
  let stationarity = 0;
  for (let i = 0; i < n; i++) {
    let g = a[i];
    for (let j = 0; j < n; j++) g += G[i * n + j] * r.x[j];
    for (let k = 0; k < m; k++) g -= r.lambda[k] * C[k * n + i];
    stationarity = Math.max(stationarity, Math.abs(g));
  }
  let feasibility = 0;
  let dual = 0;
  let complementarity = 0;
  for (let k = 0; k < m; k++) {
    let s = -b[k];
    for (let j = 0; j < n; j++) s += C[k * n + j] * r.x[j];
    feasibility = Math.max(feasibility, k < meq ? Math.abs(s) : -s);
    if (k >= meq) dual = Math.max(dual, -r.lambda[k]);
    complementarity = Math.max(complementarity, Math.abs(s * r.lambda[k]));
  }
  return { stationarity, feasibility, dual, complementarity };
}

describe('dense linear algebra', () => {
  it('solves a symmetric positive definite system by Cholesky and a general system by elimination', () => {
    const A = Float64Array.from([4, 2, 0.4, 2, 5, 1, 0.4, 1, 3]);
    const L = /** @type {Float64Array} */ (cholesky(A, 3));
    const x = choleskySolve(L, 3, Float64Array.from([1, 2, 3]));
    const y = /** @type {Float64Array} */ (solveLinear(A, [1, 2, 3], 3));
    for (let i = 0; i < 3; i++) {
      expect(x[i]).toBeCloseTo(y[i], 14);
      expect(A[i * 3] * x[0] + A[i * 3 + 1] * x[1] + A[i * 3 + 2] * x[2]).toBeCloseTo(i + 1, 14);
    }
    expect(cholesky(Float64Array.from([1, 2, 2, 1]), 2)).toBeNull();
    expect(solveLinear([1, 2, 2, 4], [1, 1], 2)).toBeNull();
    // Pivoting: a zero on the diagonal.
    expect(Array.from(/** @type {Float64Array} */ (solveLinear([0, 1, 1, 0], [2, 3], 2)))).toEqual([3, 2]);
  });
});

describe('solveQP', () => {
  it('projects onto a half plane: min ½|x|² − x − y with x + y ≤ 1', () => {
    const qp = { n: 2, G: Float64Array.from([1, 0, 0, 1]), a: Float64Array.from([-1, -1]), C: Float64Array.from([-1, -1]), b: Float64Array.from([-1]) };
    const r = solveQP(qp);
    expect(r.status).toBe('optimal');
    expect(r.x[0]).toBeCloseTo(0.5, 14);
    expect(r.x[1]).toBeCloseTo(0.5, 14);
    expect(r.lambda[0]).toBeCloseTo(0.5, 14);
    expect(r.active).toEqual([0]);
    expect(r.value).toBeCloseTo(-0.75, 14);
  });

  it('solves the quadprog reference problem', () => {
    // min −(0, 5, 0)·x + ½|x|² subject to Aᵀx ≥ (−8, 2, 0), solution from
    // the R package quadprog documentation.
    const qp = {
      n: 3,
      G: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      a: Float64Array.from([0, -5, 0]),
      C: Float64Array.from([-4, -3, 0, 2, 1, 0, 0, -2, 1]),
      b: Float64Array.from([-8, 2, 0]),
    };
    const r = solveQP(qp);
    expect(r.status).toBe('optimal');
    const expected = [0.4761904761904762, 1.0476190476190477, 2.0952380952380953];
    for (let i = 0; i < 3; i++) expect(r.x[i]).toBeCloseTo(expected[i], 12);
    expect(r.value).toBeCloseTo(-2.380952380952381, 12);
  });

  it('keeps equality constraints active with multipliers of either sign', () => {
    // min ½|x|² − 4·x_1 with x_1 + x_2 + x_3 = 3 and x_1 ≤ 1.5.
    const qp = {
      n: 3,
      G: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      a: Float64Array.from([-4, 0, 0]),
      C: Float64Array.from([1, 1, 1, -1, 0, 0]),
      b: Float64Array.from([3, -1.5]),
      meq: 1,
    };
    const r = solveQP(qp);
    expect(r.status).toBe('optimal');
    expect(Array.from(r.x).map((v) => Number(v.toFixed(12)))).toEqual([1.5, 0.75, 0.75]);
    expect(r.lambda[0]).toBeCloseTo(0.75, 12);
    // x_1 − 4 = λ_0 − λ_1.
    expect(r.lambda[1]).toBeCloseTo(3.25, 12);
    // An equality already satisfied at the unconstrained minimum, and one
    // with a negative multiplier.
    const r2 = solveQP({ ...qp, a: Float64Array.from([0, 0, 0]), b: Float64Array.from([0, -1.5]) });
    expect(r2.status).toBe('optimal');
    for (const v of r2.x) expect(Math.abs(v)).toBe(0);
    const r3 = solveQP({ ...qp, b: Float64Array.from([-3, -1.5]) });
    expect(r3.status).toBe('optimal');
    expect(r3.lambda[0]).toBeLessThan(0);
    expect(r3.x[0] + r3.x[1] + r3.x[2]).toBeCloseTo(-3, 12);
  });

  it('drops a constraint whose multiplier would turn negative', () => {
    // min ½|x − (2, 2)|² with x_1 ≤ 1, x_1 + x_2 ≤ 1.5: the first constraint
    // enters first and leaves when the second becomes active.
    const qp = {
      n: 2,
      G: Float64Array.from([1, 0, 0, 1]),
      a: Float64Array.from([-2, -2]),
      C: Float64Array.from([-1, 0, -1, -1]),
      b: Float64Array.from([-1, -1.5]),
    };
    const r = solveQP(qp);
    expect(r.status).toBe('optimal');
    expect(r.x[0]).toBeCloseTo(0.75, 14);
    expect(r.x[1]).toBeCloseTo(0.75, 14);
    expect(r.active).toEqual([1]);
    expect(r.lambda[0]).toBe(0);
  });

  it('reports infeasible constraints, a non-convex objective and the iteration limit', () => {
    const G = Float64Array.from([1]);
    const a = Float64Array.from([0]);
    expect(solveQP({ n: 1, G, a, C: Float64Array.from([1, -1]), b: Float64Array.from([1, 0]) }).status).toBe('infeasible');
    expect(solveQP({ n: 1, G: Float64Array.from([-1]), a, C: new Float64Array(0), b: new Float64Array(0) }).status).toBe('not-convex');
    const box = {
      n: 2,
      G: Float64Array.from([1, 0, 0, 1]),
      a: Float64Array.from([-5, -5]),
      C: Float64Array.from([-1, 0, 0, -1]),
      b: Float64Array.from([-1, -1]),
    };
    expect(solveQP(box, { maxIterations: 1 }).status).toBe('max-iterations');
    expect(solveQP(box).status).toBe('optimal');
    // Duplicated equality constraints are linearly dependent.
    const twice = { n: 2, G: box.G, a: box.a, C: Float64Array.from([1, 1, 1, 1]), b: Float64Array.from([1, 1]), meq: 2 };
    expect(solveQP(twice).status).toBe('infeasible');
  });

  it('meets the KKT conditions on random convex problems to 1e-10', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 1, max: 2 ** 30 }),
        (n, m, meqWanted, seed) => {
          let state = seed;
          const rnd = () => {
            state = (state * 16807) % 2147483647;
            return (state / 2147483647) * 2 - 1;
          };
          const meq = Math.min(meqWanted, n - 1);
          const A = Array.from({ length: n * n }, rnd);
          const G = new Float64Array(n * n);
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              let s = i === j ? 0.1 : 0;
              for (let k = 0; k < n; k++) s += A[i * n + k] * A[j * n + k];
              G[i * n + j] = s;
            }
          }
          const a = Float64Array.from({ length: n }, () => 3 * rnd());
          // Constraints through a known point, so the problem is feasible.
          const x0 = Array.from({ length: n }, rnd);
          const C = Float64Array.from({ length: (m + meq) * n }, rnd);
          const b = new Float64Array(m + meq);
          for (let k = 0; k < m + meq; k++) {
            let s = 0;
            for (let j = 0; j < n; j++) s += C[k * n + j] * x0[j];
            b[k] = k < meq ? s : s - Math.abs(rnd());
          }
          const qp = { n, G, a, C, b, meq };
          const r = solveQP(qp);
          expect(r.status).toBe('optimal');
          const e = kkt(qp, r);
          expect(e.stationarity).toBeLessThan(1e-10);
          expect(e.feasibility).toBeLessThan(1e-10);
          expect(e.dual).toBeLessThanOrEqual(0);
          expect(e.complementarity).toBeLessThan(1e-10);
        },
      ),
      { numRuns: 300 },
    );
  });
});
