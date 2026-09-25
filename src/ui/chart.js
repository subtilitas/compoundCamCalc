/**
 * Force curve chart: SVG axes, target curve and draggable control points.
 * Pointer Events with pointer capture for mouse, pen and touch; one drag is
 * one undo entry. Points are focusable buttons moved with the arrow keys;
 * a keyboard move reports the new position, or why it was refused, in the
 * status line. An optional overlay draws the achieved curve of the last
 * solve (dashed) and the draw ranges named by its diagnostics (bands).
 * The legend sits in the plot where it covers the fewest curve samples.
 * @module ui/chart
 */

import { MAX_FORCE, MIN_FORCE, MIN_GAP, movePoint } from '../core/curve.js';
import { CODES } from '../core/diagnostics.js';
import { createCurve } from '../core/interp.js';
import { AMO_OFFSET, fromSI, toSI } from '../core/units.js';
import { DRAW_STEP, FORCE_STEP, amo, drawText, fixed, plain, pointLabel } from './display.js';
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
 * Achieved curve of a solve drawn over the target.
 * @typedef {object} AchievedOverlay
 * @property {ArrayLike<number>} x nock positions (m), as in result.achieved.x
 * @property {ArrayLike<number>} F draw force (N), as in result.achieved.F
 * @property {{ from: number, to: number, code: string }[]} ranges draw ranges
 *   of diagnostics (m), from their xRange
 * @property {boolean} stale true when the curve does not belong to the
 *   current inputs: a newer solve is running, or the curve is the last one
 *   that met every check shown in place of a failing result
 * @property {string} [label] legend text of the achieved curve; default
 *   'Achieved'
 */

/**
 * Chart mapping in display units: x is the draw length at the arrow
 * measurement offset (AMO) in units.draw, y the force in units.force.
 * @typedef {object} ChartScales
 * @property {import('../state/schema.js').Units} units
 * @property {number} x0 AMO draw at the left edge of the plot (units.draw)
 * @property {number} x1 AMO draw at the right edge of the plot (units.draw)
 * @property {number} yMax force at the top of the plot (units.force)
 * @property {number} left plot left edge (px)
 * @property {number} right plot right edge (px)
 * @property {number} top plot top edge (px)
 * @property {number} bottom plot bottom edge (px)
 */

/**
 * Polyline point lists of the achieved curve in chart pixels, one list per
 * run of finite samples: a sample with a non-finite position or force splits
 * the curve. Runs of a single sample are left out, since they draw nothing.
 * @param {Pick<AchievedOverlay, 'x' | 'F'>} overlay samples in SI units (m, N)
 * @param {ChartScales} scales
 * @returns {string[]} values for the points attribute of each polyline
 */
export function achievedPath(overlay, scales) {
  return achievedRuns(overlay, scales).map((run) => run.map(([X, Y]) => `${X.toFixed(1)},${Y.toFixed(1)}`).join(' '));
}

/**
 * Runs of finite samples of the achieved curve in chart pixels, as in
 * achievedPath but as [x, y] pairs.
 * @param {Pick<AchievedOverlay, 'x' | 'F'>} overlay samples in SI units (m, N)
 * @param {ChartScales} scales
 * @returns {[number, number][][]}
 */
function achievedRuns(overlay, scales) {
  const { units, x0, x1, yMax, left, right, top, bottom } = scales;
  const sx = (right - left) / (x1 - x0);
  const sy = (bottom - top) / yMax;
  const n = Math.min(overlay.x.length, overlay.F.length);
  /** @type {[number, number][][]} */
  const runs = [];
  /** @type {[number, number][]} */
  let run = [];
  const flush = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  for (let j = 0; j < n; j++) {
    const X = left + (amo(overlay.x[j], units) - x0) * sx;
    const Y = bottom - fromSI(overlay.F[j], 'force', units.force) * sy;
    if (Number.isFinite(X) && Number.isFinite(Y)) run.push([X, Y]);
    else flush();
  }
  flush();
  return runs;
}

/**
 * Force at the top of the plot (N): 15 % above the largest target force and
 * 5 % above the largest finite achieved force, at least 11.5 N. The achieved
 * curve therefore never leaves the plot at the top.
 * @param {ArrayLike<number>} targetF forces of the target points (N)
 * @param {ArrayLike<number> | null} [achievedF] achieved forces (N)
 * @returns {number}
 */
export function forceTop(targetF, achievedF = null) {
  let top = 11.5;
  for (let j = 0; j < targetF.length; j++) if (Number.isFinite(targetF[j])) top = Math.max(top, 1.15 * targetF[j]);
  if (achievedF) {
    for (let j = 0; j < achievedF.length; j++) if (Number.isFinite(achievedF[j])) top = Math.max(top, 1.05 * achievedF[j]);
  }
  return top;
}

