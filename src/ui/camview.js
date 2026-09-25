/**
 * Cam view: SVG drawing of both tracks in the cam frame, with fit-to-view,
 * a legend and a scale bar. Zoom: the buttons, the + and - keys, and the
 * wheel with Ctrl or Cmd held (a trackpad pinch sends Ctrl); the wheel alone
 * scrolls the page. Pan while zoomed: drag, or the arrow keys (Shift: larger
 * steps). The 0 key fits the drawing to the view.
 *
 * The cam frame has metres with y up; the SVG user space is the same with y
 * down, so every y is negated when drawn. The view is a square box in SVG
 * user space; the zoom is the ratio of the fitted box to the visible box.
 * @module ui/camview
 */

import { fromSI, toSI } from '../core/units.js';
import { DIMS_DECIMALS, fixed, plain } from './display.js';
import { h, setAttrs, svg } from './dom.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/solve.js').Outline} Outline */
/** @typedef {import('../core/solve.js').Post} Post */
/** @typedef {import('../core/solve.js').Mark} Mark */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */

/**
 * @typedef {object} Bounds
 * @property {number} minX cam frame (m)
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 */

/**
 * Square box in SVG user space (m, y down).
 * @typedef {object} ViewBox
 * @property {number} x left edge
 * @property {number} y top edge
 * @property {number} size width and height
 */

/** Padding around the fitted drawing, as a fraction of its larger side. */
export const FIT_PADDING = 0.08;
/** Zoom factor of one button press. */
export const ZOOM_STEP = 1.5;
/** Largest zoom relative to the fitted view. */
export const MAX_ZOOM = 8;
/** Smallest side of a fitted view (m), so an empty drawing still has a box. */
const MIN_SIZE = 1e-3;

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
/** Caption shown over a stale drawing when the solver stopped with an error. */
export const ERROR_STALE_CAPTION = 'Last cam that met every check; the solver stopped with an error on the current inputs';
/** Keyboard help appended to the accessible label of the svg. */
export const KEYS_HELP = 'arrow keys pan, plus and minus zoom, 0 fits';
/** Arrow-key pan step as a fraction of the visible size (Shift: PAN_STEP_LARGE). */
export const PAN_STEP = 0.1;
export const PAN_STEP_LARGE = 0.5;

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
 * Square SVG view box around cam-frame bounds, centred on them, with padding
 * on every side as a fraction of the larger side. The y axis is flipped.
 * @param {Bounds} bounds
 * @param {number} padding fraction of the larger side, e.g. 0.08
 * @returns {ViewBox}
 */
export function viewBoxFor(bounds, padding) {
  const side = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, MIN_SIZE);
  const size = side * (1 + 2 * padding);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = -(bounds.minY + bounds.maxY) / 2;
  return { x: cx - size / 2, y: cy - size / 2, size };
}

/**
 * Largest round length (1, 2 or 5 × 10^k in the unit) not longer than
 * maxMetres, for a scale bar. A limit that is not positive and finite gives
 * 1 of the unit.
 * @param {number} maxMetres (m), positive
 * @param {'mm' | 'in' | 'cm' | 'm'} unit
 * @returns {{ metres: number, label: string }}
 */
export function niceLength(maxMetres, unit) {
  const u = fromSI(maxMetres, 'length', unit);
  if (!(u > 0) || !Number.isFinite(u)) return { metres: toSI(1, 'length', unit), label: `1 ${unit}` };
  const p = 10 ** Math.floor(Math.log10(u) + 1e-9);
  const f = u / p;
  const m = f >= 5 - 1e-9 ? 5 : f >= 2 - 1e-9 ? 2 : 1;
  const value = Number((m * p).toPrecision(1));
  return { metres: toSI(value, 'length', unit), label: `${plain(value)} ${unit}` };
}

/**
 * @param {number} v
 */
