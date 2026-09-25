/**
 * Cam view: SVG drawing of both tracks in the cam frame, with fit-to-view,
 * zoom and pan (ui/viewport), a legend and a scale bar. The cam turns to the
 * draw position with the contact points, the lever arms and the directions
 * of both cords.
 *
 * The cam frame has metres with y up; the SVG user space is the same with y
 * down, so every y is negated when drawn. A cam turned by θ (clockwise in
 * the world frame) is the drawing under rotate(θ in degrees): a cam-frame
 * point v is drawn at (v_x, −v_y) and rotate(a) maps that to
 * (v_x·cos a + v_y·sin a, v_x·sin a − v_y·cos a), the world point R(−θ)·v
 * with y flipped when a = θ.
 * @module ui/camview
 */

import { fromSI } from '../core/units.js';
import { DIMS_DECIMALS, angleText, dimsText, drawText, fixed } from './display.js';
import { h, setAttrs, svg } from './dom.js';
import { FIT_PADDING, KEYS_HELP, coord, createViewport, viewBoxFor } from './viewport.js';

export {
  FIT_PADDING, KEYS_HELP, MAX_ZOOM, PAN_STEP, PAN_STEP_LARGE, ZOOM_STEP, clampView, niceLength, panView, viewBoxFor, zoomView,
} from './viewport.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/solve.js').Outline} Outline */
/** @typedef {import('../core/solve.js').Post} Post */
/** @typedef {import('../core/solve.js').Mark} Mark */
/** @typedef {import('../core/layout.js').BowPose} BowPose */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('./viewport.js').Bounds} Bounds */

/** Draw order: cable flange under string flange, then grooves and pitch lines. */
const LAYERS = /** @type {const} */ ([
  ['cableFlange', 'cam-flange cam-cable'],
  ['stringFlange', 'cam-flange cam-string'],
  ['cableGroove', 'cam-groove cam-cable'],
  ['stringGroove', 'cam-groove cam-string'],
  ['cablePitch', 'cam-pitch cam-cable'],
  ['stringPitch', 'cam-pitch cam-string'],
]);

const POST_NAMES = Object.freeze({
  'string-post': 'String post',
  'cable-post': 'Cable post',
  'cable-stop': 'Cable stop',
});

const MARK_NAMES = Object.freeze({
  'string-brace': 'String contact at brace',
  'cable-brace': 'Cable contact at brace',
  'full-draw': 'Contact at full draw',
});

/** Caption shown when the result has string outlines only. */
export const NO_CABLE_CAPTION = 'No cable track: see the results for the reason';
/** Placeholder shown while no result exists. */
export const SOLVING_TEXT = 'Solving…';
/** Caption shown when no result exists because the solver stopped with an error. */
export const ERROR_TEXT = 'No cam: the solver stopped with an error';
/** Caption shown over a stale drawing. */
export const STALE_CAPTION = 'Last cam that met every check; the current inputs fail the checks, see Results';
/** Caption shown over a stale drawing while the current inputs are being solved. */
export const BUSY_STALE_CAPTION = 'Last cam that met every check; solving the current inputs';
/** Caption shown over the current cam while newer inputs are being solved. */
export const PENDING_CAPTION = 'Cam of the previous inputs; solving the current inputs';
/** Caption shown over a stale drawing when the solver stopped with an error. */
export const ERROR_STALE_CAPTION = 'Last cam that met every check; the solver stopped with an error on the current inputs';
/**
 * Legend rows: label and swatch shape with its classes.
 * @type {readonly { label: string, shape: 'rect' | 'line' | 'dashed' | 'circle', cls: string }[]}
 */
const LEGEND = Object.freeze([
  { label: 'String track', shape: 'rect', cls: 'cam-flange cam-string' },
  { label: 'Cable track', shape: 'rect', cls: 'cam-flange cam-cable' },
  { label: 'Groove bottom (dashed)', shape: 'dashed', cls: 'cam-groove cam-string' },
  { label: 'Pitch line (thin)', shape: 'line', cls: 'cam-pitch cam-string' },
  { label: 'Post', shape: 'circle', cls: 'cam-post' },
  { label: 'Axle bore', shape: 'circle', cls: 'cam-bore' },
  { label: 'Timing mark', shape: 'line', cls: 'cam-mark' },
  { label: 'Contact point', shape: 'circle', cls: 'cam-contact' },
  { label: 'Lever arm (axle to cord)', shape: 'dashed', cls: 'cam-lever' },
  { label: 'Cord direction', shape: 'line', cls: 'cam-cord' },
]);

