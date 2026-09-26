/**
 * Export files of a solved cam: five plate cut files, a reference drawing,
 * a string plan (DXF R2000, millimetres), the force table (CSV) and a ZIP
 * of all of them with a README.
 *
 * Cam files: origin at the axle centre, the cam at brace, viewed from the
 * string side (+Z towards the viewer), +X towards the archer, +Y up. The
 * bottom cam uses the same plates turned over. String plan: origin at the
 * grip pivot point, the whole bow at brace and at full draw.
 * @module export/files
 */

import { transform } from '../core/bspline.js';
import { describeError } from '../core/errors.js';
import { bowPoseAt, createBowPose, createLayout } from '../core/layout.js';
import { createTimingLayout, timingId, timingPoseAt } from '../core/timinglayout.js';
import { AMO_OFFSET, INCH } from '../core/units.js';
import { ANALYSIS_ONLY } from '../state/schema.js';
import { writeCsv, writeTimingCsv } from './csv.js';
import { writeDxf } from './dxf.js';
import { writeStep } from './step.js';
import { buildExportModel } from './model.js';
import { writeZip } from './zip.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('./model.js').ExportModel} ExportModel */
/** @typedef {import('./model.js').ExportCurve} ExportCurve */
/** @typedef {import('./dxf.js').DxfEntity} DxfEntity */
/** @typedef {import('./dxf.js').DxfLayer} DxfLayer */
/** @typedef {import('../core/bspline.js').BSpline} BSpline */

/**
 * @typedef {object} ExportFile
 * @property {string} part e.g. 'plate1-string-flange', 'reference', 'force-curve'
 * @property {string} name file name
 * @property {string} label button text
 * @property {string} mime
 * @property {string} text
 */

/**
 * @typedef {object} ExportSet
 * @property {ExportFile[]} files plates, reference, string plan, CSV
 * @property {string} readme text of README.txt
 * @property {string} id design id in the file names
 * @property {string[]} warnings
 */

/** Millimetres per metre. */
const MM = 1000;
/** Text height of the drawings (mm). */
const TEXT = 2.5;
/** Line spacing of text blocks (mm). */
const LEADING = 4;
/** Length of a timing mark outside the pitch line (mm). */
const MARK = 6;

/** Layers of the cam files. */
const LAYERS = Object.freeze({
  PITCH: 1, GROOVE: 3, FLANGE: 5, OUTLINE: 7, BORE: 6, POSTS: 4, STOP: 30, MARKS: 2, TEXT: 7,
});
/** Layers of the string plan. */
const PLAN_LAYERS = Object.freeze({ BRACE: 3, FULL: 1, TEXT: 7 });
const TIMING_PLAN_LAYERS = Object.freeze({ BRACE: 3, END: 1, TEXT: 7 });

/**
 * @param {Record<string, number>} table
 * @returns {DxfLayer[]}
 */
const layerList = (table) => Object.entries(table).map(([name, color]) => ({ name, color }));

/**
 * Thickness of each plate (m), plates 1 to 5: flanges t_f, groove plates
 * the cord diameter plus the clearance.
 * @param {ProjectState} state
 * @returns {number[]}
 */
export function plateThicknesses(state) {
  const { flangeThickness: tf, grooveClearance: c } = state.body;
  return [tf, state.cords.stringDiameter + c, tf, state.cords.cableDiameter + c, tf];
}

/**
 * STEP documents: one per plate on z ∈ [0, t], and the stacked cam with
 * plate 5 at the bottom and plate 1 on top (+Z towards a viewer on the
 * string side, as in the drawings), with both pitch lines in the
 * mid-plane of their groove plate. Plates without an outline are left out;
 * holes too close to the outline or another hole too.
 * @param {ExportModel} model
 * @param {ProjectState} state
 * @param {{ id: string, base: string, timestamp: string, system: string }} info
 * @returns {{ part: string, label: string, doc: import('./step.js').StepDocument }[]}
 */
