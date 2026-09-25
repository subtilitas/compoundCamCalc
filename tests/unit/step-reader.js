/**
 * Part 21 reader and checker for the STEP files of the export, independent
 * of src/export/step.js: it parses the text, follows references and checks
 * the rules the writer promises. Used by the unit tests and by
 * scripts/validate-step.js.
 */

/**
 * @typedef {{ type: 'ref', id: number } | { type: 'str', value: string } | { type: 'real', value: number, text: string }
 *   | { type: 'int', value: number } | { type: 'enum', value: string } | { type: 'null' } | { type: 'derived' }
 *   | { type: 'list', items: Arg[] } | { type: 'typed', name: string, args: Arg[] }} Arg
 */

/**
 * @typedef {object} Entity
 * @property {number} id
 * @property {string} type type name, or the parts joined by '+' for a complex instance
 * @property {Arg[]} args arguments of a simple instance
 * @property {Map<string, Arg[]>} parts parts of a complex instance
 */

/**
 * Tokens of the DATA section text of one entity.
 * @param {string} text
 */
function tokens(text) {
  /** @type {{ kind: string, text: string }[]} */
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= text.length) throw new Error('unterminated string');
        if (text[j] === "'" && text[j + 1] === "'") {
          value += "'";
          j += 2;
        } else if (text[j] === "'") break;
        else value += text[j++];
      }
      out.push({ kind: 'str', text: value });
      i = j + 1;
      continue;
    }
    if ('(),=*$;'.includes(c)) {
      out.push({ kind: c, text: c });
      i++;
      continue;
    }
    const m = /^(#\d+|\.[A-Z_0-9]+\.|[+-]?\d+(\.\d*)?(E[+-]?\d+)?|[A-Z_][A-Z_0-9]*)/.exec(text.slice(i));
    if (!m) throw new Error(`unexpected character ${JSON.stringify(c)} at ${i}`);
    const t = m[0];
    const kind = t.startsWith('#') ? 'ref' : t.startsWith('.') ? 'enum' : /^[+-]?\d/.test(t) ? (t.includes('.') ? 'real' : 'int') : 'name';
    out.push({ kind, text: t });
    i += t.length;
  }
  return out;
}

/**
 * Parse a STEP file: header lines and entities by id.
 * @param {string} text
 * @returns {{ header: string, entities: Map<number, Entity> }}
 */
export function readStep(text) {
  const start = text.indexOf('DATA;');
  const end = text.lastIndexOf('ENDSEC;');
  if (!text.startsWith('ISO-10303-21;') || start < 0 || end < start) throw new Error('not a Part 21 file');
  const header = text.slice(0, start);
  const data = text.slice(start + 5, end);
  /** @type {Map<number, Entity>} */
  const entities = new Map();
  // Split at ';' outside strings.
  let buf = '';
  let inString = false;
  for (const ch of data) {
    if (ch === "'") inString = !inString;
    if (ch === ';' && !inString) {
      if (buf.trim()) parseEntity(buf.trim(), entities);
      buf = '';
    } else buf += ch;
  }
  if (buf.trim()) throw new Error('entity without ";"');
  return { header, entities };
}

/**
 * @param {string} text '#id=...'
 * @param {Map<number, Entity>} entities
 */
