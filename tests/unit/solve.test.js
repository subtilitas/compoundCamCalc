import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { drawRange, generateCurve, pointMetrics } from '../../src/core/curve.js';
import { CODES, formatter } from '../../src/core/diagnostics.js';
import { axle, bowGeometry } from '../../src/core/geometry.js';
import { COARSE_SAMPLES, FULL_SAMPLES, solveForward } from '../../src/core/forward.js';
import { splineLimits } from '../../src/core/fit.js';
import { limbFromState } from '../../src/core/limb.js';
import {
  FIT_FORCE_FLOOR, FIT_FORCE_TOLERANCE, GROOVE_MARGIN, STRING_TRACK_TRIALS, changeSuggestion, forwardDiagnostics, largerStringTrack,
  leadInTrials, solve, trialPasses,
} from '../../src/core/solve.js';
import { createSupport, eccentricCircle, stringTrackSupport } from '../../src/core/support.js';
import { AMO_OFFSET, INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import { FIELDS, validate } from '../../src/state/schema.js';
import { reduce } from '../../src/state/store.js';

/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../../src/core/solve.js').SolveBrace} SolveBrace */
/** @typedef {import('../../src/core/limb.js').LimbData} LimbData */

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
 * Sampled outline of a result; fails the test when it is absent.
 * @param {SolveResult} r
 * @param {keyof import('../../src/core/solve.js').SolveOutlines} name
 */
function outline(r, name) {
  const o = r.outlines[name];
  if (!o) throw new Error(`the result has no ${name} outline`);
  return o;
}

/**
 * Forward model of the cam a result built, at the nock positions xs, with
 * the terminations of the result.
 * @param {ProjectState} state
 * @param {SolveResult} r
 * @param {number[]} xs
 */
function forwardOfResult(state, r, xs) {
  const limb = /** @type {LimbData} */ (limbFromState(state.limb, state.geometry.limbLength).limb);
  return solveForward({
    geometry: state.geometry,
    stringTrack: /** @type {import('../../src/core/support.js').SupportData} */ (r.tracks.stringPitch),
    cableTrack: /** @type {import('../../src/core/support.js').SupportData} */ (r.tracks.cablePitch),
    limb,
    x: xs,
    stringTermination: r.tracks.string?.psiEnd,
    cableTermination: r.tracks.cable?.psiStart,
  });
}

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

  it('keeps the closed cable track at or above p_min and ρ_lim on every interval', () => {
    const pMin = state.body.boreDiameter / 2 + state.body.minWall + state.cords.cableDiameter / 2;
    const rhoLimit = Math.max(state.body.minBendRadius, state.cords.cableDiameter / 2 + GROOVE_MARGIN);
    const limits = splineLimits(/** @type {import('../../src/core/support.js').SplineData} */ (r.tracks.cablePitch), rhoLimit, pMin);
    expect(limits.minP).toBeGreaterThanOrEqual(pMin);
    expect(limits.minRho).toBeGreaterThanOrEqual(rhoLimit);
  });

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
        `cam ${(m.camMaxDimension * 1e3).toFixed(1)} mm, min ρ ${(m.stringMinRho * 1e3).toFixed(2)} mm (string), ${(m.cableMinRho * 1e3).toFixed(2)} mm (cable), ` +
        `string wrap ${(m.stringWrap / DEG).toFixed(0)}°, cable wrap ${(m.cableWrap / DEG).toFixed(0)}°, ` +
        `string ${(m.stringLength / INCH).toFixed(2)} in, cable ${(m.cableLength / INCH).toFixed(2)} in, fit ${r.fit.used} (${r.fit.maxForceDifference.toFixed(2)} N)`,
    );
    expect(Math.abs(m.peak / target.peak - 1)).toBeLessThan(0.015);
    expect(Math.abs(m.letOff - target.letOff)).toBeLessThan(0.01);
    expect(m.drawEnergy).toBeGreaterThan(90);
    expect(m.drawEnergy).toBeLessThan(130);
    expect(m.limbEnergy).toBeGreaterThan(m.drawEnergy);
    expect(m.camMaxDimension).toBeLessThan(0.11);
    expect(m.stringMinRho).toBeGreaterThanOrEqual(m.stringRhoLimit - 1e-6);
    expect(m.cableMinRho).toBeGreaterThanOrEqual(m.cableRhoLimit - 1e-6);
    expect(m.stringRhoLimit).toBe(Math.max(state.body.minBendRadius, state.cords.stringDiameter / 2 + GROOVE_MARGIN));
    expect(m.cableRhoLimit).toBe(Math.max(state.body.minBendRadius, state.cords.cableDiameter / 2 + GROOVE_MARGIN));
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
    // The default keeps more than half the tolerance as margin.
    expect(worst).toBeLessThan(0.5 * tolerance);
    expect(worst).toBeCloseTo(r.fit.maxForceDifference, 12);
    expect(r.fit.withinTolerance).toBe(true);
    expect(r.fit.idealIssues.length).toBeGreaterThan(0);
    const within = new RegExp(`by up to \\d+\\.\\d N, within the ${tolerance.toFixed(1).replace('.', '\\.')} N tolerance \\(peak \\+`);
    for (const m of r.fit.idealIssues) expect(m).toMatch(within);
    expect(Math.abs(r.fit.energyDifference)).toBeLessThan(0.005 * pointMetrics(state.curve.points).energy);
    // Both fit candidates keep the brace lever arm, so the brace slope is the target's.
    const f = forwardOfResult(state, r, [state.curve.points[0].x, state.curve.points[1].x]);
    const forwardBrace = /** @type {import('../../src/core/forward.js').BraceState} */ (f.brace);
    expect(Math.abs(forwardBrace.slope / /** @type {SolveBrace} */ (r.brace).slope - 1)).toBeLessThan(1e-9);
  });

  it('returns closed, nested outlines and plain data', () => {
    for (const name of /** @type {const} */ (['stringPitch', 'stringGroove', 'stringFlange', 'cablePitch', 'cableGroove', 'cableFlange'])) {
      const o = outline(r, name);
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
    expect(outline(copy, 'cablePitch').x).toEqual(outline(r, 'cablePitch').x);
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
    // The reported full-draw cable contact is the one of the built cam.
    expect(/** @type {any} */ (r.tracks.cable).psiFull).toBe(a.psiC[n - 1]);
    expect(Math.abs(/** @type {any} */ (r.tracks.cable).psiFull - /** @type {any} */ (r.tracks.cable).activeEnd)).toBeLessThan(0.1 * DEG);
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
    expect(outline(coarse, 'cablePitch').x.length).toBe(361);
    for (const t of Object.values(coarse.timings)) expect(t).toBeGreaterThanOrEqual(0);
    expect(coarse.timings.total).toBeGreaterThanOrEqual(coarse.timings.forward);
  });
});

