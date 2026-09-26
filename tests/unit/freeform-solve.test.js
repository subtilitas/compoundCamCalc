import { describe, expect, it } from 'vitest';
import { formatter } from '../../src/core/diagnostics.js';
import {
  applyModifier, defaultAmount, dragBump, dragLimit, freeformLimit, pitchMinRho, resample, sampleTrack,
} from '../../src/core/freeform.js';
import { changeSuggestion, forwardDiagnostics, largerStringTrack, solve } from '../../src/core/solve.js';
import { createSupport, stringTrackSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES } from '../../src/state/samples.js';
import { fromJSON, toJSON, validate } from '../../src/state/schema.js';

/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../../src/core/diagnostics.js').SolveDiagnostic} SolveDiagnostic */
/** @typedef {import('../../src/core/freeform.js').ModifierId} ModifierId */

const DEG = Math.PI / 180;

/**
 * The state with a free-form string track of the given values.
 * @param {ProjectState} s
 * @param {number[]} values
 * @returns {ProjectState}
 */
function freeform(s, values) {
  return { ...s, stringTrack: { ...s.stringTrack, shape: 'freeform', freeform: { values } } };
}

/**
 * The diagnostic of a code; fails the test when it is absent.
 * @param {import('../../src/core/solve.js').SolveResult} r
 * @param {string} code
 * @returns {SolveDiagnostic}
 */
function find(r, code) {
  const d = r.diagnostics.find((q) => q.code === code);
  if (!d) throw new Error(`no ${code} diagnostic in ${r.diagnostics.map((q) => q.code).join(', ')}`);
  return d;
}