function parseEntity(text, entities) {
  const t = tokens(text);
  if (t[0]?.kind !== 'ref' || t[1]?.kind !== '=') throw new Error(`bad entity: ${text.slice(0, 40)}`);
  const id = Number(t[0].text.slice(1));
  if (entities.has(id)) throw new Error(`duplicate #${id}`);
  let pos = 2;
  /** @returns {Arg} */
  const arg = () => {
    const k = t[pos];
    if (!k) throw new Error(`unexpected end in #${id}`);
    pos++;
    if (k.kind === 'ref') return { type: 'ref', id: Number(k.text.slice(1)) };
    if (k.kind === 'str') return { type: 'str', value: k.text };
    if (k.kind === 'real') return { type: 'real', value: Number(k.text), text: k.text };
    if (k.kind === 'int') return { type: 'int', value: Number(k.text) };
    if (k.kind === 'enum') return { type: 'enum', value: k.text };
    if (k.kind === '$') return { type: 'null' };
    if (k.kind === '*') return { type: 'derived' };
    if (k.kind === '(') {
      pos--;
      return { type: 'list', items: list() };
    }
    if (k.kind === 'name') return { type: 'typed', name: k.text, args: list() };
    throw new Error(`unexpected token ${k.text} in #${id}`);
  };
  /** @returns {Arg[]} */
  const list = () => {
    if (t[pos]?.kind !== '(') throw new Error(`"(" expected in #${id}`);
    pos++;
    /** @type {Arg[]} */
    const items = [];
    if (t[pos]?.kind === ')') {
      pos++;
      return items;
    }
    for (;;) {
      items.push(arg());
      const k = t[pos++];
      if (k?.kind === ')') return items;
      if (k?.kind !== ',') throw new Error(`"," or ")" expected in #${id}`);
    }
  };
  if (t[pos].kind === 'name') {
    const type = t[pos++].text;
    const args = list();
    entities.set(id, { id, type, args, parts: new Map() });
  } else if (t[pos].kind === '(') {
    pos++;
    /** @type {Map<string, Arg[]>} */
    const parts = new Map();
    while (t[pos]?.kind === 'name') {
      const name = t[pos++].text;
      parts.set(name, list());
    }
    if (t[pos++]?.kind !== ')') throw new Error(`bad complex instance #${id}`);
    entities.set(id, { id, type: [...parts.keys()].join('+'), args: [], parts });
  } else throw new Error(`bad entity #${id}`);
  if (pos !== t.length) throw new Error(`trailing tokens in #${id}`);
}

/**
 * @param {Map<number, Entity>} entities
 * @param {Arg} a
 * @returns {Entity}
 */
export function deref(entities, a) {
  if (a.type !== 'ref') throw new Error(`reference expected, got ${a.type}`);
  const e = entities.get(a.id);
  if (!e) throw new Error(`#${a.id} is not defined`);
  return e;
}

/**
 * @param {Arg} a
 * @returns {number}
 */
const num = (a) => {
  if (a.type !== 'real' && a.type !== 'int') throw new Error(`number expected, got ${a.type}`);
  return a.value;
};

/**
 * @param {Arg} a
 * @returns {Arg[]}
 */
const items = (a) => {
  if (a.type !== 'list') throw new Error(`list expected, got ${a.type}`);
  return a.items;
};

/**
 * @param {Map<number, Entity>} entities
 * @param {Arg} a CARTESIAN_POINT reference
 */
export function pointOf(entities, a) {
  const e = deref(entities, a);
  if (e.type !== 'CARTESIAN_POINT') throw new Error(`CARTESIAN_POINT expected, got ${e.type}`);
  return items(e.args[1]).map(num);
}

/**
 * Placement: origin, axis and reference direction.
 * @param {Map<number, Entity>} entities
 * @param {Arg} a
 */
function placementOf(entities, a) {
  const e = deref(entities, a);
  const dir = (/** @type {Arg} */ d) => items(deref(entities, d).args[1]).map(num);
  return { origin: pointOf(entities, e.args[1]), axis: dir(e.args[2]), ref: dir(e.args[3]) };
}

/**
 * Point of a curve entity at n + 1 samples over its range: CIRCLE (one
 * turn from the reference direction, counter-clockwise about the axis),
 * B_SPLINE_CURVE_WITH_KNOTS (uniform in u) and LINE (unit length).
 * @param {Map<number, Entity>} entities
 * @param {Entity} curve
 * @param {number} n
 * @returns {number[][]}
 */
