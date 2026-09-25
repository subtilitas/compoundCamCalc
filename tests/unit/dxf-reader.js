/**
 * Small DXF reader for the tests: splits a DXF text into group code/value
 * pairs, groups them by section and entity, and evaluates SPLINE entities
 * with de Boor's algorithm. Independent of the writer.
 */

/** @typedef {[number, string]} Pair group code and raw value */

/**
 * @typedef {object} DxfItem
 * @property {string} type value of the group 0 that starts the item
 * @property {Pair[]} pairs the pairs after the group 0
 */

/**
 * @typedef {object} DxfTable
 * @property {Pair[]} head pairs of the TABLE item
 * @property {DxfItem[]} records
 */

/**
 * @typedef {object} DxfRead
 * @property {Pair[]} pairs every pair of the file
 * @property {string[]} order section names in file order
 * @property {{ HEADER: Record<string, Pair[]>, TABLES: Record<string, DxfTable>, BLOCKS: DxfItem[], ENTITIES: DxfItem[], OBJECTS: DxfItem[], CLASSES: DxfItem[] }} sections
 */

/**
 * Splits a DXF text (CRLF or LF) into pairs. Throws on a malformed code
 * line or a missing EOF.
 * @param {string} text
 * @returns {Pair[]}
 */
export function readPairs(text) {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2 !== 0) throw new Error('odd number of lines');
  /** @type {Pair[]} */
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`bad group code ${lines[i]}`);
    pairs.push([code, lines[i + 1]]);
  }
  const last = pairs[pairs.length - 1];
  if (!last || last[0] !== 0 || last[1] !== 'EOF') throw new Error('missing EOF');
  return pairs;
}

/**
 * Groups pairs into items, each started by a group 0.
 * @param {Pair[]} pairs
 * @returns {DxfItem[]}
 */
function items(pairs) {
  /** @type {DxfItem[]} */
  const out = [];
  for (const [code, value] of pairs) {
    if (code === 0) out.push({ type: value, pairs: [] });
    else if (out.length) out[out.length - 1].pairs.push([code, value]);
  }
  return out;
}

/**
 * Parses a DXF text into sections.
 * @param {string} text
 * @returns {DxfRead}
 */
export function readDxf(text) {
  const pairs = readPairs(text);
  /** @type {string[]} */
  const order = [];
  /** @type {DxfRead['sections']} */
  const sections = { HEADER: {}, TABLES: {}, BLOCKS: [], ENTITIES: [], OBJECTS: [], CLASSES: [] };
  let i = 0;
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'EOF') break;
    if (code !== 0 || value !== 'SECTION') throw new Error(`SECTION expected at pair ${i}`);
    const name = pairs[i + 1][1];
    order.push(name);
    let j = i + 2;
    while (!(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++;
    const body = pairs.slice(i + 2, j);
    if (name === 'HEADER') {
      /** @type {string} */
      let current = '';
      for (const [c, v] of body) {
        if (c === 9) {
          current = v;
          sections.HEADER[current] = [];
        } else sections.HEADER[current].push([c, v]);
      }
    } else if (name === 'TABLES') {
      /** @type {DxfTable | null} */
      let table = null;
      for (const item of items(body)) {
        if (item.type === 'TABLE') {
          table = { head: item.pairs, records: [] };
          sections.TABLES[String(first(item.pairs, 2))] = table;
        } else if (item.type !== 'ENDTAB' && table) table.records.push(item);
      }
    } else if (name in sections) {
      sections[/** @type {'BLOCKS' | 'ENTITIES' | 'OBJECTS' | 'CLASSES'} */ (name)].push(...items(body));
    }
    i = j + 1;
  }
  return { pairs, order, sections };
}

/**
 * First value of a group code, or undefined.
 * @param {Pair[]} pairs
 * @param {number} code
 * @returns {string | undefined}
 */
export function first(pairs, code) {
  return pairs.find((p) => p[0] === code)?.[1];
}

/**
 * All values of a group code.
 * @param {Pair[]} pairs
 * @param {number} code
 * @returns {string[]}
 */
export function all(pairs, code) {
  return pairs.filter((p) => p[0] === code).map((p) => p[1]);
}

/**
 * Knots and control points of a SPLINE entity (points x, y interleaved).
 * @param {DxfItem} entity
 * @returns {{ degree: number, knots: number[], points: number[] }}
 */
export function splineOf(entity) {
  const degree = Number(first(entity.pairs, 71));
  const knots = all(entity.pairs, 40).map(Number);
  const xs = all(entity.pairs, 10).map(Number);
  const ys = all(entity.pairs, 20).map(Number);
  /** @type {number[]} */
  const points = [];
  for (let i = 0; i < xs.length; i++) points.push(xs[i], ys[i]);
  return { degree, knots, points };
}

/**
 * Point of a non-rational B-spline at parameter t, by de Boor's algorithm.
 * t is clamped to the knot range [knots[degree], knots[count]].
 * @param {{ degree?: number, knots: ArrayLike<number>, points: ArrayLike<number> }} spline
 * @param {number} t
 * @returns {{ x: number, y: number }}
 */
export function evaluateSpline(spline, t) {
  const p = spline.degree ?? 3;
  const { knots, points } = spline;
  const count = points.length / 2;
  const lo = knots[p];
  const hi = knots[count];
  const u = Math.min(Math.max(t, lo), hi);
  // Knot span k with knots[k] <= u < knots[k + 1]; the last span at u = hi.
  let k = p;
  while (k < count - 1 && u >= knots[k + 1]) k++;
  const dx = [];
  const dy = [];
  for (let j = 0; j <= p; j++) {
    dx.push(points[2 * (k - p + j)]);
    dy.push(points[2 * (k - p + j) + 1]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = knots[i + p - r + 1] - knots[i];
      const a = den === 0 ? 0 : (u - knots[i]) / den;
      dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
      dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
    }
  }
  return { x: dx[p], y: dy[p] };
}
