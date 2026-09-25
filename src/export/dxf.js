/**
 * Minimal DXF R2000 (AC1015) writer. It writes the sections HEADER, CLASSES
 * (empty), TABLES, BLOCKS, ENTITIES and OBJECTS with handles, owner links
 * and the model and paper space layouts, so that CAD programs and ezdxf
 * load the file without repairs.
 *
 * Coordinates arrive in millimetres and the file declares millimetres
 * ($INSUNITS 4, $MEASUREMENT 1). The text is ASCII with CRLF line ends;
 * each group is the code right-aligned to width 3 on one line and the value
 * on the next. Numbers never use exponent notation, and the output depends
 * only on the input, so two writes of one document are identical.
 * @module export/dxf
 */

import { describeError } from '../core/errors.js';

/**
 * @typedef {object} DxfLayer
 * @property {string} name layer name: printable ASCII without < > / \ " : ; ? * | = ` ,
 * @property {number} color AutoCAD colour index 1 to 255
 */

/**
 * Clamped non-rational B-spline of degree 3 in the XY plane. A closed curve
 * repeats its first control point at the end; the writer sets no closed or
 * periodic flag.
 * @typedef {object} DxfSpline
 * @property {'spline'} type
 * @property {string} layer
 * @property {3} degree
 * @property {ArrayLike<number>} knots non-decreasing, control point count + 4 values
 * @property {ArrayLike<number>} points control points x, y interleaved (mm)
 * @property {string} [id] written as XDATA of the application CAMCALC
 */

/**
 * Closed polygon; the first vertex is not repeated at the end.
 * @typedef {object} DxfPolyline
 * @property {'lwpolyline'} type
 * @property {string} layer
 * @property {ArrayLike<number>} points vertices x, y interleaved (mm), at least 3
 * @property {string} [id] written as XDATA of the application CAMCALC
 */

/**
 * @typedef {object} DxfCircle
 * @property {'circle'} type
 * @property {string} layer
 * @property {number} x centre (mm)
 * @property {number} y centre (mm)
 * @property {number} r radius (mm), positive
 */

/**
 * @typedef {object} DxfLine
 * @property {'line'} type
 * @property {string} layer
 * @property {number} x1 start (mm)
 * @property {number} y1 start (mm)
 * @property {number} x2 end (mm)
 * @property {number} y2 end (mm)
 */

/**
 * Single-line text, left-aligned at its insertion point.
 * @typedef {object} DxfText
 * @property {'text'} type
 * @property {string} layer
 * @property {number} x insertion point (mm)
 * @property {number} y insertion point (mm)
 * @property {number} height text height (mm), positive
 * @property {string} text characters outside ASCII are written as \U+XXXX
 * @property {number} [rotation] counter-clockwise (degrees), 0 when absent
 */

/** @typedef {DxfSpline | DxfPolyline | DxfCircle | DxfLine | DxfText} DxfEntity */

/**
 * @typedef {object} DxfDocument
 * @property {DxfLayer[]} layers layers besides '0'
 * @property {DxfEntity[]} entities model space entities
 * @property {string[]} [title] not read by the writer; callers add TEXT entities
 */

/** Application name of the XDATA that carries entity ids. */
export const DXF_APP_ID = 'CAMCALC';