describe('solve: edits around the default preset', () => {
  // Peak 250 N to 285 N, rise 44 % to 50 % and valley 0.9 in and 1.5 in
  // around the default (267 N, 46 %, 1.2 in): each fitted cam follows its
  // target within the fit tolerance, so the default does not sit at the
  // edge of the tolerance.
  /** @type {[string, Partial<import('../../src/state/schema.js').CurveParams>][]} */
  const edits = [
    ['peak 250 N', { peak: 250 }], ['peak 260 N', { peak: 260 }], ['peak 275 N', { peak: 275 }], ['peak 285 N', { peak: 285 }],
    ['rise 44 %', { riseFraction: 0.44 }], ['rise 48 %', { riseFraction: 0.48 }], ['rise 50 %', { riseFraction: 0.5 }],
    ['valley 0.9 in', { valleyWidth: 0.9 * INCH }], ['valley 1.5 in', { valleyWidth: 1.5 * INCH }],
  ];
  it.each(edits)('solves the edit %s with status ok and no diagnostics', (_, params) => {
    const s = reduce(defaultState(), { type: 'setCurveParams', params });
    expect(s.curve.params).toMatchObject(params);
    const r = solve(s);
    expect(r.diagnostics).toEqual([]);
    expect(r.status).toBe('ok');
    const tolerance = Math.max(FIT_FORCE_TOLERANCE * pointMetrics(s.curve.points).peak, FIT_FORCE_FLOOR);
    expect(r.fit.maxForceDifference).toBeLessThanOrEqual(tolerance);
  });

  it('reaches the requested valley width of 0.9 in', () => {
    const s = reduce(defaultState(), { type: 'setCurveParams', params: { valleyWidth: 0.9 * INCH } });
    expect(pointMetrics(s.curve.points).valleyWidth / (0.9 * INCH)).toBeCloseTo(1, 6);
  });
});