export function stepDocuments(model, state, info) {
  const t = plateThicknesses(state);
  /** @type {number[]} bottom of each plate in the stack */
  const z = [0, 0, 0, 0, 0];
  let height = 0;
  for (let i = 4; i >= 0; i--) {
    z[i] = height;
    height += t[i];
  }
  const common = { description: `Cam ${info.id}, millimetres, viewed from the string side`, timestamp: info.timestamp, system: info.system };
  /** @type {{ part: string, label: string, doc: import('./step.js').StepDocument }[]} */
  const docs = [];
  /** @type {import('./step.js').StepSolid[]} */
  const stack = [];
  for (const plate of model.plates) {
    if (!plate.outline) continue;
    const i = plate.number - 1;
    const holes = plate.holes.filter((_, k) => plate.holeClear[k]);
    const name = `Plate ${plate.name}`;
    stack.push({ name, outline: plate.outline, holes, z0: z[i], z1: z[i] + t[i] });
    docs.push({
      part: `step-${plate.id}`,
      label: name,
      doc: { ...common, product: name, fileName: `${info.base}-${plate.id}.step`, solids: [{ name, outline: plate.outline, holes, z0: 0, z1: t[i] }] },
    });
  }
  /** @param {string} curveId */
  const curve = (curveId) => /** @type {ExportCurve} */ (model.curves.find((c) => c.id === curveId));
  const pitch = [
    { name: 'String pitch line', c: curve('string-pitch'), z: z[1] + t[1] / 2 },
    { name: 'Cable pitch line', c: curve('cable-pitch'), z: z[3] + t[3] / 2 },
  ];
  if (stack.length > 0) {
    docs.unshift({
      part: 'step-cam',
      label: 'All plates, stacked',
      doc: {
        ...common,
        product: `Cam ${info.id}`,
        fileName: `${info.base}-cam.step`,
        solids: stack,
        curves: pitch.map((p) => ({ name: p.name, circle: p.c.circle, spline: p.c.spline, z: p.z })),
      },
    });
  }
  return docs;
}

/**
 * Design id of the inputs a result was solved for: the first 6 hex digits
 * of the 32-bit FNV-1a hash of the state without its display units and
 * without the sections in ANALYSIS_ONLY, which do not change the cam.
 * @param {ProjectState} state
 */
export function designId(state) {
  /** @type {Record<string, unknown>} */
  const inputs = { ...state };
  delete inputs.units;
  for (const key of ANALYSIS_ONLY) delete inputs[key];
  const text = JSON.stringify(inputs);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Local date as YYYYMMDD and YYYY-MM-DD.
 * @param {Date} date
 */
function dateParts(date) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return { compact: `${y}${m}${d}`, iso: `${y}-${m}-${d}` };
}

/**
 * Length with 1 decimal in mm and 3 in inches.
 * @param {number} v (m)
 */
function mmIn(v) {
  return `${(v * MM).toFixed(1)} mm (${(v / INCH).toFixed(3)} in)`;
}

/**
 * Lines of the title block: design, units, view and tolerance.
 * @param {SolveResult} result
 * @param {ProjectState} state
 * @param {{ id: string, iso: string, version: string, tolerance: number }} info
 */
export function titleLines(result, state, info) {
  const g = state.geometry;
  const m = result.metrics;
  const lines = [
    `Compound Cam Calculator ${info.version}, design ${info.id}, ${info.iso}`,
    'Units mm, 1:1. Origin axle centre. Cam at brace, viewed from the string side (+Z towards the viewer).',
    `Curves within ${(info.tolerance * MM).toFixed(3)} mm of the model. Bottom cam: the same plates turned over.`,
    `ATA ${mmIn(g.ata)}, brace height ${mmIn(g.braceHeight)}, draw length ${mmIn(g.drawLength)} (AMO)`,
  ];
  if (m) lines.push(`Peak ${m.peak.toFixed(1)} N, let-off ${(m.letOff * 100).toFixed(1)} %, cam turns ${((m.rotation * 180) / Math.PI).toFixed(1)} deg`);
  const c = state.cords;
  lines.push(`String ${(c.stringDiameter * MM).toFixed(2)} mm, cable ${(c.cableDiameter * MM).toFixed(2)} mm, bore ${(state.body.boreDiameter * MM).toFixed(2)} mm`);
  return lines;
}

/**
 * DXF entity of an export curve in millimetres.
 * @param {ExportCurve} c
 * @param {string} layer
 * @returns {DxfEntity}
 */
function curveEntity(c, layer) {
  if (c.circle) return { type: 'circle', layer, x: c.circle.cx * MM, y: c.circle.cy * MM, r: c.circle.r * MM };
  const s = /** @type {BSpline} */ (c.spline);
  return { type: 'spline', layer, degree: 3, knots: s.knots, points: Array.from(s.points, (v) => v * MM), id: c.id };
}

/**
 * Text block with its top line at (x, y) (mm).
 * @param {string[]} lines
 * @param {number} x
 * @param {number} y
 * @returns {DxfEntity[]}
 */
