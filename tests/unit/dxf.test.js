import { describe, expect, it } from 'vitest';
import { encodeText, formatKnot, formatNumber, writeDxf } from '../../src/export/dxf.js';
import { all, evaluateSpline, first, readDxf, readPairs, splineOf } from './dxf-reader.js';

/**
 * Clamped uniform knot vector for `count` cubic control points on [0, 1].
 * @param {number} count
 */
function clampedKnots(count) {
  const knots = [0, 0, 0, 0];
  for (let i = 1; i < count - 3; i++) knots.push(i / (count - 3));
  knots.push(1, 1, 1, 1);
  return knots;
}

/**
 * Closed control polygon on a circle, first point repeated at the end.
 * @param {number} count
 * @param {number} radius
 */
function circlePoints(count, radius) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    pts.push(radius * Math.cos(a), radius * Math.sin(a));
  }
  pts.push(pts[0], pts[1]);
  return pts;
}

/** @returns {import('../../src/export/dxf.js').DxfDocument} */
function sampleDoc() {
  const closed = circlePoints(8, 50);
  return {
    layers: [
      { name: 'PITCH', color: 1 },
      { name: 'GROOVE', color: 3 },
      { name: 'OUTLINE', color: 7 },
      { name: 'BORE', color: 5 },
      { name: 'MARKS', color: 2 },
    ],
    entities: [
      { type: 'spline', layer: 'PITCH', degree: 3, knots: clampedKnots(closed.length / 2), points: closed, id: 'string-pitch' },
      { type: 'spline', layer: 'GROOVE', degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1], points: [0, 0, 10, 20, 30, -5, 40, 0] },
      { type: 'lwpolyline', layer: 'OUTLINE', points: [-60, -60, 60, -60, 60, 60, -60, 60], id: 'outline' },
      { type: 'circle', layer: 'BORE', x: 0, y: 0, r: 4.1 },
      { type: 'line', layer: 'MARKS', x1: -5, y1: -0, x2: 5, y2: -1e-9 },
      { type: 'text', layer: 'MARKS', x: -55, y: 55, height: 3.5, text: 'Cam Ø 12° ^x', rotation: 90 },
      { type: 'text', layer: 'MARKS', x: -55, y: 45, height: 2.5, text: 'plain' },
    ],
  };
}

function written(doc = sampleDoc()) {
  const r = writeDxf(doc);
  expect(r.error).toBeNull();
  return /** @type {string} */ (r.text);
}

