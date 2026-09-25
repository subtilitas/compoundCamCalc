import { describe, expect, it } from 'vitest';
import { INCH } from '../../src/core/units.js';
import {
  FIT_PADDING,
  KEYS_HELP,
  MAX_ZOOM,
  camLabel,
  camSummary,
  clampView,
  niceLength,
  outlineBounds,
  panView,
  pathOf,
  staleCaption,
  viewBoxFor,
  zoomView,
} from '../../src/ui/camview.js';

/** @typedef {import('../../src/core/solve.js').SolveResult} SolveResult */

/**
 * Closed outline from points (last point repeats the first).
 * @param {[number, number][]} pts
 */
function outline(pts) {
  const all = [...pts, pts[0]];
  return { x: Float64Array.from(all, (p) => p[0]), y: Float64Array.from(all, (p) => p[1]) };
}

/**
 * @param {Partial<SolveResult>} over
 * @returns {SolveResult}
 */
function result(over) {
  return /** @type {SolveResult} */ (/** @type {unknown} */ ({ outlines: {}, posts: [], marks: [], metrics: null, ...over }));
}

describe('outlineBounds', () => {
  it('covers outlines, posts and the bore', () => {
    const r = result({
      outlines: {
        stringFlange: outline([[-0.02, -0.01], [0.03, -0.01], [0.03, 0.025], [-0.02, 0.025]]),
        cablePitch: outline([[-0.01, -0.03], [0.01, -0.03], [0, 0.01]]),
      },
      posts: [{ id: 'string-post', x: 0.04, y: 0, radius: 0.003, psi: 0 }],
    });
    expect(outlineBounds(r, 0.005)).toEqual({ minX: -0.02, maxX: expect.closeTo(0.043, 12), minY: -0.03, maxY: 0.025 });
  });

  it('is the bore alone when nothing else exists', () => {
    expect(outlineBounds(result({}), 0.004)).toEqual({ minX: -0.004, maxX: 0.004, minY: -0.004, maxY: 0.004 });
  });

  it('skips non-finite points', () => {
    const o = { x: Float64Array.from([0.01, NaN, -0.01]), y: Float64Array.from([0.02, 1, -0.02]) };
    expect(outlineBounds(result({ outlines: { stringPitch: o } }), 0)).toEqual({ minX: -0.01, maxX: 0.01, minY: -0.02, maxY: 0.02 });
  });

  it('skips non-finite posts and a non-finite bore radius', () => {
    const r = result({ posts: [{ id: 'cable-stop', x: NaN, y: 0, radius: 0.003, psi: 0 }] });
    expect(outlineBounds(r, NaN)).toEqual({ minX: -0, maxX: 0, minY: -0, maxY: 0 });
    const v = viewBoxFor(outlineBounds(r, NaN), FIT_PADDING);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y) && v.size > 0).toBe(true);
  });
});

