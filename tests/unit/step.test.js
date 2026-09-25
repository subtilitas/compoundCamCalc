import occtFactory from 'occt-import-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXPORT_TOLERANCE, evaluate } from '../../src/core/bspline.js';
import { solve } from '../../src/core/solve.js';
import { createSupport, eccentricCircle } from '../../src/core/support.js';
import { exportFiles, plateThicknesses } from '../../src/export/files.js';
import { buildExportModel } from '../../src/export/model.js';
import { real, reducedKnots, str, writeStep } from '../../src/export/step.js';
import { defaultState } from '../../src/state/presets.js';
import { checkStep, deref, readStep, sampleCurve } from './step-reader.js';

/** @typedef {import('../../src/export/model.js').ExportModel} ExportModel */
/** @typedef {import('../../src/core/bspline.js').BSpline} BSpline */

const state = defaultState();
const result = solve(state);
const model = /** @type {ExportModel} */ (buildExportModel(result, state).model);
const date = new Date(2026, 8, 25, 12, 34, 56);
const set = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(result, state, { date, version: '0.1.0', units: state.units }).set);
const steps = set.files.filter((f) => f.name.endsWith('.step'));
const stacked = /** @type {(typeof steps)[number]} */ (steps.find((f) => f.part === 'step-cam'));

/**
 * Area enclosed by a closed B-spline (Green's theorem, 3-point Gauss per
 * span: exact for a cubic).
 * @param {BSpline} s
 */
function splineArea(s) {
  const g = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
  const w = [5 / 9, 8 / 9, 5 / 9];
  const out = new Float64Array(6);
  let a = 0;
  for (let span = 3; span < s.knots.length - 4; span++) {
    const u0 = s.knots[span];
    const u1 = s.knots[span + 1];
    if (!(u1 > u0)) continue;
    for (let i = 0; i < 3; i++) {
      evaluate(s, (u0 + u1) / 2 + ((u1 - u0) / 2) * g[i], out);
      a += ((u1 - u0) / 2) * w[i] * 0.5 * (out[0] * out[3] - out[1] * out[2]);
    }
  }
  return a;
}

/**
 * Exact area of the hull of convex tracks: ½∫p(p + p'') dψ on each arc
 * (X × X' = p·ρ) plus ½ P × Q on each common tangent.
 * @param {import('../../src/core/support.js').SupportData[]} list
 * @param {number} psi0
 */
function hullArea(list, psi0) {
  const supports = list.map((d) => createSupport(d));
  // Arcs from a 0.001° scan refined by bisection, independent of hullArcs.
  const best = (/** @type {number} */ psi) => supports.reduce((k, sp, i) => (sp.p(psi) > supports[k].p(psi) ? i : k), 0);
  const n = 360000;
  /** @type {{ index: number, start: number, end: number }[]} */
  const arcs = [];
  let index = best(psi0);
  let start = psi0;
  for (let i = 1; i <= n; i++) {
    const psi = psi0 + (i * 2 * Math.PI) / n;
    const k = best(psi);
    if (k === index) continue;
    let lo = psi - (2 * Math.PI) / n;
    let hi = psi;
    for (let it = 0; it < 60; it++) {
      const m = (lo + hi) / 2;
      if (best(m) === index) lo = m;
      else hi = m;
    }
    arcs.push({ index, start, end: (lo + hi) / 2 });
    index = k;
    start = (lo + hi) / 2;
  }
  arcs.push({ index, start, end: psi0 + 2 * Math.PI });
  const buf = new Float64Array(3);
  const g = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
  const w = [5 / 9, 8 / 9, 5 / 9];
  let a = 0;
  arcs.forEach((arc, k) => {
    const s = supports[arc.index];
    const n = Math.max(64, Math.ceil((arc.end - arc.start) / 1e-3));
    for (let j = 0; j < n; j++) {
      const p0 = arc.start + ((arc.end - arc.start) * j) / n;
      const p1 = arc.start + ((arc.end - arc.start) * (j + 1)) / n;
      for (let i = 0; i < 3; i++) {
        s.evaluate((p0 + p1) / 2 + ((p1 - p0) / 2) * g[i], buf);
        a += ((p1 - p0) / 2) * w[i] * 0.5 * buf[0] * (buf[0] + buf[2]);
      }
    }
    const next = arcs[(k + 1) % arcs.length];
    const P = s.point(arc.end);
    const Q = supports[next.index].point(arc.end);
    a += 0.5 * (P.x * Q.y - P.y * Q.x);
  });
  return a;
}

