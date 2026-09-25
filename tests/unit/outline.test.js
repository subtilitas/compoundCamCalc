import { describe, expect, it } from 'vitest';
import {
  LEAD_IN_DECAY, cableStopPost, closeCableTrack, createPiecewise, hermiteQuintic, maxDimension, minimumOn, sampleOutline,
  terminationPost, trackMark, trackOffsets,
} from '../../src/core/outline.js';
import { createSupport, eccentricCircle, splineSupport } from '../../src/core/support.js';

const DEG = Math.PI / 180;

/**
 * Open spline piece that samples a support on [a, b].
 * @param {import('../../src/core/support.js').Support} s
 * @param {number} a
 * @param {number} b
 */
function splinePiece(s, a, b) {
  const count = Math.ceil((b - a) / (0.25 * DEG));
  const knots = Array.from({ length: count + 1 }, (_, k) => a + ((b - a) * k) / count);
  const data = splineSupport(knots, knots.map((psi) => s.p(psi)), { endSlopes: [s.dp(a), s.dp(b)] });
  return { kind: /** @type {const} */ ('spline'), start: a, end: b, data };
}

describe('track pieces', () => {
  it('evaluates consecutive pieces and continues the end pieces outside', () => {
    const a = hermiteQuintic(0, 1, [0.02, 0.001, 0], [0.025, 0, -0.002]);
    const b = hermiteQuintic(1, 2, [0.025, 0, -0.002], [0.02, -0.001, 0.001]);
    const track = createPiecewise([a, b]);
    const out = new Float64Array(3);
    expect(Array.from(track.evaluate(0, out))).toEqual([0.02, 0.001, 0].map((v, i) => (i === 0 ? v : out[i])));
    expect(track.evaluate(0, out)[1]).toBeCloseTo(0.001, 15);
    track.evaluate(1, out);
    expect(out[0]).toBeCloseTo(0.025, 15);
    expect(out[2]).toBeCloseTo(-0.002, 14);
    track.evaluate(3, out);
    expect(out[0]).toBeCloseTo(0.02, 15);
    expect(out[1]).toBeCloseTo(-0.001, 14);
    expect(out[2]).toBeCloseTo(0.001, 13);
    expect(track.rho(3)).toBeCloseTo(0.021, 13);
    expect([track.start, track.end]).toEqual([0, 3]);
  });

  it('finds the minimum of a function on an interval', () => {
    const m = minimumOn((x) => (x - 0.3) ** 2 + 1, 0, 2, 50);
    expect(m.at).toBeCloseTo(0.3, 6);
    expect(m.value).toBeCloseTo(1, 12);
    expect(minimumOn((x) => x, 0, 1, 10).at).toBe(0);
    expect(minimumOn(() => NaN, 0, 1, 10).value).toBeNaN();
  });
});