describe('solve: diagnostics', () => {
  /**
   * @param {ProjectState} s
   * @param {string} code
   * @param {{ maxIterations?: number, resolution?: 'coarse' | 'full' }} [options]
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

  it('brace-tension: the suggested force of point 2 gives 80 % of the limit slope and removes the diagnostic', () => {
    // The end slope of the curve is affine in the force of point 2 and
    // clamped at 0, not proportional to it: at 30 mm preload travel the
    // force scaled by 0.8·T_limit/T_s0, 35 N, gives a curve that does not
    // rise at brace, and 62 N gives 0.77 of the limit slope.
    for (const preload of [0.03, 0.05]) {
      const s = modified((st) => {
        st.limb.preloadTravel = preload;
        st.curve.mode = 'custom';
      });
      const { d, r } = expectCode(s, 'brace-tension');
      const F2 = Number(/** @type {RegExpMatchArray} */ (d.suggestion.match(/point 2 to at most (\d+) N/))[1]);
      const fixed = structuredClone(s);
      fixed.curve.points[1].F = F2;
      const after = solve(fixed, { resolution: 'coarse' });
      expect(codes(after)).not.toContain('brace-tension');
      const ratio = /** @type {SolveBrace} */ (after.brace).slope / /** @type {SolveBrace} */ (r.brace).maxSlope;
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThanOrEqual(0.8);
    }
  });

  it('brace-tension: names the preload travel up to 400 mm and otherwise the stiffness, each giving 80 % of the limit', () => {
    /**
     * Default limb (2.6 N/mm, 192 mm preload) with point 2 moved.
     * @param {number} x position of point 2 from the grip (in)
     * @param {number} F force of point 2 (N)
     */
    const steep = (x, F) => modified((s) => {
      Object.assign(s.limb, { mode: 'stiffness', stiffness: 2.6e3, preloadTravel: 0.192 });
      s.curve.mode = 'custom';
      s.curve.points[1] = { x: x * INCH, F };
    });
    /** @param {ProjectState} s */
    const ratio = (s) => {
      const b = /** @type {SolveBrace} */ (solve(s, { resolution: 'coarse' }).brace);
      return b.stringTension / b.maxStringTension;
    };
    // Point 2 at 8.3 in and 130 N needs 283.4 mm of preload travel.
    const preload = steep(8.3, 130);
    const p = expectCode(preload, 'brace-tension');
    const mm = Number(/** @type {RegExpMatchArray} */ (p.d.suggestion.match(/preload travel to at least (\d+\.\d) mm/))[1]);
    expect(mm).toBeGreaterThan(200);
    expect(mm).toBeLessThanOrEqual(FIELDS['limb.preloadTravel'].max * 1e3);
    expect(ratio({ ...preload, limb: { ...preload.limb, preloadTravel: mm / 1e3 } })).toBeCloseTo(0.8, 3);
    // Point 2 at 7.5 in and 150 N needs more than 400 mm: the stiffness is named.
    const stiff = steep(7.5, 150);
    const k = expectCode(stiff, 'brace-tension');
    expect(k.d.suggestion).not.toMatch(/preload/);
    const nmm = Number(/** @type {RegExpMatchArray} */ (k.d.suggestion.match(/limb stiffness to at least (\d+\.\d) N\/mm/))[1]);
    expect(ratio({ ...stiff, limb: { ...stiff.limb, stiffness: nmm * 1e3 } })).toBeCloseTo(0.8, 2);
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
    // The fitted default cam turns the limbs 15.8940°, the ideal track
    // 15.8923°: a limit between the two holds for the ideal track only.
    for (const resolution of /** @type {const} */ (['coarse', 'full'])) {
      const between = expectCode(modified((s) => (s.limb.maxRotation = 15.893 * DEG)), 'limb-rotation', { resolution });
      expect(codes(between.r)).toEqual(['limb-rotation']);
      const alpha = /** @type {NonNullable<SolveResult['achieved']>} */ (between.r.achieved).alpha;
      expect(alpha[alpha.length - 1]).toBeGreaterThan(15.893 * DEG);
      expect(between.d.message).toMatch(/^The limbs turn 15\.894\d?° from brace to full draw; the maximum limb rotation is 15\.893\d?°$/);
    }
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
      Object.assign(s.stringTrack, { shape: 'eccentric', radius: 0.045, offset: 0.022, phase: -122 * DEG });
      s.limb.stiffness = 1000;
      s.limb.preloadTravel = 0.2;
    });
    // 309.4 mm of preload travel is within its range, so the preload is named.
    const preload = expectCode(weak, 'slack-cable');
    expect(preload.d.suggestion).toMatch(/^Increase the limb preload travel to at least 309\.\d mm/);
    // A 500 N peak needs more than the largest preload travel of 400 mm, so
    // the stiffness is named.
    const heavy = modified((s) => {
      Object.assign(s, structuredClone(weak));
      s.limb.preloadTravel = FIELDS['limb.preloadTravel'].max;
      s.curve.params.peak = 500;
    }, { regenerate: true });
    const { r, d } = expectCode(heavy, 'slack-cable');
    expect(d.message).toMatch(/string tension of up to \d+ N between/);
    expect(d.suggestion).toMatch(/limb stiffness to at least \d+\.\d N\/mm/);
    expect(codes(r)).toContain('cable-fold');
    const fold = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === 'cable-fold'));
    expect(fold.xRange?.[0]).toBeGreaterThan(defaultState().curve.points[1].x);
    expect(fold.psiRange).not.toBeNull();
  });

  it('cable-fold: a contact at point 2 behind its brace position, where no brace blend exists', () => {
    // Point 2 at 162 N: the cable contact at point 2 lies 0.4° behind ψ_c0.
    const s = modified((st) => {
      st.curve.mode = 'custom';
      st.curve.points[1].F = 162;
    });
    const { r, d } = expectCode(s, 'cable-fold');
    expect(codes(r)).not.toContain('no-convergence');
    expect(d.xRange).toEqual([s.curve.points[0].x, s.curve.points[1].x]);
    expect(d.message).toMatch(/at point 2 \(12\.1 in\) it lies \d+\.\d° behind its brace position/);
    expect(d.suggestion).toBe('Lower the force of point 2 or move it later, so that the force rises more evenly from brace to point 3');
    // Either direction of the suggestion clears the fold.
    /** @type {((st: ProjectState) => void)[]} */
    const changes = [(st) => (st.curve.points[1].F = 150), (st) => (st.curve.points[1].x += 2 * INCH)];
    for (const change of changes) {
      const t = structuredClone(s);
      change(t);
      expect(validate(t)).toEqual([]);
      expect(codes(solve(t, { resolution: 'coarse' }))).not.toContain('cable-fold');
    }
  });

  it('cable-fold: names the let-off only for a fold where the force falls after the peak', () => {
    /** @param {(st: ProjectState) => void} change */
    const folds = (change) => {
      const s = modified((st) => {
        st.curve.mode = 'custom';
        change(st);
      });
      expect(validate(s)).toEqual([]);
      return solve(s, { resolution: 'coarse' }).diagnostics.filter((q) => q.code === 'cable-fold');
    };
    // Point 2 at 10 in and 80 N: folds on the rise, from point 2 on.
    const rise = folds((st) => (st.curve.points[1] = { x: 10 * INCH - AMO_OFFSET, F: 80 }));
    expect(rise.length).toBeGreaterThan(0);
    for (const d of rise) expect(d.suggestion).toMatch(/^Lower the force of point 2 or move it later/);
    // Point 5 at 21.3 in and 67 N: the force falls 200 N within 0.2 in of the plateau end.
    const drop = folds((st) => (st.curve.points[4] = { x: 21.3 * INCH - AMO_OFFSET, F: 67 }));
    expect(drop.length).toBe(1);
    expect(drop[0].suggestion).toBe('Spread the force drop in this range over a longer draw (move the points apart), or reduce the let-off');
  });

  it('target-shape and nonpositive-force: a brace curvature that bends a long, shallow first segment below zero', () => {
    // A string groove with 46 mm offset on a 50 mm radius gives a brace
    // curvature F''(x_b) that no monotone first segment can follow: point 2
    // is 11.8 in from brace at 7 N and a local maximum, so its slope is 0.
    const s = modified((st) => {
      Object.assign(st.limb, { mode: 'stiffness', stiffness: 2.6e3, preloadTravel: 0.192 });
      Object.assign(st.stringTrack, { shape: 'eccentric', radius: 0.05, offset: 0.046, phase: -149 * DEG });
      st.curve.mode = 'custom';
      st.curve.points = [[6.5, 0], [18.3, 7], [18.6, 6], [22.9, 267], [27.25, 67]].map(([x, F]) => ({ x: x * INCH, F }));
    });
    expect(validate(s)).toEqual([]);
    const { r, d } = expectCode(s, 'target-shape');
    expect(d.message).toMatch(/N\/in² instead of/);
    expect(r.brace?.shapePreserved).toBe(false);
    const negative = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === 'nonpositive-force'));
    expect(negative.suggestion).toMatch(/point 2/);
    const [from, to] = /** @type {[number, number]} */ (negative.xRange);
    expect(from).toBeGreaterThan(s.curve.points[0].x);
    expect(to).toBeLessThanOrEqual(s.curve.points[1].x);
    expect(to - from).toBeGreaterThan(5 * INCH);
  });

  it('keeps a first segment monotone when the prescribed brace values allow it', () => {
    // Point 2 at 3 N is a local maximum 2 in from brace. A string groove of
    // radius 45 mm with 22 mm offset gives a brace curvature that a monotone
    // first segment can follow: the prescribed-start search of the
    // interpolant finds it.
    const s = modified((st) => {
      Object.assign(st.limb, { mode: 'stiffness', stiffness: 2.6e3, preloadTravel: 0.192 });
      Object.assign(st.stringTrack, { shape: 'eccentric', radius: 0.045, offset: 0.022, phase: -122 * DEG });
      const [first] = st.curve.points;
      const last = /** @type {import('../../src/core/interp.js').CurvePoint} */ (st.curve.points.at(-1));
      st.curve.mode = 'custom';
      st.curve.points = [first, { x: first.x + 2 * INCH, F: 3 }, { x: first.x + 2.3 * INCH, F: 1 }, { x: first.x + 5.3 * INCH, F: 267 }, last];
    });
    expect(validate(s)).toEqual([]);
    const r = solve(s, { resolution: 'coarse' });
    expect(r.brace?.shapePreserved).toBe(true);
    expect(codes(r)).not.toContain('target-shape');
    expect(codes(r)).not.toContain('nonpositive-force');
    const t = /** @type {NonNullable<SolveResult['target']>} */ (r.target);
    for (let i = 1; i < t.x.length; i++) expect(t.F[i]).toBeGreaterThan(0);
  });

  it('cable-radius: a let-off the cam cannot follow within the tolerance', () => {
    const s = modified((st) => (st.curve.params.letOff = 0.78), { regenerate: true });
    const { r, d } = expectCode(s, 'cable-radius');
    // A negative radius has no size to fix: the message gives the angle
    // over which the track bends the wrong way.
    expect(d.message).toMatch(/at worst it bends the wrong way over \d+\.\d° between \d+\.\d in and \d+\.\d in; the radius limit is 5\.0 mm/);
    expect(d.message).not.toMatch(/radius of curvature of -/);
    expect(d.message).toMatch(/differs from the target by up to \d+\.\d N, more than the \d+\.\d N tolerance \(peak \+/);
    // The brace blend, which the fit always replaces, is not the named range.
    expect(/** @type {[number, number]} */ (d.xRange)[0]).toBeGreaterThan(s.curve.points[1].x);
    // The largest force difference of the fitted cam is at full draw, above
    // the target, where the force stays at the holding weight: the
    // suggestion names the drop before it and the let-off.
    const a = /** @type {NonNullable<SolveResult['achieved']>} */ (r.achieved);
    const t = /** @type {NonNullable<SolveResult['target']>} */ (r.target);
    let at = 0;
    for (let i = 0; i < a.x.length; i++) if (Math.abs(a.F[i] - t.F[i]) > Math.abs(a.F[at] - t.F[at])) at = i;
    expect(at).toBe(a.x.length - 1);
    expect(d.message).toMatch(/; the largest difference, above the target, lies at point 7 \(29\.0 in\)$/);
    expect(d.suggestion).toBe('Make the force drop between points 5 and 6 more gradual: move them apart, or reduce the let-off');
    expect(s.curve.points[5].F).toBe(s.curve.points[6].F);
    expect(r.fit.used).toBe(true);
    expect(r.fit.withinTolerance).toBe(false);
    // The fitted cam is still built and meets the radius limit.
    expect(/** @type {any} */ (r.metrics).cableMinRho).toBeGreaterThanOrEqual(defaultState().body.minBendRadius - 1e-6);
  });

  // Eight full solves: 0.6 s alone and 2 s in the coverage run; the time
  // limit is 30 s.
  it('cable-radius: names where the fitted cam misses the target, not the brace blend', () => {
    // Rise 30 %: the fitted cam is 43.5 N below the target at 13.2 in,
    // between points 2 and 3; the ideal track bends the wrong way there
    // over a fraction of a degree with a radius of about -1.4e6 mm.
    const s = reduce(defaultState(), { type: 'setCurveParams', params: { riseFraction: 0.3 } });
    const r = solve(s);
    /** @param {SolveResult} q */
    const radius = (q) => q.diagnostics.find((e) => e.code === 'cable-radius');
    const d = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (radius(r));
    expect(d.message).toMatch(/bends the wrong way over \d+\.\d° between 13\.\d in and 13\.\d in/);
    expect(d.message).not.toMatch(/-\d{4,}/);
    expect(d.message).toMatch(/the largest difference, below the target, lies at 13\.\d in, between points 2 and 3$/);
    // The force rises 165 N from point 2 to point 3 over 3.7 in: a later
    // point 3 spreads the rise. A parametric curve names the rise to peak.
    expect(d.suggestion).toBe(
      'Increase the rise to peak, so that point 3 (the peak start) comes later and the force rises more evenly from point 2 to point 3',
    );
    expect(r.fit.maxForceDifference).toBeGreaterThan(43);
    // Applied: rise 40 % leaves 10.6 N, rise 44 % builds without diagnostics.
    const rise40 = solve(reduce(s, { type: 'setCurveParams', params: { riseFraction: 0.4 } }));
    expect(rise40.fit.maxForceDifference).toBeLessThan(0.3 * r.fit.maxForceDifference);
    const rise44 = solve(reduce(s, { type: 'setCurveParams', params: { riseFraction: 0.44 } }));
    expect(rise44.status).toBe('ok');
    expect(rise44.diagnostics).toEqual([]);
    // The same points as a custom curve name point 3. Moving it 1.5 in
    // later clears cable-radius: the difference falls to 6.6 N, within the
    // 8.0 N tolerance (the closing blend then fails). Point 2 lower raises
    // the difference: 60 N at 10 N lower.
    const custom = structuredClone(s);
    custom.curve.mode = 'custom';
    const rc = solve(custom);
    expect(radius(rc)?.suggestion).toBe('Move point 3 later, so that the force rises more evenly from point 2 to point 3');
    const later = structuredClone(custom);
    later.curve.points[2].x += 1.5 * INCH;
    expect(validate(later)).toEqual([]);
    const rl = solve(later);
    expect(codes(rl)).not.toContain('cable-radius');
    expect(rl.fit.maxForceDifference).toBeLessThan(0.2 * rc.fit.maxForceDifference);
    expect(rl.fit.withinTolerance).toBe(true);
    const lower = structuredClone(custom);
    lower.curve.points[1].F -= 10;
    expect(solve(lower).fit.maxForceDifference).toBeGreaterThan(rc.fit.maxForceDifference);
    // Three points (brace, peak start, full draw): the miss at 14.7 in lies
    // after the peak at 14.5 in, where the force falls to full draw; point 3
    // is the full-draw point and cannot move, so the drop is named.
    const three = structuredClone(reduce(defaultState(), { type: 'setCurveParams', params: { peak: 250, riseFraction: 0.3 } }));
    three.curve.mode = 'custom';
    const pts = three.curve.points;
    three.curve.points = [pts[0], pts[2], /** @type {import('../../src/core/interp.js').CurvePoint} */ (pts.at(-1))];
    expect(validate(three)).toEqual([]);
    const r3 = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (radius(solve(three)));
    expect(r3.message).toMatch(/between points 2 and 3$/);
    expect(r3.suggestion).toBe('Make the force drop between points 2 and 3 more gradual: move them apart, or reduce the let-off');
    // Valley 1 in at peak 285 N and rise 43 %: the miss lies on the drop
    // between points 5 and 6; moving point 5 0.5 in earlier halves it.
    const drop = reduce(defaultState(), { type: 'setCurveParams', params: { peak: 285, riseFraction: 0.43, valleyWidth: INCH } });
    const rd = solve(drop);
    const dd = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (rd.diagnostics.find((q) => q.code === 'cable-radius'));
    expect(dd.message).toMatch(/the largest difference, below the target, lies at 27\.\d in, between points 5 and 6$/);
    expect(dd.suggestion).toMatch(/^Make the force drop between points 5 and 6 more gradual: move them apart/);
    const moved = structuredClone(drop);
    moved.curve.mode = 'custom';
    moved.curve.points[4].x -= 0.5 * INCH;
    const rm = solve(moved);
    expect(codes(rm)).not.toContain('cable-radius');
    expect(rm.fit.maxForceDifference).toBeLessThan(0.6 * rd.fit.maxForceDifference);
  }, 30_000);

  it('cable-radius: a miss between brace and point 2 names point 2', () => {
    /** @param {number} F force of point 2 at 16.75 in (N) */
    const pointTwoAt = (F) => modified((st) => {
      st.curve.mode = 'custom';
      st.curve.points[1] = { x: 16.75 * INCH - AMO_OFFSET, F };
    });
    // Point 2 at 16.75 in with 240 N: the fitted cam is 10.7 N below the
    // target at 12.2 in, between brace and point 2, more than the 8.0 N
    // tolerance. The worst range of the ideal track lies after point 2, at
    // 17.2 in to 17.8 in; the suggestion follows the fitted cam.
    const { r, d } = expectCode(pointTwoAt(240), 'cable-radius');
    expect(codes(r)).toEqual(['cable-radius', 'cable-clearance']);
    expect(d.message).toMatch(/at worst it bends the wrong way over \d+\.\d° between 17\.\d in and 17\.\d in/);
    expect(d.message).toMatch(/the largest difference, below the target, lies at 12\.\d in, between points 1 and 2$/);
    expect(d.suggestion).toBe('Move point 2 so that the force rises more evenly from brace to point 3');
    expect(r.fit.maxForceDifference).toBeGreaterThan(10);
    // Applied: point 2 5 N higher builds without diagnostics (5.7 N).
    const higher = solve(pointTwoAt(245), { resolution: 'coarse' });
    expect(higher.status).toBe('ok');
    expect(higher.diagnostics).toEqual([]);
    expect(higher.fit.maxForceDifference).toBeLessThan(0.6 * r.fit.maxForceDifference);
  });

  it('cable-clearance: a let-off that needs a cable lever arm inside the bore wall', () => {
    const { d } = expectCode(modified((s) => (s.curve.params.letOff = 0.9), { regenerate: true }), 'cable-clearance');
    expect(d.message).toMatch(/lever arm of \d+\.\d mm between .* in and .* in/);
    expect(d.suggestion).toMatch(/^Reduce let-off below \d+ %/);
    // A larger string track also raises the lever arm at the peak and moves
    // the achieved curve further from the target: it is not suggested.
    expect(d.suggestion).not.toMatch(/string track/);
  });

  it('cable-clearance: the computed hub and let-off limits remove the diagnostic', () => {
    // Let-off 80 %: the ideal lever arm falls to 6.3 mm at full draw.
    const s = modified((st) => (st.curve.params.letOff = 0.8), { regenerate: true });
    const { d } = expectCode(s, 'cable-clearance');
    const hub = Number(/** @type {RegExpMatchArray} */ (
      d.suggestion.match(/reduce the axle bore radius plus the minimum wall to at most (\d+\.\d) mm \(now 7\.0 mm\)$/)
    )[1]) / 1e3;
    expect(hub).toBeLessThan(0.0063 - s.cords.cableDiameter / 2);
    const smaller = structuredClone(s);
    smaller.body.minWall = hub - smaller.body.boreDiameter / 2;
    expect(validate(smaller)).toEqual([]);
    expect(codes(solve(smaller, { resolution: 'coarse' }))).not.toContain('cable-clearance');
    const letOff = Number(/** @type {RegExpMatchArray} */ (d.suggestion.match(/^Reduce let-off below (\d+) %/))[1]) / 100;
    const lower = reduce(s, { type: 'setCurveParams', params: { letOff } });
    expect(codes(solve(lower, { resolution: 'coarse' }))).not.toContain('cable-clearance');
  });

  it('returns the string outlines only when no cable track is built, and none for invalid input', () => {
    const r = solve(modified((s) => (s.body.leadInWrap = 150 * DEG)), { resolution: 'coarse' });
    expect(codes(r)).toEqual(['cable-wrap']);
    expect(Object.keys(r.outlines)).toEqual(['stringPitch', 'stringGroove', 'stringFlange']);
    // @ts-expect-error the cable outlines are optional: an access without a check does not typecheck
    expect(() => r.outlines.cablePitch.x).toThrow(TypeError);
    expect(solve(modified((s) => (s.geometry.ata = 0.1))).outlines).toEqual({});
  });

  it('cable-wrap and closing-blend: a lead-in wrap that leaves too little of the turn', () => {
    const wrap = expectCode(modified((s) => (s.body.leadInWrap = 150 * DEG)), 'cable-wrap');
    expect(wrap.d.suggestion).toMatch(/lead-in wrap to at most \d+\.\d°/);
    expect(wrap.r.metrics).toBeNull();
    const blend = expectCode(modified((s) => (s.body.leadInWrap = 120 * DEG)), 'closing-blend');
    expect(blend.d.message).toMatch(/remaining \d+\.\d°/);
    expect(blend.d.suggestion).toMatch(/lead-in wrap to at most \d+\.\d°/);
    // 0.06° of the turn left: the closed track leaves the input domain of
    // support.js, so no candidate closes and no cam is built.
    for (const resolution of /** @type {const} */ (['coarse', 'full'])) {
      const short = expectCode(modified((s) => (s.body.leadInWrap = 137.55 * DEG)), 'closing-blend', { resolution });
      expect(codes(short.r)).toEqual(['closing-blend']);
      expect(short.d.message).toMatch(/leave 0\.1° of the turn to close the cable track; no closing curve fits/);
      expect(short.r.tracks.cablePitch).toBeNull();
      expect(short.r.achieved).toBeNull();
      expect(short.r.metrics).toBeNull();
      expect(Object.keys(short.r.outlines)).toEqual(['stringPitch', 'stringGroove', 'stringFlange']);
      const lead = Number(/** @type {RegExpMatchArray} */ (short.d.suggestion.match(/^Reduce the lead-in wrap to at most (\d+\.\d)°$/))[1]);
      expect(lead).toBe(105);
      const fixed = solve(modified((s) => (s.body.leadInWrap = lead * DEG)), { resolution: 'coarse' });
      expect(fixed.status).toBe('ok');
    }
  });

  it('checks the string wrap and the limb rotation on the final cam, not on the ideal track', () => {
    // Default preset: the ideal full-draw string contact lies 8.96e-5 rad
    // beyond the achieved one. A residual wrap in between wraps the ideal
    // track a full turn, the final cam 359.997°.
    const inside = solve(modified((s) => (s.body.residualWrap = 1.4639550368669456)), { resolution: 'coarse' });
    expect(inside.status).toBe('ok');
    expect(/** @type {any} */ (inside.metrics).stringWrap).toBeLessThan(2 * Math.PI);
    const over = expectCode(modified((s) => (s.body.residualWrap = 1.4641)), 'string-wrap');
    expect(over.d.message).toMatch(/^The string wraps 360\.01° on its track at brace/);
    // A fitted cam that turns the limbs 16.975°, its ideal track 16.983°: a
    // 16.979° limit holds for the cam that is built.
    let s = reduce(defaultState(), { type: 'setCurveParams', params: { peak: 270.7047847708244, letOff: 0.7737568576604859 } });
    s = structuredClone(s);
    Object.assign(s.limb, { stiffness: 2575.683623121904, preloadTravel: 0.17818955784579255, maxRotation: 0.2963370393401076 });
    Object.assign(s.stringTrack, { radius: 0.047027845708200636, offset: 0.023169014773410285, phase: -2.066118159917778 });
    expect(validate(s)).toEqual([]);
    const limb = solve(s, { resolution: 'coarse' });
    expect(limb.fit.used).toBe(true);
    const alpha = /** @type {NonNullable<SolveResult['achieved']>} */ (limb.achieved).alpha;
    expect(alpha[alpha.length - 1]).toBeLessThan(s.limb.maxRotation);
    expect(codes(limb)).not.toContain('limb-rotation');
    // A suggestion trial of the same states reaches the same verdict: it
    // does not stop at the ideal track's rotation or wrap.
    expect(limb.status).toBe('ok');
    expect(trialPasses(s)).toBe(true);
    expect(trialPasses(modified((st) => (st.body.residualWrap = 1.4639550368669456)))).toBe(true);
    expect(trialPasses(modified((st) => (st.body.residualWrap = 1.4641)))).toBe(false);
  });

  it('places the string termination at the residual wrap past the achieved full-draw contact', () => {
    // A fitted cam whose full-draw string contact lies 0.1° before the ideal one.
    const s = reduce(defaultState(), { type: 'setCurveParams', params: { peak: 250, riseFraction: 0.49, valleyWidth: 1.4 * INCH } });
    const r = solve(s);
    expect(r.status).toBe('ok');
    expect(r.fit.used).toBe(true);
    const a = /** @type {NonNullable<SolveResult['achieved']>} */ (r.achieved);
    const string = /** @type {NonNullable<SolveResult['tracks']['string']>} */ (r.tracks.string);
    const psiF = a.psiS[a.psiS.length - 1];
    expect(string.psiFull).toBe(psiF);
    expect(string.psiEnd - psiF).toBeCloseTo(s.body.residualWrap, 12);
    const post = /** @type {import('../../src/core/solve.js').Post} */ (r.posts.find((p) => p.id === 'string-post'));
    expect(post.psi).toBeCloseTo(string.psiEnd, 15);
    const forward = forwardOfResult(s, r, [a.x[0], a.x[a.x.length - 1]]);
    expect(/** @type {any} */ (r.metrics).stringLength).toBeCloseTo(forward.stringLength, 12);
  });

  it('forward model diagnostics of the final cam become solver diagnostics once', () => {
    const fmt = formatter(defaultState().units);
    /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic[]} */
    const diags = [];
    const forward = /** @type {any} */ ({
      n: 2,
      x: [0.2, 0.25],
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
    // A solve that stops after the overlap leaves NaN in the last sample:
    // the solved samples still name the cable.
    /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic[]} */
    const stopped = [];
    forwardDiagnostics({ ...forward, psiS: [0, NaN], stringTermination: 2, psiC: [9.5, NaN], cableTermination: 3, diagnostics: [forward.diagnostics[3]] }, stopped, fmt);
    expect(stopped.map((d) => d.code)).toEqual(['cable-wrap']);
    // A non-finite or concave final cam has no usable force curve.
    for (const code of ['non-finite', 'concave-track']) {
      /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic[]} */
      const lost = [];
      forwardDiagnostics({ ...forward, diagnostics: [{ code, xRange: [0.2, 0.3], message: 'the limb energy overflows' }] }, lost, fmt);
      expect(lost.map((d) => d.code)).toEqual(['no-convergence']);
      expect(lost[0].message).toMatch(/cannot be computed .*: the limb energy overflows$/);
    }
  });

  it('no-convergence: an iteration limit of one Newton step', () => {
    const { r, d } = expectCode(defaultState(), 'no-convergence', { maxIterations: 1 });
    expect(d.message).toMatch(/did not converge at \d+\.\d in/);
    expect(d.xRange?.[1]).toBe(defaultState().curve.points.at(-1)?.x);
    // The string track outlines are still there.
    expect(outline(r, 'stringPitch').x.length).toBe(361);
  });
});

