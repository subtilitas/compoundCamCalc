import { describe, expect, it } from 'vitest';
import { CLOSURE_TOLERANCE, DEFAULT_WRAP, FULL_SAMPLES, drawGrid, solveForward } from '../../src/core/forward.js';
import { axle, bowGeometry, cableLength, stringHalfLength } from '../../src/core/geometry.js';
import { createLimb, linearLimb, tableLimb } from '../../src/core/limb.js';
import { createSupport, eccentricCircle, ellipse, offset, splineSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { derivative, solveDense } from './numeric.js';

/** @typedef {import('../../src/core/forward.js').ForwardInput} ForwardInput */
/** @typedef {import('../../src/core/forward.js').ForwardResult} ForwardResult */
/** @typedef {import('../../src/core/geometry.js').BowGeometry} BowGeometry */
/** @typedef {import('../../src/core/support.js').SupportData} SupportData */

const DEG = Math.PI / 180;
const geometry = defaultState().geometry;
const limbData = linearLimb({ stiffness: 10e3, preloadTravel: 0.03, limbLength: geometry.limbLength });
const limb = createLimb(limbData);

/**
 * Realistic twin cam used by several tests. Groove bottoms: string track an
 * eccentric circle of radius 36 mm, offset 6 mm, phase 45°; cable track an
 * eccentric circle of radius 18 mm, offset 8 mm, phase −30°; both cords
 * 2.5 mm, so the pitch lines are 1.25 mm further out. With the default
 * geometry (ATA 33 in, brace height 6.5 in, draw length 29 in) the cam turns
 * about 313° and the axle moves about 59 mm, so the default limb of
 * 27 N/mm would peak near 820 N; 10 N/mm with 30 mm preload gives a peak of
 * about 305 N at 24.6 in and a let-off of about 40 %. The phases put the
 * largest string lever arm (phase 45°) and the smallest cable lever arm
 * (phase −30° + 180° = 150°) near the contact angles at full draw, which
 * produces the let-off. The cable lever arm stays below 0.9 times the string
 * lever arm, so the force rises slowly and peaks late in the draw.
 */
const twinCam = {
  stringTrack: offset(eccentricCircle({ radius: 0.036, offset: 0.006, phase: 45 * DEG }), 0.00125),
  cableTrack: offset(eccentricCircle({ radius: 0.018, offset: 0.008, phase: -30 * DEG }), 0.00125),
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
  const rs = 0.04;
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

  it('has T_c/T_s = r_s/r_c exactly', () => {
    for (let i = 0; i < r.n; i++) expect(Math.abs((r.Tc[i] / r.Ts[i]) * (rc / rs) - 1)).toBeLessThan(1e-14);
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
        stringTrack: offset(ellipse({ a: 0.042, b: 0.034, axisAngle: 20 * DEG, offset: 0.004, offsetAngle: 60 * DEG }), 0.00125),
        cableTrack: twinCam.cableTrack,
      },
    ],
  ];
  for (const [name, cam] of /** @type {[string, { stringTrack: SupportData, cableTrack: SupportData }][]} */ (cams)) {
    const r = solveForward(input(cam));
    const bow = bowFor(cam.stringTrack);
    const s = createSupport(cam.stringTrack);
    const c = createSupport(cam.cableTrack);

    it(`${name}: 2·T_s·sin φ from the moment balances equals the virtual-work force to 1e-9`, () => {
      expect(r.status).toBe('ok');
      for (let i = 1; i < r.n; i += 37) {
        const { x } = r;
        const theta = r.theta[i];
        const alpha = r.alpha[i];
        // Contacts recomputed from the solved pose; unit vectors in the world frame.
        const cs = stringHalfLength(bow, s, x[i], theta, alpha, 0, r.psiS[i]).contact;
        const cc = cableLength(bow, c, theta, alpha, 0, r.psiC[i]).contact;
        const rot = (/** @type {number} */ ux, /** @type {number} */ uy) => [
          Math.cos(theta) * ux + Math.sin(theta) * uy,
          -Math.sin(theta) * ux + Math.cos(theta) * uy,
        ];
        const us = rot(cs.ux, cs.uy);
        const uc = rot(cc.ux, cc.uy);
        const o = axle(bow, alpha);
        const sa = us[0] * o.dx + us[1] * o.dy;
        const ca = uc[0] * 0 + uc[1] * 2 * o.dy;
        // Cam: T_s·p_s − T_c·p_c = 0. Limb: T_s·s_a + T_c·c_a = E1'(α).
        const [Ts, Tc] = solveDense([[cs.p, -cc.p], [sa, ca]], [0, limb.moment(alpha)]);
        const Fstatics = 2 * Ts * us[0];
        expect(Math.abs(Fstatics / r.F[i] - 1)).toBeLessThan(1e-9);
        expect(Math.abs(Ts / r.Ts[i] - 1)).toBeLessThan(1e-9);
        expect(Math.abs(Tc / r.Tc[i] - 1)).toBeLessThan(1e-9);
        expect(Math.abs(r.balance[i])).toBeLessThan(1e-9);
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
        expect(Math.abs(Fvw / fr.F[k + 2] - 1)).toBeLessThan(1e-8);
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

  it('starts at θ = 0, α = 0, F = 0 with the brace equilibrium tensions', () => {
    const b = /** @type {import('../../src/core/forward.js').BraceState} */ (r.brace);
    expect([r.theta[0], r.alpha[0], r.x[0]]).toEqual([0, 0, geometry.braceHeight]);
    // sin φ at brace is zero up to the rounding of the contact angle.
    expect(Math.abs(r.F[0])).toBeLessThan(1e-12);
    expect(b.psiS).toBeCloseTo(0, 15);
    expect(b.stringTension * b.pS - b.cableTension * b.pC).toBeCloseTo(0, 12);
    expect(b.stringTension * b.sA + b.cableTension * b.cA).toBeCloseTo(b.moment, 11);
    expect(r.Ts[0]).toBe(b.stringTension);
    expect(b.slope).toBeCloseTo((2 * b.stringTension) / b.span, 12);
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
    expect(r.diagnostics.map((d) => d.code)).toEqual(['slack-string']);
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
    expect(r.theta[r.n - 1]).toBeLessThan(2 * Math.PI);
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
    const cases = [
      /** @type {any} */ (undefined),
      input({ geometry: { ...geometry, ata: NaN } }),
      input({ cableTrack: /** @type {any} */ ({ kind: 'square' }) }),
      input({ x: [geometry.braceHeight - 0.01, 0.3] }),
      input({ x: [0.3, 0.2] }),
      input({ x: [] }),
      input({ samples: 1 }),
      input({ limb: { kind: 'linear', torsionalStiffness: NaN, alpha0: 0.1 } }),
    ];
    for (const c of cases) {
      const r = solveForward(c);
      expect(r.status).toBe('infeasible');
      expect(codes(r)).toEqual(['invalid-input']);
      expect(r.diagnostics[0].xRange).toBeNull();
      expect(r.n).toBe(0);
    }
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

  it('slack-string: a small negative cable lever arm makes the string push', () => {
    const r = solveForward(input({ cableTrack: eccentricCircle({ radius: 0.01, offset: 0.08, phase: 0 }), samples: 100 }));
    expect(r.brace?.pC).toBeLessThan(0);
    expect(r.diagnostics.find((d) => d.code === 'slack-string')?.xRange?.[0]).toBe(geometry.braceHeight);
  });

  // Circle of radius 10 mm centred 100 mm towards +x: p_c ≈ −89 mm, so
  // det = p_s·c_a + s_a·p_c < 0. The path ends at a fold (no convergence
  // further on).
  const farSide = () => solveForward(input({ cableTrack: eccentricCircle({ radius: 0.01, offset: 0.1, phase: 0 }), samples: 100 }));

  it('slack-cable: a cable line far on the other side of the axle would have to push', () => {
    const r = farSide();
    expect(r.brace?.pC).toBeLessThan(-0.08);
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

  it('cable-lever: a limb lever pointing past the vertical makes c_a negative', () => {
    const r = solveForward(input({ geometry: { ...geometry, limbAngleBrace: 120 * DEG }, samples: 50 }));
    expect(codes(r)).toContain('cable-lever');
    expect(r.cA[0]).toBeLessThan(0);
  });
});
