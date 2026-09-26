import { describe, expect, it } from 'vitest';
import {
  BUMP, FREEFORM_POINTS, LIMIT_TOLERANCE, MODIFIERS, MODIFIER_MAX_AMOUNT, applyModifier, contactPoints, defaultAmount, dragBump,
  dragLimit, freeformLimit, grooveMinRho, harmonicOf, knotAngles, largestAmount, offsetValues, pitchMinRho, pointsFor, resample,
  resampleChecked, sampleTrack, withinLimit,
} from '../../src/core/freeform.js';
import { createSupport, freeformSupport, stringTrackGroove, stringTrackSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES } from '../../src/state/samples.js';

/** @typedef {import('../../src/core/freeform.js').ModifierId} ModifierId */
/** @typedef {import('../../src/state/schema.js').StringTrack} StringTrack */

const DEG = Math.PI / 180;
const MODIFIER_IDS = /** @type {ModifierId[]} */ (Object.keys(MODIFIERS));
const state = defaultState();
const values = state.stringTrack.freeform.values;
const limit = freeformLimit(state.body, state.cords.stringDiameter);

/**
 * Largest differences of p and ρ between a support and the spline through
 * its samples at n points, on a 0.1° grid.
 * @param {StringTrack} track
 * @param {number} n
 */
function samplingError(track, n) {
  const exact = createSupport(stringTrackGroove(track));
  const spline = createSupport(freeformSupport(sampleTrack(track, n)));
  let p = 0;
  let rho = 0;
  for (let i = 0; i < 3600; i++) {
    const psi = i * 0.1 * DEG;
    p = Math.max(p, Math.abs(spline.p(psi) - exact.p(psi)));
    rho = Math.max(rho, Math.abs(spline.rho(psi) - exact.rho(psi)));
  }
  return { p, rho };
}