describe('solve: limb travel mode', () => {
  it('builds the limb from the settled draw energy, so the ideal track turns the limb by the requested travel', () => {
    for (const travel of [0.02, 0.05, 0.1]) {
      const s = defaultState();
      s.limb.mode = 'travel';
      s.limb.travel = travel;
      const r = solve(s);
      const alpha = /** @type {NonNullable<SolveResult['ideal']>} */ (r.ideal).alpha;
      // Axle travel of the ideal track at full draw, R_L·α_f.
      expect(Math.abs(/** @type {number} */ (alpha.at(-1)) * s.geometry.limbLength - travel)).toBeLessThan(1e-9);
    }
  });
});

describe('solve: curve end points within the validation tolerance', () => {
  // Validation accepts the first and last point within 1e-9 m of brace and
  // full draw; the solver places them exactly there.
  const exact = solve(defaultState(), { resolution: 'coarse' });
  /** @param {SolveResult} r */
  const withoutTimings = (r) => ({ ...r, timings: null });

  it.each([1e-12, -1e-12, 5e-10, -5e-10, 1e-9, -1e-9])('gives the result of the exact state with point 1 moved by %s m', (d) => {
    const s = modified((st) => (st.curve.points[0].x += d));
    expect(validate(s)).toEqual([]);
    const r = solve(s, { resolution: 'coarse' });
    expect(r.ideal?.pC[0]).toBeGreaterThan(0.04);
    expect(withoutTimings(r)).toEqual(withoutTimings(exact));
  });

  it('gives the result of the exact state with the last point moved by 1e-9 m', () => {
    const s = modified((st) => (/** @type {{ x: number }} */ (st.curve.points.at(-1)).x -= 1e-9));
    expect(validate(s)).toEqual([]);
    expect(withoutTimings(solve(s, { resolution: 'coarse' }))).toEqual(withoutTimings(exact));
  });
});

