import { describe, expect, it } from 'vitest';
import { drawGrid, solveForward } from '../../src/core/forward.js';
import {
  braceBlend, braceConditions, cableSpline, createInverse, evaluatePoly, inverseAt, lagrangeSlope, resampleCable,
  sampleInverse,
} from '../../src/core/inverse.js';
import { createLimb, linearLimb, tableLimb } from '../../src/core/limb.js';
import { createSupport, eccentricCircle, offset } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { derivative, solveDense } from './numeric.js';
import { freeBody } from './statics.js';

/** @typedef {import('../../src/core/support.js').SupportData} SupportData */
/** @typedef {import('../../src/core/inverse.js').InverseTarget} InverseTarget */
/** @typedef {import('../../src/core/forward.js').ForwardResult} ForwardResult */

const DEG = Math.PI / 180;
const geometry = defaultState().geometry;
const limbData = linearLimb({ stiffness: 10e3, preloadTravel: 0.03, limbLength: geometry.limbLength });
const limb = createLimb(limbData);

/** Realistic twin cam of the forward tests (groove bottoms offset by the 1.25 mm cord radius). */
const twinCam = {
  stringTrack: offset(eccentricCircle({ radius: 0.045, offset: 0.006, phase: 45 * DEG }), 0.00125),
  cableTrack: offset(eccentricCircle({ radius: 0.018, offset: 0.01, phase: -60 * DEG }), 0.00125),
};
/** Concentric circles: string 50 mm, cable 20 mm. */
const circles = { stringTrack: eccentricCircle({ radius: 0.05 }), cableTrack: eccentricCircle({ radius: 0.02 }) };

/**
 * Weights that integrate the degree-5 polynomial through six samples at
 * the local coordinates u = first … first + 5 over u in [0, 1].
 * @param {number} first
 */
function intervalWeights(first) {
  const A = [];
  for (let r = 0; r < 6; r++) A.push(Array.from({ length: 6 }, (_, m) => (first + m) ** r));
  // Σ w_m·u_m^r = ∫_0^1 u^r du = 1/(r + 1).
  return solveDense(A, Array.from({ length: 6 }, (_, r) => 1 / (r + 1)));
}

/**
 * Cumulative integral of samples g_i at uniform spacing h, by degree-5
 * polynomials on six neighbouring samples per interval (error O(h⁶)).
 * @param {ArrayLike<number>} g
 * @param {number} h
 */
function cumulative(g, h) {
  const n = g.length;
  const out = new Float64Array(n);
  /** @type {Map<number, number[]>} */
  const cache = new Map();
  for (let j = 0; j < n - 1; j++) {
    const k0 = Math.min(Math.max(j - 2, 0), n - 6);
    const first = k0 - j;
    if (!cache.has(first)) cache.set(first, intervalWeights(first));
    const w = /** @type {number[]} */ (cache.get(first));
    let s = 0;
    for (let m = 0; m < 6; m++) s += w[m] * g[k0 + m];
    out[j + 1] = out[j] + h * s;
  }
  return out;
}

/**
 * Target from forward samples on the default grid (x − x_b = s², s uniform):
 * the work W is the integral of F·2s over s.
 * @param {ForwardResult} f
 * @returns {{ W: Float64Array, target: InverseTarget }}
 */
function sampledTarget(f) {
  const n = f.n;
  const sMax = Math.sqrt(f.x[n - 1] - f.x[0]);
  const h = sMax / (n - 1);
  const g = Float64Array.from({ length: n }, (_, i) => f.F[i] * 2 * h * i);
  const W = cumulative(g, h);
  const index = new Map(Array.from(f.x, (x, i) => [x, i]));
  const at = (/** @type {number} */ x) => /** @type {number} */ (index.get(x));
  return {
    W,
    target: {
      force: (x) => f.F[at(x)],
      work: (x) => W[at(x)],
      slope: /** @type {any} */ (f.brace).slope,
    },
  };
}

