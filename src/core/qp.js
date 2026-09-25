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
 * Sizes: tens of unknowns, hundreds of constraints.
 * @module core/qp
 */

import { cholesky, choleskySolve } from './linalg.js';

/**
 * @typedef {object} QuadraticProgram
 * @property {number} n unknowns
 * @property {Float64Array} G n×n row-major, symmetric positive definite
 * @property {Float64Array} a length n
 * @property {Float64Array} C m×n row-major constraint rows
 * @property {Float64Array} b length m
 * @property {number} [meq] number of leading equality constraints (default 0)
 */

/**
 * @typedef {object} QPResult
 * @property {'optimal' | 'infeasible' | 'max-iterations' | 'not-convex'} status
 * @property {Float64Array} x solution (the last iterate unless optimal)
 * @property {Float64Array} lambda Lagrange multipliers, one per constraint
 *   (zero for inactive constraints)
 * @property {number[]} active indices of the active constraints
 * @property {number} value objective at x
 * @property {number} iterations active-set changes
 */

/**
 * Solve a dense convex QP. Never throws for well-formed arrays.
 * @param {QuadraticProgram} qp
 * @param {{ maxIterations?: number, tolerance?: number }} [options]
 *   tolerance: accepted constraint violation relative to the constraint
 *   scale (default 1e-10)
 * @returns {QPResult}
 */
export function solveQP(qp, options = {}) {
  const { n, G, a, C, b } = qp;
  const meq = qp.meq ?? 0;
  const m = b.length;
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 10 * (n + m) + 20;
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
  // W columns and multipliers u.
  /** @type {number[]} */
  const sign = [];
  /** @type {Float64Array[]} */
  const W = [];
  /** @type {number[]} */
  let u = [];
  /** @type {Float64Array | null} */
  let Mchol = null;
  const refactor = () => {
    const q = active.length;
    if (q === 0) {
      Mchol = null;
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
    Mchol = cholesky(M, q);
    return Mchol !== null;
  };

  let iterations = 0;
  const done = (/** @type {QPResult['status']} */ status) => {
    lambda.fill(0);
    active.forEach((ci, k) => (lambda[ci] = sign[k] * u[k]));
    return { status, x, lambda, active: [...active], value: objective(), iterations };
  };

  for (;;) {
    // Step 1: choose the constraint to add: a missing equality first, then
    // the most violated inequality.
    let p = -1;
    let sp = 0;
    let dir = 1;
    for (let i = 0; i < meq && p < 0; i++) {
      if (active.includes(i)) continue;
      const s = slack(i);
      p = i;
      sp = s;
      dir = s > 0 ? -1 : 1;
    }
    if (p < 0) {
      let worst = 0;
      for (let i = meq; i < m; i++) {
        const v = slack(i) / scale[i];
        if (v < worst) {
          worst = v;
          p = i;
        }
      }
      if (p < 0 || worst >= -tolerance) return done('optimal');
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
      const dependent = !(zn > 1e-12 * curvature);
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
        sign.push(dir);
        W.push(Float64Array.from(gn, (v) => v * dir));
        u.push(uPlus);
        if (!refactor()) return done('infeasible');
        break;
      }
      // Partial step: drop constraint `drop` (its multiplier is now 0) and
      // continue with p from the new point.
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
