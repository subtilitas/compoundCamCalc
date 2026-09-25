import { describe, expect, it } from 'vitest';
import {
  CABLE_SIDE, STRING_SIDE, cordLength, createContact, solveContact, terminationConstant,
} from '../../src/core/contact.js';
import { createSupport, eccentricCircle, ellipse, offset, splineSupport } from '../../src/core/support.js';
import { derivative, integrate } from './numeric.js';

/** @typedef {import('../../src/core/support.js').SupportData} SupportData */

const periodicKnots = Array.from({ length: 61 }, (_, i) => (2 * Math.PI * i) / 60);
/** @type {[string, SupportData][]} */
const tracks = [
  ['offset ellipse', offset(ellipse({ a: 0.045, b: 0.028, axisAngle: 0.6, offset: 0.007, offsetAngle: 2.1 }), 0.00125)],
  ['eccentric circle', eccentricCircle({ radius: 0.02, offset: 0.009, phase: -0.8 })],
  [
    'periodic spline',
    splineSupport(periodicKnots, periodicKnots.map((x) => 0.03 + 0.006 * Math.cos(x - 1) + 0.0015 * Math.cos(2 * x)), { periodic: true }),
  ],
];

/** Points B in the cam frame, outside every track. */
const points = [
  [0.35, -0.12],
  [-0.05, -0.8],
  [0.02, 0.09],
  [-0.2, 0.3],
];

/**
 * Arc length ∫ρ dψ over [a, b], split at the knots of a spline track.
 * @param {SupportData} data
 * @param {import('../../src/core/support.js').Support} s
 * @param {number} a
 * @param {number} b
 */
function arcLength(data, s, a, b) {
  const cuts = [a, b];
  if (data.kind === 'spline') {
    for (let k = -3; k <= 3; k++) for (const x of data.knots) if (x + 2 * Math.PI * k > a && x + 2 * Math.PI * k < b) cuts.push(x + 2 * Math.PI * k);
  }
  cuts.sort((u, v) => u - v);
  let sum = 0;
  for (let k = 0; k < cuts.length - 1; k++) sum += integrate(s.rho, cuts[k], cuts[k + 1], data.kind === 'spline' ? 1 : 32);
  return sum;
}

describe('cord length identity', () => {
  for (const [name, data] of tracks) {
    const s = createSupport(data);
    for (const sigma of [STRING_SIDE, CABLE_SIDE]) {
      it(`${name}, side ${sigma}: equals free span plus integrated arc length to 1e-12 m`, () => {
        for (const [bx, by] of points) {
          const guess = Math.atan2(by, bx) - sigma * 1.2;
          for (const wrap of [0.4, 2.5, 5]) {
            const c = solveContact(s, bx, by, sigma, guess);
            expect(c.status).toBe('ok');
            const psiEnd = c.psi - sigma * wrap;
            const { length } = cordLength(s, bx, by, sigma, psiEnd, guess);
            const X = s.point(c.psi);
            const span = Math.hypot(bx - X.x, by - X.y);
            const arc = arcLength(data, s, Math.min(c.psi, psiEnd), Math.max(c.psi, psiEnd));
            expect(Math.abs(length - (span + arc))).toBeLessThan(1e-12);
            expect(Math.abs(c.span - span)).toBeLessThan(1e-15);
            expect(Math.abs(c.residual)).toBeLessThan(1e-15);
            // The cord leaves along σ·t towards B.
            expect(c.ux).toBeCloseTo((bx - X.x) / span, 12);
            expect(c.uy).toBeCloseTo((by - X.y) / span, 12);
          }
        }
      });
    }
  }
});

describe('cord length derivatives', () => {
  for (const [name, data] of tracks) {
    const s = createSupport(data);
    for (const sigma of [STRING_SIDE, CABLE_SIDE]) {
      it(`${name}, side ${sigma}: dL/dB = u and dL/dθ = σ·p`, () => {
        for (const [bx, by] of points) {
          const c = solveContact(s, bx, by, sigma, Math.atan2(by, bx) - sigma * 1.2);
          const psiEnd = c.psi - sigma * 2;
          const L = (/** @type {number} */ x, /** @type {number} */ y) => cordLength(s, x, y, sigma, psiEnd, c.psi).length;
          const h = 1e-5;
          expect(Math.abs(derivative((x) => L(x, by), bx, h) - c.ux)).toBeLessThan(1e-9);
          expect(Math.abs(derivative((y) => L(bx, y), by, h) - c.uy)).toBeLessThan(1e-9);
          // Cam rotation by θ: B_cam = R(θ)·B, termination fixed on the cam.
          const Lt = (/** @type {number} */ t) =>
            L(Math.cos(t) * bx - Math.sin(t) * by, Math.sin(t) * bx + Math.cos(t) * by);
          expect(Math.abs(derivative(Lt, 0, h) - sigma * c.p)).toBeLessThan(1e-10);
        }
      });
    }
  }

  it('terminationConstant is −σ·(P + p′) at the termination', () => {
    const s = createSupport(tracks[0][1]);
    expect(terminationConstant(s, CABLE_SIDE, 0.7)).toBeCloseTo(-(s.P(0.7) + s.dp(0.7)), 16);
    expect(terminationConstant(s, STRING_SIDE, 0.7)).toBeCloseTo(s.P(0.7) + s.dp(0.7), 16);
  });
});

