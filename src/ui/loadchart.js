/**
 * Loads chart: string tension, the tension of each power cable and the load
 * on each limb tip against the draw, with the draw position as a vertical
 * line. Under the chart: the values at the draw position, the largest value
 * of each series with its draw position, and a table of the loads at 10 %
 * steps of the draw.
 * @module ui/loadchart
 */

import { bowPoseAt, createBowPose } from '../core/layout.js';
import { AMO_OFFSET, fromSI, toSI } from '../core/units.js';
import { amo, angleText, drawText, fixed, forceText } from './display.js';
import { h, setAttrs, svg } from './dom.js';
import { ticks } from './chart.js';
import { ageCaption, loadDirection } from './stringplan.js';

/** @typedef {import('../core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../core/layout.js').BowPose} BowPose */
/** @typedef {import('../state/schema.js').Units} Units */

const MARGIN = Object.freeze({ left: 58, right: 24, top: 16, bottom: 48 });

/** The three series: key in the load series, name, class and dash pattern. */
export const SERIES = Object.freeze(/** @type {const} */ ([
  { key: 'Ts', name: 'String tension', cls: 'load-string', dash: null },
  { key: 'Tc', name: 'Cable tension, each cable', cls: 'load-cable', dash: '6 4' },
  { key: 'axleLoad', name: 'Load on each limb tip', cls: 'load-axle', dash: '2 3 8 3' },
]));

/**
 * Force range of the plot (N): from the smallest load or 0 to 10 % above
 * the largest load.
 * @param {LayoutContext['loads']} loads
 * @returns {{ lo: number, hi: number }}
 */
export function loadRange(loads) {
  const max = Math.max(loads.maxTs.value, loads.maxTc.value, loads.maxAxle.value);
  const hi = Number.isFinite(max) && max > 0 ? 1.1 * max : 1;
  const lo = Number.isFinite(loads.min) && loads.min < 0 ? 1.1 * loads.min : 0;
  return { lo, hi };
}

/**
 * Polyline point lists of one series in chart pixels, split where a value
 * is not finite.
 * @param {ArrayLike<number>} x (m)
 * @param {ArrayLike<number>} y (N)
 * @param {(x: number) => number} px
 * @param {(y: number) => number} py
 * @returns {string[]}
 */
export function seriesRuns(x, y, px, py) {
  /** @type {string[]} */
  const runs = [];
  /** @type {string[]} */
  let run = [];
  const flush = () => {
    if (run.length > 1) runs.push(run.join(' '));
    run = [];
  };
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const X = px(x[i]);
    const Y = py(y[i]);
    if (Number.isFinite(X) && Number.isFinite(Y)) run.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
    else flush();
  }
  flush();
  return runs;
}

/**
 * Rows of the load table at 0 %, 10 % … 100 % of the draw from brace to
 * full draw. A position past the last solved sample has no values.
 * @param {LayoutContext} ctx
 * @returns {{ fraction: number, pose: BowPose | null }[]}
 */
export function tableRows(ctx) {
  /** @type {{ fraction: number, pose: BowPose | null }[]} */
  const rows = [];
  for (let k = 0; k <= 10; k++) {
    const fraction = k / 10;
    const x = k === 10 ? ctx.xFull : ctx.xBrace + fraction * (ctx.xFull - ctx.xBrace);
    const pose = createBowPose();
    const ok = bowPoseAt(ctx, x, pose) && !pose.beyondSolution;
    rows.push({ fraction, pose: ok ? pose : null });
  }
  return rows;
}

/**
 * @typedef {object} LoadChart
 * @property {(ctx: LayoutContext | null, units: Units, stale: boolean, outdated?: boolean) => void} render
 *   draw the loads of a layout; the same layout, units and stale flag again do nothing
 * @property {(pose: BowPose | null, units: Units) => void} setPose move the marker and the readout
 */

/**
 * Build the loads chart inside a container.
 * @param {HTMLElement} container
 * @returns {LoadChart}
 */