/**
 * Target at any nock position from a dense forward solution: degree-7
 * Lagrange interpolation of F in s, and the work as the cumulative integral
 * plus the integral of the degree-5 polynomial through six samples.
 * @param {ForwardResult} f
 * @returns {InverseTarget}
 */
function interpolatedTarget(f) {
  const n = f.n;
  const xb = f.x[0];
  const sMax = Math.sqrt(f.x[n - 1] - xb);
  const h = sMax / (n - 1);
  const g = Float64Array.from({ length: n }, (_, i) => f.F[i] * 2 * h * i);
  const W = cumulative(g, h);
  /**
   * Lagrange interpolation of values y at nodes k0 … k0 + m − 1 (units of h).
   * @param {ArrayLike<number>} y
   * @param {number} k0
   * @param {number} m
   * @param {number} u position in units of h
   */
  const lagrange = (y, k0, m, u) => {
    let sum = 0;
    for (let a = 0; a < m; a++) {
      let w = 1;
      for (let b = 0; b < m; b++) if (b !== a) w *= (u - (k0 + b)) / (a - b);
      sum += w * y[k0 + a];
    }
    return sum;
  };
  /** @param {number} x */
  const locate = (x) => {
    const u = Math.sqrt(Math.max(0, x - xb)) / h;
    const j = Math.min(n - 2, Math.floor(u));
    return { u, j };
  };
  return {
    force(x) {
      const { u, j } = locate(x);
      return lagrange(f.F, Math.min(Math.max(j - 3, 0), n - 8), 8, u);
    },
    work(x) {
      const { u, j } = locate(x);
      const k0 = Math.min(Math.max(j - 2, 0), n - 6);
      // Integral of the degree-5 polynomial of g from u_j to u, by 8-point Gauss–Legendre.
      const nodes = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
      const weights = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
      const half = (u - j) / 2;
      let s = 0;
      for (let q = 0; q < 8; q++) s += weights[q] * lagrange(g, k0, 6, j + half * (1 + nodes[q]));
      return W[j] + h * half * s;
    },
    slope: /** @type {any} */ (f.brace).slope,
  };
}

/**
 * @param {{ stringTrack: SupportData, cableTrack: SupportData }} cam
 */
function context(cam) {
  const { context: ctx } = createInverse({ geometry, stringTrack: cam.stringTrack, limb: limbData });
  return /** @type {import('../../src/core/inverse.js').InverseContext} */ (ctx);
}

