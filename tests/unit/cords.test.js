import { describe, expect, it } from 'vitest';
import { BUILD_TENSION, CORD_MATERIALS, CUSTOM_MATERIAL, buildLengths, cordEA, cordStiffness } from '../../src/core/cords.js';
import { createLayout } from '../../src/core/layout.js';
import { solve } from '../../src/core/solve.js';
import { timingId } from '../../src/core/timinglayout.js';
import { exportFiles } from '../../src/export/files.js';
import { defaultState } from '../../src/state/presets.js';
import { fromJSON, toJSON, validate } from '../../src/state/schema.js';
import { reduce } from '../../src/state/store.js';
import { MATERIAL_OPTIONS, STRETCH_FIELDS, inputGroups, parseField, stiffnessSummary, unitOf } from '../../src/ui/settings.js';
import { planDims } from '../../src/ui/stringplan.js';
import { ELASTIC_ITEMS, timingItems } from '../../src/ui/timing.js';

const MM = 1e-3;
const date = new Date(2026, 8, 26, 10, 0, 0);

/**
 * Default design with elastic cords and changed lengths, solved as the worker does.
 * @param {Partial<import('../../src/state/schema.js').Tuning>} tuning
 */
function elastic(tuning = {}) {
  const state = defaultState();
  state.tuning = { ...state.tuning, cordModel: 'elastic', ...tuning };
  const result = solve(state, { analysis: { offsets: state.tuning, stiffness: cordStiffness(state.tuning) } });
  return { state, result };
}

/** @param {import('../../src/ui/timing.js').TimingItem[]} items */
const texts = (items) => Object.fromEntries(items.map((i) => [i.key, i.text]));

describe('cord materials', () => {
  it('hold the measured stiffness per strand of docs/research.md', () => {
    expect(CORD_MATERIALS.map((m) => [m.id, m.strand])).toEqual([['452x', 12360], ['fastflight-plus', 10966], ['dacron-b50', 2118]]);
    // A 24-strand 452X string: EA 2.97e5 N.
    expect(cordEA('452x', 24, 0)).toBe(296640);
    expect(cordEA('dacron-b50', 16, 0)).toBe(33888);
    expect(cordEA(CUSTOM_MATERIAL, 24, 1.5e5)).toBe(1.5e5);
    expect(cordEA('nylon', 24, 1e5)).toBeNaN();
    expect(MATERIAL_OPTIONS.map((o) => o.value)).toEqual(['452x', 'fastflight-plus', 'dacron-b50', 'custom']);
    expect(MATERIAL_OPTIONS[0].label).toBe('BCY 452X, 12360 N per strand');
  });

  it('give no stiffness for rigid cords and the EA of each cord for elastic ones', () => {
    const t = defaultState().tuning;
    expect(t.cordModel).toBe('rigid');
    expect(cordStiffness(t)).toBeNull();
    const e = { ...t, cordModel: /** @type {const} */ ('elastic'), topCableMaterial: /** @type {const} */ ('custom'), topCableEA: 2e5, bottomCableStrands: 20 };
    expect(cordStiffness(e)).toEqual({ string: 296640, topCable: 2e5, bottomCable: 20 * 12360 });
  });

  it('give the free length and the length at 100 lbf from the tension at brace', () => {
    const b = buildLengths({ string: 1.2, cable: 0.8 }, { string: 150, cable: 400 }, { string: 3e5, topCable: 3e5, bottomCable: 1.5e5 });
    expect(b.string.free).toBeCloseTo(1.2 - (1.2 / 3e5) * 150, 15);
    expect(b.string.loaded).toBeCloseTo(b.string.free + (1.2 / 3e5) * BUILD_TENSION, 15);
    expect(b.topCable.free).toBeCloseTo(0.8 - (0.8 / 3e5) * 400, 15);
    expect(b.bottomCable.free).toBeCloseTo(0.8 - (0.8 / 1.5e5) * 400, 15);
    expect(BUILD_TENSION).toBeCloseTo(444.822, 3);
  });
});

