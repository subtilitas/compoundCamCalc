/**
 * Dense convex quadratic programme by the dual active-set method of
 * Goldfarb and Idnani (1983):
 *
 *   minimise   ½·xᵀ·G·x + aᵀ·x
 *   subject to c_iᵀ·x = b_i  (i < meq),   c_iᵀ·x ≥ b_i  (i ≥ meq)
 *
 * G must be symmetric positive definite. The method starts at the
 * unconstrained minimum −G⁻¹·a and adds the most violated constraint in each
 * step, dropping active constraints whose multipliers would turn negative,
 * so the dual objective rises monotonically and the method ends after a
 * finite number of steps. With the active normals N (columns) the primal
 * direction is z = G⁻¹·n⁺ − W·M⁻¹·Wᵀ·n⁺ and the dual direction
 * r = M⁻¹·Wᵀ·n⁺, where W = G⁻¹·N and M = Nᵀ·G⁻¹·N; W grows by one column
 * per added constraint and M is refactored by Cholesky after each change.
 *
 * Rounding:
 * - A constraint depends linearly on the active ones when n constraints are
 *   active, or when |z|_G = √(zᵀ·G·z) is at most 1e-8 of
 *   √(n⁺ᵀ·G⁻¹·n⁺) + Σ|r_k|·√M_kk, the size of the terms that cancel in z.
 *   It then takes no primal step: an active inequality is dropped, or the
 *   programme is infeasible. At most n constraints are active.
 * - A dependent equality c_p = Σ r_k·c_k that holds within the tolerance
 *   times s_p + Σ|r_k|·s_k, with the row scales s = max(|b_i|, |c_ij|), is
 *   redundant: it stays inactive with multiplier 0. A nearly dependent
 *   equality drifts when a later inequality moves x, so it is checked
 *   again at the end (see below).
 * - After each added constraint, two passes of iterative refinement move x
 *   back onto the active constraints: x by W·M⁻¹·e and the multipliers by
 *   M⁻¹·e for the residuals e, so G·x + a = N·u still holds. A pass that
 *   would turn an inequality multiplier negative is skipped.
 * - The result is optimal only when every active constraint holds within
 *   the tolerance times its size t_i = max(s_i, Σ|c_ij·x_j| + |b_i|), and
 *   every redundant equality within the tolerance times t_p + Σ|r_k|·t_k
 *   over the rows of its combination. Otherwise the status is
 *   'infeasible'. An active constraint outside the bound means that
 *   rounding has moved x off it: the programme cannot be solved in double
 *   precision, for example with normals that differ by 1e-7 of their size
 *   and a solution 1e7 times the row scale away. A redundant equality
 *   outside the bound was only nearly dependent. Example: x = 0 and
 *   x + 1e-9·y = 0 with y ≥ 100. At the unconstrained minimum y = 0.1 the
 *   second equality misses by 1e-10 and counts as redundant; y ≥ 100 then
 *   moves its miss to 1e-7, and the programme is infeasible.
 *
 * Sizes: tens of unknowns, hundreds of constraints.
 * @module core/qp
 */

import { cholesky, choleskySolve } from './linalg.js';

/**
 * Relative size of z below which the added constraint counts as a linear
 * combination of the active ones.
 */
const DEPENDENCE = 1e-8;

/**
 * @typedef {object} QuadraticProgram
 * @property {number} n unknowns, a positive integer
 * @property {Float64Array} G n×n row-major, symmetric positive definite
 * @property {Float64Array} a length n
 * @property {Float64Array} C m×n row-major constraint rows
 * @property {Float64Array} b length m
 * @property {number} [meq] number of leading equality constraints, an
 *   integer from 0 to m (default 0)
 */