describe('closed cable track', () => {
  const circle = createSupport(eccentricCircle({ radius: 0.022, offset: 0.007, phase: 2 }));
  const psi0 = 3.4;
  const psiF = psi0 + 230 * DEG;
  const active = createPiecewise([splinePiece(circle, psi0, psiF)]);
  const closed = /** @type {import('../../src/core/outline.js').ClosedCable} */ (
    closeCableTrack(active, { leadIn: 30 * DEG, rhoMin: 0.005, step: 0.25 * DEG })
  );
  const s = createSupport(closed.support);

  it('continues the active track with a lead-in of constant ρ when ρ(ψ_c0) lies within [ρ_min, p(ψ_c0)]', () => {
    expect(closed.ok).toBe(true);
    expect(closed.psiStart).toBeCloseTo(psi0 - 30 * DEG, 15);
    // The end second derivative of the sampled spline is accurate to O(h²).
    expect(closed.leadInRho).toBeCloseTo(0.022, 8);
    // An eccentric circle has constant ρ, so the lead-in is the circle itself.
    for (let psi = closed.psiStart; psi <= psi0; psi += 2 * DEG) expect(Math.abs(s.p(psi) - circle.p(psi))).toBeLessThan(1e-8);
    for (let psi = psi0; psi <= psiF; psi += 2 * DEG) expect(Math.abs(s.p(psi) - circle.p(psi))).toBeLessThan(1e-9);
  });

  it('closes into a periodic C2 track with ρ above the limit on the closing blend', () => {
    const period = 2 * Math.PI;
    for (const f of [s.p, s.dp, s.d2p]) expect(f(closed.psiStart + period)).toBeCloseTo(f(closed.psiStart), 12);
    expect(closed.blendLength).toBeCloseTo(period - 260 * DEG, 12);
    expect(closed.blendMinRho).toBeGreaterThanOrEqual(0.005);
    const low = minimumOn((psi) => s.rho(psi), psiF, psiF + closed.blendLength, 400);
    expect(low.value).toBeGreaterThan(0.005 - 1e-6);
    // Continuity of the pieces at both joins of the blend.
    const out = new Float64Array(3);
    for (const join of [psiF, closed.psiStart + period]) {
      closed.track.evaluate(join - 1e-9, out);
      const left = Float64Array.from(out);
      closed.track.evaluate(join + 1e-9, out);
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - left[i])).toBeLessThan(1e-9);
    }
  });

  it('samples closed outlines whose last point is the first', () => {
    const o = sampleOutline(s, closed.psiStart, 720);
    expect(o.x.length).toBe(721);
    expect(o.x[720]).toBe(o.x[0]);
    expect(o.y[720]).toBe(o.y[0]);
    const X = s.point(closed.psiStart + (2 * Math.PI * 100) / 720);
    expect(o.x[100]).toBeCloseTo(X.x, 15);
    expect(o.y[100]).toBeCloseTo(X.y, 15);
  });

  it('lets the lead-in settle to ρ_0 = clamp(ρ(ψ_c0), ρ_min, p(ψ_c0)) with p, p\' and p\'\' continuous', () => {
    const lambda = LEAD_IN_DECAY;
    // p(ψ_c0) = 30 mm with ρ(ψ_c0) = 330 mm (clamped to 30 mm) and 2 mm
    // (clamped to ρ_min = 5 mm).
    for (const [second, rho0] of [[0.3, 0.03], [-0.028, 0.005]]) {
      const rhoBrace = 0.03 + second;
      const excess = rhoBrace - rho0;
      const track = createPiecewise([hermiteQuintic(psi0, 200 * DEG, [0.03, 0, second], [0.03, 0, 0])]);
      const r = /** @type {import('../../src/core/outline.js').ClosedCable} */ (
        closeCableTrack(track, { leadIn: 30 * DEG, rhoMin: 0.005, step: 0.5 * DEG })
      );
      expect(r.leadInRho).toBeCloseTo(rho0, 15);
      const out = new Float64Array(3);
      let previous = rhoBrace;
      for (let u = 0; u <= 30 * DEG + 1e-12; u += 0.1 * DEG) {
        // ρ(u) = ρ_0 + (ρ(ψ_c0) − ρ_0)·(1 + u/λ)·e^(−u/λ), monotone between both values.
        const rho = r.track.rho(psi0 - u);
        expect(rho).toBeCloseTo(rho0 + excess * (1 + u / lambda) * Math.exp(-u / lambda), 12);
        expect((previous - rho) * Math.sign(excess)).toBeGreaterThanOrEqual(-1e-15);
        previous = rho;
        // No outward swing: p stays within 2λ·|ρ(ψ_c0) − ρ_0| of the arc of radius ρ_0.
        r.track.evaluate(psi0 - u, out);
        expect(Math.abs(out[0] - 0.03)).toBeLessThanOrEqual(2 * lambda * Math.abs(excess) + (0.03 - rho0) * (1 - Math.cos(u)) + 1e-15);
      }
      // p' and p'' of the lead-in against central differences.
      for (const u of [0.3 * DEG, 2 * DEG, 20 * DEG]) {
        const d = 1e-5;
        const f = (/** @type {number} */ psi) => r.track.evaluate(psi, new Float64Array(3))[0];
        r.track.evaluate(psi0 - u, out);
        expect(Math.abs((f(psi0 - u + d) - f(psi0 - u - d)) / (2 * d) - out[1])).toBeLessThan(1e-9);
        expect(Math.abs((f(psi0 - u + d) - 2 * f(psi0 - u) + f(psi0 - u - d)) / (d * d) - out[2])).toBeLessThan(1e-4);
      }
      // p, p', p'' continuous at the join with the active track.
      const left = Float64Array.from(r.track.evaluate(psi0 - 1e-9, out));
      track.evaluate(psi0, out);
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - left[i])).toBeLessThan(1e-9);
      // The closed spline smooths the kink of ρ at the join by less than 5 %
      // of the change in ρ; a lead-in that starts at ρ_0 (p'' jumps at the
      // join) makes the spline dip about 13 % below ρ_0.
      const s2 = createSupport(r.support);
      const low = minimumOn((psi) => s2.rho(psi), r.psiStart, psi0, 1200);
      expect(low.value).toBeGreaterThan(Math.min(rho0, rhoBrace) - 0.05 * Math.abs(excess));
    }
  });

  it('closes the track with no lead-in or one far below the knot spacing', () => {
    const step = 0.25 * DEG;
    for (const leadIn of [0, 1.5e-179, 1e-15, 1e-9]) {
      const r = /** @type {import('../../src/core/outline.js').ClosedCable} */ (closeCableTrack(active, { leadIn, rhoMin: 0.005, step }));
      expect(r.ok).toBe(true);
      expect(r.psiStart).toBe(psi0 - leadIn);
      const { knots } = r.support;
      expect(knots[0]).toBe(r.psiStart);
      expect(knots[knots.length - 1]).toBe(r.psiStart + 2 * Math.PI);
      for (let k = 1; k < knots.length; k++) expect(knots[k] - knots[k - 1]).toBeGreaterThanOrEqual(1e-3 * step);
      const t = createSupport(r.support);
      // No spike of p'' where the lead-in meets the active track.
      expect(minimumOn((psi) => t.rho(psi), r.psiStart, r.psiStart + 2 * Math.PI, 2880).value).toBeGreaterThan(0.005 - 1e-6);
      for (let psi = psi0; psi <= psiF; psi += 2 * DEG) expect(Math.abs(t.p(psi) - circle.p(psi))).toBeLessThan(1e-9);
    }
  });

  it('reports an arc too short to close and a blend that bends too sharply', () => {
    expect(closeCableTrack(active, { leadIn: 130 * DEG, rhoMin: 0.005, step: DEG })).toBeNull();
    // A lever arm that falls to 5 mm at full draw with a steep slope cannot
    // turn back to 30 mm within 60°.
    const steep = createPiecewise([hermiteQuintic(psi0, 270 * DEG, [0.03, 0, 0], [0.005, -0.03, 0])]);
    const r = /** @type {import('../../src/core/outline.js').ClosedCable} */ (closeCableTrack(steep, { leadIn: 30 * DEG, rhoMin: 0.005, step: DEG }));
    expect(r.ok).toBe(false);
    expect(r.blendMinRho).toBeLessThan(0.005);
  });
});

