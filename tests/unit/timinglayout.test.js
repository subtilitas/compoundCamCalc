import { describe, expect, it } from 'vitest';
import { createLayout } from '../../src/core/layout.js';
import { solve } from '../../src/core/solve.js';
import { createTimingLayout, hasChangedTiming, timingId, timingPoseAt } from '../../src/core/timinglayout.js';
import { TIMING_CSV_COLUMNS, writeTimingCsv } from '../../src/export/csv.js';
import { exportFiles } from '../../src/export/files.js';
import { defaultState } from '../../src/state/presets.js';
import { reportData } from '../../src/ui/report.js';
import { planBounds, planDims, planLabel, timingHalves, timingPoseText } from '../../src/ui/stringplan.js';
import { readDxf } from './dxf-reader.js';

const MM = 1e-3;
const date = new Date(2026, 8, 25, 14, 30, 5);

/**
 * Full solve of the default design with changed cords, as the worker runs it.
 * @param {Partial<import('../../src/state/schema.js').Tuning>} tuning
 */
function solved(tuning) {
  const state = defaultState();
  state.tuning = { ...state.tuning, ...tuning };
  const result = solve(state, { analysis: { offsets: state.tuning } });
  const ctx = /** @type {import('../../src/core/layout.js').LayoutContext} */ (createLayout(result, state.geometry).layout);
  return { state, result, ctx };
}

const changed = solved({ topCable: 1 * MM });
const plain = solved({});

/**
 * Unit normal of a support at contact angle psi of a cam turned by theta, in
 * the frame of its half.
 * @param {number} psi
 * @param {number} theta
 */
const normal = (psi, theta) => ({ x: Math.cos(psi - theta), y: Math.sin(psi - theta) });

describe('timing layout', () => {
  it('exists for changed cords only', () => {
    expect(hasChangedTiming(changed.result)).toBe(true);
    expect(hasChangedTiming(plain.result)).toBe(false);
    expect(hasChangedTiming(solve(defaultState()))).toBe(false);
    expect(hasChangedTiming(null)).toBe(false);
    expect(createTimingLayout(plain.result, plain.ctx)).toBeNull();
    expect(createTimingLayout(changed.result, { ...changed.ctx, limbLength: NaN })).toBeNull();
    expect(createTimingLayout(/** @type {any} */ ({ analysis: {} }), changed.ctx)).toBeNull();
  });

  it('reproduces the analysis at its samples, with the cords tangent to the tracks', () => {
    const tl = /** @type {import('../../src/core/timinglayout.js').TimingLayout} */ (createTimingLayout(changed.result, changed.ctx));
    const a = tl.analysis;
    expect(tl.count).toBe(a.end + 1);
    expect(tl.xBrace).toBe(a.x[0]);
    expect(tl.xEnd).toBe(a.x[a.end]);
    for (let i = 0; i <= a.end; i += 7) {
      const p = /** @type {import('../../src/core/timinglayout.js').TimingPose} */ (timingPoseAt(tl, a.x[i]));
      expect(p.x).toBe(a.x[i]);
      expect(p.y).toBe(a.y[i]);
      expect(p.top.theta).toBe(a.thetaTop[i]);
      expect(p.bottom.theta).toBe(a.thetaBottom[i]);
      expect(p.top.nockY).toBe(a.y[i]);
      expect(p.bottom.nockY).toBe(-a.y[i]);
      // The cable of a half ends at the axle of the other half, in its frame.
      expect(p.top.anchorX).toBeCloseTo(p.bottom.axleX, 12);
      expect(p.top.anchorY).toBeCloseTo(-p.bottom.axleY, 12);
      expect(p.bottom.anchorY).toBeCloseTo(-p.top.axleY, 12);
      const psi = [
        [p.top, a.psiStringTop[i], a.psiCableTop[i]],
        [p.bottom, a.psiStringBottom[i], a.psiCableBottom[i]],
      ];
      for (const [h, psiS, psiC] of /** @type {[import('../../src/core/timinglayout.js').HalfPose, number, number][]} */ (psi)) {
        // Free spans lie on the tangent of their track: normal to the support normal.
        const ns = normal(psiS, h.theta);
        const sx = p.x - h.stringX;
        const sy = h.nockY - h.stringY;
        expect(Math.abs(sx * ns.x + sy * ns.y) / Math.hypot(sx, sy)).toBeLessThan(1e-9);
        const nc = normal(psiC, h.theta);
        const cx = h.anchorX - h.cableX;
        const cy = h.anchorY - h.cableY;
        expect(Math.abs(cx * nc.x + cy * nc.y) / Math.hypot(cx, cy)).toBeLessThan(1e-9);
      }
    }
  });

  it('interpolates between samples and clamps to the draw', () => {
    const tl = /** @type {import('../../src/core/timinglayout.js').TimingLayout} */ (createTimingLayout(changed.result, changed.ctx));
    const a = tl.analysis;
    const mid = /** @type {import('../../src/core/timinglayout.js').TimingPose} */ (timingPoseAt(tl, 0.5 * (a.x[10] + a.x[11])));
    expect(mid.top.theta).toBeCloseTo(0.5 * (a.thetaTop[10] + a.thetaTop[11]), 12);
    expect(mid.F).toBeCloseTo(0.5 * (a.F[10] + a.F[11]), 9);
    expect(timingPoseAt(tl, tl.xBrace - 0.1)?.x).toBe(tl.xBrace);
    expect(timingPoseAt(tl, tl.xEnd + 0.1)?.x).toBe(tl.xEnd);
    expect(timingPoseAt(tl, NaN)).toBeNull();
  });

  it('names the timing settings by a short id', () => {
    const t = defaultState().tuning;
    expect(timingId(t)).toMatch(/^[0-9a-f]{6}$/);
    expect(timingId({ ...t })).toBe(timingId(t));
    expect(timingId({ ...t, topCable: 0.001 })).not.toBe(timingId(t));
    expect(timingId({ ...t, topCable: 0.001 })).not.toBe(timingId({ ...t, bottomCable: 0.001 }));
  });
});