/**
 * @typedef {object} QPResult
 * @property {'optimal' | 'infeasible' | 'max-iterations' | 'not-convex' | 'invalid'} status
 *   'infeasible': no point meets the constraints, or rounding leaves an
 *   active constraint or a redundant equality outside the tolerance;
 *   'invalid': sizes that do not match, meq outside 0 to m, a non-finite
 *   entry of G, a, C or b, or options out of range
 * @property {Float64Array} x solution (the last iterate unless optimal;
 *   empty when invalid)
 * @property {Float64Array} lambda Lagrange multipliers, one per constraint
 *   (zero for inactive constraints; empty when invalid)
 * @property {number[]} active indices of the active constraints, at most n
 * @property {number} value objective at x (NaN when invalid or not convex)
 * @property {number} iterations steps of the method
 */

/**
 * True when v holds `length` finite numbers.
 * @param {ArrayLike<number> | undefined} v
 * @param {number} length
 */
function finiteArray(v, length) {
  if (!v || v.length !== length) return false;
  for (let i = 0; i < length; i++) if (!Number.isFinite(v[i])) return false;
  return true;
}

/**
 * Solve a dense convex QP. Never throws.
 * @param {QuadraticProgram} qp
 * @param {{ maxIterations?: number, tolerance?: number }} [options]
 *   maxIterations: a non-negative integer (default 10·(n + m) + 20);
 *   tolerance: accepted constraint violation relative to the constraint
 *   scale, finite and non-negative (default 1e-10)
 * @returns {QPResult}
 */