describe('viewBoxFor', () => {
  it('is square, centred, padded and flipped in y', () => {
    const v = viewBoxFor({ minX: 0, maxX: 0.1, minY: 0.01, maxY: 0.05 }, FIT_PADDING);
    expect(v.size).toBeCloseTo(0.1 * 1.16, 12);
    expect(v.x + v.size / 2).toBeCloseTo(0.05, 12);
    expect(v.y + v.size / 2).toBeCloseTo(-0.03, 12);
  });

  it('uses the taller side when the bounds are tall', () => {
    const v = viewBoxFor({ minX: -0.01, maxX: 0.01, minY: -0.05, maxY: 0.05 }, 0);
    expect(v).toEqual({ x: -0.05, y: -0.05, size: 0.1 });
  });

  it('keeps a positive size for empty bounds', () => {
    expect(viewBoxFor({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 0.08).size).toBeGreaterThan(0);
  });
});

describe('niceLength', () => {
  it('picks 1, 2 or 5 times a power of ten not above the limit', () => {
    expect(niceLength(0.0237, 'mm')).toEqual({ metres: expect.closeTo(0.02, 12), label: '20 mm' });
    expect(niceLength(0.012, 'mm').label).toBe('10 mm');
    expect(niceLength(0.0049, 'mm').label).toBe('2 mm');
    expect(niceLength(0.005, 'mm').label).toBe('5 mm');
    expect(niceLength(0.001, 'mm').label).toBe('1 mm');
    expect(niceLength(0.0004, 'mm').label).toBe('0.2 mm');
  });

  it('works in inches', () => {
    const n = niceLength(0.8 * INCH, 'in');
    expect(n.label).toBe('0.5 in');
    expect(n.metres).toBeCloseTo(0.5 * INCH, 12);
    expect(niceLength(3 * INCH, 'in').label).toBe('2 in');
  });

  it('gives 1 unit for a limit that is not positive and finite', () => {
    expect(niceLength(0, 'mm')).toEqual({ metres: expect.closeTo(0.001, 12), label: '1 mm' });
    expect(niceLength(NaN, 'in').label).toBe('1 in');
  });

  it('never exceeds the limit', () => {
    for (let m = 1e-4; m < 1; m *= 1.37) {
      const n = niceLength(m, 'mm');
      expect(n.metres).toBeLessThanOrEqual(m * (1 + 1e-9));
      expect(n.metres).toBeGreaterThan(m / 2.6);
    }
  });
});

describe('pathOf', () => {
  it('writes a closed path with y flipped and rounded to 1e-6 m', () => {
    const o = outline([[0.0123456789, 0.02], [-0.01, -0.0300000004], [0, 0.0000001]]);
    expect(pathOf(o)).toBe('M 0.012346 -0.02 L -0.01 0.03 L 0 0 Z');
  });

  it('keeps the last point when it differs from the first', () => {
    const o = { x: Float64Array.from([0, 1, 1]), y: Float64Array.from([0, 0, 1]) };
    expect(pathOf(o)).toBe('M 0 0 L 1 0 L 1 -1 Z');
  });

  it('leaves out non-finite points', () => {
    const o = { x: Float64Array.from([0, NaN, 1, 1, 0]), y: Float64Array.from([0, 0, 0, 1, 0]) };
    expect(pathOf(o)).toBe('M 0 0 L 1 0 L 1 -1 Z');
  });

  it('is empty for fewer than two points', () => {
    expect(pathOf({ x: new Float64Array(1), y: new Float64Array(1) })).toBe('');
  });
});

describe('zoom and pan', () => {
  const base = { x: -0.05, y: -0.05, size: 0.1 };

  it('keeps the point under the pointer', () => {
    const v = zoomView(base, base, 2, 0.25, 0.75);
    expect(v.size).toBeCloseTo(0.05, 12);
    expect(v.x + 0.25 * v.size).toBeCloseTo(base.x + 0.25 * base.size, 12);
    expect(v.y + 0.75 * v.size).toBeCloseTo(base.y + 0.75 * base.size, 12);
  });

  it('limits the zoom to 1 to 8 times', () => {
    let v = base;
    for (let i = 0; i < 20; i++) v = zoomView(v, base, 1.5, 0.5, 0.5);
    expect(base.size / v.size).toBeCloseTo(MAX_ZOOM, 12);
    for (let i = 0; i < 20; i++) v = zoomView(v, base, 1 / 1.5, 0.1, 0.9);
    expect(v).toEqual(base);
  });

  it('keeps a panned view inside the fitted box', () => {
    expect(clampView({ x: 0.2, y: -0.3, size: 0.02 }, base)).toEqual({ x: expect.closeTo(0.03, 12), y: -0.05, size: 0.02 });
  });
});

describe('camSummary', () => {
  it('names the largest dimension in the dimension unit', () => {
    const r = result({ metrics: /** @type {any} */ ({ camMaxDimension: 0.0842 }) });
    expect(camSummary(r, 'mm')).toBe('Cam view, largest dimension 84.2 mm');
    expect(camSummary(r, 'in')).toBe('Cam view, largest dimension 3.315 in');
    expect(camSummary(null, 'mm')).toBe('Cam view: solving');
    expect(camSummary(result({}), 'mm')).toBe('Cam view');
  });
});

describe('camLabel', () => {
  const r = result({ metrics: /** @type {any} */ ({ camMaxDimension: 0.0842 }) });

  it('adds the keys to the summary', () => {
    expect(camLabel(r, 'mm', false)).toBe(`Cam view, largest dimension 84.2 mm; ${KEYS_HELP}`);
    expect(KEYS_HELP).toBe('arrow keys pan, plus and minus zoom, 0 fits');
  });

  it('marks a stale drawing', () => {
    expect(camLabel(r, 'mm', true)).toBe(`Cam view, largest dimension 84.2 mm; ${KEYS_HELP}, last cam that met every check`);
  });

  it('names a solver error when no result exists', () => {
    expect(camLabel(null, 'mm', false, 'error')).toMatch(/^Cam view: no cam, the solver stopped with an error;/);
    expect(camLabel(null, 'mm', false, 'busy')).toMatch(/^Cam view: solving;/);
  });
});

describe('panView', () => {
  const base = { x: -0.05, y: -0.05, size: 0.1 };

  it('moves by a fraction of the visible size', () => {
    const v = { x: -0.01, y: -0.01, size: 0.02 };
    expect(panView(v, base, 0.1, -0.5)).toEqual({ x: expect.closeTo(-0.008, 12), y: expect.closeTo(-0.02, 12), size: 0.02 });
  });

  it('stays inside the fitted box', () => {
    expect(panView({ x: 0.02, y: -0.05, size: 0.02 }, base, 0.5, -0.5)).toEqual({ x: expect.closeTo(0.03, 12), y: -0.05, size: 0.02 });
    expect(panView(base, base, 0.5, 0.5)).toEqual(base);
  });
});

describe('staleCaption', () => {
  it('does not call inputs failing while they are being solved', () => {
    expect(staleCaption('busy')).toBe('Last cam that met every check; solving the current inputs');
    expect(staleCaption('error')).toMatch(/solver stopped with an error/);
    expect(staleCaption('idle')).toMatch(/the current inputs fail the checks/);
    expect(staleCaption('pending')).toBe('Cam of the previous inputs; solving the current inputs');
  });
});