describe('writeDxf structure', () => {
  const text = written();
  const dxf = readDxf(text);
  const { HEADER, TABLES, BLOCKS, ENTITIES, OBJECTS } = dxf.sections;

  it('writes the sections in order with CRLF lines and width-3 codes', () => {
    expect(dxf.order).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
    expect(text.endsWith('  0\r\nEOF\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = text.split('\r\n');
    for (let i = 0; i < lines.length - 1; i += 2) {
      expect(lines[i].length).toBeGreaterThanOrEqual(3);
      expect(lines[i]).toMatch(/^ *\d+$/);
    }
    expect(dxf.sections.CLASSES).toEqual([]);
  });

  it('declares R2000 in millimetres', () => {
    expect(first(HEADER.$ACADVER, 1)).toBe('AC1015');
    expect(first(HEADER.$INSUNITS, 70)).toBe('4');
    expect(first(HEADER.$MEASUREMENT, 70)).toBe('1');
    expect(first(HEADER.$DWGCODEPAGE, 3)).toBe('ANSI_1252');
    expect(Number(first(HEADER.$EXTMIN, 10))).toBe(-60);
    expect(Number(first(HEADER.$EXTMAX, 20))).toBe(60);
  });

  it('gives unique handles, valid owners and a larger $HANDSEED', () => {
    const handles = dxf.pairs.filter(([c], i) => (c === 5 || c === 105) && dxf.pairs[i - 1]?.[1] !== '$HANDSEED').map((p) => p[1]);
    expect(new Set(handles).size).toBe(handles.length);
    const known = new Set(handles);
    for (const owner of all(dxf.pairs, 330)) expect(owner === '0' || known.has(owner)).toBe(true);
    for (const ref of [...all(dxf.pairs, 340), ...all(dxf.pairs, 350)]) expect(known.has(ref)).toBe(true);
    const seed = parseInt(/** @type {string} */ (first(HEADER.$HANDSEED, 5)), 16);
    expect(seed).toBeGreaterThan(Math.max(...handles.map((h) => parseInt(h, 16))));
    for (const h of handles) expect(h).toMatch(/^[0-9A-F]+$/);
  });

  it('writes the tables in order with counts', () => {
    expect(Object.keys(TABLES)).toEqual(['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']);
    for (const table of Object.values(TABLES)) {
      expect(Number(first(table.head, 70))).toBe(table.records.length);
      expect(first(table.head, 330)).toBe('0');
    }
    expect(all(TABLES.DIMSTYLE.head, 100)).toEqual(['AcDbSymbolTable', 'AcDbDimStyleTable']);
    expect(first(TABLES.DIMSTYLE.records[0].pairs, 105)).toBeDefined();
    expect(TABLES.APPID.records.map((r) => first(r.pairs, 2))).toEqual(['ACAD', 'CAMCALC']);
    const layers = TABLES.LAYER.records.map((r) => first(r.pairs, 2));
    expect(layers).toEqual(['0', 'PITCH', 'GROOVE', 'OUTLINE', 'BORE', 'MARKS']);
    expect(first(TABLES.LAYER.records[1].pairs, 62)).toBe('1');
    for (const e of ENTITIES) expect(layers).toContain(first(e.pairs, 8));
  });

  it('links block records, blocks and layouts', () => {
    const records = TABLES.BLOCK_RECORD.records;
    expect(records.map((r) => first(r.pairs, 2))).toEqual(['*Model_Space', '*Paper_Space']);
    const layouts = OBJECTS.filter((o) => o.type === 'LAYOUT');
    expect(layouts.map((l) => all(l.pairs, 1)[1])).toEqual(['Model', 'Layout1']);
    records.forEach((r, i) => {
      const handle = first(r.pairs, 5);
      expect(first(r.pairs, 340)).toBe(first(layouts[i].pairs, 5));
      expect(all(layouts[i].pairs, 330).at(-1)).toBe(handle);
      expect(first(BLOCKS[2 * i].pairs, 330)).toBe(handle);
      expect(first(BLOCKS[2 * i + 1].pairs, 330)).toBe(handle);
    });
    expect(BLOCKS.map((b) => b.type)).toEqual(['BLOCK', 'ENDBLK', 'BLOCK', 'ENDBLK']);
    for (const e of ENTITIES) expect(first(e.pairs, 330)).toBe(first(records[0].pairs, 5));
    const root = OBJECTS[0];
    expect(root.type).toBe('DICTIONARY');
    expect(first(root.pairs, 330)).toBe('0');
    expect(all(root.pairs, 3)).toEqual(['ACAD_GROUP', 'ACAD_LAYOUT']);
    expect(text).toContain('ACAD_LAYOUT');
  });

  it('writes SPLINE and LWPOLYLINE data', () => {
    const splines = ENTITIES.filter((e) => e.type === 'SPLINE');
    expect(splines).toHaveLength(2);
    for (const s of splines) {
      expect(first(s.pairs, 70)).toBe('8');
      expect(first(s.pairs, 71)).toBe('3');
      expect(Number(first(s.pairs, 72))).toBe(Number(first(s.pairs, 73)) + 4);
      const { knots, points } = splineOf(s);
      expect(knots).toHaveLength(Number(first(s.pairs, 72)));
      expect(points).toHaveLength(2 * Number(first(s.pairs, 73)));
      for (let i = 1; i < knots.length; i++) expect(knots[i]).toBeGreaterThanOrEqual(knots[i - 1]);
      expect(first(s.pairs, 42)).toBeUndefined();
      expect(first(s.pairs, 43)).toBeUndefined();
      expect(all(s.pairs, 230)).toEqual(['1.0']);
    }
    expect(all(splines[0].pairs, 1001)).toEqual(['CAMCALC']);
    expect(all(splines[0].pairs, 1000)).toEqual(['string-pitch']);
    expect(all(splines[1].pairs, 1001)).toEqual([]);
    const poly = /** @type {import('./dxf-reader.js').DxfItem} */ (ENTITIES.find((e) => e.type === 'LWPOLYLINE'));
    expect(Number(first(poly.pairs, 90))).toBe(all(poly.pairs, 10).length);
    expect(first(poly.pairs, 70)).toBe('1');
    expect(all(poly.pairs, 1000)).toEqual(['outline']);
  });

  it('writes CIRCLE, LINE and TEXT', () => {
    const circle = /** @type {import('./dxf-reader.js').DxfItem} */ (ENTITIES.find((e) => e.type === 'CIRCLE'));
    expect(first(circle.pairs, 40)).toBe('4.1');
    const line = /** @type {import('./dxf-reader.js').DxfItem} */ (ENTITIES.find((e) => e.type === 'LINE'));
    expect(all(line.pairs, 20)).toEqual(['0.0']);
    expect(all(line.pairs, 21)).toEqual(['0.0']);
    const texts = ENTITIES.filter((e) => e.type === 'TEXT');
    expect(first(texts[0].pairs, 1)).toBe('Cam \\U+00D8 12\\U+00B0 ^ x');
    expect(first(texts[0].pairs, 50)).toBe('90.0');
    expect(first(texts[1].pairs, 50)).toBeUndefined();
    expect(first(texts[1].pairs, 7)).toBe('Standard');
  });

  it('writes ASCII numbers without NaN, Infinity or exponents', () => {
    expect(/^[ -~\r\n]*$/.test(text)).toBe(true);
    expect(text).not.toMatch(/NaN|Infinity/);
    for (const [, value] of dxf.pairs) expect(value).not.toMatch(/\d[eE][+-]?\d/);
  });

  it('is deterministic', () => {
    expect(written()).toBe(text);
  });
});

describe('writeDxf edge cases', () => {
  it('writes an empty document with zero extents', () => {
    const dxf = readDxf(written({ layers: [], entities: [] }));
    expect(first(dxf.sections.HEADER.$EXTMIN, 10)).toBe('0.0');
    expect(first(dxf.sections.HEADER.$EXTMAX, 20)).toBe('0.0');
    expect(dxf.sections.ENTITIES).toEqual([]);
    expect(dxf.sections.TABLES.LAYER.records).toHaveLength(1);
  });

  it('accepts missing layer and entity lists and typed arrays', () => {
    expect(writeDxf(/** @type {any} */ ({})).error).toBeNull();
    const doc = {
      layers: [],
      entities: [{ type: 'lwpolyline', layer: '0', points: new Float64Array([0, 0, 1, 0, 0, 1]) }],
    };
    expect(writeDxf(/** @type {any} */ (doc)).error).toBeNull();
  });

  /** @type {[string, (doc: any) => void][]} */
  const bad = [
    ['NaN coordinate', (d) => { d.entities[3].x = NaN; }],
    ['Infinity coordinate', (d) => { d.entities[4].x2 = Infinity; }],
    ['NaN knot', (d) => { d.entities[1].knots[4] = NaN; }],
    ['huge number', (d) => { d.entities[3].x = 1e21; }],
    ['extents overflow', (d) => { d.entities[3].x = 1.7e308; d.entities[3].r = 1.7e308; }],
    ['NaN rotation', (d) => { d.entities[5].rotation = NaN; }],
    ['unknown type', (d) => { d.entities[0].type = 'arc'; }],
    ['undefined layer', (d) => { d.entities[0].layer = 'NOPE'; }],
    ['bad layer name', (d) => { d.layers[0].name = 'A/B'; }],
    ['non-ASCII layer name', (d) => { d.layers[0].name = 'Ä'; }],
    ['empty layer name', (d) => { d.layers[0].name = ''; }],
    ['duplicate layer', (d) => { d.layers[1].name = 'pitch'; }],
    ['layer 0 redefined', (d) => { d.layers[1].name = '0'; }],
    ['colour 0', (d) => { d.layers[0].color = 0; }],
    ['colour 256', (d) => { d.layers[0].color = 256; }],
    ['colour 1.5', (d) => { d.layers[0].color = 1.5; }],
    ['spline degree', (d) => { d.entities[1].degree = 2; }],
    ['spline knot count', (d) => { d.entities[1].knots.pop(); }],
    ['spline missing knots', (d) => { delete d.entities[1].knots; }],
    ['decreasing knots', (d) => { d.entities[1].knots = [0, 0, 0, 0.5, 0.4, 1, 1, 1]; }],
    ['odd spline coordinates', (d) => { d.entities[1].points.push(1); }],
    ['too few spline points', (d) => { d.entities[1].points = [0, 0, 1, 1, 2, 2]; }],
    ['too few polygon points', (d) => { d.entities[2].points = [0, 0, 1, 1]; }],
    ['missing polygon points', (d) => { delete d.entities[2].points; }],
    ['numeric id', (d) => { d.entities[2].id = 5; }],
    ['long id', (d) => { d.entities[2].id = 'x'.repeat(256); }],
    ['zero radius', (d) => { d.entities[3].r = 0; }],
    ['radius below 0.000001 mm', (d) => { d.entities[3].r = 1e-8; }],
    ['text height below 0.000001 mm', (d) => { d.entities[5].height = 1e-8; }],
    ['empty spline parameter range', (d) => { d.entities[1].knots = [0, 0, 0, 0, 0, 0, 0, 0]; }],
    ['layers not an array', (d) => { d.layers = 5; }],
    ['entities not an array', (d) => { d.entities = 'ab'; }],
    ['zero text height', (d) => { d.entities[5].height = 0; }],
    ['text not a string', (d) => { d.entities[5].text = 12; }],
    ['null entity', (d) => { d.entities[0] = null; }],
  ];
  for (const [name, spoil] of bad) {
    it(`returns an error for ${name}`, () => {
      const doc = sampleDoc();
      spoil(doc);
      const r = writeDxf(doc);
      expect(r.text).toBeNull();
      expect(typeof r.error).toBe('string');
    });
  }

  it('returns an error for a missing document and unreadable input', () => {
    expect(writeDxf(/** @type {any} */ (null)).error).toMatch(/document/);
    const hostile = new Proxy({}, { get() { throw new Error('unreadable'); } });
    expect(writeDxf(/** @type {any} */ (hostile))).toEqual({ text: null, error: 'unreadable' });
  });
});

describe('number and text formatting', () => {
  it('trims zeros, keeps one decimal and never writes -0', () => {
    expect(formatNumber(1)).toBe('1.0');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(-2.25)).toBe('-2.25');
    expect(formatNumber(1 / 3)).toBe('0.333333');
    expect(formatNumber(-0)).toBe('0.0');
    expect(formatNumber(-1e-9)).toBe('0.0');
    expect(formatNumber(1e-7)).toBe('0.0');
    expect(formatNumber(123456789.125)).toBe('123456789.125');
    expect(formatKnot(1 / 3)).toBe('0.333333333333');
    expect(formatKnot(-1e-13)).toBe('0.0');
  });

  it('rejects non-finite numbers and exponent notation', () => {
    expect(() => formatNumber(NaN)).toThrow();
    expect(() => formatNumber(Infinity)).toThrow();
    expect(() => formatNumber(1e21)).toThrow(/range/);
    expect(() => formatNumber(/** @type {any} */ ('1'))).toThrow();
  });

  it('encodes text as ASCII', () => {
    expect(encodeText('a\tb\nc\x7f')).toBe('a b c ');
    expect(encodeText('^')).toBe('^ ');
    expect(encodeText('µ')).toBe('\\U+00B5');
    expect(encodeText('😀')).toBe('?');
    expect(() => encodeText(/** @type {any} */ (null))).toThrow();
  });
});

describe('dxf-reader', () => {
  it('evaluates a Bezier segment by de Boor', () => {
    const s = { knots: [0, 0, 0, 0, 1, 1, 1, 1], points: [0, 0, 1, 2, 3, 2, 4, 0] };
    expect(evaluateSpline(s, 0)).toEqual({ x: 0, y: 0 });
    expect(evaluateSpline(s, 1)).toEqual({ x: 4, y: 0 });
    const mid = evaluateSpline(s, 0.5);
    // (P0 + 3 P1 + 3 P2 + P3) / 8
    expect(mid.x).toBeCloseTo((0 + 3 + 9 + 4) / 8, 14);
    expect(mid.y).toBeCloseTo((0 + 6 + 6 + 0) / 8, 14);
    expect(evaluateSpline(s, -1)).toEqual({ x: 0, y: 0 });
  });

  it('reproduces x = t, y = t² through a written and read spline', () => {
    // Control points from the blossoms of t and t²: Greville abscissae
    // (k1 + k2 + k3) / 3 and (k1·k2 + k1·k3 + k2·k3) / 3.
    const knots = [0, 0, 0, 0, 0.2, 0.5, 0.7, 1, 1, 1, 1];
    const points = [];
    for (let i = 0; i < knots.length - 4; i++) {
      const [a, b, c] = [knots[i + 1], knots[i + 2], knots[i + 3]];
      points.push((a + b + c) / 3, (a * b + a * c + b * c) / 3);
    }
    const text = written({ layers: [], entities: [{ type: 'spline', layer: '0', degree: 3, knots, points }] });
    const spline = splineOf(readDxf(text).sections.ENTITIES[0]);
    expect(spline.degree).toBe(3);
    expect(spline.knots).toEqual(knots);
    for (const t of [0, 0.1, 0.2, 0.35, 0.5, 0.69, 0.7, 0.9, 1]) {
      const p = evaluateSpline(spline, t);
      expect(p.x).toBeCloseTo(t, 6);
      expect(p.y).toBeCloseTo(t * t, 6);
    }
  });

  it('rejects malformed text', () => {
    expect(() => readPairs('  0\nEOF\n  1\n')).toThrow(/odd/);
    expect(() => readPairs('x\nEOF\n')).toThrow(/code/);
    expect(() => readPairs('  0\nSECTION\n')).toThrow(/EOF/);
    expect(() => readDxf('  2\nX\n  0\nEOF\n')).toThrow(/SECTION/);
  });
});
