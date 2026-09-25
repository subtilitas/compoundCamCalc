import { describe, expect, it } from 'vitest';
import { solve } from '../../src/core/solve.js';
import { exportFiles } from '../../src/export/files.js';
import { buildExportModel } from '../../src/export/model.js';
import { SAMPLES } from '../../src/state/samples.js';
import { validate } from '../../src/state/schema.js';
import { checkStep } from './step-reader.js';

describe('sample designs', () => {
  it('have unique ids and names and return a new state on every call', () => {
    expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
    expect(new Set(SAMPLES.map((s) => s.name)).size).toBe(SAMPLES.length);
    for (const s of SAMPLES) expect(s.state()).not.toBe(s.state());
  });

  for (const sample of SAMPLES) {
    it(`${sample.name}: validates, solves without diagnostics and exports without warnings`, () => {
      const state = sample.state();
      expect(validate(state)).toEqual([]);
      const result = solve(state);
      expect(result.status).toBe('ok');
      expect(result.resolution).toBe('full');
      expect(result.diagnostics.map((d) => d.message)).toEqual([]);
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