describe('solve: brace contact of a fitted cam', () => {
  it('places the cable-brace mark and the lead-in at the brace contact of the built cam', () => {
    // A 10 mm wall needs a lever arm of 15.25 mm; point 2 at 60 N gives
    // p_c0 = 8.4 mm, so the fit leaves out p(ψ_c0) = p_c0 and the brace
    // contact of the built cam lies 0.47° after ψ_c0.
    const state = modified((s) => {
      s.body.minWall = 0.01;
      s.curve.mode = 'custom';
      s.curve.points[1].F = 60;
    });
    const r = solve(state);
    const a = /** @type {NonNullable<SolveResult['achieved']>} */ (r.achieved);
    const ideal = /** @type {NonNullable<SolveResult['ideal']>} */ (r.ideal);
    expect((a.psiC[0] - ideal.psiC[0]) / DEG).toBeGreaterThan(0.4);
    const mark = /** @type {import('../../src/core/outline.js').Mark} */ (r.marks.find((m) => m.id === 'cable-brace'));
    expect(mark.psi).toBe(a.psiC[0]);
    // The cable line from the mark runs to the anchor.
    const bow = /** @type {import('../../src/core/geometry.js').BowGeometry} */ (
      bowGeometry(state.geometry, createSupport(/** @type {any} */ (r.tracks.stringPitch))).bow
    );
    const O0 = axle(bow, 0);
    const Xc = camToWorld(O0, 0, mark);
    const tc = { x: -Math.sin(mark.psi), y: Math.cos(mark.psi) };
    expect(Math.abs((O0.x - Xc.x) * tc.y - (-O0.y - Xc.y) * tc.x)).toBeLessThan(1e-9);
    // The lead-in wraps the input angle beyond that contact.
    const cable = /** @type {NonNullable<SolveResult['tracks']['cable']>} */ (r.tracks.cable);
    expect(Math.abs(cable.psiBrace - a.psiC[0])).toBeLessThan(1e-9);
    expect(cable.psiStart).toBeCloseTo(cable.psiBrace - state.body.leadInWrap, 12);
    expect(r.posts.find((p) => p.id === 'cable-post')?.psi).toBe(cable.psiStart);
  });
});