/** Characters that AutoCAD rejects in layer names. */
const LAYER_NAME_FORBIDDEN = /[<>/\\":;?*|=`,]/;

/** Printable ASCII. */
const PRINTABLE_ASCII = /^[ -~]+$/;

/**
 * Writes a DXF R2000 file. Never throws: malformed input, a non-finite or
 * out-of-range number or an unknown layer gives { text: null, error }.
 * @param {DxfDocument} doc
 * @returns {{ text: string | null, error: string | null }}
 */
export function writeDxf(doc) {
  try {
    return { text: writeDxfChecked(doc), error: null };
  } catch (err) {
    // Any exception while reading or validating malformed input.
    return { text: null, error: describeError(err) };
  }
}

/**
 * Formats a number with at most 6 decimals, trailing zeros trimmed but one
 * digit after the point kept; '-0' becomes '0.0'. Throws for a non-finite
 * number or one whose fixed notation needs an exponent.
 * @param {number} v
 * @returns {string}
 */
export function formatNumber(v) {
  return fixed(v, 6);
}

/**
 * Knot values keep 12 decimals, otherwise as {@link formatNumber}.
 * @param {number} v
 * @returns {string}
 */
export function formatKnot(v) {
  return fixed(v, 12);
}

/**
 * Spline control points keep 10 decimals: the Hermite pieces of a track are
 * about 0.01 mm long, and 6 decimals would bend them visibly in curvature.
 * @param {number} v
 * @returns {string}
 */
export function formatControl(v) {
  return fixed(v, 10);
}

/**
 * @param {number} v
 * @param {number} digits
 * @returns {string}
 */
function fixed(v, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`DXF: number expected, got ${String(v)}`);
  }
  let s = v.toFixed(digits);
  if (/e/i.test(s)) throw new Error(`DXF: number ${s} out of range`);
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  return s === '-0.0' ? '0.0' : s;
}

/**
 * Encodes a string value: ASCII kept, control characters as a space, '^' as
 * '^ ' (the DXF caret escape), other characters of the basic multilingual
 * plane as \U+XXXX and characters beyond it as '?'.
 * @param {string} text
 * @returns {string}
 */
export function encodeText(text) {
  if (typeof text !== 'string') throw new Error('DXF: string expected');
  let out = '';
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x20 || cp === 0x7f) out += ' ';
    else if (ch === '^') out += '^ ';
    else if (cp < 0x7f) out += ch;
    else if (cp <= 0xffff) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}

/**
 * Collects group code/value pairs as text.
 */
class Emitter {
  constructor() {
    /** @type {string[]} */
    this.lines = [];
  }

  /**
   * @param {number} code
   * @param {string} value already formatted
   */
  raw(code, value) {
    this.lines.push(String(code).padStart(3, ' '), value);
  }

  /**
   * @param {number} code
   * @param {number} v
   */
  num(code, v) {
    this.raw(code, formatNumber(v));
  }

  /**
   * @param {number} code
   * @param {number} v
   */
  int(code, v) {
    if (!Number.isInteger(v)) throw new Error(`DXF: integer expected for group ${code}, got ${String(v)}`);
    this.raw(code, String(v));
  }

  /**
   * @param {number} code
   * @param {string} s
   */
  str(code, s) {
    this.raw(code, encodeText(s));
  }

  /**
   * Point with groups code, code + 10 and, when z is given, code + 20.
   * @param {number} code
   * @param {number} x
   * @param {number} y
   * @param {number} [z]
   */
  point(code, x, y, z) {
    this.num(code, x);
    this.num(code + 10, y);
    if (z !== undefined) this.num(code + 20, z);
  }

  /** @param {Emitter} other */
  append(other) {
    for (const line of other.lines) this.lines.push(line);
  }
}

/** Handle allocator: one counter per document, upper-case hex from 1. */
class Handles {
  constructor() {
    this.next = 1;
  }

  /** @returns {string} */
  take() {
    return (this.next++).toString(16).toUpperCase();
  }
}

/**
 * Checks a layer name.
 * @param {unknown} name
 * @returns {string}
 */
