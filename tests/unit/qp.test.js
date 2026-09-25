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

/**
 * True when the rows `set` of C (m×n) are linearly independent: Gaussian
 * elimination with a pivot threshold of 1e-9 times the largest entry.
 * @param {Float64Array} C
 * @param {number} n
 * @param {number[]} set
 */
function independent(C, n, set) {
  const rows = set.map((i) => Array.from(C.subarray(i * n, (i + 1) * n)));
  const big = Math.max(1, ...rows.flat().map(Math.abs));
  let rank = 0;
  for (let col = 0; col < n && rank < rows.length; col++) {
    let p = rank;
    for (let r = rank + 1; r < rows.length; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[p][col])) p = r;
    if (Math.abs(rows[p][col]) <= 1e-9 * big) continue;
    [rows[rank], rows[p]] = [rows[p], rows[rank]];
    for (let r = rank + 1; r < rows.length; r++) {
      const f = rows[r][col] / rows[rank][col];
      for (let c = col; c < n; c++) rows[r][c] -= f * rows[rank][c];
    }
    rank++;
  }
  return rank === rows.length;
}

/**
 * Brute-force solution of a small QP: the minimum over each set of
 * linearly independent constraints taken as equalities (KKT system solved
 * directly) that meets all constraints to 1e-10·(1 + size of their terms)
 * and has non-negative inequality multipliers. The minimum of a strictly
 * convex QP is unique and such a set exists when the constraints are
 * feasible, so null means infeasible.
 * @param {import('../../src/core/qp.js').QuadraticProgram} qp
 * @returns {Float64Array | null}
 */
function bruteForce(qp) {
  const { n, G, a, C, b } = qp;
  const meq = qp.meq ?? 0;
  const m = b.length;
  for (let mask = 0; mask < 1 << m; mask++) {
    /** @type {number[]} */
    const set = [];
    for (let i = 0; i < m; i++) if (mask & (1 << i)) set.push(i);
    if (set.length > n || !independent(C, n, set)) continue;
    const size = n + set.length;
    const K = new Float64Array(size * size);
    const rhs = new Float64Array(size);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) K[i * size + j] = G[i * n + j];
      rhs[i] = -a[i];
    }
    set.forEach((c, t) => {
      for (let j = 0; j < n; j++) {
        K[j * size + n + t] = -C[c * n + j];
        K[(n + t) * size + j] = C[c * n + j];
      }
      rhs[n + t] = b[c];
    });
    const sol = solveLinear(K, rhs, size);
    if (!sol) continue;
    let ok = set.every((c, t) => c < meq || sol[n + t] >= -1e-9);
    for (let i = 0; i < m && ok; i++) {
      let s = -b[i];
      let size = Math.abs(b[i]);
      for (let j = 0; j < n; j++) {
        s += C[i * n + j] * sol[j];
        size += Math.abs(C[i * n + j] * sol[j]);
      }
      ok = i < meq ? Math.abs(s) <= 1e-10 * (1 + size) : s >= -1e-10 * (1 + size);
    }
    if (ok) return sol.slice(0, n);
  }
  return null;
}

/**
 * Small QPs with integer data: G = RᵀR + I, and rows that repeat, scale or
 * negate earlier rows, so dependent constraints, opposite inequalities and
 * degenerate vertices are common. With `feasible` the right-hand sides
 * pass through an integer point x_0 (equalities exactly, inequalities with
 * a gap of 0 to 2), otherwise they are integers from −5 to 5.
 * @param {boolean} feasible
 */
const smallQP = (feasible) =>
  fc.integer({ min: 1, max: 4 }).chain((n) => {
    const vector = (/** @type {number} */ length, /** @type {number} */ max) => fc.array(fc.integer({ min: -max, max }), { minLength: length, maxLength: length });
    return fc.record({
      n: fc.constant(n),
      R: vector(n * n, 2),
      a: vector(n, 5),
      x0: vector(n, 2),
      rows: fc.array(
        fc.record({ c: vector(n, 3), source: fc.nat(), factor: fc.constantFrom(0, 0, 1, -1, 2), gap: fc.integer({ min: 0, max: 2 }), b: fc.integer({ min: -5, max: 5 }) }),
        { maxLength: 6 },
      ),
      meq: fc.nat(6),
    }).map(({ R, a, x0, rows, meq }) => {
      const m = rows.length;
      const G = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let s = i === j ? 1 : 0;
          for (let k = 0; k < n; k++) s += R[k * n + i] * R[k * n + j];
          G[i * n + j] = s;
        }
      }
      const C = new Float64Array(m * n);
      const b = new Float64Array(m);
      const eq = Math.min(meq, m);
      rows.forEach((row, t) => {
        const c = t > 0 && row.factor !== 0 ? Array.from(C.subarray((row.source % t) * n, ((row.source % t) + 1) * n), (v) => row.factor * v) : row.c;
        C.set(c, t * n);
        b[t] = feasible ? c.reduce((s, v, j) => s + v * x0[j], 0) - (t < eq ? 0 : row.gap) : row.b;
      });
      return { n, G, a: Float64Array.from(a), C, b, meq: eq };
    });
  });

