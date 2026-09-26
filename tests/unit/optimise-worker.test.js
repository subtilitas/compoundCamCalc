import { describe, expect, it } from 'vitest';
import { withValues } from '../../src/core/optimise.js';
import { knotAngles, sampleAnalytic } from '../../src/core/freeform.js';
import { solve } from '../../src/core/solve.js';
import { defaultState } from '../../src/state/presets.js';
import { sampleState } from '../../src/state/samples.js';
import {
  BUDGET_PARAM, budgetFromSearch, comparisonRows, disabledReason, noResultText, progressText, resultText, sameDesign, searchStartText,
} from '../../src/ui/optimise.js';
import { run } from '../../src/worker/optimise.worker.js';

/** @typedef {import('../../src/worker/optimise.worker.js').OptimiseMessage} OptimiseMessage */
/** @typedef {import('../../src/core/optimise.js').Evaluation} Evaluation */

const MM = 1e-3;

/**
 * Run a request and collect its messages.
 * @param {import('../../src/worker/optimise.worker.js').OptimiseRequest} request
 * @param {import('../../src/core/optimise.js').SolveFn} [solveFn]
 */
function messages(request, solveFn) {
  /** @type {OptimiseMessage[]} */
  const out = [];
  run(request, (m) => out.push(m), solveFn);
  return out;
}

describe('optimise worker', () => {
  it('posts the start, progress after each solve, each improvement and the outcome, in that order', () => {
    // The crossbow finds its first smaller cam within 8 solves.
    const out = messages({ state: sampleState('crossbow'), goal: 'cam', budget: 8 }, solve);
    expect(out[0].type).toBe('start');
    const last = out.at(-1);
    expect(last?.type).toBe('done');
    const outcome = /** @type {Extract<OptimiseMessage, { type: 'done' }>} */ (last).outcome;
    expect(outcome.reason).toBe('budget');
    expect(outcome.solves).toBe(8);
    const progress = out.filter((m) => m.type === 'progress');
    expect(progress.length).toBeGreaterThanOrEqual(8);
    for (const m of progress) expect(/** @type {any} */ (m).progress.budget).toBe(8);
    const improved = out.filter((m) => m.type === 'improved');
    expect(improved.length).toBeGreaterThan(0);
    expect(/** @type {any} */ (improved.at(-1)).improvement.values).toEqual(outcome.best?.values);
    // Every message can be copied to the page.
    expect(() => structuredClone(out)).not.toThrow();
  }, 30_000);

  it('limits the budget to 1 … 600 solves and reads an unknown goal as the cam goal', () => {
    // A design every candidate leaves unchanged: the search runs its polls without improvement.
    /** @type {import('../../src/core/optimise.js').SolveFn} */
    const flat = (_state, { resolution }) => /** @type {any} */ ({
      status: 'ok', diagnostics: [], warnings: [], resolution, fit: { used: true, maxForceDifference: 1 },
      target: { F: [0, 100] }, achieved: { F: [0, 100] },
      metrics: { camMaxDimension: 0.09, letOff: 0.8, stringMinRho: 0.04, stringRhoLimit: 0.005, stringWrap: 5, cableWrap: 5 },
    });
    for (const [budget, used] of [[0, 600], [-3, 600], [2.5, 600], [10_000, 600], [undefined, 600], [5, 5]]) {
      const out = messages({ state: defaultState(), goal: /** @type {any} */ ('size'), budget }, flat);
      const done = /** @type {any} */ (out.at(-1));
      expect(done.type).toBe('done');
      expect(done.outcome.goal).toBe('cam');
      expect(done.outcome.best).toBeNull();
      expect(/** @type {any} */ (out.find((m) => m.type === 'progress')).progress.budget).toBe(used);
    }
    // A failing start ends the run before the first candidate.
    const failing = messages({ state: defaultState(), goal: 'force' }, (state, o) => ({ ...flat(state, o), status: 'infeasible' }));
    expect(/** @type {any} */ (failing.at(-1)).outcome.reason).toBe('start');
    expect(failing.map((m) => m.type)).toEqual(['start', 'done']);
  });

  it('runs from a design whose only problem is a cam-size warning', () => {
    // A crossbow with ATA 9 in, 40 mm limb travel and a 50 mm track: status
    // ok, no diagnostic, a cam-size warning at full and coarse resolution.
    const base = sampleState('crossbow');
    const state = {
      ...base, geometry: { ...base.geometry, ata: 9 * 0.0254 }, limb: { ...base.limb, travel: 0.04 },
      stringTrack: { ...base.stringTrack, radius: 0.05 },
    };
    const full = solve(state, { resolution: 'full' });
    expect(full.status).toBe('ok');
    expect(full.warnings.map((w) => w.code)).toEqual(['cam-size']);
    expect(disabledReason({ workers: true, latest: { result: full, state }, state })).toBe('');
    const out = messages({ state, goal: 'cam', budget: 6 }, solve);
    const done = /** @type {Extract<OptimiseMessage, { type: 'done' }>} */ (out.at(-1));
    expect(done.outcome.reason).toBe('budget');
    expect(done.outcome.solves).toBe(6);
    expect(done.outcome.start.warnings).toEqual(['cam-size']);
    expect(done.outcome.sampled).toMatchObject({ points: 12, within: true });
  }, 30_000);

  it('posts an error when the search throws', () => {
    const out = messages({ state: defaultState(), goal: 'force' }, () => {
      throw new Error('broken solver.');
    });
    expect(out).toEqual([{ type: 'error', message: 'broken solver' }]);
  });
});

