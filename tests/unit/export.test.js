import { describe, expect, it } from 'vitest';
import { EXPORT_TOLERANCE, evaluate } from '../../src/core/bspline.js';
import { solveForward } from '../../src/core/forward.js';
import { limbFromState } from '../../src/core/limb.js';
import { solve } from '../../src/core/solve.js';
import { createSupport, eccentricCircle, splineSupport } from '../../src/core/support.js';
import { designId, exportFiles, exportZip, titleLines } from '../../src/export/files.js';
import { buildExportModel, discSupport, hullContour } from '../../src/export/model.js';
import { defaultState } from '../../src/state/presets.js';
import { evaluateSpline, readDxf, splineOf } from './dxf-reader.js';

/** @typedef {import('../../src/export/model.js').ExportModel} ExportModel */

const state = defaultState();
const result = solve(state);
const date = new Date(2026, 8, 25, 12, 0, 0);
const built = buildExportModel(result, state);
const model = /** @type {ExportModel} */ (built.model);

/**
 * Value of a DXF group of an entity.
 * @param {{ pairs: [number, string][] }} e
 * @param {number} code
 */
const group = (e, code) => e.pairs.find((p) => p[0] === code)?.[1];

describe('export model', () => {
  it('builds every curve and plate of the default preset', () => {
    expect(built.error).toBeNull();
    expect(model.curves.map((c) => c.id)).toEqual(['string-pitch', 'string-groove', 'string-flange', 'cable-pitch', 'cable-groove', 'cable-flange']);
    // The default string track is an eccentric circle: exact circles.
    expect(model.curves[0].circle).not.toBeNull();
    expect(model.curves[3].spline?.closed).toBe(true);
    expect(model.plates.map((p) => p.number)).toEqual([1, 2, 3, 4, 5]);
    expect(model.tolerance).toBe(EXPORT_TOLERANCE);
  });

  it('puts post holes into the flange plates next to their cord only', () => {
    const ids = model.plates.map((p) => p.holeIds);
    expect(ids[0]).toEqual(['bore', 'string-post']);
    expect(ids[1]).toEqual(['bore']);
    expect(ids[2]).toEqual(expect.arrayContaining(['bore', 'string-post', 'cable-post', 'cable-stop']));
    expect(ids[3]).toEqual(['bore']);
    expect(ids[4]).toEqual(['bore', 'cable-post', 'cable-stop']);
    expect(model.warnings).toEqual([]);
  });

  it('adds a boss around the cable stop where the flange cannot hold it', () => {
    // The peg clears the groove bottom by its radius, so it reaches past a
    // cable flange shallower than the peg diameter (defaults 2.5 and 5 mm).
    const stop = /** @type {any} */ (result.posts.find((p) => p.id === 'cable-stop'));
    const boss = { cx: stop.x, cy: stop.y, r: stop.radius + state.body.minWall };
    expect(model.plates[4].bosses).toEqual([boss]);
    expect(model.plates[4].outlineCircle).toBeNull();
    // Every plate with a stop hole keeps the minimum wall around it: the
    // distance from the peg centre to the cut outline is at least r + wall.
    for (const plate of model.plates.filter((p) => p.holeIds.includes('cable-stop'))) {
      const c = /** @type {number[]} */ (plate.contour);
      let d = Infinity;
      for (let i = 0; i < c.length; i += 2) {
        const j = (i + 2) % c.length;
        const ex = c[j] - c[i];
        const ey = c[j + 1] - c[i + 1];
        const f = Math.max(0, Math.min(1, ((stop.x - c[i]) * ex + (stop.y - c[i + 1]) * ey) / (ex * ex + ey * ey)));
        d = Math.min(d, Math.hypot(c[i] + f * ex - stop.x, c[i + 1] + f * ey - stop.y));
      }
      expect(d).toBeGreaterThanOrEqual(boss.r - 1e-6);
    }
    // The middle flange covers the peg, but not with the full wall.
    expect(model.plates[2].bosses).toEqual([boss]);
    for (const i of [0, 1, 3]) expect(model.plates[i].bosses).toEqual([]);
  });

  it('names the plates that still hold a post a plate cannot hold', () => {
    // A string post moved outside plate 1 but still inside the hull of plate 3.
    const flange = createSupport(/** @type {any} */ (result.tracks.flanges.string));
    const cable = createSupport(/** @type {any} */ (result.tracks.flanges.cable));
    let psi = 0;
    for (let i = 0; i < 720; i++) {
      const a = (i * Math.PI) / 360;
      if (cable.p(a) - flange.p(a) > cable.p(psi) - flange.p(psi)) psi = a;
    }
    // A small disc touching the cable flange from inside, beyond the string flange.
    const r = 0.0003;
    const edge = cable.point(psi);
    const x = edge.x - (r + 1e-5) * Math.cos(psi);
    const y = edge.y - (r + 1e-5) * Math.sin(psi);
    expect(cable.p(psi) - flange.p(psi)).toBeGreaterThan(3 * r);
    const posts = result.posts.map((p) => (p.id === 'string-post' ? { ...p, x, y, radius: r } : p));
    const out = /** @type {ExportModel} */ (buildExportModel({ ...result, posts }, state).model);
    expect(out.warnings).toEqual(['Plate 1 (flange, string side): the string post reaches past the outline, so this plate has no hole for it; plate 3 still holds it']);
    const far = result.posts.map((p) => (p.id === 'string-post' ? { ...p, x: 1 } : p));
    const lost = /** @type {ExportModel} */ (buildExportModel({ ...result, posts: far }, state).model);
    expect(lost.warnings).toEqual([
      'Plate 1 (flange, string side): the string post reaches past the outline, so this plate has no hole for it',
      'Plate 3 (middle flange): the string post reaches past the outline, so this plate has no hole for it',
      'No plate holds the string post: fix it to the cam another way',
    ]);
  });

  it('keeps every cut contour within the tolerance of the track', () => {
    const tol = EXPORT_TOLERANCE;
    const t = result.tracks;
    const flanges = [createSupport(/** @type {any} */ (t.flanges.string)), createSupport(/** @type {any} */ (t.flanges.cable))];
    const bosses = (/** @type {number} */ i) => model.plates[i].bosses.map(discSupport);
    for (const [plate, supports] of /** @type {const} */ ([
      [model.plates[2], [...flanges, ...bosses(2)]],
      [model.plates[4], [flanges[1], ...bosses(4)]],
    ])) {
      const c = /** @type {number[]} */ (plate.contour);
      const n = c.length / 2;
      expect(n).toBeGreaterThan(90);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        for (let k = 0; k <= 8; k++) {
          const f = k / 8;
          const x = c[2 * i] + f * (c[2 * j] - c[2 * i]);
          const y = c[2 * i + 1] + f * (c[2 * j + 1] - c[2 * i + 1]);
          // Signed distance to the hull: max over ψ of X·n − h(ψ), found
          // on a fine grid around the direction of the point.
          const psi0 = Math.atan2(y, x);
          let d = -Infinity;
          for (let m = -400; m <= 400; m++) {
            const psi = psi0 + (m * Math.PI) / 800;
            const h = Math.max(...supports.map((s) => s.p(psi)));
            d = Math.max(d, x * Math.cos(psi) + y * Math.sin(psi) - h);
          }
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
      }
      expect(hi).toBeLessThanOrEqual(tol * (1 + 1e-6));
      expect(lo).toBeGreaterThanOrEqual(-tol * (1 + 1e-3));
    }
  });

  it('refuses results it cannot export', () => {
    expect(buildExportModel({ ...result, resolution: 'coarse' }, state).error).toMatch(/full solve/);
    expect(buildExportModel({ ...result, status: 'infeasible' }, state).error).toMatch(/full solve/);
    expect(buildExportModel(result, state, { tolerance: 0 }).error).toMatch(/tolerance/);
    expect(buildExportModel(result, { ...state, body: { ...state.body, boreDiameter: NaN } }).error).toMatch(/bore/);
    const noCable = { ...result, tracks: { ...result.tracks, cable: null } };
    expect(buildExportModel(noCable, state).error).toMatch(/cable track start/);
    const noPitch = { ...result, tracks: { ...result.tracks, cablePitch: null } };
    expect(buildExportModel(noPitch, state).error).toMatch(/cable pitch line/);
    expect(buildExportModel(/** @type {any} */ (null), state).error).toMatch(/full solve/);
  });

  it('builds a hull contour of one circle as a polygon on the offset circle', () => {
    const circle = createSupport(eccentricCircle({ radius: 0.03 }));
    const c = hullContour([circle], 1e-5);
    for (let i = 0; i < c.length; i += 2) expect(Math.hypot(c[i], c[i + 1])).toBeCloseTo(0.03 + 1e-5, 12);
  });
});

