/**
 * CSV table of the solved draw cycle: one row per solved sample of the
 * forward model, from brace to the last solved position, in display units.
 *
 * Format: comma separator, decimal point, CRLF line ends, an ASCII header
 * line and no byte order mark. Numbers have a fixed count of decimals per
 * unit and never use exponent notation; negative zero is written as zero.
 * A non-finite value, or one too large for fixed notation, leaves its cell
 * empty.
 * @module export/csv
 */

import { describeError } from '../core/errors.js';
import { AMO_OFFSET, UNITS } from '../core/units.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../state/schema.js').Units} Units */

/**
 * Column keys in output order.
 * @typedef {'drawLength' | 'nockToPivot' | 'targetForce' | 'drawForce' | 'camRotation' | 'limbRotation'
 *   | 'stringTension' | 'cableTension' | 'limbTipLoad'} CsvColumn
 */

/**
 * Header labels without the unit; the writer appends ' (<unit>)'.
 * @type {Readonly<Record<CsvColumn, string>>}
 */
export const CSV_LABELS = Object.freeze({
  drawLength: 'Draw length AMO',
  nockToPivot: 'Nock to pivot point',
  targetForce: 'Target force',
  drawForce: 'Draw force',
  camRotation: 'Cam rotation from brace',
  limbRotation: 'Limb rotation',
  stringTension: 'String tension',
  cableTension: 'Tension of each cable',
  limbTipLoad: 'Load on each limb tip',
});

/** Decimals per display unit. */
const DECIMALS = Object.freeze({ in: 5, mm: 3, cm: 4, N: 4, lbf: 4, deg: 5 });

/** Printable ASCII. */
const PRINTABLE_ASCII = /^[ -~]*$/;

/** Degrees per radian. */
const DEG = 180 / Math.PI;

/**
 * Writes the CSV table. Never throws: malformed input or an unknown unit
 * gives { text: null, error }.
 * @param {SolveResult} result solved cam; rows come from result.achieved
 * @param {LayoutContext} layout layout of the same result (createLayout);
 *   rows 0 to layout.valid − 1, limb tip load from layout.loads.axleLoad
 * @param {Units} units display units; draw and force are read
 * @param {Partial<Record<CsvColumn, string>>} [labels] header labels that
 *   replace entries of {@link CSV_LABELS}, printable ASCII
 * @returns {{ text: string | null, error: string | null }}
 */
export function writeCsv(result, layout, units, labels) {
  try {
    return { text: writeCsvChecked(result, layout, units, labels), error: null };
  } catch (err) {
    // Any exception while reading or validating malformed input.
    return { text: null, error: describeError(err) };
  }
}

/**
 * Fixed-point text of a value, '' for a non-finite value or one whose fixed
 * notation needs an exponent; negative zero loses its sign.
 * @param {number} v
 * @param {number} digits
 * @returns {string}
 */