describe('solveContact', () => {
  const circle = createSupport(eccentricCircle({ radius: 0.03 }));

  it('matches the tangent from a point to a circle on both branches', () => {
    const d = 0.5;
    const gamma = -1.2;
    const [bx, by] = [d * Math.cos(gamma), d * Math.sin(gamma)];
    const a = Math.acos(0.03 / d);
    expect(solveContact(circle, bx, by, CABLE_SIDE, gamma - 1).psi).toBeCloseTo(gamma - a, 14);
    expect(solveContact(circle, bx, by, STRING_SIDE, gamma + 1).psi).toBeCloseTo(gamma + a, 14);
  });

  it('keeps the unwrapped angle near the warm start', () => {
    const s = createSupport(tracks[0][1]);
    const c = solveContact(s, 0.35, -0.12, STRING_SIDE, 0);
    const turned = solveContact(s, 0.35, -0.12, STRING_SIDE, c.psi + 2 * Math.PI + 0.3);
    expect(turned.psi - c.psi).toBeCloseTo(2 * Math.PI, 12);
    expect(turned.reduced - c.reduced).toBeCloseTo(-s.P(c.psi + 2 * Math.PI) + s.P(c.psi), 12);
  });

  it('falls back to bracketing from a warm start on the wrong branch', () => {
    const s = createSupport(tracks[0][1]);
    const right = solveContact(s, 0.35, -0.12, CABLE_SIDE, -1);
    for (const offsetAngle of [2.5, -2.8, 3.1]) {
      const c = solveContact(s, 0.35, -0.12, CABLE_SIDE, right.psi + offsetAngle);
      expect(c.status).toBe('ok');
      expect(Math.abs(c.psi - right.psi)).toBeLessThan(1e-12);
    }
  });

  it('finds the tangents when B is so close to the track that the scan grid misses them', () => {
    const r = 0.03;
    const d = r + 1e-7;
    const gamma = 0.2;
    const [bx, by] = [d * Math.cos(gamma), d * Math.sin(gamma)];
    const a = Math.acos(r / d);
    const h = (2 * Math.PI) / 96;
    for (const sigma of [CABLE_SIDE, STRING_SIDE]) {
      const c = solveContact(circle, bx, by, sigma, gamma + Math.PI + h / 2);
      expect(c.status).toBe('ok');
      // The scan window [ψ0 − π, ψ0 + π] holds the tangents near γ + 2π.
      expect(c.psi).toBeCloseTo(gamma + 2 * Math.PI - sigma * a, 9);
    }
  });

  it('finds a narrow tangent pair in the grid cell just outside the scan window', () => {
    // B just outside a circle, in a direction that lies 0.3 grid steps inside
    // the end of the scan window [ψ0 − π, ψ0 + π]: the largest f sits in the
    // cell beyond the window end.
    const r = 0.02;
    const small = createSupport(eccentricCircle({ radius: r }));
    const h = (2 * Math.PI) / 96;
    const d = r + 1e-6;
    const a = Math.acos(r / d);
    for (const psi0 of [0, 1.3]) {
      const gamma = psi0 + Math.PI - 0.3 * h;
      const [bx, by] = [d * Math.cos(gamma), d * Math.sin(gamma)];
      for (const sigma of [CABLE_SIDE, STRING_SIDE]) {
        const c = solveContact(small, bx, by, sigma, psi0);
        expect(c.status).toBe('ok');
        // Tangent angle γ − σ·a, up to whole turns.
        const turns = (c.psi - (gamma - sigma * a)) / (2 * Math.PI);
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
      }
    }
  });

  it('returns for warm starts far from zero', () => {
    const small = createSupport(eccentricCircle({ radius: 0.02 }));
    for (const psi0 of [8192, 2e4, -1e6]) {
      // B inside: the golden-section search ends although one ulp of ψ exceeds 1e-12 rad.
      expect(solveContact(small, 0.001, 0, STRING_SIDE, psi0).status).toBe('inside');
      const c = solveContact(small, 0.3, -0.2, CABLE_SIDE, psi0);
      expect(c.status).toBe('ok');
      expect(Math.abs(c.psi - psi0)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('reports B inside or on the track and non-finite input', () => {
    expect(solveContact(circle, 0.001, 0.002, CABLE_SIDE, 0).status).toBe('inside');
    expect(solveContact(circle, 0.03, 0, STRING_SIDE, 0).status).toBe('inside');
    expect(solveContact(circle, NaN, 0.5, CABLE_SIDE, 0).status).toBe('no-convergence');
    expect(solveContact(circle, 0.5, 0.5, CABLE_SIDE, NaN).status).toBe('no-convergence');
    const nan = createSupport(eccentricCircle({ radius: NaN }));
    expect(solveContact(nan, 0.5, 0.5, CABLE_SIDE, 0).status).toBe('no-convergence');
    const { length, contact } = cordLength(circle, 0.001, 0, CABLE_SIDE, 0, 0);
    expect(Number.isNaN(length)).toBe(true);
    expect(contact.status).toBe('inside');
  });

  it('flags contacts outside the defined range of an open track', () => {
    const s = createSupport(splineSupport([0, 1, 2], [0.03, 0.031, 0.03]));
    const inside = solveContact(s, 0.7 * Math.cos(2.5), 0.7 * Math.sin(2.5), CABLE_SIDE, 1);
    expect(inside.inRange).toBe(true);
    const outside = solveContact(s, 0.5, -0.5, CABLE_SIDE, -2);
    expect(outside.status).toBe('ok');
    expect(outside.inRange).toBe(false);
  });

  it('reuses the output object and reports the wrap', () => {
    const out = createContact();
    expect(solveContact(circle, 0, -0.8, CABLE_SIDE, Math.PI, out)).toBe(out);
    expect(out.iterations).toBeGreaterThan(0);
    const { wrap } = cordLength(circle, 0, -0.8, CABLE_SIDE, 2, Math.PI);
    expect(wrap).toBeCloseTo(out.psi - 2, 14);
  });
});