describe('brace conditions', () => {
  const f = solveForward({ geometry, ...twinCam, limb: limbData, samples: 20 });
  const b = /** @type {import('../../src/core/forward.js').BraceState} */ (f.brace);
  const ctx = context(twinCam);
  const brace = braceConditions(ctx, b.slope);

  it("give the brace tensions, cable lever arm and contact angle of the forward model from F'(x_b)", () => {
    expect(brace.ok).toBe(true);
    expect(Math.abs(brace.stringTension / b.stringTension - 1)).toBeLessThan(1e-12);
    expect(Math.abs(brace.cableTension / b.cableTension - 1)).toBeLessThan(1e-12);
    expect(Math.abs(brace.pC - b.pC)).toBeLessThan(1e-15);
    expect(Math.abs(brace.psiC - b.psiC)).toBeLessThan(1e-13);
    expect(Math.abs(brace.cA / b.cA - 1)).toBeLessThan(1e-12);
    expect(brace.sA).toBeCloseTo(b.sA, 15);
    expect(brace.span).toBeCloseTo(b.span, 15);
    expect(brace.moment).toBe(limb.moment(0));
  });

  it("give F''(x_b) of the forward model, from the brace expansion, to 1e-8", () => {
    // Degree-7 fit of the forward force at x_b + k·1 mm; F(x_b) = 0.
    const h = 1e-3;
    const K = 7;
    const xs = Array.from({ length: K + 1 }, (_, k) => geometry.braceHeight + k * h);
    const fit = solveForward({ geometry, ...twinCam, limb: limbData, x: xs });
    const A = [];
    const rhs = [];
    for (let k = 1; k <= K; k++) {
      A.push(Array.from({ length: K }, (_, j) => (k * h) ** (j + 1)));
      rhs.push(fit.F[k]);
    }
    const coeffs = solveDense(A, rhs);
    expect(Math.abs(coeffs[0] / brace.slope - 1)).toBeLessThan(1e-9);
    expect(Math.abs((2 * coeffs[1]) / brace.second - 1)).toBeLessThan(1e-8);
    // The same with a cable circle of radius p_c0 about the axle.
    const circle = solveForward({ geometry, ...twinCam, cableTrack: eccentricCircle({ radius: b.pC }), limb: limbData, x: xs });
    const c2 = solveDense(A, Array.from({ length: K }, (_, k) => circle.F[k + 1]));
    expect(Math.abs((2 * c2[1]) / brace.second - 1)).toBeLessThan(1e-8);
  });

  it('are feasible only for 0 < T_s0 < M_b/s_a0', () => {
    expect(brace.maxStringTension).toBeCloseTo(limb.moment(0) / (geometry.limbLength * Math.cos(geometry.limbAngleBrace)), 9);
    expect(brace.maxSlope).toBeCloseTo((2 * brace.maxStringTension) / brace.span, 6);
    expect(braceConditions(ctx, 0).ok).toBe(false);
    expect(braceConditions(ctx, -100).ok).toBe(false);
    expect(braceConditions(ctx, brace.maxSlope * 1.001).ok).toBe(false);
    const near = braceConditions(ctx, brace.maxSlope * 0.999);
    expect(near.ok).toBe(true);
    // Towards the limit K grows without bound and the lever arm tends to the
    // axle distance D = 2·O_y from below.
    expect(near.pC).toBeGreaterThan(0.3);
    expect(near.pC).toBeLessThan(2 * b.axleY);
    const nearer = braceConditions(ctx, brace.maxSlope * (1 - 1e-6));
    expect(nearer.pC).toBeGreaterThan(near.pC);
    expect(nearer.pC).toBeLessThan(2 * b.axleY);
    expect(nearer.pC / (2 * b.axleY)).toBeGreaterThan(0.999);
  });

  it('apply at nock positions within 1e-9 m of x_b', () => {
    // Project validation accepts the brace point within 1e-9 m.
    const exact = inverseAt(ctx, brace, geometry.braceHeight, 0, 0, 0, 0);
    expect(exact.ok).toBe(true);
    for (const d of [1e-12, -1e-12, 5e-10, -5e-10, 1e-9, -1e-9]) {
      const q = inverseAt(ctx, brace, geometry.braceHeight + d, 0, 0, 0, 0);
      expect(q.Ts).toBe(brace.stringTension);
      expect(q.theta).toBe(0);
      expect(q.alpha).toBe(0);
      expect(Math.abs(q.pC / exact.pC - 1)).toBeLessThan(1e-8);
    }
    // Beyond it the force sets the string tension: F = 0 gives none.
    expect(inverseAt(ctx, brace, geometry.braceHeight + 2e-9, 0, 0, 0, 0).Ts).toBe(0);
  });
});