export function formatFixed(v, digits) {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(digits);
  if (/e/i.test(s)) return '';
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/**
 * A header cell, quoted when it holds a comma or a double quote.
 * @param {string} text
 * @returns {string}
 */
function headerCell(text) {
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Checks that a sample array covers the rows.
 * @param {unknown} arr
 * @param {number} rows
 * @param {string} what
 * @returns {ArrayLike<number>}
 */
function samples(arr, rows, what) {
  if (!ArrayBuffer.isView(arr) && !Array.isArray(arr)) throw new Error(`CSV: the ${what} samples are missing`);
  const a = /** @type {ArrayLike<number>} */ (/** @type {unknown} */ (arr));
  if (a.length < rows) throw new Error(`CSV: the ${what} samples are fewer than the ${rows} solved rows`);
  return a;
}

/**
 * Body of {@link writeCsv}, which guards it.
 * @param {SolveResult} result
 * @param {LayoutContext} layout
 * @param {Units} units
 * @param {Partial<Record<CsvColumn, string>> | undefined} labels
 * @returns {string}
 */
function writeCsvChecked(result, layout, units, labels) {
  const drawUnit = units?.draw;
  const forceUnit = units?.force;
  if (drawUnit !== 'in' && drawUnit !== 'mm' && drawUnit !== 'cm') throw new Error(`CSV: unknown draw length unit ${String(drawUnit)}`);
  if (forceUnit !== 'N' && forceUnit !== 'lbf') throw new Error(`CSV: unknown force unit ${String(forceUnit)}`);
  const a = result?.achieved;
  if (!a) throw new Error('CSV: the result has no forward-model samples');
  const rows = layout?.valid;
  if (!Number.isInteger(rows) || rows < 1) throw new Error('CSV: the layout has no solved rows');
  const x = samples(a.x, rows, 'draw position');
  const F = samples(a.F, rows, 'draw force');
  const theta = samples(a.theta, rows, 'cam rotation');
  const alpha = samples(a.alpha, rows, 'limb rotation');
  const Ts = samples(a.Ts, rows, 'string tension');
  const Tc = samples(a.Tc, rows, 'cable tension');
  const axleLoad = samples(layout.loads?.axleLoad, rows, 'limb tip load');
  const tF = result.target?.F;
  const target = tF && tF.length === x.length ? tF : null;

  /** @type {Record<CsvColumn, string>} */
  const names = { ...CSV_LABELS };
  if (labels !== undefined) {
    if (labels === null || typeof labels !== 'object') throw new Error('CSV: the labels must be an object');
    for (const key of Object.keys(labels)) {
      if (!Object.hasOwn(CSV_LABELS, key)) throw new Error(`CSV: unknown column ${key}`);
      const text = labels[/** @type {CsvColumn} */ (key)];
      if (typeof text !== 'string' || !PRINTABLE_ASCII.test(text)) throw new Error(`CSV: the label of ${key} must be printable ASCII`);
      names[/** @type {CsvColumn} */ (key)] = text;
    }
  }
  const columnUnits = /** @type {Record<CsvColumn, string>} */ ({
    drawLength: drawUnit, nockToPivot: drawUnit, targetForce: forceUnit, drawForce: forceUnit,
    camRotation: 'deg', limbRotation: 'deg', stringTension: forceUnit, cableTension: forceUnit, limbTipLoad: forceUnit,
  });
  const header = /** @type {CsvColumn[]} */ (Object.keys(CSV_LABELS))
    .map((key) => headerCell(`${names[key]} (${columnUnits[key]})`))
    .join(',');

  const len = UNITS.length[drawUnit];
  const force = UNITS.force[forceUnit];
  const dl = DECIMALS[drawUnit];
  const df = DECIMALS[forceUnit];
  const lines = [header];
  const theta0 = theta[0];
  for (let i = 0; i < rows; i++) {
    lines.push([
      formatFixed((x[i] + AMO_OFFSET) / len, dl),
      formatFixed(x[i] / len, dl),
      target ? formatFixed(target[i] / force, df) : '',
      formatFixed(F[i] / force, df),
      formatFixed((theta[i] - theta0) * DEG, DECIMALS.deg),
      formatFixed(alpha[i] * DEG, DECIMALS.deg),
      formatFixed(Ts[i] / force, df),
      formatFixed(Tc[i] / force, df),
      formatFixed(axleLoad[i] / force, df),
    ].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Header labels of the timing table, in output order, with their quantity. */
export const TIMING_CSV_COLUMNS = Object.freeze(/** @type {const} */ ([
  ['Draw length AMO', 'draw'],
  ['Nock to pivot point', 'draw'],
  ['Nock height', 'draw'],
  ['Draw force', 'force'],
  ['Top cam rotation from design brace', 'deg'],
  ['Bottom cam rotation from design brace', 'deg'],
  ['Cam timing top minus bottom', 'deg'],
  ['Tension of the top string part', 'force'],
  ['Tension of the bottom string part', 'force'],
  ['Tension of the top cable', 'force'],
  ['Tension of the bottom cable', 'force'],
]));

/**
 * Writes the timing table of an analysis of changed cords: one row per
 * sample from the brace of the changed bow to the end of its draw (the
 * first stop, or full draw), in display units, in the format of
 * {@link writeCsv}. Never throws.
 * @param {import('../core/analysis.js').AnalysisResult} analysis
 * @param {Units} units display units; draw and force are read
 * @returns {{ text: string | null, error: string | null }}
 */
export function writeTimingCsv(analysis, units) {
  try {
    const drawUnit = units?.draw;
    const forceUnit = units?.force;
    if (drawUnit !== 'in' && drawUnit !== 'mm' && drawUnit !== 'cm') throw new Error(`CSV: unknown draw length unit ${String(drawUnit)}`);
    if (forceUnit !== 'N' && forceUnit !== 'lbf') throw new Error(`CSV: unknown force unit ${String(forceUnit)}`);
    const a = analysis;
    const rows = a?.end + 1;
    if (!Number.isInteger(rows) || rows < 1) throw new Error('CSV: the analysis has no draw');
    const len = UNITS.length[drawUnit];
    const force = UNITS.force[forceUnit];
    const dl = DECIMALS[drawUnit];
    const df = DECIMALS[forceUnit];
    const unitOf = { draw: drawUnit, force: forceUnit, deg: 'deg' };
    const header = TIMING_CSV_COLUMNS.map(([label, q]) => headerCell(`${label} (${unitOf[q]})`)).join(',');
    const columns = [
      samples(a.x, rows, 'draw position'), samples(a.y, rows, 'nock height'), samples(a.F, rows, 'draw force'),
      samples(a.thetaTop, rows, 'top cam rotation'), samples(a.thetaBottom, rows, 'bottom cam rotation'),
      samples(a.stringTop, rows, 'top string tension'), samples(a.stringBottom, rows, 'bottom string tension'),
      samples(a.cableTop, rows, 'top cable tension'), samples(a.cableBottom, rows, 'bottom cable tension'),
    ];
    const [x, y, F, tt, tb, st, sb, ct, cb] = columns;
    const lines = [header];
    for (let i = 0; i < rows; i++) {
      lines.push([
        formatFixed((x[i] + AMO_OFFSET) / len, dl),
        formatFixed(x[i] / len, dl),
        formatFixed(y[i] / len, dl),
        formatFixed(F[i] / force, df),
        formatFixed(tt[i] * DEG, DECIMALS.deg),
        formatFixed(tb[i] * DEG, DECIMALS.deg),
        formatFixed((tt[i] - tb[i]) * DEG, DECIMALS.deg),
        formatFixed(st[i] / force, df),
        formatFixed(sb[i] / force, df),
        formatFixed(ct[i] / force, df),
        formatFixed(cb[i] / force, df),
      ].join(','));
    }
    return { text: `${lines.join('\r\n')}\r\n`, error: null };
  } catch (err) {
    // Any exception while reading or validating malformed input.
    return { text: null, error: describeError(err) };
  }
}
