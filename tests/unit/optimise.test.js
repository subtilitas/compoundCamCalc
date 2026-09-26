import { describe, expect, it } from 'vitest';
import { knotAngles, pitchMinRho, sampleTrack } from '../../src/core/freeform.js';
import {
  GOALS, IMPROVEMENT, OPTIMISE_BUDGET, RHO_MARGIN, STEP_MIN, WRAP_LIMIT, evaluate, limitsFor, meetsLimits, objectiveOf,
  optimise, prescreen, searchModes, startValues, withValues,
} from '../../src/core/optimise.js';
import { solve } from '../../src/core/solve.js';
import { defaultState } from '../../src/state/presets.js';
import { sampleState } from '../../src/state/samples.js';

/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../../src/core/optimise.js').Evaluation} Evaluation */

const MM = 1e-3;
const DEG = Math.PI / 180;

/**
 * Solve result with the figures the optimiser reads, and empty everything
 * else.
 * @param {object} f
 * @param {number} f.cam largest cam dimension (m)
 * @param {number} f.force largest force difference (N)
 * @param {number} f.rho smallest pitch-line radius of curvature (m)
 * @param {'coarse' | 'full'} f.resolution
 * @param {number} [f.wrap] string and cable wrap (rad)
 * @param {boolean | string[]} [f.warn] add a plausibility warning
 *   (true: ata-ratio), or the warnings of these codes
 * @param {'ok' | 'infeasible'} [f.status] infeasible adds a diagnostic
 * @returns {SolveResult}
 */
function fakeResult({ cam, force, rho, resolution, wrap = 300 * DEG, warn = false, status = 'ok' }) {
  const x = Float64Array.from([0, 0.1, 0.2]);
  const codes = warn === true ? ['ata-ratio'] : warn === false ? [] : warn;
  return /** @type {SolveResult} */ (/** @type {unknown} */ ({
    status,
    diagnostics: status === 'ok' ? [] : [{ code: 'string-radius', message: 'fake' }],
    warnings: codes.map((code) => ({ code, message: 'fake' })),
    resolution,
    target: { x, F: Float64Array.from([0, 100, 20]) },
    achieved: { x, F: Float64Array.from([0, 100, 20]) },
    fit: { used: true, maxForceDifference: force },
    metrics: {
      camMaxDimension: cam, letOff: 0.8, stringMinRho: rho, stringRhoLimit: 5 * MM, stringWrap: wrap, cableWrap: wrap,
    },
  }));
}

/** Target shape of the synthetic objective: 40 mm + 5 mm·cos 2ψ at 12 points (m). */
const TARGET = knotAngles(12).map((psi) => 40 * MM + 5 * MM * Math.cos(2 * psi));

/**
 * Squared distance of the values from TARGET (m²).
 * @param {readonly number[]} values
 */
const distance = (values) => values.reduce((a, v, i) => a + (v - TARGET[i]) ** 2, 0);

/**
 * The default state with a free-form track of the given values.
 * @param {number[]} values
 * @returns {ProjectState}
 */
function withTrack(values) {
  return withValues(defaultState(), values);
}

/**
 * A solve stand-in: the cam size is 0.05 m plus 10·distance from TARGET,
 * the force difference 1 N, the radius of curvature that of the spline.
 * Records every call.
 * @param {(values: number[], resolution: 'coarse' | 'full') => Partial<Parameters<typeof fakeResult>[0]>} [change]
 */
function syntheticSolve(change = () => ({})) {
  /** @type {{ values: number[], resolution: 'coarse' | 'full' }[]} */
  const calls = [];
  /** @type {import('../../src/core/optimise.js').SolveFn} */
  const fn = (state, { resolution }) => {
    const values = state.stringTrack.freeform.values;
    calls.push({ values: [...values], resolution });
    const rho = pitchMinRho(values, state.cords.stringDiameter).value;
    return fakeResult({ cam: 0.05 + 10 * distance(values), force: 1, rho, resolution, ...change(values, resolution) });
  };
  return { fn, calls };
}