/**
 * Tooltip text of a diagnostic range band: the condition of the code from
 * CODES, capitalised, and the range as AMO draw lengths in display units,
 * for example "The string tension of the achieved cam is zero or negative
 * between 20.0 in and 28.0 in". An unknown code stands for itself.
 * @param {{ from: number, to: number, code: string }} range (m)
 * @param {Units} units
 * @returns {string}
 */
export function rangeTitle(range, units) {
  const text = /** @type {Record<string, string>} */ (CODES)[range.code] ?? range.code;
  const condition = text.charAt(0).toUpperCase() + text.slice(1);
  const a = drawText(Math.min(range.from, range.to), units, true);
  const b = drawText(Math.max(range.from, range.to), units, true);
  return a === b
    ? `${condition} at ${a} ${units.draw}`
    : `${condition} between ${a} ${units.draw} and ${b} ${units.draw}`;
}

/**
 * Box of the legend in the plot: the candidate with the fewest samples
 * inside, in the order bottom middle, bottom right, bottom left, top right,
 * top left; the first one wins a tie. The box keeps a 6 px gap to the plot
 * edges and stays inside the plot when it is wider or taller than the plot.
 * @param {{ left: number, right: number, top: number, bottom: number }} plot (px)
 * @param {number} w box width (px)
 * @param {number} h box height (px)
 * @param {ReadonlyArray<readonly [number, number]>} samples curve samples (px)
 * @returns {{ x: number, y: number }} top left corner of the box (px)
 */
