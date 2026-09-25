import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  INVERSE_TOLERANCE, createLimb, limbEnergies, limbFromState, linearLimb, stiffnessForTravel, tableLimb,
} from '../../src/core/limb.js';
import { buildCurveData } from '../../src/core/interp.js';
import { defaultState } from '../../src/state/presets.js';
import { derivative, integrate } from './numeric.js';

/** @typedef {import('../../src/core/limb.js').TableLimbData} TableLimbData */

const R = 0.2794;
const k = 27e3;
const s0 = 0.03;

describe('linear limb', () => {
  const limb = createLimb(linearLimb({ stiffness: k, preloadTravel: s0, limbLength: R }));

  it('stores ½·k_t·(α + α_0)² with k_t = k·R_L² and α_0 = preload / R_L', () => {
    expect(limb.kind).toBe('linear');
    const kt = k * R * R;
    const a0 = s0 / R;
    for (const alpha of [-0.05, 0, 0.1, 0.25]) {
      expect(limb.energy(alpha)).toBeCloseTo(0.5 * kt * (alpha + a0) ** 2, 12);
      expect(limb.moment(alpha)).toBeCloseTo(kt * (alpha + a0), 11);
      expect(limb.stiffness(alpha)).toBe(kt);
      expect(derivative(limb.energy, alpha, 1e-4)).toBeCloseTo(limb.moment(alpha), 9);
    }
    // In axle terms: E1 = ½·k·(s + s_0)² with the arc travel s = R_L·α.
    expect(limb.energy(0.038 / R)).toBeCloseTo(0.5 * k * (0.038 + s0) ** 2, 12);
    expect(limb.moment(0)).toBeCloseTo(k * R * s0, 11);
  });

  it('inverts the energy', () => {
    for (const alpha of [0, 0.01, 0.2, 0.5]) expect(limb.inverse(limb.energy(alpha))).toBeCloseTo(alpha, 13);
    expect(limb.inverse(-1)).toBeNaN();
    expect(limb.inverse(Infinity)).toBeNaN();
  });

  it('keeps the draw energy when the preload energy is many orders larger', () => {
    const huge = createLimb({ kind: 'linear', torsionalStiffness: 1, alpha0: 1e16 });
    const alphaFull = 0.2;
    // E1(α) − E1(0) = ½·k_t·α·(α + 2·α_0), about 2e15 J; subtracting the
    // totals (5e31 J) would lose it entirely.
    expect(limbEnergies(huge, alphaFull).drawEnergy).toBeCloseTo(alphaFull * (alphaFull + 2e16), -1);
    const table = createLimb(/** @type {TableLimbData} */ (tableLimb({ rotation: [0, 0.2, 0.5], moment: [0, 100, 300], alpha0: 0.1 }).limb));
    expect(table.energyChange(0.2)).toBeCloseTo(table.energy(0.2) - table.energy(0), 12);
  });

  it('reports draw, total and preload energy separately', () => {
    const e = limbEnergies(limb, 0.14);
    expect(e.preloadEnergy).toBeCloseTo(k * s0 * s0, 12);
    expect(e.limbEnergy).toBeCloseTo(k * (0.14 * R + s0) ** 2, 12);
    expect(e.drawEnergy).toBeCloseTo(e.limbEnergy - e.preloadEnergy, 12);
  });
});

describe('stiffnessForTravel', () => {
  it('returns the stiffness that stores the draw energy over the travel', () => {
    const W = 90;
    const kk = stiffnessForTravel({ drawEnergy: W, travel: 0.038, preloadTravel: s0 });
    const limb = createLimb(linearLimb({ stiffness: kk, preloadTravel: s0, limbLength: R }));
    expect(limbEnergies(limb, 0.038 / R).drawEnergy).toBeCloseTo(W, 10);
    expect(stiffnessForTravel({ drawEnergy: -1, travel: 0.038, preloadTravel: s0 })).toBeNaN();
    expect(stiffnessForTravel({ drawEnergy: 90, travel: 0, preloadTravel: 0 })).toBeNaN();
    // A backward travel with preload gives a positive denominator; it is still rejected.
    expect(stiffnessForTravel({ drawEnergy: 80, travel: -0.1, preloadTravel: 0.03 })).toBeNaN();
    expect(stiffnessForTravel({ drawEnergy: 80, travel: 0.04, preloadTravel: -0.01 })).toBeNaN();
    expect(stiffnessForTravel({ drawEnergy: Infinity, travel: 0.04, preloadTravel: 0.01 })).toBeNaN();
  });
});

