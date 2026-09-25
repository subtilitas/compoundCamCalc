import { describe, expect, it } from 'vitest';
import { CLOSURE_TOLERANCE, DEFAULT_WRAP, FULL_SAMPLES, MAX_SAMPLES, drawGrid, solveForward } from '../../src/core/forward.js';
import { axle, bowGeometry } from '../../src/core/geometry.js';
import { createLimb, linearLimb, tableLimb } from '../../src/core/limb.js';
import { createSupport, eccentricCircle, ellipse, offset, splineSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { derivative, integrate, solveDense } from './numeric.js';

/** @typedef {import('../../src/core/forward.js').ForwardInput} ForwardInput */
/** @typedef {import('../../src/core/forward.js').ForwardResult} ForwardResult */
/** @typedef {import('../../src/core/geometry.js').BowGeometry} BowGeometry */
/** @typedef {import('../../src/core/support.js').SupportData} SupportData */
/** @typedef {import('../../src/core/support.js').Support} Support */
/** @typedef {{ x: number, y: number }} Vec */

const DEG = Math.PI / 180;
const geometry = defaultState().geometry;
const limbData = linearLimb({ stiffness: 10e3, preloadTravel: 0.03, limbLength: geometry.limbLength });
const limb = createLimb(limbData);

/**
 * Realistic twin cam used by several tests. Groove bottoms: string track an
 * eccentric circle of radius 45 mm, offset 6 mm, phase 45°; cable track an
 * eccentric circle of radius 18 mm, offset 10 mm, phase −60°; both cords
 * 2.5 mm, so the pitch lines are 1.25 mm further out (string pitch radius
 * 46.25 mm). With the default geometry (ATA 33 in, brace height 6.5 in, draw
 * length 29 in) the cam turns about 258° and the string wraps about 341° at
 * brace, including the 30° residual wrap, so it stays within one turn of
 * its groove. The axle moves about 54 mm, so the default limb of 27 N/mm
 * would peak near 700 N; 10 N/mm with 30 mm preload gives a peak of about
 * 260 N at 25.4 in and a let-off of about 38 %. The smallest cable lever arm
 * (phase −60° + 180° = 120°) comes round near the cable contact at full
 * draw, which produces the let-off. The cable lever arm stays below 0.7
 * times the string lever arm, so the force rises slowly and peaks late in
 * the draw.
 */
const twinCam = {
  stringTrack: offset(eccentricCircle({ radius: 0.045, offset: 0.006, phase: 45 * DEG }), 0.00125),
  cableTrack: offset(eccentricCircle({ radius: 0.018, offset: 0.01, phase: -60 * DEG }), 0.00125),
};

/**
 * @param {Partial<ForwardInput>} [extra]
 * @returns {ForwardInput}
 */
function input(extra = {}) {
  return { geometry, ...twinCam, limb: limbData, ...extra };
}

/**
 * @param {SupportData} stringTrack
 * @returns {BowGeometry}
 */
function bowFor(stringTrack) {
  return /** @type {BowGeometry} */ (bowGeometry(geometry, createSupport(stringTrack)).bow);
}

/**
 * Trapezoid integral of F dx over the samples.
 * @param {ForwardResult} r
 */
function trapezoid(r) {
  let e = 0;
  for (let i = 0; i < r.n - 1; i++) e += 0.5 * (r.F[i] + r.F[i + 1]) * (r.x[i + 1] - r.x[i]);
  return e;
}

/**
 * Bow layout from its definition, without core/geometry: axle at brace
 * O_b = (x_b − p_s(0), ATA/2), limb pivot Q = O_b − R_L·(cos β_b, sin β_b),
 * axle O(α) = Q + R_L·(cos(β_b − α), sin(β_b − α)).
 * @param {Support} s string pitch line
 */
function layout(s) {
  const { braceHeight, ata, limbLength: R, limbAngleBrace: beta } = geometry;
  const q = { x: braceHeight - s.p(0) - R * Math.cos(beta), y: ata / 2 - R * Math.sin(beta) };
  return {
    q,
    /** @param {number} alpha @returns {Vec} */
    axleAt: (alpha) => ({ x: q.x + R * Math.cos(beta - alpha), y: q.y + R * Math.sin(beta - alpha) }),
  };
}

/**
 * Point of the cam frame (cam turned by θ about the axle O) in the world
 * frame: O + R(−θ)·P.
 * @param {Vec} O
 * @param {number} theta
 * @param {Vec} P
 * @returns {Vec}
 */
function camToWorld(O, theta, P) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: O.x + c * P.x + s * P.y, y: O.y - s * P.x + c * P.y };
}

/**
 * Cam-frame angle of the tangent point of the line from the world point B
 * to a track, without core/contact: bisection of
 * f(ψ) = (B_cam − X(ψ))·n(ψ) on the nearest cell around the guess where f
 * changes sign in the right direction. The string leaves along −t, where f
 * falls through zero; the cable leaves along +t, where f rises.
 * @param {Support} support
 * @param {Vec} O axle
 * @param {number} theta cam rotation
 * @param {Vec} B world point
 * @param {boolean} rising true for the cable
 * @param {number} guess (rad)
 */
function tangentAngle(support, O, theta, B, rising, guess) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const bx = c * (B.x - O.x) - s * (B.y - O.y);
  const by = s * (B.x - O.x) + c * (B.y - O.y);
  const f = (/** @type {number} */ psi) => {
    const X = support.point(psi);
    return (bx - X.x) * Math.cos(psi) + (by - X.y) * Math.sin(psi);
  };
  const step = 0.02;
  for (let k = 0; k < 160; k++) {
    for (let lo of [guess + k * step, guess - (k + 1) * step]) {
      let hi = lo + step;
      const [fl, fh] = [f(lo), f(hi)];
      if (rising ? !(fl < 0 && fh >= 0) : !(fl > 0 && fh <= 0)) continue;
      for (let it = 0; it < 200; it++) {
        const mid = 0.5 * (lo + hi);
        if (mid <= lo || mid >= hi) break;
        if ((f(mid) < 0) === rising) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    }
  }
  return NaN;
}

