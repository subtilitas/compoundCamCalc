import { describe, expect, it } from 'vitest';
import {
  GENERATOR_DEFAULTS, MAX_FORCE, MAX_POINTS, MIN_FORCE, MIN_GAP, MIN_LET_OFF, VALLEY_BAND,
  addPoint, addPointInWidestGap, curveMetrics, drawRange, generateCurve, movePoint, pointMetrics,
  removePoint, removeRefusal, scalePeak, setLetOff,
} from '../../src/core/curve.js';
import { createCurve } from '../../src/core/interp.js';
import { AMO_OFFSET, INCH } from '../../src/core/units.js';

/** @typedef {import('../../src/core/interp.js').CurvePoint} CurvePoint */

const xBrace = 6.5 * INCH;
const xFull = 29 * INCH - AMO_OFFSET;
const defaults = { xBrace, xFull, peak: 267, letOff: 0.8 };

/** @type {CurvePoint[]} */
const sample = [
  { x: 0.1651, F: 0 },
  { x: 0.2, F: 150 },
  { x: 0.3, F: 250 },
  { x: 0.5, F: 120 },
  { x: 0.6, F: 60 },
];

describe('drawRange', () => {
  it('maps brace height and AMO draw length to nock positions', () => {
    const r = drawRange(6.5 * INCH, 29 * INCH);
    expect(r.xBrace).toBeCloseTo(0.1651, 15);
    expect(r.xFull).toBeCloseTo(27.25 * INCH, 15);
  });
});

describe('curveMetrics', () => {
  it('measures peak, holding weight, let-off, valley and energy', () => {
    const curve = createCurve(sample);
    const m = curveMetrics(curve);
    expect(m.peak).toBeCloseTo(250, 9);
    expect(m.xPeak).toBeCloseTo(0.3, 8);
    expect(m.hold).toBeCloseTo(60, 9);
    expect(m.xHold).toBeCloseTo(0.6, 8);
    expect(m.letOff).toBeCloseTo(190 / 250, 12);
    expect(m.powerStroke).toBeCloseTo(0.6 - 0.1651, 15);
    expect(m.energy).toBeCloseTo(curve.integral(0.1651, 0.6), 12);
    const level = m.hold + VALLEY_BAND * m.peak;
    expect(curve.evaluate(m.valleyStart)).toBeCloseTo(level, 5);
    expect(m.valleyEnd).toBe(0.6);
    expect(m.valleyWidth).toBeCloseTo(m.valleyEnd - m.valleyStart, 15);
    for (let x = m.valleyStart; x <= m.valleyEnd; x += 0.001) expect(curve.evaluate(x)).toBeLessThanOrEqual(level + 1e-6);
  });

  it('finds a valley with walls on both sides', () => {
    /** @type {CurvePoint[]} */
    const data = [
      { x: 0, F: 0 },
      { x: 0.1, F: 200 },
      { x: 0.3, F: 40 },
      { x: 0.35, F: 30 },
      { x: 0.4, F: 150 },
    ];
    const curve = createCurve(data);
    const m = curveMetrics(curve);
    const level = m.hold + VALLEY_BAND * m.peak;
    expect(m.hold).toBeCloseTo(30, 9);
    expect(m.xHold).toBeCloseTo(0.35, 7);
    expect(curve.evaluate(m.valleyStart)).toBeCloseTo(level, 5);
    expect(curve.evaluate(m.valleyEnd)).toBeCloseTo(level, 5);
    expect(m.valleyStart).toBeLessThan(0.35);
    expect(m.valleyEnd).toBeGreaterThan(0.35);
    expect(m.valleyEnd).toBeLessThan(0.4);
  });

  it('refines a peak between knots', () => {
    const data = [0, 0.1, 0.2, 0.3].map((x) => ({ x, F: x === 0 ? 0 : 100 - 1000 * (x - 0.17) ** 2 }));
    const m = pointMetrics(data);
    const curve = createCurve(data);
    for (let x = 0; x <= 0.3; x += 1e-4) expect(curve.evaluate(x)).toBeLessThanOrEqual(m.peak + 1e-9);
    expect(m.peak).toBeGreaterThanOrEqual(Math.max(...data.map((p) => p.F)));
  });

  it('reports zero let-off for a rising curve', () => {
    const m = pointMetrics([
      { x: 0, F: 0 },
      { x: 0.2, F: 100 },
      { x: 0.4, F: 200 },
    ]);
    expect(m.peak).toBeCloseTo(200, 9);
    expect(m.letOff).toBe(0);
    expect(m.valleyWidth).toBeCloseTo(0.4 - m.xPeak, 9);
  });

  it('reports zero let-off for a curve without force', () => {
    const m = pointMetrics([
      { x: 0, F: 0 },
      { x: 0.2, F: 0 },
    ]);
    expect(m.letOff).toBe(0);
    expect(m.energy).toBe(0);
  });
});