describe('inverse model: reverse round trip', () => {
  for (const [name, cam] of /** @type {const} */ ([['eccentric circles', twinCam], ['concentric circles', circles]])) {
    const f = solveForward({ geometry, ...cam, limb: limbData, samples: 1500 });
    const truth = createSupport(cam.cableTrack);
    const ctx = context(cam);
    const brace = braceConditions(ctx, /** @type {any} */ (f.brace).slope);

    it(`${name}: recovers p_c(ψ) at the forward samples to 1e-8 m from F and its integral`, () => {
      const { W, target } = sampledTarget(f);
      // The quadrature of F reproduces the limb energy.
      expect(Math.abs(W[f.n - 1] / f.drawEnergy - 1)).toBeLessThan(1e-10);
      const s = sampleInverse(ctx, brace, target, f.x);
      expect(s.solved).toBe(f.n);
      let worst = 0;
      let worstTheta = 0;
      let worstPsi = 0;
      for (let i = 0; i < s.n; i++) {
        worst = Math.max(worst, Math.abs(s.pC[i] - truth.p(s.psiC[i])));
        worstTheta = Math.max(worstTheta, Math.abs(s.theta[i] - f.theta[i]));
        worstPsi = Math.max(worstPsi, Math.abs(s.psiC[i] - f.psiC[i]));
      }
      console.info(`round trip (${name}), samples: |Δp_c| ≤ ${worst.toExponential(2)} m, |Δθ| ≤ ${worstTheta.toExponential(2)} rad`);
      expect(worst).toBeLessThan(1e-8);
      expect(worstTheta).toBeLessThan(1e-9);
      expect(worstPsi).toBeLessThan(1e-8);
    });

    it(`${name}: recovers the cable track spline over the whole draw to 1e-8 m`, () => {
      const dense = solveForward({ geometry, ...cam, limb: limbData, samples: 4001 });
      const target = interpolatedTarget(dense);
      const grid = drawGrid(dense.x[0], dense.x[dense.n - 1], 400);
      const s = sampleInverse(ctx, brace, target, grid);
      const r = /** @type {NonNullable<ReturnType<typeof resampleCable>>} */ (resampleCable(ctx, brace, target, s, 0.25 * DEG));
      expect(r).not.toBeNull();
      // Nearly uniform: every angle within 0.1 % of the step of its target.
      const step = (r.psi[r.psi.length - 1] - r.psi[0]) / (r.psi.length - 1);
      for (let k = 0; k < r.psi.length; k++) expect(Math.abs(r.psi[k] - (r.psi[0] + k * step))).toBeLessThanOrEqual(1e-3 * step);
      const spline = createSupport(cableSpline(r.psi, r.p));
      let worst = 0;
      for (let k = 0; k <= 5000; k++) {
        const psi = r.psi[0] + ((r.psi[r.psi.length - 1] - r.psi[0]) * k) / 5000;
        worst = Math.max(worst, Math.abs(spline.p(psi) - truth.p(psi)));
      }
      console.info(`round trip (${name}), spline: |Δp_c| ≤ ${worst.toExponential(2)} m over ${((r.psi[r.psi.length - 1] - r.psi[0]) / DEG).toFixed(0)}°`);
      expect(worst).toBeLessThan(1e-8);
    });
  }
});