function textBlock(lines, x, y) {
  return lines.map((text, i) => ({ type: 'text', layer: 'TEXT', x, y: y - i * LEADING, height: TEXT, text }));
}

/**
 * Bounds of points x, y interleaved (mm).
 * @param {ArrayLike<number>} pts
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} b
 */
function grow(pts, b) {
  for (let i = 0; i + 1 < pts.length; i += 2) {
    b.minX = Math.min(b.minX, pts[i]);
    b.maxX = Math.max(b.maxX, pts[i]);
    b.minY = Math.min(b.minY, pts[i + 1]);
    b.maxY = Math.max(b.maxY, pts[i + 1]);
  }
}

/**
 * Entities of one plate: outline and holes.
 * @param {ExportModel['plates'][number]} plate
 * @returns {DxfEntity[]}
 */
function plateEntities(plate) {
  /** @type {DxfEntity[]} */
  const out = [];
  if (plate.outlineCircle) {
    const c = plate.outlineCircle;
    out.push({ type: 'circle', layer: 'OUTLINE', x: c.cx * MM, y: c.cy * MM, r: c.r * MM });
  } else if (plate.contour) {
    out.push({ type: 'lwpolyline', layer: 'OUTLINE', points: plate.contour.map((v) => v * MM), id: plate.id });
  }
  plate.holes.forEach((h, i) => {
    const id = plate.holeIds[i];
    const layer = id === 'bore' ? 'BORE' : id === 'cable-stop' ? 'STOP' : 'POSTS';
    out.push({ type: 'circle', layer, x: h.cx * MM, y: h.cy * MM, r: h.r * MM });
  });
  return out;
}

/**
 * DXF entities of one half of the bow: limb lever, axle, the pitch lines of
 * the cam, the string to the nock and the cable to its anchor. The half is
 * given in its own frame; sy = −1 mirrors the bottom half into the world.
 * @param {ExportCurve[]} pitch pitch-line curves of the cam
 * @param {string} layer
 * @param {{ pivotX: number, pivotY: number, axleX: number, axleY: number, theta: number, stringX: number,
 *   stringY: number, cableX: number, cableY: number, anchorX: number, anchorY: number }} h
 * @param {1 | -1} sy
 * @param {{ x: number, y: number }} nock world (m)
 * @returns {DxfEntity[]}
 */
function halfEntities(pitch, layer, h, sy, nock) {
  /** @type {DxfEntity[]} */
  const out = [];
  const c = Math.cos(h.theta);
  const s = Math.sin(h.theta);
  // World = O + R(−θ)·v for the cam; the bottom half mirrors y.
  out.push({ type: 'line', layer, x1: h.pivotX * MM, y1: sy * h.pivotY * MM, x2: h.axleX * MM, y2: sy * h.axleY * MM });
  out.push({ type: 'circle', layer, x: h.axleX * MM, y: sy * h.axleY * MM, r: 3 });
  for (const curve of pitch) {
    if (curve.circle) {
      const k = curve.circle;
      out.push({
        type: 'circle', layer,
        x: (h.axleX + c * k.cx + s * k.cy) * MM, y: sy * (h.axleY - s * k.cx + c * k.cy) * MM, r: k.r * MM,
      });
    } else if (curve.spline) {
      const placed = transform(curve.spline, c * MM, s * MM, -s * sy * MM, c * sy * MM, h.axleX * MM, sy * h.axleY * MM);
      out.push({ type: 'spline', layer, degree: 3, knots: placed.knots, points: placed.points, id: `${curve.id}-${layer.toLowerCase()}-${sy > 0 ? 'top' : 'bottom'}` });
    }
  }
  out.push({ type: 'line', layer, x1: h.stringX * MM, y1: sy * h.stringY * MM, x2: nock.x * MM, y2: nock.y * MM });
  out.push({ type: 'line', layer, x1: h.cableX * MM, y1: sy * h.cableY * MM, x2: h.anchorX * MM, y2: sy * h.anchorY * MM });
  return out;
}

/**
 * All export files of a result. Never throws.
 * @param {SolveResult} result a full solve with status ok
 * @param {ProjectState} state the state the result was solved for
 * @param {{ date: Date, version: string, units: Units }} options display
 *   units of the CSV; date and version go into names and title blocks
 * @returns {{ set: ExportSet | null, error: string | null }}
 */
export function exportFiles(result, state, options) {
  try {
    return exportChecked(result, state, options);
  } catch (err) {
    // Any exception while reading malformed input.
    return { set: null, error: describeError(err) };
  }
}