/** Start of the synthetic runs: 45 mm + 2 mm·cos 2ψ + 1 mm·sin 3ψ. */
const START = knotAngles(12).map((psi) => 45 * MM + 2 * MM * Math.cos(2 * psi) + 1 * MM * Math.sin(3 * psi));

describe('optimise helpers', () => {
  it('offers exactly the two goals', () => {
    expect(Object.values(GOALS)).toEqual([
      'Smallest cam, force curve no worse than now',
      'Closest force curve, cam no larger than now',
    ]);
    expect(OPTIMISE_BUDGET).toBe(600);
  });

  it('searches the constant and cos kψ, sin kψ modes up to k = 4 first, and up to N/2 later', () => {
    expect(searchModes(12, false).map((m) => m.id)).toEqual(['c0', 'c1', 's1', 'c2', 's2', 'c3', 's3', 'c4', 's4']);
    // sin 6ψ is zero at every knot of 12 points.
    expect(searchModes(12, true).map((m) => m.id).slice(9)).toEqual(['c5', 's5', 'c6']);
    expect(searchModes(8, false).map((m) => m.id)).toEqual(['c0', 'c1', 's1', 'c2', 's2', 'c3', 's3', 'c4']);
    expect(searchModes(16, true)).toHaveLength(16);
    // Mode k is scaled by 1/max(1, k² − 1): the step changes ρ about equally.
    const modes = searchModes(12, true);
    const c3 = /** @type {import('../../src/core/optimise.js').Mode} */ (modes.find((m) => m.id === 'c3'));
    expect(c3.vector[0]).toBeCloseTo(1 / 8, 12);
    expect(modes[0].vector.every((v) => v === 1)).toBe(true);
  });

  it('reads the figures of a solve, with the force difference from the curves when the cam is not fitted', () => {
    const r = fakeResult({ cam: 0.09, force: 3, rho: 0.04, resolution: 'full' });
    const e = evaluate(r);
    expect(e).toMatchObject({ ok: true, warnings: [], camSize: 0.09, forceDifference: 3, letOff: 0.8, stringMinRho: 0.04 });
    // The tolerance is 3 % of the peak, at least 2 N.
    expect(e.tolerance).toBe(3);
    const exact = /** @type {SolveResult} */ ({
      ...r,
      fit: { ...r.fit, used: false, maxForceDifference: NaN },
      achieved: /** @type {any} */ ({ x: r.target?.x, F: Float64Array.from([0, 98.5, 21]) }),
      target: /** @type {any} */ ({ x: r.target?.x, F: Float64Array.from([0, 50, 20]) }),
    });
    expect(evaluate(exact).forceDifference).toBeCloseTo(48.5, 12);
    expect(evaluate(exact).tolerance).toBe(2);
    // A plausibility warning keeps the design ok; the limits compare its codes.
    expect(evaluate(fakeResult({ cam: 0.09, force: 3, rho: 0.04, resolution: 'full', warn: ['cam-size'] })))
      .toMatchObject({ ok: true, warnings: ['cam-size'] });
    expect(evaluate({ ...r, status: 'infeasible' }).ok).toBe(false);
    expect(evaluate({ ...r, metrics: null }).camSize).toBeNaN();
  });

  it('sets the limits with margins: ρ limit + max(1 mm, 10 %), force and cam no worse than the start', () => {
    const e = evaluate(fakeResult({ cam: 0.09, force: 1, rho: 0.04, resolution: 'full' }));
    const cam = limitsFor('cam', e);
    expect(cam.rho).toBeCloseTo(6 * MM, 12);
    expect(cam.force).toBe(1);
    // A start inside the margin keeps at least its own bend, not less than the limit.
    expect(limitsFor('cam', { ...e, stringMinRho: 5.4 * MM }).rho).toBeCloseTo(5.4 * MM, 12);
    expect(limitsFor('cam', { ...e, stringMinRho: 4 * MM }).rho).toBeCloseTo(5 * MM, 12);
    expect(cam.cam).toBe(Infinity);
    const force = limitsFor('force', { ...e, stringRhoLimit: 15 * MM, forceDifference: 5 });
    expect(force.rho).toBeCloseTo(16.5 * MM, 12);
    expect(force.force).toBe(Infinity);
    expect(force.cam).toBe(0.09);
    expect(limitsFor('cam', { ...e, forceDifference: 5 }).force).toBe(5);
    expect(limitsFor('cam', { ...e, warnings: ['cam-size'] }).warnings).toEqual(['cam-size']);
    expect(RHO_MARGIN).toEqual({ min: 1e-3, share: 0.1 });
  });

  it('keeps a candidate only within every limit', () => {
    const e = evaluate(fakeResult({ cam: 0.09, force: 2, rho: 0.04, resolution: 'full' }));
    const limits = { rho: 6 * MM, force: 2.4, cam: 0.09, warnings: ['cam-size'] };
    expect(meetsLimits(e, limits)).toBe(true);
    expect(meetsLimits({ ...e, stringMinRho: 5.9 * MM }, limits)).toBe(false);
    expect(meetsLimits({ ...e, stringWrap: WRAP_LIMIT + 1e-6 }, limits)).toBe(false);
    expect(meetsLimits({ ...e, cableWrap: WRAP_LIMIT + 1e-6 }, limits)).toBe(false);
    expect(meetsLimits({ ...e, forceDifference: 2.5 }, limits)).toBe(false);
    expect(meetsLimits({ ...e, camSize: 0.0901 }, limits)).toBe(false);
    expect(meetsLimits({ ...e, ok: false }, limits)).toBe(false);
    // A warning the current design has too is allowed; a new one is not.
    expect(meetsLimits({ ...e, warnings: ['cam-size'] }, limits)).toBe(true);
    expect(meetsLimits({ ...e, warnings: ['cam-overlap'] }, limits)).toBe(false);
    expect(meetsLimits({ ...e, warnings: ['cam-size'] }, { ...limits, warnings: [] })).toBe(false);
    expect(WRAP_LIMIT).toBeCloseTo(350 * DEG, 12);
    expect(objectiveOf('cam', e)).toBe(0.09);
    expect(objectiveOf('force', e)).toBe(2);
  });

  it('prescreens the value range, the pitch-line radius of curvature and the bore clearance on the spline', () => {
    const d = 3 * MM;
    const round = new Array(12).fill(20 * MM);
    expect(prescreen(round, { rho: 21 * MM, d, wall: 7 * MM })).toBe(true);
    expect(prescreen(round, { rho: 21.6 * MM, d, wall: 7 * MM })).toBe(false);
    expect(prescreen(round, { rho: 5 * MM, d, wall: 20.1 * MM })).toBe(false);
    expect(prescreen([...round.slice(1), 1 * MM], { rho: -1, d, wall: 0 })).toBe(false);
  });

  it('starts from the free-form values, or the analytic track sampled at 12 to 16 points', () => {
    const s = defaultState();
    expect(startValues(s)).toEqual(sampleTrack(s.stringTrack, 12));
    // A strongly elliptical track takes 16 points.
    const ellipse = { ...s, stringTrack: { ...s.stringTrack, shape: /** @type {const} */ ('ellipse'), semiMajor: 0.06, semiMinor: 0.025, offset: 0, phase: 0 } };
    expect(startValues(ellipse)).toEqual(sampleTrack(ellipse.stringTrack, 16));
    // The outcome says how the search sampled the start.
    const out = optimise({ state: ellipse, goal: 'cam', solve: syntheticSolve().fn, budget: 1 });
    expect(out.sampled).toMatchObject({ points: 16, within: false });
    expect(optimise({ state: withTrack([...START]), goal: 'cam', solve: syntheticSolve().fn, budget: 1 }).sampled).toBeNull();
    const f = withTrack([...START]);
    expect(startValues(f)).toEqual(START);
    expect(startValues(f)).not.toBe(f.stringTrack.freeform.values);
  });
});