describe('cord stiffness settings', () => {
  it('validate the model, the materials, whole strand counts and the EA range', () => {
    const s = defaultState();
    expect(validate(s)).toEqual([]);
    const paths = (/** @type {any} */ t) => validate({ ...s, tuning: { ...s.tuning, ...t } }).map((e) => e.path);
    expect(paths({ cordModel: 'stretchy' })).toEqual(['tuning.cordModel']);
    expect(paths({ topCableMaterial: 'nylon' })).toEqual(['tuning.topCableMaterial']);
    expect(paths({ stringStrands: 24.5 })).toEqual(['tuning.stringStrands']);
    expect(validate({ ...s, tuning: { ...s.tuning, stringStrands: 24.5 } })[0].message).toBe('String strands must be a whole number');
    expect(paths({ bottomCableStrands: 4 })).toEqual(['tuning.bottomCableStrands']);
    expect(paths({ stringEA: 9000 })).toEqual(['tuning.stringEA']);
    expect(paths({ stringEA: 1e8 })).toEqual([]);
  });

  it('fill rigid cords into files without the stiffness settings and keep them through JSON', () => {
    const s = defaultState();
    const older = JSON.parse(toJSON(s));
    older.tuning = { topCable: 0.001, bottomCable: 0, string: 0, nockHeight: 0 };
    const opened = fromJSON(JSON.stringify(older));
    expect(opened.errors).toEqual([]);
    expect(opened.state?.tuning).toEqual({ ...s.tuning, topCable: 0.001 });
    const e = reduce(s, { type: 'setTuning', tuning: { cordModel: 'elastic', stringMaterial: 'custom', stringEA: 2.5e5 } });
    expect(fromJSON(toJSON(e)).state?.tuning).toEqual(e.tuning);
  });

  it('show the strands of a measured material and the EA of a custom one, with elastic cords only', () => {
    const s = defaultState();
    const shown = (/** @type {import('../../src/state/schema.js').ProjectState} */ st) =>
      STRETCH_FIELDS.filter((d) => !d.visible || d.visible(st)).map((d) => d.id);
    expect(shown(s)).toEqual([]);
    const e = { ...s, tuning: { ...s.tuning, cordModel: /** @type {const} */ ('elastic'), topCableMaterial: /** @type {const} */ ('custom') } };
    expect(shown(e)).toEqual(['string-strands', 'top-cable-ea', 'bottom-cable-strands']);
    const strands = /** @type {import('../../src/ui/settings.js').FieldDef} */ (STRETCH_FIELDS.find((d) => d.id === 'string-strands'));
    expect(unitOf(strands, s.units)).toBe('strands');
    expect(parseField(strands, '20 strands', s.units)).toBe(20);
    expect(stiffnessSummary(s)).toBe('');
    expect(stiffnessSummary(e)).toBe('EA: string 296640 N, top cable 296640 N, bottom cable 296640 N');
    const rows = /** @type {import('../../src/ui/settings.js').InputGroup} */ (inputGroups(e).find((g) => g.title === 'Timing (analysis only)')).rows;
    expect(rows.map((r) => r.label)).toEqual([
      'Top cable length change', 'Bottom cable length change', 'String length change', 'Nocking point above centre', 'Cord model',
      'String material', 'String strands', 'Top cable material', 'Top cable stiffness EA', 'Bottom cable material', 'Bottom cable strands',
      'Stiffness',
    ]);
    expect(rows.find((r) => r.label === 'Top cable material')?.text).toBe('Custom EA');
    expect(inputGroups(s).find((g) => g.title === 'Timing (analysis only)')?.rows.at(-1)).toEqual({ label: 'Cord model', text: 'Rigid' });
  });
});

describe('timing results with elastic cords', () => {
  it('add the second stop, the wall stiffness and the stretch of unchanged cords', () => {
    const { state, result } = elastic();
    const t = texts(timingItems(result, state.units));
    // 24 strands of 452X: stops 0.66 mm before full draw, wall 475.5 N/mm (docs/model.md).
    expect(t).toMatchObject({
      'timing-end': '0.00°, cams in time',
      'first-stop': 'Both cams together',
      'draw-change': '0.00 mm',
      'second-stop': 'Both cams at the first stop',
      'wall-stiffness': '475.5 N/mm',
      'stretch-draw': '−0.66 mm',
    });
    expect(timingItems(solve(defaultState(), { analysis: true }), state.units).map((i) => i.key)).not.toContain('second-stop');
    expect(ELASTIC_ITEMS.map((i) => i.key)).toEqual(['second-stop', 'wall-stiffness', 'stretch-draw']);
  });

  it('give the timing at the first stop and the second stop after it for a longer top cable', () => {
    const { state, result } = elastic({ topCable: 1 * MM });
    const t = texts(timingItems(result, state.units));
    expect(t['timing-end']).toMatch(/^\+6\.\d\d°, top cam ahead$/);
    expect(t['first-stop']).toMatch(/^Top cam; bottom cam gap 3\.\d\d mm$/);
    expect(t['second-stop']).toMatch(/^Bottom cam, 5\.\d\d mm after the first$/);
    expect(t.sensitivity).toMatch(/^6\.\d\d°\/mm$/);
  });
});