describe('generateCurve', () => {
  it('meets peak and let-off within 1 % with default fractions', () => {
    const points = generateCurve(defaults);
    expect(points).toHaveLength(7);
    const m = pointMetrics(points);
    expect(Math.abs(m.peak - 267) / 267).toBeLessThan(0.01);
    expect(Math.abs(m.letOff - 0.8) / 0.8).toBeLessThan(0.01);
    expect(Math.abs(m.valleyWidth - GENERATOR_DEFAULTS.valleyWidth) / GENERATOR_DEFAULTS.valleyWidth).toBeLessThan(0.01);
  });

  it('starts at brace with 0 N and ends at full draw with the holding weight', () => {
    const points = generateCurve(defaults);
    expect(points[0]).toEqual({ x: xBrace, F: 0 });
    expect(points[6].x).toBe(xFull);
    expect(points[6].F).toBeCloseTo(267 * 0.2, 12);
    for (let i = 1; i < points.length; i++) expect(points[i].x - points[i - 1].x).toBeGreaterThanOrEqual(MIN_GAP - 1e-15);
    expect(points[2].x).toBeCloseTo(xBrace + GENERATOR_DEFAULTS.riseFraction * (xFull - xBrace), 12);
  });

  it('follows peak, let-off, rise and valley inputs', () => {
    for (const [peak, letOff, riseFraction, valleyWidth] of [
      [100, 0.5, 0.2, 2 * INCH],
      [100, 0.5, 0.2, 1.5 * INCH],
      [600, 0.9, 0.5, 1.5 * INCH],
      [267, 0.65, 0.3, 3 * INCH],
      [267, 0.5, GENERATOR_DEFAULTS.riseFraction, GENERATOR_DEFAULTS.valleyWidth],
      [267, 0.75, GENERATOR_DEFAULTS.riseFraction, 0.8 * INCH],
      [267, 0.75, 0.3, 0.7 * INCH],
      [267, 0.8, 0.1, 1 * INCH],
    ]) {
      const points = generateCurve({ ...defaults, peak, letOff, riseFraction, valleyWidth });
      const m = pointMetrics(points);
      expect(m.peak).toBeCloseTo(peak, 9);
      expect(m.letOff).toBeCloseTo(letOff, 9);
      expect(Math.abs(m.valleyWidth - valleyWidth) / valleyWidth).toBeLessThan(0.01);
      expect(points[2].x).toBeCloseTo(xBrace + riseFraction * (xFull - xBrace), 12);
    }
  });

  it('moves the let-off transition point on the line towards the valley start for a narrow valley', () => {
    const wide = generateCurve({ ...defaults, letOff: 0.75 });
    const narrow = generateCurve({ ...defaults, letOff: 0.75, valleyWidth: 0.9 * INCH });
    // Both have the shortest flat part; only the transition point differs.
    expect(wide[6].x - wide[5].x).toBeCloseTo(MIN_GAP, 12);
    expect(narrow.slice(0, 4)).toEqual(wide.slice(0, 4));
    expect(narrow.slice(5)).toEqual(wide.slice(5));
    const [T, V, N] = [wide[4], wide[5], narrow[4]];
    const tau = (V.x - N.x) / (V.x - T.x);
    expect(tau).toBeGreaterThan(0.3);
    expect(tau).toBeLessThan(0.8);
    expect((N.F - V.F) / (T.F - V.F)).toBeCloseTo(tau, 12);
    expect(Math.abs(pointMetrics(narrow).valleyWidth / (0.9 * INCH) - 1)).toBeLessThan(1e-6);
  });

  it('keeps the transition point halfway when the valley is within 1 % of the request', () => {
    // At 75 % let-off, rise 46 % and 1.2 in the shortest flat part gives
    // 1.2036 in, 0.3 % above the request.
    const points = generateCurve({ ...defaults, letOff: 0.75 });
    expect(points[6].x - points[5].x).toBeCloseTo(MIN_GAP, 12);
    expect(points[4].x).toBeCloseTo(0.5 * (points[3].x + points[5].x), 15);
    const width = pointMetrics(points).valleyWidth;
    expect(width).toBeGreaterThan(GENERATOR_DEFAULTS.valleyWidth);
    expect(width).toBeLessThan(1.01 * GENERATOR_DEFAULTS.valleyWidth);
  });

  it('keeps the narrowest valley the transition point reaches for a request below it', () => {
    // At 80 % let-off and rise 46 % the narrowest valley is about 0.46 in.
    const points = generateCurve({ ...defaults, valleyWidth: 0.1 * INCH });
    expect(points[6].x - points[5].x).toBeCloseTo(MIN_GAP, 12);
    const width = pointMetrics(points).valleyWidth;
    expect(width).toBeGreaterThan(0.4 * INCH);
    expect(width).toBeLessThan(0.5 * INCH);
    for (const request of [0.2 * INCH, 0.99 * width]) {
      expect(pointMetrics(generateCurve({ ...defaults, valleyWidth: request })).valleyWidth).toBeCloseTo(width, 6);
    }
    expect(pointMetrics(generateCurve({ ...defaults, valleyWidth: 1.05 * width })).valleyWidth / (1.05 * width)).toBeCloseTo(1, 6);
  });

  it('keeps the minimum gap at the shortest valid power stroke', () => {
    const short = { ...defaults, xFull: xBrace + 5 * INCH + 1e-9 };
    for (const riseFraction of [0.1, 0.3, 0.6]) {
      for (const valleyWidth of [0.1 * INCH, 1.25 * INCH, 6 * INCH]) {
        for (const letOff of [0, 0.5, 0.95]) {
          const points = generateCurve({ ...short, riseFraction, valleyWidth, letOff });
          for (let i = 1; i < points.length; i++) expect(points[i].x - points[i - 1].x).toBeGreaterThanOrEqual(MIN_GAP - 1e-12);
        }
      }
    }
  });

  it('rejects a short stroke or out-of-range forces', () => {
    expect(() => generateCurve({ ...defaults, xFull: xBrace + INCH })).toThrow(RangeError);
    expect(() => generateCurve({ ...defaults, xFull: NaN })).toThrow(RangeError);
    expect(() => generateCurve({ ...defaults, peak: 0 })).toThrow(RangeError);
    expect(() => generateCurve({ ...defaults, letOff: 1 })).toThrow(RangeError);
  });
});