/**
 * Check a result against the brute-force solution x*: x to 1e-9 relative,
 * and the KKT conditions relative to the size of the terms of each sum.
 * @param {import('../../src/core/qp.js').QuadraticProgram} qp
 * @param {import('../../src/core/qp.js').QPResult} r
 * @param {Float64Array} ref
 */
function expectSolution(qp, r, ref) {
  const { n, G, a, C, b } = qp;
  const meq = qp.meq ?? 0;
  expect(r.status).toBe('optimal');
  expect(r.active.length).toBeLessThanOrEqual(n);
  const big = Math.max(1, ...Array.from(ref, Math.abs));
  for (let j = 0; j < n; j++) expect(Math.abs(r.x[j] - ref[j])).toBeLessThan(1e-9 * big);
  let residual = 0;
  let size = 0;
  for (let i = 0; i < n; i++) {
    let g = a[i];
    let terms = Math.abs(a[i]);
    for (let j = 0; j < n; j++) {
      g += G[i * n + j] * r.x[j];
      terms += Math.abs(G[i * n + j] * r.x[j]);
    }
    for (let k = 0; k < b.length; k++) {
      g -= r.lambda[k] * C[k * n + i];
      terms += Math.abs(r.lambda[k] * C[k * n + i]);
    }
    residual = Math.max(residual, Math.abs(g));
    size = Math.max(size, terms);
  }
  expect(residual).toBeLessThan(1e-12 * (1 + size));
  for (let k = 0; k < b.length; k++) {
    let s = -b[k];
    let terms = Math.abs(b[k]);
    for (let j = 0; j < n; j++) {
      s += C[k * n + j] * r.x[j];
      terms += Math.abs(C[k * n + j] * r.x[j]);
    }
    if (k < meq) {
      expect(Math.abs(s)).toBeLessThan(1e-12 * (1 + terms));
    } else {
      expect(s).toBeGreaterThan(-1e-12 * (1 + terms));
      expect(r.lambda[k]).toBeGreaterThanOrEqual(0);
      expect(Math.abs(s * r.lambda[k])).toBeLessThan(1e-12 * (1 + terms) * (1 + r.lambda[k]));
    }
  }
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
    // x + y = 1 twice is feasible: the second copy is redundant. With
    // x + y = 2 as the second copy the equalities contradict each other.
    const twice = { n: 2, G: box.G, a: box.a, C: Float64Array.from([1, 1, 1, 1]), b: Float64Array.from([1, 1]), meq: 2 };
    const r = solveQP(twice);
    expect(r.status).toBe('optimal');
    expect(r.x[0]).toBeCloseTo(0.5, 14);
    expect(r.x[1]).toBeCloseTo(0.5, 14);
    expect(solveQP({ ...twice, b: Float64Array.from([1, 2]) }).status).toBe('infeasible');
  });

  it('skips a dependent equality that holds and rejects one that does not', () => {
    // min ½|x|² − x − y: the unconstrained minimum is (1, 1).
    const G = Float64Array.from([1, 0, 0, 1]);
    const a = Float64Array.from([-1, -1]);
    /** @param {number[]} C @param {number[]} b */
    const equalities = (C, b) => solveQP({ n: 2, G, a, C: Float64Array.from(C), b: Float64Array.from(b), meq: b.length });
    for (const r of [equalities([1, 0, 1, 0], [0.2, 0.2]), equalities([1, 0, 2, 0], [0.2, 0.4])]) {
      expect(r.status).toBe('optimal');
      expect(r.x[0]).toBeCloseTo(0.2, 15);
      expect(r.x[1]).toBeCloseTo(1, 15);
      expect(r.active).toEqual([0]);
      expect(r.lambda[0]).toBeCloseTo(-0.8, 15);
      expect(r.lambda[1]).toBe(0);
    }
    // Three consistent equalities in two unknowns.
    const three = equalities([1, 0, 0, 1, 1, 1], [2, 2, 4]);
    expect(three.status).toBe('optimal');
    expect(Array.from(three.x)).toEqual([2, 2]);
    expect(three.active).toEqual([0, 1]);
    expect(equalities([1, 0, 1, 0], [0.2, 0.3]).status).toBe('infeasible');
    expect(equalities([1, 0, 0, 1, 1, 1], [2, 2, 4.5]).status).toBe('infeasible');
  });

  it('checks a redundant equality again after an inequality moves x', () => {
    // x = 0 and x + ε·y = 0 force y = 0, which contradicts y ≥ 100. At the
    // unconstrained minimum (0, 0.1) the second equality misses by 0.1·ε,
    // within the tolerance of its combination with the first, and counts
    // as redundant; y ≥ 100 moves the miss to 100·ε.
    for (const eps of [1e-9, 1e-10]) {
      const qp = {
        n: 2,
        G: Float64Array.from([1, 0, 0, 1]),
        a: Float64Array.from([0, -0.1]),
        C: Float64Array.from([1, 0, 1, eps, 0, 1]),
        b: Float64Array.from([0, 0, 100]),
        meq: 2,
      };
      const r = solveQP(qp);
      expect(r.status).toBe('infeasible');
      expect(r.x[1]).toBeCloseTo(100, 12);
      expect(r.active).toEqual([0, 2]);
    }
    // An exact combination keeps holding: row 2 = row 0 + row 1 with rows
    // of size 3e7. Rounding in the large rows leaves y off by 3.4e-7, so
    // row 2 misses by 1.4e-6: outside 1e-10 of its own size (8), within
    // 1e-10 of the sizes of the rows it combines (6e7 each).
    const K = 3e7;
    const qp = {
      n: 2,
      G: Float64Array.from([1, 0, 0, 1]),
      a: Float64Array.from([0, 0]),
      C: Float64Array.from([K, 1, -K, 3, 0, 4]),
      b: Float64Array.from([K + 1, -K + 3, 4]),
      meq: 3,
    };
    const r = solveQP(qp);
    expect(r.status).toBe('optimal');
    expect(r.active).toEqual([0, 1]);
    expect(r.lambda[2]).toBe(0);
    expect(Math.abs(r.x[0] - 1)).toBeLessThan(1e-12);
    expect(Math.abs(r.x[1] - 1)).toBeLessThan(1e-6);
    const miss = Math.abs(4 * r.x[1] - 4);
    expect(miss).toBeGreaterThan(1e-10 * 8);
    expect(miss).toBeLessThan(1e-10 * 2 * 2 * K);
  });

  it('treats a constraint as dependent once n constraints are active', () => {
    // Equality 0 with inequality 1 needs x ≥ −0.166, with inequality 2
    // x ≤ −0.954: infeasible. The third normal is a combination of the two
    // active ones, and rounding leaves z of about 1e-12.
    const qp = {
      n: 2,
      G: Float64Array.from([9.35, -15.005, -15.005, 25.1001]),
      a: Float64Array.from([-4.42, 5.12]),
      C: Float64Array.from([3, 0.07, 4, -0.02, -1, 2, 5, -0.5]),
      b: Float64Array.from([-3, 0.05, -3, -4.51]),
      meq: 1,
    };
    const r = solveQP(qp);
    expect(r.status).toBe('infeasible');
    expect(r.active.length).toBeLessThanOrEqual(2);
    expect(r.active).toContain(0);
  });

  it('keeps the active constraints within the tolerance for nearly parallel constraints', () => {
    // Two equalities 1e-5 apart in their first coefficient force x_1 = 1e5,
    // which violates the inequality −2·x_1 + 2·x_2 − 2·x_3 ≥ 3.
    const parallel = {
      n: 3,
      G: Float64Array.from([3, 0, 0, 0, 3, 0, 0, 0, 1]),
      a: Float64Array.from([-3, -3, -5]),
      C: Float64Array.from([0, 2, -2, 1e-5, 2, -2, -2, 2, -2]),
      b: Float64Array.from([-2, -1, 3]),
      meq: 2,
    };
    expect(solveQP(parallel).status).toBe('infeasible');
    // min 1.5·|x|² + 5·x_1 − 4·x_2 with −2·x_1 − 3·x_3 = −1 and
    // −2·x_1 + 1e-5·x_2 − 3·x_3 ≥ 3: both active at x = (−1, 4e5, 1).
    const qp = {
      n: 3,
      G: Float64Array.from([3, 0, 0, 0, 3, 0, 0, 0, 3]),
      a: Float64Array.from([5, -4, 0]),
      C: Float64Array.from([-2, 0, -3, -2, 1e-5, -3, 0, 2, -1]),
      b: Float64Array.from([-1, 3, 1]),
      meq: 1,
    };
    const r = solveQP(qp);
    expect(r.status).toBe('optimal');
    expect(r.active).toEqual([0, 1]);
    const slack = (/** @type {number} */ i) => qp.C[3 * i] * r.x[0] + qp.C[3 * i + 1] * r.x[1] + qp.C[3 * i + 2] * r.x[2] - qp.b[i];
    expect(Math.abs(slack(0))).toBeLessThan(3e-10);
    expect(Math.abs(slack(1))).toBeLessThan(3e-10);
    expect(Math.abs(r.x[1] / (4 / 1e-5) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(r.x[0] + 1)).toBeLessThan(1e-5);
    expect(Math.abs(r.x[2] - 1)).toBeLessThan(1e-5);
  });

  it('reports a programme it cannot solve in double precision as infeasible', () => {
    // Rows 0 and 2 differ by 1e-7 in one coefficient, so the solution lies
    // near x_3 = 5e7. Refinement would turn the multiplier of row 2
    // negative and is skipped; x then misses the active equalities by
    // about 5, far outside 1e-10 of the size of their terms (2e8).
    const qp = {
      n: 3,
      G: Float64Array.from([2, 0, 0, 0, 2, 0, 0, 0, 3]),
      a: Float64Array.from([-5, 0, -3]),
      C: Float64Array.from([-3, 0, -1, 1, -3, -2, -3, 0, -0.9999999]),
      b: Float64Array.from([-2, 2, 3]),
      meq: 2,
    };
    const r = solveQP(qp);
    expect(r.status).toBe('infeasible');
    expect(r.active.length).toBeLessThanOrEqual(3);
    expect(r.lambda[2]).toBeGreaterThanOrEqual(0);
  });

  it('returns invalid for non-finite data, mismatched sizes and options out of range', () => {
    const one = { n: 1, G: Float64Array.from([1]), a: Float64Array.from([0]), C: Float64Array.from([1]), b: Float64Array.from([0]) };
    expect(solveQP(one).status).toBe('optimal');
    /** @type {Partial<import('../../src/core/qp.js').QuadraticProgram>[]} */
    const bad = [
      { b: Float64Array.from([Infinity]) },
      { b: Float64Array.from([Infinity]), meq: 1 },
      { b: Float64Array.from([NaN]) },
      { C: Float64Array.from([NaN]) },
      { a: Float64Array.from([NaN]) },
      { G: Float64Array.from([Infinity]) },
      { meq: NaN },
      { meq: -1 },
      { meq: 0.5 },
      { meq: 2 },
      { n: 0 },
      { n: 1.5 },
      { n: NaN },
      { G: Float64Array.from([1, 0]) },
      { a: Float64Array.from([0, 0]) },
      { C: Float64Array.from([1, 1]) },
    ];
    for (const change of bad) {
      const r = solveQP({ ...one, ...change });
      expect(r.status).toBe('invalid');
      expect(r.x.length).toBe(0);
      expect(r.lambda.length).toBe(0);
      expect(r.value).toBeNaN();
    }
    for (const options of [{ maxIterations: NaN }, { maxIterations: -1 }, { maxIterations: 1.5 }, { maxIterations: Infinity }, { tolerance: NaN }, { tolerance: -1e-10 }, { tolerance: Infinity }]) {
      expect(solveQP(one, options).status).toBe('invalid');
    }
    expect(solveQP(one, { maxIterations: 0, tolerance: 0 }).status).toBe('optimal');
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

  it('matches a brute-force solution on small feasible problems with dependent rows', () => {
    fc.assert(
      fc.property(smallQP(true), (qp) => {
        const ref = bruteForce(qp);
        expect(ref).not.toBeNull();
        expectSolution(qp, solveQP(qp), /** @type {Float64Array} */ (ref));
      }),
      { numRuns: 500 },
    );
  });

  it('reports infeasible exactly when the brute force finds no solution', () => {
    fc.assert(
      fc.property(smallQP(false), (qp) => {
        const ref = bruteForce(qp);
        const r = solveQP(qp);
        if (ref) expectSolution(qp, r, ref);
        else expect(r.status).toBe('infeasible');
      }),
      { numRuns: 500 },
    );
  });
});