export function solveQP(qp, options = {}) {
  const { n, G, a, C, b } = qp;
  const meq = qp.meq ?? 0;
  const m = b?.length;
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 10 * (n + m) + 20;
  const valid =
    Number.isInteger(n) &&
    n >= 1 &&
    Number.isInteger(m) &&
    Number.isInteger(meq) &&
    meq >= 0 &&
    meq <= m &&
    Number.isFinite(tolerance) &&
    tolerance >= 0 &&
    Number.isInteger(maxIterations) &&
    maxIterations >= 0 &&
    finiteArray(G, n * n) &&
    finiteArray(a, n) &&
    finiteArray(C, m * n) &&
    finiteArray(b, m);
  if (!valid) {
    return { status: 'invalid', x: new Float64Array(0), lambda: new Float64Array(0), active: [], value: NaN, iterations: 0 };
  }
  const x = new Float64Array(n);
  const lambda = new Float64Array(m);
  /** @type {number[]} */
  const active = [];
  const objective = () => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      let gx = 0;
      for (let j = 0; j < n; j++) gx += G[i * n + j] * x[j];
      v += x[i] * (0.5 * gx + a[i]);
    }
    return v;
  };
  const L = cholesky(G, n);
  if (!L) return { status: 'not-convex', x, lambda, active, value: NaN, iterations: 0 };

  // Unconstrained minimum.
  for (let i = 0; i < n; i++) x[i] = -a[i];
  choleskySolve(L, n, x);

  // Row scales for the violation test.
  const scale = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = Math.abs(b[i]);
    for (let j = 0; j < n; j++) s = Math.max(s, Math.abs(C[i * n + j]));
    scale[i] = s > 0 ? s : 1;
  }
  /** G⁻¹·c_i, computed when first needed. @type {(Float64Array | undefined)[]} */
  const ginvRows = new Array(m);
  /** @param {number} i */
  const ginvRow = (i) => {
    let w = ginvRows[i];
    if (!w) {
      w = C.slice(i * n, (i + 1) * n);
      choleskySolve(L, n, w);
      ginvRows[i] = w;
    }
    return w;
  };
  /** @param {number} i */
  const slack = (i) => {
    let s = -b[i];
    for (let j = 0; j < n; j++) s += C[i * n + j] * x[j];
    return s;
  };

  // Active set data: sign (+1, or −1 for an equality entered from above),
  // W columns, multipliers u and the diagonal of M.
  /** @type {number[]} */
  const sign = [];
  /** @type {Float64Array[]} */
  const W = [];
  /** @type {number[]} */
  let u = [];
  /** @type {number[]} */
  let Mdiag = [];
  /** @type {Float64Array | null} */
  let Mchol = null;
  /** 1 for an active constraint. */
  const isActive = new Uint8Array(m);
  /** 1 for a redundant equality. */
  const redundant = new Uint8Array(m);
  /**
   * Each redundant equality p with the active rows and the coefficients r
   * of its combination when it was found.
   * @type {{ p: number, rows: number[], r: Float64Array }[]}
   */
  const combinations = [];
  const refactor = () => {
    const q = active.length;
    if (q === 0) {
      Mchol = null;
      Mdiag = [];
      return true;
    }
    const M = new Float64Array(q * q);
    for (let i = 0; i < q; i++) {
      const ci = active[i];
      for (let j = 0; j <= i; j++) {
        const wj = W[j];
        let s = 0;
        for (let k = 0; k < n; k++) s += C[ci * n + k] * wj[k];
        // W[j] = G⁻¹·n_j already carries sign j.
        s *= sign[i];
        M[i * q + j] = s;
        M[j * q + i] = s;
      }
    }
    Mdiag = Array.from({ length: q }, (_, i) => M[i * q + i]);
    Mchol = cholesky(M, q);
    return Mchol !== null;
  };
  // Iterative refinement with the residuals e_k = b⁺_k − n⁺_kᵀ·x of the
  // active constraints (Mchol is set: at least one constraint is active).
  // A pass that would turn an inequality multiplier negative is skipped, so
  // G·x + a = N·u and u ≥ 0 keep holding.
  const refine = () => {
    const q = active.length;
    const e = new Float64Array(q);
    for (let k = 0; k < q; k++) e[k] = -sign[k] * slack(active[k]);
    choleskySolve(/** @type {Float64Array} */ (Mchol), q, e);
    for (let k = 0; k < q; k++) if (active[k] >= meq && u[k] + e[k] < 0) return;
    for (let k = 0; k < q; k++) {
      const wk = W[k];
      for (let j = 0; j < n; j++) x[j] += e[k] * wk[j];
      u[k] += e[k];
    }
  };

  /**
   * Size of row i at x: max(scale, |b_i| + Σ|c_ij·x_j|).
   * @param {number} i
   */
  const size = (i) => {
    let terms = Math.abs(b[i]);
    for (let j = 0; j < n; j++) terms += Math.abs(C[i * n + j] * x[j]);
    return Math.max(scale[i], terms);
  };
  // The active constraints hold within the tolerance times their size, and
  // each redundant equality within the tolerance times its size plus the
  // sizes of the rows it combines. Equalities are never dropped, so those
  // rows are still active.
  const constraintsHold = () =>
    active.every((i) => Math.abs(slack(i)) <= tolerance * size(i)) &&
    combinations.every(({ p, rows, r }) => {
      let bound = size(p);
      for (let k = 0; k < rows.length; k++) bound += Math.abs(r[k]) * size(rows[k]);
      return Math.abs(slack(p)) <= tolerance * bound;
    });

  let iterations = 0;
  const done = (/** @type {QPResult['status']} */ status) => {
    lambda.fill(0);
    active.forEach((ci, k) => (lambda[ci] = sign[k] * u[k]));
    return { status, x, lambda, active: [...active], value: objective(), iterations };
  };

  for (;;) {
    // Step 1: choose the constraint to add: a missing equality first, then
    // the most violated inactive inequality.
    let p = -1;
    let sp = 0;
    let dir = 1;
    for (let i = 0; i < meq && p < 0; i++) {
      if (isActive[i] || redundant[i]) continue;
      const s = slack(i);
      p = i;
      sp = s;
      dir = s > 0 ? -1 : 1;
    }
    if (p < 0) {
      let worst = 0;
      for (let i = meq; i < m; i++) {
        if (isActive[i]) continue;
        const v = slack(i) / scale[i];
        if (v < worst) {
          worst = v;
          p = i;
        }
      }
      if (p < 0 || worst >= -tolerance) return done(constraintsHold() ? 'optimal' : 'infeasible');
      sp = slack(p);
    } else if (Math.abs(sp) <= tolerance * scale[p]) {
      // A satisfied equality still enters the active set, with a zero step.
      sp = 0;
    }
    const equality = p < meq;
    // Constraint p as n⁺·x ≥ b⁺ with the sign dir.
    let uPlus = 0;
    for (;;) {
      if (++iterations > maxIterations) return done('max-iterations');
      const q = active.length;
      const gn = ginvRow(p);
      // v = Wᵀ·n⁺ (with signs), r = M⁻¹·v.
      const r = new Float64Array(q);
      for (let k = 0; k < q; k++) {
        const wk = W[k];
        let s = 0;
        for (let j = 0; j < n; j++) s += wk[j] * C[p * n + j];
        r[k] = s * dir;
      }
      if (q > 0 && Mchol) choleskySolve(Mchol, q, r);
      // z = G⁻¹·n⁺ − W·r (with signs).
      const z = new Float64Array(n);
      for (let j = 0; j < n; j++) z[j] = dir * gn[j];
      for (let k = 0; k < q; k++) {
        const wk = W[k];
        const f = r[k];
        for (let j = 0; j < n; j++) z[j] -= f * wk[j];
      }
      let zn = 0;
      let curvature = 0;
      for (let j = 0; j < n; j++) {
        zn += z[j] * dir * C[p * n + j];
        curvature += gn[j] * C[p * n + j];
      }
      // Linear dependence: n⁺ = N·r and z = 0 in exact arithmetic. Rounding
      // leaves |z|_G of the order of the machine precision times the terms
      // that cancel, √curvature + Σ|r_k|·|w_k|_G with |w_k|_G = √M_kk.
      let dependent = q >= n || !(zn > 0);
      if (!dependent && q > 0) {
        let zGz = 0;
        for (let i = 0; i < n; i++) {
          let g = 0;
          for (let j = 0; j < n; j++) g += G[i * n + j] * z[j];
          zGz += z[i] * g;
        }
        let terms = Math.sqrt(curvature);
        for (let k = 0; k < q; k++) terms += Math.abs(r[k]) * Math.sqrt(Mdiag[k]);
        dependent = !(zGz > (DEPENDENCE * terms) ** 2);
      }
      if (dependent && equality) {
        // Only equalities are active here, and they stay active. For an
        // exact combination the slack is c_pᵀ·x − b_p =
        // Σ r_k·(slack_k + b_k) − b_p (signs in r), so the tolerance covers
        // the scales of the combined rows. A near combination changes its
        // slack when x moves along the active rows; constraintsHold checks
        // it again at the end.
        let bound = scale[p];
        for (let k = 0; k < q; k++) bound += Math.abs(r[k]) * scale[active[k]];
        if (Math.abs(sp) <= tolerance * bound) {
          redundant[p] = 1;
          combinations.push({ p, rows: active.slice(), r: Float64Array.from(r) });
          break;
        }
      }
      // Partial step: the first active inequality whose multiplier reaches 0.
      let t1 = Infinity;
      let drop = -1;
      for (let k = 0; k < q; k++) {
        if (active[k] < meq || !(r[k] > 0)) continue;
        const t = u[k] / r[k];
        if (t < t1) {
          t1 = t;
          drop = k;
        }
      }
      const t2 = dependent ? Infinity : (-dir * sp) / zn;
      const t = Math.min(t1, t2);
      if (t === Infinity) return done('infeasible');
      if (!dependent) {
        for (let j = 0; j < n; j++) x[j] += t * z[j];
      }
      for (let k = 0; k < q; k++) u[k] -= t * r[k];
      uPlus += t;
      if (t === t2) {
        active.push(p);
        isActive[p] = 1;
        sign.push(dir);
        W.push(Float64Array.from(gn, (v) => v * dir));
        u.push(uPlus);
        if (!refactor()) return done('infeasible');
        refine();
        refine();
        break;
      }
      // Partial step: drop constraint `drop` (its multiplier is now 0) and
      // continue with p from the new point.
      isActive[active[drop]] = 0;
      active.splice(drop, 1);
      sign.splice(drop, 1);
      W.splice(drop, 1);
      u.splice(drop, 1);
      u = u.map((v, k) => (active[k] < meq ? v : Math.max(v, 0)));
      if (!refactor()) return done('infeasible');
      sp = equality && Math.abs(slack(p)) <= tolerance * scale[p] ? 0 : slack(p);
    }
  }
}