describe('solve: ideal cable track without the fit', () => {
  // Curve points from the forward model of a known cam: default geometry,
  // string groove of radius 47.7 mm with 0.25 mm offset towards −16°, limb
  // 12.45 N/mm with 190 mm preload travel, cable pitch circle of radius
  // 13.5 mm with 0.9 mm offset towards −128°; seven points evenly spaced
  // from brace to full draw. The ideal track through them keeps ρ ≥ 9.8 mm
  // and clears the bore, so the solver builds it directly: the brace blend
  // on [ψ_c0, ψ_1] and the spline through the resampled track.
  const state = modified((s) => {
    s.curve.mode = 'custom';
    Object.assign(s.stringTrack, { shape: 'eccentric', radius: 0.0477, offset: 0.00025, phase: -16 * DEG });
    Object.assign(s.limb, { mode: 'stiffness', stiffness: 12.45e3, preloadTravel: 0.19 });
  });
  const { xBrace, xFull } = drawRange(state.geometry.braceHeight, state.geometry.drawLength);
  const xs = Array.from({ length: 7 }, (_, i) => xBrace + ((xFull - xBrace) * i) / 6);
  const known = solveForward({
    geometry: state.geometry,
    stringTrack: stringTrackSupport(state.stringTrack, state.cords.stringDiameter),
    cableTrack: eccentricCircle({ radius: 0.0135, offset: 0.0009, phase: -128 * DEG }),
    limb: /** @type {LimbData} */ (limbFromState(state.limb, state.geometry.limbLength).limb),
    x: xs,
  });
  state.curve.points = xs.map((x, i) => ({ x, F: i === 0 ? 0 : known.F[i] }));

  /** @type {['full' | 'coarse', number, number][]} */
  const cases = [['full', 1e-6, 1e-12], ['coarse', 5e-6, 2e-10]];
  it.each(cases)('%s resolution: the achieved curve equals the target from point 2 on', (resolution, tolerance, angleTolerance) => {
    expect(known.status).toBe('ok');
    expect(validate(state)).toEqual([]);
    const r = solve(state, { resolution });
    expect(r.diagnostics).toEqual([]);
    expect(r.fit.used).toBe(false);
    expect(r.fit.reason).toBe('');
    const ideal = /** @type {NonNullable<SolveResult['ideal']>} */ (r.ideal);
    const i1 = ideal.x.indexOf(xs[1]);
    // The brace blend runs from ψ_c0 to the ideal contact at point 2.
    expect(r.brace?.blendStartPsi).toBe(ideal.psiC[0]);
    expect(r.brace?.blendEndPsi).toBe(ideal.psiC[i1]);
    expect(r.brace?.blendEndX).toBe(xs[1]);
    const a = /** @type {NonNullable<SolveResult['achieved']>} */ (r.achieved);
    const t = /** @type {NonNullable<SolveResult['target']>} */ (r.target);
    let after = 0;
    let before = 0;
    for (let i = 0; i < a.x.length; i++) {
      const d = Math.abs(a.F[i] - t.F[i]);
      if (a.x[i] >= xs[1]) after = Math.max(after, d);
      else before = Math.max(before, d);
    }
    console.info(`ideal track (${resolution}): achieved within ${after.toExponential(2)} N of the target from point 2 on, ${before.toFixed(3)} N before`);
    expect(after).toBeLessThan(tolerance);
    // The forward model of the built cam reaches the state of the inverse
    // model (θ, α) and the target force at every curve point, and keeps the
    // brace slope.
    const f = forwardOfResult(state, r, xs);
    for (let k = 1; k < xs.length; k++) {
      const j = ideal.x.indexOf(xs[k]);
      expect(Math.abs(f.F[k] - state.curve.points[k].F)).toBeLessThan(tolerance);
      expect(Math.abs(f.alpha[k] - ideal.alpha[j])).toBeLessThan(angleTolerance);
      expect(Math.abs(f.theta[k] - ideal.theta[j])).toBeLessThan(angleTolerance);
    }
    const forwardBrace = /** @type {import('../../src/core/forward.js').BraceState} */ (f.brace);
    expect(Math.abs(forwardBrace.slope / /** @type {SolveBrace} */ (r.brace).slope - 1)).toBeLessThan(1e-9);
  });
});

