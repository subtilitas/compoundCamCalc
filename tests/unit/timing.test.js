import { describe, expect, it } from 'vitest';
import { solve } from '../../src/core/solve.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES, sampleState } from '../../src/state/samples.js';
import { FIELDS, fromJSON, toJSON, validate } from '../../src/state/schema.js';
import { reduce } from '../../src/state/store.js';
import { TUNING_FIELDS, TUNING_HINT } from '../../src/ui/settings.js';
import { MISSING } from '../../src/ui/results.js';
import { TIMING_GLOSSARY, peakAndLetOff, signed, timingItems } from '../../src/ui/timing.js';

const MM = 1e-3;

/**
 * Full solve of the default design with changed cords, as the worker runs it.
 * @param {Partial<import('../../src/state/schema.js').Tuning>} tuning
 */
function solved(tuning) {
  const state = defaultState();
  state.tuning = { ...state.tuning, ...tuning };
  return { state, result: solve(state, { analysis: { offsets: state.tuning } }) };
}

/** @param {import('../../src/ui/timing.js').TimingItem[]} items */
const texts = (items) => Object.fromEntries(items.map((i) => [i.key, i.text]));

describe('timing settings', () => {
  it('default to unchanged cords and keep the ranges of the schema', () => {
    expect(defaultState().tuning).toEqual({ topCable: 0, bottomCable: 0, string: 0, nockHeight: 0 });
    expect(TUNING_FIELDS.map((f) => f.path)).toEqual(['tuning.topCable', 'tuning.bottomCable', 'tuning.string', 'tuning.nockHeight']);
    expect([FIELDS['tuning.topCable'].min, FIELDS['tuning.topCable'].max]).toEqual([-20 * MM, 20 * MM]);
    expect([FIELDS['tuning.bottomCable'].min, FIELDS['tuning.bottomCable'].max]).toEqual([-20 * MM, 20 * MM]);
    expect([FIELDS['tuning.string'].min, FIELDS['tuning.string'].max]).toEqual([-50 * MM, 50 * MM]);
    expect([FIELDS['tuning.nockHeight'].min, FIELDS['tuning.nockHeight'].max]).toEqual([-50 * MM, 50 * MM]);
    // Every range stays inside the range of the analysis.
    for (const f of TUNING_FIELDS) expect(Math.max(-FIELDS[f.path].min, FIELDS[f.path].max)).toBeLessThanOrEqual(0.1);
    expect(TUNING_HINT).toMatch(/^Analysis only/);
  });

  it('validate the range and fill the section for files without it', () => {
    const state = defaultState();
    expect(validate({ ...state, tuning: { ...state.tuning, topCable: 21 * MM } }).map((e) => e.path)).toEqual(['tuning.topCable']);
    expect(validate({ ...state, tuning: { ...state.tuning, nockHeight: -50 * MM } })).toEqual([]);
    const older = /** @type {Partial<typeof state>} */ ({ ...state });
    delete older.tuning;
    const opened = fromJSON(JSON.stringify(older));
    expect(opened.errors).toEqual([]);
    expect(opened.state?.tuning).toEqual(state.tuning);
    const round = fromJSON(toJSON({ ...state, tuning: { ...state.tuning, string: -3 * MM } }));
    expect(round.state?.tuning.string).toBe(-3 * MM);
  });

  it('change the tuning section alone through the store', () => {
    const state = defaultState();
    const next = reduce(state, { type: 'setTuning', tuning: { bottomCable: 1.5 * MM } });
    expect(next.tuning).toEqual({ ...state.tuning, bottomCable: 1.5 * MM });
    expect({ ...next, tuning: state.tuning }).toEqual(state);
  });
});