describe('free-form track support', () => {
  it('passes through the values at ψ_i = 2π·i/N with period 2π, and the pitch line is d/2 further out', () => {
    const s = createSupport(freeformSupport(values));
    const psi = knotAngles(values.length);
    expect(psi[1]).toBeCloseTo(30 * DEG, 15);
    values.forEach((v, i) => expect(s.p(psi[i])).toBeCloseTo(v, 15));
    for (const a of [0.3, 2, 5.5]) {
      expect(s.p(a + 2 * Math.PI)).toBeCloseTo(s.p(a), 14);
      expect(s.rho(a - 2 * Math.PI)).toBeCloseTo(s.rho(a), 10);
    }
    const track = { ...state.stringTrack, shape: /** @type {const} */ ('freeform') };
    const pitch = createSupport(stringTrackSupport(track, 0.0025));
    expect(pitch.p(1)).toBeCloseTo(s.p(1) + 0.00125, 15);
    expect(pitch.rho(1)).toBeCloseTo(s.rho(1) + 0.00125, 12);
  });

  it('holds the default eccentric track sampled at 12 points in the default preset', () => {
    expect(values).toHaveLength(FREEFORM_POINTS.default);
    expect(values).toEqual(sampleTrack({ ...state.stringTrack, shape: 'eccentric' }, 12));
    // p = r + e·cos(ψ − phase) with r = 45 mm, e = 22 mm, phase −122°.
    expect(values[0]).toBeCloseTo(0.045 + 0.022 * Math.cos(122 * DEG), 7);
    // Rounded to 0.1 µm: at most 7 decimals of a metre.
    for (const v of values) expect(String(v).replace(/^0\./, '').length).toBeLessThanOrEqual(7);
  });

  it('samples the analytic tracks within 50 µm at 12 points and 5 µm at 16 points', () => {
    const hunting = /** @type {(typeof SAMPLES)[number]} */ (SAMPLES.find((x) => x.id === 'hunting')).state();
    expect(hunting.stringTrack.shape).toBe('ellipse');
    for (const track of [state.stringTrack, hunting.stringTrack]) {
      const twelve = samplingError(track, 12);
      const sixteen = samplingError(track, 16);
      expect(twelve.p).toBeLessThanOrEqual(5e-5);
      expect(sixteen.p).toBeLessThanOrEqual(5e-6);
      // ρ = p + p'' converges more slowly: a separate tolerance.
      expect(twelve.rho).toBeLessThanOrEqual(3e-3);
      expect(sixteen.rho).toBeLessThanOrEqual(1e-3);
    }
  });

  it('resamples the spline: the same number of points copies, another one changes the track slightly', () => {
    const same = resample(values, 12);
    expect(same).toEqual(values);
    expect(same).not.toBe(values);
    const eight = resample(values, 8);
    expect(eight).toHaveLength(8);
    const a = createSupport(freeformSupport(values));
    const b = createSupport(freeformSupport(eight));
    for (let i = 0; i < 720; i++) {
      const psi = i * 0.5 * DEG;
      expect(Math.abs(a.p(psi) - b.p(psi))).toBeLessThan(3e-5);
      expect(Math.abs(a.rho(psi) - b.rho(psi))).toBeLessThan(1.4e-3);
    }
    // A free-form track samples by resampling.
    expect(sampleTrack({ ...state.stringTrack, shape: 'freeform' }, 8)).toEqual(eight);
  });

  it('finds the exact smallest radius of curvature, below every sample of it', () => {
    for (const v of [values, resample(values, 11), applyModifier(values, 'triangle', 0.003, 0.4)]) {
      const s = createSupport(freeformSupport(v));
      const low = grooveMinRho(v);
      let sampled = Infinity;
      for (let i = 0; i < 7200; i++) sampled = Math.min(sampled, s.rho(i * 0.05 * DEG));
      expect(low.value).toBeLessThanOrEqual(sampled + 1e-12);
      expect(sampled - low.value).toBeLessThan(1e-6);
      expect(s.rho(low.psi)).toBeCloseTo(low.value, 12);
      expect(pitchMinRho(v, 0.003).value).toBeCloseTo(low.value + 0.0015, 15);
    }
  });

  it('checks the limit: value range and pitch radius of curvature with the margin', () => {
    expect(limit).toEqual({ rho: 0.005, d: 0.0025, margin: 0 });
    const cord = freeformLimit({ minBendRadius: 0.001 }, 0.003, 0.001);
    expect(cord.rho).toBeCloseTo(0.0017, 15);
    expect(cord).toMatchObject({ d: 0.003, margin: 0.001 });
    expect(withinLimit(values, limit)).toBe(true);
    const rho = pitchMinRho(values, limit.d).value;
    expect(withinLimit(values, { ...limit, margin: rho - limit.rho + 1e-9 })).toBe(false);
    expect(withinLimit(offsetValues(values, -0.022), limit)).toBe(false);
    expect(withinLimit(offsetValues(values, 0.084), limit)).toBe(false);
  });
});