describe('STEP tokens', () => {
  it('writes REAL tokens with a decimal point and strings escaped', () => {
    expect([0, 1.5, 100, -0.00015, 2.5e-7, 123456789012345, -1].map((v) => real(v))).toEqual(
      ['0.', '1.5', '100.', '-0.00015', '2.5E-7', '1.23456789012E14', '-1.'],
    );
    expect(() => real(Number.NaN)).toThrow(/number expected/);
    expect(str("Bow's \\ cam Ø")).toBe("'Bow''s \\\\ cam \\X2\\00D8\\X0\\'");
    expect(str('\u{1F3F9}')).toBe("'\\X4\\0001F3F9\\X0\\'");
  });

  it('removes a C1 triple knot exactly and keeps a corner', () => {
    // Two Bézier pieces joined C1 in u: h_l = 1, h_r = 2.
    const smooth = /** @type {BSpline} */ ({
      degree: 3, closed: false, maxDeviation: 0,
      knots: Float64Array.from([0, 0, 0, 0, 1, 1, 1, 3, 3, 3, 3]),
      points: Float64Array.from([0, 0, 1, 1, 2, 1, 3, 1, 5, 1, 6, 0, 7, 0]),
    });
    const r = reducedKnots(smooth);
    expect(r.mults).toEqual([4, 2, 4]);
    expect(r.points).toHaveLength(12);
    const corner = { ...smooth, points: Float64Array.from([0, 0, 1, 1, 2, 1, 3, 1, 3, 2, 6, 0, 7, 0]) };
    expect(reducedKnots(corner).mults).toEqual([4, 3, 4]);
  });

  it('refuses documents it cannot write', () => {
    const base = { product: 'x', fileName: 'x.step', description: '', timestamp: '2026-09-25T12:00:00', system: 's' };
    const disc = { circle: { cx: 0, cy: 0, r: 0.01 }, spline: null };
    expect(writeStep({ ...base, solids: [] }).error).toMatch(/at least one solid/);
    expect(writeStep({ ...base, timestamp: '2026-09-25', solids: [{ name: 'a', outline: disc, holes: [], z0: 0, z1: 1 }] }).error).toMatch(/time stamp/);
    expect(writeStep({ ...base, solids: [{ name: 'a', outline: disc, holes: [], z0: 1, z1: 1 }] }).error).toMatch(/z1 above z0/);
    expect(writeStep({ ...base, solids: [{ name: 'a', outline: { circle: null, spline: null }, holes: [], z0: 0, z1: 1 }] }).error).toMatch(/circle or a cubic/);
  });
});