describe('solve: fit through the curve points', () => {
  it('reaches the target state at the curve points the winning fit passes through', () => {
    // Limb 3.5 N/mm, let-off 65 %, rise 50 %: the candidate through the
    // curve points wins and matches the last four points. The forward model
    // of the built cam gives the target force and the inverse state (θ, α)
    // there, and differs from the target at points 2 and 3.
    const state = modified((s) => {
      s.limb.stiffness = 3.5e3;
      s.curve.params.letOff = 0.65;
      s.curve.params.riseFraction = 0.5;
    }, { regenerate: true });
    const r = solve(state);
    expect(r.status).toBe('ok');
    expect(r.fit.used).toBe(true);
    expect(r.fit.pointsMatched).toBe(4);
    const ideal = /** @type {NonNullable<SolveResult['ideal']>} */ (r.ideal);
    const pts = state.curve.points;
    const f = forwardOfResult(state, r, pts.map((q) => q.x));
    let worst = 0;
    const matched = [];
    for (let k = 1; k < pts.length; k++) {
      const j = ideal.x.indexOf(pts[k].x);
      const dF = Math.abs(f.F[k] - pts[k].F);
      const dAngle = Math.max(Math.abs(f.alpha[k] - ideal.alpha[j]), Math.abs(f.theta[k] - ideal.theta[j]));
      if (dF < 1e-9 && dAngle < 1e-12) {
        matched.push(k + 1);
        worst = Math.max(worst, dF);
      } else {
        expect(dF).toBeGreaterThan(1e-3);
      }
    }
    console.info(`fit through the curve points: points ${matched.join(', ')} within ${worst.toExponential(2)} N`);
    expect(matched).toEqual([4, 5, 6, 7]);
  });
});

describe('solve: lead-in and closing blend', () => {
  it('solves with a lead-in wrap of 0, with the cable post at the brace contact', () => {
    const r = solve(modified((s) => (s.body.leadInWrap = 0)), { resolution: 'coarse' });
    expect(r.diagnostics).toEqual([]);
    expect(r.status).toBe('ok');
    const cable = /** @type {NonNullable<SolveResult['tracks']['cable']>} */ (r.tracks.cable);
    expect(cable.psiStart).toBe(cable.psiBrace);
    expect(r.posts.find((p) => p.id === 'cable-post')?.psi).toBe(cable.psiBrace);
  });

  // The tests of the closing-blend trials run up to five trial solves per
  // full solve, and solve the trial states again; the coverage run slows
  // them about 4 times.
  const TRIALS_TIMEOUT = 30_000;

  it('closing-blend: a 20 mm bend radius with a lead-in of 5° or 10° is reported with the other diagnostics', () => {
    for (const lead of [5, 10]) {
      const s = modified((st) => {
        st.body.minBendRadius = 0.02;
        st.body.leadInWrap = lead * DEG;
      });
      const r = solve(s);
      expect(codes(r)).toEqual(['closing-blend', 'cable-radius', 'cable-clearance']);
      const d = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === 'closing-blend'));
      // No larger string track passes; half the bend radius does.
      expect(d.suggestion).toBe('Reduce the minimum bend radius to 10.0 mm; the cam then closes the track and passes every check');
      if (lead === 10) continue;
      for (const dr of STRING_TRACK_TRIALS) {
        expect(solve(/** @type {ProjectState} */ (largerStringTrack(s, dr)), { resolution: 'coarse' }).status).toBe('infeasible');
      }
      const fixed = structuredClone(s);
      fixed.body.minBendRadius = 0.01;
      expect(solve(fixed).status).toBe('ok');
    }
  }, TRIALS_TIMEOUT);

  /**
   * Default state with point 2 at a draw length (in) and force (N).
   * @param {number} inches
   * @param {number} F
   * @param {(s: ProjectState) => void} [change]
   */
  const pointTwo = (inches, F, change = () => {}) => modified((s) => {
    s.curve.mode = 'custom';
    s.curve.points[1] = { x: inches * INCH - AMO_OFFSET, F };
    change(s);
  });

  it('closing-blend: names the smallest larger string track with which a trial solve passes every check', () => {
    // Point 2 at 12 in with 120 N: 50 mm fails, 55 mm passes. Only the full
    // solve runs the trials; the coarse solve, which runs while an input is
    // dragged, keeps the plain suggestion.
    const s = pointTwo(12, 120);
    const r = solve(s);
    expect(codes(r)).toEqual(['closing-blend']);
    expect(r.diagnostics[0].suggestion).toBe('Increase the string track radius to 55.0 mm; the cam then closes the track and passes every check');
    expect(r.timings.trials).toBeGreaterThan(0);
    const coarse = solve(s, { resolution: 'coarse' });
    expect(codes(coarse)).toEqual(['closing-blend']);
    expect(coarse.diagnostics[0].suggestion).toBe('Change the force curve');
    expect(coarse.timings.trials).toBe(0);
    for (const [radius, status] of /** @type {const} */ ([[0.05, 'infeasible'], [0.055, 'ok']])) {
      const t = structuredClone(s);
      t.stringTrack.radius = radius;
      expect(solve(t).status).toBe(status);
    }
    // An elliptical string track grows on both semi-axes: 45 mm × 35 mm with
    // point 2 at 11 in and 100 N.
    const e = pointTwo(11, 100, (st) => {
      st.stringTrack = { ...st.stringTrack, shape: 'ellipse', semiMajor: 0.045, semiMinor: 0.035, offset: 0.015, phase: -1.8 };
    });
    const re = solve(e);
    expect(codes(re)).toContain('closing-blend');
    expect(re.diagnostics[0].suggestion).toBe(
      'Increase both semi-axes of the string track by 15.0 mm, to 60.0 mm and 50.0 mm; the cam then closes the track and passes every check',
    );
    const grown = /** @type {ProjectState} */ (largerStringTrack(e, 0.015));
    expect(grown.stringTrack).toMatchObject({ semiMajor: 0.06, semiMinor: 0.05, offset: 0.015 });
    expect(e.stringTrack.semiMajor).toBe(0.045);
    expect(solve(grown).status).toBe('ok');
    expect(solve(/** @type {ProjectState} */ (largerStringTrack(e, 0.01)), { resolution: 'coarse' }).status).toBe('infeasible');
  }, TRIALS_TIMEOUT);

  it('closing-blend: lists the changes tried when none passes every check', () => {
    // Point 2 at 10 in with 50 N: every larger string track adds cable-radius.
    const s = pointTwo(10, 50);
    const r = solve(s);
    expect(codes(r)).toEqual(['closing-blend']);
    expect(r.diagnostics[0].suggestion).toBe(
      'Change the force curve: a lead-in wrap down to 0°, a string track radius up to 20.0 mm larger and a minimum bend radius of 2.5 mm ' +
        'do not give a closed track that passes every check',
    );
    expect(r.timings.trials).toBeGreaterThan(0);
    // The trials are coarse solves, compared here with the coarse solve of
    // the state, which runs no trials of its own.
    const coarse = solve(s, { resolution: 'coarse' });
    expect(coarse.timings.trials).toBe(0);
    expect(coarse.diagnostics[0].suggestion).toBe('Change the force curve');
    for (const dr of STRING_TRACK_TRIALS) {
      const t = solve(/** @type {ProjectState} */ (largerStringTrack(s, dr)), { resolution: 'coarse' });
      expect(t.status).toBe('infeasible');
      expect(t.fit.maxForceDifference).toBeGreaterThan(coarse.fit.maxForceDifference);
    }
  }, TRIALS_TIMEOUT);

  it('closing-blend: tries only string tracks within the field range, and the bend radius only when it sets a limit that the blend misses', () => {
    const fmt = formatter(defaultState().units);
    expect(largerStringTrack(modified((st) => (st.stringTrack.radius = 0.096)), 0.005)).toBeNull();
    expect(largerStringTrack(modified((st) => {
      st.stringTrack = { ...st.stringTrack, shape: 'ellipse', semiMajor: 0.099, semiMinor: 0.05 };
    }), 0.005)).toBeNull();
    /** @type {ProjectState[]} */
    const tried = [];
    const fails = (/** @type {ProjectState} */ st) => {
      tried.push(st);
      return false;
    };
    // Radius 90 mm: 95 mm and 100 mm are tried, then a bend radius of 2.5 mm.
    const s = modified((st) => (st.stringTrack.radius = 0.09));
    expect(changeSuggestion(s, true, fmt, fails)).toBe(
      'Change the force curve: a lead-in wrap down to 0°, a string track radius up to 10.0 mm larger and a minimum bend radius of 2.5 mm ' +
        'do not give a closed track that passes every check',
    );
    const want = [[0.095, 0.005], [0.1, 0.005], [0.09, 0.0025]];
    expect(tried.length).toBe(want.length);
    tried.forEach((st, k) => {
      expect(st.stringTrack.radius).toBeCloseTo(want[k][0], 15);
      expect(st.body.minBendRadius).toBeCloseTo(want[k][1], 15);
    });
    // Nothing to try: no lead-in wrap, the radius at its maximum, a blend
    // that comes too close to the axle instead of bending too sharply.
    tried.length = 0;
    const none = modified((st) => {
      st.stringTrack.radius = 0.1;
      st.body.leadInWrap = 0;
    });
    expect(changeSuggestion(none, false, fmt, fails)).toBe('Change the force curve');
    expect(tried).toEqual([]);
    // The bend radius is not tried when the cable radius plus the groove
    // margin sets the limit; the trial stops at the first change that passes.
    const groove = modified((st) => (st.body.minBendRadius = st.cords.cableDiameter / 2 + GROOVE_MARGIN));
    expect(changeSuggestion(groove, true, fmt, (st) => st.stringTrack.radius > 0.055)).toBe(
      'Increase the string track radius to 60.0 mm; the cam then closes the track and passes every check',
    );
    expect(changeSuggestion(s, true, fmt, (st) => st.body.minBendRadius < 0.005)).toBe(
      'Reduce the minimum bend radius to 2.5 mm; the cam then closes the track and passes every check',
    );
  });

  it('tries the lead-in wraps k·5° below the input, down to exactly 0°', () => {
    expect(leadInTrials(0)).toEqual([]);
    expect(leadInTrials(5 * DEG)).toEqual([0]);
    expect(leadInTrials(32 * DEG)).toEqual([6, 5, 4, 3, 2, 1, 0].map((k) => k * 5 * DEG));
    for (const deg of [10, 15, 30, 45, 60, 90, 180]) {
      const trials = leadInTrials(deg * DEG);
      expect(trials.length).toBe(deg / 5);
      expect(trials[0]).toBe((deg / 5 - 1) * 5 * DEG);
      expect(trials.at(-1)).toBe(0);
    }
  });

  it('keeps the cam compact when the fit flattens the brace region: rise 40 % at let-off 75 % and 65 %', () => {
    for (const letOff of [0.75, 0.65]) {
      const r = solve(modified((s) => {
        s.curve.params.riseFraction = 0.4;
        s.curve.params.letOff = letOff;
      }, { regenerate: true }));
      expect(codes(r)).not.toContain('closing-blend');
      const m = /** @type {import('../../src/core/solve.js').SolveMetrics} */ (r.metrics);
      const cable = /** @type {NonNullable<SolveResult['tracks']['cable']>} */ (r.tracks.cable);
      const pitch = createSupport(/** @type {any} */ (r.tracks.cablePitch));
      // The fitted track has ρ ≈ 390 mm at brace; the lead-in settles to p(ψ_c0) ≈ 50 mm.
      expect(pitch.rho(cable.psiBrace)).toBeGreaterThan(0.3);
      expect(cable.leadInRho).toBeCloseTo(pitch.p(cable.psiBrace), 12);
      console.info(`rise 40 %, let-off ${letOff * 100} %: cam ${(m.camMaxDimension * 1e3).toFixed(1)} mm, lead-in ρ_0 ${(cable.leadInRho * 1e3).toFixed(1)} mm`);
      expect(m.camMaxDimension).toBeLessThan(0.12);
      expect(m.stringMinRho).toBeGreaterThanOrEqual(m.stringRhoLimit - 1e-5);
      expect(m.cableMinRho).toBeGreaterThanOrEqual(m.cableRhoLimit - 1e-5);
    }
  });
});