export function sampleCurve(entities, curve, n) {
  if (curve.type === 'CIRCLE') {
    const pl = placementOf(entities, curve.args[1]);
    const r = num(curve.args[2]);
    const y = cross(pl.axis, pl.ref);
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return [0, 1, 2].map((k) => pl.origin[k] + r * (Math.cos(a) * pl.ref[k] + Math.sin(a) * y[k]));
    });
  }
  if (curve.type === 'B_SPLINE_CURVE_WITH_KNOTS') {
    const spline = splineOf(entities, curve);
    const u0 = spline.knots[3];
    const u1 = spline.knots[spline.knots.length - 4];
    return Array.from({ length: n + 1 }, (_, i) => evalSpline(spline, u0 + ((u1 - u0) * i) / n));
  }
  if (curve.type === 'LINE') {
    const p = pointOf(entities, curve.args[1]);
    const v = deref(entities, curve.args[2]);
    const d = items(deref(entities, v.args[1]).args[1]).map(num);
    const len = num(v.args[2]);
    return Array.from({ length: n + 1 }, (_, i) => p.map((c, k) => c + (len * i * d[k]) / n));
  }
  throw new Error(`cannot sample ${curve.type}`);
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Control points (3D) and expanded knots of a B_SPLINE_CURVE_WITH_KNOTS.
 * @param {Map<number, Entity>} entities
 * @param {Entity} e
 */
export function splineOf(entities, e) {
  const degree = num(e.args[1]);
  const points = items(e.args[2]).map((a) => pointOf(entities, a));
  const mults = items(e.args[6]).map(num);
  const values = items(e.args[7]).map(num);
  /** @type {number[]} */
  const knots = [];
  mults.forEach((m, i) => {
    for (let k = 0; k < m; k++) knots.push(values[i]);
  });
  return { degree, points, knots, mults, closed: e.args[4].type === 'enum' && e.args[4].value === '.T.' };
}

/**
 * De Boor evaluation of a cubic B-spline.
 * @param {{ points: number[][], knots: number[] }} s
 * @param {number} u
 */
export function evalSpline(s, u) {
  const p = 3;
  const n = s.points.length - 1;
  let k = p;
  while (k < n && u >= s.knots[k + 1]) k++;
  /** @type {number[][]} */
  const d = [];
  for (let j = 0; j <= p; j++) d.push([...s.points[k - p + j]]);
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = s.knots[i + p - r + 1] - s.knots[i];
      const a = den === 0 ? 0 : (u - s.knots[i]) / den;
      d[j] = d[j].map((c, m) => (1 - a) * d[j - 1][m] + a * c);
    }
  }
  return d[p];
}

/**
 * Check a STEP file of the export. Returns a list of problems (empty when
 * the file follows every rule) and a summary.
 * @param {string} text
 * @returns {{ problems: string[], solids: { name: string, V: number, E: number, F: number, L: number, holes: number }[], curves: number }}
 */