describe('movePoint', () => {
  const points = generateCurve(defaults);

  it('keeps the brace point fixed', () => {
    const next = movePoint(points, 0, { x: 0.3, F: 100 });
    expect(next).toEqual(points);
    expect(next).not.toBe(points);
  });

  it('moves only the force of the last point', () => {
    const next = movePoint(points, 6, { x: 0.3, F: 80 });
    expect(next[6]).toEqual({ x: xFull, F: 80 });
  });

  it('clamps interior x between the neighbours with the minimum gap', () => {
    expect(movePoint(points, 3, { x: 0 })[3].x).toBeCloseTo(points[2].x + MIN_GAP, 15);
    expect(movePoint(points, 3, { x: 10 })[3].x).toBeCloseTo(points[4].x - MIN_GAP, 15);
    expect(movePoint(points, 3, { x: 0.5, F: 300 })[3]).toEqual({ x: 0.5, F: 300 });
  });

  it('clamps forces to 1 N and 5000 N', () => {
    expect(movePoint(points, 2, { F: -5 })[2].F).toBe(MIN_FORCE);
    expect(movePoint(points, 2, { F: 1e6 })[2].F).toBe(MAX_FORCE);
  });

  it('ignores non-finite targets and invalid indices', () => {
    expect(movePoint(points, 2, { x: NaN, F: Infinity })).toEqual(points);
    expect(movePoint(points, 9, { F: 10 })).toEqual(points);
  });

  it('never moves a point towards a neighbour closer than the gap', () => {
    /** @type {CurvePoint[]} */
    const tight = [
      { x: 0, F: 0 },
      { x: 0.001, F: 10 },
      { x: 0.002, F: 20 },
    ];
    expect(movePoint(tight, 1, { x: 0.0015 })[1].x).toBe(0.001);
    expect(movePoint(tight, 1, { x: 0.0005 })[1].x).toBe(0.001);
    /** @type {CurvePoint[]} */
    const squeezed = [
      { x: 0, F: 0 },
      { x: 0.1, F: 10 },
      { x: 0.1 + MIN_GAP / 2, F: 20 },
      { x: 0.2, F: 30 },
    ];
    // Too close on the left: a move to the left keeps x, a move to the right works.
    expect(movePoint(squeezed, 2, { x: 0.1, F: 25 })[2]).toEqual({ x: 0.1 + MIN_GAP / 2, F: 25 });
    expect(movePoint(squeezed, 2, { x: 0.15 })[2].x).toBe(0.15);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(points);
    movePoint(points, 3, { x: 0.5, F: 300 });
    expect(JSON.stringify(points)).toBe(before);
  });
});

