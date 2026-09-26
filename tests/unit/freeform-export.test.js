import { describe, expect, it } from 'vitest';
import { EXPORT_TOLERANCE, evaluate } from '../../src/core/bspline.js';
import { applyModifier } from '../../src/core/freeform.js';
import { solve } from '../../src/core/solve.js';
import { createSupport } from '../../src/core/support.js';
import { exportFiles } from '../../src/export/files.js';
import { buildExportModel } from '../../src/export/model.js';
import { defaultState } from '../../src/state/presets.js';
import { readDxf } from './dxf-reader.js';
import { checkStep } from './step-reader.js';

/** @typedef {import('../../src/export/model.js').ExportModel} ExportModel */
/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */

// The default design with a free-form string track: its 12 values plus a
// 1 mm rounded triangle, so the track is no circle.
const base = defaultState();
/** @type {ProjectState} */
const state = {
  ...base,
  stringTrack: { ...base.stringTrack, shape: 'freeform', freeform: { values: applyModifier(base.stringTrack.freeform.values, 'triangle', 0.001, 0) } },
};
const result = solve(state);
const date = new Date(2026, 8, 25, 12, 0, 0);

describe('export of a free-form design', () => {
  it('fits the free-form string track with splines within the export tolerance', () => {
    expect(result.status).toBe('ok');
    const built = buildExportModel(result, state);
    expect(built.error).toBeNull();
    const model = /** @type {ExportModel} */ (built.model);
    const tracks = { 'string-pitch': result.tracks.stringPitch, 'string-groove': result.tracks.grooves.string, 'string-flange': result.tracks.flanges.string };
    const out = new Float64Array(6);
    for (const [id, data] of Object.entries(tracks)) {
      const curve = model.curves.find((c) => c.id === id);
      expect(curve?.circle, id).toBeNull();
      const spline = /** @type {import('../../src/core/bspline.js').BSpline} */ (curve?.spline);
      expect(spline.closed).toBe(true);
      // Every spline point lies on the track: max over ψ of X·n − p(ψ) is 0.
      const s = createSupport(/** @type {any} */ (data));
      const u0 = spline.knots[3];
      const u1 = spline.knots[spline.knots.length - 4];
      for (let i = 0; i < 200; i++) {
        evaluate(spline, u0 + ((u1 - u0) * i) / 200, out);
        const psi = Math.atan2(out[3], out[2]) - Math.PI / 2;
        let d = -Infinity;
        for (let k = -40; k <= 40; k++) {
          const a = psi + k * 0.0005;
          d = Math.max(d, out[0] * Math.cos(a) + out[1] * Math.sin(a) - s.p(a));
        }
        expect(Math.abs(d), id).toBeLessThanOrEqual(EXPORT_TOLERANCE * 1.01);
      }
    }
  });

  it('writes DXF and STEP files that pass the DXF reader and the Part 21 checks', () => {
    const out = exportFiles(result, state, { date, version: '0.1.0', units: state.units });
    expect(out.error).toBeNull();
    const set = /** @type {NonNullable<typeof out.set>} */ (out.set);
    const dxf = set.files.filter((f) => f.name.endsWith('.dxf'));
    const step = set.files.filter((f) => f.name.endsWith('.step'));
    expect(dxf).toHaveLength(7);
    expect(step).toHaveLength(6);
    for (const f of dxf) {
      const doc = readDxf(f.text);
      expect(doc.order, f.name).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
      expect(doc.sections.ENTITIES.length, f.name).toBeGreaterThan(0);
    }
    for (const f of step) expect(checkStep(f.text).problems, f.name).toEqual([]);
    // The string groove plate is cut along a spline outline, not a circle.
    const groove = readDxf(dxf[1].text);
    expect(groove.sections.ENTITIES.some((e) => e.type === 'CIRCLE' && e.pairs.some((p) => p[0] === 8 && p[1] === 'OUTLINE'))).toBe(false);
  }, 30_000);
});
