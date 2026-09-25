import { describe, expect, it } from 'vitest';
import { AMO_OFFSET, INCH, toSI } from '../../src/core/units.js';
import { CODES } from '../../src/core/diagnostics.js';
import { achievedPath, forceTop, legendPosition, rangeTitle, wrapLabel } from '../../src/ui/chart.js';
import { amo } from '../../src/ui/display.js';

/** @type {import('../../src/state/schema.js').Units} */
const inches = { draw: 'in', force: 'lbf', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {import('../../src/state/schema.js').Units} */
const metric = { ...inches, draw: 'mm', force: 'N' };

const box = { left: 50, right: 250, top: 20, bottom: 220 };
const xb = 6 * INCH;
const xf = 26 * INCH;
const yMaxN = toSI(80, 'force', 'lbf');

/** @param {import('../../src/state/schema.js').Units} units */
function scalesFor(units) {
  return { units, x0: amo(xb, units), x1: amo(xf, units), yMax: toSI(80, 'force', 'lbf') / toSI(1, 'force', units.force), ...box };
}

/** @param {string} run */
const parse = (run) => run.split(' ').map((p) => p.split(',').map(Number));

describe('achievedPath', () => {
  it('maps brace and full draw to the plot edges and force to height', () => {
    const runs = achievedPath({ x: [xb, 16 * INCH, xf], F: [0, yMaxN / 2, yMaxN] }, scalesFor(inches));
    expect(runs).toHaveLength(1);
    expect(parse(runs[0])).toEqual([[50, 220], [150, 120], [250, 20]]);
  });

  it('uses the AMO draw length for the x mapping', () => {
    // Axis from 0 to 30 in AMO: the nock at 0 m sits at 1.75 in AMO.
    const s = { ...scalesFor(inches), x0: 0, x1: 30 };
    const [run] = achievedPath({ x: [0, 30 * INCH - AMO_OFFSET], F: [0, 0] }, s);
    const [[a], [b]] = parse(run);
    expect(a).toBeCloseTo(50 + (1.75 / 30) * 200, 1);
    expect(b).toBe(250);
  });

  it('gives the same pixels after a unit switch', () => {
    const x = Float64Array.from({ length: 21 }, (_, j) => xb + ((xf - xb) * j) / 20);
    const F = Float64Array.from(x, (v) => 200 + 100 * Math.sin(v * 7));
    const a = achievedPath({ x, F }, scalesFor(inches)).map(parse);
    const b = achievedPath({ x, F }, scalesFor(metric)).map(parse);
    expect(b).toHaveLength(a.length);
    a[0].forEach(([X, Y], j) => {
      expect(Math.abs(b[0][j][0] - X)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(b[0][j][1] - Y)).toBeLessThanOrEqual(0.1);
    });
  });

  it('splits the curve at non-finite samples and drops lone samples', () => {
    const x = [xb, 8 * INCH, NaN, 12 * INCH, 14 * INCH, 16 * INCH, 18 * INCH, 20 * INCH, 22 * INCH];
    const F = [10, 20, 30, 40, 50, Infinity, 70, 80, NaN];
    const runs = achievedPath({ x, F }, scalesFor(inches));
    expect(runs.map((r) => parse(r).length)).toEqual([2, 2, 2]);
    for (const r of runs) expect(r).not.toMatch(/NaN|Infinity/);
  });

  it('returns no runs for empty or fully invalid samples', () => {
    expect(achievedPath({ x: [], F: [] }, scalesFor(inches))).toEqual([]);
    expect(achievedPath({ x: [NaN, NaN], F: [1, 2] }, scalesFor(inches))).toEqual([]);
    expect(achievedPath({ x: [xb], F: [1] }, scalesFor(inches))).toEqual([]);
  });

  it('uses the shorter array when the lengths differ', () => {
    const runs = achievedPath({ x: [xb, 10 * INCH, 14 * INCH], F: [1, 2] }, scalesFor(inches));
    expect(parse(runs[0])).toHaveLength(2);
  });
});

describe('forceTop', () => {
  it('sits 15 % above the target peak without an overlay', () => {
    expect(forceTop([0, 100, 300, 120])).toBeCloseTo(345, 9);
    expect(forceTop([0, 100, 300, 120], null)).toBeCloseTo(345, 9);
  });

  it('keeps at least 11.5 N', () => {
    expect(forceTop([0, 2])).toBe(11.5);
  });

  it('rises to 5 % above an achieved peak that passes the target scale', () => {
    expect(forceTop([0, 300], Float64Array.from([0, 400, 200]))).toBeCloseTo(420, 9);
    expect(forceTop([0, 300], [0, 310])).toBeCloseTo(345, 9);
  });

  it('ignores non-finite achieved forces', () => {
    expect(forceTop([0, 300], [NaN, Infinity, 100])).toBeCloseTo(345, 9);
  });
});

describe('rangeTitle', () => {
  it('names the condition of the code and the AMO draw range in display units', () => {
    const r = { from: 20 * INCH - AMO_OFFSET, to: 28 * INCH - AMO_OFFSET, code: 'slack-string' };
    expect(rangeTitle(r, inches)).toBe('The string tension of the achieved cam is zero or negative between 20.0 in and 28.0 in');
    expect(rangeTitle(r, metric)).toBe('The string tension of the achieved cam is zero or negative between 508 mm and 711 mm');
  });

  it('takes the text from CODES and never shows the bare code', () => {
    const r = { from: 12.1 * INCH - AMO_OFFSET, to: 17.8 * INCH - AMO_OFFSET, code: 'cable-radius' };
    const text = rangeTitle(r, inches);
    expect(text).toBe(`T${CODES['cable-radius'].slice(1)} between 12.1 in and 17.8 in`);
    expect(text).not.toContain('cable-radius');
  });

  it('orders reversed ends and names a single position', () => {
    const at = 25 * INCH - AMO_OFFSET;
    const c = 'slack-string';
    const cond = 'The string tension of the achieved cam is zero or negative';
    expect(rangeTitle({ from: at + INCH, to: at, code: c }, inches)).toBe(`${cond} between 25.0 in and 26.0 in`);
    expect(rangeTitle({ from: at, to: at, code: c }, inches)).toBe(`${cond} at 25.0 in`);
  });

  it('shows an unknown code as it is', () => {
    const at = 25 * INCH - AMO_OFFSET;
    expect(rangeTitle({ from: at, to: at + INCH, code: 'other' }, inches)).toBe('Other between 25.0 in and 26.0 in');
  });
});

describe('legendPosition', () => {
  const plot = { left: 58, right: 318, top: 30, bottom: 230 };

  it('puts the legend at the bottom middle when nothing lies there', () => {
    expect(legendPosition(plot, 100, 50, [])).toEqual({ x: 138, y: 174 });
  });

  it('moves to the candidate with the fewest samples inside', () => {
    // Samples fill the bottom half: the top right corner is free.
    /** @type {[number, number][]} */
    const samples = [];
    for (let X = 58; X <= 318; X += 4) for (let Y = 130; Y <= 230; Y += 10) samples.push([X, Y]);
    samples.push([100, 50]);
    expect(legendPosition(plot, 100, 50, samples)).toEqual({ x: 212, y: 36 });
  });

  it('avoids a rising curve on a narrow chart', () => {
    // Straight line from the bottom left to the top right corner.
    /** @type {[number, number][]} */
    const samples = Array.from({ length: 101 }, (_, j) => [58 + 2.6 * j, 230 - 2 * j]);
    const { x, y } = legendPosition(plot, 110, 44, samples);
    const inside = samples.filter(([X, Y]) => X >= x && X <= x + 110 && Y >= y && Y <= y + 44);
    expect(inside).toHaveLength(0);
  });

  it('stays inside a plot smaller than the box', () => {
    const small = { left: 10, right: 60, top: 10, bottom: 40 };
    const { x, y } = legendPosition(small, 100, 50, []);
    expect(x).toBe(10);
    expect(y).toBe(10);
  });
});

describe('wrapLabel', () => {
  it('keeps a short label on one line', () => {
    expect(wrapLabel('Achieved', 20)).toEqual(['Achieved']);
  });
  it('splits at spaces to fit the width', () => {
    expect(wrapLabel('Achieved, latest attempt', 18)).toEqual(['Achieved, latest', 'attempt']);
    expect(wrapLabel('Achieved, last valid cam', 10)).toEqual(['Achieved,', 'last valid', 'cam']);
  });
  it('keeps a long word whole', () => {
    expect(wrapLabel('Supercalifragilistic x', 8)).toEqual(['Supercalifragilistic', 'x']);
  });
});