describe('addPoint', () => {
  const points = generateCurve(defaults);

  it('inserts in order with the interpolant force by default', () => {
    const x = 0.5 * (points[3].x + points[4].x);
    const r = addPoint(points, x);
    expect(r.error).toBeNull();
    expect(r.index).toBe(4);
    expect(r.points).toHaveLength(8);
    expect(r.points[4].x).toBe(x);
    expect(r.points[4].F).toBeCloseTo(createCurve(points).evaluate(x), 12);
    expect(pointMetrics(r.points).peak).toBeCloseTo(267, 9);
  });

  it('uses and clamps a given force', () => {
    const x = 0.5 * (points[3].x + points[4].x);
    expect(addPoint(points, x, 123).points[4].F).toBe(123);
    expect(addPoint(points, x, 0).points[4].F).toBe(MIN_FORCE);
  });

  it('refuses points within the minimum gap or outside the stroke', () => {
    expect(addPoint(points, points[3].x + MIN_GAP / 2).error).toMatch(/too close/);
    expect(addPoint(points, xBrace).error).toMatch(/between brace and full draw/);
    expect(addPoint(points, xFull + 0.01).error).toMatch(/between brace and full draw/);
    expect(addPoint(points, NaN).error).toMatch(/between brace and full draw/);
    const refused = addPoint(points, points[3].x);
    expect(refused.index).toBe(-1);
    expect(refused.points).toEqual(points);
  });

  it('refuses more than the maximum number of points', () => {
    const many = Array.from({ length: MAX_POINTS }, (_, i) => ({ x: i * 0.01, F: i === 0 ? 0 : 100 }));
    expect(addPoint(many, 0.105).error).toMatch(/at most/);
  });

  it('adds in the middle of the widest gap', () => {
    const r = addPointInWidestGap(points);
    let widest = 0;
    for (let k = 1; k < points.length - 1; k++) {
      if (points[k + 1].x - points[k].x > points[widest + 1].x - points[widest].x) widest = k;
    }
    expect(r.points[widest + 1].x).toBeCloseTo(0.5 * (points[widest].x + points[widest + 1].x), 15);
  });
});