let legendCount = 0;

/**
 * Bounds of all outlines, the posts and the axle bore, in the cam frame.
 * @param {SolveResult} result
 * @param {number} boreRadius (m)
 * @returns {Bounds}
 */
export function outlineBounds(result, boreRadius) {
  const r = Number.isFinite(boreRadius) ? Math.max(boreRadius, 0) : 0;
  let minX = -r;
  let maxX = r;
  let minY = -r;
  let maxY = r;
  for (const [key] of LAYERS) {
    const o = result.outlines[key];
    if (!o) continue;
    for (let i = 0; i < o.x.length; i++) {
      const x = o.x[i];
      const y = o.y[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  for (const p of result.posts) {
    if (!finitePost(p)) continue;
    minX = Math.min(minX, p.x - p.radius);
    maxX = Math.max(maxX, p.x + p.radius);
    minY = Math.min(minY, p.y - p.radius);
    maxY = Math.max(maxY, p.y + p.radius);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * @param {Post} p
 */
function finitePost(p) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.radius) && p.radius > 0;
}

/**
 * @param {Mark} m
 */
function finiteMark(m) {
  return Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.nx) && Number.isFinite(m.ny);
}

/**
 * SVG path of a closed outline in the cam frame: 'M x y L x y … Z' with y
 * negated and numbers rounded to 1e-6 m. The repeated last point is left out
 * because Z closes the path. Points that are not finite are left out.
 * Empty string for fewer than two points.
 * @param {Outline} outline
 */
export function pathOf(outline) {
  const n = Math.min(outline.x.length, outline.y.length);
  /** @type {number[]} */
  const idx = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(outline.x[i]) && Number.isFinite(outline.y[i])) idx.push(i);
  const first = idx[0];
  const last = idx[idx.length - 1];
  if (idx.length > 2 && outline.x[last] === outline.x[first] && outline.y[last] === outline.y[first]) idx.pop();
  if (idx.length < 2) return '';
  const parts = idx.map((i, k) => `${k === 0 ? 'M' : 'L'} ${coord(outline.x[i])} ${coord(-outline.y[i])}`);
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Caption of a stale drawing for the solver status.
 * @param {string | undefined} status
 */
export function staleCaption(status) {
  if (status === 'error') return ERROR_STALE_CAPTION;
  if (status === 'busy') return BUSY_STALE_CAPTION;
  if (status === 'pending') return PENDING_CAPTION;
  return STALE_CAPTION;
}

/**
 * Accessible summary of the cam view.
 * @param {SolveResult | null} result
 * @param {'mm' | 'in'} dims
 */
export function camSummary(result, dims) {
  if (!result) return 'Cam view: solving';
  const d = result.metrics?.camMaxDimension;
  if (d === undefined || !Number.isFinite(d)) return 'Cam view';
  return `Cam view, largest dimension ${fixed(fromSI(d, 'length', dims), DIMS_DECIMALS[dims])} ${dims}`;
}

/**
 * Accessible label of the svg: the summary, the keys and, for a stale
 * drawing, a note that it is the last cam that met every check.
 * @param {SolveResult | null} result
 * @param {'mm' | 'in'} dims
 * @param {boolean} stale
 * @param {string} [status] 'error' when the solver stopped with an error, 'busy'
 *   while solving, 'pending' when the drawn cam belongs to older inputs
 */
export function camLabel(result, dims, stale, status) {
  const summary = !result && status === 'error' ? 'Cam view: no cam, the solver stopped with an error' : camSummary(result, dims);
  const turns = result ? ', turns with the draw position' : '';
  const note = !result || !stale ? '' : status === 'pending' ? ', cam of the previous inputs' : ', last cam that met every check';
  return `${summary}${turns}; ${KEYS_HELP}${note}`;
}

/**
 * Small swatch svg for a legend row.
 * @param {'rect' | 'line' | 'dashed' | 'circle'} shape
 * @param {string} cls
 */
function swatch(shape, cls) {
  const s = svg('svg', { class: 'camview-swatch', width: 24, height: 14, viewBox: '0 0 24 14', 'aria-hidden': 'true', focusable: 'false' });
  if (shape === 'rect') s.append(svg('rect', { class: cls, x: 2, y: 2, width: 20, height: 10, rx: 2 }));
  else if (shape === 'circle') s.append(svg('circle', { class: cls, cx: 12, cy: 7, r: 5 }));
  else s.append(svg('line', { class: cls, x1: 1, y1: 7, x2: 23, y2: 7, fill: 'none', 'stroke-dasharray': shape === 'dashed' ? '4 3' : null }));
  return s;
}


/**
 * Bounds of the cam turned by any angle: a square of the largest distance
 * of the outlines, the posts and the bore from the axle, so the fitted view
 * keeps its size while the cam turns.
 * @param {SolveResult} result
 * @param {number} boreRadius (m)
 * @returns {Bounds}
 */
export function radialBounds(result, boreRadius) {
  let r = Number.isFinite(boreRadius) ? Math.max(boreRadius, 0) : 0;
  for (const [key] of LAYERS) {
    const o = result.outlines[key];
    if (!o) continue;
    for (let i = 0; i < o.x.length; i++) {
      const d = Math.hypot(o.x[i], o.y[i]);
      if (d > r) r = d;
    }
  }
  for (const p of result.posts) {
    if (finitePost(p)) r = Math.max(r, Math.hypot(p.x, p.y) + p.radius);
  }
  return { minX: -r, maxX: r, minY: -r, maxY: r };
}

/**
 * Distance along the unit direction (ux, uy) from (x, y) to the circle of
 * radius r about the origin; 0 when the point lies outside it.
 * @param {number} x
 * @param {number} y
 * @param {number} ux
 * @param {number} uy
 * @param {number} r
 */
export function rayToCircle(x, y, ux, uy, r) {
  const b = x * ux + y * uy;
  const c = x * x + y * y - r * r;
  if (!(c < 0)) return 0;
  return -b + Math.sqrt(b * b - c);
}

/**
 * SVG transform of the cam turned by θ.
 * @param {number} theta (rad)
 */
export function rotorTransform(theta) {
  return Number.isFinite(theta) && theta !== 0 ? `rotate(${coord((theta * 180) / Math.PI)})` : '';
}

/**
 * Line under the cam view for a pose, for example "At 24.0 in: cam turned
 * 180.0°; lever arms: string 63.6 mm, cable 9.1 mm, ratio 7.0 : 1".
 * @param {BowPose} pose
 * @param {Units} units
 */
export function poseText(pose, units) {
  const ratio = pose.pS / pose.pC;
  const ratioText = Number.isFinite(ratio) && pose.pC > 0 ? `, ratio ${fixed(ratio, 1)} : 1` : '';
  return `At ${drawText(pose.x, units, true)} ${units.draw}: cam turned ${angleText(pose.theta)}; ` +
    `lever arms: string ${dimsText(pose.pS, units)}, cable ${dimsText(pose.pC, units)}${ratioText}`;
}

/**
 * @typedef {object} CamView
 * @property {(result: SolveResult | null, state: ProjectState, stale: boolean, status?: string) => void} render
 *   draw a result (null while solving or after a solver error, told apart by
 *   status); stale keeps the drawing, adds the class cam-stale and says so in
 *   the caption
 * @property {(pose: BowPose | null, units: Units) => void} setPose turn the cam
 *   and move the overlay; null shows the cam at brace without overlay
 * @property {() => void} destroy remove the elements and with them their listeners
 */

/**
 * Build the cam view inside a container: zoom controls, the svg, a legend,
 * the pose line and a caption.
 * @param {HTMLElement} container
 * @returns {CamView}
 */
export function createCamView(container) {
  const legendId = `camview-legend-${++legendCount}`;
  const root = svg('svg', {
    class: 'cam-view',
    'data-testid': 'cam-view',
    role: 'img',
    tabindex: 0,
    'aria-label': camLabel(null, 'mm', false),
    'aria-describedby': legendId,
    preserveAspectRatio: 'xMidYMid meet',
  });
  const rotor = svg('g', { class: 'cam-rotor', 'data-testid': 'cam-rotor', 'data-theta': 0 });
  const drawing = svg('g', { class: 'cam-drawing' });
  const overlay = svg('g', { class: 'cam-overlay', 'data-testid': 'cam-overlay', 'aria-hidden': 'true' });
  /** @param {string} cls @param {string} testid */
  const line = (cls, testid) => svg('line', { class: cls, 'data-testid': testid, 'vector-effect': 'non-scaling-stroke' });
  const leverS = line('cam-lever cam-string', 'cam-lever-string');
  const leverC = line('cam-lever cam-cable', 'cam-lever-cable');
  const cordS = line('cam-cord cam-string', 'cam-cord-string');
  const cordC = line('cam-cord cam-cable', 'cam-cord-cable');
  const dotS = svg('circle', { class: 'cam-contact cam-string', 'data-testid': 'cam-contact-string', 'vector-effect': 'non-scaling-stroke' });
  const dotC = svg('circle', { class: 'cam-contact cam-cable', 'data-testid': 'cam-contact-cable', 'vector-effect': 'non-scaling-stroke' });
  for (const l of [leverS, leverC]) l.setAttribute('stroke-dasharray', '4 3');
  overlay.append(leverS, leverC, cordS, cordC, dotS, dotC);
  overlay.style.display = 'none';
  rotor.append(drawing, overlay);
  root.append(rotor);
  const viewport = createViewport(root, { prefix: 'camview', label: 'Cam view zoom' });

  const poseLine = h('p', { class: 'camview-pose', 'data-testid': 'camview-pose' });
  poseLine.hidden = true;
  const caption = h('p', { class: 'camview-caption', 'data-testid': 'camview-caption', 'aria-live': 'polite' });
  caption.hidden = true;

  const legend = h(
    'ul',
    { class: 'camview-legend', id: legendId, 'data-testid': 'camview-legend', 'aria-label': 'Cam view legend' },
    ...LEGEND.map((row) => h('li', { class: 'camview-legend-item' }, swatch(row.shape, row.cls), row.label)),
  );
  container.append(viewport.controls, root, poseLine, legend, caption);

  /** Size of the fitted view (m), for dot radii and line lengths. */
  let size = 0.1;
  /** @type {BowPose | null} */
  let lastPose = null;
  /** @type {Units | null} */
  let lastUnits = null;
  let hasResult = false;

  /**
   * @param {SolveResult} result
   * @param {number} boreRadius
   */
  function draw(result, boreRadius) {
    /** @type {Element[]} */
    const els = [];
    for (const [key, cls] of LAYERS) {
      const o = result.outlines[key];
      if (!o) continue;
      const d = pathOf(o);
      if (!d) continue;
      /** @type {import('./dom.js').Attrs} */
      const attrs = { class: cls, d, 'vector-effect': 'non-scaling-stroke', 'data-testid': `cam-${key}` };
      if (!cls.startsWith('cam-flange')) attrs.fill = 'none';
      if (cls.startsWith('cam-groove')) attrs['stroke-dasharray'] = '4 3';
      els.push(svg('path', attrs));
    }
    if (boreRadius > 0) {
      els.push(
        svg('circle', { class: 'cam-bore', cx: 0, cy: 0, r: boreRadius, 'vector-effect': 'non-scaling-stroke', 'data-testid': 'cam-bore' }),
      );
    }
    for (const p of result.posts) {
      if (!finitePost(p)) continue;
      const c = svg('circle', {
        class: 'cam-post',
        cx: coord(p.x),
        cy: coord(-p.y),
        r: p.radius,
        'vector-effect': 'non-scaling-stroke',
        'data-id': p.id,
        'data-testid': `cam-post-${p.id}`,
      });
      const t = svg('title');
      t.textContent = POST_NAMES[p.id] ?? p.id;
      c.append(t);
      els.push(c);
    }
    const L = 0.035 * size;
    for (const m of result.marks) {
      if (!finiteMark(m)) continue;
      const g = svg('path', {
        class: 'cam-mark',
        d: `M ${coord(m.x - 0.5 * L * m.nx)} ${coord(-(m.y - 0.5 * L * m.ny))} L ${coord(m.x + L * m.nx)} ${coord(-(m.y + L * m.ny))}`,
        fill: 'none',
        'vector-effect': 'non-scaling-stroke',
        'data-id': m.id,
        'data-testid': `cam-mark-${m.id}`,
      });
      const t = svg('title');
      t.textContent = MARK_NAMES[m.id] ?? m.id;
      g.append(t);
      els.push(g);
    }
    drawing.replaceChildren(...els);
  }

  /**
   * @param {BowPose | null} pose
   * @param {Units} units
   */
  function setPose(pose, units) {
    lastPose = pose;
    lastUnits = units;
    const ok = hasResult && pose !== null && Number.isFinite(pose.theta);
    const theta = ok ? /** @type {BowPose} */ (pose).theta : 0;
    const transform = rotorTransform(theta);
    if (rotor.getAttribute('transform') !== (transform || null)) setAttrs(rotor, { transform: transform || null });
    rotor.setAttribute('data-theta', String(theta));
    if (!ok) {
      overlay.style.display = 'none';
      poseLine.hidden = true;
      return;
    }
    const p = /** @type {BowPose} */ (pose);
    overlay.style.display = '';
    const r = 0.012 * size;
    const reach = 0.45 * size;
    const footS = [p.pS * Math.cos(p.psiS), p.pS * Math.sin(p.psiS)];
    const footC = [p.pC * Math.cos(p.psiC), p.pC * Math.sin(p.psiC)];
    setAttrs(leverS, { x1: 0, y1: 0, x2: coord(footS[0]), y2: coord(-footS[1]) });
    setAttrs(leverC, { x1: 0, y1: 0, x2: coord(footC[0]), y2: coord(-footC[1]) });
    // Cord directions in the cam frame, tangent at the contact: the string
    // towards the nock, the cable towards the anchor.
    // Each line ends inside the fitted view: at the circle that the square
    // view box encloses.
    const edge = size / 2;
    const lenS = Math.min(Math.max(p.spanS, 0), reach, rayToCircle(p.stringCamX, p.stringCamY, Math.sin(p.psiS), -Math.cos(p.psiS), edge));
    const lenC = Math.min(Math.max(p.spanC, 0), reach, rayToCircle(p.cableCamX, p.cableCamY, -Math.sin(p.psiC), Math.cos(p.psiC), edge));
    const us = [Math.sin(p.psiS), -Math.cos(p.psiS)];
    const uc = [-Math.sin(p.psiC), Math.cos(p.psiC)];
    setAttrs(cordS, {
      x1: coord(p.stringCamX), y1: coord(-p.stringCamY),
      x2: coord(p.stringCamX + lenS * us[0]), y2: coord(-(p.stringCamY + lenS * us[1])),
    });
    setAttrs(cordC, {
      x1: coord(p.cableCamX), y1: coord(-p.cableCamY),
      x2: coord(p.cableCamX + lenC * uc[0]), y2: coord(-(p.cableCamY + lenC * uc[1])),
    });
    setAttrs(dotS, { cx: coord(p.stringCamX), cy: coord(-p.stringCamY), r });
    setAttrs(dotC, { cx: coord(p.cableCamX), cy: coord(-p.cableCamY), r });
    const text = poseText(p, units);
    if (poseLine.textContent !== text) poseLine.textContent = text;
    poseLine.hidden = false;
  }

  /**
   * @param {SolveResult | null} result
   * @param {ProjectState} state
   * @param {boolean} stale
   * @param {string} [status] 'error', 'busy' or 'pending' (see camLabel)
   */
  function render(result, state, stale, status) {
    const dims = state.units.dims;
    viewport.setUnit(dims);
    const isStale = Boolean(stale) && result !== null;
    const error = !result && status === 'error';
    root.classList.toggle('cam-stale', isStale);
    setAttrs(root, { 'aria-label': camLabel(result, dims, isStale, status), 'aria-busy': result || error ? null : 'true' });
    hasResult = result !== null;
    if (!result) {
      drawing.replaceChildren();
      caption.textContent = error ? ERROR_TEXT : SOLVING_TEXT;
      caption.hidden = false;
      viewport.clear();
      setPose(null, state.units);
      return;
    }
    const bore = state.body.boreDiameter / 2;
    const boreRadius = Number.isFinite(bore) && bore > 0 ? bore : 0;
    const base = viewBoxFor(radialBounds(result, boreRadius), FIT_PADDING);
    size = base.size;
    viewport.setBase(base);
    draw(result, boreRadius);
    const o = result.outlines;
    const noCable = !o.cablePitch && !o.cableGroove && !o.cableFlange;
    const lines = [isStale ? staleCaption(status) : '', noCable ? NO_CABLE_CAPTION : ''].filter(Boolean);
    caption.textContent = lines.join('. ');
    caption.hidden = lines.length === 0;
    setPose(lastPose, lastUnits ?? state.units);
  }

  function destroy() {
    viewport.destroy();
    root.remove();
    poseLine.remove();
    legend.remove();
    caption.remove();
  }

  return { render, setPose, destroy };
}