describe('timing table', () => {
  it('lists every sample from brace to the end of the draw', () => {
    const a = /** @type {import('../../src/core/analysis.js').AnalysisResult} */ (changed.result.analysis);
    const out = writeTimingCsv(a, changed.state.units);
    expect(out.error).toBeNull();
    const lines = /** @type {string} */ (out.text).trimEnd().split('\r\n');
    expect(lines).toHaveLength(a.end + 2);
    expect(lines[0].split(',')).toHaveLength(TIMING_CSV_COLUMNS.length);
    expect(lines[0]).toMatch(/^"?Draw length AMO \(in\)"?,/);
    const last = lines[lines.length - 1].split(',').map(Number);
    // Cam timing column: top minus bottom, 6.89° at the first stop (docs/model.md).
    expect(last[6]).toBeCloseTo(6.89, 2);
    expect(last[6]).toBeCloseTo(last[4] - last[5], 2);
    expect(writeTimingCsv(a, { ...changed.state.units, draw: /** @type {any} */ ('yd') }).error).toMatch(/unit/);
    expect(writeTimingCsv(/** @type {any} */ ({ end: -1 }), changed.state.units).error).toMatch(/no draw/);
  });
});

describe('timing export files', () => {
  const options = { date, version: '0.2.0', units: changed.state.units };

  it('adds the timing files only for changed cords and keeps the design files', () => {
    const base = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(plain.result, plain.state, options).set);
    const set = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(changed.result, changed.state, options).set);
    expect(base.files.some((f) => f.part.startsWith('timing'))).toBe(false);
    const tid = timingId(changed.state.tuning);
    const timing = set.files.filter((f) => f.part.startsWith('timing'));
    expect(timing.map((f) => f.name)).toEqual([
      `cam-20260925-${set.id}-timing-${tid}-string-plan.dxf`,
      `cam-20260925-${set.id}-timing-${tid}.csv`,
    ]);
    // Every design file is the same as without the timing settings.
    expect(set.id).toBe(base.id);
    const design = set.files.filter((f) => !f.part.startsWith('timing'));
    expect(design.map((f) => [f.name, f.text])).toEqual(base.files.map((f) => [f.name, f.text]));
  });

  it('draws both halves of the changed bow with their own nock position', () => {
    const set = /** @type {NonNullable<ReturnType<typeof exportFiles>['set']>} */ (exportFiles(changed.result, changed.state, options).set);
    const file = /** @type {(typeof set.files)[number]} */ (set.files.find((f) => f.part === 'timing-string-plan'));
    const doc = readDxf(file.text);
    const entities = doc.sections.ENTITIES;
    /** @param {import('./dxf-reader.js').DxfItem} e @param {number} code */
    const str = (e, code) => e.pairs.find((p) => p[0] === code)?.[1];
    /** @param {import('./dxf-reader.js').DxfItem} e @param {number} code */
    const num = (e, code) => Number(str(e, code));
    const tl = /** @type {import('../../src/core/timinglayout.js').TimingLayout} */ (createTimingLayout(changed.result, changed.ctx));
    const end = /** @type {import('../../src/core/timinglayout.js').TimingPose} */ (timingPoseAt(tl, tl.xEnd));
    // String lines end at the nock, both halves at the same world point.
    const nockEnds = entities.filter((e) => e.type === 'LINE' && str(e, 8) === 'END')
      .filter((e) => Math.abs(num(e, 11) - end.x * 1e3) < 1e-6);
    expect(nockEnds).toHaveLength(2);
    for (const e of nockEnds) expect(num(e, 21)).toBeCloseTo(end.y * 1e3, 6);
    const texts = entities.filter((e) => e.type === 'TEXT').map((e) => str(e, 1)).join('\n');
    expect(texts).toContain('Top cable +1.00 mm, bottom cable +0.00 mm');
    expect(texts).toMatch(/top cam first, bottom gap 3\.81 mm; cam timing 6\.89 deg/);
  });
});