function layerName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255 || !PRINTABLE_ASCII.test(name) || LAYER_NAME_FORBIDDEN.test(name)) {
    throw new Error(`DXF: invalid layer name ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * Interleaved coordinates as a finite number array with at least `min`
 * points.
 * @param {ArrayLike<number>} values
 * @param {number} min
 * @param {string} what
 * @returns {number[]}
 */
function coordinates(values, min, what) {
  const n = values?.length;
  if (typeof n !== 'number' || n % 2 !== 0 || n < 2 * min) {
    throw new Error(`DXF: ${what} needs an even number of coordinates for at least ${min} points`);
  }
  const out = Array.from(values);
  for (const v of out) formatNumber(v);
  return out;
}

/**
 * Body of {@link writeDxf}, which guards it.
 * @param {DxfDocument} doc
 * @returns {string}
 */
function writeDxfChecked(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('DXF: document expected');
  const layerList = doc.layers ?? [];
  const entityList = doc.entities ?? [];
  if (!Array.isArray(layerList) || !Array.isArray(entityList)) {
    throw new Error('DXF: layers and entities must be arrays');
  }
  const layers = Array.from(layerList, (l) => {
    const color = l.color;
    if (!Number.isInteger(color) || color < 1 || color > 255) {
      throw new Error(`DXF: layer colour must be an integer 1 to 255, got ${String(color)}`);
    }
    return { name: layerName(l.name), color };
  });
  const names = new Set(['0']);
  for (const l of layers) {
    const key = l.name.toUpperCase();
    if (names.has(key)) throw new Error(`DXF: duplicate layer ${l.name}`);
    names.add(key);
  }
  const entities = Array.from(entityList);

  const h = new Handles();
  // Structural handles, allocated in a fixed order.
  const H = {
    vportTable: h.take(), vport: h.take(),
    ltypeTable: h.take(), ltypeByBlock: h.take(), ltypeByLayer: h.take(), ltypeContinuous: h.take(),
    layerTable: h.take(), layer0: h.take(),
    styleTable: h.take(), style: h.take(),
    viewTable: h.take(), ucsTable: h.take(),
    appidTable: h.take(), appidAcad: h.take(), appidApp: h.take(),
    dimstyleTable: h.take(), dimstyle: h.take(),
    blockRecordTable: h.take(), modelRecord: h.take(), paperRecord: h.take(),
    modelBlock: h.take(), modelEnd: h.take(), paperBlock: h.take(), paperEnd: h.take(),
    rootDict: h.take(), groupDict: h.take(), layoutDict: h.take(), modelLayout: h.take(), paperLayout: h.take(),
  };
  const layerHandles = layers.map(() => h.take());

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  /**
   * @param {number} x
   * @param {number} y
   */
  const extend = (x, y) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  };

  const ents = new Emitter();
  for (const e of entities) writeEntity(ents, e, h.take(), H.modelRecord, names, extend);

  const empty = entities.length === 0;
  const ext = empty
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : bounds;
  // Extents are checked here so that a huge coordinate cannot pass as Infinity.
  for (const v of [ext.minX, ext.minY, ext.maxX, ext.maxY]) formatNumber(v);

  const out = new Emitter();
  // HEADER
  out.raw(0, 'SECTION');
  out.raw(2, 'HEADER');
  out.raw(9, '$ACADVER');
  out.raw(1, 'AC1015');
  out.raw(9, '$DWGCODEPAGE');
  out.raw(3, 'ANSI_1252');
  out.raw(9, '$INSBASE');
  out.point(10, 0, 0, 0);
  out.raw(9, '$EXTMIN');
  out.point(10, ext.minX, ext.minY, 0);
  out.raw(9, '$EXTMAX');
  out.point(10, ext.maxX, ext.maxY, 0);
  out.raw(9, '$INSUNITS');
  out.int(70, 4);
  out.raw(9, '$MEASUREMENT');
  out.int(70, 1);
  out.raw(9, '$HANDSEED');
  out.raw(5, h.take());
  out.raw(0, 'ENDSEC');
  // CLASSES
  out.raw(0, 'SECTION');
  out.raw(2, 'CLASSES');
  out.raw(0, 'ENDSEC');
  // TABLES
  out.raw(0, 'SECTION');
  out.raw(2, 'TABLES');
  writeTables(out, H, layers, layerHandles, ext);
  out.raw(0, 'ENDSEC');
  // BLOCKS
  out.raw(0, 'SECTION');
  out.raw(2, 'BLOCKS');
  writeBlock(out, '*Model_Space', H.modelBlock, H.modelEnd, H.modelRecord);
  writeBlock(out, '*Paper_Space', H.paperBlock, H.paperEnd, H.paperRecord);
  out.raw(0, 'ENDSEC');
  // ENTITIES
  out.raw(0, 'SECTION');
  out.raw(2, 'ENTITIES');
  out.append(ents);
  out.raw(0, 'ENDSEC');
  // OBJECTS
  out.raw(0, 'SECTION');
  out.raw(2, 'OBJECTS');
  writeObjects(out, H, ext);
  out.raw(0, 'ENDSEC');
  out.raw(0, 'EOF');
  return out.lines.join('\r\n') + '\r\n';
}

/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Extents
 */

/**
 * @param {Emitter} out
 * @param {string} name
 * @param {string} handle
 * @param {number} count
 */
function tableHead(out, name, handle, count) {
  out.raw(0, 'TABLE');
  out.raw(2, name);
  out.raw(5, handle);
  out.raw(330, '0');
  out.raw(100, 'AcDbSymbolTable');
  out.int(70, count);
}

/**
 * @param {Emitter} out
 * @param {string} type
 * @param {string} handle
 * @param {string} owner
 * @param {string} subclass
 * @param {number} [handleCode] 105 for DIMSTYLE, otherwise 5
 */
function recordHead(out, type, handle, owner, subclass, handleCode = 5) {
  out.raw(0, type);
  out.raw(handleCode, handle);
  out.raw(330, owner);
  out.raw(100, 'AcDbSymbolTableRecord');
  out.raw(100, subclass);
}

/** Dimension style values of the metric 'Standard' style, as ezdxf writes them. */
const DIMSTYLE_VALUES = /** @type {const} */ ([
  [40, 1], [41, 2.5], [42, 0.625], [43, 3.75], [44, 1.25], [45, 0], [46, 0], [47, 0], [48, 0],
  [140, 2.5], [141, 2.5], [142, 0], [143, 0.03937], [144, 1], [145, 0], [146, 1], [147, 0.625], [148, 0],
]);
const DIMSTYLE_FLAGS = /** @type {const} */ ([
  [71, 0], [72, 0], [73, 0], [74, 0], [75, 0], [76, 0], [77, 1], [78, 8], [79, 3],
  [170, 0], [171, 3], [172, 1], [173, 0], [174, 0], [175, 0], [176, 0], [177, 0], [178, 0], [179, 2],
  [271, 2], [272, 2], [273, 2], [274, 3], [275, 0], [276, 0], [277, 2], [278, 44], [279, 0],
  [280, 0], [281, 0], [282, 0], [283, 0], [284, 8], [285, 0], [286, 0], [288, 0], [289, 3],
]);

/**
 * @param {Emitter} out
 * @param {Record<string, string>} H
 * @param {DxfLayer[]} layers
 * @param {string[]} layerHandles
 * @param {Extents} ext
 */
function writeTables(out, H, layers, layerHandles, ext) {
  // VPORT *Active, centred on the extents with a 10 % margin.
  tableHead(out, 'VPORT', H.vportTable, 1);
  recordHead(out, 'VPORT', H.vport, H.vportTable, 'AcDbViewportTableRecord');
  const aspect = 1.34;
  const width = ext.maxX - ext.minX;
  const height = ext.maxY - ext.minY;
  const viewHeight = Math.max(height, width / aspect) * 1.1 || 100;
  out.raw(2, '*Active');
  out.int(70, 0);
  out.point(10, 0, 0);
  out.point(11, 1, 1);
  out.point(12, (ext.minX + ext.maxX) / 2, (ext.minY + ext.maxY) / 2);
  out.point(13, 0, 0);
  out.point(14, 10, 10);
  out.point(15, 10, 10);
  out.point(16, 0, 0, 1);
  out.point(17, 0, 0, 0);
  out.num(40, viewHeight);
  out.num(41, aspect);
  out.num(42, 50);
  out.num(43, 0);
  out.num(44, 0);
  out.num(50, 0);
  out.num(51, 0);
  out.int(71, 0);
  out.int(72, 1000);
  out.int(73, 1);
  out.int(74, 3);
  out.int(75, 0);
  out.int(76, 0);
  out.int(77, 0);
  out.int(78, 0);
  out.int(281, 0);
  out.int(65, 0);
  out.raw(0, 'ENDTAB');

  tableHead(out, 'LTYPE', H.ltypeTable, 3);
  for (const [name, handle] of [['ByBlock', H.ltypeByBlock], ['ByLayer', H.ltypeByLayer], ['Continuous', H.ltypeContinuous]]) {
    recordHead(out, 'LTYPE', handle, H.ltypeTable, 'AcDbLinetypeTableRecord');
    out.raw(2, name);
    out.int(70, 0);
    out.raw(3, name === 'Continuous' ? 'Solid line' : '');
    out.int(72, 65);
    out.int(73, 0);
    out.num(40, 0);
  }
  out.raw(0, 'ENDTAB');

  tableHead(out, 'LAYER', H.layerTable, layers.length + 1);
  const allLayers = [{ name: '0', color: 7 }, ...layers];
  const allHandles = [H.layer0, ...layerHandles];
  allLayers.forEach((layer, i) => {
    recordHead(out, 'LAYER', allHandles[i], H.layerTable, 'AcDbLayerTableRecord');
    out.raw(2, layer.name);
    out.int(70, 0);
    out.int(62, layer.color);
    out.raw(6, 'Continuous');
    out.int(370, -3);
  });
  out.raw(0, 'ENDTAB');

  tableHead(out, 'STYLE', H.styleTable, 1);
  recordHead(out, 'STYLE', H.style, H.styleTable, 'AcDbTextStyleTableRecord');
  out.raw(2, 'Standard');
  out.int(70, 0);
  out.num(40, 0);
  out.num(41, 1);
  out.num(50, 0);
  out.int(71, 0);
  out.num(42, 2.5);
  out.raw(3, 'txt');
  out.raw(4, '');
  out.raw(0, 'ENDTAB');

  tableHead(out, 'VIEW', H.viewTable, 0);
  out.raw(0, 'ENDTAB');
  tableHead(out, 'UCS', H.ucsTable, 0);
  out.raw(0, 'ENDTAB');

  tableHead(out, 'APPID', H.appidTable, 2);
  for (const [name, handle] of [['ACAD', H.appidAcad], [DXF_APP_ID, H.appidApp]]) {
    recordHead(out, 'APPID', handle, H.appidTable, 'AcDbRegAppTableRecord');
    out.raw(2, name);
    out.int(70, 0);
  }
  out.raw(0, 'ENDTAB');

  tableHead(out, 'DIMSTYLE', H.dimstyleTable, 1);
  out.raw(100, 'AcDbDimStyleTable');
  recordHead(out, 'DIMSTYLE', H.dimstyle, H.dimstyleTable, 'AcDbDimStyleTableRecord', 105);
  out.raw(2, 'Standard');
  out.int(70, 0);
  out.raw(3, '');
  out.raw(4, '');
  for (const [code, v] of DIMSTYLE_VALUES) out.num(code, v);
  for (const [code, v] of DIMSTYLE_FLAGS) out.int(code, v);
  out.int(371, -2);
  out.int(372, -2);
  out.raw(0, 'ENDTAB');

  tableHead(out, 'BLOCK_RECORD', H.blockRecordTable, 2);
  recordHead(out, 'BLOCK_RECORD', H.modelRecord, H.blockRecordTable, 'AcDbBlockTableRecord');
  out.raw(2, '*Model_Space');
  out.raw(340, H.modelLayout);
  recordHead(out, 'BLOCK_RECORD', H.paperRecord, H.blockRecordTable, 'AcDbBlockTableRecord');
  out.raw(2, '*Paper_Space');
  out.raw(340, H.paperLayout);
  out.raw(0, 'ENDTAB');
}

/**
 * @param {Emitter} out
 * @param {string} name
 * @param {string} handle
 * @param {string} endHandle
 * @param {string} owner block record handle
 */
function writeBlock(out, name, handle, endHandle, owner) {
  out.raw(0, 'BLOCK');
  out.raw(5, handle);
  out.raw(330, owner);
  out.raw(100, 'AcDbEntity');
  out.raw(8, '0');
  out.raw(100, 'AcDbBlockBegin');
  out.raw(2, name);
  out.int(70, 0);
  out.point(10, 0, 0, 0);
  out.raw(3, name);
  out.raw(1, '');
  out.raw(0, 'ENDBLK');
  out.raw(5, endHandle);
  out.raw(330, owner);
  out.raw(100, 'AcDbEntity');
  out.raw(8, '0');
  out.raw(100, 'AcDbBlockEnd');
}

/**
 * @param {Emitter} out
 * @param {string} handle
 * @param {string} owner
 * @param {[string, string][]} entries name and handle
 */
function writeDictionary(out, handle, owner, entries) {
  out.raw(0, 'DICTIONARY');
  out.raw(5, handle);
  out.raw(330, owner);
  out.raw(100, 'AcDbDictionary');
  out.int(281, 1);
  for (const [name, target] of entries) {
    out.raw(3, name);
    out.raw(350, target);
  }
}

/**
 * @param {Emitter} out
 * @param {Record<string, string>} H
 * @param {Extents} ext
 */
function writeObjects(out, H, ext) {
  writeDictionary(out, H.rootDict, '0', [['ACAD_GROUP', H.groupDict], ['ACAD_LAYOUT', H.layoutDict]]);
  writeDictionary(out, H.groupDict, H.rootDict, []);
  writeDictionary(out, H.layoutDict, H.rootDict, [['Model', H.modelLayout], ['Layout1', H.paperLayout]]);
  writeLayout(out, H.modelLayout, H.layoutDict, 'Model', 0, H.modelRecord, ext);
  writeLayout(out, H.paperLayout, H.layoutDict, 'Layout1', 1, H.paperRecord, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
}

/**
 * LAYOUT object with the plot settings of an A3 sheet in millimetres.
 * @param {Emitter} out
 * @param {string} handle
 * @param {string} owner layout dictionary
 * @param {string} name
 * @param {number} tab tab order, 0 for the model layout
 * @param {string} blockRecord
 * @param {Extents} ext
 */
function writeLayout(out, handle, owner, name, tab, blockRecord, ext) {
  out.raw(0, 'LAYOUT');
  out.raw(5, handle);
  out.raw(330, owner);
  out.raw(100, 'AcDbPlotSettings');
  out.raw(1, '');
  out.raw(4, 'A3');
  out.raw(6, '');
  for (const [code, v] of [[40, 7.5], [41, 20], [42, 7.5], [43, 20], [44, 420], [45, 297],
    [46, 0], [47, 0], [48, 0], [49, 0], [140, 0], [141, 0], [142, 1], [143, 1]]) {
    out.num(code, v);
  }
  out.int(70, tab === 0 ? 1024 : 0);
  out.int(72, 1);
  out.int(73, 0);
  out.int(74, 5);
  out.raw(7, '');
  out.int(75, 16);
  out.int(76, 0);
  out.int(77, 2);
  out.int(78, 300);
  out.num(147, 1);
  out.num(148, 0);
  out.num(149, 0);
  out.raw(100, 'AcDbLayout');
  out.raw(1, name);
  out.int(70, 1);
  out.int(71, tab);
  out.point(10, 0, 0);
  out.point(11, 420, 297);
  out.point(12, 0, 0, 0);
  out.point(14, ext.minX, ext.minY, 0);
  out.point(15, ext.maxX, ext.maxY, 0);
  out.num(146, 0);
  out.point(13, 0, 0, 0);
  out.point(16, 1, 0, 0);
  out.point(17, 0, 1, 0);
  out.int(76, 1);
  out.raw(330, blockRecord);
}

/**
 * @param {Emitter} out
 * @param {unknown} id
 */
function writeXdata(out, id) {
  if (id === undefined || id === null) return;
  if (typeof id !== 'string') throw new Error('DXF: entity id must be a string');
  const value = encodeText(id);
  if (value.length > 255) throw new Error('DXF: entity id longer than 255 characters');
  out.raw(1001, DXF_APP_ID);
  out.raw(1000, value);
}

/**
 * @param {Emitter} out
 * @param {DxfEntity} e
 * @param {string} handle
 * @param {string} owner model space block record
 * @param {Set<string>} layers upper-case names of the defined layers
 * @param {(x: number, y: number) => void} extend
 */
function writeEntity(out, e, handle, owner, layers, extend) {
  const type = e?.type;
  const dxfType = { spline: 'SPLINE', lwpolyline: 'LWPOLYLINE', circle: 'CIRCLE', line: 'LINE', text: 'TEXT' }[String(type)];
  if (!dxfType) throw new Error(`DXF: unknown entity type ${String(type)}`);
  const layer = layerName(e.layer);
  if (!layers.has(layer.toUpperCase())) throw new Error(`DXF: layer ${layer} is not defined`);
  out.raw(0, dxfType);
  out.raw(5, handle);
  out.raw(330, owner);
  out.raw(100, 'AcDbEntity');
  out.raw(8, layer);
  switch (e.type) {
    case 'spline': {
      if (e.degree !== 3) throw new Error(`DXF: spline degree must be 3, got ${String(e.degree)}`);
      const pts = coordinates(e.points, 4, 'spline');
      const count = pts.length / 2;
      const knots = Array.from(e.knots ?? []);
      if (knots.length !== count + 4) {
        throw new Error(`DXF: spline with ${count} control points needs ${count + 4} knots, got ${knots.length}`);
      }
      for (let i = 0; i < knots.length; i++) {
        formatKnot(knots[i]);
        if (i > 0 && knots[i] < knots[i - 1]) throw new Error('DXF: spline knots must not decrease');
      }
      if (!(knots[count] > knots[3])) throw new Error('DXF: spline parameter range is empty');
      out.raw(100, 'AcDbSpline');
      out.point(210, 0, 0, 1);
      out.int(70, 8);
      out.int(71, 3);
      out.int(72, knots.length);
      out.int(73, count);
      out.int(74, 0);
      for (const k of knots) out.raw(40, formatKnot(k));
      for (let i = 0; i < pts.length; i += 2) {
        out.raw(10, formatControl(pts[i]));
        out.raw(20, formatControl(pts[i + 1]));
        out.num(30, 0);
        extend(pts[i], pts[i + 1]);
      }
      writeXdata(out, e.id);
      break;
    }
    case 'lwpolyline': {
      const pts = coordinates(e.points, 3, 'polyline');
      out.raw(100, 'AcDbPolyline');
      out.int(90, pts.length / 2);
      out.int(70, 1);
      out.num(43, 0);
      for (let i = 0; i < pts.length; i += 2) {
        out.point(10, pts[i], pts[i + 1]);
        extend(pts[i], pts[i + 1]);
      }
      writeXdata(out, e.id);
      break;
    }
    case 'circle': {
      if (!(e.r > 0) || formatNumber(e.r) === '0.0') throw new Error(`DXF: circle radius must be positive, got ${String(e.r)}`);
      out.raw(100, 'AcDbCircle');
      out.point(10, e.x, e.y, 0);
      out.num(40, e.r);
      extend(e.x - e.r, e.y - e.r);
      extend(e.x + e.r, e.y + e.r);
      break;
    }
    case 'line': {
      out.raw(100, 'AcDbLine');
      out.point(10, e.x1, e.y1, 0);
      out.point(11, e.x2, e.y2, 0);
      extend(e.x1, e.y1);
      extend(e.x2, e.y2);
      break;
    }
    default: {
      const t = /** @type {DxfText} */ (e);
      if (!(t.height > 0) || formatNumber(t.height) === '0.0') throw new Error(`DXF: text height must be positive, got ${String(t.height)}`);
      const rotation = t.rotation ?? 0;
      out.raw(100, 'AcDbText');
      out.point(10, t.x, t.y, 0);
      out.num(40, t.height);
      out.str(1, t.text);
      if (formatNumber(rotation) !== '0.0') out.num(50, rotation);
      out.raw(7, 'Standard');
      out.raw(100, 'AcDbText');
      extend(t.x, t.y);
      break;
    }
  }
}