describe('build lengths with elastic cords', () => {
  const state = defaultState();
  const result = solve(state);
  const ctx = /** @type {import('../../src/core/layout.js').LayoutContext} */ (createLayout(result, state.geometry).layout);
  const stiffness = { string: 296640, topCable: 296640, bottomCable: 148320 };

  it('list the free length and the length at 100 lbf of each cord', () => {
    const rigid = planDims(ctx, state.units);
    expect(rigid.map((d) => d.key)).not.toContain('string-free');
    const dims = planDims(ctx, state.units, null, stiffness);
    expect(dims.map((d) => d.key).slice(0, 8)).toEqual([
      'string', 'cable', 'string-free', 'string-loaded', 'top-cable-free', 'top-cable-loaded', 'bottom-cable-free', 'bottom-cable-loaded',
    ]);
    const b = buildLengths(ctx.lengths, { string: ctx.loads.Ts[0], cable: ctx.loads.Tc[0] }, stiffness);
    expect(b.string.free).toBeLessThan(ctx.lengths.string);
    expect(b.bottomCable.free).toBeLessThan(b.topCable.free);
    expect(dims.find((d) => d.key === 'string-loaded')?.label).toBe('String at 445 N (100 lbf)');
    expect(planDims(ctx, { ...state.units, force: 'lbf' }, null, stiffness).find((d) => d.key === 'string-loaded')?.label).toBe('String at 100 lbf (445 N)');
    expect(dims.find((d) => d.key === 'string-free')?.text).toBe(`${(b.string.free * 1000).toFixed(1)} mm (${(b.string.free / 0.0254).toFixed(3)} in)`);
  });

  it('name them in the export README, and keep the design files and names', () => {
    const e = { ...state, tuning: { ...state.tuning, cordModel: /** @type {const} */ ('elastic') } };
    const plain = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(result, state, { date, version: '0', units: state.units }).set);
    const set = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(result, e, { date, version: '0', units: state.units }).set);
    expect(plain.readme).not.toContain('Build lengths with cord stretch');
    expect(set.readme).toContain('Build lengths with cord stretch');
    expect(set.readme).toMatch(/ {2}String \(EA 296640 N\): free \d+\.\d mm \(\d+\.\d{3} in\), at 445 N \(100 lbf\) \d+\.\d mm/);
    expect(set.files.map((f) => [f.name, f.text])).toEqual(plain.files.map((f) => [f.name, f.text]));
  });

  it('name the cord model in the text of the timing string plan', () => {
    const tuning = { ...state.tuning, topCable: 1 * MM };
    const rigid = solve({ ...state, tuning }, { analysis: { offsets: tuning } });
    const e = { ...tuning, cordModel: /** @type {const} */ ('elastic') };
    const el = solve({ ...state, tuning: e }, { analysis: { offsets: e, stiffness: cordStiffness(e) } });
    const plan = (/** @type {typeof rigid} */ r, /** @type {import('../../src/state/schema.js').Tuning} */ t) =>
      /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(r, { ...state, tuning: t }, { date, version: '0', units: state.units }).set)
        .files.find((f) => f.part === 'timing-string-plan')?.text ?? '';
    expect(plan(rigid, tuning)).toContain('rigid cords, nock free');
    expect(plan(el, e)).toContain('elastic cords, EA string 296640 N, top cable 296640 N, bottom cable 296640 N');
  });

  it('give the timing files of elastic cords their own timing id', () => {
    const t = { ...state.tuning, topCable: 1 * MM };
    expect(timingId({ ...t, cordModel: 'elastic' })).not.toBe(timingId(t));
    expect(timingId({ ...t, stringStrands: 20 })).toBe(timingId(t));
  });
});
