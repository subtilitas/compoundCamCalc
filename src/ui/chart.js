/**
 * Force curve chart: SVG axes, target curve and draggable control points.
 * Pointer Events with pointer capture for mouse, pen and touch; one drag is
 * one undo entry. Points are focusable buttons moved with the arrow keys;
 * a keyboard move reports the new position, or why it was refused, in the
 * status line.
 * @module ui/chart
 */

import { MAX_FORCE, MIN_FORCE, MIN_GAP, movePoint } from '../core/curve.js';
import { createCurve } from '../core/interp.js';
import { AMO_OFFSET, fromSI, toSI } from '../core/units.js';
import { DRAW_STEP, FORCE_STEP, amo, fixed, plain, pointLabel } from './display.js';
import { h, setAttrs, svg } from './dom.js';

/** @typedef {import('./editor.js').Editor} Editor */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */

/** Radius of the pointer hit area around a point: 22 px (44 px target). */
export const HIT_RADIUS = 22;
const MARGIN = Object.freeze({ left: 58, right: 24, top: 30, bottom: 56 });

/**
 * Round step of 1, 2 or 5 times a power of ten, nearest to raw.
 * @param {number} raw
 */
export function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

/**
 * Round tick values on [lo, hi].
 * @param {number} lo
 * @param {number} hi
 * @param {number} count wanted number of intervals
 * @returns {{ values: number[], step: number, decimals: number }}
 */
export function ticks(lo, hi, count) {
  const step = niceStep((hi - lo) / Math.max(count, 1));
  const values = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9 * step; k++) values.push(k * step);
  return { values, step, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

/**
 * Why an arrow key cannot move point i (fully or at all).
 * @param {number} i
 * @param {number} last index of the full-draw point
 * @param {string} key
 * @param {Units} units
 */
export function moveLimitMessage(i, last, key, units) {
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (i === last) return 'The full-draw point moves only up and down';
    const gap = `${plain(fromSI(MIN_GAP, 'length', units.draw), 3)} ${units.draw}`;
    return `Point ${i + 1} stays at least ${gap} from point ${key === 'ArrowLeft' ? i : i + 2}`;
  }
  const u = units.force;
  return `Forces stay between ${plain(fromSI(MIN_FORCE, 'force', u), 4)} ${u} and ${plain(fromSI(MAX_FORCE, 'force', u), 4)} ${u}`;
}

/**
 * @typedef {object} Layout
 * @property {number} W
 * @property {number} H
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 * @property {number} yMax (N)
 * @property {(x: number) => number} px
 * @property {(F: number) => number} py
 * @property {(px: number) => number} xOf
 * @property {(py: number) => number} fOf
 */

/**
 * @param {HTMLElement} wrap container of the chart
 * @param {Editor} editor
 * @returns {{ render: (state: ProjectState) => void }}
 */
