import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { drawRange, generateCurve, pointMetrics } from '../../src/core/curve.js';
import { CODES, formatter } from '../../src/core/diagnostics.js';
import { axle, bowGeometry } from '../../src/core/geometry.js';
import { COARSE_SAMPLES, FULL_SAMPLES, drawGrid, solveForward } from '../../src/core/forward.js';
import { limbFromState } from '../../src/core/limb.js';
import { FIT_FORCE_FLOOR, FIT_FORCE_TOLERANCE, GROOVE_MARGIN, forwardDiagnostics, solve } from '../../src/core/solve.js';
import { fitCableTrack } from '../../src/core/fit.js';
import { createCurve } from '../../src/core/interp.js';
import { braceConditions, createInverse, sampleInverse } from '../../src/core/inverse.js';
import { closeCableTrack, createPiecewise } from '../../src/core/outline.js';
import { createSupport, stringTrackSupport } from '../../src/core/support.js';
import { AMO_OFFSET, INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import { FIELDS, validate } from '../../src/state/schema.js';

/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */

const DEG = Math.PI / 180;

/**
 * Default state with a change applied to a deep copy; the parametric curve
 * is regenerated from its parameters.
 * @param {(s: ProjectState) => void} change
 * @param {{ regenerate?: boolean }} [options]
 */
function modified(change, options = {}) {
  const s = structuredClone(defaultState());
  change(s);
  if (options.regenerate) s.curve.points = generateCurve({ ...drawRange(s.geometry.braceHeight, s.geometry.drawLength), ...s.curve.params });
  return s;
}

/** @param {SolveResult} r */
const codes = (r) => r.diagnostics.map((d) => d.code);

/**
 * Point of the cam frame (cam turned by θ about the axle O) in the world frame.
 * @param {{ x: number, y: number }} O
 * @param {number} theta
 * @param {{ x: number, y: number }} P
 */
function camToWorld(O, theta, P) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: O.x + c * P.x + s * P.y, y: O.y - s * P.x + c * P.y };
}