export function checkStep(text) {
  /** @type {string[]} */
  const problems = [];
  const { header, entities } = readStep(text);
  if (!header.includes("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));")) problems.push('FILE_SCHEMA is not AP214 automotive_design');
  if (!/FILE_NAME\('[^']*','\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'/.test(header)) problems.push('FILE_NAME has no time stamp');
  // Every reference defined; REAL tokens with a decimal point.
  for (const e of entities.values()) {
    const walk = (/** @type {Arg[]} */ args) => {
      for (const a of args) {
        if (a.type === 'ref' && !entities.has(a.id)) problems.push(`#${e.id} refers to undefined #${a.id}`);
        if (a.type === 'real' && !a.text.includes('.')) problems.push(`#${e.id}: REAL without a decimal point`);
        if (a.type === 'list') walk(a.items);
        if (a.type === 'typed') walk(a.args);
      }
    };
    walk(e.args);
    for (const args of e.parts.values()) walk(args);
  }
  const unit = [...entities.values()].find((e) => e.parts.has('LENGTH_UNIT'));
  const si = unit?.parts.get('SI_UNIT');
  if (!si || si[0].type !== 'enum' || si[0].value !== '.MILLI.') problems.push('the length unit is not the millimetre');
  // B-splines: integer degree and multiplicities, knot sum.
  for (const e of entities.values()) {
    if (e.type !== 'B_SPLINE_CURVE_WITH_KNOTS') continue;
    if (e.args[1].type !== 'int') problems.push(`#${e.id}: degree is not an INTEGER`);
    const mults = items(e.args[6]);
    if (mults.some((m) => m.type !== 'int')) problems.push(`#${e.id}: multiplicities are not INTEGERs`);
    const sum = mults.reduce((a, m) => a + num(m), 0);
    const n = items(e.args[2]).length;
    if (sum !== n + num(e.args[1]) + 1) problems.push(`#${e.id}: knot multiplicities sum to ${sum}, expected ${n + num(e.args[1]) + 1}`);
    const values = items(e.args[7]).map(num);
    if (values.some((v, i) => i > 0 && !(v > values[i - 1]))) problems.push(`#${e.id}: knot values do not increase`);
  }
  /** @type {{ name: string, V: number, E: number, F: number, L: number, holes: number }[]} */
  const solids = [];
  for (const e of entities.values()) {
    if (e.type !== 'MANIFOLD_SOLID_BREP') continue;
    const name = e.args[0].type === 'str' ? e.args[0].value : '';
    const shell = deref(entities, e.args[1]);
    const faces = items(shell.args[1]).map((a) => deref(entities, a));
    /** @type {Map<number, number[]>} edge id → senses of its uses */
    const uses = new Map();
    const vertices = new Set();
    let loops = 0;
    let holes = 0;
    for (const face of faces) {
      if (face.type !== 'ADVANCED_FACE') {
        problems.push(`${name}: #${face.id} is ${face.type}, not ADVANCED_FACE`);
        continue;
      }
      const sameSense = face.args[3].type === 'enum' && face.args[3].value === '.T.';
      const surface = deref(entities, face.args[2]);
      for (const b of items(face.args[1])) {
        const boundE = deref(entities, b);
        loops++;
        const loop = deref(entities, boundE.args[1]);
        const oes = items(loop.args[1]).map((a) => deref(entities, a));
        /** @type {{ start: number, end: number, edge: Entity, sense: boolean }[]} */
        const walk = oes.map((oe) => {
          const edge = deref(entities, oe.args[3]);
          const sense = oe.args[4].type === 'enum' && oe.args[4].value === '.T.';
          const s = /** @type {{ id: number }} */ (edge.args[1]).id;
          const t = /** @type {{ id: number }} */ (edge.args[2]).id;
          vertices.add(s);
          vertices.add(t);
          const list = uses.get(edge.id) ?? [];
          list.push(sense ? 1 : -1);
          uses.set(edge.id, list);
          return sense ? { start: s, end: t, edge, sense } : { start: t, end: s, edge, sense };
        });
        walk.forEach((w, i) => {
          if (w.end !== walk[(i + 1) % walk.length].start) problems.push(`${name}: loop #${loop.id} is not connected at edge ${i}`);
        });
        // Planar faces: loop area against the face normal.
        if (surface.type === 'PLANE') {
          if (boundE.type === 'FACE_BOUND') holes++;
          const axis = placementOf(entities, surface.args[1]).axis;
          const sign = sameSense ? 1 : -1;
          let area = 0;
          for (const w of walk) {
            const curve = deref(entities, w.edge.args[3]);
            const pts = sampleCurve(entities, curve, 400);
            if (!w.sense) pts.reverse();
            for (let i = 0; i + 1 < pts.length; i++) {
              const c = cross(pts[i], pts[i + 1]);
              area += 0.5 * (c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2]);
            }
          }
          const outer = boundE.type === 'FACE_OUTER_BOUND';
          if (outer ? !(sign * area > 0) : !(sign * area < 0)) problems.push(`${name}: ${boundE.type} #${boundE.id} runs the wrong way on its face`);
        }
      }
    }
    // Side faces: the outline's faces outward (same_sense .T.), a hole's
    // cylinder reversed (.F.), with a counter-clockwise profile swept or
    // turned about +Z. The role of a profile comes from the planar faces.
    /** @type {Map<number, 'outer' | 'hole'>} */
    const role = new Map();
    for (const face of faces) {
      if (face.type !== 'ADVANCED_FACE' || deref(entities, face.args[2]).type !== 'PLANE') continue;
      for (const b of items(face.args[1])) {
        const boundE = deref(entities, b);
        const loop = deref(entities, boundE.args[1]);
        for (const oe of items(loop.args[1])) role.set(deref(entities, deref(entities, oe).args[3]).id, boundE.type === 'FACE_OUTER_BOUND' ? 'outer' : 'hole');
      }
    }
    for (const face of faces) {
      if (face.type !== 'ADVANCED_FACE') continue;
      const surface = deref(entities, face.args[2]);
      if (surface.type === 'PLANE') continue;
      const loop = deref(entities, deref(entities, items(face.args[1])[0]).args[1]);
      const edges = items(loop.args[1]).map((oe) => deref(entities, deref(entities, oe).args[3]));
      const r = edges.map((e) => role.get(e.id)).find((x) => x !== undefined);
      const sense = face.args[3].type === 'enum' && face.args[3].value === '.T.';
      if (!r) problems.push(`${name}: side face #${face.id} touches no planar face`);
      else if (sense !== (r === 'outer')) problems.push(`${name}: side face #${face.id} of the ${r === 'outer' ? 'outline' : 'hole'} runs the wrong way`);
      /** @type {number[]} */
      let axis;
      if (surface.type === 'SURFACE_OF_LINEAR_EXTRUSION') {
        const v = deref(entities, surface.args[2]);
        axis = items(deref(entities, v.args[1]).args[1]).map(num);
        const pts = sampleCurve(entities, deref(entities, surface.args[1]), 2000);
        let area = 0;
        for (let i = 0; i + 1 < pts.length; i++) area += 0.5 * (pts[i][0] * pts[i + 1][1] - pts[i][1] * pts[i + 1][0]);
        if (!(area > 0)) problems.push(`${name}: the profile swept by #${surface.id} is not counter-clockwise`);
      } else if (surface.type === 'CYLINDRICAL_SURFACE') {
        axis = placementOf(entities, surface.args[1]).axis;
      } else {
        problems.push(`${name}: unexpected side surface ${surface.type}`);
        continue;
      }
      if (!(axis[2] > 0 && Math.abs(axis[0]) + Math.abs(axis[1]) < 1e-12)) problems.push(`${name}: side surface #${surface.id} does not run along +Z`);
    }
    // Geometry agrees with topology: vertices at the ends of their curves,
    // edges on the surfaces of their faces, the top of an extrusion its
    // base moved by the extrusion vector (1e-6 mm).
    const TOL = 1e-6;
    const dist = (/** @type {number[]} */ p, /** @type {number[]} */ q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    for (const id of uses.keys()) {
      const edge = /** @type {Entity} */ (entities.get(id));
      const curve = deref(entities, edge.args[3]);
      const v0 = pointOf(entities, deref(entities, edge.args[1]).args[1]);
      const v1 = pointOf(entities, deref(entities, edge.args[2]).args[1]);
      const forward = edge.args[4].type === 'enum' && edge.args[4].value === '.T.';
      if (curve.type === 'LINE') {
        // A LINE is unbounded: both vertices on it, in the order of its direction.
        const [o, q] = sampleCurve(entities, curve, 1);
        const d = [0, 1, 2].map((k) => q[k] - o[k]);
        const len = Math.hypot(...d);
        const off = (/** @type {number[]} */ v) => {
          const t = ((v[0] - o[0]) * d[0] + (v[1] - o[1]) * d[1] + (v[2] - o[2]) * d[2]) / (len * len);
          return { t, gap: dist(v, o.map((c, k) => c + t * d[k])) };
        };
        const a0 = off(v0);
        const a1 = off(v1);
        if (a0.gap > TOL || a1.gap > TOL || (forward ? !(a1.t > a0.t) : !(a1.t < a0.t))) problems.push(`${name}: edge #${id} does not start and end at its vertices`);
        continue;
      }
      const pts = sampleCurve(entities, curve, 1);
      const [a, b] = forward ? [pts[0], pts[1]] : [pts[1], pts[0]];
      if (dist(a, v0) > TOL || dist(b, v1) > TOL) problems.push(`${name}: edge #${id} does not start and end at its vertices`);
    }
    for (const face of faces) {
      if (face.type !== 'ADVANCED_FACE') continue;
      const surface = deref(entities, face.args[2]);
      const curves = items(face.args[1]).flatMap((b) => items(deref(entities, deref(entities, b).args[1]).args[1])
        .map((oe) => deref(entities, deref(entities, deref(entities, oe).args[3]).args[3])));
      if (surface.type === 'PLANE' || surface.type === 'CYLINDRICAL_SURFACE') {
        const pl = placementOf(entities, surface.args[1]);
        const r = surface.type === 'CYLINDRICAL_SURFACE' ? num(surface.args[2]) : 0;
        for (const c of curves) {
          for (const p of sampleCurve(entities, c, 64)) {
            const d = [0, 1, 2].map((k) => p[k] - pl.origin[k]);
            const along = d[0] * pl.axis[0] + d[1] * pl.axis[1] + d[2] * pl.axis[2];
            const off = surface.type === 'PLANE' ? Math.abs(along) : Math.abs(Math.hypot(...d.map((v, k) => v - along * pl.axis[k])) - r);
            if (off > TOL) {
              problems.push(`${name}: an edge of face #${face.id} lies ${off} mm off its ${surface.type}`);
              break;
            }
          }
        }
      } else if (surface.type === 'SURFACE_OF_LINEAR_EXTRUSION') {
        const base = deref(entities, surface.args[1]);
        const vec = deref(entities, surface.args[2]);
        const dir = items(deref(entities, vec.args[1]).args[1]).map(num);
        const len = num(vec.args[2]);
        const splines = curves.filter((c) => c.type === 'B_SPLINE_CURVE_WITH_KNOTS');
        if (!splines.includes(base)) problems.push(`${name}: the swept curve of #${surface.id} is not an edge of its face`);
        const bp = splineOf(entities, base).points;
        for (const c of splines) {
          if (c === base) continue;
          const cp = splineOf(entities, c).points;
          if (cp.length !== bp.length || cp.some((p, i) => dist(p, bp[i].map((v, k) => v + len * dir[k])) > TOL)) {
            problems.push(`${name}: curve #${c.id} is not the swept curve of #${surface.id} moved by its vector`);
          }
        }
      }
    }
    for (const [id, senses] of uses) {
      if (senses.length !== 2 || senses[0] + senses[1] !== 0) problems.push(`${name}: edge #${id} is used ${senses.length} times with senses ${senses.join(',')}`);
    }
    // Holes counted on one planar face (top and bottom carry the same).
    const G = holes / 2;
    const V = vertices.size;
    const E = uses.size;
    const F = faces.length;
    if (V - E + 2 * F - loops !== 2 * (1 - G)) problems.push(`${name}: Euler–Poincaré fails: V ${V}, E ${E}, F ${F}, L ${loops}, G ${G}`);
    solids.push({ name, V, E, F, L: loops, holes: G });
  }
  const set = [...entities.values()].find((e) => e.type === 'GEOMETRIC_CURVE_SET');
  return { problems, solids, curves: set ? items(set.args[1]).length : 0 };
}
