import { describe, expect, it } from 'vitest';
import {
  FREEFORM_RANGE, LIMIT_TOLERANCE, applyModifier, dragLimit, largestAmount, offsetValues, pitchMinRho, sampleTrack, withinLimit,
} from '../../src/core/freeform.js';
import { defaultState } from '../../src/state/presets.js';
import { GLOSSARY } from '../../src/ui/glossary.js';
import {
  EDITOR_GLOSSARY, EDIT_STEP, OFFSET_DEFAULT, PRESET_IDS, PRESET_MARGIN, bendText, dragValues, drawAt, inArc, knotDegrees,
  limitOf, offsetError, offsetRange, pathOf, pointChoices, pointText, presetPlan, presetRoomText, presetText, presetValues,
  rangeText, roundValues, sampledText, stepValues, stoppedText, trackSample, trackValues, valueText, valuesError, viewBox,
  workingArc,
} from '../../src/ui/trackeditor.js';

/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../../src/state/schema.js').Units} Units */

const state = defaultState();
const limit = limitOf(state);
const values = sampleTrack(state.stringTrack, 12);
/** @type {Units} */
const mm = { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {Units} */
const inch = { ...mm, dims: 'in' };

/**
 * Result with a forward model of the given contact angles and nock positions.
 * @param {number[]} psiS
 * @param {number[]} x
 * @returns {SolveResult}
 */
function resultWith(psiS, x) {
  return /** @type {SolveResult} */ (/** @type {unknown} */ ({ achieved: { psiS: Float64Array.from(psiS), x: Float64Array.from(x) } }));
}

describe('track editor values', () => {
  it('rounds values to 0.1 µm', () => {
    expect(roundValues([0.012345678, 0.0300000449])).toEqual([0.0123457, 0.03]);
  });

  it('samples an analytic track at 12 points and copies free-form values', () => {
    expect(trackValues(state.stringTrack)).toEqual(values);
    const track = { ...state.stringTrack, shape: /** @type {const} */ ('freeform'), freeform: { values } };
    const copy = trackValues(track);
    expect(copy).toEqual(values);
    expect(copy).not.toBe(values);
  });

  it('takes the bend limit of the design with a margin', () => {
    expect(limitOf(state)).toEqual({ rho: 0.005, d: 0.0025, margin: 0 });
    expect(limitOf(state, 0.5e-3).margin).toBe(0.5e-3);
  });

  it('applies a preset to an analytic track after sampling it, and the square at 16 points', () => {
    const tri = presetValues(state.stringTrack, 'triangle', 1e-3, 0);
    expect(tri).toHaveLength(12);
    expect(tri[0]).toBeCloseTo(values[0] + 1e-3, 9);
    expect(tri[2]).toBeCloseTo(values[2] - 1e-3, 9);
    expect(presetValues(state.stringTrack, 'square', 0.5e-3, 0)).toHaveLength(16);
    expect(presetValues(state.stringTrack, 'size', 2e-3, 0).every((v, i) => Math.abs(v - values[i] - 2e-3) < 1e-9)).toBe(true);
    expect(PRESET_IDS).toEqual(['oval', 'triangle', 'square', 'egg', 'size', 'shift']);
  });
});

describe('drag and keyboard edits', () => {
  it('moves the bump as far as asked when the limit allows it', () => {
    const r = dragValues(values, 3, 0.2e-3, limit);
    expect(r.stopped).toBe(false);
    expect(r.moved).toBe(0.2e-3);
    expect(r.values[3] - values[3]).toBeCloseTo(0.2e-3, 9);
    expect(r.values[4] - values[4]).toBeCloseTo(0.15e-3, 9);
    expect(r.values[5] - values[5]).toBeCloseTo(0.05e-3, 9);
    expect(r.values[6]).toBe(values[6]);
  });

  it('stops within about 1 µm of the bend limit and stays within it after rounding', () => {
    for (const index of [0, 5, 9]) {
      for (const direction of [1, -1]) {
        const r = dragValues(values, index, direction * 0.1, limit);
        const most = dragLimit(values, index, /** @type {1 | -1} */ (direction), limit);
        expect(r.stopped, `${index} ${direction}`).toBe(true);
        expect(withinLimit(r.values, limit)).toBe(true);
        expect(Math.abs(r.moved - most)).toBeLessThanOrEqual(3 * LIMIT_TOLERANCE);
        const rho = pitchMinRho(r.values, limit.d).value;
        // At the limit: a bend limit, or a value at the end of its range.
        const atRange = r.values.some((v) => v <= FREEFORM_RANGE.min + 2e-6 || v >= FREEFORM_RANGE.max - 2e-6);
        if (!atRange) expect(rho - limit.rho).toBeLessThan(0.1e-3);
      }
    }
  });

  it('does nothing for a zero or not finite move', () => {
    expect(dragValues(values, 1, 0, limit)).toEqual({ values, moved: 0, stopped: false, reason: null });
    expect(dragValues(values, 1, Number.NaN, limit).moved).toBe(0);
  });

  it('keeps only the value range for a track that misses the limit already', () => {
    const tight = { ...limit, rho: 0.2 };
    expect(withinLimit(values, tight)).toBe(false);
    const r = dragValues(values, 2, 1e-3, tight);
    expect(r.stopped).toBe(false);
    expect(r.values[2] - values[2]).toBeCloseTo(1e-3, 9);
    const far = dragValues(values, 2, -1, tight);
    expect(far.stopped).toBe(true);
    expect(Math.min(...far.values)).toBeGreaterThanOrEqual(FREEFORM_RANGE.min);
  });

  it('says whether the bend limit or the value range stopped a drag', () => {
    // Point 4 inwards reaches 2 mm while the sharpest bend is 6.3 mm, over the 5 mm limit.
    const inward = dragValues(values, 3, -0.05, limit);
    expect(inward).toMatchObject({ stopped: true, reason: 'range' });
    expect(inward.values[3]).toBeCloseTo(FREEFORM_RANGE.min, 5);
    expect(pitchMinRho(inward.values, limit.d).value).toBeGreaterThan(limit.rho + 1e-3);
    // Point 1 outwards stops at the bend limit.
    const outward = dragValues(values, 0, 0.1, limit);
    expect(outward).toMatchObject({ stopped: true, reason: 'bend' });
    // A track below the limit already stops only at the range.
    expect(dragValues(values, 2, -1, { ...limit, rho: 0.2 }).reason).toBe('range');
    expect(dragValues(values, 3, 0.2e-3, limit).reason).toBeNull();
    expect(stoppedText('bend', mm)).toBe(', stopped at the bend limit');
    expect(stoppedText('range', mm)).toBe(', stopped at the end of the groove radius range, 2 to 150 mm');
    expect(stoppedText('range', inch)).toBe(', stopped at the end of the groove radius range, 0.079 to 5.906 in (2 to 150 mm)');
    expect(stoppedText(null, mm)).toBe('');
  });

  it('words value errors as points and groove radii in the dimension unit, and checks an offset first', () => {
    expect(rangeText(mm)).toBe('2 to 150 mm');
    expect(valuesError(values, mm)).toBeNull();
    expect(valuesError(offsetValues(values, -0.025), mm)).toBe('Point 2 would get a groove radius of 0.58 mm; groove radii stay from 2 to 150 mm');
    expect(valuesError(offsetValues(values, -0.03), inch))
      .toBe('Point 2 would get a groove radius of −0.1742 in; groove radii stay from 0.079 to 5.906 in (2 to 150 mm)');
    expect(valuesError(values.slice(0, 7), mm)).toBe('A free-form track needs 8 to 16 values');
    // Offset: from 2 mm minus the smallest value to 150 mm minus the largest.
    const range = offsetRange(values);
    expect(range.min).toBeCloseTo(FREEFORM_RANGE.min - Math.min(...values), 12);
    expect(range.max).toBeCloseTo(FREEFORM_RANGE.max - Math.max(...values), 12);
    expect(offsetError(values, -0.021, mm)).toBeNull();
    expect(offsetError(values, 0.5e-3, mm)).toBeNull();
    expect(offsetError(values, -0.025, mm)).toBe('The offset must be from −21.01 to 83.01 mm, so every groove radius stays from 2 to 150 mm');
    expect(offsetError(values, 0.0254, inch)).toBeNull();
    expect(offsetError(values, -0.0254, inch)).toMatch(/^The offset must be from −0\.8272 to 3\.2682 in, /);
  });

  it('changes one value by a keyboard step, refusing the range and the limit', () => {
    const r = stepValues(values, 1, 0.1e-3, limit);
    expect(r.refused).toBeNull();
    expect(r.values.filter((v, i) => v !== values[i])).toEqual([Number((values[1] + 0.1e-3).toFixed(7))]);
    expect(stepValues(values, 1, -1, limit)).toEqual({ values, refused: 'range' });
    // A track just inside the limit: the step that crosses it is refused.
    const edge = dragValues(values, 0, 0.1, limit).values;
    const out = stepValues(edge, 0, 0.5e-3, limit);
    expect(out.refused).toBe('limit');
    expect(out.values).toEqual(edge);
    // A track outside the limit keeps moving.
    expect(stepValues(values, 0, 0.1e-3, { ...limit, rho: 0.2 }).refused).toBeNull();
  });

  it('has the steps of the plan: 0.1 mm (0.5 mm), 0.005 in (0.02 in)', () => {
    expect(EDIT_STEP).toEqual({ mm: { step: 0.1, large: 0.5 }, in: { step: 0.005, large: 0.02 } });
    expect(OFFSET_DEFAULT).toEqual({ mm: 0.5, in: 0.02 });
  });
});

describe('preset panel', () => {
  const rho = pitchMinRho(values, limit.d).value;
  /**
   * The default state with the free-form values and the bend limit ρ_lim of the pitch line.
   * @param {number} rhoLimit (m)
   * @param {number[]} [track]
   */
  const withLimit = (rhoLimit, track = values) => ({
    ...state,
    body: { ...state.body, minBendRadius: rhoLimit },
    stringTrack: { ...state.stringTrack, shape: /** @type {const} */ ('freeform'), freeform: { values: track } },
  });

  it('names the largest amount and what limits it on a track within the margin', () => {
    const plan = presetPlan(values, 'oval', 0, state);
    expect(plan.room.track).toBe('within');
    expect(plan.amount).toBe(1e-3);
    expect(presetRoomText(plan, 'oval', state)).toMatch(/^Largest amount within the bend limit and a 0\.5 mm margin: 11\.99 mm$/);
    expect(presetRoomText(presetPlan(values, 'size', 0, state), 'size', state)).toBe('Largest amount this preset takes: 30.00 mm');
    const big = new Array(12).fill(0.14);
    expect(presetRoomText(presetPlan(big, 'size', 0, state), 'size', state))
      .toBe('Largest amount within the groove radius range, 2 to 150 mm: 10.00 mm');
  });

  it('tells a track inside the 0.5 mm margin from one below the limit, and fills Size with the amount that restores the margin', () => {
    // (b) 0.2 mm over the limit: within it, inside the margin.
    const inside = withLimit(rho - 0.2e-3);
    expect(withinLimit(values, limitOf(inside))).toBe(true);
    const size = presetPlan(values, 'size', 0, inside);
    expect(size.room.track).toBe('margin');
    expect(size.amount).toBeGreaterThanOrEqual(0.3e-3);
    expect(size.amount).toBeLessThanOrEqual(0.31e-3 + 1e-12);
    expect(withinLimit(applyModifier(values, 'size', size.amount, 0), limitOf(inside, PRESET_MARGIN))).toBe(true);
    expect(presetRoomText(size, 'size', inside)).toBe('The track is within the bend limit but inside the 0.5 mm margin of the presets: '
      + 'sharpest bend 45.7 mm, limit 45.5 mm. A Size of at least 0.31 mm brings it within the limit and the 0.5 mm margin.');
    const oval = presetPlan(values, 'oval', 0, inside);
    expect(oval.amount).toBe(0);
    expect(presetRoomText(oval, 'oval', inside)).toMatch(/inside the 0\.5 mm margin of the presets: .*Size raises every bend\.$/);
    // (a) 2 mm below the limit.
    const below = withLimit(rho + 2e-3);
    const low = presetPlan(values, 'size', 0, below);
    expect(low.room.track).toBe('below');
    expect(low.amount).toBeCloseTo(2.5e-3, 9);
    expect(presetRoomText(low, 'size', below)).toBe('The track bends more sharply than the limit: sharpest bend 45.7 mm, '
      + 'limit 47.7 mm. A Size of at least 2.50 mm brings it within the limit and the 0.5 mm margin.');
    expect(presetRoomText(presetPlan(values, 'egg', 0, below), 'egg', below)).toBe(
      'The track bends more sharply than the limit: sharpest bend 45.7 mm, limit 47.7 mm. Size raises every bend.');
    // Shift does not change the bend: it keeps its amount below the limit.
    const shift = presetPlan(values, 'shift', 0, below);
    expect(shift.amount).toBe(1e-3);
    expect(presetRoomText(shift, 'shift', below)).toBe('Largest amount this preset takes: 30.00 mm. Shift moves the track and does not change its bend');
  });

  it('says when the value range or the bend limit leaves no room, and names a negative amount that fits', () => {
    // (c) Every value at 150 mm: the range blocks a positive Size and every Oval.
    const full = new Array(12).fill(FREEFORM_RANGE.max);
    const s = withLimit(0.005, full);
    expect(presetRoomText(presetPlan(full, 'size', 0, s), 'size', s)).toBe(
      'The groove radius range, 2 to 150 mm, leaves no room for this preset in this direction; a negative amount down to −30.00 mm fits.');
    expect(presetRoomText(presetPlan(full, 'oval', 0, s), 'oval', s)).toBe(
      'The groove radius range, 2 to 150 mm, leaves no room for this preset in this direction; try another angle.');
    expect(presetPlan(full, 'oval', 0, s).amount).toBe(0);
    // An oval applied at its largest amount: the same oval has no room left.
    const edge = roundValues(applyModifier(values, 'oval', largestAmount(values, 'oval', 0, limitOf(state, PRESET_MARGIN)), 0));
    const again = presetPlan(edge, 'oval', 0, state);
    expect(again.room.track).toBe('within');
    expect(presetRoomText(again, 'oval', state)).toMatch(
      /^The track is at the bend limit and the 0\.5 mm margin for this preset at this angle; a negative amount down to −\d+\.\d\d mm fits\.$/);
  });

  it('samples a strongly elliptical track at 16 points and says it does not follow closely', () => {
    const ellipse = { ...state.stringTrack, shape: /** @type {const} */ ('ellipse'), semiMajor: 0.06, semiMinor: 0.025, offset: 0, phase: 0 };
    const sampled = trackSample(ellipse);
    expect(sampled.points).toBe(16);
    expect(trackSample(ellipse)).toBe(sampled);
    expect(trackValues(ellipse)).toEqual(sampleTrack(ellipse, 16));
    expect(presetValues(ellipse, 'oval', 1e-3, 0)).toHaveLength(16);
    expect(sampledText(sampled, 'ellipse', mm)).toBe('The ellipse sampled at 16 points does not follow it closely: the groove '
      + 'radius differs by up to 0.1 mm, and the sharpest bend of the groove is 9.2 mm against 10.4 mm.');
    expect(sampledText(trackSample(state.stringTrack), 'eccentric', mm)).toBe('');
  });
});

describe('working arc', () => {
  const result = resultWith([0.2, 1, 3, 5], [0.17, 0.3, 0.5, 0.7]);

  it('takes brace and full-draw contact angles from the forward model', () => {
    const arc = workingArc(result);
    expect(arc).toMatchObject({ start: 0.2, end: 5 });
    expect(workingArc(null)).toBeNull();
    expect(workingArc(/** @type {SolveResult} */ (/** @type {unknown} */ ({ achieved: null })))).toBeNull();
    expect(workingArc(resultWith([1, 1], [0.1, 0.2]))).toBeNull();
    expect(workingArc(resultWith([0, Number.NaN], [0.1, 0.2]))).toBeNull();
  });

  it('tells which angles lie on the arc, one turn around', () => {
    const arc = workingArc(result);
    expect(inArc(0.2, arc)).toBe(true);
    expect(inArc(4.9, arc)).toBe(true);
    expect(inArc(5.5, arc)).toBe(false);
    expect(inArc(0.1, arc)).toBe(false);
    expect(inArc(0.3 + 2 * Math.PI, arc)).toBe(true);
    expect(inArc(0.3 - 2 * Math.PI, arc)).toBe(true);
    expect(inArc(1, null)).toBe(false);
  });

  it('interpolates the nock position where the string leaves at an angle', () => {
    const arc = workingArc(result);
    expect(drawAt(0.2, arc)).toBeCloseTo(0.17, 12);
    expect(drawAt(2, arc)).toBeCloseTo(0.4, 12);
    expect(drawAt(5, arc)).toBeCloseTo(0.7, 12);
    expect(drawAt(2 + 2 * Math.PI, arc)).toBeCloseTo(0.4, 12);
    expect(drawAt(6, arc)).toBeNaN();
    expect(drawAt(1, null)).toBeNaN();
  });
});

describe('track editor texts', () => {
  it('formats values, angles and points in the dimension unit', () => {
    expect(valueText(0.0333418, mm)).toBe('33.34');
    expect(valueText(0.0333418, inch)).toBe('1.3127');
    expect(knotDegrees(1, 12)).toBe('30°');
    expect(knotDegrees(1, 16)).toBe('22.5°');
    expect(pointText(2, values, mm)).toBe('Point 3 at 60°: 23.01 mm');
  });

  it('states the sharpest bend against the limit', () => {
    expect(bendText(values, limit, mm)).toMatch(/^Sharpest bend \d+\.\d mm, limit 5\.0 mm$/);
    expect(bendText(values, { ...limit, rho: 0.2 }, mm)).toMatch(/limit 200\.0 mm: below the limit, the solve reports it$/);
  });

  it('names an applied preset', () => {
    expect(presetText('oval', 1e-3, Math.PI / 4, mm)).toBe('Oval of 1.00 mm at 45° applied');
    expect(presetText('size', -0.5e-3, 0, mm)).toBe('Size of -0.50 mm applied');
  });

  it('offers 8, 12 and 16 points, plus the count of a loaded track', () => {
    expect(pointChoices(12)).toEqual([8, 12, 16]);
    expect(pointChoices(10)).toEqual([8, 10, 12, 16]);
  });

  it('has a glossary entry for every editor term', () => {
    for (const key of EDITOR_GLOSSARY) expect(GLOSSARY[key].term).toBe('working arc');
  });
});

describe('polar view', () => {
  it('draws cam-frame metres in millimetres with y down', () => {
    expect(pathOf([{ x: 0.01, y: 0.02 }, { x: -0.005, y: 0 }])).toBe('M10.000 -20.000L-5.000 0.000');
    expect(pathOf([{ x: 0, y: 0 }], true)).toBe('M0.000 0.000Z');
  });

  it('frames the outline and the bore in a square rounded to 5 mm', () => {
    const box = viewBox([{ x: 0.06, y: 0.01 }, { x: -0.02, y: -0.03 }], 0.005);
    expect(box).toEqual({ cx: 20, cy: 10, half: 50 });
    // Holds every point.
    for (const [x, y] of [[60, -10], [-20, 30]]) {
      expect(Math.abs(x - box.cx)).toBeLessThanOrEqual(box.half);
      expect(Math.abs(y - box.cy)).toBeLessThanOrEqual(box.half);
    }
    expect(viewBox([], 0).half).toBe(5);
  });
});