describe('export files', () => {
  const out = exportFiles(result, state, { date, version: '0.1.0', units: state.units });
  const set = /** @type {NonNullable<typeof out.set>} */ (out.set);

  it('names the files by date, design and part', () => {
    expect(out.error).toBeNull();
    const id = designId(state);
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    expect(set.files.map((f) => f.name)).toEqual([
      'plate1-string-flange', 'plate2-string-groove', 'plate3-middle-flange', 'plate4-cable-groove', 'plate5-cable-flange',
      'reference', 'string-plan',
    ].map((p) => `cam-20260925-${id}-${p}.dxf`).concat(`cam-20260925-${id}-force-curve.csv`, [
      'cam', 'plate1-string-flange', 'plate2-string-groove', 'plate3-middle-flange', 'plate4-cable-groove', 'plate5-cable-flange',
    ].map((p) => `cam-20260925-${id}-${p}.step`)));
    // The id ignores the display units and follows the inputs.
    expect(designId({ ...state, units: { ...state.units, dims: 'in' } })).toBe(id);
    expect(designId({ ...state, geometry: { ...state.geometry, ata: 0.85 } })).not.toBe(id);
  });

  it('writes plate files with the cut outline and holes only', () => {
    for (const f of set.files.slice(0, 5)) {
      const doc = readDxf(f.text);
      const layers = new Set(doc.sections.ENTITIES.map((e) => group(e, 8)));
      for (const l of layers) expect(['OUTLINE', 'BORE', 'POSTS', 'STOP']).toContain(l);
      expect(doc.sections.ENTITIES.some((e) => e.type === 'SPLINE' || e.type === 'TEXT')).toBe(false);
      expect(doc.sections.ENTITIES.filter((e) => group(e, 8) === 'OUTLINE')).toHaveLength(1);
    }
  });

  it('writes the title block into the reference drawing and the string plan', () => {
    const lines = titleLines(result, state, { id: set.id, iso: '2026-09-25', version: '0.1.0', tolerance: EXPORT_TOLERANCE });
    expect(lines[0]).toBe(`Compound Cam Calculator 0.1.0, design ${set.id}, 2026-09-25`);
    const ref = readDxf(set.files[5].text);
    const texts = ref.sections.ENTITIES.filter((e) => e.type === 'TEXT').map((e) => group(e, 1));
    expect(texts).toEqual(expect.arrayContaining(lines));
    const plan = readDxf(set.files[6].text);
    const planTexts = plan.sections.ENTITIES.filter((e) => e.type === 'TEXT').map((e) => group(e, 1)).join('\n');
    expect(planTexts).toMatch(/String, pitch line between the termination points: \d+\.\d mm \(\d+\.\d{3} in\)/);
    expect(set.readme).toContain('Plates 1 to 5 stack from the string side');
    expect(set.readme).not.toContain('Warnings:');
    expect(set.readme).toContain('boss around the cable stop');
    const far = result.posts.map((p) => (p.id === 'string-post' ? { ...p, x: 1 } : p));
    const warned = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (
      exportFiles({ ...result, posts: far }, state, { date, version: '0', units: state.units }).set);
    expect(warned.readme).toContain('Warnings:\r\n  Plate 1 (flange, string side)');
  });

  it('writes a ZIP with the README and every file', () => {
    const zip = exportZip(set, date);
    expect(zip.error).toBeNull();
    expect(zip.name).toBe(`cam-20260925-${set.id}.zip`);
    const bytes = /** @type {Uint8Array} */ (zip.bytes);
    const text = new TextDecoder('latin1').decode(bytes);
    for (const f of set.files) expect(text).toContain(f.name);
    expect(text).toContain('README.txt');
  });

  it('reports the failures of its parts', () => {
    expect(exportFiles(result, state, { date: new Date(NaN), version: '0', units: state.units }).error).toMatch(/date/);
    expect(exportFiles({ ...result, status: 'infeasible' }, state, { date, version: '0', units: state.units }).error).toMatch(/full solve/);
    expect(exportFiles(result, state, { date, version: '0', units: /** @type {any} */ ({ draw: 'yd', force: 'N' }) }).error).toMatch(/Force table/);
    expect(exportFiles(/** @type {any} */ (null), state, /** @type {any} */ (null)).error).toBeTruthy();
    expect(exportZip(/** @type {any} */ (null), date).error).toBeTruthy();
  });
});

