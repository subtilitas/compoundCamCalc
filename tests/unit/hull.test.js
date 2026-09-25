import { describe, expect, it } from 'vitest';
import { EXPORT_TOLERANCE, evaluate, fitHull, hullArcs } from '../../src/core/bspline.js';
import { solve } from '../../src/core/solve.js';
import { createSupport, eccentricCircle } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';

/** @typedef {import('../../src/core/support.js').SupportData} SupportData */

const state = defaultState();
const result = solve(state);
const t = result.tracks;
const stop = /** @type {any} */ (result.posts.find((p) => p.id === 'cable-stop'));
const boss = eccentricCircle({ radius: stop.radius + state.body.minWall, offset: Math.hypot(stop.x, stop.y), phase: Math.atan2(stop.y, stop.x) });
const sf = /** @type {SupportData} */ (t.flanges.string);
const cf = /** @type {SupportData} */ (t.flanges.cable);
const cableStart = /** @type {any} */ (t.cable).psiStart;

/**
 * Signed distance of S from the convex hull: max over ψ of S·n − h(ψ). For
 * a point near the hull the maximum lies near the normal of the curve
 * there: a grid of ±0.05 rad around it, refined by golden section.
 * @param {import('../../src/core/support.js').Support[]} supports
 * @param {number} x
 * @param {number} y
 * @param {number} normal angle of the curve normal at S (rad)
 */
function hullDistance(supports, x, y, normal) {
  const f = (/** @type {number} */ psi) => x * Math.cos(psi) + y * Math.sin(psi) - Math.max(...supports.map((s) => s.p(psi)));
  const n = 200;
  const w = 0.05;
  let best = normal;
  let bv = -Infinity;
  for (let i = 0; i <= n; i++) {
    const psi = normal - w + (2 * w * i) / n;
    const v = f(psi);
    if (v > bv) {
      bv = v;
      best = psi;
    }
  }
  let a = best - (2 * w) / n;
  let b = best + (2 * w) / n;
  for (let i = 0; i < 60; i++) {
    const m1 = a + (b - a) * 0.382;
    const m2 = a + (b - a) * 0.618;
    if (f(m1) > f(m2)) b = m2;
    else a = m1;
  }
  return Math.max(bv, f((a + b) / 2));
}

describe('hull fit', () => {
  for (const [name, list, psi0] of /** @type {[string, SupportData[], number][]} */ ([
    ['middle flange with the stop boss', [sf, cf, boss], 0],
    ['cable flange with the stop boss', [cf, boss], cableStart],
  ])) {
    it(`${name}: closed, C1 at the seam, within tol/2 of the exact hull`, () => {
      const out = fitHull(list, psi0, EXPORT_TOLERANCE);
      expect(out.error).toBeNull();
      const s = /** @type {NonNullable<typeof out.spline>} */ (out.spline);
      expect(s.closed).toBe(true);
      const m = s.points.length / 2 - 1;
      expect([s.points[2 * m], s.points[2 * m + 1]]).toEqual([s.points[0], s.points[1]]);
      const k = s.knots;
      const a = new Float64Array(6);
      const b = new Float64Array(6);
      evaluate(s, k[3], a);
      evaluate(s, k[k.length - 4], b);
      expect(Math.hypot(a[2] - b[2], a[3] - b[3]) / Math.hypot(a[2], a[3])).toBeLessThan(1e-9);
      const supports = list.map((d) => createSupport(d));
      let worst = 0;
      const out6 = new Float64Array(6);
      for (let span = 3; span < k.length - 4; span++) {
        if (!(k[span + 1] > k[span])) continue;
        for (let j = 0; j <= 8; j++) {
          evaluate(s, k[span] + ((k[span + 1] - k[span]) * j) / 8, out6);
          worst = Math.max(worst, Math.abs(hullDistance(supports, out6[0], out6[1], Math.atan2(-out6[2], out6[3]))));
        }
      }
      expect(worst).toBeLessThanOrEqual(EXPORT_TOLERANCE / 2);
    }, 60_000);
  }

  it('finds a boss arc narrower than one grid cell between two other arcs', () => {
    // Two discs with a common tangent and a small boss 30 µm past it: its
    // arc (0.11°) lies inside one 0.25° cell for either rotation.
    const DEG = Math.PI / 180;
    for (const rot of [0.125 * DEG, 0.25 * DEG]) {
      const list = [
        eccentricCircle({ radius: 0.01, offset: 0.03, phase: Math.PI + rot }),
        eccentricCircle({ radius: 0.005, offset: 0.01 + 3e-5 - 0.005, phase: Math.PI / 2 + rot }),
        eccentricCircle({ radius: 0.01, offset: 0.03, phase: rot }),
      ];
      const supports = list.map((d) => createSupport(d));
      expect(hullArcs(supports, 0.5 * DEG).map((a) => a.index)).toEqual([2, 1, 0, 2]);
      const out = fitHull(list, 0.5 * DEG, EXPORT_TOLERANCE);
      const s = /** @type {NonNullable<typeof out.spline>} */ (out.spline);
      const k = s.knots;
      const o = new Float64Array(6);
      let worst = 0;
      for (let span = 3; span < k.length - 4; span++) {
        if (!(k[span + 1] > k[span])) continue;
        for (let j = 0; j <= 8; j++) {
          evaluate(s, k[span] + ((k[span + 1] - k[span]) * j) / 8, o);
          worst = Math.max(worst, Math.abs(hullDistance(supports, o[0], o[1], Math.atan2(-o[2], o[3]))));
        }
      }
      expect(worst).toBeLessThanOrEqual(EXPORT_TOLERANCE / 2);
    }
  });

  it('finds the arcs and reuses a single track that covers the whole turn', () => {
    const supports = [sf, cf, boss].map((d) => createSupport(d));
    const arcs = hullArcs(supports, 0);
    expect(arcs[0].start).toBe(0);
    expect(arcs.at(-1)?.end).toBeCloseTo(2 * Math.PI, 12);
    for (let i = 1; i < arcs.length; i++) {
      expect(arcs[i].start).toBe(arcs[i - 1].end);
      expect(arcs[i].index).not.toBe(arcs[i - 1].index);
    }
    // A small disc inside the string flange leaves the flange alone.
    const inner = eccentricCircle({ radius: 0.001, offset: 0.002, phase: 0 });
    expect(fitHull([sf, inner], 0, EXPORT_TOLERANCE)).toEqual({ spline: null, single: 0, error: null });
    expect(fitHull([], 0, EXPORT_TOLERANCE).error).toMatch(/at least one track/);
    expect(fitHull([sf], Number.NaN, EXPORT_TOLERANCE).error).toMatch(/finite start angle/);
    expect(fitHull([/** @type {any} */ ({ kind: 'nothing' })], 0, EXPORT_TOLERANCE).error).not.toBeNull();
  });
});
