import { describe, expect, it } from 'vitest';
import { bowGeometry, cableLength, stringHalfLength, toCam } from '../../src/core/geometry.js';
import { bowPoseAt, bracket, createBowPose, createLayout, loadAt } from '../../src/core/layout.js';
import { createLimb, limbFromState } from '../../src/core/limb.js';
import { solve } from '../../src/core/solve.js';
import { createSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';

/** @typedef {import('../../src/core/layout.js').LayoutContext} LayoutContext */

const state = defaultState();
const full = solve(state);
const coarse = solve(state, { resolution: 'coarse' });

/**
 * @param {import('../../src/core/solve.js').SolveResult} result
 * @returns {LayoutContext}
 */
function layoutOf(result) {
  const { layout, error } = createLayout(result, state.geometry);
  expect(error).toBeNull();
  return /** @type {LayoutContext} */ (layout);
}

describe('bracket', () => {
  const xs = [0, 1, 3, 6];
  it('finds the interval and the weight', () => {
    expect(bracket(xs, 4, 2)).toEqual({ i: 1, t: 0.5 });
    expect(bracket(xs, 4, 1)).toEqual({ i: 1, t: 0 });
    expect(bracket(xs, 4, 5.25)).toEqual({ i: 2, t: 0.75 });
  });
  it('clamps to the given samples', () => {
    expect(bracket(xs, 4, -1)).toEqual({ i: 0, t: 0 });
    expect(bracket(xs, 4, 9)).toEqual({ i: 3, t: 0 });
    expect(bracket(xs, 3, 5)).toEqual({ i: 2, t: 0 });
    expect(bracket(xs, 1, 5)).toEqual({ i: 0, t: 0 });
    expect(bracket(xs, 4, NaN)).toEqual({ i: 0, t: 0 });
  });
});

describe('layout of the default preset', () => {
  expect(full.status).toBe('ok');
  const ctx = layoutOf(full);
  const a = /** @type {NonNullable<typeof full.achieved>} */ (full.achieved);
  const stringSupport = createSupport(/** @type {any} */ (full.tracks.stringPitch));
  const cableSupport = createSupport(/** @type {any} */ (full.tracks.cablePitch));
  const bow = /** @type {import('../../src/core/geometry.js').BowGeometry} */ (bowGeometry(state.geometry, stringSupport).bow);
  const limb = createLimb(/** @type {any} */ (limbFromState(state.limb, state.geometry.limbLength).limb));
  const pose = createBowPose();
  const samples = [0, 1, 2, 100, 700, ctx.n - 2, ctx.n - 1];

  it('covers every sample', () => {
    expect(ctx.valid).toBe(ctx.n);
    expect(ctx.xBrace).toBe(a.x[0]);
    expect(ctx.xFull).toBe(a.x[ctx.n - 1]);
    expect(ctx.resolution).toBe('full');
  });

  it('starts at the brace geometry', () => {
    expect(bowPoseAt(ctx, a.x[0], pose)).toBe(true);
    expect(pose.alpha).toBe(0);
    expect(pose.theta).toBe(0);
    expect(pose.pivotX).toBeCloseTo(bow.pivotX, 12);
    expect(pose.pivotY).toBeCloseTo(bow.pivotY, 12);
    expect(pose.axleX).toBeCloseTo(bow.braceAxleX, 12);
    expect(pose.axleY).toBeCloseTo(bow.braceAxleY, 12);
    expect(Math.abs(pose.phi)).toBeLessThan(1e-9);
    // The string is vertical at the nock.
    expect(pose.stringX).toBeCloseTo(bow.xBrace, 9);
    expect(Math.abs(pose.tipX)).toBeLessThan(1e-6);
    expect(pose.axleLoad).toBeGreaterThan(0);
  });

  it('matches the stored samples and closes both cords', () => {
    for (const i of samples) {
      const x = a.x[i];
      expect(bowPoseAt(ctx, x, pose)).toBe(true);
      expect(pose.atSample).toBe(true);
      expect(pose.theta).toBe(a.theta[i]);
      expect(pose.axleX).toBeCloseTo(a.axleX[i], 12);
      expect(pose.axleY).toBeCloseTo(a.axleY[i], 12);
      // The contact point on the pitch line is the nock minus the free span.
      expect(pose.stringX).toBeCloseTo(x - pose.spanS * pose.usx, 9);
      expect(pose.stringY).toBeCloseTo(-pose.spanS * pose.usy, 9);
      expect(pose.cableX).toBeCloseTo(pose.anchorX - pose.spanC * pose.ucx, 9);
      expect(pose.cableY).toBeCloseTo(pose.anchorY - pose.spanC * pose.ucy, 9);
      const cam = toCam(pose.theta, pose.stringX - pose.axleX, pose.stringY - pose.axleY);
      expect(cam.x).toBeCloseTo(pose.stringCamX, 12);
      expect(cam.y).toBeCloseTo(pose.stringCamY, 12);
      // Lever arms: distance from the axle to each cord line.
      const cross = (/** @type {number} */ px, /** @type {number} */ py, /** @type {number} */ ux, /** @type {number} */ uy) =>
        Math.abs((px - pose.axleX) * uy - (py - pose.axleY) * ux);
      expect(cross(pose.stringX, pose.stringY, pose.usx, pose.usy)).toBeCloseTo(pose.pS, 9);
      expect(cross(pose.cableX, pose.cableY, pose.ucx, pose.ucy)).toBeCloseTo(pose.pC, 9);
      // Closure: the cord lengths of the braced bow.
      const half = stringHalfLength(bow, stringSupport, x, pose.theta, pose.alpha, /** @type {any} */ (full.tracks.string).psiEnd, pose.psiS);
      expect(2 * half.length).toBeCloseTo(ctx.lengths.string, 9);
      const cable = cableLength(bow, cableSupport, pose.theta, pose.alpha, /** @type {any} */ (full.tracks.cable).psiStart, pose.psiC);
      expect(cable.length).toBeCloseTo(ctx.lengths.cable, 9);
    }
  });

  it('balances the loads', () => {
    for (const i of samples.slice(1)) {
      expect(bowPoseAt(ctx, a.x[i], pose)).toBe(true);
      // Draw force from the two string halves.
      expect(2 * pose.Ts * Math.sin(pose.phi)).toBeCloseTo(pose.F, 6);
      // Moments about the axle.
      expect(pose.Ts * pose.pS).toBeCloseTo(pose.Tc * pose.pC, 6);
      // Virtual work of the tip load on the limb: the moment of one limb.
      const r = ctx.limbLength;
      const moment = pose.tipX * r * Math.sin(pose.beta) - pose.tipY * r * Math.cos(pose.beta);
      expect(moment / limb.moment(pose.alpha)).toBeCloseTo(1, 9);
      expect(ctx.loads.axleLoad[i]).toBeCloseTo(pose.axleLoad, 9);
    }
  });

  it('finds the peaks and the build lengths', () => {
    const L = ctx.loads;
    let maxTs = -Infinity;
    let maxAxle = -Infinity;
    for (let i = 0; i < ctx.n; i++) {
      maxTs = Math.max(maxTs, L.Ts[i]);
      maxAxle = Math.max(maxAxle, L.axleLoad[i]);
    }
    expect(L.maxTs.value).toBe(maxTs);
    expect(L.maxAxle.value).toBe(maxAxle);
    expect(L.min).toBeGreaterThan(0);
    expect(L.braceAxle).toBe(L.axleLoad[0]);
    const m = /** @type {NonNullable<typeof full.metrics>} */ (full.metrics);
    expect(ctx.lengths.string).toBe(m.stringLength);
    expect(ctx.lengths.cable).toBe(m.cableLength);
    expect(ctx.lengths.ataBrace).toBeCloseTo(state.geometry.ata, 12);
    expect(ctx.lengths.ataFull).toBeLessThan(ctx.lengths.ataBrace);
  });

  it('interpolates between samples and clamps outside', () => {
    const x = (a.x[300] + a.x[301]) / 2;
    expect(bowPoseAt(ctx, x, pose)).toBe(true);
    expect(pose.atSample).toBe(false);
    expect(pose.theta).toBeGreaterThan(a.theta[300]);
    expect(pose.theta).toBeLessThan(a.theta[301]);
    // The contact point stays on the pitch line.
    const p = stringSupport.point(pose.psiS);
    expect(pose.stringCamX).toBe(p.x);
    expect(bowPoseAt(ctx, a.x[0] - 0.01, pose)).toBe(true);
    expect(pose.clamped).toBe('before');
    expect(pose.x).toBe(a.x[0]);
    expect(bowPoseAt(ctx, ctx.xFull + 0.01, pose)).toBe(true);
    expect(pose.clamped).toBe('after');
    expect(pose.beyondSolution).toBe(false);
    expect(bowPoseAt(ctx, NaN, pose)).toBe(false);
    expect(pose.theta).toBeNaN();
  });

  it('gives the same pose on the coarse grid within the interpolation error', () => {
    const c = layoutOf(coarse);
    expect(c.resolution).toBe('coarse');
    const fine = createBowPose();
    const rough = createBowPose();
    const x = a.x[0] + 0.6 * (ctx.xFull - a.x[0]);
    bowPoseAt(ctx, x, fine);
    bowPoseAt(c, x, rough);
    expect(Math.abs(fine.theta - rough.theta)).toBeLessThan(0.01);
    expect(Math.abs(fine.Ts - rough.Ts) / fine.Ts).toBeLessThan(0.02);
  });

  it('builds a pose in a few microseconds', () => {
    const start = performance.now();
    for (let k = 0; k < 10000; k++) bowPoseAt(ctx, ctx.xBrace + ((k % 997) / 997) * (ctx.xFull - ctx.xBrace), pose);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('layout of a partly solved result', () => {
  const a = /** @type {NonNullable<typeof full.achieved>} */ (full.achieved);
  const cut = 1000;
  /** @type {Record<string, Float64Array>} */
  const achieved = {};
  for (const [key, v] of Object.entries(a)) {
    const copy = Float64Array.from(/** @type {Float64Array} */ (v));
    if (key !== 'x') copy.fill(NaN, cut);
    achieved[key] = copy;
  }
  const result = { ...full, status: /** @type {const} */ ('no-convergence'), achieved: /** @type {any} */ (achieved) };

  it('stops at the last solved sample', () => {
    const { layout } = createLayout(result, state.geometry);
    const ctx = /** @type {LayoutContext} */ (layout);
    expect(ctx.valid).toBe(cut);
    expect(ctx.xLast).toBe(a.x[cut - 1]);
    expect(ctx.xFull).toBe(a.x[a.x.length - 1]);
    expect(ctx.lengths.ataFull).toBeNaN();
    expect(ctx.loads.Ts[cut]).toBeNaN();
    const pose = createBowPose();
    expect(bowPoseAt(ctx, ctx.xFull, pose)).toBe(true);
    expect(pose.beyondSolution).toBe(true);
    expect(pose.clamped).toBe('after');
    expect(pose.theta).toBe(a.theta[cut - 1]);
  });

  it('falls back to the spans without track data', () => {
    const bare = { ...full, tracks: { ...full.tracks, stringPitch: null, cablePitch: null } };
    const ctx = /** @type {LayoutContext} */ (createLayout(bare, state.geometry).layout);
    const withTracks = layoutOf(full);
    const p = createBowPose();
    const q = createBowPose();
    bowPoseAt(ctx, a.x[500], p);
    bowPoseAt(withTracks, a.x[500], q);
    expect(p.stringX).toBeCloseTo(q.stringX, 9);
    expect(p.cableCamY).toBeCloseTo(q.cableCamY, 9);
    expect(p.axleX).toBeCloseTo(q.axleX, 9);
    // Outside the samples the nock is clamped for both forms.
    for (const x of [ctx.xFull + 0.05, a.x[0] - 0.05]) {
      bowPoseAt(ctx, x, p);
      bowPoseAt(withTracks, x, q);
      expect(p.stringX).toBeCloseTo(q.stringX, 9);
      expect(p.stringCamX).toBeCloseTo(q.stringCamX, 9);
    }
  });
});

describe('layout input checks', () => {
  it('rejects results without usable samples', () => {
    expect(createLayout(/** @type {any} */ ({ ...full, achieved: null }), state.geometry).error).toMatch(/no forward-model samples/);
    const a = /** @type {any} */ (full.achieved);
    const short = { ...a, x: a.x.slice(0, 1) };
    expect(createLayout(/** @type {any} */ ({ ...full, achieved: short }), state.geometry).error).toMatch(/fewer than 2/);
    const mismatch = { ...a, F: a.F.slice(1) };
    expect(createLayout(/** @type {any} */ ({ ...full, achieved: mismatch }), state.geometry).error).toMatch(/samples of F/);
    const unordered = { ...a, x: Float64Array.from(a.x).reverse() };
    expect(createLayout(/** @type {any} */ ({ ...full, achieved: unordered }), state.geometry).error).toMatch(/ascending/);
    const unsolved = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k === 'x' ? v : new Float64Array(v.length).fill(NaN)]));
    expect(createLayout(/** @type {any} */ ({ ...full, achieved: unsolved }), state.geometry).error).toMatch(/Fewer than 2/);
    expect(createLayout(full, { ...state.geometry, limbLength: 0 }).error).toMatch(/limb lever/);
  });

  it('computes the tip and bearing loads', () => {
    // A vertical string pulling down and a cable straight down: all load
    // points towards the bow centre.
    const load = loadAt(100, 50, 0, 0, -1);
    expect(load.tipX).toBeCloseTo(0, 12);
    expect(load.tipY).toBeCloseTo(-200, 12);
    expect(load.camY).toBeCloseTo(-150, 12);
  });
});