/**
 * Body of {@link exportFiles}, which guards it.
 * @param {SolveResult} result
 * @param {ProjectState} state
 * @param {{ date: Date, version: string, units: Units }} options
 * @returns {{ set: ExportSet | null, error: string | null }}
 */
function exportChecked(result, state, options) {
  const { date, version, units } = options;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return { set: null, error: 'The export date must be a valid Date' };
  const built = buildExportModel(result, state);
  if (!built.model) return { set: null, error: built.error };
  const model = built.model;
  const layout = createLayout(result, state.geometry);
  if (!layout.layout) return { set: null, error: layout.error };
  const ctx = layout.layout;
  const id = designId(state);
  const { compact, iso } = dateParts(date);
  const title = titleLines(result, state, { id, iso, version: String(version), tolerance: model.tolerance });
  const base = `cam-${compact}-${id}`;
  /** @type {ExportFile[]} */
  const files = [];
  /**
   * @param {string} part
   * @param {string} label
   * @param {{ layers: DxfLayer[], entities: DxfEntity[] }} doc
   */
  const addDxf = (part, label, doc) => {
    const out = writeDxf(doc);
    if (out.text === null) throw new Error(`${label}: ${out.error}`);
    files.push({ part, name: `${base}-${part}.dxf`, label, mime: 'application/octet-stream', text: out.text });
  };

  for (const plate of model.plates) {
    addDxf(plate.id, `Plate ${plate.name}`, { layers: layerList({ OUTLINE: 7, BORE: 6, POSTS: 4, STOP: 30 }), entities: plateEntities(plate) });
  }

  // Reference drawing: every curve, the middle-flange outline, the holes of
  // all plates, the timing marks and the title block.
  /** @type {DxfEntity[]} */
  const ref = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const c of model.curves) {
    const layer = c.kind === 'pitch' ? 'PITCH' : c.kind === 'groove' ? 'GROOVE' : 'FLANGE';
    ref.push(curveEntity(c, layer));
    if (c.circle) grow([(c.circle.cx - c.circle.r) * MM, (c.circle.cy - c.circle.r) * MM, (c.circle.cx + c.circle.r) * MM, (c.circle.cy + c.circle.r) * MM], bounds);
    else if (c.spline) grow(Array.from(c.spline.points, (v) => v * MM), bounds);
  }
  const middle = model.plates[2];
  if (middle.contour) ref.push({ type: 'lwpolyline', layer: 'OUTLINE', points: middle.contour.map((v) => v * MM), id: middle.id });
  /** @type {Set<string>} */
  const seen = new Set();
  for (const plate of model.plates) {
    plate.holes.forEach((h, i) => {
      const key = `${h.cx},${h.cy},${h.r}`;
      if (seen.has(key)) return;
      seen.add(key);
      const hid = plate.holeIds[i];
      ref.push({ type: 'circle', layer: hid === 'bore' ? 'BORE' : hid === 'cable-stop' ? 'STOP' : 'POSTS', x: h.cx * MM, y: h.cy * MM, r: h.r * MM });
    });
  }
  for (const m of model.marks) {
    ref.push({ type: 'line', layer: 'MARKS', x1: m.x * MM, y1: m.y * MM, x2: m.x * MM + MARK * m.nx, y2: m.y * MM + MARK * m.ny });
  }
  const legend = [
    'Layers: PITCH red, GROOVE green, FLANGE blue, OUTLINE white (middle flange cut),',
    'BORE magenta, POSTS cyan, STOP orange, MARKS yellow (timing marks)',
  ];
  const top = (Number.isFinite(bounds.maxY) ? bounds.maxY : 0) + 10 + LEADING * (title.length + legend.length);
  const left = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  ref.push(...textBlock([...title, ...legend], left, top));
  addDxf('reference', 'Reference drawing', { layers: layerList(LAYERS), entities: ref });

  // String plan: the bow at brace and at full draw, top and bottom.
  /** @type {DxfEntity[]} */
  const plan = [];
  const pitch = model.curves.filter((c) => c.kind === 'pitch');
  for (const [layer, x] of /** @type {const} */ ([['BRACE', ctx.xBrace], ['FULL', ctx.xFull]])) {
    const pose = createBowPose();
    if (!bowPoseAt(ctx, x, pose) || pose.beyondSolution) return { set: null, error: 'The string plan needs a solve that reaches full draw' };
    for (const sy of /** @type {const} */ ([1, -1])) plan.push(...halfEntities(pitch, layer, pose, sy, { x: pose.x, y: 0 }));
  }
  const brace = createBowPose();
  bowPoseAt(ctx, ctx.xBrace, brace);
  plan.push({ type: 'line', layer: 'BRACE', x1: brace.pivotX * MM, y1: brace.pivotY * MM, x2: brace.pivotX * MM, y2: -brace.pivotY * MM });
  const L = ctx.lengths;
  const planText = [
    title[0],
    'Units mm, 1:1. Origin grip pivot point, archer to the right. BRACE green, FULL red.',
    `String, pitch line between the termination points: ${mmIn(L.string)}`,
    `Power cable, each of 2, pitch line from its termination to the opposite axle centre: ${mmIn(L.cable)}`,
    'Pitch-line lengths: add loops, serving and stretch for the build.',
    `ATA at brace ${mmIn(L.ataBrace)}, at full draw ${mmIn(L.ataFull)}`,
    `Brace height ${mmIn(ctx.xBrace)}, draw length ${mmIn(ctx.xFull + AMO_OFFSET)} (AMO)`,
  ];
  const planTop = (brace.axleY * MM) + 40 + LEADING * planText.length;
  plan.push(...textBlock(planText, Math.min(0, brace.pivotX * MM) - 20, planTop));
  addDxf('string-plan', 'String plan', { layers: layerList(PLAN_LAYERS), entities: plan });

  const csv = writeCsv(result, ctx, units);
  if (csv.text === null) return { set: null, error: `Force table: ${csv.error}` };
  files.push({ part: 'force-curve', name: `${base}-force-curve.csv`, label: 'Force table (CSV)', mime: 'text/csv;charset=utf-8', text: csv.text });

  // Timing files: only for changed cords. The design files above never
  // depend on the timing settings; these names carry their id.
  const tl = createTimingLayout(result, ctx);
  /** @type {string[]} */
  let timingProblems = [];
  if (tl) {
    timingProblems = tl.analysis.diagnostics.map((d) => d.message);
    const tbase = `${base}-timing-${timingId(state.tuning)}`;
    const a = tl.analysis;
    /** @type {DxfEntity[]} */
    const tplan = [];
    for (const [layer, x] of /** @type {const} */ ([['BRACE', tl.xBrace], ['END', tl.xEnd]])) {
      const p = /** @type {import('../core/timinglayout.js').TimingPose} */ (timingPoseAt(tl, x));
      tplan.push(...halfEntities(pitch, layer, { ...p.top, pivotX: p.pivotX, pivotY: p.pivotY }, 1, { x: p.x, y: p.y }));
      tplan.push(...halfEntities(pitch, layer, { ...p.bottom, pivotX: p.pivotX, pivotY: p.pivotY }, -1, { x: p.x, y: p.y }));
    }
    const tb = /** @type {import('../core/timinglayout.js').TimingPose} */ (timingPoseAt(tl, tl.xBrace));
    tplan.push({ type: 'line', layer: 'BRACE', x1: tb.pivotX * MM, y1: tb.pivotY * MM, x2: tb.pivotX * MM, y2: -tb.pivotY * MM });
    const t = state.tuning;
    const signedMm = (/** @type {number} */ v) => `${v >= 0 ? '+' : '-'}${Math.abs(v * MM).toFixed(2)} mm`;
    const stopText = a.stops.first === 'both' ? 'both cams together'
      : a.stops.first === 'top' ? `top cam first, bottom gap ${(a.stops.gapBottom * MM).toFixed(2)} mm`
        : a.stops.first === 'bottom' ? `bottom cam first, top gap ${(a.stops.gapTop * MM).toFixed(2)} mm` : 'no stop reached';
    const ttext = [
      title[0],
      'Timing analysis only: the cam is the design above; rigid cords, nock free to move up and down.',
      'Units mm, 1:1. Origin grip pivot point, archer to the right. BRACE green, END red (end of the draw).',
      `Top cable ${signedMm(t.topCable)}, bottom cable ${signedMm(t.bottomCable)}, string ${signedMm(t.string)}, nocking point ${signedMm(t.nockHeight)}`,
      `Brace height ${mmIn(tl.xBrace)}, nock ${(tb.y * MM).toFixed(2)} mm above the axis at brace`,
      `End of the draw ${mmIn(tl.xEnd + AMO_OFFSET)} (AMO): ${stopText}; cam timing ${((a.dTheta[a.end] * 180) / Math.PI).toFixed(2)} deg`,
      ...(timingProblems.length > 0 ? ['Problems of the analysis:', ...timingProblems] : ['Problems of the analysis: none']),
    ];
    tplan.push(...textBlock(ttext, Math.min(0, tb.pivotX * MM) - 20, (tb.top.axleY * MM) + 40 + LEADING * ttext.length));
    const tout = writeDxf({ layers: layerList(TIMING_PLAN_LAYERS), entities: tplan });
    if (tout.text === null) throw new Error(`Timing string plan: ${tout.error}`);
    files.push({ part: 'timing-string-plan', name: `${tbase}-string-plan.dxf`, label: 'String plan with the timing settings (DXF)', mime: 'application/octet-stream', text: tout.text });
    const tcsv = writeTimingCsv(a, units);
    if (tcsv.text === null) return { set: null, error: `Timing table: ${tcsv.error}` };
    files.push({ part: 'timing-table', name: `${tbase}.csv`, label: 'Timing table (CSV)', mime: 'text/csv;charset=utf-8', text: tcsv.text });
  }

  const timestamp = `${iso}T${[date.getHours(), date.getMinutes(), date.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':')}`;
  const system = `Compound Cam Calculator ${String(version)}`;
  for (const step of stepDocuments(model, state, { id, base, timestamp, system })) {
    const out = writeStep(step.doc);
    if (out.text === null) throw new Error(`${step.label}: ${out.error}`);
    files.push({ part: step.part, name: step.doc.fileName, label: step.label, mime: 'application/step', text: out.text });
  }

  const readme = [
    ...title,
    '',
    'Files:',
    ...files.map((f) => `  ${f.name}  ${f.label}`),
    '',
    'Plates 1 to 5 stack from the string side: 1 string flange, 2 string groove, 3 middle flange, 4 cable groove, 5 cable flange.',
    'Plate files hold closed polylines and circles only: OUTLINE is the cut, BORE the axle hole, POSTS and STOP the post holes.',
    'Kerf compensation is left to the cutting software. Check the scale after import: the bore measures '
      + `${(state.body.boreDiameter * MM).toFixed(2)} mm.`,
    `STEP files (AP214, millimetres) hold the plates as solids: flange plates ${(plateThicknesses(state)[0] * MM).toFixed(2)} mm, `
      + `string groove plate ${(plateThicknesses(state)[1] * MM).toFixed(2)} mm, cable groove plate ${(plateThicknesses(state)[3] * MM).toFixed(2)} mm thick.`,
    'The stacked file has plate 5 at z = 0 and plate 1 on top, and the pitch lines as wireframe in the middle of their groove plates; '
      + 'some programs hide wireframe on import. Outlines lie within 0.01 mm of the model, without the cut offset of the DXF files.',
    ...bossNote(model),
    ...(model.warnings.length ? ['', 'Warnings:', ...model.warnings.map((w) => `  ${w}`)] : []),
    ...(tl
      ? ['', 'The timing files analyse the cam above with the timing settings; they do not change it.',
          ...(timingProblems.length ? ['Problems of the timing analysis:', ...timingProblems.map((p) => `  ${p}`)] : [])]
      : []),
    '',
  ].join('\r\n');
  return { set: { files, readme, id, warnings: model.warnings }, error: null };
}

/**
 * README line on the plates that carry a boss around a post.
 * @param {ExportModel} model
 * @returns {string[]}
 */
function bossNote(model) {
  const on = model.plates.filter((p) => p.bosses.length > 0).map((p) => p.number);
  if (on.length === 0) return [];
  const plates = on.length > 1 ? `Plates ${on.join(' and ')} carry` : `Plate ${on[0]} carries`;
  return [`${plates} a boss around the cable stop: the peg reaches past the flange, so the outline grows by the minimum wall around it.`];
}

/**
 * ZIP of an export set with its README. Never throws.
 * @param {ExportSet} set
 * @param {Date} date
 * @returns {{ name: string, bytes: Uint8Array | null, error: string | null }}
 */
export function exportZip(set, date) {
  try {
    const { compact } = dateParts(date);
    const name = `cam-${compact}-${set.id}.zip`;
    const out = writeZip([{ name: 'README.txt', text: set.readme }, ...set.files.map((f) => ({ name: f.name, text: f.text }))], { date });
    return { name, bytes: out.bytes, error: out.error };
  } catch (err) {
    // Any exception while reading malformed input.
    return { name: '', bytes: null, error: describeError(err) };
  }
}