describe('solve: default preset', () => {
  const state = defaultState();
  const r = solve(state);

  it('solves with zero diagnostics and a buildable cam', () => {
    expect(validate(state)).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.status).toBe('ok');
    const m = /** @type {import('../../src/core/solve.js').SolveMetrics} */ (r.metrics);
    const target = pointMetrics(state.curve.points);
    console.info(
      `default preset: peak ${m.peak.toFixed(1)} N, holding ${m.holding.toFixed(1)} N, let-off ${(m.letOff * 100).toFixed(1)} %, ` +
        `draw energy ${m.drawEnergy.toFixed(1)} J, limb energy ${m.limbEnergy.toFixed(1)} J, axle travel ${(m.axleTravel * 1e3).toFixed(1)} mm, ` +
        `cam rotation ${(m.rotation / DEG).toFixed(1)}°, limb rotation ${(m.limbRotation / DEG).toFixed(1)}°, ` +
        `cam ${(m.camMaxDimension * 1e3).toFixed(1)} mm, min ρ ${(m.minRho * 1e3).toFixed(2)} mm, ` +
        `string wrap ${(m.stringWrap / DEG).toFixed(0)}°, cable wrap ${(m.cableWrap / DEG).toFixed(0)}°, ` +
        `string ${(m.stringLength / INCH).toFixed(2)} in, cable ${(m.cableLength / INCH).toFixed(2)} in, fit ${r.fit.used} (${r.fit.maxForceDifference.toFixed(2)} N)`,
    );
    expect(Math.abs(m.peak / target.peak - 1)).toBeLessThan(FIT_FORCE_TOLERANCE);
    expect(Math.abs(m.letOff - target.letOff)).toBeLessThan(0.01);
    expect(m.drawEnergy).toBeGreaterThan(90);
    expect(m.drawEnergy).toBeLessThan(130);
    expect(m.limbEnergy).toBeGreaterThan(m.drawEnergy);
    expect(m.camMaxDimension).toBeLessThan(0.11);
    expect(m.minRho).toBeGreaterThanOrEqual(m.rhoLimit - 1e-6);
    expect(m.rhoLimit).toBe(Math.max(state.body.minBendRadius, state.cords.cableDiameter / 2 + GROOVE_MARGIN));
    expect(m.stringWrap).toBeLessThan(2 * Math.PI);
    expect(m.cableWrap).toBeLessThan(2 * Math.PI);
    expect(m.limbRotation).toBeLessThan(state.limb.maxRotation);
    expect(m.rotation).toBeGreaterThan(Math.PI);
    expect(m.axleTravel).toBeGreaterThan(0.02);
    expect(r.achieved?.x.length).toBe(FULL_SAMPLES);
  });

  it('follows the target within the tolerance, with the brace slope of the target', () => {
    const tolerance = Math.max(FIT_FORCE_TOLERANCE * pointMetrics(state.curve.points).peak, FIT_FORCE_FLOOR);
    const a = /** @type {NonNullable<SolveResult['achieved']>} */ (r.achieved);
    const t = /** @type {NonNullable<SolveResult['target']>} */ (r.target);
    let worst = 0;
    for (let i = 0; i < a.x.length; i++) worst = Math.max(worst, Math.abs(a.F[i] - t.F[i]));
    console.info(`default preset: achieved force within ${worst.toFixed(2)} N of the target (tolerance ${tolerance.toFixed(2)} N)`);
    expect(worst).toBeLessThanOrEqual(tolerance);
    expect(worst).toBeCloseTo(r.fit.maxForceDifference, 12);
    expect(r.fit.withinTolerance).toBe(true);
    expect(r.fit.idealIssues.length).toBeGreaterThan(0);
    for (const m of r.fit.idealIssues) expect(m).toMatch(/by up to 3\.\d N, within the 4\.0 N tolerance \(peak \+/);
    expect(Math.abs(r.fit.energyDifference)).toBeLessThan(0.005 * pointMetrics(state.curve.points).energy);
    // Both fit candidates keep the brace lever arm, so the brace slope is the target's.
    const limb = /** @type {import('../../src/core/limb.js').LimbData} */ (limbFromState(state.limb, state.geometry.limbLength).limb);
    const f = solveForward({ geometry: state.geometry, stringTrack: /** @type {any} */ (r.tracks.stringPitch), cableTrack: /** @type {any} */ (r.tracks.cablePitch), limb, samples: 50 });
    expect(Math.abs(/** @type {any} */ (f.brace).slope / /** @type {any} */ (r.brace).slope - 1)).toBeLessThan(1e-9);
  });

  it('reaches the target state at the curve points a fitted track passes through', () => {
    // The fit candidate through the curve points, built from the pieces of
    // the solver: the cam then gives the target force at those points.
    const limb = /** @type {import('../../src/core/limb.js').LimbData} */ (limbFromState(state.limb, state.geometry.limbLength).limb);
    const stringTrack = stringTrackSupport(state.stringTrack, state.cords.stringDiameter);
    const ctx = /** @type {import('../../src/core/inverse.js').InverseContext} */ (createInverse({ geometry: state.geometry, stringTrack, limb }).context);
    const pts = state.curve.points;
    const natural = createCurve(pts);
    const slope = natural.derivative(pts[0].x);
    const brace = braceConditions(ctx, slope);
    const curve = createCurve(pts, { startSlope: slope, startSecondDerivative: brace.second });
    const target = { force: (/** @type {number} */ x) => curve.evaluate(x), work: (/** @type {number} */ x) => curve.integral(pts[0].x, x), slope };
    const grid = [...new Set([...drawGrid(pts[0].x, pts[pts.length - 1].x, 300), ...pts.map((q) => q.x)])].sort((u, v) => u - v);
    const s = sampleInverse(ctx, brace, target, grid);
    const n = s.n;
    const D0 = 2 * ctx.bow.braceAxleY;
    const pMin = state.body.boreDiameter / 2 + state.body.minWall + state.cords.cableDiameter / 2;
    // From point 3 on: the ramp point lies in the brace region (see the
    // solver); points whose lever arm is below the clearance are left out.
    const matched = pts.slice(2, -1).filter((q) => s.pC[grid.indexOf(q.x)] >= pMin);
    expect(matched.length).toBe(3);
    const through = matched.map((q) => {
      const i = grid.indexOf(q.x);
      return { psi: s.psiC[i], p: s.pC[i], integral: Math.sqrt(D0 * D0 - s.pC[0] ** 2) - Math.sqrt((2 * s.axleY[i]) ** 2 - s.pC[i] ** 2) };
    });
    const psi = Float64Array.from(grid.slice(grid.indexOf(pts[1].x)), (_, k) => s.psiC[grid.indexOf(pts[1].x) + k]);
    const p = Float64Array.from(psi, (_, k) => s.pC[grid.indexOf(pts[1].x) + k]);
    const fit = fitCableTrack({ psi, p, start: s.psiC[0], end: s.psiC[n - 1], rhoMin: state.body.minBendRadius, pMin, startValue: s.pC[0], through });
    expect(fit.status).toBe('optimal');
    const active = createPiecewise([{ kind: 'spline', start: s.psiC[0], end: s.psiC[n - 1], data: /** @type {any} */ (fit.spline) }]);
    const closed = /** @type {import('../../src/core/outline.js').ClosedCable} */ (
      closeCableTrack(active, { leadIn: state.body.leadInWrap, rhoMin: state.body.minBendRadius, pMin, step: 0.25 * DEG })
    );
    const f = solveForward({ geometry: state.geometry, stringTrack, cableTrack: closed.support, limb, x: grid });
    let worst = 0;
    for (const q of matched) worst = Math.max(worst, Math.abs(f.F[grid.indexOf(q.x)] - q.F));
    console.info(`fit through the curve points: force at the points within ${worst.toExponential(2)} N`);
    expect(worst).toBeLessThan(1e-3);
  });

  it('returns closed, nested outlines and plain data', () => {
    for (const name of ['stringPitch', 'stringGroove', 'stringFlange', 'cablePitch', 'cableGroove', 'cableFlange']) {
      const o = r.outlines[name];
      expect(o.x.length).toBe(721);
      expect(o.x[720]).toBe(o.x[0]);
      expect(o.y[720]).toBe(o.y[0]);
    }
    const wall = state.body.boreDiameter / 2 + state.body.minWall;
    for (const track of ['string', 'cable']) {
      const pitch = createSupport(/** @type {any} */ (r.tracks)[`${track}Pitch`]);
      const groove = createSupport(/** @type {any} */ (r.tracks.grooves[/** @type {'string' | 'cable'} */ (track)]));
      const flange = createSupport(/** @type {any} */ (r.tracks.flanges[/** @type {'string' | 'cable'} */ (track)]));
      for (let k = 0; k < 720; k++) {
        const psi = (2 * Math.PI * k) / 720;
        // Flange outside groove bottom outside the bore and its wall.
        expect(flange.p(psi)).toBeGreaterThan(groove.p(psi));
        expect(groove.p(psi)).toBeLessThan(pitch.p(psi));
        expect(groove.distance(psi)).toBeGreaterThanOrEqual(wall - 1e-6);
      }
    }
    const copy = structuredClone(r);
    expect(copy.outlines.cablePitch.x).toEqual(r.outlines.cablePitch.x);
    expect(copy.tracks.cablePitch).toEqual(r.tracks.cablePitch);
  });

  it('places posts and marks at the contacts of the achieved draw', () => {
    const s = createSupport(/** @type {any} */ (r.tracks.stringPitch));
    const c = createSupport(/** @type {any} */ (r.tracks.cablePitch));
    const a = /** @type {NonNullable<SolveResult['achieved']>} */ (r.achieved);
    const bow = /** @type {import('../../src/core/geometry.js').BowGeometry} */ (bowGeometry(state.geometry, s).bow);
    const n = a.x.length;
    const byId = Object.fromEntries(r.marks.map((m) => [m.id, m]));
    // String exit at brace: on the vertical string at x_b.
    const O0 = axle(bow, 0);
    const Xs = camToWorld(O0, 0, byId['string-brace']);
    expect(Xs.x).toBeCloseTo(bow.xBrace, 12);
    // Cable exit at brace: the cable line runs from the mark to the anchor.
    const Xc = camToWorld(O0, 0, byId['cable-brace']);
    const A0 = { x: O0.x, y: -O0.y };
    const tc = { x: -Math.sin(byId['cable-brace'].psi), y: Math.cos(byId['cable-brace'].psi) };
    expect(Math.abs((A0.x - Xc.x) * tc.y - (A0.y - Xc.y) * tc.x)).toBeLessThan(1e-9);
    expect(byId['cable-brace'].psi).toBeCloseTo(a.psiC[0], 9);
    // Full-draw index: on the line from the string contact to the nock.
    const Of = axle(bow, a.alpha[n - 1]);
    const Xf = camToWorld(Of, a.theta[n - 1], byId['full-draw']);
    const u = { x: Math.sin(a.phi[n - 1]), y: -Math.cos(a.phi[n - 1]) };
    expect(Math.abs((a.x[n - 1] - Xf.x) * u.y - (0 - Xf.y) * u.x)).toBeLessThan(1e-9);
    // Termination posts: the pitch line is tangent to the post circle.
    const posts = Object.fromEntries(r.posts.map((p) => [p.id, p]));
    const rp = state.body.postDiameter / 2;
    for (const [id, support, d] of /** @type {const} */ ([['string-post', s, state.cords.stringDiameter], ['cable-post', c, state.cords.cableDiameter]])) {
      const p = posts[id];
      const n0 = { x: Math.cos(p.psi), y: Math.sin(p.psi) };
      expect(support.p(p.psi) - (p.x * n0.x + p.y * n0.y)).toBeCloseTo(rp + d / 2, 12);
    }
    expect(posts['string-post'].psi).toBeCloseTo(/** @type {any} */ (r.tracks.string).psiEnd, 15);
    expect(posts['cable-post'].psi).toBeCloseTo(/** @type {any} */ (r.tracks.cable).psiStart, 15);
    // Cable stop: at full draw the free span passes the peg at r_peg + d/2.
    const stop = camToWorld(Of, a.theta[n - 1], posts['cable-stop']);
    const psiF = a.psiC[n - 1];
    const Xcf = camToWorld(Of, a.theta[n - 1], c.point(psiF));
    const Af = { x: Of.x, y: -Of.y };
    const span = Math.hypot(Af.x - Xcf.x, Af.y - Xcf.y);
    const cross = ((Af.x - Xcf.x) * (stop.y - Xcf.y) - (Af.y - Xcf.y) * (stop.x - Xcf.x)) / span;
    expect(Math.abs(cross)).toBeCloseTo(rp + state.cords.cableDiameter / 2, 9);
    // On the axle side of the cable line.
    const crossAxle = ((Af.x - Xcf.x) * (Of.y - Xcf.y) - (Af.y - Xcf.y) * (Of.x - Xcf.x)) / span;
    expect(Math.sign(cross)).toBe(Math.sign(crossAxle));
  });

  it('resolves coarsely with 100 samples and reports timings', () => {
    const coarse = solve(state, { resolution: 'coarse' });
    expect(coarse.status).toBe('ok');
    expect(coarse.resolution).toBe('coarse');
    expect(coarse.achieved?.x.length).toBe(COARSE_SAMPLES);
    expect(coarse.outlines.cablePitch.x.length).toBe(361);
    for (const t of Object.values(coarse.timings)) expect(t).toBeGreaterThanOrEqual(0);
    expect(coarse.timings.total).toBeGreaterThanOrEqual(coarse.timings.forward);
  });
});