describe('optimise search', () => {
  it('finds the minimum of a synthetic objective and ends when the step is below 0.05 mm', () => {
    const { fn, calls } = syntheticSolve();
    /** @type {number[]} */
    const improvements = [];
    /** @type {number[]} */
    const halvings = [];
    const out = optimise({
      state: withTrack([...START]),
      goal: 'cam',
      solve: fn,
      onImprove: (i) => improvements.push(i.objective),
      onProgress: (p) => halvings.push(p.halvings),
    });
    expect(out.reason).toBe('converged');
    const best = /** @type {NonNullable<typeof out.best>} */ (out.best);
    expect(best).not.toBeNull();
    // Every value within 0.1 mm of the minimum; the start was 5 mm off.
    const worst = Math.max(...best.values.map((v, i) => Math.abs(v - TARGET[i])));
    expect(worst).toBeLessThan(0.1 * MM);
    // Each confirmed improvement is better than the last by more than IMPROVEMENT.
    for (let i = 1; i < improvements.length; i++) expect(improvements[i]).toBeLessThan(improvements[i - 1] - IMPROVEMENT);
    expect(best.objective).toBe(improvements.at(-1));
    expect(out.solves).toBeLessThanOrEqual(OPTIMISE_BUDGET);
    // Two solves of the current design, then a coarse solve per candidate
    // and a full one per improvement.
    expect(calls.length).toBe(out.solves + 2);
    expect(calls.filter((c) => c.resolution === 'full').length).toBe(improvements.length + 1);
    // Halvings are counted from the first step, 5 % of the mean value.
    expect(Math.max(...halvings)).toBeGreaterThanOrEqual(Math.log2((0.05 * 45 * MM) / STEP_MIN) - 1e-9);
    // Every value is rounded to 0.1 µm.
    for (const v of best.values) expect(Math.abs(v * 1e7 - Math.round(v * 1e7))).toBeLessThan(1e-6);
  });

  it('is deterministic and solves each set of values once per resolution', () => {
    const a = syntheticSolve();
    const b = syntheticSolve();
    const first = optimise({ state: withTrack([...START]), goal: 'force', solve: a.fn });
    const second = optimise({ state: withTrack([...START]), goal: 'force', solve: b.fn });
    expect(second.best?.values).toEqual(first.best?.values);
    expect(b.calls).toEqual(a.calls);
    const keys = a.calls.slice(1).map((c) => `${c.resolution}:${c.values.join(',')}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never solves a candidate the prescreen rejects', () => {
    // The objective pulls the track towards a sharp triangle; the pitch
    // line must keep ρ_lim + 1 mm = 6 mm.
    const sharp = knotAngles(12).map((psi) => 30 * MM + 4 * MM * Math.cos(3 * psi));
    const { fn, calls } = syntheticSolve((values) => ({
      cam: values.reduce((a, v, i) => a + (v - sharp[i]) ** 2, 0),
    }));
    const s = withTrack(knotAngles(12).map(() => 30 * MM));
    const out = optimise({ state: s, goal: 'cam', solve: fn });
    expect(out.best).not.toBeNull();
    for (const c of calls.slice(2)) {
      expect(pitchMinRho(c.values, s.cords.stringDiameter).value).toBeGreaterThanOrEqual(6 * MM - 1e-12);
    }
  });

  it('rejects candidates with a warning, a wrap above 350° or a force difference above the limit', () => {
    // Moving towards the target would warn below a mean of 43 mm, wrap
    // beyond 350° when the sin 3ψ term is gone, and fail the force limit
    // for a cos 2ψ amplitude above 3 mm.
    const psi = knotAngles(12);
    const mean = (/** @type {number[]} */ v) => v.reduce((a, x) => a + x, 0) / v.length;
    const amp = (/** @type {number[]} */ v, /** @type {(p: number) => number} */ f) => (2 / v.length) * v.reduce((a, x, i) => a + x * f(psi[i]), 0);
    const { fn } = syntheticSolve((values) => ({
      warn: mean(values) < 43 * MM,
      wrap: Math.abs(amp(values, (p) => Math.sin(3 * p))) < 0.5 * MM ? 355 * DEG : 300 * DEG,
      force: amp(values, (p) => Math.cos(2 * p)) > 3 * MM ? 2.5 : 1,
    }));
    const out = optimise({ state: withTrack([...START]), goal: 'cam', solve: fn });
    const best = /** @type {NonNullable<typeof out.best>} */ (out.best);
    expect(best).not.toBeNull();
    expect(best.objective).toBeLessThan(out.start.camSize);
    expect(mean(best.values)).toBeGreaterThanOrEqual(43 * MM);
    expect(Math.abs(amp(best.values, (p) => Math.sin(3 * p)))).toBeGreaterThanOrEqual(0.5 * MM);
    expect(amp(best.values, (p) => Math.cos(2 * p))).toBeLessThanOrEqual(3 * MM);
    expect(meetsLimits(best.evaluation, limitsFor('cam', out.start))).toBe(true);
  });

  it('keeps the cam no larger than now for the force goal', () => {
    // The force difference falls towards TARGET; the cam grows with the mean value.
    const mean = (/** @type {number[]} */ v) => v.reduce((a, x) => a + x, 0) / v.length;
    const { fn } = syntheticSolve((values) => ({ force: 1e6 * distance(values), cam: 2 * mean(values) }));
    const start = knotAngles(12).map((psi) => 38 * MM + 3 * MM * Math.cos(2 * psi) + 1 * MM * Math.sin(3 * psi));
    const out = optimise({ state: withTrack(start), goal: 'force', solve: fn });
    const best = /** @type {NonNullable<typeof out.best>} */ (out.best);
    expect(best.evaluation.forceDifference).toBeLessThan(out.start.forceDifference);
    expect(best.evaluation.camSize).toBeLessThanOrEqual(out.start.camSize);
    // The mean stays at 38 mm, below the 40 mm of the target.
    expect(mean(best.values)).toBeLessThanOrEqual(38 * MM + 1e-9);
    // Only a larger mean would improve this start: no better track.
    const blocked = optimise({ state: withTrack(knotAngles(12).map((psi) => 38 * MM + 5 * MM * Math.cos(2 * psi))), goal: 'force', solve: fn });
    expect(blocked.best).toBeNull();
    expect(blocked.reason).toBe('converged');
  });

  it('confirms each cam improvement with a full solve and drops those the full solve does not confirm', () => {
    // The full solve reads the cam 1 mm larger for a positive sin 1ψ
    // coefficient; the coarse solve does not see it.
    const psi = knotAngles(12);
    const s1 = (/** @type {number[]} */ v) => v.reduce((a, x, i) => a + x * Math.sin(psi[i]), 0);
    const { fn } = syntheticSolve((values, resolution) => (resolution === 'full' && s1(values) > 1e-6
      ? { cam: 1 + 10 * distance(values) }
      : {}));
    const out = optimise({ state: withTrack([...START]), goal: 'cam', solve: fn });
    const best = /** @type {NonNullable<typeof out.best>} */ (out.best);
    expect(s1(best.values)).toBeLessThanOrEqual(1e-6);
    expect(best.evaluation.camSize).toBeLessThan(1);
  });

  it('stops at the budget, at the time limit, and at once when the current design fails', () => {
    const { fn } = syntheticSolve();
    const budget = optimise({ state: withTrack([...START]), goal: 'cam', solve: fn, budget: 7 });
    expect(budget.reason).toBe('budget');
    expect(budget.solves).toBe(7);

    let t = 0;
    const time = optimise({ state: withTrack([...START]), goal: 'cam', solve: fn, timeLimit: 1000, now: () => (t += 100) });
    expect(time.reason).toBe('time');
    expect(time.elapsed).toBeGreaterThan(1000);

    const failing = syntheticSolve(() => ({ status: 'infeasible' }));
    const start = optimise({ state: withTrack([...START]), goal: 'cam', solve: failing.fn });
    expect(start.reason).toBe('start');
    expect(start.solves).toBe(0);
    expect(start.best).toBeNull();
    expect(failing.calls).toHaveLength(1);

    // The full solve passes, the coarse one the candidates are compared with does not.
    const coarse = syntheticSolve((_values, resolution) => (resolution === 'coarse' ? { status: 'infeasible' } : {}));
    const second = optimise({ state: withTrack([...START]), goal: 'cam', solve: coarse.fn });
    expect(second.reason).toBe('start-coarse');
    expect(second.solves).toBe(0);
    expect(coarse.calls.map((c) => c.resolution)).toEqual(['full', 'coarse']);
  });

  it('starts from a design with a warning, clears it when it can and never adds another one', () => {
    // The start (mean 45 mm) has a cam-size warning below a mean of 44 mm
    // it goes; a cos 2ψ amplitude above 3.5 mm adds a cam-overlap warning.
    const psi = knotAngles(12);
    const mean = (/** @type {number[]} */ v) => v.reduce((a, x) => a + x, 0) / v.length;
    const amp = (/** @type {number[]} */ v) => (2 / v.length) * v.reduce((a, x, i) => a + x * Math.cos(2 * psi[i]), 0);
    const { fn } = syntheticSolve((values) => ({
      warn: [...(mean(values) > 44 * MM ? ['cam-size'] : []), ...(amp(values) > 3.5 * MM ? ['cam-overlap'] : [])],
    }));
    const out = optimise({ state: withTrack([...START]), goal: 'cam', solve: fn });
    expect(out.start).toMatchObject({ ok: true, warnings: ['cam-size'] });
    const best = /** @type {NonNullable<typeof out.best>} */ (out.best);
    expect(best).not.toBeNull();
    expect(out.reason).toBe('converged');
    expect(mean(best.values)).toBeLessThan(44 * MM);
    expect(amp(best.values)).toBeLessThanOrEqual(3.5 * MM);
    expect(best.evaluation.warnings).toEqual([]);
  });
});

describe('optimise the default design with the real solver', () => {
  /**
   * Check a result against a full solve of its values: every check, the
   * margins and the limits of the goal.
   * @param {import('../../src/core/optimise.js').Outcome} out
   * @param {import('../../src/state/schema.js').ProjectState} [state] the optimised design
   */
  function holds(out, state = defaultState()) {
    const best = /** @type {NonNullable<typeof out.best>} */ (out.best);
    const r = solve(withValues(state, best.values), { resolution: 'full' });
    expect(r.status).toBe('ok');
    expect(r.diagnostics).toEqual([]);
    expect(r.warnings).toEqual([]);
    const e = evaluate(r);
    expect(meetsLimits(e, limitsFor(out.goal, out.start))).toBe(true);
    return e;
  }

  it('makes the cam smaller within 30 solves, keeps the force limit, and repeats the same result', () => {
    // The crossbow finds a smaller cam within its first solves; the default
    // design needs about 150, too slow for the coverage run.
    const run = () => optimise({ state: sampleState('crossbow'), goal: 'cam', solve, budget: 30 });
    const out = run();
    expect(out.start.ok).toBe(true);
    expect(out.solves).toBeLessThanOrEqual(30);
    expect(out.best).not.toBeNull();
    const e = holds(out, sampleState('crossbow'));
    expect(e.camSize).toBeLessThan(out.start.camSize);
    expect(e.forceDifference).toBeLessThanOrEqual(out.start.forceDifference);
    expect(run().best?.values).toEqual(out.best?.values);
  }, 60_000);

  it('makes the force difference smaller or keeps the design within 20 solves, and keeps the cam size', () => {
    const out = optimise({ state: defaultState(), goal: 'force', solve, budget: 20 });
    expect(out.solves).toBeLessThanOrEqual(20);
    if (out.best) {
      const e = holds(out);
      expect(e.forceDifference).toBeLessThan(out.start.forceDifference);
      expect(e.camSize).toBeLessThanOrEqual(out.start.camSize);
    }
  }, 60_000);
});