describe('shape modifiers', () => {
  it('Size offsets every value and raises the radius of curvature by exactly its amount', () => {
    const out = applyModifier(values, 'size', 0.002, 1);
    out.forEach((v, i) => expect(v).toBeCloseTo(values[i] + 0.002, 15));
    expect(pitchMinRho(out, 0.0025).value).toBeCloseTo(pitchMinRho(values, 0.0025).value + 0.002, 12);
    expect(offsetValues(values, 0.002)).toEqual(out);
  });

  it('Shift moves the track and changes its radius of curvature by less than 5 % of the amount', () => {
    const round = Array(12).fill(0.04);
    const out = applyModifier(round, 'shift', 0.005, 30 * DEG);
    expect(out[1]).toBeCloseTo(0.045, 15);
    expect(out[7]).toBeCloseTo(0.035, 15);
    expect(Math.abs(grooveMinRho(out).value - 0.04)).toBeLessThan(0.05 * 0.005);
  });

  it('Oval, Rounded triangle and Rounded square lower the smallest radius of curvature by about (k² − 1)·amount', () => {
    const round = Array(8).fill(0.04);
    for (const [id, k] of /** @type {const} */ ([['oval', 2], ['triangle', 3], ['square', 4]])) {
      expect(harmonicOf(id)).toBe(k);
      const a = 0.0005;
      const out = applyModifier(round, id, a, 10 * DEG);
      expect(out).toHaveLength(Math.max(8, 4 * k));
      const drop = 0.04 - grooveMinRho(out).value;
      expect(drop, id).toBeGreaterThanOrEqual(0.9 * (k * k - 1) * a);
      expect(drop, id).toBeLessThanOrEqual(1.3 * (k * k - 1) * a);
      // The largest value sits at the angle, k-fold.
      const psi = knotAngles(out.length);
      expect(out[0] - 0.04).toBeCloseTo(a * Math.cos(k * (psi[0] - 10 * DEG)), 15);
    }
    // Egg: an oval plus half a rounded triangle, one amount.
    const egg = applyModifier(round, 'egg', 0.001, 0);
    expect(egg).toHaveLength(12);
    expect(egg[0]).toBeCloseTo(0.04 + 0.001 * 1.5, 15);
  });

  it('raises the number of points to 4k for harmonic k, up to 16', () => {
    expect(MODIFIER_IDS.map((id) => pointsFor(id, 8))).toEqual([8, 8, 8, 12, 16, 12]);
    expect(MODIFIER_IDS.map((id) => pointsFor(id, 12))).toEqual([12, 12, 12, 12, 16, 12]);
    expect(MODIFIER_IDS.map((id) => pointsFor(id, 16))).toEqual([16, 16, 16, 16, 16, 16]);
    expect(applyModifier(resample(values, 8), 'square', 0.0001, 0)).toHaveLength(16);
  });

  it('clamps the default amount so the spline keeps the limit and a 0.5 mm margin at 8, 12 and 16 points', () => {
    const margin = freeformLimit(state.body, state.cords.stringDiameter, 0.5e-3);
    for (const n of [8, 12, 16]) {
      const base = resample(values, n);
      for (const id of MODIFIER_IDS) {
        for (let angle = 0; angle < 360; angle += 30) {
          const a = defaultAmount(base, id, angle * DEG, margin);
          expect(a).toBeGreaterThan(0);
          expect(a).toBeLessThanOrEqual(MODIFIERS[id].amount);
          const out = applyModifier(base, id, a, angle * DEG);
          expect(out).toHaveLength(pointsFor(id, n));
          expect(pitchMinRho(out, margin.d).value, `${id} ${n} ${angle}`).toBeGreaterThanOrEqual(margin.rho + margin.margin);
        }
      }
    }
    // A tight margin clamps below the nominal amount.
    const tight = freeformLimit(state.body, state.cords.stringDiameter, pitchMinRho(values, 0.0025).value - 0.005 - 0.002);
    const clamped = defaultAmount(values, 'triangle', 0, tight);
    expect(clamped).toBeGreaterThan(0);
    expect(clamped).toBeLessThan(MODIFIERS.triangle.amount);
  });

  it('finds the largest amount by bisection on the spline, to within 1 µm', () => {
    for (const id of /** @type {ModifierId[]} */ (['oval', 'triangle', 'square', 'egg'])) {
      for (const angle of [0, 60 * DEG, 200 * DEG]) {
        const a = largestAmount(values, id, angle, limit);
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(MODIFIER_MAX_AMOUNT);
        expect(withinLimit(applyModifier(values, id, a, angle), limit)).toBe(true);
        expect(withinLimit(applyModifier(values, id, a + LIMIT_TOLERANCE, angle), limit)).toBe(false);
      }
    }
    // Size is limited by the value range only: the search ends at its maximum.
    expect(largestAmount(values, 'size', 0, limit)).toBe(MODIFIER_MAX_AMOUNT);
    // Shrinking stops at the 2 mm value range, or where ρ reaches the limit.
    const shrink = largestAmount(values, 'size', 0, limit, -1);
    expect(shrink).toBeLessThan(0);
    expect(Math.min(...offsetValues(values, shrink)) - 0.002).toBeLessThan(LIMIT_TOLERANCE);
    const high = { ...limit, rho: 0.03 };
    const bend = largestAmount(values, 'size', 0, high, -1);
    const rho = pitchMinRho(offsetValues(values, bend), limit.d).value;
    expect(rho).toBeGreaterThanOrEqual(0.03);
    expect(rho - 0.03).toBeLessThan(LIMIT_TOLERANCE);
    // A track that misses the limit already gets 0.
    const sharp = { ...limit, rho: 0.1 };
    expect(largestAmount(values, 'oval', 0, sharp)).toBe(0);
    expect(defaultAmount(values, 'oval', 0, sharp)).toBe(0);
  });
});