describe('optimise panel text', () => {
  const units = defaultState().units;
  const inch = { ...units, dims: /** @type {const} */ ('in'), force: /** @type {const} */ ('lbf') };

  it('reads the test budget from the query string', () => {
    expect(BUDGET_PARAM).toBe('optimise-budget');
    expect(budgetFromSearch('')).toBe(600);
    expect(budgetFromSearch('?optimise-budget=20')).toBe(20);
    expect(budgetFromSearch('?a=1&optimise-budget=1')).toBe(1);
    for (const bad of ['0', '601', '2.5', '-4', 'many', '']) expect(budgetFromSearch(`?optimise-budget=${bad}`)).toBe(600);
  });

  it('compares designs without the units', () => {
    const a = defaultState();
    expect(sameDesign(a, a)).toBe(true);
    expect(sameDesign(a, { ...a, units: inch })).toBe(true);
    expect(sameDesign(a, defaultState())).toBe(true);
    expect(sameDesign(a, { ...a, body: { ...a.body, minWall: 4 * MM } })).toBe(false);
  });

  it('says why Optimise is disabled', () => {
    const state = defaultState();
    const ok = /** @type {any} */ ({ status: 'ok', resolution: 'full' });
    expect(disabledReason({ workers: true, latest: { result: ok, state }, state })).toBe('');
    expect(disabledReason({ workers: false, latest: { result: ok, state }, state })).toMatch(/Web Workers/);
    expect(disabledReason({ workers: true, latest: null, state })).toMatch(/full solve of the current design/);
    expect(disabledReason({ workers: true, latest: { result: ok, state: defaultState() }, state })).toMatch(/full solve/);
    expect(disabledReason({ workers: true, latest: { result: { ...ok, resolution: 'coarse' }, state }, state })).toMatch(/full solve/);
    expect(disabledReason({ workers: true, latest: { result: { ...ok, status: 'infeasible' }, state }, state }))
      .toBe('Optimise starts from a design that meets every check. See Results for the problems.');
  });

  it('shows the progress with solves, halvings, elapsed time and the best value with its unit', () => {
    expect(progressText('cam', null, 480, units)).toBe('Solving the current design, 0.5 s');
    const p = { solves: 37, budget: 600, step: 1e-3, halvings: 1, elapsed: 4200, best: 0.0953 };
    expect(progressText('cam', p, 4210, units)).toBe('37 of 600 solves, step halved 1 time, 4.2 s; smallest cam so far 95.3 mm');
    expect(progressText('force', { ...p, halvings: 3, best: 3.21 }, 4210, units))
      .toBe('37 of 600 solves, step halved 3 times, 4.2 s; best force difference so far 3.2 N');
    expect(progressText('cam', p, 4210, inch)).toMatch(/smallest cam so far 3\.752 in$/);
  });

  it('lists cam size, force difference, let-off and sharpest bend before and after', () => {
    /** @type {Evaluation} */
    const before = {
      ok: true, warnings: [], camSize: 0.0982, forceDifference: 3.71, tolerance: 8, letOff: 0.749, stringMinRho: 0.04625,
      stringRhoLimit: 0.005, stringWrap: 5.3, cableWrap: 4.4,
    };
    const after = { ...before, camSize: 0.0908, forceDifference: 6.4, letOff: 0.741, stringMinRho: 0.0357 };
    expect(comparisonRows(before, after, units)).toEqual([
      { label: 'Largest cam dimension', before: '98.2 mm', after: '90.8 mm' },
      { label: 'Largest force difference', before: '3.7 N', after: '6.4 N' },
      { label: 'Let-off', before: '74.9 %', after: '74.1 %' },
      { label: 'Sharpest string bend', before: '46.3 mm', after: '35.7 mm' },
    ]);
    expect(comparisonRows(before, after, inch)[1]).toEqual({ label: 'Largest force difference', before: '0.8 lbf', after: '1.4 lbf' });
  });

  it('says how a run ended', () => {
    expect(noResultText('converged', 212)).toBe('No better shape found. The search ended after 212 solves. The track stays as it is.');
    expect(noResultText('stopped', 3)).toBe('No better shape found. Stopped after 3 solves. The track stays as it is.');
    expect(noResultText('budget', 600)).toMatch(/used all 600 solves/);
    expect(noResultText('time', 90)).toMatch(/time limit of 120 s/);
    expect(noResultText('start', 0)).toBe(
      'The current design does not meet every check, so Optimise has nothing to keep. See Results for the problems.');
    // The coarse start failed, not the full one.
    expect(noResultText('start-coarse', 0)).toBe('The current design meets every check at full resolution, but not in the '
      + 'coarse solve the search compares candidates with, so Optimise cannot start.');
    expect(resultText('stopped', 14)).toBe(
      'A better free-form track was found. Stopped after 14 solves; the best shape so far is kept. Apply sets it as the string track.');
    expect(resultText('converged', 400)).toMatch(/search ended after 400 solves/);
    expect(resultText('budget', 600)).toMatch(/used all 600 solves/);
    expect(resultText('time', 600)).toMatch(/time limit of 120 s/);
  });

  it('notes a search that starts from an ellipse 16 points do not follow closely', () => {
    const s = defaultState();
    const track = { ...s.stringTrack, shape: /** @type {const} */ ('ellipse'), semiMajor: 0.06, semiMinor: 0.025, offset: 0, phase: 0 };
    const sampled = sampleAnalytic(track);
    expect(searchStartText(sampled, 'ellipse', units)).toMatch(
      /^The ellipse sampled at 16 points does not follow it closely: .* The search starts from this sampled track; the Before column is the ellipse\.$/);
    expect(searchStartText(sampleAnalytic(s.stringTrack), 'eccentric', units)).toBe('');
  });

  it('keeps a free-form state of the result loadable', () => {
    const values = knotAngles(12).map((psi) => 40 * MM + 2 * MM * Math.cos(2 * psi));
    const s = withValues(defaultState(), values);
    expect(s.stringTrack.shape).toBe('freeform');
    expect(s.stringTrack.freeform.values).toBe(values);
    expect(s.stringTrack.radius).toBe(defaultState().stringTrack.radius);
  });
});