describe('table limb', () => {
  it('reproduces the linear limb from linear data exactly', () => {
    const kt = k * R * R;
    const rotation = [0.05, 0.1, 0.2, 0.3, 0.4];
    const { limb: data, error } = tableLimb({ rotation, moment: rotation.map((q) => kt * q), alpha0: s0 / R });
    expect(error).toBeNull();
    const table = createLimb(/** @type {TableLimbData} */ (data));
    const linear = createLimb(linearLimb({ stiffness: k, preloadTravel: s0, limbLength: R }));
    // The table starts at 0.05 rad, so the unloaded point (0, 0) is added.
    expect(table.kind === 'table' && table.curve.knots[0]).toBe(0);
    for (const alpha of [-0.2, -0.05, 0, 0.1, 0.25, 0.4, 0.6]) {
      expect(table.energy(alpha)).toBeCloseTo(linear.energy(alpha), 10);
      expect(table.moment(alpha)).toBeCloseTo(linear.moment(alpha), 9);
      expect(table.stiffness(alpha)).toBeCloseTo(linear.stiffness(alpha), 8);
    }
    for (const alpha of [0, 0.1, 0.5]) expect(table.inverse(linear.energy(alpha))).toBeCloseTo(alpha, 12);
  });

  it('fits a nonlinear monotone table with a C2 curve and integrates it exactly', () => {
    const rotation = [0, 0.08, 0.16, 0.24, 0.32, 0.4];
    const moment = [0, 120, 205, 270, 330, 400];
    const { limb: data } = tableLimb({ rotation, moment, alpha0: 0.1 });
    const limb = createLimb(/** @type {TableLimbData} */ (data));
    rotation.forEach((q, i) => expect(limb.moment(q - 0.1)).toBeCloseTo(moment[i], 9));
    for (const alpha of [0, 0.05, 0.17, 0.25, 0.4]) {
      // Quadrature per knot interval: the quintic pieces join with a jump in M'''.
      const cuts = [0, ...rotation.filter((q) => q > 0 && q < alpha + 0.1), alpha + 0.1];
      let exact = 0;
      for (let j = 0; j < cuts.length - 1; j++) exact += integrate((q) => limb.moment(q - 0.1), cuts[j], cuts[j + 1], 2);
      expect(limb.energy(alpha)).toBeCloseTo(exact, 9);
      expect(derivative(limb.moment, alpha, 1e-5)).toBeCloseTo(limb.stiffness(alpha), 4);
      const back = limb.inverse(limb.energy(alpha));
      expect(Math.abs(limb.energy(back) - limb.energy(alpha))).toBeLessThan(INVERSE_TOLERANCE);
    }
    // Monotone data give a monotone moment.
    for (let q = 0; q < 0.4; q += 0.001) expect(limb.moment(q + 0.001 - 0.1)).toBeGreaterThanOrEqual(limb.moment(q - 0.1));
    // Beyond the table the moment continues with the end slope.
    const end = 0.4 - 0.1;
    expect(limb.moment(end + 0.1)).toBeCloseTo(400 + 0.1 * limb.stiffness(end), 9);
    expect(derivative(limb.energy, end + 0.05, 1e-4)).toBeCloseTo(limb.moment(end + 0.05), 7);
    expect(limb.inverse(limb.energy(end + 0.3))).toBeCloseTo(end + 0.3, 10);
    expect(limb.inverse(-1)).toBeNaN();
  });

  it('inverts the energy beyond a table whose last row falls, up to the peak of E1', () => {
    const { limb: data } = tableLimb({ rotation: [0.05, 0.1, 0.15, 0.2], moment: [200, 400, 600, 500], alpha0: 0.05 });
    const table = /** @type {TableLimbData} */ (data);
    const limb = createLimb(table);
    const { knots, values, slopes } = table.curve;
    const n = knots.length - 1;
    expect(slopes[n]).toBeLessThan(0);
    // The extended moment reaches 0 at q_peak, where E1 is largest.
    const alphaPeak = knots[n] + values[n] / -slopes[n] - 0.05;
    expect(Math.abs(limb.moment(alphaPeak))).toBeLessThan(1e-9);
    expect(limb.energy(alphaPeak)).toBeGreaterThan(limb.energy(alphaPeak - 0.01));
    expect(limb.energy(alphaPeak)).toBeGreaterThan(limb.energy(alphaPeak + 0.01));
    for (const alpha of [0.1, 0.16, 0.2, 0.249]) {
      const back = limb.inverse(limb.energy(alpha));
      expect(back).toBeCloseTo(alpha, 10);
      expect(Math.abs(limb.energy(back) - limb.energy(alpha))).toBeLessThan(INVERSE_TOLERANCE);
    }
    expect(Math.abs(limb.energy(limb.inverse(limb.energy(alphaPeak))) - limb.energy(alphaPeak))).toBeLessThan(INVERSE_TOLERANCE);
    expect(limb.inverse(limb.energy(alphaPeak) + 1e-6)).toBeNaN();
  });

  it('returns NaN for a NaN rotation or energy, like the linear limb', () => {
    const table = createLimb(/** @type {TableLimbData} */ (tableLimb({ rotation: [0, 0.2], moment: [0, 100], alpha0: 0.1 }).limb));
    const linear = createLimb(linearLimb({ stiffness: k, preloadTravel: s0, limbLength: R }));
    for (const limb of [table, linear]) {
      expect(limb.energy(NaN)).toBeNaN();
      expect(limb.moment(NaN)).toBeNaN();
      expect(limb.stiffness(NaN)).toBeNaN();
      expect(limb.inverse(NaN)).toBeNaN();
    }
    // A NaN preload is invalid limb data.
    expect(() => createLimb({ ...table, alpha0: NaN })).toThrow(/alpha0/);
  });

  it('rejects invalid tables with a message', () => {
    expect(tableLimb({ rotation: [0.1], moment: [5], alpha0: 0 }).error).toMatch(/2 rows/);
    expect(tableLimb({ rotation: [0.1, 0.2], moment: [5], alpha0: 0 }).error).toMatch(/2 rows/);
    expect(tableLimb({ rotation: [0.1, 0.1], moment: [5, 6], alpha0: 0 }).error).toMatch(/row 2/);
    expect(tableLimb({ rotation: [0.1, 0.2], moment: [5, -6], alpha0: 0 }).error).toMatch(/row 2/);
    // Zero rotation is the unstrung limb: its moment is 0.
    expect(tableLimb({ rotation: [0, 0.5], moment: [100, 200], alpha0: 0 }).error).toMatch(/unstrung/);
    expect(tableLimb({ rotation: [0, 0.5], moment: [0, 200], alpha0: 0 }).error).toBeNull();
    expect(tableLimb({ rotation: [0.1, 0.2], moment: [5, 6], alpha0: NaN }).error).toMatch(/preload/);
    const flat = tableLimb({ rotation: [0, 1], moment: [0, 0], alpha0: 0 }).limb;
    expect(createLimb(/** @type {TableLimbData} */ (flat)).inverse(1)).toBeNaN();
  });
});

