/**
 * Zoom and pan of a square SVG drawing: zoom buttons, the + and - keys, and
 * the wheel with Ctrl or Cmd held (a trackpad pinch sends Ctrl); the wheel
 * alone scrolls the page. Pan while zoomed: drag, or the arrow keys (Shift:
 * larger steps). The 0 key fits the drawing to the view. A scale bar in the
 * lower left corner gives a round length in the dimension unit.
 *
 * Drawings use metres with y up; the SVG user space is the same with y
 * down, so every y is negated when drawn. The view is a square box in SVG
 * user space; the zoom is the ratio of the fitted box to the visible box.
 * @module ui/viewport
 */

import { fromSI, toSI } from '../core/units.js';
import { plain } from './display.js';
import { h, setAttrs, svg } from './dom.js';

/**
 * @typedef {object} Bounds
 * @property {number} minX (m, y up)
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
/** Keyboard help appended to the accessible label of a drawing. */
export const KEYS_HELP = 'arrow keys pan, plus and minus zoom, 0 fits';
/** Arrow-key pan step as a fraction of the visible size (Shift: PAN_STEP_LARGE). */
export const PAN_STEP = 0.1;
export const PAN_STEP_LARGE = 0.5;

/**
 * Square SVG view box around bounds (y up), centred on them, with padding
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
 * Coordinate text rounded to 1e-6 m.
 * @param {number} v
 */
export function coord(v) {
  const r = Math.round(v * 1e6) / 1e6;
  return String(r === 0 ? 0 : r);
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
 * @typedef {object} Viewport
 * @property {HTMLDivElement} controls the zoom button group
 * @property {(next: ViewBox) => void} setBase new fitted box; a zoomed view
 *   keeps its zoom and centre
 * @property {(target: ViewBox) => void} show zoom to a box inside the fitted box
 * @property {(unit: 'mm' | 'in') => void} setUnit unit of the scale bar
 * @property {() => void} clear no drawing: zoom and pan are off until the
 *   next setBase, which fits the view
 * @property {() => ViewBox} view the visible box
 * @property {() => number} zoom
 * @property {() => void} destroy
 */

/**
 * Attach zoom and pan to a square svg. The zoom buttons are returned in
 * `controls` for the caller to place; the scale bar is appended to the svg.
 * Test ids and labels start with `prefix`. `extra` buttons join the zoom
 * group after Fit.
 * @param {SVGSVGElement} root
 * @param {{ prefix: string, label: string, extra?: HTMLButtonElement[] }} options
 * @returns {Viewport}
 */
export function createViewport(root, { prefix, label, extra = [] }) {
  const scale = svg('g', { class: 'cam-scale', 'data-testid': `${prefix}-scale`, 'aria-hidden': 'true' });
  const scaleLine = svg('path', { class: 'cam-scale-bar', fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  const scaleText = svg('text', { class: 'cam-scale-label' });
  scale.append(scaleLine, scaleText);
  root.append(scale);

  /**
   * @param {string} text
   * @param {string} testid
   * @param {string} content
   */
  const button = (text, testid, content) =>
    h('button', { type: 'button', class: 'camview-btn', 'aria-label': text, title: text, 'data-testid': testid }, content);
  const zoomIn = button('Zoom in', `${prefix}-zoom-in`, '+');
  const zoomOut = button('Zoom out', `${prefix}-zoom-out`, '−');
  const fit = button('Fit to view', `${prefix}-fit`, 'Fit');
  const controls = /** @type {HTMLDivElement} */ (h('div', { class: 'camview-controls', role: 'group', 'aria-label': label }, zoomIn, zoomOut, fit, ...extra));

  /** @type {ViewBox} */
  let base = viewBoxFor({ minX: -0.05, maxX: 0.05, minY: -0.05, maxY: 0.05 }, FIT_PADDING);
  /** @type {ViewBox} */
  let view = base;
  /** @type {'mm' | 'in'} */
  let unit = 'mm';
  /** @type {{ pointerId: number, x: number, y: number, view: ViewBox, k: number } | null} */
  let pan = null;
  /** A drawing exists; without one the view cannot zoom or pan. */
  let drawn = false;

  const zoom = () => base.size / view.size;

  function applyView() {
    setAttrs(root, { viewBox: `${view.x} ${view.y} ${view.size} ${view.size}` });
    const z = zoom();
    zoomIn.disabled = !drawn || z >= MAX_ZOOM - 1e-9;
    zoomOut.disabled = !drawn || z <= 1 + 1e-9;
    fit.disabled = !drawn || (zoomOut.disabled && view.x === base.x && view.y === base.y);
    for (const b of extra) b.disabled = !drawn;
    root.classList.toggle('cam-zoomed', z > 1 + 1e-9);
    root.style.touchAction = z > 1 + 1e-9 ? 'none' : 'auto';
    drawScale();
  }

  function drawScale() {
    const bar = niceLength(view.size / 5, unit);
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
    if (!drawn || e.altKey || e.ctrlKey || e.metaKey) return;
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
      if (!drawn || (!e.ctrlKey && !e.metaKey)) return;
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

  /** @param {ViewBox} next */
  function setBase(next) {
    // The first drawing after an empty view is fitted.
    const zoomed = drawn && (zoom() > 1 + 1e-9 || view.x !== base.x || view.y !== base.y);
    drawn = true;
    if (zoomed) {
      // Keep the zoom and the centre of the view while the drawing changes.
      const z = zoom();
      const size = next.size / z;
      const cx = view.x + view.size / 2;
      const cy = view.y + view.size / 2;
      view = clampView({ x: cx - size / 2, y: cy - size / 2, size }, next);
    } else {
      view = next;
    }
    base = next;
    applyView();
  }

  /** @param {ViewBox} target */
  function show(target) {
    view = clampView(target, base);
    applyView();
  }

  applyView();
  return {
    controls,
    setBase,
    show,
    clear() {
      drawn = false;
      pan = null;
      view = base;
      applyView();
    },
    setUnit(u) {
      if (u === unit) return;
      unit = u;
      drawScale();
    },
    view: () => view,
    zoom,
    destroy() {
      pan = null;
      controls.remove();
      scale.remove();
    },
  };
}