describe('solve: diagnostics', () => {
  /**
   * @param {ProjectState} s
   * @param {string} code
   * @param {{ maxIterations?: number }} [options]
   */
  const expectCode = (s, code, options = {}) => {
    const r = solve(s, { resolution: 'coarse', ...options });
    expect(codes(r)).toContain(code);
    const d = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === code));
    expect(d.message.length).toBeGreaterThan(20);
    expect(d.suggestion.length).toBeGreaterThan(10);
    expect(r.status).toBe(code === 'no-convergence' ? 'no-convergence' : 'infeasible');
    return { r, d };
  };

  it('has a condition for every code', () => {
    expect(Object.keys(CODES).sort()).toEqual([
      'brace-tension', 'cable-clearance', 'cable-fold', 'cable-lever', 'cable-radius', 'cable-wrap', 'closing-blend',
      'invalid-input', 'limb-energy', 'limb-rotation', 'no-convergence', 'nonpositive-force', 'slack-cable',
      'slack-string', 'string-clearance', 'string-radius', 'string-wrap', 'target-shape', 'wrap-exhausted',
    ]);
  });

  it('invalid-input: a state that fails validation, without throwing', () => {
    const { r, d } = expectCode(modified((s) => (s.geometry.ata = 0.1)), 'invalid-input');
    expect(d.message).toMatch(/Axle-to-axle length/);
    expect(r.metrics).toBeNull();
    expect(codes(solve(/** @type {any} */ (null)))).toEqual(['invalid-input']);
  });

  it('brace-tension: the curve rises faster at brace than the limb moment can hold', () => {
    const { d } = expectCode(modified((s) => (s.limb.preloadTravel = 0.05)), 'brace-tension');
    expect(d.message).toMatch(/rises too steeply/);
    expect(d.suggestion).toMatch(/point 2 to at most \d+ N/);
    expect(d.suggestion).toMatch(/preload travel to at least \d+\.\d mm/);
    expect(d.xRange?.[0]).toBe(defaultState().curve.points[0].x);
    const none = expectCode(modified((s) => (s.limb.preloadTravel = 0)), 'brace-tension');
    expect(none.d.suggestion).toMatch(/preload travel above 0 mm/);
  });

  it('cable-lever: a limb lever at 90° at brace', () => {
    expectCode(modified((s) => (s.geometry.limbAngleBrace = 90 * DEG)), 'cable-lever');
  });

  it('limb-rotation: the limbs turn more than allowed, with the stiffness that keeps them within', () => {
    const { d } = expectCode(modified((s) => (s.limb.maxRotation = 10 * DEG)), 'limb-rotation');
    expect(d.suggestion).toMatch(/stiffness to at least \d+\.\d N\/mm/);
    const travel = expectCode(modified((s) => {
      s.limb.mode = 'travel';
      s.limb.maxRotation = 10 * DEG;
    }), 'limb-rotation');
    expect(travel.d.suggestion).toMatch(/limb travel to at most/);
  });

  it('limb-energy: a limb table whose force falls off before the draw energy is stored', () => {
    const { d } = expectCode(
      modified((s) => {
        s.limb.mode = 'table';
        s.limb.table = [
          { travel: 0, force: 400 },
          { travel: 0.02, force: 500 },
          { travel: 0.04, force: 50 },
        ];
      }),
      'limb-energy',
    );
    expect(d.suggestion).toMatch(/limb table/);
  });

  it('string-radius and string-clearance: a large bend radius, bore and wall', () => {
    expectCode(modified((s) => (s.body.minBendRadius = 0.05)), 'string-radius');
    const { d } = expectCode(modified((s) => {
      s.body.boreDiameter = 0.03;
      s.body.minWall = 0.02;
    }), 'string-clearance');
    expect(d.suggestion).toMatch(/at least \d+\.\d mm/);
  });

  it('string-wrap: a small string track wraps more than one turn', () => {
    const { d } = expectCode(modified((s) => {
      s.stringTrack.radius = 0.03;
      s.stringTrack.offset = 0.005;
    }), 'string-wrap');
    expect(d.suggestion).toMatch(/string track radius by at least \d+\.\d mm/);
  });

  it('slack-cable and cable-fold: a limb too weak for the string tension before the peak', () => {
    const weak = modified((s) => {
      s.limb.stiffness = 1000;
      s.limb.preloadTravel = 0.2;
    });
    const { r, d } = expectCode(weak, 'slack-cable');
    expect(d.message).toMatch(/string tension of up to \d+ N between/);
    // The preload is at its largest value, so the stiffness is named.
    expect(d.suggestion).toMatch(/limb stiffness to at least \d+\.\d N\/mm/);
    expect(codes(r)).toContain('cable-fold');
    const fold = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === 'cable-fold'));
    expect(fold.xRange?.[0]).toBeGreaterThan(defaultState().curve.points[1].x);
    expect(fold.psiRange).not.toBeNull();
  });

  it('target-shape and nonpositive-force: a first segment that the brace curvature bends below zero', () => {
    const s = modified((st) => {
      const [first] = st.curve.points;
      const last = /** @type {import('../../src/core/interp.js').CurvePoint} */ (st.curve.points.at(-1));
      st.curve.mode = 'custom';
      st.curve.points = [first, { x: first.x + 2 * INCH, F: 3 }, { x: first.x + 2.3 * INCH, F: 1 }, { x: first.x + 5.3 * INCH, F: 267 }, last];
    });
    expect(validate(s)).toEqual([]);
    const { r, d } = expectCode(s, 'target-shape');
    expect(d.message).toMatch(/N\/in² instead of/);
    const negative = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === 'nonpositive-force'));
    expect(negative.suggestion).toMatch(/point 2/);
    expect(/** @type {[number, number]} */ (negative.xRange)[1]).toBeLessThanOrEqual(s.curve.points[1].x);
  });

  it('cable-radius: a peak the cam cannot follow within the tolerance', () => {
    const { r, d } = expectCode(modified((s) => (s.curve.params.peak = 290), { regenerate: true }), 'cable-radius');
    expect(d.message).toMatch(/radius of curvature of -\d+\.\d mm \(it would bend the wrong way\)/);
    expect(d.message).toMatch(/differs from the target by up to \d+\.\d N, more than the 4\.\d N tolerance \(peak \+/);
    expect(r.fit.used).toBe(true);
    expect(r.fit.withinTolerance).toBe(false);
    // The fitted cam is still built and meets the radius limit.
    expect(/** @type {any} */ (r.metrics).minRho).toBeGreaterThanOrEqual(defaultState().body.minBendRadius - 1e-6);
  });

  it('cable-clearance: a let-off that needs a cable lever arm inside the bore wall', () => {
    const { d } = expectCode(modified((s) => (s.curve.params.letOff = 0.9), { regenerate: true }), 'cable-clearance');
    expect(d.message).toMatch(/lever arm of \d+\.\d mm between .* in and .* in/);
    expect(d.suggestion).toMatch(/^Reduce let-off below \d+ %/);
  });

  it('cable-wrap and closing-blend: a lead-in wrap that leaves too little of the turn', () => {
    const wrap = expectCode(modified((s) => (s.body.leadInWrap = 150 * DEG)), 'cable-wrap');
    expect(wrap.d.suggestion).toMatch(/lead-in wrap to at most \d+\.\d°/);
    expect(wrap.r.metrics).toBeNull();
    const blend = expectCode(modified((s) => (s.body.leadInWrap = 120 * DEG)), 'closing-blend');
    expect(blend.d.message).toMatch(/remaining \d+\.\d°/);
    expect(blend.d.suggestion).toMatch(/lead-in wrap to at most \d+\.\d°/);
  });

  it('forward model diagnostics of the final cam become solver diagnostics once', () => {
    const fmt = formatter(defaultState().units);
    /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic[]} */
    const diags = [];
    const forward = /** @type {any} */ ({
      n: 2,
      psiS: [0, 1],
      psiC: [4, 5],
      stringTermination: 7,
      cableTermination: 3,
      diagnostics: [
        { code: 'slack-string', xRange: [0.2, 0.3], message: '' },
        { code: 'slack-string', xRange: [0.4, 0.5], message: '' },
        { code: 'wrap-exhausted', xRange: [0.6, 0.7], message: '' },
        { code: 'wrap-overlap', xRange: [0.2, 0.25], message: '' },
        { code: 'cam-reversal', xRange: [0.3, 0.4], message: '' },
        { code: 'cable-lever', xRange: [0.3, 0.4], message: '' },
        { code: 'no-convergence', xRange: [0.5, 0.7], message: 'the closure did not converge' },
        { code: 'brace', xRange: null, message: 'no brace' },
      ],
    });
    forwardDiagnostics(forward, diags, fmt);
    expect(diags.map((d) => d.code)).toEqual([
      'slack-string', 'wrap-exhausted', 'string-wrap', 'slack-cable', 'cable-lever', 'no-convergence', 'no-convergence',
    ]);
    expect(diags[0].message).toMatch(/between .* in and .* in/);
    // The cable wrap is named when only the cable wraps a full turn.
    /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic[]} */
    const cable = [];
    forwardDiagnostics({ ...forward, psiS: [0, 1], stringTermination: 2, psiC: [4, 10], cableTermination: 3, diagnostics: [forward.diagnostics[3]] }, cable, fmt);
    expect(cable.map((d) => d.code)).toEqual(['cable-wrap']);
  });

  it('no-convergence: an iteration limit of one Newton step', () => {
    const { r, d } = expectCode(defaultState(), 'no-convergence', { maxIterations: 1 });
    expect(d.message).toMatch(/did not converge at \d+\.\d in/);
    expect(d.xRange?.[1]).toBe(defaultState().curve.points.at(-1)?.x);
    // The string track outlines are still there.
    expect(r.outlines.stringPitch.x.length).toBe(361);
  });
});