export function legendPosition(plot, w, h, samples) {
  const pad = 6;
  const clampX = (/** @type {number} */ x) => Math.max(plot.left, Math.min(x, plot.right - w));
  const clampY = (/** @type {number} */ y) => Math.max(plot.top, Math.min(y, plot.bottom - h));
  const xl = clampX(plot.left + pad);
  const xr = clampX(plot.right - pad - w);
  const xm = clampX((plot.left + plot.right - w) / 2);
  const yt = clampY(plot.top + pad);
  const yb = clampY(plot.bottom - pad - h);
  const candidates = [
    { x: xm, y: yb }, { x: xr, y: yb }, { x: xl, y: yb }, { x: xr, y: yt }, { x: xl, y: yt },
  ];
  let best = candidates[0];
  let bestCount = Infinity;
  for (const c of candidates) {
    let count = 0;
    for (const [X, Y] of samples) if (X >= c.x && X <= c.x + w && Y >= c.y && Y <= c.y + h) count++;
    if (count < bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Split a legend label into lines of at most maxChars characters at spaces;
 * a word longer than maxChars stays whole on its own line.
 * @param {string} label
 * @param {number} maxChars
 * @returns {string[]}
 */
export function wrapLabel(label, maxChars) {
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of label.split(' ')) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
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

let clipCount = 0;

/**
 * @typedef {object} Chart
 * @property {(state: ProjectState) => void} render redraw for a state
 * @property {(overlay: AchievedOverlay | null) => void} setAchieved show the
 *   achieved curve and diagnostic ranges, or hide them with null
 */

/**
 * @param {HTMLElement} wrap container of the chart
 * @param {Editor} editor
 * @returns {Chart}
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
  // Overlay layers never take pointer events, so points stay draggable.
  const clipId = `chart-plot-clip-${++clipCount}`;
  const clipRect = svg('rect');
  const clip = svg('clipPath', { id: clipId });
  clip.append(clipRect);
  const defs = svg('defs');
  defs.append(clip);
  const rangeLayer = svg('g', { class: 'chart-ranges', 'aria-hidden': 'true', 'clip-path': `url(#${clipId})`, 'pointer-events': 'none' });
  const achievedLayer = svg('g', {
    class: 'chart-achieved',
    'data-testid': 'chart-achieved',
    'aria-hidden': 'true',
    'clip-path': `url(#${clipId})`,
    'pointer-events': 'none',
    fill: 'none',
    'stroke-width': 2,
    'stroke-dasharray': '7 5',
    'stroke-linejoin': 'round',
    style: 'stroke: var(--chart-achieved, var(--chart-point-selected))',
  });
  const legend = svg('g', { class: 'chart-legend', 'data-testid': 'chart-legend', 'pointer-events': 'none' });
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
  root.append(defs, plotBg, grid, rangeLayer, refs, curvePath, achievedLayer, axes, legend, pointLayer, selectedMark);
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
  /** @type {AchievedOverlay | null} */
  let overlay = null;
  /**
   * Target curve samples of the last render (px), for the legend placement.
   * @type {[number, number][]}
   */
  let curveSamples = [];

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
    const ym = frozenYMax ?? forceTop(pts.map((p) => p.F), overlay?.F);
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
    curveSamples = [];
    for (let j = 0; j < n; j++) {
      const X = L.px(x[j]);
      const Y = L.py(F[j]);
      curveSamples.push([X, Y]);
      d += `${j === 0 ? 'M' : 'L'}${X.toFixed(1)},${Y.toFixed(1)}`;
    }
    curvePath.setAttribute('d', d);
  }

  /**
   * Achieved curve, diagnostic ranges and legend.
   * @param {ProjectState} s
   * @param {Layout} L
   */
  function renderOverlay(s, L) {
    const { units } = s;
    const pts = s.curve.points;
    setAttrs(clipRect, { x: L.left, y: L.top, width: L.right - L.left, height: L.bottom - L.top });
    rangeLayer.replaceChildren();
    achievedLayer.replaceChildren();
    /** @type {[number, number][]} */
    const samples = [...curveSamples];
    achievedLayer.classList.toggle('chart-achieved-stale', !!overlay?.stale);
    achievedLayer.setAttribute('opacity', overlay?.stale ? '0.45' : '1');
    if (overlay) {
      for (const r of overlay.ranges) {
        const a = L.px(Math.min(r.from, r.to));
        const b = L.px(Math.max(r.from, r.to));
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const band = add(rangeLayer, 'rect', {
          class: 'chart-range',
          'data-testid': 'chart-range',
          'data-code': r.code,
          x: a.toFixed(1),
          y: L.top,
          // At least 2 px wide so a range at one draw position stays visible.
          width: Math.max(b - a, 2).toFixed(1),
          height: L.bottom - L.top,
          'fill-opacity': 0.14,
          style: 'fill: var(--chart-range, var(--chart-point-selected))',
        });
        add(band, 'title', {}, rangeTitle(r, units));
      }
      const scales = {
        units,
        x0: amo(pts[0].x, units),
        x1: amo(pts[pts.length - 1].x, units),
        yMax: fromSI(L.yMax, 'force', units.force),
        left: L.left, right: L.right, top: L.top, bottom: L.bottom,
      };
      for (const run of achievedRuns(overlay, scales)) {
        add(achievedLayer, 'polyline', { points: run.map(([X, Y]) => `${X.toFixed(1)},${Y.toFixed(1)}`).join(' ') });
        samples.push(...run);
      }
    }

    legend.replaceChildren();
    /** @typedef {{ label: string, kind: 'target' | 'achieved' | 'range' }} LegendItem */
    /** @type {LegendItem[]} */
    const items = [{ label: 'Target', kind: 'target' }];
    if (overlay) items.push({ label: overlay.label ?? 'Achieved', kind: 'achieved' });
    if (overlay && overlay.ranges.length > 0) items.push({ label: 'Problem range', kind: 'range' });
    const rowH = 18;
    // Width from the longest label at about 6.6 px per character (12 px
    // font); labels wrap to the width of the plot.
    const maxChars = Math.max(8, Math.floor((L.right - L.left - 52) / 6.6));
    const lines = items.map((it) => wrapLabel(it.label, maxChars));
    const boxW = 52 + Math.ceil(6.6 * Math.max(...lines.flat().map((l) => l.length)));
    const boxH = lines.flat().length * rowH + 8;
    const { x, y } = legendPosition(L, boxW, boxH, samples);
    add(legend, 'rect', {
      class: 'chart-legend-bg', x, y, width: boxW, height: boxH, rx: 4,
      'fill-opacity': 0.85, style: 'fill: var(--chart-bg); stroke: var(--chart-grid)',
    });
    let row = 0;
    items.forEach(({ kind }, k) => {
      const cy = y + 4 + rowH * row + rowH / 2;
      if (kind === 'range') {
        add(legend, 'rect', {
          class: 'chart-legend-range', x: x + 8, y: cy - 6, width: 28, height: 12,
          'fill-opacity': 0.14, style: 'fill: var(--chart-range, var(--chart-point-selected))',
        });
      } else {
        const dash = kind === 'achieved' ? '7 5' : null;
        add(legend, 'line', {
          class: `chart-legend-${kind}`,
          x1: x + 8, x2: x + 36, y1: cy, y2: cy,
          'stroke-width': dash ? 2 : 2.5, 'stroke-dasharray': dash,
          style: dash ? 'stroke: var(--chart-achieved, var(--chart-point-selected))' : 'stroke: var(--chart-curve)',
        });
      }
      const text = add(legend, 'text', {
        x: x + 44, y: cy + 4, 'font-size': 12, style: 'fill: var(--chart-axis)',
        'data-testid': `chart-legend-${kind}`,
      });
      lines[k].forEach((line, j) => {
        add(text, 'tspan', { x: x + 44, dy: j === 0 ? 0 : rowH }, j < lines[k].length - 1 ? `${line} ` : line);
      });
      row += lines[k].length;
    });
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
    renderOverlay(s, layout);
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

  /** @param {AchievedOverlay | null} next */
  function setAchieved(next) {
    overlay = next;
    // Full redraw: the y scale follows the achieved peak (except during a
    // drag, where it stays frozen).
    if (layout) render(state);
  }
  return { render, setAchieved };
}