describe('inverse model: statics and kinematics', () => {
  const ctx = context(twinCam);
  const f = solveForward({ geometry, ...twinCam, limb: limbData, samples: 300 });
  const brace = braceConditions(ctx, /** @type {any} */ (f.brace).slope);
  const { target } = sampledTarget(f);
  const s = sampleInverse(ctx, brace, target, f.x);

  it('has the tensions and the force of a free-body balance built from positions, and T_c of the forward model', () => {
    // The pose (x, θ, α) of each inverse sample, with the tangent points of
    // the twin cam found by bisection (tests/unit/statics.js).
    const stringSupport = createSupport(twinCam.stringTrack);
    const cableSupport = createSupport(twinCam.cableTrack);
    let worstT = 0;
    let worstF = 0;
    let worstForward = 0;
    for (let i = 0; i < s.n; i++) {
      const fb = freeBody(s, i, stringSupport, cableSupport, geometry, limb);
      worstT = Math.max(worstT, Math.abs(fb.Ts / s.Ts[i] - 1), Math.abs(fb.Tc / s.Tc[i] - 1));
      if (i > 0) worstF = Math.max(worstF, Math.abs(fb.F / s.F[i] - 1));
      worstForward = Math.max(worstForward, Math.abs(s.Tc[i] / f.Tc[i] - 1));
    }
    console.info(`inverse statics against the free-body balance: T_s and T_c within ${worstT.toExponential(2)}, F within ${worstF.toExponential(2)} relative; T_c against the forward model within ${worstForward.toExponential(2)}`);
    expect(worstT).toBeLessThan(1e-9);
    expect(worstF).toBeLessThan(1e-9);
    expect(worstForward).toBeLessThan(1e-8);
  });

  it('gives B·t = √(D² − p_c²), the free cable span of the forward model plus p_c\'(ψ_c)', () => {
    const truth = createSupport(twinCam.cableTrack);
    let worst = 0;
    for (let i = 0; i < s.n; i++) {
      worst = Math.max(worst, Math.abs(s.anchorReach[i] - truth.dp(s.psiC[i]) - f.spanC[i]));
    }
    console.info(`B·t − p_c'(ψ_c) against the free cable span of the forward model: within ${worst.toExponential(2)} m`);
    expect(worst).toBeLessThan(1e-8);
  });

  it('meets the kinematic check p_c = c_a·dα/dθ with α and θ differentiated along the draw', () => {
    const h = 2e-4;
    const cam = interpolatedTarget(solveForward({ geometry, ...twinCam, limb: limbData, samples: 4001 }));
    for (const i of [60, 150, 280]) {
      const x0 = f.x[i];
      const at = (/** @type {number} */ x) => inverseAt(ctx, brace, x, cam.force(x), cam.work(x), s.theta[i], s.psiS[i]);
      const dAlpha = derivative((x) => at(x).alpha, x0, h);
      const dTheta = derivative((x) => at(x).theta, x0, h);
      const q = at(x0);
      expect(Math.abs((q.cA * dAlpha) / dTheta / q.pC - 1)).toBeLessThan(1e-7);
      expect(Math.abs(q.dAlphaDx / dAlpha - 1)).toBeLessThan(1e-7);
      expect(Math.abs(q.dThetaDx / dTheta - 1)).toBeLessThan(1e-7);
    }
  });
});