/**
 * Statics of sample i from a free-body balance in the world frame, without
 * the lever arms and projections of the solver. Contact points come from
 * the track shapes at the tangent angles found by bisection; the cord
 * directions come from the positions of contact, nock and anchor. Cam: the
 * moments of string and cable about the axle cancel. Limb: the moment of the
 * cord forces on the axle about the pivot balances the limb moment E1'(α).
 * The axle carries the string and the top cable, T_s·u_s + T_c·u_c, and the
 * yoke of the bottom cable, which pulls towards the mirror image of the
 * cable contact, T_c·(−u_c,x, u_c,y).
 * @param {ForwardResult} r
 * @param {number} i sample
 * @param {Support} s string pitch line
 * @param {Support} c cable pitch line
 */
function freeBody(r, i, s, c) {
  const lay = layout(s);
  const theta = r.theta[i];
  const alpha = r.alpha[i];
  const O = lay.axleAt(alpha);
  const N = { x: r.x[i], y: 0 };
  const A = { x: O.x, y: -O.y };
  const Xs = camToWorld(O, theta, s.point(tangentAngle(s, O, theta, N, false, r.psiS[i])));
  const Xc = camToWorld(O, theta, c.point(tangentAngle(c, O, theta, A, true, r.psiC[i])));
  const ls = Math.hypot(N.x - Xs.x, N.y - Xs.y);
  const lc = Math.hypot(A.x - Xc.x, A.y - Xc.y);
  const us = { x: (N.x - Xs.x) / ls, y: (N.y - Xs.y) / ls };
  const uc = { x: (A.x - Xc.x) / lc, y: (A.y - Xc.y) / lc };
  const cross = (/** @type {Vec} */ a, /** @type {Vec} */ b) => a.x * b.y - a.y * b.x;
  const armS = cross({ x: Xs.x - O.x, y: Xs.y - O.y }, us);
  const armC = cross({ x: Xc.x - O.x, y: Xc.y - O.y }, uc);
  // α turns the lever clockwise: the limb moment is −(O − Q) × force.
  const lever = { x: O.x - lay.q.x, y: O.y - lay.q.y };
  const limbS = -cross(lever, us);
  const limbC = -cross(lever, { x: 0, y: 2 * uc.y });
  const [Ts, Tc] = solveDense([[armS, armC], [limbS, limbC]], [0, limb.moment(alpha)]);
  return { Ts, Tc, F: 2 * Ts * us.x, span: ls };
}

/**
 * Closure path solved without core/forward, core/geometry and core/contact.
 * Cord lengths up to constants: free span from the tangent point (by
 * bisection) plus the arc length ∫ρ dψ from the tangent point to a fixed
 * cam angle (Gauss–Legendre); the string wraps towards larger ψ, the cable
 * towards smaller ψ. Newton on (θ, α) with a central-difference Jacobian
 * holds both lengths at their brace values.
 * @param {{ stringTrack: SupportData, cableTrack: SupportData }} cam
 */
function independentPath(cam) {
  const s = createSupport(cam.stringTrack);
  const c = createSupport(cam.cableTrack);
  const lay = layout(s);
  const rhoS = (/** @type {number} */ psi) => s.rho(psi);
  const rhoC = (/** @type {number} */ psi) => c.rho(psi);
  const state = { theta: 0, psiS: 0, psiC: Math.PI };
  /** @param {number} x @param {number} theta @param {number} alpha */
  const lengths = (x, theta, alpha) => {
    const O = lay.axleAt(alpha);
    const N = { x, y: 0 };
    const A = { x: O.x, y: -O.y };
    const psiS = tangentAngle(s, O, theta, N, false, state.psiS + theta - state.theta);
    const psiC = tangentAngle(c, O, theta, A, true, state.psiC + theta - state.theta);
    const Xs = camToWorld(O, theta, s.point(psiS));
    const Xc = camToWorld(O, theta, c.point(psiC));
    return {
      string: Math.hypot(N.x - Xs.x, N.y - Xs.y) - integrate(rhoS, 0, psiS),
      cable: Math.hypot(A.x - Xc.x, A.y - Xc.y) + integrate(rhoC, Math.PI, psiC),
      psiS,
      psiC,
    };
  };
  const brace = lengths(geometry.braceHeight, 0, 0);
  /** @param {number} x @param {number} theta @param {number} alpha */
  const residual = (x, theta, alpha) => {
    const g = lengths(x, theta, alpha);
    return [g.string - brace.string, g.cable - brace.cable];
  };
  let theta = 0;
  let alpha = 0;
  let dTheta = 0;
  let dAlpha = 0;
  let xPrev = geometry.braceHeight;
  /**
   * α and θ at the nock position x; call with increasing x.
   * @param {number} x
   */
  return (x) => {
    let th = theta + dTheta * (x - xPrev);
    let al = alpha + dAlpha * (x - xPrev);
    const e = 1e-7;
    for (let it = 0; it < 40; it++) {
      const r0 = residual(x, th, al);
      const rt = [residual(x, th + e, al), residual(x, th - e, al)];
      const ra = [residual(x, th, al + e), residual(x, th, al - e)];
      const J = [0, 1].map((k) => [(rt[0][k] - rt[1][k]) / (2 * e), (ra[0][k] - ra[1][k]) / (2 * e)]);
      const [st, sa] = solveDense(J, [-r0[0], -r0[1]]);
      th += st;
      al += sa;
      if (Math.abs(st) + Math.abs(sa) < 1e-15) break;
    }
    const g = lengths(x, th, al);
    Object.assign(state, { theta: th, psiS: g.psiS, psiC: g.psiC });
    if (x > xPrev) {
      dTheta = (th - theta) / (x - xPrev);
      dAlpha = (al - alpha) / (x - xPrev);
    }
    theta = th;
    alpha = al;
    xPrev = x;
    return { theta: th, alpha: al };
  };
}