export function createChart(wrap, editor) {
  const store = editor.store;
  const root = svg('svg', {
    class: 'chart',
    'data-testid': 'force-chart',
    role: 'group',
    'aria-label': 'Force curve chart',
    'aria-describedby': 'chart-help',
  });
  const plotBg = svg('rect', { class: 'chart-bg' });
  const grid = svg('g', { class: 'chart-grid', 'aria-hidden': 'true' });
  const refs = svg('g', { class: 'chart-refs', 'aria-hidden': 'true' });
  const curvePath = svg('path', { class: 'chart-curve', 'aria-hidden': 'true' });
  const axes = svg('g', { class: 'chart-axes', 'aria-hidden': 'true' });
  const pointLayer = svg('g', { class: 'chart-points' });
  // Copy of the selected point drawn above all points, so a neighbour never
  // covers it; the focusable points keep their order.
  const selectedMark = svg('g', {
    class: 'pt pt-mark selected',
    'aria-hidden': 'true',
    'pointer-events': 'none',
    'data-testid': 'chart-selected-mark',
  });
  selectedMark.append(svg('circle', { class: 'pt-ring', r: 11 }), svg('circle', { class: 'pt-dot', r: 6.5 }));
  root.append(plotBg, grid, refs, curvePath, axes, pointLayer, selectedMark);
  const readout = h('div', { class: 'chart-readout', 'data-testid': 'chart-readout', 'aria-hidden': 'true' });
  readout.hidden = true;
  wrap.append(root, readout);

  /** @type {Layout | null} */
  let layout = null;
  /** @type {number | null} */
  let frozenYMax = null;
  /**
   * Active drag: start of the pointer in client coordinates and of the point
   * in model units (m, N). Moves follow the pointer displacement at the
   * current scale, so neither a layout shift nor a change of the chart
   * width during the drag moves the point sideways.
   * @type {{ index: number, pointerId: number, cx: number, cy: number, x0: number, F0: number, moved: boolean } | null}
   */
  let drag = null;
  let lastPointerType = 'mouse';
  /** @type {ProjectState} */
  let state = store.getState();
  /** @type {SVGGElement[]} */
  let pointEls = [];

  /**
   * @param {ProjectState} s
   * @returns {Layout}
   */
  function computeLayout(s) {
    const W = Math.max(Math.round(wrap.clientWidth), 200);
    const H = Math.round(Math.min(460, Math.max(260, W * 0.62)));
    const pts = s.curve.points;
    const xb = pts[0].x;
    const xf = pts[pts.length - 1].x;
    const left = MARGIN.left;
    const right = W - MARGIN.right;
    const top = MARGIN.top;
    const bottom = H - MARGIN.bottom;
    const ym = frozenYMax ?? 1.15 * Math.max(...pts.map((p) => p.F), 10);
    return {
      W, H, left, right, top, bottom, yMax: ym,
      px: (x) => left + ((x - xb) / (xf - xb)) * (right - left),
      py: (F) => bottom - (F / ym) * (bottom - top),
      xOf: (p) => xb + ((p - left) / (right - left)) * (xf - xb),
      fOf: (q) => ((bottom - q) / (bottom - top)) * ym,
    };
  }

  /**
   * @param {SVGElement} parent
   * @param {keyof SVGElementTagNameMap} tag
   * @param {import('./dom.js').Attrs} attrs
   * @param {string} [text]
   */
  function add(parent, tag, attrs, text) {
    const el = svg(tag, attrs);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  }

  /**
   * @param {ProjectState} s
   * @param {Layout} L
   */
  function renderAxes(s, L) {
    grid.replaceChildren();
    axes.replaceChildren();
    refs.replaceChildren();
    const { units } = s;
    const pts = s.curve.points;
    const xb = pts[0].x;
    const xf = pts[pts.length - 1].x;
    setAttrs(plotBg, { x: L.left, y: L.top, width: L.right - L.left, height: L.bottom - L.top });

    const xt = ticks(amo(xb, units), amo(xf, units), Math.max(3, Math.round((L.right - L.left) / 70)));
    for (const v of xt.values) {
      const X = L.px(toSI(v, 'length', units.draw) - AMO_OFFSET);
      add(grid, 'line', { x1: X, x2: X, y1: L.top, y2: L.bottom });
      add(axes, 'text', { x: X, y: L.bottom + 18, 'text-anchor': 'middle', class: 'tick' }, fixed(v, xt.decimals));
    }
    const yDisplayMax = fromSI(L.yMax, 'force', units.force);
    const yt = ticks(0, yDisplayMax, Math.max(3, Math.round((L.bottom - L.top) / 55)));
    for (const v of yt.values) {
      const Y = L.py(toSI(v, 'force', units.force));
      add(grid, 'line', { x1: L.left, x2: L.right, y1: Y, y2: Y });
      add(axes, 'text', { x: L.left - 8, y: Y + 4, 'text-anchor': 'end', class: 'tick' }, fixed(v, yt.decimals));
    }
    add(axes, 'line', { class: 'axis', x1: L.left, x2: L.right, y1: L.bottom, y2: L.bottom });
    add(axes, 'line', { class: 'axis', x1: L.left, x2: L.left, y1: L.top, y2: L.bottom });
    add(axes, 'text', {
      class: 'axis-title', x: (L.left + L.right) / 2, y: L.H - 12, 'text-anchor': 'middle', 'data-testid': 'axis-x-label',
    }, `Draw length (AMO), ${units.draw}`);
    const cy = (L.top + L.bottom) / 2;
    add(axes, 'text', {
      class: 'axis-title', x: 16, y: cy, 'text-anchor': 'middle', transform: `rotate(-90 16 ${cy})`, 'data-testid': 'axis-y-label',
    }, `Draw force, ${units.force}`);

    for (const [x, label, anchor, dx] of /** @type {const} */ ([[xb, 'Brace', 'start', 4], [xf, 'Full draw', 'end', -4]])) {
      const X = L.px(x);
      add(refs, 'line', { class: 'ref', x1: X, x2: X, y1: L.top - 6, y2: L.bottom });
      add(refs, 'text', { class: 'ref-label', x: X + dx, y: L.top - 10, 'text-anchor': anchor }, label);
    }
  }

  /**
   * @param {ProjectState} s
   * @param {Layout} L
   */
  function renderCurve(s, L) {
    const pts = s.curve.points;
    const curve = createCurve(pts);
    const n = Math.max(100, Math.round((L.right - L.left) / 2));
    const { x, F } = curve.sample(n);
    let d = '';
    for (let j = 0; j < n; j++) d += `${j === 0 ? 'M' : 'L'}${L.px(x[j]).toFixed(1)},${L.py(F[j]).toFixed(1)}`;
    curvePath.setAttribute('d', d);
  }

  /**
   * @param {number} i
   * @param {number} last
   */
  function makePoint(i, last) {
    const g = svg('g', { class: 'pt', 'data-index': i, 'data-testid': `chart-point-${i + 1}` });
    if (i === 0) {
      g.classList.add('pt-locked');
      g.setAttribute('aria-hidden', 'true');
    } else {
      setAttrs(g, { tabindex: 0, role: 'button' });
      g.append(svg('circle', { class: 'pt-hit', r: HIT_RADIUS }));
    }
    if (i === last) g.classList.add('pt-last');
    g.append(svg('circle', { class: 'pt-ring', r: 11 }), svg('circle', { class: 'pt-dot', r: i === 0 ? 5 : 6.5 }));
    return g;
  }

  /**
   * @param {ProjectState} s
   * @param {Layout} L
   */
  function renderPoints(s, L) {
    const pts = s.curve.points;
    const last = pts.length - 1;
    if (pointEls.length !== pts.length) {
      pointEls = pts.map((_, i) => makePoint(i, last));
      pointLayer.replaceChildren(...pointEls);
    }
    const selected = editor.selected();
    pts.forEach((p, i) => {
      const g = pointEls[i];
      g.setAttribute('transform', `translate(${L.px(p.x).toFixed(2)} ${L.py(p.F).toFixed(2)})`);
      g.classList.toggle('selected', i === selected);
      if (i > 0) {
        const where = i === last ? `Point ${i + 1}, full draw` : `Point ${i + 1}`;
        const how = i === last ? 'Up and down arrow keys change its force.' : 'Arrow keys move it.';
        g.setAttribute('aria-label', `${where}: ${pointLabel(p, s.units)}. ${how}`);
      }
    });
    if (selected > 0 && selected < pts.length) {
      const p = pts[selected];
      selectedMark.setAttribute('transform', `translate(${L.px(p.x).toFixed(2)} ${L.py(p.F).toFixed(2)})`);
      selectedMark.style.display = '';
    } else {
      selectedMark.style.display = 'none';
    }
    const focus = editor.takeFocusRequest();
    if (focus > 0 && pointEls[focus]) pointEls[focus].focus({ preventScroll: true });
  }

  /** @param {number} i */
  function showReadout(i) {
    const p = state.curve.points[i];
    if (!layout || !p) return;
    readout.textContent = `Point ${i + 1}: ${pointLabel(p, state.units)}`;
    readout.hidden = false;
    const half = readout.offsetWidth / 2;
    const X = Math.min(Math.max(layout.px(p.x), half + 2), layout.W - half - 2);
    readout.style.left = `${X}px`;
    // Above the point, higher during a touch drag so the finger does not
    // cover it; the label's bottom edge sits at top and stays in the chart.
    const lift = drag && lastPointerType === 'touch' ? 48 : 16;
    readout.style.top = `${Math.max(layout.py(p.F) - lift, readout.offsetHeight)}px`;
  }

  /** @param {ProjectState} s */
  function render(s) {
    state = s;
    layout = computeLayout(s);
    setAttrs(root, { width: layout.W, height: layout.H, viewBox: `0 0 ${layout.W} ${layout.H}` });
    renderAxes(s, layout);
    renderCurve(s, layout);
    renderPoints(s, layout);
    if (!readout.hidden) {
      const active = drag ? drag.index : pointEls.indexOf(/** @type {SVGGElement} */ (document.activeElement));
      if (active > 0) showReadout(active);
      else readout.hidden = true;
    }
  }

  /** @param {MouseEvent} e */
  function local(e) {
    const r = root.getBoundingClientRect();
    const W = layout ? layout.W : r.width;
    const H = layout ? layout.H : r.height;
    return { x: ((e.clientX - r.left) * W) / (r.width || 1), y: ((e.clientY - r.top) * H) / (r.height || 1) };
  }

  /**
   * Nearest point within the hit radius, or −1.
   * @param {MouseEvent} e
   * @param {boolean} [includeBrace]
   */
  function nearest(e, includeBrace = false) {
    const L = layout;
    if (!L) return -1;
    const { x, y } = local(e);
    let best = -1;
    let bestDist = HIT_RADIUS;
    state.curve.points.forEach((p, i) => {
      if (i === 0 && !includeBrace) return;
      const d = Math.hypot(L.px(p.x) - x, L.py(p.F) - y);
      if (d <= bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }

  /** @param {boolean} commit */
  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    frozenYMax = null;
    delete root.dataset.dragging;
    if (root.hasPointerCapture(d.pointerId)) root.releasePointerCapture(d.pointerId);
    if (commit) store.commitTransaction();
    else store.cancelTransaction();
    readout.hidden = true;
    render(store.getState());
  }

  root.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    if (e.button !== 0 || drag) return;
    const i = nearest(e);
    if (i < 1 || !layout) return;
    e.preventDefault();
    pointEls[i].focus({ preventScroll: true });
    editor.select(i);
    const p = state.curve.points[i];
    drag = { index: i, pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, x0: p.x, F0: p.F, moved: false };
    frozenYMax = layout.yMax;
    root.setPointerCapture(e.pointerId);
    store.beginTransaction();
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId || !layout) return;
    const r = root.getBoundingClientRect();
    const dx = ((e.clientX - drag.cx) * layout.W) / (r.width || layout.W);
    const dy = ((e.clientY - drag.cy) * layout.H) / (r.height || layout.H);
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    root.dataset.dragging = 'true';
    // The y scale is frozen during the drag: the force stops at its top.
    const F = Math.min(layout.fOf(layout.py(drag.F0) + dy), layout.yMax);
    editor.move(drag.index, { x: layout.xOf(layout.px(drag.x0) + dx), F });
    showReadout(drag.index);
  });

  root.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
  });
  root.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  });
  root.addEventListener('lostpointercapture', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
  });

  root.addEventListener('contextmenu', (e) => {
    const i = nearest(e);
    if (i < 1) return;
    e.preventDefault();
    // A long press on a touch screen opens the context menu; it must not delete.
    if (lastPointerType === 'touch' || drag) return;
    editor.remove(i);
  });

  root.addEventListener('dblclick', (e) => {
    if (!layout || nearest(e, true) >= 0) return;
    const { x, y } = local(e);
    if (x < layout.left || x > layout.right || y < layout.top || y > layout.bottom) return;
    editor.add(layout.xOf(x), Math.max(layout.fOf(y), MIN_FORCE));
  });

  pointLayer.addEventListener('focusin', (e) => {
    const i = pointEls.indexOf(/** @type {SVGGElement} */ (e.target));
    if (i > 0) editor.select(i);
  });
  pointLayer.addEventListener('focusout', () => {
    if (!drag) readout.hidden = true;
  });

  pointLayer.addEventListener('keydown', (e) => {
    const i = pointEls.indexOf(/** @type {SVGGElement} */ (e.target));
    if (i < 1 || e.altKey || e.ctrlKey || e.metaKey) return;
    const { units, curve } = store.getState();
    const p = curve.points[i];
    const k = e.shiftKey ? 10 : 1;
    const dx = toSI(DRAW_STEP[units.draw] * k, 'length', units.draw);
    const dF = toSI(FORCE_STEP[units.force] * k, 'force', units.force);
    const last = curve.points.length - 1;
    /** @type {{ x?: number, F?: number }} */
    let target;
    switch (e.key) {
      case 'ArrowLeft':
        target = { x: p.x - dx };
        break;
      case 'ArrowRight':
        target = { x: p.x + dx };
        break;
      case 'ArrowUp':
        target = { F: p.F + dF };
        break;
      case 'ArrowDown':
        target = { F: p.F - dF };
        break;
      case 'Delete':
      case 'Backspace':
        editor.remove(i, true);
        e.preventDefault();
        return;
      case 'Insert':
      case '+': {
        const j = i < last ? i : i - 1;
        editor.add(0.5 * (curve.points[j].x + curve.points[j + 1].x));
        e.preventDefault();
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    const q = movePoint(curve.points, i, target)[i];
    const limit = moveLimitMessage(i, last, e.key, units);
    if (q.x === p.x && q.F === p.F) {
      // Refused: nothing changes, so nothing is dispatched.
      editor.say(limit);
    } else {
      editor.move(i, target);
      const clamped = (target.x !== undefined && q.x !== target.x) || (target.F !== undefined && q.F !== target.F);
      editor.say(`Point ${i + 1}: ${pointLabel(q, units)}${clamped ? `; ${limit}` : ''}`);
    }
    showReadout(i);
  });

  // Re-render on width changes only: the height follows the width, so
  // reacting to height changes would feed back into the observer.
  let observedWidth = -1;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[entries.length - 1].contentRect.width);
    if (width === observedWidth) return;
    observedWidth = width;
    requestAnimationFrame(() => render(store.getState()));
  }).observe(wrap);
  return { render };
}