describe('limbFromState', () => {
  const state = defaultState();

  it('builds the linear limb of the stiffness mode', () => {
    const { limb, error } = limbFromState(state.limb, state.geometry.limbLength);
    expect(error).toBeNull();
    expect(limb).toEqual(linearLimb({ stiffness: state.limb.stiffness, preloadTravel: state.limb.preloadTravel, limbLength: state.geometry.limbLength }));
  });

  it('derives the stiffness in the travel mode from the draw energy', () => {
    const limbState = { ...state.limb, mode: /** @type {const} */ ('travel') };
    expect(limbFromState(limbState, R).error).toMatch(/draw energy/);
    const { limb } = limbFromState(limbState, R, { drawEnergy: 80 });
    const e = limbEnergies(createLimb(/** @type {any} */ (limb)), limbState.travel / R);
    expect(e.drawEnergy).toBeCloseTo(80, 10);
  });

  it('converts table rows from axle travel and force to rotation and moment', () => {
    const table = [
      { travel: 0, force: 800 },
      { travel: 0.02, force: 1300 },
      { travel: 0.04, force: 1800 },
    ];
    const limbState = { ...state.limb, mode: /** @type {const} */ ('table'), table };
    const { limb } = limbFromState(limbState, R);
    const l = createLimb(/** @type {any} */ (limb));
    expect(l.moment(0)).toBeCloseTo(800 * R, 9);
    expect(l.moment(0.04 / R)).toBeCloseTo(1800 * R, 9);
    expect(l.alpha0).toBeCloseTo(state.limb.preloadTravel / R, 15);
    expect(limbFromState({ ...limbState, table: /** @type {any} */ (null) }, R).error).toMatch(/2 rows/);
  });

  it('rejects invalid values', () => {
    expect(limbFromState(state.limb, 0).error).toMatch(/lever length/);
    expect(limbFromState({ ...state.limb, stiffness: -1 }, R).error).toMatch(/stiffness/);
    expect(limbFromState({ ...state.limb, preloadTravel: -0.01 }, R).error).toMatch(/preload/);
    expect(limbFromState({ ...state.limb, mode: 'stiffness', stiffness: Infinity }, R).error).toMatch(/stiffness/);
    expect(limbFromState(state.limb, Infinity).error).toMatch(/lever length/);
  });

  it('every limb it accepts has a finite, non-negative brace moment and energy (property test)', () => {
    const num = fc.oneof(fc.double(), fc.double({ min: -0.5, max: 0.5, noNaN: true }));
    const row = fc.record({ travel: num, force: num });
    fc.assert(
      fc.property(
        fc.constantFrom('stiffness', 'travel', 'table'),
        num, num, num, fc.array(row, { maxLength: 6 }), num, num,
        (mode, stiffness, preloadTravel, travel, table, limbLength, drawEnergy) => {
          const state = /** @type {any} */ ({ mode, stiffness: stiffness * 1e5, preloadTravel, travel, table, maxRotation: 1 });
          const { limb, error } = limbFromState(state, limbLength, { drawEnergy: drawEnergy * 1e3 });
          if (!limb) {
            expect(typeof error).toBe('string');
            return;
          }
          const made = createLimb(limb);
          expect(Number.isFinite(made.moment(0)) && made.moment(0) >= 0).toBe(true);
          expect(Number.isFinite(made.energy(0)) && made.energy(0) >= 0).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rejects table rows with a negative travel from brace or a negative force', () => {
    const base = { ...state.limb, mode: /** @type {const} */ ('table'), preloadTravel: 0.03 };
    const negativeTravel = limbFromState({ ...base, table: [{ travel: -0.01, force: 100 }, { travel: 0.05, force: 400 }] }, R);
    expect(negativeTravel.error).toMatch(/row 1/);
    const negativeForce = limbFromState({ ...base, table: [{ travel: 0.01, force: 100 }, { travel: 0.05, force: -1 }] }, R);
    expect(negativeForce.error).toMatch(/row 2/);
    const nonFinite = limbFromState({ ...base, table: [{ travel: 0.01, force: 100 }, { travel: NaN, force: 400 }] }, R);
    expect(nonFinite.error).toMatch(/row 2/);
  });

  it('rejects a negative preload in table mode, even when every row stays above zero rotation', () => {
    const table = { ...state.limb, mode: /** @type {const} */ ('table'), preloadTravel: -0.01, table: [{ travel: 0.02, force: 100 }, { travel: 0.08, force: 400 }] };
    expect(limbFromState(table, R).error).toMatch(/preload/);
    expect(limbFromState({ ...table, preloadTravel: NaN }, R).error).toMatch(/preload/);
  });
});

describe('createLimb', () => {
  it('rejects an unknown limb kind', () => {
    const data = /** @type {any} */ ({ kind: 'spring', torsionalStiffness: 100, alpha0: 0.1 });
    expect(() => createLimb(data)).toThrow(/Unknown limb kind/);
    expect(() => createLimb(/** @type {any} */ (null))).toThrow(/Unknown limb kind/);
  });

  it('rebuilds serialized table data and rejects a moment at zero rotation', () => {
    const bad = /** @type {TableLimbData} */ ({ kind: 'table', curve: buildCurveData([{ x: 0, F: 100 }, { x: 0.4, F: 200 }]), alpha0: 0 });
    expect(() => createLimb(bad)).toThrow(/unstrung/);
    const late = /** @type {TableLimbData} */ ({ kind: 'table', curve: buildCurveData([{ x: 0.1, F: 100 }, { x: 0.4, F: 200 }]), alpha0: 0.1 });
    expect(() => createLimb(late)).toThrow(/zero rotation/);
    // Tampered coefficients are replaced by the curve through the knots.
    const good = /** @type {TableLimbData} */ (tableLimb({ rotation: [0, 0.2, 0.4], moment: [0, 100, 250], alpha0: 0.1 }).limb);
    const tampered = { ...good, curve: { ...good.curve, coeffs: good.curve.coeffs.map(() => 1e9) } };
    expect(createLimb(tampered).moment(0)).toBeCloseTo(createLimb(good).moment(0), 12);
  });

  it('rejects serialized limb data with a non-positive stiffness or a negative preload', () => {
    expect(() => createLimb({ kind: 'linear', torsionalStiffness: -1000, alpha0: -0.2 })).toThrow(RangeError);
    expect(() => createLimb({ kind: 'linear', torsionalStiffness: 0, alpha0: 0.1 })).toThrow(/stiffness/);
    expect(() => createLimb({ kind: 'linear', torsionalStiffness: 1000, alpha0: -0.01 })).toThrow(/alpha0/);
    expect(() => createLimb({ kind: 'linear', torsionalStiffness: Infinity, alpha0: 0.1 })).toThrow(/stiffness/);
    expect(tableLimb({ rotation: [0, 0.2], moment: [0, 100], alpha0: -0.05 }).error).toMatch(/preload/);
  });
});