describe('inverse model: helpers and failures', () => {
  it('refuses an iteration limit outside the integers 1 to 200', () => {
    const base = /** @type {any} */ ({ geometry, stringTrack: eccentricCircle({ radius: 0.03, offset: 0.01, phase: 0 }), limb: limbData });
    for (const maxIterations of [0, -1, 1.5, 201, null, NaN]) {
      const r = createInverse({ ...base, maxIterations });
      expect(r.context).toBeNull();
      expect(r.error).toBe('The iteration limit must be an integer from 1 to 200');
    }
    expect(createInverse({ ...base, maxIterations: 200 }).context?.maxIterations).toBe(200);
    expect(createInverse(base).context?.maxIterations).toBe(30);
  });

  it('differentiates the polynomial through unevenly spaced points exactly', () => {
    const f = (/** @type {number} */ x) => 3 - 2 * x + 0.5 * x ** 2 - x ** 3 + 0.25 * x ** 4;
    const xs = [0.1, 0.13, 0.2, 0.26, 0.4];
    const exact = -2 + 0.1 - 3 * 0.01 + 0.001;
    expect(lagrangeSlope(xs, xs.map(f))).toBeCloseTo(exact, 12);
    const back = [0.4, 0.33, 0.3, 0.21, 0.1];
    expect(lagrangeSlope(back, back.map(f))).toBeCloseTo(-2 + 0.4 - 3 * 0.16 + 0.064, 11);
  });

  it('evaluates quintic pieces with their derivatives', () => {
    const piece = { kind: /** @type {const} */ ('poly'), start: 1, length: 0.5, coeffs: Float64Array.from([1, -2, 0.5, 3, -1, 0.2]) };
    const out = new Float64Array(3);
    const p = (/** @type {number} */ psi) => evaluatePoly(piece, psi, new Float64Array(3))[0];
    for (const psi of [1, 1.2, 1.5]) {
      evaluatePoly(piece, psi, out);
      expect(out[1]).toBeCloseTo(derivative(p, psi, 1e-3), 8);
      expect(out[2]).toBeCloseTo(derivative((x) => evaluatePoly(piece, x, new Float64Array(3))[1], psi, 1e-3), 7);
    }
  });

  it('builds a brace blend that meets its five conditions', () => {
    const blend = /** @type {import('../../src/core/inverse.js').PolyPiece} */ (
      braceBlend({ psi0: 3.3, p0: 0.03, psi1: 3.9, p1: 0.028, d1: -0.01, s1: 0.02, integral: 0.0175 })
    );
    const out = new Float64Array(3);
    expect(evaluatePoly(blend, 3.3, out)[0]).toBeCloseTo(0.03, 15);
    evaluatePoly(blend, 3.9, out);
    expect(out[0]).toBeCloseTo(0.028, 15);
    expect(out[1]).toBeCloseTo(-0.01, 14);
    expect(out[2]).toBeCloseTo(0.02, 13);
    // ∫ p dψ by Simpson on a fine grid.
    const m = 2000;
    let sum = 0;
    for (let k = 0; k <= m; k++) {
      const w = k === 0 || k === m ? 1 : k % 2 ? 4 : 2;
      sum += w * evaluatePoly(blend, 3.3 + (0.6 * k) / m, out)[0];
    }
    expect((sum * 0.6) / m / 3).toBeCloseTo(0.0175, 14);
    expect(braceBlend({ psi0: 1, p0: 0.03, psi1: 1, p1: 0.03, d1: 0, s1: 0, integral: 0 })).toBeNull();
  });

  it('reports a string track that cannot reach the nock and a limb without a finite brace moment', () => {
    const bad = createInverse({ geometry, stringTrack: eccentricCircle({ radius: 0.03, offset: 0.5, phase: -Math.PI / 2 }), limb: limbData });
    expect(bad.context).toBeNull();
    expect(bad.error).toMatch(/string/);
    const nan = createInverse({ geometry, stringTrack: twinCam.stringTrack, limb: { kind: 'linear', torsionalStiffness: NaN, alpha0: 0.1 } });
    expect(nan.error).toMatch(/limb/);
    const kind = createInverse({ geometry, stringTrack: /** @type {any} */ ({ kind: 'square' }), limb: limbData });
    expect(kind.error).toMatch(/kind/);
    const geo = createInverse({ geometry: { ...geometry, ata: NaN }, stringTrack: twinCam.stringTrack, limb: limbData });
    expect(geo.error).toMatch(/finite/);
  });

  it('marks samples that the limb cannot reach or the closure cannot solve, and stops there', () => {
    const ctx = context(twinCam);
    const brace = braceConditions(ctx, 1000);
    // A tabulated limb whose moment falls to zero stores at most a finite energy.
    const table = /** @type {import('../../src/core/limb.js').TableLimbData} */ (
      tableLimb({ rotation: [0, 0.1, 0.2], moment: [0, 300, 100], alpha0: 0.1 }).limb
    );
    const weak = /** @type {import('../../src/core/inverse.js').InverseContext} */ (
      createInverse({ geometry, stringTrack: twinCam.stringTrack, limb: table }).context
    );
    const q = inverseAt(weak, braceConditions(weak, 200), geometry.braceHeight + 0.1, 100, 500, 0.1, 0.1);
    expect(q.ok).toBe(false);
    expect(q.alpha).toBeNaN();
    const target = { force: (/** @type {number} */ x) => (x > 0.3 ? NaN : 100), work: (/** @type {number} */ x) => 100 * (x - geometry.braceHeight), slope: 1000 };
    const xs = [geometry.braceHeight, 0.25, 0.3, 0.35, 0.4];
    const s = sampleInverse(ctx, brace, target, xs);
    expect(s.solved).toBe(3);
    expect(s.x[4]).toBe(0.4);
    expect(s.pC[3]).toBeNaN();
    // The resampling fails where the force is not finite.
    const all = sampleInverse(ctx, brace, { ...target, force: () => 100 }, xs);
    expect(resampleCable(ctx, brace, target, { ...all }, 0.5 * DEG)).toBeNull();
  });
});
