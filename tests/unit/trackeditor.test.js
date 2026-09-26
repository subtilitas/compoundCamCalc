import { describe, expect, it } from 'vitest';
import { FREEFORM_RANGE, LIMIT_TOLERANCE, dragLimit, pitchMinRho, sampleTrack, withinLimit } from '../../src/core/freeform.js';
import { defaultState } from '../../src/state/presets.js';
import { GLOSSARY } from '../../src/ui/glossary.js';
import {
  EDITOR_GLOSSARY, EDIT_STEP, OFFSET_DEFAULT, PRESET_IDS, bendText, dragValues, drawAt, inArc, knotDegrees, limitOf,
  pathOf, pointChoices, pointText, presetText, presetValues, roundValues, stepValues, trackValues, valueText, viewBox,
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
    expect(dragValues(values, 1, 0, limit)).toEqual({ values, moved: 0, stopped: false });
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
