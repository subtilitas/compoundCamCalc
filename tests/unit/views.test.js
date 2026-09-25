import { describe, expect, it } from 'vitest';
import { bowPoseAt, createBowPose, createLayout } from '../../src/core/layout.js';
import { solve } from '../../src/core/solve.js';
import { INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import { forceAt } from '../../src/ui/chart.js';
import { SERIES, loadRange, seriesRuns, tableRows } from '../../src/ui/loadchart.js';
import { peakX, placeIn, positionText, sliderModel, stepOfX, xOfStep } from '../../src/ui/scrubber.js';
import { ageCaption, camRadius, fullDrawPose, loadDirection, planBounds, planDims } from '../../src/ui/stringplan.js';

/** @typedef {import('../../src/core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../../src/state/schema.js').Units} Units */

/** @type {Units} */
const inches = { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
const state = defaultState();
const result = solve(state);
const ctx = /** @type {LayoutContext} */ (createLayout(result, state.geometry).layout);

describe('draw position slider', () => {
  it('reaches both ends exactly in every draw unit', () => {
    for (const draw of /** @type {const} */ (['in', 'mm', 'cm'])) {
      const m = sliderModel(ctx.xBrace, ctx.xFull, { ...inches, draw });
      expect(xOfStep(m, 0)).toBe(ctx.xBrace);
      expect(xOfStep(m, m.count)).toBe(ctx.xFull);
      expect(xOfStep(m, m.count - 1)).toBeLessThan(ctx.xFull);
      expect(stepOfX(m, ctx.xFull)).toBe(m.count);
      expect(stepOfX(m, ctx.xBrace - 1)).toBe(0);
    }
    // Every step reads differently, from a brace off the display grid.
    const grid = sliderModel(ctx.xBrace, ctx.xFull, inches);
    const texts = new Set();
    const pose = createBowPose();
    for (let k = 0; k <= grid.count; k++) {
      bowPoseAt(ctx, xOfStep(grid, k), pose);
      texts.add(positionText(pose, inches, { pin: null, x: pose.x }, xOfStep(grid, k)).split(',')[0]);
    }
    expect(texts.size).toBe(grid.count + 1);
    // The nearest step, also within a short last step.
    const short = sliderModel(0.2, 0.2 + 1.02 * INCH, inches);
    expect(short.count).toBe(11);
    expect(stepOfX(short, 0.2 + 1.015 * INCH)).toBe(11);
    expect(stepOfX(short, 0.2 + 1.004 * INCH)).toBe(10);
    const m = sliderModel(0.2, 0.2 + 1.05 * INCH, inches);
    expect(m.count).toBe(11);
    expect(xOfStep(m, 3)).toBeCloseTo(0.2 + 0.3 * INCH, 12);
    expect(stepOfX(m, 0.2 + 0.31 * INCH)).toBe(3);
  });

  it('keeps brace, full draw or the draw length for a new range', () => {
    expect(placeIn({ pin: 'brace', x: 0.5 }, 0.2, 0.7)).toBe(0.2);
    expect(placeIn({ pin: 'full', x: 0.5 }, 0.2, 0.8)).toBe(0.8);
    expect(placeIn({ pin: null, x: 0.5 }, 0.2, 0.8)).toBe(0.5);
    expect(placeIn({ pin: null, x: 0.9 }, 0.2, 0.8)).toBe(0.8);
  });

  it('describes the position', () => {
    const pose = createBowPose();
    bowPoseAt(ctx, ctx.xFull, pose);
    expect(positionText(pose, inches, { pin: 'full', x: ctx.xFull }, ctx.xFull))
      .toMatch(/^Draw 29\.00 in \(full draw\), draw force \d+ N, cam turned \d+\.\d° from brace$/);
    pose.beyondSolution = true;
    expect(positionText(pose, inches, { pin: null, x: ctx.xFull }, ctx.xFull)).toMatch(/beyond the solved range; showing 29\.00 in$/);
  });

  it('finds the peak draw force', () => {
    const x = peakX(ctx);
    let best = -Infinity;
    for (let i = 0; i < ctx.n; i++) best = Math.max(best, ctx.loads.F[i]);
    const i = Array.from(ctx.loads.x).indexOf(x);
    expect(ctx.loads.F[i]).toBe(best);
  });
});

describe('string plan helpers', () => {
  it('bounds both poses, both halves and the grip', () => {
    const b = createBowPose();
    const f = createBowPose();
    bowPoseAt(ctx, ctx.xBrace, b);
    bowPoseAt(ctx, ctx.xFull, f);
    const r = camRadius(result);
    expect(r).toBeGreaterThan(0.02);
    const bounds = planBounds([b, f], r);
    expect(bounds.maxY).toBeCloseTo(b.axleY + r, 12);
    expect(bounds.minY).toBe(-bounds.maxY);
    expect(bounds.maxX).toBeGreaterThanOrEqual(f.x);
    expect(bounds.minX).toBeLessThanOrEqual(Math.min(0, b.pivotX));
  });

  it('names the direction of the limb tip load', () => {
    expect(loadDirection(0, -100)).toBe('along the vertical from the axle towards the grip');
    expect(loadDirection(100, -100)).toBe('45.0° off the vertical from the axle towards the grip, leaning towards the archer');
    expect(loadDirection(-10, -100)).toMatch(/towards the target$/);
    expect(loadDirection(NaN, 1)).toBe('');
  });

  it('lists the lengths in both dimension units for the cords', () => {
    const dims = planDims(ctx, inches);
    expect(dims.map((d) => d.key)).toEqual(['string', 'cable', 'ataBrace', 'ataFull', 'brace', 'draw']);
    expect(dims[0].text).toMatch(/^\d+\.\d mm \(\d+\.\d{3} in\)$/);
    expect(dims[5].text).toBe('29.00 in');
    const partial = { ...ctx, lengths: { ...ctx.lengths, ataFull: NaN, string: NaN } };
    const texts = planDims(partial, inches);
    expect(texts[0].text).toBe('—');
    expect(texts[3].text).toBe('not solved to full draw');
  });
});

describe('loads chart helpers', () => {
  it('spans the loads from 0 to above the largest load', () => {
    const { lo, hi } = loadRange(ctx.loads);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(1.1 * ctx.loads.maxAxle.value, 9);
    expect(loadRange({ ...ctx.loads, min: -20 }).lo).toBe(-22);
  });

  it('splits a series at missing values', () => {
    const runs = seriesRuns([0, 1, 2, 3, 4], [1, 2, NaN, 3, 4], (x) => x * 10, (y) => y);
    expect(runs).toEqual(['0.0,1.0 10.0,2.0', '30.0,3.0 40.0,4.0']);
    expect(SERIES.map((s) => s.key)).toEqual(['Ts', 'Tc', 'axleLoad']);
  });

  it('tabulates 11 positions and leaves out unsolved ones', () => {
    const rows = tableRows(ctx);
    expect(rows).toHaveLength(11);
    expect(rows[0].pose?.x).toBe(ctx.xBrace);
    expect(rows[10].pose?.x).toBe(ctx.xFull);
    const cut = { ...ctx, valid: 500, xLast: ctx.a.x[499] };
    const partial = tableRows(cut);
    expect(partial[10].pose).toBeNull();
    expect(partial[0].pose).not.toBeNull();
  });
});

describe('force chart marker', () => {
  it('interpolates the achieved force and stops at missing values', () => {
    const overlay = { x: Float64Array.from([0, 1, 2, 3]), F: Float64Array.from([0, 10, NaN, 30]) };
    expect(forceAt(overlay, 0.5)).toBe(5);
    expect(forceAt(overlay, 1)).toBe(10);
    expect(forceAt(overlay, 1.5)).toBeNaN();
    expect(forceAt(overlay, 4)).toBeNaN();
  });
});

describe('age captions of the plan and the loads', () => {
  it('names the previous inputs while a newer solve runs', () => {
    expect(ageCaption(false, false, 'S', 'O')).toBe('');
    expect(ageCaption(true, false, 'S', 'O')).toBe('S');
    expect(ageCaption(false, true, 'S', 'O')).toBe('O');
    expect(ageCaption(true, true, 'S', 'O')).toBe('O');
  });
});

describe('full-draw pose of the plan', () => {
  it('exists only when the solve reached full draw', () => {
    const pose = createBowPose();
    expect(fullDrawPose(ctx, pose)).toBe(true);
    expect(pose.x).toBe(ctx.xFull);
    const partial = { ...ctx, valid: 500, xLast: ctx.a.x[499] };
    expect(fullDrawPose(partial, pose)).toBe(false);
  });
});