describe('solve: robustness', () => {
  it('never throws on valid states and returns plain data', () => {
    const ranges = (/** @type {string} */ path) => FIELDS[path];
    const num = (/** @type {string} */ path, /** @type {number} */ lo = 0, /** @type {number} */ hi = 1) => {
      const f = ranges(path);
      return fc.double({ min: f.min + lo * (f.max - f.min), max: f.min + hi * (f.max - f.min), noNaN: true });
    };
    fc.assert(
      fc.property(
        fc.record({
          ata: num('geometry.ata'),
          brace: num('geometry.braceHeight'),
          draw: num('geometry.drawLength', 0.5, 1),
          limbLength: num('geometry.limbLength'),
          limbAngle: num('geometry.limbAngleBrace'),
          peak: num('curve.params.peak'),
          letOff: num('curve.params.letOff'),
          rise: num('curve.params.riseFraction'),
          stiffness: num('limb.stiffness', 0, 0.05),
          preload: num('limb.preloadTravel'),
          maxRotation: num('limb.maxRotation'),
          mode: fc.constantFrom('stiffness', 'travel'),
          travel: num('limb.travel'),
          radius: num('stringTrack.radius', 0.3, 1),
          offsetFraction: fc.double({ min: 0, max: 0.9, noNaN: true }),
          phase: num('stringTrack.phase'),
          ellipse: fc.boolean(),
          leadIn: num('body.leadInWrap'),
          residual: num('body.residualWrap'),
        }),
        (v) => {
          const s = structuredClone(defaultState());
          Object.assign(s.geometry, { ata: v.ata, braceHeight: v.brace, drawLength: v.draw, limbLength: v.limbLength, limbAngleBrace: v.limbAngle });
          Object.assign(s.curve.params, { peak: v.peak, letOff: v.letOff, riseFraction: v.rise });
          Object.assign(s.limb, { stiffness: v.stiffness, preloadTravel: v.preload, maxRotation: v.maxRotation, mode: v.mode, travel: v.travel });
          const minor = Math.max(0.005, 0.8 * v.radius);
          Object.assign(s.stringTrack, {
            shape: v.ellipse ? 'ellipse' : 'eccentric',
            radius: v.radius,
            semiMajor: v.radius,
            semiMinor: minor,
            offset: v.offsetFraction * (v.ellipse ? minor : v.radius),
            phase: v.phase,
          });
          Object.assign(s.body, { leadInWrap: v.leadIn, residualWrap: v.residual });
          const { xBrace, xFull } = drawRange(s.geometry.braceHeight, s.geometry.drawLength);
          if (xFull - xBrace <= 5 * INCH) return;
          s.curve.points = generateCurve({ xBrace, xFull, ...s.curve.params });
          if (validate(s).length > 0) return;
          const r = solve(s, { resolution: 'coarse' });
          expect(['ok', 'infeasible', 'no-convergence']).toContain(r.status);
          expect(r.status === 'ok').toBe(r.diagnostics.length === 0);
          for (const d of r.diagnostics) {
            expect(Object.keys(CODES)).toContain(d.code);
            expect(typeof d.message).toBe('string');
            expect(typeof d.suggestion).toBe('string');
          }
          expect(() => structuredClone(r)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reports draw positions as AMO draw lengths in the display units', () => {
    const fmt = formatter({ draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' });
    expect(fmt.draw(20 * INCH)).toBe('21.8 in');
    expect(fmt.drawRange([20 * INCH, 20 * INCH])).toBe('at 21.8 in');
    expect(fmt.drawRange([10 * INCH - AMO_OFFSET, 20 * INCH - AMO_OFFSET])).toBe('between 10.0 in and 20.0 in');
    expect(fmt.slope(1000)).toBe('25.4 N/in');
    expect(fmt.curvature(1000)).toBe('0.65 N/in²');
    const metric = formatter({ draw: 'mm', force: 'lbf', dims: 'in', energy: 'ft·lbf', stiffness: 'lbf/in' });
    expect(metric.draw(0.5)).toBe('544 mm');
    expect(metric.size(0.0254)).toBe('1.000 in');
    expect(metric.stiffness(10000)).toMatch(/lbf\/in$/);
    expect(metric.percent(0.8)).toBe('80 %');
    expect(metric.angle(Math.PI)).toBe('180.0°');
  });
});