describe('solve: robustness', () => {
  // 0.9 s alone, 3 s to 5 s in the coverage run and 7 s to 10 s when other
  // processes load every core: the time limit is 30 s.
  it('reports an iteration limit outside 1 to 200 as invalid input before solving', () => {
    for (const maxIterations of [0, 201, 1.5, null, '30']) {
      const r = solve(defaultState(), /** @type {any} */ ({ resolution: 'coarse', maxIterations }));
      expect(codes(r)).toEqual(['invalid-input']);
      expect(r.diagnostics[0].message).toMatch(/iteration limit .* is not an integer from 1 to 200$/);
      expect(r.target).toBeNull();
    }
    expect(solve(defaultState(), { resolution: 'coarse', maxIterations: 200 }).status).toBe('ok');
  });

  it('describes a closing failure by the closed track, which decides it', () => {
    // A 125° lead-in on the default: the re-interpolated closed track bends
    // the wrong way; the message names that radius, not the blend piece's.
    const r = solve(modified((s) => (s.body.leadInWrap = 125 * DEG)), { resolution: 'coarse' });
    const d = /** @type {import('../../src/core/diagnostics.js').SolveDiagnostic} */ (r.diagnostics.find((q) => q.code === 'closing-blend'));
    expect(d.message).toMatch(/with a radius of curvature of at least \d+\.\d mm: the closed track bends the wrong way, to a radius of curvature of -\d+\.\d mm$/);
  });

  it('takes a missing or non-object options container as the defaults', () => {
    const coarse = solve(defaultState(), { resolution: 'coarse' });
    for (const options of [null, 5, 'coarse']) {
      const r = solve(defaultState(), /** @type {any} */ (options));
      expect(r.status).toBe('ok');
      expect(r.resolution).toBe('full');
    }
    expect(coarse.resolution).toBe('coarse');
  });

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
          // A solve without diagnostics has built the cam.
          if (r.status === 'ok') {
            expect(r.tracks.cablePitch).not.toBeNull();
            expect(r.achieved).not.toBeNull();
            expect(r.metrics).not.toBeNull();
          }
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
  }, 30_000);

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
    // Upper limits round down, so the shown value keeps the limit.
    expect(fmt.forceAtMost(62.99)).toBe('62 N');
    expect(fmt.sizeAtMost(0.00489)).toBe('4.8 mm');
    expect(fmt.sizeAtMost(0.0048)).toBe('4.8 mm');
    expect(metric.sizeAtMost(0.1239 * INCH)).toBe('0.123 in');
    expect(metric.forceAtMost(10.9 * 4.4482216152605)).toBe('10 lbf');
  });
});