/**
 * Solve at the points xs, embedded in a coarse grid below them so that the
 * warm starts stay close.
 * @param {ForwardInput} base
 * @param {number[]} xs increasing
 */
function solveAt(base, xs) {
  const bow = bowFor(base.stringTrack);
  const coarse = Array.from(drawGrid(bow.xBrace, bow.xFull, 200)).filter((x) => x < xs[0]);
  const r = solveForward({ ...base, x: [...coarse, ...xs] });
  return { r, offset: coarse.length };
}

describe('forward model: concentric circles', () => {
  // A string circle of 50 mm pays out the draw within one turn (about 323° of wrap at brace).
  const rs = 0.05;
  const rc = 0.02;
  const circles = { stringTrack: eccentricCircle({ radius: rs }), cableTrack: eccentricCircle({ radius: rc }) };
  const bow = bowFor(circles.stringTrack);
  const r = solveForward(input(circles));
  const D0 = 2 * bow.braceAxleY;

  /**
   * Cable closure for a circle of radius r_c about the axle: the anchor A lies
   * straight below O at D = 2·O_y, the cable wraps r_c·(ψ_c − ψ_e) with
   * ψ_c = θ − π/2 − acos(r_c/D) and has the free span √(D² − r_c²). Constant
   * length gives θ(α) = [√(D0² − r_c²) − √(D² − r_c²)]/r_c + acos(r_c/D) − acos(r_c/D0).
   * @param {number} alpha
   */
  const thetaOf = (alpha) => {
    const D = 2 * axle(bow, alpha).y;
    return (Math.sqrt(D0 * D0 - rc * rc) - Math.sqrt(D * D - rc * rc)) / rc + Math.acos(rc / D) - Math.acos(rc / D0);
  };
  /** dθ/dα of the closed form: −D'·√(D² − r_c²)/(r_c·D). @param {number} alpha */
  const dThetaOf = (alpha) => {
    const o = axle(bow, alpha);
    const D = 2 * o.y;
    return (-2 * o.dy * Math.sqrt(D * D - rc * rc)) / (rc * D);
  };

  it('solves every sample with a closure residual below 1e-10 m', () => {
    expect(r.status).toBe('ok');
    expect(r.n).toBe(FULL_SAMPLES);
    for (let i = 0; i < r.n; i++) expect(r.closure[i]).toBeLessThan(CLOSURE_TOLERANCE);
  });

  it('follows the closed-form θ(α) of the cable closure to 1e-12 rad', () => {
    let worst = 0;
    for (let i = 0; i < r.n; i++) worst = Math.max(worst, Math.abs(r.theta[i] - thetaOf(r.alpha[i])));
    expect(worst).toBeLessThan(1e-12);
  });

  it('has the tensions of the free-body balance, with T_c/T_s = r_s/r_c', () => {
    const s = createSupport(circles.stringTrack);
    const c = createSupport(circles.cableTrack);
    for (let i = 0; i < r.n; i += 29) {
      const fb = freeBody(r, i, s, c);
      expect(Math.abs((fb.Tc / fb.Ts) * (rc / rs) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(r.Ts[i] / fb.Ts - 1)).toBeLessThan(1e-9);
      expect(Math.abs(r.Tc[i] / fb.Tc - 1)).toBeLessThan(1e-9);
    }
  });

  it('matches the semi-analytic F(x) with α as the parameter', () => {
    // String closure for a circle about the axle: nock vector v = N − O at
    // distance d and angle γ; half-length √(d² − r_s²) + r_s·(ψ_e − ψ_c) with
    // ψ_c = γ + θ + acos(r_s/d). h(x, α) below is that length up to a constant.
    /** @param {number} x @param {number} alpha */
    const parts = (x, alpha) => {
      const o = axle(bow, alpha);
      const vx = x - o.x;
      const vy = -o.y;
      const d = Math.hypot(vx, vy);
      return { o, vx, vy, d, s: Math.sqrt(d * d - rs * rs) };
    };
    /** @param {number} x @param {number} alpha */
    const h = (x, alpha) => {
      const { vx, vy, d, s } = parts(x, alpha);
      return s - rs * (Math.atan2(vy, vx) + thetaOf(alpha) + Math.acos(rs / d));
    };
    /** @param {number} x @param {number} alpha */
    const hx = (x, alpha) => {
      const { vx, vy, d, s } = parts(x, alpha);
      return ((s / d) * vx) / d + (rs * vy) / (d * d);
    };
    /** @param {number} x @param {number} alpha */
    const ha = (x, alpha) => {
      const { o, vx, vy, d, s } = parts(x, alpha);
      const dd = -(vx * o.dx + vy * o.dy) / d;
      const dGamma = (-vx * o.dy + vy * o.dx) / (d * d);
      return (s / d) * dd - rs * dGamma - rs * dThetaOf(alpha);
    };
    const h0 = h(bow.xBrace, 0);
    const alphaFull = r.alpha[r.n - 1];
    /** @type {number[]} */
    const xs = [];
    /** @type {number[]} */
    const F = [];
    /** @type {number[]} */
    const alphas = [];
    for (let k = 1; k <= 40; k++) {
      const alpha = (alphaFull * k) / 40;
      /** @type {number} */
      let x = xs.length > 0 ? xs[xs.length - 1] : bow.xBrace + 0.05;
      for (let it = 0; it < 60; it++) {
        const dx = -(h(x, alpha) - h0) / hx(x, alpha);
        x += dx;
        if (Math.abs(dx) < 1e-16) break;
      }
      xs.push(x);
      alphas.push(alpha);
      // F = 2·E1'(α)·dα/dx with dx/dα = −h_α/h_x.
      F.push((2 * limb.moment(alpha)) / (-ha(x, alpha) / hx(x, alpha)));
    }
    const fwd = solveForward(input({ ...circles, x: [bow.xBrace, ...xs] }));
    let worstF = 0;
    let worstAlpha = 0;
    xs.forEach((_, k) => {
      worstF = Math.max(worstF, Math.abs(fwd.F[k + 1] / F[k] - 1));
      worstAlpha = Math.max(worstAlpha, Math.abs(fwd.alpha[k + 1] - alphas[k]));
    });
    expect(worstF).toBeLessThan(1e-10);
    expect(worstAlpha).toBeLessThan(1e-13);
  });

  it('reports cord lengths from the terminations', () => {
    const brace = /** @type {import('../../src/core/forward.js').BraceState} */ (r.brace);
    const psiEndC = brace.psiC - 0.5;
    const withEnds = solveForward(input({ ...circles, samples: 20, cableTermination: psiEndC, stringTermination: 7 }));
    expect(withEnds.cableLength).toBeCloseTo(Math.sqrt(D0 * D0 - rc * rc) + rc * 0.5, 14);
    expect(withEnds.stringLength).toBeCloseTo(2 * (bow.braceAxleY + rs * 7), 14);
    expect(r.cableTermination).toBeCloseTo(brace.psiC - DEFAULT_WRAP, 15);
    expect(r.stringTermination).toBeCloseTo(r.psiS[r.n - 1] + DEFAULT_WRAP, 15);
  });
});

describe('forward model: statics, energy and convergence', () => {
  const cams = [
    ['eccentric circles', twinCam],
    [
      'ellipse string track',
      {
        stringTrack: offset(ellipse({ a: 0.05, b: 0.042, axisAngle: 20 * DEG, offset: 0.004, offsetAngle: 60 * DEG }), 0.00125),
        cableTrack: twinCam.cableTrack,
      },
    ],
  ];
  for (const [name, cam] of /** @type {[string, { stringTrack: SupportData, cableTrack: SupportData }][]} */ (cams)) {
    const r = solveForward(input(cam));
    const bow = bowFor(cam.stringTrack);
    const s = createSupport(cam.stringTrack);
    const c = createSupport(cam.cableTrack);

    it(`${name}: F, T_s and T_c equal a free-body balance in the world frame to 1e-9`, () => {
      expect(r.status).toBe('ok');
      for (let i = 1; i < r.n; i += 37) {
        const fb = freeBody(r, i, s, c);
        expect(Math.abs(fb.F / r.F[i] - 1)).toBeLessThan(1e-9);
        expect(Math.abs(fb.Ts / r.Ts[i] - 1)).toBeLessThan(1e-9);
        expect(Math.abs(fb.Tc / r.Tc[i] - 1)).toBeLessThan(1e-9);
      }
    });

    it(`${name}: F equals dE/dx of the limb energy along an independently solved closure path to 1e-9`, () => {
      const h = 2.5e-4;
      for (const x0 of [bow.xBrace + 0.1, bow.xBrace + 0.3, bow.xFull - 0.03]) {
        const path = independentPath(cam);
        const xs = [x0 - 2 * h, x0 - h, x0, x0 + h, x0 + 2 * h];
        const approach = Array.from(drawGrid(bow.xBrace, bow.xFull, 40)).filter((x) => x > bow.xBrace && x < xs[0]);
        for (const x of approach) path(x);
        const states = xs.map((x) => path(x));
        const energy = (/** @type {number} */ x) => 2 * limb.energy(states[xs.indexOf(x)].alpha);
        const { r: fr, offset: k } = solveAt(input(cam), xs);
        expect(Math.abs(states[2].alpha - fr.alpha[k + 2])).toBeLessThan(1e-12);
        expect(Math.abs(states[2].theta - fr.theta[k + 2])).toBeLessThan(1e-11);
        expect(Math.abs(derivative(energy, x0, h) / fr.F[k + 2] - 1)).toBeLessThan(1e-9);
      }
    });

    it(`${name}: F equals 2·E1'(α)·dα/dx from finite differences of the solution`, () => {
      const h = 1e-4;
      for (const x0 of [bow.xBrace + 0.1, bow.xBrace + 0.3, bow.xFull - 0.03]) {
        const xs = [x0 - 2 * h, x0 - h, x0, x0 + h, x0 + 2 * h];
        const { r: fr, offset: k } = solveAt(input(cam), xs);
        const alphaAt = (/** @type {number} */ x) => fr.alpha[k + xs.indexOf(x)];
        const dAlpha = derivative((x) => alphaAt(x), x0, h);
        const Fvw = 2 * limb.moment(fr.alpha[k + 2]) * dAlpha;
        expect(Math.abs(Fvw / fr.F[k + 2] - 1)).toBeLessThan(1e-9);
      }
    });

    it(`${name}: the integral of F dx equals the limb energy 2·(E1(α_f) − E1(0)) to 1e-6`, () => {
      const dense = solveForward(input({ ...cam, samples: 2000 }));
      expect(Math.abs(trapezoid(dense) / dense.drawEnergy - 1)).toBeLessThan(1e-6);
      // Independent Simpson rule in s, x − x_b = s², on 1501 samples.
      const n = 1501;
      const fine = solveForward(input({ ...cam, samples: n }));
      const sMax = Math.sqrt(bow.xFull - bow.xBrace);
      const hs = sMax / (n - 1);
      let e = 0;
      for (let i = 0; i < n; i++) {
        const weight = i === 0 || i === n - 1 ? 1 : i % 2 === 1 ? 4 : 2;
        e += weight * fine.F[i] * 2 * hs * i;
      }
      e *= hs / 3;
      expect(Math.abs(e / fine.drawEnergy - 1)).toBeLessThan(1e-9);
      expect(fine.drawEnergy).toBeCloseTo(2 * (limb.energy(fine.alpha[n - 1]) - limb.energy(0)), 10);
      expect(fine.limbEnergy - fine.preloadEnergy).toBeCloseTo(fine.drawEnergy, 10);
    });

    it(`${name}: the trapezoid energy error falls with the second order of the grid`, () => {
      const errors = [100, 200, 400, 800].map((n) => {
        const g = solveForward(input({ ...cam, samples: n }));
        return Math.abs(trapezoid(g) - g.drawEnergy);
      });
      for (let k = 0; k < errors.length - 1; k++) {
        const order = Math.log2(errors[k] / errors[k + 1]);
        expect(order).toBeGreaterThan(1.9);
        expect(order).toBeLessThan(2.1);
      }
    });
  }

  it('gives the same solution at a point for any grid through it', () => {
    const coarse = solveForward(input({ samples: 100 }));
    const bow = bowFor(twinCam.stringTrack);
    const merged = [...new Set([...coarse.x, ...drawGrid(bow.xBrace, bow.xFull, 1500)])].sort((a, b) => a - b);
    const fine = solveForward(input({ x: merged }));
    for (let i = 0; i < coarse.n; i++) {
      const j = merged.indexOf(coarse.x[i]);
      expect(Math.abs(fine.theta[j] - coarse.theta[i])).toBeLessThan(1e-12);
      expect(Math.abs(fine.F[j] - coarse.F[i])).toBeLessThan(1e-9 * Math.max(1, Math.abs(coarse.F[i])));
    }
  });

  it('reports draw and limb energy only for a grid that ends at full draw', () => {
    const bow = bowFor(twinCam.stringTrack);
    const partial = solveForward(input({ x: [bow.xBrace, 0.3, 0.4] }));
    expect(partial.status).toBe('ok');
    expect(partial.drawEnergy).toBeNaN();
    expect(partial.limbEnergy).toBeNaN();
    expect(partial.preloadEnergy).toBe(2 * limb.energy(0));
    const grid = drawGrid(bow.xBrace, bow.xFull, 300);
    const explicit = solveForward(input({ x: grid }));
    const byCount = solveForward(input({ samples: 300 }));
    expect(explicit.drawEnergy).toBe(byCount.drawEnergy);
    expect(explicit.limbEnergy).toBe(byCount.limbEnergy);
  });

  it('accepts a tabulated limb and matches the linear limb with the same moments', () => {
    const kt = limbData.torsionalStiffness;
    const rotation = [0, 0.2, 0.4, 0.6];
    const table = tableLimb({ rotation, moment: rotation.map((q) => kt * q), alpha0: limbData.alpha0 }).limb;
    const a = solveForward(input({ samples: 200 }));
    const b = solveForward(input({ samples: 200, limb: /** @type {any} */ (table) }));
    for (let i = 1; i < a.n; i++) expect(Math.abs(b.F[i] / a.F[i] - 1)).toBeLessThan(1e-12);
  });
});

describe('forward model: brace', () => {
  const r = solveForward(input());

  it('starts at θ = 0, α = 0, F = 0 with the tensions and span of the free-body balance', () => {
    const b = /** @type {import('../../src/core/forward.js').BraceState} */ (r.brace);
    expect([r.theta[0], r.alpha[0], r.x[0]]).toEqual([0, 0, geometry.braceHeight]);
    // sin φ at brace is zero up to the rounding of the contact angle.
    expect(Math.abs(r.F[0])).toBeLessThan(1e-12);
    expect(b.psiS).toBeCloseTo(0, 15);
    const fb = freeBody(r, 0, createSupport(twinCam.stringTrack), createSupport(twinCam.cableTrack));
    expect(Math.abs(b.stringTension / fb.Ts - 1)).toBeLessThan(1e-9);
    expect(Math.abs(b.cableTension / fb.Tc - 1)).toBeLessThan(1e-9);
    expect(Math.abs(b.span / fb.span - 1)).toBeLessThan(1e-12);
    expect(b.moment).toBe(limb.moment(0));
    expect(Math.abs(b.slope / ((2 * fb.Ts) / fb.span) - 1)).toBeLessThan(1e-9);
    expect(r.Ts[0]).toBe(b.stringTension);
  });

  /**
   * F'(x_b) and F''(x_b) from the degree-7 polynomial through F(x_b + k·h),
   * k = 0 … 7, with F(x_b) = 0.
   * @param {SupportData} cableTrack
   * @param {number} h
   */
  function braceDerivatives(cableTrack, h) {
    const bow = bowFor(twinCam.stringTrack);
    const K = 7;
    const xs = Array.from({ length: K + 1 }, (_, k) => bow.xBrace + k * h);
    const f = solveForward(input({ cableTrack, x: xs }));
    const A = [];
    const rhs = [];
    for (let k = 1; k <= K; k++) {
      A.push(Array.from({ length: K }, (_, j) => (k * h) ** (j + 1)));
      rhs.push(f.F[k]);
    }
    const coeffs = solveDense(A, rhs);
    return { slope: coeffs[0], second: 2 * coeffs[1], brace: /** @type {any} */ (f.brace) };
  }

  it("has F'(x_b) = 2·T_s0/l_0", () => {
    const d = braceDerivatives(twinCam.cableTrack, 1e-3);
    expect(Math.abs(d.slope / d.brace.slope - 1)).toBeLessThan(1e-8);
  });

  it("has F''(x_b) that does not depend on p_c' at brace", () => {
    const bow = bowFor(twinCam.stringTrack);
    // Cable tracks with the same lever arm p_c = 20 mm at the brace contact
    // ψ_c0 = π + asin(p_c/D0) (tangent from A to the circle about the axle),
    // with p_c' = 0, −8 mm, +8 mm and −6·sin(0.4) mm.
    const pc = 0.02;
    const psi0 = Math.PI + Math.asin(pc / (2 * bow.braceAxleY));
    const tracks = [
      eccentricCircle({ radius: pc }),
      eccentricCircle({ radius: pc, offset: 0.008, phase: psi0 - Math.PI / 2 }),
      eccentricCircle({ radius: pc, offset: 0.008, phase: psi0 + Math.PI / 2 }),
      eccentricCircle({ radius: pc - 0.006 * Math.cos(0.4), offset: 0.006, phase: psi0 - 0.4 }),
    ];
    const d = tracks.map((t) => braceDerivatives(t, 1e-3));
    const slopes = tracks.map((t) => createSupport(t).dp(psi0));
    expect(Math.abs(slopes[1] + 0.008)).toBeLessThan(1e-15);
    for (const q of d) {
      expect(q.brace.psiC).toBeCloseTo(psi0, 12);
      expect(q.brace.pC).toBeCloseTo(pc, 15);
      expect(Math.abs(q.second / d[0].second - 1)).toBeLessThan(1e-6);
    }
    // Control: the tracks give different curves away from brace.
    const far = tracks.map((t) => solveForward(input({ cableTrack: t, x: [bow.xBrace, bow.xBrace + 0.05, bow.xBrace + 0.1] })).F[2]);
    expect(Math.abs(far[1] / far[0] - 1)).toBeGreaterThan(1e-2);
    expect(Math.abs(far[2] / far[0] - 1)).toBeGreaterThan(1e-2);
  });
});

describe('forward model: a cable track that is a point at the axle', () => {
  it('keeps α constant and gives F = 0', () => {
    const r = solveForward(input({ cableTrack: eccentricCircle({ radius: 0 }), samples: 300 }));
    for (let i = 0; i < r.n; i++) {
      // α stays at 0 up to the rounding of the cable length |A − O|.
      expect(Math.abs(r.alpha[i])).toBeLessThan(1e-15);
      expect(Math.abs(r.F[i])).toBe(0);
    }
    expect(r.theta[r.n - 1]).toBeGreaterThan(1);
    // With the limbs at rest the string pays out the whole draw, more than
    // one turn of its track.
    expect(r.diagnostics.map((d) => d.code)).toEqual(['slack-string', 'wrap-overlap']);
  });
});

describe('forward model: realistic twin cam', () => {
  it('draws with a peak between 150 N and 500 N and a lower force at full draw', () => {
    const r = solveForward(input());
    expect(r.status).toBe('ok');
    expect(r.diagnostics).toEqual([]);
    let peak = 0;
    let at = 0;
    for (let i = 0; i < r.n; i++) {
      if (r.F[i] > peak) {
        peak = r.F[i];
        at = i;
      }
    }
    const hold = Math.min(...r.F.subarray(at));
    expect(peak).toBeGreaterThan(150);
    expect(peak).toBeLessThan(500);
    expect((peak - hold) / peak).toBeGreaterThan(0.2);
    expect(r.F[r.n - 1]).toBeLessThan(peak);
    for (let i = 1; i < r.n; i++) {
      expect(r.theta[i]).toBeGreaterThan(r.theta[i - 1]);
      expect(r.alpha[i]).toBeGreaterThan(r.alpha[i - 1]);
    }
    // Each cord wraps less than one turn: the string at brace, the cable at full draw.
    expect(r.stringTermination - r.psiS[0]).toBeLessThan(2 * Math.PI);
    expect(r.psiC[r.n - 1] - r.cableTermination).toBeLessThan(2 * Math.PI);
    expect(r.alpha[r.n - 1]).toBeLessThan(defaultState().limb.maxRotation);
    // The output survives structured cloning, as needed for a worker.
    const copy = structuredClone(r);
    expect(copy.F).toEqual(r.F);
  });
});

describe('forward model: diagnostics', () => {
  /** @param {ForwardResult} r */
  const codes = (r) => r.diagnostics.map((d) => d.code);

  it('invalid-input: bad geometry, track data, grid, sample count or limb', () => {
    const xFull = bowFor(twinCam.stringTrack).xFull;
    const table = /** @type {import('../../src/core/limb.js').TableLimbData} */ (
      tableLimb({ rotation: [0, 0.2], moment: [0, 100], alpha0: 0.1 }).limb
    );
    const cases = [
      /** @type {any} */ (undefined),
      input({ geometry: { ...geometry, ata: NaN } }),
      input({ cableTrack: /** @type {any} */ ({ kind: 'square' }) }),
      input({ stringTrack: ellipse({ a: 0.04, b: 0 }) }),
      input({ x: [geometry.braceHeight - 0.01, 0.3] }),
      input({ x: [0.3, 0.2] }),
      input({ x: [] }),
      input({ x: [geometry.braceHeight, xFull + 1e-6] }),
      input({ samples: 1 }),
      input({ limb: { kind: 'linear', torsionalStiffness: NaN, alpha0: 0.1 } }),
      input({ limb: { ...table, alpha0: NaN } }),
      input({ limb: /** @type {any} */ ({ ...table, alpha0: undefined }) }),
      input({ limb: /** @type {any} */ ({ kind: 'spring', torsionalStiffness: 100, alpha0: 0.1 }) }),
      input({ stringTermination: NaN }),
      input({ cableTermination: Infinity }),
      input({ samples: Number.MAX_SAFE_INTEGER }),
      input({ samples: MAX_SAMPLES + 1 }),
      input({ x: Array.from({ length: MAX_SAMPLES + 1 }, (_, i) => geometry.braceHeight + i * 1e-9) }),
      input({ maxIterations: 0 }),
      input({ maxIterations: 1.5 }),
      input({ maxIterations: 1e9 }),
    ];
    for (const c of cases) {
      const r = solveForward(c);
      expect(r.status).toBe('infeasible');
      expect(codes(r)).toEqual(['invalid-input']);
      expect(r.diagnostics[0].xRange).toBeNull();
      expect(r.n).toBe(0);
    }
  });

  it('non-finite: values beyond the floating-point range are reported; representable ones stay finite', () => {
    // M(0) = 1e307·10 = 1e308: 2·M overflows, but F = 2·(M·dα/dx) and the tensions do not.
    const large = solveForward(input({ limb: { kind: 'linear', torsionalStiffness: 1e307, alpha0: 10 }, samples: 20 }));
    expect(large.status).toBe('ok');
    expect(large.F.every(Number.isFinite)).toBe(true);
    // M(0) = 1.7e308: T_c = M·p_s/det overflows.
    const huge = solveForward(input({ limb: { kind: 'linear', torsionalStiffness: 1e307, alpha0: 17 }, samples: 20 }));
    expect(huge.status).toBe('infeasible');
    expect(codes(huge)).toContain('non-finite');
  });

  it('brace: the cable anchor lies inside the cable track', () => {
    const r = solveForward(input({ cableTrack: eccentricCircle({ radius: 2 }) }));
    expect(codes(r)).toEqual(['brace']);
    expect(r.diagnostics[0].message).toMatch(/power cable/);
    // p_s'(0) = −0.5 m: the tangent at ψ = 0 would reach the nock only above the axle.
    const s = solveForward(input({ stringTrack: eccentricCircle({ radius: 0.03, offset: 0.5, phase: -Math.PI / 2 }) }));
    expect(codes(s)).toEqual(['brace']);
    expect(s.diagnostics[0].message).toMatch(/string/);
    // Both tracks are points at the axle: p_s = p_c = 0, so det = 0.
    const point = eccentricCircle({ radius: 0 });
    const singular = solveForward(input({ stringTrack: point, cableTrack: point, samples: 20 }));
    expect(codes(singular)).toEqual(['brace']);
    expect(singular.diagnostics[0].message).toMatch(/singular/);
  });

  it('no-convergence: the iteration limit is too small; later samples are NaN', () => {
    const r = solveForward(input({ samples: 100, maxIterations: 1 }));
    expect(r.status).toBe('no-convergence');
    expect(codes(r)[0]).toBe('no-convergence');
    expect(r.diagnostics[0].xRange).toEqual([r.x[1], r.x[99]]);
    expect(Math.abs(r.F[0])).toBeLessThan(1e-12);
    expect(r.F[1]).toBeNaN();
    expect(r.drawEnergy).toBeNaN();
  });

  it('no-convergence: a lost contact, without throwing', () => {
    // An open cable track whose lever arm grows past the axle distance: the
    // anchor ends up inside the track.
    const knots = [2, 3, 4, 5, 6, 7, 8, 9];
    const grow = splineSupport(knots, [0.02, 0.02, 0.02, 0.02, 0.2, 0.6, 1.2, 2], { endSlopes: [0, 1] });
    const lost = solveForward(input({ cableTrack: grow, samples: 200 }));
    expect(lost.status).toBe('no-convergence');
    expect(codes(lost)).toContain('no-convergence');
  });

  it('accepts a sample at the iteration limit when its residual is below the tolerance', () => {
    // Fine grid, one iteration per sample: the first samples after brace
    // start within 1e-10 m of closure.
    const r = solveForward(input({ maxIterations: 1 }));
    expect(Number.isFinite(r.F[1])).toBe(true);
    expect(r.closure[1]).toBeLessThan(CLOSURE_TOLERANCE);
    expect(r.closure[1]).toBeGreaterThan(0);
  });

  it('slack-string: no preload leaves both cords without tension at brace', () => {
    const r = solveForward(input({ limb: linearLimb({ stiffness: 10e3, preloadTravel: 0, limbLength: geometry.limbLength }), samples: 100 }));
    expect(r.status).toBe('infeasible');
    expect(codes(r)).toEqual(['slack-string', 'slack-cable']);
    for (const d of r.diagnostics) expect(d.xRange).toEqual([geometry.braceHeight, geometry.braceHeight]);
  });

  it('slack-string: reported for the brace tensions when the grid starts after brace', () => {
    const zero = linearLimb({ stiffness: 10e3, preloadTravel: 0, limbLength: geometry.limbLength });
    const xFull = bowFor(twinCam.stringTrack).xFull;
    const x = Array.from({ length: 50 }, (_, i) => geometry.braceHeight + 0.01 + ((xFull - geometry.braceHeight - 0.01) * i) / 49);
    const r = solveForward(input({ limb: zero, x }));
    expect(r.status).toBe('infeasible');
    expect(codes(r)).toContain('slack-string');
    expect(codes(r)).toContain('slack-cable');
    expect(r.diagnostics.find((d) => d.code === 'slack-string')?.xRange).toEqual([geometry.braceHeight, geometry.braceHeight]);
  });

  it('slack-string: a small negative cable lever arm makes the string push', () => {
    const r = solveForward(input({ cableTrack: eccentricCircle({ radius: 0.01, offset: 0.08, phase: 0 }), samples: 100 }));
    expect(r.brace?.pC).toBeLessThan(0);
    expect(r.diagnostics.find((d) => d.code === 'slack-string')?.xRange?.[0]).toBe(geometry.braceHeight);
  });

  // Circle of radius 10 mm centred 120 mm towards +x: p_c ≈ −109 mm, so
  // det = p_s·c_a + s_a·p_c < 0. The path ends at a fold (no convergence
  // further on).
  const farSide = () => solveForward(input({ cableTrack: eccentricCircle({ radius: 0.01, offset: 0.12, phase: 0 }), samples: 100 }));

  it('slack-cable: a cable line far on the other side of the axle would have to push', () => {
    const r = farSide();
    expect(r.brace?.pC).toBeLessThan(-0.1);
    const slack = r.diagnostics.find((d) => d.code === 'slack-cable');
    expect(slack?.xRange?.[0]).toBe(geometry.braceHeight);
    expect(r.Tc[1]).toBeLessThan(0);
  });

  it('cam-reversal: the same cable line turns the cam backwards', () => {
    const r = farSide();
    const reversal = r.diagnostics.find((d) => d.code === 'cam-reversal');
    expect(reversal?.xRange?.[0]).toBe(r.x[1]);
    expect(r.theta[1]).toBeLessThan(0);
  });

  it('wrap-exhausted: a termination or a track range reached during the draw', () => {
    const string = solveForward(input({ samples: 100, stringTermination: 1 }));
    const d = string.diagnostics.find((q) => q.code === 'wrap-exhausted');
    expect(d?.xRange?.[1]).toBe(string.x[99]);
    const first = string.psiS.findIndex((psi) => psi > 1);
    expect(d?.xRange?.[0]).toBe(string.x[first]);

    const cable = solveForward(input({ samples: 50, cableTermination: 4 }));
    expect(cable.diagnostics.find((q) => q.code === 'wrap-exhausted')?.xRange?.[0]).toBe(cable.x[0]);
  });

  it('wrap-exhausted: a default termination beyond the end of an open cable track', () => {
    // Open spline copy of the cable track that ends 5° beyond the smallest
    // brace-side contact: the default termination (30° before it) lies off the track.
    const reference = solveForward(input({ samples: 100 }));
    const track = createSupport(twinCam.cableTrack);
    const lo = Math.min(...reference.psiC) - 5 * DEG;
    const hi = Math.max(...reference.psiC) + 5 * DEG;
    const knots = Array.from({ length: 81 }, (_, i) => lo + ((hi - lo) * i) / 80);
    const open = splineSupport(knots, knots.map((psi) => track.p(psi)), { endSlopes: [track.dp(lo), track.dp(hi)] });
    const r = solveForward(input({ cableTrack: open, samples: 100 }));
    const d = r.diagnostics.find((q) => q.code === 'wrap-exhausted');
    expect(d?.message).toMatch(/termination lies beyond the end of its track/);
    expect(r.status).toBe('infeasible');
  });

  it('wrap-overlap: a string track of 36 mm wraps more than one turn early in the draw', () => {
    const small = {
      stringTrack: offset(eccentricCircle({ radius: 0.036, offset: 0.006, phase: 45 * DEG }), 0.00125),
      cableTrack: offset(eccentricCircle({ radius: 0.018, offset: 0.008, phase: -30 * DEG }), 0.00125),
    };
    const r = solveForward(input({ ...small, samples: 200 }));
    expect(r.status).toBe('infeasible');
    expect(codes(r)).toEqual(['wrap-overlap']);
    const range = /** @type {[number, number]} */ (r.diagnostics[0].xRange);
    expect(range[0]).toBe(geometry.braceHeight);
    // The string wrap ψ_e − ψ_s shrinks as the string pays out; the run ends
    // at the last sample with a full turn.
    const last = r.x.indexOf(range[1]);
    expect(r.stringTermination - r.psiS[0]).toBeGreaterThan(2 * Math.PI + 30 * DEG);
    expect(r.stringTermination - r.psiS[last]).toBeGreaterThanOrEqual(2 * Math.PI);
    expect(r.stringTermination - r.psiS[last + 1]).toBeLessThan(2 * Math.PI);
  });

  it('wrap-overlap: a cable termination almost one turn before the brace contact', () => {
    const base = solveForward(input({ samples: 100 }));
    const r = solveForward(input({ samples: 100, cableTermination: base.psiC[0] - 2 * Math.PI + 0.5 }));
    // The cable wrap ψ_c − ψ_e starts at 2π − 0.5 rad and grows with the draw.
    const d = r.diagnostics.find((q) => q.code === 'wrap-overlap');
    const first = r.psiC.findIndex((psi) => psi - r.cableTermination >= 2 * Math.PI);
    expect(first).toBeGreaterThan(0);
    expect(d?.xRange).toEqual([r.x[first], r.x[99]]);
  });

  it('cable-lever: a limb lever pointing past the vertical makes c_a negative', () => {
    const r = solveForward(input({ geometry: { ...geometry, limbAngleBrace: 120 * DEG }, samples: 50 }));
    expect(codes(r)).toContain('cable-lever');
    expect(r.cA[0]).toBeLessThan(0);
  });
});