export function createLoadChart(container) {
  const root = svg('svg', { class: 'chart load-chart', 'data-testid': 'load-chart', role: 'img', 'aria-label': 'Loads chart: no cam yet' });
  const bg = svg('rect', { class: 'chart-bg' });
  const grid = svg('g', { class: 'chart-grid', 'aria-hidden': 'true' });
  const axes = svg('g', { class: 'chart-axes', 'aria-hidden': 'true' });
  const lines = svg('g', { class: 'load-lines', 'aria-hidden': 'true', fill: 'none' });
  const marker = svg('g', { class: 'chart-marker', 'data-testid': 'load-marker', 'aria-hidden': 'true' });
  const markerLine = svg('line', { class: 'chart-marker-line' });
  const dots = SERIES.map((s) => svg('circle', { class: `load-dot ${s.cls}`, r: 4 }));
  marker.append(markerLine, ...dots);
  marker.style.display = 'none';
  root.append(bg, grid, lines, axes, marker);

  const legend = h(
    'ul',
    { class: 'camview-legend', 'data-testid': 'load-legend', 'aria-label': 'Loads chart legend' },
    ...SERIES.map((s) => {
      const sw = svg('svg', { class: 'camview-swatch', width: 28, height: 14, viewBox: '0 0 28 14', 'aria-hidden': 'true', focusable: 'false' });
      sw.append(svg('line', { class: `load-line ${s.cls}`, x1: 1, y1: 7, x2: 27, y2: 7, 'stroke-dasharray': s.dash }));
      return h('li', { class: 'camview-legend-item' }, sw, s.name);
    }),
  );
  const now = h('dl', { class: 'results-metrics load-now', 'data-testid': 'load-readout' });
  const peaksHeading = h('h3', { class: 'load-heading' }, 'Largest loads');
  const peaks = h('dl', { class: 'results-metrics load-peaks', 'data-testid': 'load-peaks' });
  const tbody = h('tbody');
  const thead = h('thead');
  const table = h('details', { class: 'point-table load-table', 'data-testid': 'load-table' },
    h('summary', {}, 'Load table'),
    h('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Load table, scrolls sideways' },
      h('table', {}, h('caption', { class: 'visually-hidden' }, 'Loads at 10 % steps of the draw'), thead, tbody)));
  const caption = h('p', { class: 'camview-caption', 'data-testid': 'load-caption', 'aria-live': 'polite' });
  caption.hidden = true;
  container.append(root, legend, now, peaksHeading, peaks, table, caption);

  /** @type {LayoutContext | null} */
  let ctx = null;
  /** @type {Units | null} */
  let units = null;
  let stale = false;
  let key = '';
  /** @type {{ W: number, H: number, px: (x: number) => number, py: (F: number) => number, top: number, bottom: number } | null} */
  let layout = null;
  /** @type {BowPose | null} */
  let lastPose = null;

  function draw() {
    if (!ctx || !units) {
      layout = null;
      return;
    }
    const c = ctx;
    const u = units;
    const W = Math.max(Math.round(container.clientWidth), 200);
    const H = Math.round(Math.min(360, Math.max(220, W * 0.5)));
    const left = MARGIN.left;
    const right = W - MARGIN.right;
    const top = MARGIN.top;
    const bottom = H - MARGIN.bottom;
    const { lo, hi } = loadRange(c.loads);
    const px = (/** @type {number} */ x) => left + ((x - c.xBrace) / (c.xFull - c.xBrace)) * (right - left);
    const py = (/** @type {number} */ F) => bottom - ((F - lo) / (hi - lo)) * (bottom - top);
    layout = { W, H, px, py, top, bottom };
    setAttrs(root, { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    setAttrs(bg, { x: left, y: top, width: right - left, height: bottom - top });
    grid.replaceChildren();
    axes.replaceChildren();
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
    };
    const xt = ticks(amo(c.xBrace, u), amo(c.xFull, u), Math.max(3, Math.round((right - left) / 70)));
    for (const v of xt.values) {
      const X = px(toSI(v, 'length', u.draw) - AMO_OFFSET);
      add(grid, 'line', { x1: X, x2: X, y1: top, y2: bottom });
      add(axes, 'text', { x: X, y: bottom + 18, 'text-anchor': 'middle', class: 'tick' }, fixed(v, xt.decimals));
    }
    const yt = ticks(fromSI(lo, 'force', u.force), fromSI(hi, 'force', u.force), Math.max(3, Math.round((bottom - top) / 50)));
    for (const v of yt.values) {
      const Y = py(toSI(v, 'force', u.force));
      add(grid, 'line', { x1: left, x2: right, y1: Y, y2: Y });
      add(axes, 'text', { x: left - 8, y: Y + 4, 'text-anchor': 'end', class: 'tick' }, fixed(v, yt.decimals));
    }
    add(axes, 'line', { class: 'axis', x1: left, x2: right, y1: py(0), y2: py(0) });
    add(axes, 'line', { class: 'axis', x1: left, x2: left, y1: top, y2: bottom });
    add(axes, 'text', { class: 'axis-title', x: (left + right) / 2, y: H - 10, 'text-anchor': 'middle' }, `Draw length (AMO), ${u.draw}`);
    const cy = (top + bottom) / 2;
    add(axes, 'text', { class: 'axis-title', x: 16, y: cy, 'text-anchor': 'middle', transform: `rotate(-90 16 ${cy})` }, `Force, ${u.force}`);
    lines.replaceChildren();
    for (const s of SERIES) {
      for (const points of seriesRuns(c.loads.x, c.loads[s.key], px, py)) {
        lines.append(svg('polyline', {
          class: `load-line ${s.cls}`, points, 'stroke-dasharray': s.dash, 'data-testid': `load-${s.key}`, 'stroke-linejoin': 'round',
        }));
      }
    }
    placeMarker();
  }

  function placeMarker() {
    const p = lastPose;
    const L = layout;
    if (!L || !p || !Number.isFinite(p.x)) {
      marker.style.display = 'none';
      return;
    }
    const X = L.px(p.x).toFixed(1);
    setAttrs(markerLine, { x1: X, x2: X, y1: L.top, y2: L.bottom });
    SERIES.forEach((s, i) => {
      const v = p[s.key];
      setAttrs(dots[i], { cx: X, cy: Number.isFinite(v) ? L.py(v).toFixed(1) : null });
      dots[i].style.display = Number.isFinite(v) ? '' : 'none';
    });
    marker.style.display = '';
  }

  /**
   * @param {HTMLElement} list
   * @param {[string, string, string][]} items label, test id, text
   */
  function fill(list, items) {
    const text = items.map((i) => i.join('\u0001')).join('\u0002');
    if (list.dataset.text === text) return;
    list.dataset.text = text;
    list.replaceChildren(...items.flatMap(([label, id, value]) => [
      h('div', { class: 'results-metric' }, h('dt', {}, label), h('dd', { 'data-testid': id }, value)),
    ]));
  }

  // Redraw on width changes only.
  let observedWidth = -1;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[entries.length - 1].contentRect.width);
    if (width === observedWidth) return;
    observedWidth = width;
    requestAnimationFrame(draw);
  }).observe(container);

  return {
    render(next, u, isStale, outdated = false) {
      const nextKey = `${u.draw}|${u.force}|${isStale}|${outdated}`;
      if (next === ctx && nextKey === key) return;
      ctx = next;
      units = u;
      stale = isStale || outdated;
      key = nextKey;
      const text = next
        ? ageCaption(isStale, outdated, 'Loads of the last cam that met every check', 'Loads of the previous inputs; solving the current inputs')
        : '';
      root.classList.toggle('cam-stale', text !== '');
      caption.textContent = text;
      caption.hidden = text === '';
      if (!next) {
        layout = null;
        // No scales of an earlier cam stay on screen.
        lines.replaceChildren();
        grid.replaceChildren();
        axes.replaceChildren();
        setAttrs(bg, { width: 0, height: 0 });
        marker.style.display = 'none';
        fill(now, []);
        fill(peaks, []);
        tbody.replaceChildren();
        setAttrs(root, { 'aria-label': 'Loads chart: no cam yet' });
        return;
      }
      draw();
      const f = (/** @type {number} */ v) => `${forceText(v, u, true)} ${u.force}`;
      const at = (/** @type {number} */ x) => `${drawText(x, u, true)} ${u.draw}`;
      const L = next.loads;
      fill(peaks, [
        ['String tension', 'load-peak-Ts', `${f(L.maxTs.value)} at ${at(L.maxTs.x)}`],
        ['Cable tension, each cable', 'load-peak-Tc', `${f(L.maxTc.value)} at ${at(L.maxTc.x)}`],
        ['Load on each limb tip', 'load-peak-axle', `${f(L.maxAxle.value)} at ${at(L.maxAxle.x)}`],
        ['Limb tip load at brace', 'load-brace-axle', f(L.braceAxle)],
      ]);
      setAttrs(root, {
        'aria-label': `Loads chart: string tension, cable tension and limb tip load against the draw; ` +
          `largest limb tip load ${f(L.maxAxle.value)} at ${at(L.maxAxle.x)}; the table below lists the values`,
      });
      thead.replaceChildren(h('tr', {},
        ...[`Draw (AMO), ${u.draw}`, `Draw force, ${u.force}`, `String tension, ${u.force}`, `Cable tension, ${u.force}`,
          `Limb tip load, ${u.force}`, 'Cam turned'].map((t) => h('th', { scope: 'col' }, t))));
      tbody.replaceChildren(...tableRows(next).map(({ fraction, pose }) => {
        const x = next.xBrace + fraction * (next.xFull - next.xBrace);
        const cells = pose
          ? [forceText(pose.F, u), forceText(pose.Ts, u), forceText(pose.Tc, u), forceText(pose.axleLoad, u), angleText(pose.theta)]
          : ['—', '—', '—', '—', '—'];
        return h('tr', {}, h('td', {}, drawText(fraction === 1 ? next.xFull : x, u)), ...cells.map((c) => h('td', {}, c)));
      }));
    },
    setPose(pose, u) {
      lastPose = pose;
      placeMarker();
      if (!pose || !ctx || !Number.isFinite(pose.x)) {
        fill(now, []);
        return;
      }
      const f = (/** @type {number} */ v) => `${forceText(v, u, true)} ${u.force}`;
      const dir = loadDirection(pose.tipX, pose.tipY);
      fill(now, [
        ['At draw', 'load-now-x', `${drawText(pose.x, u)} ${u.draw}${stale ? ' (previous result)' : ''}`],
        ['String tension', 'load-now-Ts', f(pose.Ts)],
        ['Cable tension, each cable', 'load-now-Tc', f(pose.Tc)],
        ['Load on each limb tip', 'load-now-axle', `${f(pose.axleLoad)}${dir ? `, ${dir}` : ''}`],
      ]);
    },
  };
}