describe('export round trip', () => {
  it('rebuilds the tracks from the reference drawing and reproduces the force curve', () => {
    const out = exportFiles(result, state, { date, version: '0', units: state.units });
    const ref = readDxf(/** @type {NonNullable<typeof out.set>} */ (out.set).files[5].text);
    const entities = ref.sections.ENTITIES;
    // String pitch line: a circle on the PITCH layer (eccentric track).
    const circle = /** @type {any} */ (entities.find((e) => e.type === 'CIRCLE' && group(e, 8) === 'PITCH'));
    const cx = Number(group(circle, 10)) / 1000;
    const cy = Number(group(circle, 20)) / 1000;
    const r = Number(group(circle, 40)) / 1000;
    const stringTrack = eccentricCircle({ radius: r, offset: Math.hypot(cx, cy), phase: Math.atan2(cy, cx) });
    // Cable pitch line: the SPLINE with id cable-pitch; its support
    // p(ψ) = max over the curve of S·n(ψ), on a 0.25° grid.
    const cable = /** @type {any} */ (entities.find((e) => e.type === 'SPLINE' && e.pairs.some((p) => p[0] === 1000 && p[1] === 'cable-pitch')));
    const sp = splineOf(cable);
    const k = sp.knots;
    const u0 = k[3];
    const u1 = k[k.length - 4];
    const samples = 60000;
    const px = new Float64Array(samples);
    const py = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const p = evaluateSpline(sp, u0 + ((u1 - u0) * i) / samples);
      px[i] = p.x / 1000;
      py[i] = p.y / 1000;
    }
    const start = /** @type {any} */ (result.tracks.cable).psiStart;
    const count = 1440;
    const knots = new Float64Array(count + 1);
    const values = new Float64Array(count + 1);
    // The curve is closed and convex, so the sample that maximises S·n(ψ)
    // moves forward as ψ turns: a full scan for the first angle, then a
    // rotating scan that only steps forward.
    const dot = (/** @type {number} */ i, /** @type {number} */ c, /** @type {number} */ s) => px[i % samples] * c + py[i % samples] * s;
    let best = 0;
    for (let j = 0; j <= count; j++) {
      const psi = start + (j * 2 * Math.PI) / count;
      const c = Math.cos(psi);
      const s = Math.sin(psi);
      if (j === 0) {
        for (let i = 1; i < samples; i++) if (dot(i, c, s) > dot(best, c, s)) best = i;
      } else {
        while (dot(best + 1, c, s) >= dot(best, c, s)) best = (best + 1) % samples;
      }
      knots[j] = psi;
      values[j] = dot(best, c, s);
    }
    const cableTrack = splineSupport(knots, values, { periodic: true });
    const limb = /** @type {any} */ (limbFromState(state.limb, state.geometry.limbLength).limb);
    const fwd = solveForward({
      geometry: state.geometry,
      stringTrack,
      cableTrack,
      limb,
      stringTermination: /** @type {any} */ (result.tracks.string).psiEnd,
      cableTermination: start,
    });
    expect(fwd.status).toBe('ok');
    expect(fwd.diagnostics).toEqual([]);
    const a = /** @type {NonNullable<typeof result.achieved>} */ (result.achieved);
    let worst = 0;
    for (let i = 0; i < fwd.n; i++) worst = Math.max(worst, Math.abs(fwd.F[i] - a.F[i]));
    // Measured 0.0x N; the fit tolerance of the solver is 3 % of the peak.
    expect(worst).toBeLessThan(0.5);
    // A forward solve of 1500 samples: slow under coverage on a CI runner.
  }, 30_000);

  it('keeps the curvature of the cable track in the written spline', () => {
    const out = exportFiles(result, state, { date, version: '0', units: state.units });
    const ref = readDxf(/** @type {NonNullable<typeof out.set>} */ (out.set).files[5].text);
    const cable = /** @type {any} */ (ref.sections.ENTITIES.find((e) => e.type === 'SPLINE' && e.pairs.some((p) => p[0] === 1000 && p[1] === 'cable-pitch')));
    const sp = splineOf(cable);
    // Smallest radius through three points inside each knot span (mm).
    let rMin = Infinity;
    for (let i = 3; i < sp.knots.length - 4; i++) {
      const a = sp.knots[i];
      const b = sp.knots[i + 1];
      if (!(b > a)) continue;
      const [p, q, r] = [0.25, 0.5, 0.75].map((f) => evaluateSpline(sp, a + f * (b - a)));
      const ab = Math.hypot(q.x - p.x, q.y - p.y);
      const bc = Math.hypot(r.x - q.x, r.y - q.y);
      const ca = Math.hypot(p.x - r.x, p.y - r.y);
      const cross = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      if (cross > 0) rMin = Math.min(rMin, (ab * bc * ca) / (2 * cross));
    }
    // The pitch line of the cable keeps the minimum bend radius (5 mm).
    expect(rMin).toBeGreaterThan(state.body.minBendRadius * 1000 - 1e-3);
  });

  it('evaluates the exported spline on the track', () => {
    const c = /** @type {NonNullable<ExportModel['curves'][number]['spline']>} */ (model.curves[3].spline);
    const out = new Float64Array(6);
    evaluate(c, c.knots[3], out);
    expect(Number.isFinite(out[0])).toBe(true);
  });
});