describe('removePoint', () => {
  const points = generateCurve(defaults);

  it('removes an interior point', () => {
    const r = removePoint(points, 4);
    expect(r.error).toBeNull();
    expect(r.points).toHaveLength(6);
    expect(r.points[4]).toEqual(points[5]);
  });

  it('refuses the brace point, the full-draw point and short curves', () => {
    expect(removePoint(points, 0).error).toMatch(/brace/);
    expect(removePoint(points, 6).error).toMatch(/full-draw/);
    expect(removePoint(points.slice(0, 2).concat(points[6]), 1).error).toMatch(/at least 3/);
    expect(removeRefusal(points, -1)).toMatch(/No point/);
    expect(removeRefusal(points, 1.5)).toMatch(/No point/);
    expect(removeRefusal(points, 3)).toBeNull();
  });
});

describe('scalePeak', () => {
  it('scales all points but the brace point', () => {
    const points = generateCurve(defaults);
    const next = scalePeak(points, 300);
    expect(next[0].F).toBe(0);
    for (let i = 1; i < points.length; i++) expect(next[i].F).toBeCloseTo((points[i].F * 300) / 267, 10);
    expect(pointMetrics(next).peak).toBeCloseTo(300, 9);
    expect(pointMetrics(next).letOff).toBeCloseTo(0.8, 9);
  });

  it('clamps to the force limits and ignores invalid input', () => {
    const points = generateCurve(defaults);
    expect(Math.max(...scalePeak(points, 1e5).map((p) => p.F))).toBe(MAX_FORCE);
    expect(scalePeak(points, NaN)).toEqual(points);
    const flat = [
      { x: 0, F: 0 },
      { x: 1, F: 0 },
    ];
    expect(scalePeak(flat, 100)).toEqual(flat);
  });
});

describe('setLetOff', () => {
  it('sets the holding weight by an affine map after the peak', () => {
    const points = generateCurve(defaults);
    const r = setLetOff(points, 0.65);
    expect(r.letOff).toBeCloseTo(0.65, 9);
    for (let i = 0; i <= 3; i++) expect(r.points[i]).toEqual(points[i]);
    expect(pointMetrics(r.points).hold).toBeCloseTo(267 * 0.35, 9);
    expect(pointMetrics(r.points).peak).toBeCloseTo(267, 9);
  });

  it('keeps every force at 1 N or more and returns the achieved let-off', () => {
    const points = generateCurve(defaults);
    const r = setLetOff(points, 1);
    expect(Math.min(...r.points.slice(1).map((p) => p.F))).toBeGreaterThanOrEqual(MIN_FORCE);
    expect(r.letOff).toBeCloseTo((267 - 1) / 267, 9);
  });

  it('restores the points after a let-off of 0 %', () => {
    const points = generateCurve(defaults);
    const flat = setLetOff(points, 0);
    expect(flat.letOff).toBeCloseTo(MIN_LET_OFF, 9);
    for (const p of flat.points.slice(4)) expect(p.F).toBeLessThan(267);
    const back = setLetOff(flat.points, 0.8);
    expect(back.letOff).toBeCloseTo(0.8, 9);
    back.points.forEach((p, i) => {
      expect(p.x).toBe(points[i].x);
      expect(Math.abs(p.F - points[i].F)).toBeLessThan(1e-6);
    });
  });

  it('leaves a curve that peaks at full draw unchanged', () => {
    const rising = [
      { x: 0, F: 0 },
      { x: 0.2, F: 100 },
      { x: 0.4, F: 200 },
    ];
    const r = setLetOff(rising, 0.5);
    expect(r.points).toEqual(rising);
    expect(r.letOff).toBe(0);
  });
});