function coord(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return String(r === 0 ? 0 : r);
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
 * Keep a view inside the fitted box and its zoom between 1 and MAX_ZOOM.
 * @param {ViewBox} view
 * @param {ViewBox} base fitted box
 * @returns {ViewBox}
 */
export function clampView(view, base) {
  const size = Math.min(base.size, Math.max(base.size / MAX_ZOOM, view.size));
  const x = Math.min(base.x + base.size - size, Math.max(base.x, view.x));
  const y = Math.min(base.y + base.size - size, Math.max(base.y, view.y));
  return { x, y, size };
}

/**
 * Zoom a view by a factor about a point given as a fraction of the view
 * (0 = left or top, 1 = right or bottom); the point stays under the pointer
 * unless the result is clamped.
 * @param {ViewBox} view
 * @param {ViewBox} base fitted box
 * @param {number} factor >1 zooms in
 * @param {number} fx
 * @param {number} fy
 * @returns {ViewBox}
 */
export function zoomView(view, base, factor, fx, fy) {
  const size = Math.min(base.size, Math.max(base.size / MAX_ZOOM, view.size / factor));
  const px = view.x + fx * view.size;
  const py = view.y + fy * view.size;
  return clampView({ x: px - fx * size, y: py - fy * size, size }, base);
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
 * @param {string} [status] 'error' when the solver stopped with an error
 */
export function camLabel(result, dims, stale, status) {
  const summary = !result && status === 'error' ? 'Cam view: no cam, the solver stopped with an error' : camSummary(result, dims);
  return `${summary}; ${KEYS_HELP}${result && stale ? ', last cam that met every check' : ''}`;
}

/**
 * Move a view by fractions of its size and keep it inside the fitted box.
 * @param {ViewBox} view
 * @param {ViewBox} base fitted box
 * @param {number} fx fraction of the view size to the right
 * @param {number} fy fraction of the view size down
 * @returns {ViewBox}
 */
export function panView(view, base, fx, fy) {
  return clampView({ x: view.x + fx * view.size, y: view.y + fy * view.size, size: view.size }, base);
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
 * Build the cam view inside a container: zoom controls, the svg, a legend
 * and a caption. render() draws a result (null while solving or after a
 * solver error, told apart by status); stale keeps the drawing, adds the
 * class cam-stale and says so in the caption. destroy() removes the four
 * elements and with them their listeners.
 * @param {HTMLElement} container
 * @returns {{ render: (result: SolveResult | null, state: ProjectState, stale: boolean, status?: string) => void, destroy: () => void }}
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
  const drawing = svg('g', { class: 'cam-drawing' });
  const scale = svg('g', { class: 'cam-scale', 'data-testid': 'camview-scale', 'aria-hidden': 'true' });
  const scaleLine = svg('path', { class: 'cam-scale-bar', fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  const scaleText = svg('text', { class: 'cam-scale-label' });
  scale.append(scaleLine, scaleText);
  root.append(drawing, scale);

  const caption = h('p', { class: 'camview-caption', 'data-testid': 'camview-caption', 'aria-live': 'polite' });
  caption.hidden = true;

  const legend = h(
    'ul',
    { class: 'camview-legend', id: legendId, 'data-testid': 'camview-legend', 'aria-label': 'Cam view legend' },
    ...LEGEND.map((row) => h('li', { class: 'camview-legend-item' }, swatch(row.shape, row.cls), row.label)),
  );

  /**
   * @param {string} label
   * @param {string} testid
   * @param {string} text
   */
  const button = (label, testid, text) =>
    h('button', { type: 'button', class: 'camview-btn', 'aria-label': label, title: label, 'data-testid': testid }, text);
  const zoomIn = button('Zoom in', 'camview-zoom-in', '+');
  const zoomOut = button('Zoom out', 'camview-zoom-out', '−');
  const fit = button('Fit to view', 'camview-fit', 'Fit');
  const controls = h('div', { class: 'camview-controls', role: 'group', 'aria-label': 'Cam view zoom' }, zoomIn, zoomOut, fit);
  container.append(controls, root, legend, caption);

  /** @type {ViewBox} */
  let base = viewBoxFor({ minX: -0.05, maxX: 0.05, minY: -0.05, maxY: 0.05 }, FIT_PADDING);
  /** @type {ViewBox} */
  let view = base;
  /** @type {'mm' | 'in'} */
  let dims = 'mm';
  /** @type {{ pointerId: number, x: number, y: number, view: ViewBox, k: number } | null} */
  let pan = null;

  const zoom = () => base.size / view.size;

  function applyView() {
    setAttrs(root, { viewBox: `${view.x} ${view.y} ${view.size} ${view.size}` });
    const z = zoom();
    zoomIn.disabled = z >= MAX_ZOOM - 1e-9;
    zoomOut.disabled = z <= 1 + 1e-9;
    fit.disabled = zoomOut.disabled && view.x === base.x && view.y === base.y;
    root.classList.toggle('cam-zoomed', z > 1 + 1e-9);
    root.style.touchAction = z > 1 + 1e-9 ? 'none' : 'auto';
    drawScale();
  }

  function drawScale() {
    const bar = niceLength(view.size / 5, dims);
    const x0 = view.x + 0.05 * view.size;
    const y0 = view.y + 0.94 * view.size;
    const tick = 0.015 * view.size;
    setAttrs(scaleLine, {
      d: `M ${x0} ${y0 - tick} L ${x0} ${y0} L ${x0 + bar.metres} ${y0} L ${x0 + bar.metres} ${y0 - tick}`,
    });
    setAttrs(scaleText, { x: x0, y: y0 - 1.6 * tick, 'font-size': 0.035 * view.size });
    scaleText.textContent = bar.label;
    scale.setAttribute('data-length', String(bar.metres));
  }

  /**
   * @param {number} factor
   * @param {number} fx
   * @param {number} fy
   */
  function zoomBy(factor, fx = 0.5, fy = 0.5) {
    view = zoomView(view, base, factor, fx, fy);
    applyView();
  }

  function fitView() {
    view = base;
    applyView();
  }

  /**
   * Run a button action; when the button had focus and disables itself,
   * move focus to an enabled sibling instead of losing it to the body.
   * @param {HTMLButtonElement} btn
   * @param {() => void} action
   */
  function press(btn, action) {
    const hadFocus = document.activeElement === btn;
    action();
    if (!hadFocus || !btn.disabled) return;
    const next = btn === zoomIn ? [zoomOut, fit] : [zoomIn, zoomOut, fit];
    const target = next.find((b) => !b.disabled);
    if (target) target.focus();
    else root.focus();
  }

  zoomIn.addEventListener('click', () => press(zoomIn, () => zoomBy(ZOOM_STEP)));
  zoomOut.addEventListener('click', () => press(zoomOut, () => zoomBy(1 / ZOOM_STEP)));
  fit.addEventListener('click', () => press(fit, fitView));

  root.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? PAN_STEP_LARGE : PAN_STEP;
    /** @type {Record<string, [number, number]>} */
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = arrows[e.key];
    if (move) {
      if (zoom() <= 1 + 1e-9) return;
      view = panView(view, base, move[0], move[1]);
      applyView();
    } else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP);
    else if (e.key === '0') fitView();
    else return;
    e.preventDefault();
  });

  /**
   * Pointer position as a fraction of the square view box, and SVG user
   * units per client pixel, for preserveAspectRatio xMidYMid meet.
   * @param {number} clientX
   * @param {number} clientY
   */
  function locate(clientX, clientY) {
    const rect = root.getBoundingClientRect();
    const side = Math.min(rect.width, rect.height) || 1;
    const left = rect.left + (rect.width - side) / 2;
    const top = rect.top + (rect.height - side) / 2;
    return {
      fx: Math.min(1, Math.max(0, (clientX - left) / side)),
      fy: Math.min(1, Math.max(0, (clientY - top) / side)),
      k: view.size / side,
    };
  }

  root.addEventListener(
    'wheel',
    (e) => {
      // Only Ctrl or Cmd with the wheel zooms, so the page scrolls otherwise.
      if (!e.ctrlKey && !e.metaKey) return;
      const factor = e.deltaY < 0 ? ZOOM_STEP ** 0.5 : e.deltaY > 0 ? ZOOM_STEP ** -0.5 : 1;
      const { fx, fy } = locate(e.clientX, e.clientY);
      // At a zoom limit the gesture still must not zoom the page.
      e.preventDefault();
      const next = zoomView(view, base, factor, fx, fy);
      if (next.size === view.size) return;
      view = next;
      applyView();
    },
    { passive: false },
  );

  root.addEventListener('pointerdown', (e) => {
    if (zoom() <= 1 + 1e-9 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, view, k: locate(e.clientX, e.clientY).k };
    root.setPointerCapture(e.pointerId);
    root.classList.add('cam-panning');
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!pan || e.pointerId !== pan.pointerId) return;
    const start = pan.view;
    view = clampView(
      { x: start.x - (e.clientX - pan.x) * pan.k, y: start.y - (e.clientY - pan.y) * pan.k, size: start.size },
      base,
    );
    applyView();
  });
  /** @param {PointerEvent} e */
  const endPan = (e) => {
    if (!pan || e.pointerId !== pan.pointerId) return;
    pan = null;
    root.classList.remove('cam-panning');
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  };
  root.addEventListener('pointerup', endPan);
  root.addEventListener('pointercancel', endPan);
  root.addEventListener('lostpointercapture', endPan);

  /**
   * @param {SolveResult} result
   * @param {number} boreRadius
   * @param {number} size fitted view size, for tick lengths
   */
  function draw(result, boreRadius, size) {
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
   * @param {SolveResult | null} result
   * @param {ProjectState} state
   * @param {boolean} stale
   * @param {string} [status] 'error' when the solver stopped with an error
   */
  function render(result, state, stale, status) {
    dims = state.units.dims;
    const isStale = Boolean(stale) && result !== null;
    const error = !result && status === 'error';
    root.classList.toggle('cam-stale', isStale);
    setAttrs(root, { 'aria-label': camLabel(result, dims, isStale, status), 'aria-busy': result || error ? null : 'true' });
    if (!result) {
      drawing.replaceChildren();
      caption.textContent = error ? ERROR_TEXT : SOLVING_TEXT;
      caption.hidden = false;
      applyView();
      return;
    }
    const bore = state.body.boreDiameter / 2;
    const boreRadius = Number.isFinite(bore) && bore > 0 ? bore : 0;
    const nextBase = viewBoxFor(outlineBounds(result, boreRadius), FIT_PADDING);
    const zoomed = zoom() > 1 + 1e-9 || view.x !== base.x || view.y !== base.y;
    if (zoomed) {
      // Keep the zoom and the centre of the view while the cam changes.
      const z = zoom();
      const size = nextBase.size / z;
      const cx = view.x + view.size / 2;
      const cy = view.y + view.size / 2;
      view = clampView({ x: cx - size / 2, y: cy - size / 2, size }, nextBase);
    } else {
      view = nextBase;
    }
    base = nextBase;
    draw(result, boreRadius, base.size);
    const o = result.outlines;
    const noCable = !o.cablePitch && !o.cableGroove && !o.cableFlange;
    const lines = [isStale ? (status === 'error' ? ERROR_STALE_CAPTION : STALE_CAPTION) : '', noCable ? NO_CABLE_CAPTION : ''].filter(Boolean);
    caption.textContent = lines.join('. ');
    caption.hidden = lines.length === 0;
    applyView();
  }

  function destroy() {
    pan = null;
    controls.remove();
    root.remove();
    legend.remove();
    caption.remove();
  }

  applyView();
  return { render, destroy };
}