describe('free-form string track in the solver', () => {
  it('converting each sample to free-form at 12 points keeps the cam within 0.1 mm and the force difference within 0.05 N', () => {
    for (const sample of SAMPLES) {
      const s = sample.state();
      const before = solve(s);
      const after = solve(freeform(s, sampleTrack(s.stringTrack, 12)));
      expect(after.status, sample.id).toBe('ok');
      expect(after.diagnostics).toEqual([]);
      expect(after.warnings).toEqual([]);
      const a = /** @type {NonNullable<typeof before.metrics>} */ (before.metrics);
      const b = /** @type {NonNullable<typeof after.metrics>} */ (after.metrics);
      expect(Math.abs(b.camMaxDimension - a.camMaxDimension), sample.id).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(after.fit.maxForceDifference - before.fit.maxForceDifference), sample.id).toBeLessThanOrEqual(0.05);
    }
  });

  it('builds the pitch line as the periodic spline through the values, offset by d/2', () => {
    const s = defaultState();
    const r = solve(freeform(s, s.stringTrack.freeform.values));
    const pitch = /** @type {any} */ (r.tracks.stringPitch);
    expect(pitch.kind).toBe('offset');
    expect(pitch.delta).toBe(s.cords.stringDiameter / 2);
    expect(pitch.base.kind).toBe('spline');
    expect(pitch.base.periodic).toBe(true);
    expect(pitch.base.knots).toHaveLength(13);
  });

  it('string-radius: reports the exact smallest radius of curvature, at a knot the 0.5° grid misses', () => {
    // 11 points: the knot at 98.18° lies between the 0.5° samples.
    const s = defaultState();
    const limit = freeformLimit(s.body, s.cords.stringDiameter);
    const v11 = resample(s.stringTrack.freeform.values, 11);
    const values = dragBump(v11, 3, dragLimit(v11, 3, 1, limit) + 0.003);
    const state = freeform(s, values);
    expect(validate(state)).toEqual([]);
    const r = solve(state);
    expect(r.status).toBe('infeasible');
    const d = find(r, 'string-radius');
    const exact = createSupport(stringTrackSupport(state.stringTrack, s.cords.stringDiameter)).minRho(0, 2 * Math.PI);
    expect(exact.value).toBeCloseTo(pitchMinRho(values, s.cords.stringDiameter).value, 15);
    expect(d.psiRange).toEqual([exact.psi, exact.psi]);
    expect(exact.psi).toBeCloseTo((3 * 2 * Math.PI) / 11, 9);
    expect((exact.psi / DEG) % 0.5).toBeGreaterThan(0.1);
    expect(d.message).toBe('The string track has a radius of curvature of 2.6 mm at 98.2°; the limit is 5.0 mm');
    const need = limit.rho - exact.value;
    expect(d.suggestion).toBe(`Offset the free-form track outward by at least ${formatter(s.units).size(need)}`);
    // The offset raises ρ by exactly its amount: 1 µm more clears the check.
    const larger = /** @type {ProjectState} */ (largerStringTrack(state, need + 1e-6));
    expect(pitchMinRho(larger.stringTrack.freeform.values, s.cords.stringDiameter).value).toBeCloseTo(limit.rho + 1e-6, 12);
    expect(solve(larger, { resolution: 'coarse' }).diagnostics.map((q) => q.code)).not.toContain('string-radius');
  });

  it('string-clearance and string-wrap: suggest an outward offset of the free-form track', () => {
    const s = defaultState();
    const bore = freeform({ ...s, body: { ...s.body, boreDiameter: 0.03, minWall: 0.02 } }, s.stringTrack.freeform.values);
    expect(find(solve(bore), 'string-clearance').suggestion).toMatch(/^Offset the free-form track outward by at least \d+\.\d mm$/);
    const small = { ...s.stringTrack, radius: 0.03, offset: 0.005 };
    const wrap = freeform(s, sampleTrack(small, 12));
    expect(find(solve(wrap), 'string-wrap').suggestion).toMatch(/^Offset the free-form track outward by at least \d+\.\d mm$/);
  });

  it('largerStringTrack offsets every value and keeps the shape; null beyond the 150 mm value range', () => {
    const s = freeform(defaultState(), defaultState().stringTrack.freeform.values);
    const larger = /** @type {ProjectState} */ (largerStringTrack(s, 0.005));
    const before = s.stringTrack.freeform.values;
    larger.stringTrack.freeform.values.forEach((v, i) => expect(v).toBeCloseTo(before[i] + 0.005, 15));
    expect(larger.stringTrack.radius).toBe(s.stringTrack.radius);
    expect(larger.cords).toBe(s.cords);
    expect(s.stringTrack.freeform.values).toBe(before);
    const top = freeform(s, before.map((v, i) => (i === 0 ? 0.148 : v)));
    expect(largerStringTrack(top, 0.002)).not.toBeNull();
    expect(largerStringTrack(top, 0.005)).toBeNull();
  });

  it('changeSuggestion names the outward offset of a free-form track, or lists it as tried', () => {
    const fmt = formatter(defaultState().units);
    const s = freeform(defaultState(), defaultState().stringTrack.freeform.values);
    const max = (/** @type {ProjectState} */ st) => Math.max(...st.stringTrack.freeform.values);
    const start = max(s);
    expect(changeSuggestion(s, true, fmt, (st) => max(st) > start + 0.009)).toBe(
      'Offset the free-form track outward by 10.0 mm; the cam then closes the track and passes every check',
    );
    expect(changeSuggestion(s, true, fmt, () => false)).toBe(
      'Change the force curve: a lead-in wrap down to 0°, a free-form track offset outward up to 20.0 mm and a minimum bend radius of 2.5 mm ' +
        'do not give a closed track that passes every check',
    );
  });

  it('forwardDiagnostics names the outward offset for a free-form track that wraps a full turn', () => {
    const fmt = formatter(defaultState().units);
    const forward = /** @type {any} */ ({
      n: 2, x: [0.2, 0.25], psiS: [0, 1], psiC: [4, 5], stringTermination: 7, cableTermination: 3,
      diagnostics: [{ code: 'wrap-overlap', xRange: [0.2, 0.25], message: '' }],
    });
    /** @type {SolveDiagnostic[]} */
    const plain = [];
    forwardDiagnostics(forward, plain, fmt);
    expect(plain[0].suggestion).toBe('Increase the string track radius');
    /** @type {SolveDiagnostic[]} */
    const free = [];
    forwardDiagnostics(forward, free, fmt, true);
    expect(free.map((d) => [d.code, d.suggestion])).toEqual([['string-wrap', 'Offset the free-form track outward']]);
  });

  it('a saved free-form design below the radius limit loads and reports string-radius', () => {
    const s = defaultState();
    const limit = freeformLimit(s.body, s.cords.stringDiameter);
    const values = s.stringTrack.freeform.values;
    const sharp = freeform(s, dragBump(values, 5, dragLimit(values, 5, 1, limit) + 0.002));
    const loaded = fromJSON(toJSON(sharp));
    expect(loaded.errors).toEqual([]);
    expect(loaded.state).toEqual(sharp);
    expect(solve(loaded.state, { resolution: 'coarse' }).diagnostics.map((d) => d.code)).toContain('string-radius');
  });

  it('solves each modifier at its default amount on every sample, except the recorded ones', () => {
    // A modifier can make a design fail; the solve says why. With a 0.5 mm
    // margin at angle 0: the square on the hunting bow fails to close the
    // cable track, the 0.5 mm square on the light hunting bow leaves its
    // fitted cam 7.1 N from the target (tolerance 6.7 N), and Size on the
    // youth bow (0.88 mm, scaled to its 35 mm track) bends its cable track
    // too sharply. The scaled amounts keep the mini bow solving.
    /** @type {string[]} */
    const failed = [];
    for (const sample of SAMPLES) {
      const s = sample.state();
      const values = sampleTrack(s.stringTrack, 12);
      const limit = freeformLimit(s.body, s.cords.stringDiameter, 0.5e-3);
      for (const id of /** @type {ModifierId[]} */ (['size', 'shift', 'oval', 'triangle', 'square', 'egg'])) {
        const amount = defaultAmount(values, id, 0, limit);
        const r = solve(freeform(s, applyModifier(values, id, amount, 0)));
        expect(r.diagnostics.map((d) => d.code)).not.toContain('string-radius');
        if (r.status !== 'ok') failed.push(`${sample.id} ${id}: ${r.diagnostics.map((d) => d.code).join(', ')}`);
      }
    }
    expect(failed).toEqual([
      'hunting square: closing-blend',
      'light-hunting square: cable-radius, cable-clearance',
      'youth size: cable-radius, cable-clearance',
    ]);
  }, 60_000);
});