describe('offsets, dimensions, posts and marks', () => {
  const pitch = eccentricCircle({ radius: 0.046, offset: 0.01, phase: 0.5 });
  const s = createSupport(pitch);

  it('offsets the pitch line to the groove bottom and the flange edge', () => {
    const { groove, flange } = trackOffsets(pitch, 0.0025, 0.003);
    const g = createSupport(groove);
    const f = createSupport(flange);
    for (let psi = 0; psi < 2 * Math.PI; psi += 0.3) {
      expect(g.p(psi)).toBeCloseTo(s.p(psi) - 0.00125, 15);
      expect(f.p(psi)).toBeCloseTo(s.p(psi) + 0.00175, 15);
    }
  });

  it('measures the largest width of the union of convex outlines', () => {
    expect(maxDimension([s])).toBeCloseTo(0.092, 9);
    // Two circles of radius 10 mm centred at (±30 mm, 0): width 80 mm.
    const a = createSupport(eccentricCircle({ radius: 0.01, offset: 0.03, phase: 0 }));
    const b = createSupport(eccentricCircle({ radius: 0.01, offset: 0.03, phase: Math.PI }));
    expect(maxDimension([a, b])).toBeCloseTo(0.08, 9);
  });

  it('places a termination post tangent to the pitch line on the inside', () => {
    const post = terminationPost(s, 1.2, 0.0025, 0.0025, 'string-post');
    const X = s.point(1.2);
    const d = Math.hypot(post.x - X.x, post.y - X.y);
    expect(d).toBeCloseTo(0.00375, 15);
    // The centre lies on the inner normal: the tangent line at 1.2 is r + d/2 away.
    expect(s.p(1.2) - (post.x * Math.cos(1.2) + post.y * Math.sin(1.2))).toBeCloseTo(0.00375, 15);
    expect(post).toMatchObject({ id: 'string-post', radius: 0.0025, psi: 1.2 });
  });

  it('places the cable stop post against the full-draw cable line, clear of the groove', () => {
    const cable = createSupport(eccentricCircle({ radius: 0.02, offset: 0.006, phase: 1 }));
    const psi = 5.5;
    const post = cableStopPost(cable, psi, 0.0025, 0.0025);
    const n = { x: Math.cos(psi), y: Math.sin(psi) };
    // Distance from the cable line X·n = p, on the axle side.
    expect(cable.p(psi) - (post.x * n.x + post.y * n.y)).toBeCloseTo(0.00375, 12);
    expect(post.span).toBeGreaterThan(0);
    // Clearance from the groove bottom: distance of the centre from the circle of radius r − d/2.
    const centre = { x: 0.006 * Math.cos(1), y: 0.006 * Math.sin(1) };
    const clearance = Math.hypot(post.x - centre.x, post.y - centre.y) - (0.02 - 0.00125);
    expect(clearance).toBeGreaterThan(0.0025 - 1e-9);
    expect(clearance).toBeLessThan(0.0025 + 1e-6);
    // A peg far outside the track needs no shift along the span.
    const far = cableStopPost(createSupport(eccentricCircle({ radius: 0.001 })), 0, 0.02, 0.0025);
    expect(far.span).toBe(0);
  });

  it('puts timing marks on the pitch line with the outward normal', () => {
    const m = trackMark(s, 2, 'full-draw');
    const X = s.point(2);
    expect(m).toEqual({ id: 'full-draw', psi: 2, x: X.x, y: X.y, nx: Math.cos(2), ny: Math.sin(2) });
  });
});
