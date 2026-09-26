import { describe, expect, it } from 'vitest';
import { FREEFORM_POINTS, applyModifier, freeformLimit, sampleTrack, withinLimit } from '../../src/core/freeform.js';
import { solve } from '../../src/core/solve.js';
import { INCH } from '../../src/core/units.js';
import { exportFiles } from '../../src/export/files.js';
import { buildExportModel } from '../../src/export/model.js';
import { SAMPLES, sampleState } from '../../src/state/samples.js';
import { validate } from '../../src/state/schema.js';
import { checkStep } from './step-reader.js';

describe('sample designs', () => {
  it('have unique ids and names and return a new state on every call', () => {
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
    expect(new Set(SAMPLES.map((s) => s.name)).size).toBe(SAMPLES.length);
    for (const s of SAMPLES) expect(s.state()).not.toBe(s.state());
  });

  it('lists the compound bows first, then the crossbow and the mini bow', () => {
    expect(SAMPLES.map((s) => s.id)).toEqual([
      'target', 'target-optimised', 'hunting', 'light-hunting', 'short-brace', 'long-draw', 'youth', 'crossbow', 'mini',
    ]);
  });

  it('sampleState returns a new state of a sample and throws for an unknown id', () => {
    expect(sampleState('youth')).toEqual(SAMPLES[6].state());
    expect(sampleState('youth')).not.toBe(sampleState('youth'));
    expect(() => sampleState('speed')).toThrow('unknown sample "speed"');
  });

  it('states the inputs given in the sample descriptions', () => {
    /** @type {Record<string, [number, number, number, number, number]>} */
    const inputs = {
      // axle to axle (in), brace height (in), draw (in), peak (N), let-off
      'light-hunting': [30, 7, 27, 222, 0.8],
      'short-brace': [31, 6, 30, 311, 0.8],
      'long-draw': [35, 7, 31, 356, 0.8],
      youth: [27, 6.5, 24, 89, 0.7],
    };
    for (const [id, [ata, brace, draw, peak, letOff]] of Object.entries(inputs)) {
      const s = sampleState(id);
      expect(s.geometry.ata / INCH, id).toBeCloseTo(ata, 9);
      expect(s.geometry.braceHeight / INCH, id).toBeCloseTo(brace, 9);
      expect(s.geometry.drawLength / INCH, id).toBeCloseTo(draw, 9);
      expect(s.curve.params.peak, id).toBe(peak);
      expect(s.curve.params.letOff, id).toBe(letOff);
    }
  });

  it('short-brace hunting: a 12-point free-form track, the eccentric circle plus a 2 mm rounded triangle at 45°', () => {
    const s = sampleState('short-brace');
    const track = s.stringTrack;
    expect(track.shape).toBe('freeform');
    expect(track.freeform.values).toHaveLength(FREEFORM_POINTS.default);
    const circle = sampleTrack({ ...track, shape: 'eccentric' }, FREEFORM_POINTS.default);
    const triangle = applyModifier(circle, 'triangle', 2e-3, 45 * Math.PI / 180);
    track.freeform.values.forEach((v, i) => expect(v).toBeCloseTo(triangle[i], 7));
    // The values are rounded to 0.1 µm, as sampled values.
    for (const v of track.freeform.values) expect(Number(v.toFixed(7))).toBe(v);
    // The track keeps a 0.5 mm margin over the string radius limit.
    expect(withinLimit(track.freeform.values, freeformLimit(s.body, s.cords.stringDiameter, 0.5e-3))).toBe(true);
  });

  for (const sample of SAMPLES) {
    it(`${sample.name}: validates, solves without diagnostics or plausibility warnings and exports without warnings`, () => {
      const state = sample.state();
      expect(validate(state)).toEqual([]);
      const result = solve(state);
      expect(result.status).toBe('ok');
      expect(result.resolution).toBe('full');
      expect(result.diagnostics.map((d) => d.message)).toEqual([]);
      expect(result.warnings.map((w) => w.message)).toEqual([]);
      const built = buildExportModel(result, state);
      expect(built.error).toBeNull();
      expect(built.model?.warnings).toEqual([]);
      const set = exportFiles(result, state, { date: new Date(2026, 8, 25), version: '0', units: state.units }).set;
      const steps = (set?.files ?? []).filter((f) => f.name.endsWith('.step'));
      expect(steps).toHaveLength(6);
      for (const f of steps) expect(checkStep(f.text).problems, f.name).toEqual([]);
    }, 60_000);
  }
});
