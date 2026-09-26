import { describe, expect, it } from 'vitest';
import { createLayout } from '../../src/core/layout.js';
import { solve } from '../../src/core/solve.js';
import { designId } from '../../src/export/files.js';
import { defaultState } from '../../src/state/presets.js';
import { loadMaxima, loadTable, tableRows } from '../../src/ui/loadchart.js';
import { MODEL_NOTE, dateTimeText, reportData } from '../../src/ui/report.js';
import { diagnosticItems, metricItems } from '../../src/ui/results.js';
import { inputGroups } from '../../src/ui/settings.js';
import { STATIC_SIZE, staticChartModel } from '../../src/ui/staticchart.js';
import { statItems } from '../../src/ui/stats.js';
import { planDims } from '../../src/ui/stringplan.js';

/** @typedef {import('../../src/core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../../src/state/schema.js').Units} Units */
/** @typedef {import('../../src/state/schema.js').ProjectState} ProjectState */

const state = defaultState();
const result = solve(state);
const ctx = /** @type {LayoutContext} */ (createLayout(result, state.geometry).layout);
/** @type {Units} */
const metric = { draw: 'mm', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {Units} */
const imperial = { draw: 'in', force: 'lbf', dims: 'in', energy: 'ft·lbf', stiffness: 'lbf/in' };

/**
 * Coordinates of a polyline point list.
 * @param {string} points
 */
function coords(points) {
  return points.split(' ').map((p) => p.split(',').map(Number));
}

describe('static force chart', () => {
  it('has a fixed size and view box, target and achieved curves inside the plot', () => {
    const m = /** @type {import('../../src/ui/staticchart.js').StaticChartModel} */ (staticChartModel(result, metric));
    expect(m).not.toBeNull();
    expect(m.width).toBe(STATIC_SIZE.width);
    expect(m.height).toBe(STATIC_SIZE.height);
    expect(m.viewBox).toBe(`0 0 ${STATIC_SIZE.width} ${STATIC_SIZE.height}`);
    expect(m.target.length).toBeGreaterThan(0);
    expect(m.achieved.length).toBeGreaterThan(0);
    const { left, right, top, bottom } = m.plot;
    for (const run of [...m.target, ...m.achieved]) {
      for (const [x, y] of coords(run)) {
        expect(x).toBeGreaterThanOrEqual(left - 0.1);
        expect(x).toBeLessThanOrEqual(right + 0.1);
        expect(y).toBeGreaterThanOrEqual(top - 0.1);
        expect(y).toBeLessThanOrEqual(bottom + 0.1);
      }
    }
    // Brace at the left edge of the plot, full draw at the right edge.
    expect(m.refs.map((r) => r.label)).toEqual(['Brace', 'Full draw']);
    expect(m.refs[0].at).toBeCloseTo(left, 6);
    expect(m.refs[1].at).toBeCloseTo(right, 6);
    // The target starts at brace and ends at full draw.
    const first = coords(m.target[0])[0];
    const last = coords(/** @type {string} */ (m.target.at(-1))).at(-1);
    expect(first[0]).toBeCloseTo(left, 0);
    expect(last?.[0]).toBeCloseTo(right, 0);
  });

  it('labels the axes and ticks in the display units', () => {
    const mm = /** @type {import('../../src/ui/staticchart.js').StaticChartModel} */ (staticChartModel(result, metric));
    const inch = /** @type {import('../../src/ui/staticchart.js').StaticChartModel} */ (staticChartModel(result, imperial));
    expect(mm.xTitle).toBe('Draw length (AMO), mm');
    expect(mm.yTitle).toBe('Draw force, N');
    expect(inch.xTitle).toBe('Draw length (AMO), in');
    expect(inch.yTitle).toBe('Draw force, lbf');
    // The default draw runs from about 8.25 in (210 mm) to 29 in (737 mm).
    const values = (/** @type {{ text: string }[]} */ t) => t.map((v) => Number(v.text));
    expect(Math.max(...values(mm.xTicks))).toBeGreaterThan(600);
    expect(Math.max(...values(inch.xTicks))).toBeLessThanOrEqual(29);
    // The peak of 270 N (61 lbf) lies under the top tick.
    expect(Math.max(...values(mm.yTicks))).toBeGreaterThan(270);
    expect(Math.max(...values(inch.yTicks))).toBeLessThan(80);
    for (const t of mm.yTicks) {
      expect(t.at).toBeGreaterThanOrEqual(mm.plot.top - 1e-9);
      expect(t.at).toBeLessThanOrEqual(mm.plot.bottom + 1e-9);
    }
  });

  it('draws nothing without a target curve and only the target without an achieved curve', () => {
    expect(staticChartModel({ target: null, achieved: null }, metric)).toBeNull();
    const m = staticChartModel({ target: result.target, achieved: null }, metric);
    expect(m?.target.length).toBeGreaterThan(0);
    expect(m?.achieved).toEqual([]);
  });
});

describe('report data', () => {
  const date = new Date(2026, 8, 5, 7, 4);
  /** @param {Partial<import('../../src/ui/report.js').ReportSource>} over */
  const data = (over = {}) => reportData({ result, state, now: state, name: 'Target bow', version: '0.1.0', date, ...over });

  it('names the design, date, version and the cam of the exports', () => {
    const d = data();
    expect(d.name).toBe('Target bow');
    expect(d.printed).toBe('2026-09-05 07:04');
    expect(d.version).toBe('0.1.0');
    expect(d.id).toBe(designId(state));
    expect(d.status).toBe(`This report shows the current cam, design ${d.id}`);
    expect(d.note).toBe(MODEL_NOTE);
  });

  it('says that later edits are not included when the inputs changed since', () => {
    const now = { ...state, geometry: { ...state.geometry, braceHeight: state.geometry.braceHeight + 0.001 } };
    const d = data({ now });
    expect(d.id).toBe(designId(state));
    expect(d.status).toBe(`This report shows the last cam that met every check, design ${d.id}; later edits are not included`);
  });

  it('uses the units of the current inputs for every value', () => {
    const now = { ...state, units: imperial };
    const d = data({ now });
    const withUnits = { ...state, units: imperial };
    expect(d.units).toBe(imperial);
    expect(d.metrics).toEqual(metricItems(result, imperial));
    expect(d.metrics.find((m) => m.key === 'peak')?.text).toMatch(/ lbf$/);
    expect(d.target).toEqual(statItems(withUnits));
    expect(d.inputs).toEqual(inputGroups(withUnits));
    expect(d.lengths).toEqual(planDims(ctx, imperial));
    expect(d.loads).toEqual(loadMaxima(ctx.loads, imperial));
    expect(d.table).toEqual(loadTable(ctx, imperial));
    expect(d.table.head[0]).toBe('Draw (AMO), in');
    // The design id ignores the display units: the cam is current.
    expect(d.status).toMatch(/^This report shows the current cam/);
  });

  it('lists the metrics, the diagnostics and a force table at 10 % steps', () => {
    const d = data();
    expect(d.metrics).toEqual(metricItems(result, state.units));
    expect(d.diagnostics).toEqual(diagnosticItems(result));
    expect(d.table.rows).toHaveLength(11);
    expect(d.table.rows).toHaveLength(tableRows(ctx).length);
    for (const row of d.table.rows) expect(row).toHaveLength(d.table.head.length);
    expect(d.table.rows[0][0]).toBe('8.25');
    expect(d.table.rows[10][0]).toBe('29.00');
    expect(d.lengths.map((l) => l.key)).toEqual(['string', 'cable', 'ataBrace', 'ataFull', 'brace', 'draw']);
    expect(d.loads.map((l) => l.label)).toEqual(['String tension', 'Cable tension, each cable', 'Load on each limb tip', 'Limb tip load at brace']);
    expect(d.loads[0].text).toMatch(/^\d+ N at [\d.]+ in$/);
    // The limb tip load at brace is the load of the first table row.
    expect(Number(d.loads[3].text.split(' ')[0])).toBeCloseTo(Number(d.table.rows[0][4]), 0);
  });

  it('has no layout, lengths, loads or table when the result has no achieved curve', () => {
    const d = data({ result: { ...result, achieved: null } });
    expect(d.ctx).toBeNull();
    expect(d.lengths).toEqual([]);
    expect(d.loads).toEqual([]);
    expect(d.table.rows).toEqual([]);
  });
});

describe('inputs of the report', () => {
  it('group the fields as the settings panel and leave out hidden fields', () => {
    const groups = inputGroups(state);
    expect(groups.map((g) => g.title)).toEqual(['Bow geometry', 'Draw force', 'Limbs', 'String track', 'Cords', 'Cam body', 'Timing (analysis only)']);
    const labels = groups.flatMap((g) => g.rows.map((r) => r.label));
    expect(labels).toContain('Axle-to-axle length (ATA)');
    expect(labels).toContain('Limb stiffness at the axle');
    expect(labels).not.toContain('Axle travel, brace to full draw');
    expect(labels).toContain('Radius');
    expect(labels).not.toContain('Semi-major axis');
    const geometry = groups[0].rows;
    expect(geometry.find((r) => r.label === 'Axle-to-axle length (ATA)')?.text).toBe('33.00 in');
    expect(geometry.find((r) => r.label === 'Limb lever angle at brace')?.text).toBe('25.0°');
    const force = groups[1].rows;
    expect(force[0]).toEqual({ label: 'Curve', text: 'Parametric' });
    expect(force.find((r) => r.label === 'Let-off')?.text).toBe('75.0 %');
    expect(groups[2].rows[0]).toEqual({ label: 'Limb input', text: 'Stiffness and preload' });
    expect(groups[3].rows[0]).toEqual({ label: 'Shape', text: 'Eccentric circle' });
  });

  it('list the number of points and every value of a free-form string track', () => {
    const free = { ...state, stringTrack: { ...state.stringTrack, shape: /** @type {const} */ ('freeform') } };
    const track = /** @type {import('../../src/ui/settings.js').InputGroup} */ (inputGroups(free).find((g) => g.title === 'String track'));
    const labels = track.rows.map((r) => r.label);
    expect(labels.slice(0, 2)).toEqual(['Shape', 'Points']);
    expect(labels).not.toContain('Radius');
    expect(labels).not.toContain('Centre offset from the axle');
    expect(labels).not.toContain('Phase');
    expect(track.rows[0].text).toBe('Free-form');
    expect(track.rows[1].text).toBe('12');
    expect(track.rows).toHaveLength(14);
    expect(track.rows[2]).toEqual({ label: 'Point 1 at 0°: groove radius', text: '33.34 mm' });
    expect(track.rows[3]).toEqual({ label: 'Point 2 at 30°: groove radius', text: '25.58 mm' });
    const inches = inputGroups({ ...free, units: { ...free.units, dims: 'in' } }).find((g) => g.title === 'String track');
    expect(inches?.rows[2].text).toBe('1.3127 in');
    const sixteen = { ...free, stringTrack: { ...free.stringTrack, freeform: { values: Array(16).fill(0.03) } } };
    const rows = inputGroups(sixteen).find((g) => g.title === 'String track')?.rows ?? [];
    expect(rows[3]).toEqual({ label: 'Point 2 at 22.5°: groove radius', text: '30.00 mm' });
  });

  it('list the points of a custom curve and mark the parameters it does not use', () => {
    const s = { ...state, curve: { ...state.curve, mode: /** @type {const} */ ('custom') } };
    const force = inputGroups(s)[1].rows;
    expect(force[0]).toEqual({ label: 'Curve', text: 'Custom' });
    expect(force.filter((r) => r.text.endsWith('(applies after Reset curve)'))).toHaveLength(2);
    const points = force.filter((r) => r.label.startsWith('Point '));
    expect(points).toHaveLength(s.curve.points.length);
    expect(points[0]).toEqual({ label: 'Point 1: draw length (AMO), draw force', text: `${(s.geometry.braceHeight / 0.0254 + 1.75).toFixed(2)} in, 0.0 N` });
  });

  it('list the rows of a measured limb and the fields of an ellipse', () => {
    /** @type {ProjectState} */
    const s = {
      ...state,
      units: metric,
      limb: { ...state.limb, mode: 'table', table: [{ travel: 0, force: 400 }, { travel: 0.04, force: 500 }, { travel: 0.08, force: 600 }] },
      stringTrack: { ...state.stringTrack, shape: 'ellipse' },
    };
    const groups = inputGroups(s);
    const limbs = groups[2].rows;
    expect(limbs[0].text).toBe('Measured table');
    expect(limbs.map((r) => r.label)).not.toContain('Limb stiffness at the axle');
    expect(limbs.filter((r) => r.label.startsWith('Row '))).toEqual([
      { label: 'Row 1: travel from brace, force at the axle', text: '0.00 mm, 400.0 N' },
      { label: 'Row 2: travel from brace, force at the axle', text: '40.00 mm, 500.0 N' },
      { label: 'Row 3: travel from brace, force at the axle', text: '80.00 mm, 600.0 N' },
    ]);
    const track = groups[3].rows.map((r) => r.label);
    expect(track).toEqual(['Shape', 'Semi-major axis', 'Semi-minor axis', 'Centre offset from the axle', 'Phase']);
  });
});

describe('date and time of the report', () => {
  it('reads YYYY-MM-DD HH:MM in local time', () => {
    expect(dateTimeText(new Date(2026, 0, 2, 3, 4, 59))).toBe('2026-01-02 03:04');
    expect(dateTimeText(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31 23:59');
  });
});
