import { describe, expect, it } from 'vitest';
import { INCH, LBF } from '../../src/core/units.js';
import { sampleTrack } from '../../src/core/freeform.js';
import { defaultState } from '../../src/state/presets.js';
import { validate } from '../../src/state/schema.js';
import {
  LIMB_MODE_HINTS,
  LIMB_TABLE,
  formatLimbRows,
  fromDisplay,
  nextLimbRow,
  parseField,
  parseLimbRows,
  quantityOf,
  freeformSummary,
  seedLimbTable,
  shapeChange,
  sliderStep,
  stringTrackExtra,
  stringTrackMessage,
  toDisplay,
  unitOf,
  validateLimbRows,
  withUnit,
} from '../../src/ui/settings.js';

/** @type {import('../../src/state/schema.js').Units} */
const metric = { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {import('../../src/state/schema.js').Units} */
const imperial = { draw: 'in', force: 'lbf', dims: 'in', energy: 'ft·lbf', stiffness: 'lbf/in' };
const DEG = Math.PI / 180;

describe('field units', () => {
  it('maps every kind to its quantity and display unit', () => {
    expect(quantityOf('draw')).toBe('length');
    expect(quantityOf('dims')).toBe('length');
    expect(quantityOf('force')).toBe('force');
    expect(quantityOf('angle')).toBe('angle');
    expect(quantityOf('stiffness')).toBe('stiffness');
    expect(quantityOf('percent')).toBe('ratio');
    expect(unitOf({ kind: 'draw' }, { ...metric, draw: 'cm' })).toBe('cm');
    expect(unitOf({ kind: 'dims' }, metric)).toBe('mm');
    expect(unitOf({ kind: 'dims' }, imperial)).toBe('in');
    expect(unitOf({ kind: 'force' }, imperial)).toBe('lbf');
    expect(unitOf({ kind: 'angle' }, imperial)).toBe('°');
    expect(unitOf({ kind: 'stiffness' }, metric)).toBe('N/mm');
    expect(unitOf({ kind: 'stiffness' }, imperial)).toBe('lbf/in');
    expect(unitOf({ kind: 'percent' }, metric)).toBe('%');
  });

  it('converts dimensions, angles and stiffness to and from the display unit', () => {
    expect(toDisplay({ kind: 'dims' }, 0.0025, metric)).toBeCloseTo(2.5, 12);
    expect(toDisplay({ kind: 'dims' }, INCH, imperial)).toBeCloseTo(1, 12);
    expect(toDisplay({ kind: 'angle' }, 30 * DEG, metric)).toBeCloseTo(30, 12);
    expect(toDisplay({ kind: 'stiffness' }, 2600, metric)).toBeCloseTo(2.6, 12);
    expect(toDisplay({ kind: 'stiffness' }, LBF / INCH, imperial)).toBeCloseTo(1, 12);
    expect(toDisplay({ kind: 'percent' }, 0.75, metric)).toBeCloseTo(75, 12);
    for (const kind of /** @type {const} */ (['draw', 'dims', 'force', 'percent', 'angle', 'stiffness'])) {
      for (const units of [metric, imperial]) {
        expect(fromDisplay({ kind }, toDisplay({ kind }, 0.123, units), units)).toBeCloseTo(0.123, 12);
      }
    }
  });

  it('parses text with and without a unit suffix', () => {
    expect(parseField({ kind: 'dims' }, '2,5', metric)).toBeCloseTo(0.0025, 12);
    expect(parseField({ kind: 'dims' }, '0.1 in', metric)).toBeCloseTo(0.1 * INCH, 12);
    expect(parseField({ kind: 'angle' }, '-122', metric)).toBeCloseTo(-122 * DEG, 12);
    expect(parseField({ kind: 'angle' }, '1 rad', metric)).toBeCloseTo(1, 12);
    expect(parseField({ kind: 'angle' }, '30°', metric)).toBeCloseTo(30 * DEG, 12);
    expect(parseField({ kind: 'angle' }, '30 °', metric)).toBeCloseTo(30 * DEG, 12);
    expect(parseField({ kind: 'angle' }, '30 deg', metric)).toBeCloseTo(30 * DEG, 12);
    expect(parseField({ kind: 'angle' }, '°', metric)).toBeNaN();
    expect(parseField({ kind: 'stiffness' }, '2.6', metric)).toBeCloseTo(2600, 9);
    expect(parseField({ kind: 'stiffness' }, '10 lbf/in', metric)).toBeCloseTo((10 * LBF) / INCH, 9);
    expect(parseField({ kind: 'percent' }, '75 %', metric)).toBeCloseTo(0.75, 12);
    expect(parseField({ kind: 'dims' }, 'abc', metric)).toBeNaN();
  });

  it('writes the degree symbol without a space and other units with one', () => {
    expect(withUnit('30.0', '°')).toBe('30.0°');
    expect(withUnit('12.5', 'mm')).toBe('12.5 mm');
    expect(withUnit('75', '%')).toBe('75 %');
  });
});

describe('string track checks', () => {
  it('accepts the default track', () => {
    const s = defaultState();
    expect(stringTrackMessage(s.stringTrack, s.units)).toBeNull();
  });

  it('mirrors the cross-field rules of the schema', () => {
    const s = defaultState();
    // Eccentric: offset below the radius (45 mm).
    expect(stringTrackExtra('offset', 0.045, s)).toBe('String track offset must be smaller than the radius (45.0 mm)');
    expect(stringTrackExtra('radius', 0.02, s)).toMatch(/smaller than the radius/);
    // Semi-minor axis at most the semi-major axis (50 mm), in any shape.
    expect(stringTrackExtra('semiMinor', 0.06, s)).toBe(
      'String track semi-minor axis must not exceed the semi-major axis (50.0 mm)',
    );
    expect(stringTrackExtra('semiMajor', 0.03, s)).toMatch(/must not exceed the semi-major axis/);
    expect(stringTrackExtra('semiMinor', 0.05, s)).toBeNull();
    // Ellipse: offset below the semi-minor axis.
    const ellipse = { ...s, stringTrack: { ...s.stringTrack, shape: /** @type {const} */ ('ellipse') } };
    expect(stringTrackExtra('offset', 0.041, ellipse)).toMatch(/smaller than the semi-minor axis \(40\.0 mm\)/);
    expect(stringTrackExtra('offset', 0.041, s)).toBeNull();
    expect(stringTrackExtra('shape', 'ellipse', { ...s, stringTrack: { ...s.stringTrack, offset: 0.042 } })).toMatch(
      /semi-minor axis/,
    );
    const inches = { ...s, units: imperial };
    expect(stringTrackExtra('offset', 0.045, inches)).toMatch(/\(1\.772 in\)$/);
  });

  it('agrees with schema validation', () => {
    const s = defaultState();
    for (const [key, value] of /** @type {const} */ ([
      ['offset', 0.045],
      ['offset', 0.03],
      ['radius', 0.02],
      ['semiMinor', 0.06],
      ['semiMajor', 0.045],
    ])) {
      for (const shape of /** @type {const} */ (['eccentric', 'ellipse'])) {
        const state = { ...s, stringTrack: { ...s.stringTrack, shape } };
        const message = stringTrackExtra(key, value, state);
        const errors = validate({ ...state, stringTrack: { ...state.stringTrack, [key]: value } });
        expect(message !== null, `${shape} ${key} ${value}`).toBe(errors.length > 0);
      }
    }
  });
});

describe('free-form string track settings', () => {
  it('check the number and range of the values, and no offset rule', () => {
    const s = defaultState();
    const free = { ...s.stringTrack, shape: /** @type {const} */ ('freeform') };
    expect(stringTrackMessage(free, s.units)).toBeNull();
    expect(stringTrackMessage({ ...free, offset: 0.049 }, s.units)).toBeNull();
    expect(stringTrackMessage({ ...free, freeform: { values: Array(7).fill(0.03) } }, s.units)).toBe('A free-form track needs 8 to 16 values');
    expect(stringTrackMessage({ ...free, freeform: { values: [...Array(11).fill(0.03), 0.001] } }, s.units)).toBe(
      'Free-form track value 12 must be between 2 and 150 mm',
    );
    // The eccentric track does not look at the free-form values.
    expect(stringTrackMessage({ ...s.stringTrack, freeform: { values: [] } }, s.units)).toBeNull();
  });

  it('switch to free-form by sampling the current track at 12 points', () => {
    const s = defaultState();
    const ellipse = { ...s, stringTrack: { ...s.stringTrack, shape: /** @type {const} */ ('ellipse'), offset: 0.01 } };
    expect(shapeChange('freeform', ellipse)).toEqual({ shape: 'freeform', freeform: { values: sampleTrack(ellipse.stringTrack, 12) } });
    expect(shapeChange('freeform', s).freeform?.values).toEqual(s.stringTrack.freeform.values);
    // Already free-form, or back to an analytic shape: the shape only.
    const free = { ...s, stringTrack: { ...s.stringTrack, shape: /** @type {const} */ ('freeform'), freeform: { values: Array(8).fill(0.03) } } };
    expect(shapeChange('freeform', free)).toEqual({ shape: 'freeform' });
    expect(shapeChange('eccentric', free)).toEqual({ shape: 'eccentric' });
    expect(shapeChange('ellipse', s)).toEqual({ shape: 'ellipse' });
    // A sampled value below 2 mm fails the check before the store sees it.
    const tiny = { ...s, stringTrack: { ...s.stringTrack, radius: 0.005, offset: 0.0035 } };
    expect(validate(tiny)).toEqual([]);
    const change = shapeChange('freeform', tiny);
    expect(stringTrackMessage({ ...tiny.stringTrack, ...change }, s.units)).toMatch(/^Free-form track value \d+ must be between 2 and 150 mm$/);
  });

  it('summarise the track in one line', () => {
    const s = defaultState();
    expect(freeformSummary(s.stringTrack)).toBe('Free-form track, 12 points');
    expect(freeformSummary({ ...s.stringTrack, freeform: { values: Array(16).fill(0.03) } })).toBe('Free-form track, 16 points');
  });
});

describe('limb mode hints', () => {
  it('has one line per limb mode', () => {
    expect(Object.keys(LIMB_MODE_HINTS).sort()).toEqual(['stiffness', 'table', 'travel']);
    for (const text of Object.values(LIMB_MODE_HINTS)) {
      expect(text).not.toMatch(/[!\n]/);
      expect(text.endsWith('.')).toBe(true);
    }
  });
});

describe('limb table rows', () => {
  const rows = [
    { travel: 0, force: 500 },
    { travel: 0.04, force: 600 },
    { travel: 0.08, force: 700 },
  ];

  it('formats rows in the display units', () => {
    expect(formatLimbRows(rows, metric)).toEqual([
      { travel: '0.00', force: '500.0' },
      { travel: '40.00', force: '600.0' },
      { travel: '80.00', force: '700.0' },
    ]);
    expect(formatLimbRows([{ travel: INCH, force: LBF }], imperial)).toEqual([{ travel: '1.0000', force: '1.0' }]);
    // Rows at the smallest allowed gap read differently in both units.
    const gap = [{ travel: 0, force: 1 }, { travel: LIMB_TABLE.travelGapMin, force: 2 }];
    for (const u of [metric, imperial]) {
      const [a, b] = formatLimbRows(gap, u);
      expect(a.travel).not.toBe(b.travel);
    }
  });

  it('accepts valid rows', () => {
    expect(validateLimbRows(rows, metric)).toEqual([]);
  });

  it('needs 3 to 50 rows', () => {
    expect(validateLimbRows(rows.slice(0, 2), metric)).toEqual([
      { row: -1, column: 'table', message: 'The limb table needs 3 to 50 rows' },
    ]);
    const many = Array.from({ length: LIMB_TABLE.maxRows + 1 }, (_, i) => ({ travel: i * 0.001, force: 100 }));
    expect(validateLimbRows(many, metric)[0].column).toBe('table');
  });

  it('reports increasing travel, ranges and numbers per cell', () => {
    const bad = [
      { travel: 0.01, force: 500 },
      { travel: 0.01, force: -1 },
      { travel: 0.5, force: NaN },
      { travel: NaN, force: 20000 },
    ];
    expect(validateLimbRows(bad, metric)).toEqual([
      { row: 1, column: 'travel', message: 'Row 2: travel must be larger than in row 1' },
      { row: 1, column: 'force', message: 'Row 2: force must be between 0 and 10000 N' },
      { row: 2, column: 'travel', message: 'Row 3: travel must be between 0 and 400 mm' },
      { row: 2, column: 'force', message: 'Row 3: force must be a number' },
      { row: 3, column: 'travel', message: 'Row 4: travel must be a number' },
      { row: 3, column: 'force', message: 'Row 4: force must be between 0 and 10000 N' },
    ]);
    // Upper bounds are rounded down at the decimals of the cells: 2248.09 lbf
    // shows as 2248, 15.748 in stays.
    const imperialErrors = validateLimbRows([bad[0], bad[1], { travel: 0.5, force: 1 }], imperial);
    expect(imperialErrors[1].message).toBe('Row 2: force must be between 0 and 2248 lbf');
    expect(imperialErrors[2].message).toBe('Row 3: travel must be between 0 and 15.748 in');
  });

  it('accepts the printed bounds and clamps values just past a bound', () => {
    const texts = [
      { travel: '0', force: '0' },
      { travel: '1', force: '100' },
      { travel: '15.748', force: '2248' },
    ];
    expect(parseLimbRows(texts, imperial).errors).toEqual([]);
    const near = [
      { travel: `${-1e-12}`, force: '0' },
      { travel: '100', force: '100' },
      { travel: `${400 * (1 + 1e-10)}`, force: `${10000 * (1 + 1e-10)}` },
    ];
    const { rows: parsed, errors } = parseLimbRows(near, metric);
    expect(errors).toEqual([]);
    expect(parsed[0].travel).toBe(0);
    expect(parsed[2]).toEqual({ travel: LIMB_TABLE.travelMax, force: LIMB_TABLE.forceMax });
    const past = parseLimbRows([...near.slice(0, 2), { travel: '400.01', force: '10000.1' }], metric);
    expect(past.errors.map((e) => e.column)).toEqual(['travel', 'force']);
  });

  it('needs a minimum travel step between rows', () => {
    const close = [rows[0], { travel: 0.000005, force: 550 }, rows[2]];
    expect(validateLimbRows(close, metric)).toEqual([
      { row: 1, column: 'travel', message: 'Row 2: travel must be at least 0.01 mm larger than in row 1' },
    ]);
    expect(validateLimbRows([rows[0], { travel: LIMB_TABLE.travelGapMin, force: 550 }, rows[2]], metric)).toEqual([]);
    expect(validateLimbRows(close, imperial)[0].message).toMatch(/at least 0\.000393701 in larger/);
  });

  it('parses text and keeps unchanged cells exact', () => {
    const previous = [
      { travel: 0.0123456, force: 500.04 },
      { travel: 0.04, force: 600 },
      { travel: 0.08, force: 700 },
    ];
    const texts = formatLimbRows(previous, metric);
    texts[1] = { travel: '45', force: '0.1 lbf' };
    const { rows: parsed, errors } = parseLimbRows(texts, metric, previous);
    expect(errors).toEqual([]);
    expect(parsed[0]).toEqual(previous[0]);
    expect(parsed[1].travel).toBeCloseTo(0.045, 12);
    expect(parsed[1].force).toBeCloseTo(0.1 * LBF, 12);
    expect(parsed[2]).toEqual(previous[2]);
    const wrong = parseLimbRows([{ travel: 'x', force: '1' }, ...texts.slice(1)], metric, previous);
    expect(wrong.errors).toEqual([{ row: 0, column: 'travel', message: 'Row 1: travel must be a number' }]);
    expect(parseLimbRows(texts, metric).rows[0].travel).toBeCloseTo(0.01235, 12);
  });

  it('seeds a valid table from the linear limb', () => {
    const s = defaultState();
    const table = seedLimbTable(s.limb);
    expect(table).toHaveLength(5);
    expect(table[0]).toEqual({ travel: 0, force: s.limb.stiffness * s.limb.preloadTravel });
    expect(table[4].travel).toBeCloseTo(s.limb.travel, 12);
    expect(validateLimbRows(table, s.units)).toEqual([]);
    expect(validate({ ...s, limb: { ...s.limb, mode: 'table', table } })).toEqual([]);
  });

  it('continues the last interval when adding a row', () => {
    expect(nextLimbRow(rows)).toEqual({ travel: 0.12, force: 800 });
    expect(nextLimbRow([{ travel: 0.02, force: 100 }])).toEqual({ travel: 0.03, force: 100 });
    expect(nextLimbRow([])).toEqual({ travel: 0, force: 0 });
    const falling = nextLimbRow([
      { travel: 0, force: 50 },
      { travel: 0.39, force: 10 },
    ]);
    expect(falling).toEqual({ travel: 0.4, force: 0 });
    expect(nextLimbRow([{ travel: 0.3, force: 1 }, { travel: 0.4, force: 2 }])).toBeNull();
    expect(nextLimbRow([{ travel: 0.3, force: 1 }, { travel: 0.399995, force: 2 }])).toBeNull();
    const full = Array.from({ length: LIMB_TABLE.maxRows }, (_, i) => ({ travel: i * 0.001, force: 100 }));
    expect(nextLimbRow(full)).toBeNull();
  });
});

describe('slider step', () => {
  it('divides the range with both ends reachable', () => {
    expect(sliderStep(895, 895)).toBe(1);
    expect(sliderStep(191, 382)).toBe(0.5);
    // 201.1 lbf in 402 steps: a decimal step at most the exact one.
    const step = sliderStep(202.3 - 1.2, 402);
    expect(step).toBeLessThanOrEqual((202.3 - 1.2) / 402);
    expect(step * 402).toBeGreaterThan(202.3 - 1.2 - 1e-9);
    expect(String(step).replace(/^0\.|\./, '').replace(/^0+/, '').length).toBeLessThanOrEqual(12);
    expect(Math.floor((202.3 - 1.2) / step)).toBe(402);
  });
});