describe('timing results', () => {
  it('show every value as missing without an analysis', () => {
    const units = defaultState().units;
    for (const items of [timingItems(null, units), timingItems(solve(defaultState()), units)]) {
      expect(items.map((i) => i.key)).toEqual([
        'timing-end', 'first-stop', 'nock-travel', 'brace-change', 'draw-change', 'peak-change', 'letoff-change', 'sensitivity',
      ]);
      for (const i of items) expect(i.text).toBe(MISSING);
    }
  });

  it('show no change with unchanged cords', () => {
    const { state, result } = solved({});
    expect(texts(timingItems(result, state.units))).toEqual({
      'timing-end': '0.00°, cams in time',
      'first-stop': 'Both cams together',
      'nock-travel': '0.00 mm',
      'brace-change': '0.00 mm',
      'draw-change': '0.00 mm',
      'peak-change': '0.0 N',
      'letoff-change': '0.00 points',
      // Free nock: 6.91 °/mm at full draw (docs/research.md).
      sensitivity: '6.91°/mm',
    });
  });

  it('name the cam ahead, the first stop and the changes for a longer top cable', () => {
    const { state, result } = solved({ topCable: 1 * MM });
    // Values of docs/model.md: 6.89° at the stop, top cam first, bottom gap
    // 3.81 mm, brace 0.16 mm shorter, stop 5.4 mm before full draw.
    expect(texts(timingItems(result, state.units))).toEqual({
      'timing-end': '+6.89°, top cam ahead',
      'first-stop': 'Top cam; bottom cam gap 3.81 mm',
      'nock-travel': '5.87 mm',
      'brace-change': '−0.16 mm',
      'draw-change': '−5.45 mm',
      'peak-change': '−0.7 N',
      'letoff-change': '−0.30 points',
      sensitivity: '6.84°/mm',
    });
    const inch = texts(timingItems(result, { ...state.units, dims: 'in', force: 'lbf' }));
    expect(inch['first-stop']).toBe('Top cam; bottom cam gap 0.150 in');
    expect(inch['draw-change']).toBe('−0.214 in');
    expect(inch.sensitivity).toBe('6.84°/mm');
    const bottom = texts(timingItems(solved({ bottomCable: 1 * MM }).result, state.units));
    expect(bottom['timing-end']).toBe('−6.89°, bottom cam ahead');
    expect(bottom['first-stop']).toBe('Bottom cam; top cam gap 3.81 mm');
  });

  it('show no change of peak and let-off with unchanged cords on every sample', () => {
    for (const { id } of SAMPLES) {
      const state = sampleState(id);
      const result = solve(state, { analysis: { offsets: state.tuning } });
      expect(result.analysisReference, id).toBe(result.analysis);
      const t = texts(timingItems(result, state.units));
      expect(t['peak-change'], id).toMatch(/^0\.0+ (N|lbf)$/);
      expect(t['letoff-change'], id).toBe('0.00 points');
      expect(t['draw-change'], id).toMatch(/^0\.0+ (mm|in)$/);
    }
  });

  it('end the draw at full draw when no stop is reached', () => {
    const state = sampleState('youth');
    state.tuning = { topCable: -20 * MM, bottomCable: -20 * MM, string: 50 * MM, nockHeight: 0 };
    const result = solve(state, { analysis: { offsets: state.tuning } });
    const a = /** @type {import('../../src/core/analysis.js').AnalysisResult} */ (result.analysis);
    expect(a.diagnostics.map((d) => d.code)).toContain('analysis-no-stop');
    const end = a.end;
    expect(a.x[end]).toBe(a.fullDraw);
    expect(end).toBeLessThan(a.n - 1);
    const t = texts(timingItems(result, state.units));
    expect(t['first-stop']).toBe('No stop reached');
    expect(t['draw-change']).toBe('0.00 mm');
  });

  it('never change the cam, its status or its checks', () => {
    const plain = solve(defaultState());
    const { result } = solved({ topCable: 5 * MM, nockHeight: 20 * MM });
    expect(result.status).toBe(plain.status);
    expect(result.diagnostics).toEqual(plain.diagnostics);
    expect(result.metrics).toEqual(plain.metrics);
    expect(result.tracks).toEqual(plain.tracks);
  });

  it('list the glossary entries of their info buttons', () => {
    const units = defaultState().units;
    expect(timingItems(null, units).flatMap((i) => (i.glossary ? [i.glossary] : []))).toEqual([...TIMING_GLOSSARY]);
  });

  it('format signs and the let-off rule of the solver', () => {
    expect(signed(1.234, 2)).toBe('+1.23');
    expect(signed(-0.2, 2)).toBe('−0.20');
    expect(signed(-0.001, 2)).toBe('0.00');
    expect(peakAndLetOff([0, 100, 40, 50])).toEqual({ peak: 100, letOff: 0.6 });
    expect(peakAndLetOff([]).letOff).toBeNaN();
  });
});