describe('drag bump', () => {
  it('moves the point and its neighbours by a raised cosine over ±2 points, across the period', () => {
    expect(BUMP).toEqual([1, 0.75, 0.25]);
    const out = dragBump(values, 0, 0.001);
    const moved = out.map((v, i) => Math.round((v - values[i]) * 1e7) / 1e4);
    expect(moved).toEqual([1, 0.75, 0.25, 0, 0, 0, 0, 0, 0, 0, 0.25, 0.75]);
    const end = dragBump(resample(values, 8), 7, -0.002);
    const base = resample(values, 8);
    expect(end.map((v, i) => Math.round((v - base[i]) * 1e7) / 1e4)).toEqual([-1.5, -0.5, 0, 0, 0, -0.5, -1.5, -2]);
    expect(values).toEqual(state.stringTrack.freeform.values);
  });

  it('finds the drag limit to within 1 µm in both directions at 8, 12 and 16 points', () => {
    for (const n of [8, 12, 16]) {
      const base = resample(values, n);
      for (let i = 0; i < n; i++) {
        for (const direction of /** @type {const} */ ([1, -1])) {
          const d = dragLimit(base, i, direction, limit);
          expect(Math.sign(d)).toBe(direction);
          expect(withinLimit(dragBump(base, i, d), limit)).toBe(true);
          expect(withinLimit(dragBump(base, i, d + direction * LIMIT_TOLERANCE), limit)).toBe(false);
        }
      }
    }
    // Outwards the bump sharpens the track: ρ lands on the limit.
    const out = dragLimit(values, 2, 1, limit);
    expect(pitchMinRho(dragBump(values, 2, out), limit.d).value - limit.rho).toBeLessThan(LIMIT_TOLERANCE);
    // Nothing moves a track that misses the limit.
    expect(dragLimit(values, 0, 1, { ...limit, rho: 0.1 })).toBe(0);
  });
});

describe('contact points', () => {
  it('are X = p·n + p′·t of the groove bottom at the knots', () => {
    const round = contactPoints(Array(8).fill(0.03));
    round.forEach((c, i) => {
      expect(c.psi).toBeCloseTo((i * Math.PI) / 4, 15);
      expect(c.x).toBeCloseTo(0.03 * Math.cos(c.psi), 15);
      expect(c.y).toBeCloseTo(0.03 * Math.sin(c.psi), 15);
    });
    const s = createSupport(freeformSupport(values));
    const points = contactPoints(values);
    expect(points).toHaveLength(12);
    let offRadial = 0;
    points.forEach((c, i) => {
      const exact = s.point(c.psi);
      expect(c.x).toBeCloseTo(exact.x, 15);
      expect(c.y).toBeCloseTo(exact.y, 15);
      // Along n the point sits at p; across it at p′.
      expect(c.x * Math.cos(c.psi) + c.y * Math.sin(c.psi)).toBeCloseTo(values[i], 12);
      offRadial = Math.max(offRadial, Math.abs(-c.x * Math.sin(c.psi) + c.y * Math.cos(c.psi)));
    });
    // The default track: up to the 22 mm offset off the radial line.
    expect(offRadial).toBeGreaterThan(0.02);
    expect(offRadial).toBeLessThanOrEqual(0.0221);
  });
});

describe('resampling check', () => {
  it('keeps the default track above the limit at 8 and 16 points', () => {
    for (const n of [8, 16]) {
      const r = resampleChecked(values, n, limit);
      expect(r.below).toBe(false);
      expect(r.values).toHaveLength(n);
      expect(r.minRho).toBeCloseTo(pitchMinRho(r.values, limit.d).value, 15);
      expect(r.minRho).toBeGreaterThan(0.04);
    }
  });

  it('warns when a track at its limit falls below it on fewer points', () => {
    for (const id of /** @type {ModifierId[]} */ (['oval', 'triangle', 'egg'])) {
      const edge = applyModifier(values, id, largestAmount(values, id, 0, limit), 0);
      expect(withinLimit(edge, limit)).toBe(true);
      const r = resampleChecked(edge, 8, limit);
      expect(r.below, id).toBe(true);
      expect(r.minRho).toBeLessThan(limit.rho);
    }
  });
});