describe('STEP files of the default design', () => {
  it('writes the stacked cam and one file per plate, each passing the Part 21 checks', () => {
    expect(steps.map((f) => f.part)).toEqual(['step-cam', ...model.plates.map((p) => `step-${p.id}`)]);
    for (const f of steps) {
      const r = checkStep(f.text);
      expect(r.problems, f.name).toEqual([]);
    }
    const stack = checkStep(stacked.text);
    expect(stack.solids.map((s) => s.name)).toEqual(model.plates.map((p) => `Plate ${p.name}`));
    expect(stack.curves).toBe(2);
    expect(stacked.text).toContain("'Cable pitch line'");
    expect(stacked.text).toContain("'String pitch line'");
    // n profiles: V = 2n, E = 3n, F = n + 2, L = 3n.
    for (const [i, s] of stack.solids.entries()) {
      const n = model.plates[i].holes.length + 1;
      expect([s.V, s.E, s.F, s.L, s.holes]).toEqual([2 * n, 3 * n, n + 2, 3 * n, n - 1]);
    }
    expect(stacked.text).toContain("FILE_NAME('cam-20260925-");
    expect(stacked.text).toContain("'2026-09-25T12:34:56'");
  }, 30_000);

  it('stacks plate 1 on top and puts the pitch lines in the middle of their groove plates', () => {
    const { entities } = readStep(stacked.text);
    const t = plateThicknesses(state);
    const planes = [...entities.values()].filter((e) => e.type === 'MANIFOLD_SOLID_BREP').map((b) => {
      const shell = deref(entities, b.args[1]);
      const zs = /** @type {any} */ (shell.args[1]).items.map((/** @type {any} */ f) => deref(entities, f))
        .filter((/** @type {any} */ f) => deref(entities, f.args[2]).type === 'PLANE')
        .map((/** @type {any} */ f) => {
          const pl = deref(entities, deref(entities, f.args[2]).args[1]);
          return /** @type {any} */ (deref(entities, pl.args[1]).args[1]).items[2].value;
        });
      return [Math.min(...zs), Math.max(...zs)];
    });
    const H = t.reduce((a, b) => a + b, 0) * 1000;
    expect(planes[0][1]).toBeCloseTo(H, 9);
    expect(planes[4][0]).toBe(0);
    for (let i = 0; i < 4; i++) expect(planes[i][0]).toBeCloseTo(planes[i + 1][1], 9);
    const set = /** @type {any} */ ([...entities.values()].find((e) => e.type === 'GEOMETRIC_CURVE_SET'));
    const zOf = (/** @type {any} */ a) => {
      const e = deref(entities, a);
      const c = e.type === 'TRIMMED_CURVE' ? deref(entities, e.args[1]) : e;
      return sampleCurve(entities, c, 4)[0][2];
    };
    const [stringZ, cableZ] = set.args[1].items.map(zOf);
    expect(stringZ).toBeCloseTo((planes[1][0] + planes[1][1]) / 2, 9);
    expect(cableZ).toBeCloseTo((planes[3][0] + planes[3][1]) / 2, 9);
  });

  it('finds orientation, reference and knot errors', () => {
    const one = /** @type {string} */ (steps[3].text);
    const flipFace = one.replace(/(ADVANCED_FACE\('',\(#\d+\),#\d+,)\.T\.\)/, '$1.F.)');
    expect(checkStep(flipFace).problems.some((p) => /runs the wrong way/.test(p))).toBe(true);
    // Swap the outer and inner bound of the top face: the hole loop runs clockwise.
    const top = /** @type {RegExpExecArray} */ (/ADVANCED_FACE\('',\((#\d+),(#\d+)[,)]/.exec(one));
    const flipBound = one
      .replace(new RegExp(`^${top[1]}=FACE_OUTER_BOUND`, 'm'), `${top[1]}=FACE_BOUND`)
      .replace(new RegExp(`^${top[2]}=FACE_BOUND`, 'm'), `${top[2]}=FACE_OUTER_BOUND`);
    expect(checkStep(flipBound).problems.filter((p) => /runs the wrong way/.test(p)).length).toBeGreaterThanOrEqual(2);
    const dangling = one.replace(/MANIFOLD_SOLID_BREP\(('[^']*'),#\d+\)/, 'MANIFOLD_SOLID_BREP($1,#999999)');
    expect(() => checkStep(dangling)).toThrow(/not defined/);
    // Geometry that disagrees with topology.
    const vertex = /** @type {RegExpExecArray} */ (/VERTEX_POINT\('',(#\d+)\)/.exec(one))[1];
    const moved = one.replace(new RegExp(`^${vertex}=CARTESIAN_POINT\\('',\\(([^,]+),`, 'm'), (_m, x) => `${vertex}=CARTESIAN_POINT('',(${(Number(x) + 5).toFixed(6)},`);
    expect(checkStep(moved).problems.some((p) => /does not start and end at its vertices/.test(p))).toBe(true);
    const cylinder = one.replace(/CYLINDRICAL_SURFACE\('',(#\d+),([0-9.E-]+)\)/, (_m, pl, r) => `CYLINDRICAL_SURFACE('',${pl},${(Number(r) + 1).toFixed(6)})`);
    expect(checkStep(cylinder).problems.some((p) => /off its CYLINDRICAL_SURFACE/.test(p))).toBe(true);
    const plane = /** @type {RegExpExecArray} */ (/PLANE\('',(#\d+)\)/.exec(one))[1];
    const origin = /** @type {RegExpExecArray} */ (new RegExp(`^${plane}=AXIS2_PLACEMENT_3D\\('',(#\\d+),`, 'm').exec(one))[1];
    const shifted = one.replace(new RegExp(`^${origin}=CARTESIAN_POINT\\('',\\(([^,]+),([^,]+),([^)]+)\\)\\)`, 'm'),
      (_m, x, y, zz) => `${origin}=CARTESIAN_POINT('',(${x},${y},${(Number(zz) + 3).toFixed(6)}))`);
    expect(checkStep(shifted).problems.some((p) => /off its PLANE/.test(p))).toBe(true);
    const knots = one.replace(/\.F\.,\(4,/, '.F.,(5,');
    expect(checkStep(knots).problems.some((p) => /multiplicities sum/.test(p))).toBe(true);
    const edge = one.replace(/ORIENTED_EDGE\('',\*,\*,(#\d+),\.F\.\)/, "ORIENTED_EDGE('',*,*,$1,.T.)");
    expect(checkStep(edge).problems.some((p) => /is used 2 times with senses 1,1|not connected/.test(p))).toBe(true);
  });

  it('keeps the outline of every plate within the tolerance of the exact hull area', () => {
    const t = result.tracks;
    const stop = /** @type {any} */ (result.posts.find((p) => p.id === 'cable-stop'));
    const boss = eccentricCircle({ radius: stop.radius + state.body.minWall, offset: Math.hypot(stop.x, stop.y), phase: Math.atan2(stop.y, stop.x) });
    const cableStart = /** @type {any} */ (t.cable).psiStart;
    const cases = /** @type {[number, any[], number][]} */ ([
      [2, [t.flanges.string, t.flanges.cable, boss], 0],
      [4, [t.flanges.cable, boss], cableStart],
      [3, [t.grooves.cable], cableStart],
    ]);
    for (const [i, list, psi0] of cases) {
      const s = /** @type {BSpline} */ (model.plates[i].outline?.spline);
      const exact = hullArea(list, psi0);
      // Perimeter × tol/2 bounds the area error of a curve within tol/2.
      expect(Math.abs(splineArea(s) - exact)).toBeLessThan(0.4 * EXPORT_TOLERANCE / 2);
    }
  });
});

describe('STEP import in OpenCascade (occt-import-js)', () => {
  /** @type {any} */
  let occt;
  beforeAll(async () => {
    occt = await occtFactory();
  }, 30_000);

  /**
   * Meshes of a STEP text, with the volume of each (divergence theorem).
   * @param {string} text
   */
  const meshes = (text) => {
    const r = occt.ReadStepFile(new TextEncoder().encode(text), {
      linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.001, angularDeflection: 0.1,
    });
    expect(r.success).toBe(true);
    return r.meshes.map((/** @type {any} */ m) => {
      const p = m.attributes.position.array;
      const idx = m.index.array;
      let vol = 0;
      let zMin = Infinity;
      let zMax = -Infinity;
      for (let i = 2; i < p.length; i += 3) {
        zMin = Math.min(zMin, p[i]);
        zMax = Math.max(zMax, p[i]);
      }
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3;
        const b = idx[i + 1] * 3;
        const c = idx[i + 2] * 3;
        vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
          + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
      }
      return { faces: m.brep_faces.length, vol, zMin, zMax };
    });
  };

  it('reads every plate as one solid with the volume of its outline and holes', () => {
    const t = plateThicknesses(state);
    model.plates.forEach((plate, i) => {
      const file = /** @type {(typeof steps)[number]} */ (steps.find((f) => f.part === `step-${plate.id}`));
      const [mesh, ...rest] = meshes(file.text);
      expect(rest).toEqual([]);
      const o = /** @type {NonNullable<typeof plate.outline>} */ (plate.outline);
      const area = o.circle ? Math.PI * o.circle.r ** 2 : splineArea(/** @type {BSpline} */ (o.spline));
      const holes = plate.holes.reduce((a, h) => a + Math.PI * h.r ** 2, 0);
      const expected = t[i] * (area - holes) * 1e9;
      expect(Math.abs(mesh.vol / expected - 1), plate.id).toBeLessThan(2e-4);
      expect(mesh.faces).toBe(plate.holes.length + 3);
      expect(mesh.zMin).toBeCloseTo(0, 9);
      expect(mesh.zMax).toBeCloseTo(t[i] * 1000, 9);
    });
  }, 60_000);

  it('reads the stacked cam as five solids from plate 5 at the bottom to plate 1 on top', () => {
    const m = meshes(stacked.text);
    expect(m).toHaveLength(5);
    for (let i = 0; i < 4; i++) expect(m[i].zMin).toBeCloseTo(m[i + 1].zMax, 6);
    expect(m[4].zMin).toBeCloseTo(0, 9);
  }, 60_000);
});
