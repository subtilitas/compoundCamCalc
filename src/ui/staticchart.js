/**
 * Static force chart for print: the target and the achieved draw force of
 * a solve against the draw, with axes in the display units and lines at
 * brace and full draw. The chart has a fixed size and a view box, no ids
 * and no listeners, so any number of copies can share a page.
 * @module ui/staticchart
 */

import { AMO_OFFSET, fromSI, toSI } from '../core/units.js';
import { amo, fixed } from './display.js';
import { svg } from './dom.js';
import { achievedPath, forceTop, ticks } from './chart.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').Units} Units */

/** Size of the chart in user units (px at 1:1). */
export const STATIC_SIZE = Object.freeze({ width: 640, height: 340 });

const MARGIN = Object.freeze({ left: 58, right: 24, top: 44, bottom: 48 });

/**
 * @typedef {object} StaticTick
 * @property {number} at position along its axis (px)
 * @property {string} text value in the display unit
 */

/**
 * @typedef {object} StaticChartModel
 * @property {number} width (px)
 * @property {number} height (px)
 * @property {string} viewBox
 * @property {{ left: number, right: number, top: number, bottom: number }} plot edges (px)
 * @property {StaticTick[]} xTicks
 * @property {StaticTick[]} yTicks
 * @property {string} xTitle
 * @property {string} yTitle
 * @property {string[]} target polyline point lists of the target curve
 * @property {string[]} achieved polyline point lists of the achieved curve
 * @property {{ at: number, label: string }[]} refs brace and full draw (px)
 * @property {string} label accessible name
 */

/**
 * Geometry of the static force chart of a result, or null when the result
 * has no target curve.
 * @param {Pick<SolveResult, 'target' | 'achieved'>} result
 * @param {Units} units
 * @returns {StaticChartModel | null}
 */
export function staticChartModel(result, units) {
  const target = result.target;
  if (!target || target.x.length < 2) return null;
  const { width, height } = STATIC_SIZE;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = MARGIN.top;
  const bottom = height - MARGIN.bottom;
  const xBrace = target.x[0];
  const xFull = target.x[target.x.length - 1];
  const x0 = amo(xBrace, units);
  const x1 = amo(xFull, units);
  const yMax = fromSI(forceTop(target.F, result.achieved?.F), 'force', units.force);
  const scales = { units, x0, x1, yMax, left, right, top, bottom };
  const px = (/** @type {number} */ x) => left + ((amo(x, units) - x0) / (x1 - x0)) * (right - left);
  const xt = ticks(x0, x1, Math.max(3, Math.round((right - left) / 70)));
  const yt = ticks(0, yMax, Math.max(3, Math.round((bottom - top) / 55)));
  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    plot: { left, right, top, bottom },
    xTicks: xt.values.map((v) => ({ at: px(toSI(v, 'length', units.draw) - AMO_OFFSET), text: fixed(v, xt.decimals) })),
    yTicks: yt.values.map((v) => ({ at: bottom - (v / yMax) * (bottom - top), text: fixed(v, yt.decimals) })),
    xTitle: `Draw length (AMO), ${units.draw}`,
    yTitle: `Draw force, ${units.force}`,
    target: achievedPath(target, scales),
    achieved: result.achieved ? achievedPath(result.achieved, scales) : [],
    refs: [{ at: px(xBrace), label: 'Brace' }, { at: px(xFull), label: 'Full draw' }],
    label: `Force chart: target and achieved draw force from ${fixed(x0, 1)} to ${fixed(x1, 1)} ${units.draw} (AMO)`,
  };
}

/**
 * Build the svg of a static chart model.
 * @param {StaticChartModel} m
 * @returns {SVGSVGElement}
 */
export function staticChartSvg(m) {
  const root = svg('svg', {
    class: 'chart static-chart', width: m.width, height: m.height, viewBox: m.viewBox, role: 'img', 'aria-label': m.label,
  });
  const { left, right, top, bottom } = m.plot;
  /**
   * @param {Element} parent
   * @param {keyof SVGElementTagNameMap} tag
   * @param {import('./dom.js').Attrs} attrs
   * @param {string} [text]
   */
  const add = (parent, tag, attrs, text) => {
    const el = svg(tag, attrs);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  };
  add(root, 'rect', { class: 'chart-bg', x: left, y: top, width: right - left, height: bottom - top });
  const grid = add(root, 'g', { class: 'chart-grid', 'aria-hidden': 'true' });
  const axes = add(root, 'g', { class: 'chart-axes', 'aria-hidden': 'true' });
  for (const t of m.xTicks) {
    add(grid, 'line', { x1: t.at, x2: t.at, y1: top, y2: bottom });
    add(axes, 'text', { x: t.at, y: bottom + 18, 'text-anchor': 'middle', class: 'tick' }, t.text);
  }
  for (const t of m.yTicks) {
    add(grid, 'line', { x1: left, x2: right, y1: t.at, y2: t.at });
    add(axes, 'text', { x: left - 8, y: t.at + 4, 'text-anchor': 'end', class: 'tick' }, t.text);
  }
  add(axes, 'line', { class: 'axis', x1: left, x2: right, y1: bottom, y2: bottom });
  add(axes, 'line', { class: 'axis', x1: left, x2: left, y1: top, y2: bottom });
  add(axes, 'text', { class: 'axis-title', x: (left + right) / 2, y: m.height - 10, 'text-anchor': 'middle' }, m.xTitle);
  const cy = (top + bottom) / 2;
  add(axes, 'text', { class: 'axis-title', x: 16, y: cy, 'text-anchor': 'middle', transform: `rotate(-90 16 ${cy})` }, m.yTitle);
  const refs = add(root, 'g', { class: 'chart-refs', 'aria-hidden': 'true' });
  m.refs.forEach((r, i) => {
    add(refs, 'line', { class: 'ref', x1: r.at, x2: r.at, y1: top - 6, y2: bottom });
    add(refs, 'text', { class: 'ref-label', x: r.at + (i === 0 ? 4 : -4), y: top - 10, 'text-anchor': i === 0 ? 'start' : 'end' }, r.label);
  });
  const lines = add(root, 'g', { 'aria-hidden': 'true', fill: 'none' });
  for (const points of m.target) add(lines, 'polyline', { class: 'chart-curve', points });
  for (const points of m.achieved) add(lines, 'polyline', { class: 'static-achieved', points, 'stroke-dasharray': '7 5' });
  // Legend in the top margin, between the reference labels.
  const legend = add(root, 'g', { class: 'chart-axes', 'aria-hidden': 'true' });
  const mid = (left + right) / 2;
  add(legend, 'line', { class: 'chart-curve', x1: mid - 150, x2: mid - 122, y1: 12, y2: 12 });
  add(legend, 'text', { x: mid - 116, y: 16 }, 'Target');
  add(legend, 'line', { class: 'static-achieved', x1: mid - 40, x2: mid - 12, y1: 12, y2: 12, 'stroke-dasharray': '7 5' });
  add(legend, 'text', { x: mid - 6, y: 16 }, 'Achieved');
  return root;
}