describe('string plan of the changed bow', () => {
  it('draws each half from its pose and lists the changed brace and draw', () => {
    const tl = /** @type {import('../../src/core/timinglayout.js').TimingLayout} */ (createTimingLayout(changed.result, changed.ctx));
    const tp = /** @type {import('../../src/core/timinglayout.js').TimingPose} */ (timingPoseAt(tl, tl.xEnd));
    const [top, bottom] = timingHalves(tp);
    expect(top.nockY).toBe(tp.y);
    expect(bottom.nockY).toBe(-tp.y);
    expect(bottom.theta).toBe(tp.bottom.theta);
    const b = planBounds([top, bottom], 0);
    expect(b.maxY).toBeGreaterThanOrEqual(Math.max(top.axleY, bottom.axleY));
    expect(timingPoseText(tp, changed.state.units)).toMatch(/^Timing settings at the draw position: nock height −6\.1\d mm, cam timing \+6\.89°$/);
    const dims = planDims(changed.ctx, changed.state.units, tl);
    expect(dims.map((d) => d.key)).toEqual(['string', 'cable', 'ataBrace', 'ataFull', 'brace', 'draw', 'timing-brace', 'timing-end']);
    expect(planDims(changed.ctx, changed.state.units).map((d) => d.key)).not.toContain('timing-end');
    expect(planLabel(0.8, true, false, changed.state.units, true)).toContain('top and bottom with the timing settings');
    expect(planLabel(0.8, true, false, changed.state.units)).toContain('top and bottom symmetric');
  });
});

describe('report of the timing settings', () => {
  const src = { result: changed.result, state: changed.state, now: changed.state, name: 'Bow', version: '0.2.0', date };

  it('lists the timing results of the listed settings', () => {
    const d = reportData(src);
    expect(d.timingChanged).toBe(true);
    expect(Object.fromEntries(d.timing.map((i) => [i.key, i.text]))['timing-end']).toBe('+6.89°, top cam ahead');
    // Settings changed since the solve: their results are not yet known.
    const now = { ...changed.state, tuning: { ...changed.state.tuning, topCable: 2 * MM } };
    expect(reportData({ ...src, now }).timing).toEqual([]);
    expect(reportData({ ...src, result: plain.result, state: plain.state, now: plain.state }).timingChanged).toBe(false);
  });
});
