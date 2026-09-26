/**
 * Timing panel: results of the asymmetric analysis of the built cam with
 * the cord length changes of the Timing settings, and a chart of the nock
 * height and the cam timing over the draw. Analysis only: nothing here
 * changes the cam, its checks or the exports.
 * @module ui/timing
 */

import { AMO_OFFSET, fromSI, toSI } from '../core/units.js';
import { amo, fixed } from './display.js';
import { h, setAttrs, svg } from './dom.js';
import { ticks } from './chart.js';
import { infoButton } from './glossary.js';
import { MISSING } from './results.js';
import { seriesRuns } from './loadchart.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/analysis.js').AnalysisResult} AnalysisResult */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {keyof typeof import('./glossary.js').GLOSSARY} GlossaryKey */

/**
 * @typedef {object} TimingItem
 * @property {string} key
 * @property {string} label
 * @property {string} text value with unit, or '—'
 * @property {GlossaryKey} [glossary]
 */

const MINUS = '−';
const DEGREE = '°';
const MARGIN = Object.freeze({ left: 58, right: 24, top: 12, bottom: 48, gap: 30 });

/**
 * Signed number: '+1.43', '−0.20', '0.00'.
 * @param {number} v
 * @param {number} decimals
 */
export function signed(v, decimals) {
  const text = fixed(Math.abs(v), decimals);
  if (Number(text) === 0) return text;
  return `${v < 0 ? MINUS : '+'}${text}`;
}

/**
 * Peak and let-off of a force curve by the rule of the solver: holding
 * weight is the smallest force after the peak.
 * @param {ArrayLike<number>} F (N)
 * @returns {{ peak: number, letOff: number }}
 */
export function peakAndLetOff(F) {
  let peak = -Infinity;
  let at = 0;
  for (let i = 0; i < F.length; i++) {
    if (F[i] > peak) {
      peak = F[i];
      at = i;
    }
  }
  let hold = Infinity;
  for (let i = at; i < F.length; i++) hold = Math.min(hold, F[i]);
  return { peak, letOff: peak > 0 ? (peak - hold) / peak : NaN };
}

/**
 * Peak and let-off of an analysis over its draw, up to its end sample.
 * @param {AnalysisResult} a
 */
function drawMetrics(a) {
  return peakAndLetOff(a.F.subarray(0, a.end + 1));
}

/**
 * Timing results of a solve as display items. Without an analysis every
 * value is '—'. Changes compare the changed bow with the design: brace and
 * draw length with the forward model of the built cam, peak and let-off
 * with the analysis of unchanged cords on the same grid
 * (`analysisReference`). The end of the draw is the first stop,
 * or full draw without a stop.
 * @param {SolveResult | null} result
 * @param {Units} units
 * @returns {TimingItem[]}
 */
export function timingItems(result, units) {
  const a = result?.analysis ?? null;
  const design = result?.achieved ?? null;
  const reference = result?.analysisReference ?? null;
  const last = a ? a.end : -1;
  const ok = a !== null && last >= 0 && design !== null && reference !== null && reference.end >= 0;
  const dims = (/** @type {number} */ v) => fromSI(v, 'length', units.dims);
  const dimsDecimals = units.dims === 'mm' ? 2 : 3;
  const signedDims = (/** @type {number} */ v) => (Number.isFinite(v) ? `${signed(dims(v), dimsDecimals)} ${units.dims}` : MISSING);
  const deg = (/** @type {number} */ v) => fromSI(v, 'angle', 'deg');

  /** @type {TimingItem[]} */
  const items = [
    { key: 'timing-end', label: 'Cam timing at the first stop', glossary: 'timing', text: MISSING },
    { key: 'first-stop', label: 'First draw stop', glossary: 'drawStop', text: MISSING },
    { key: 'nock-travel', label: 'Nock travel', glossary: 'nockTravel', text: MISSING },
    { key: 'brace-change', label: 'Change of brace height', text: MISSING },
    { key: 'draw-change', label: 'Change of draw length', text: MISSING },
    { key: 'peak-change', label: 'Change of peak draw force', text: MISSING },
    { key: 'letoff-change', label: 'Change of let-off', text: MISSING },
    { key: 'sensitivity', label: 'Timing change per mm of top cable at the first stop', text: MISSING },
  ];
  // Elastic cords: the second stop, the wall and the draw change of the stretch alone.
  if (a?.elastic) items.push(...ELASTIC_ITEMS.map((i) => ({ ...i, text: MISSING })));
  if (!ok) return items;
  const set = (/** @type {string} */ key, /** @type {string} */ text) => {
    const item = items.find((i) => i.key === key);
    if (item) item.text = text;
  };
  // The first stop, before any cam rests on its stop; the end of the draw without one.
  const firstIndex = Number.isFinite(a.stops.x) ? a.x.indexOf(a.stops.x) : -1;
  const atFirst = firstIndex >= 0 ? firstIndex : last;
  const dTheta = deg(a.dTheta[atFirst]);
  const ahead = Math.abs(dTheta) < 0.005 ? 'cams in time' : dTheta > 0 ? 'top cam ahead' : 'bottom cam ahead';
  set('timing-end', `${signed(dTheta, 2)}${DEGREE}, ${ahead}`);
  const { first } = a.stops;
  const gap = (/** @type {number} */ g) => (Number.isFinite(g) ? `${fixed(dims(g), dimsDecimals)} ${units.dims}` : 'open');
  set('first-stop', first === 'both' ? 'Both cams together'
    : first === 'top' ? `Top cam; bottom cam gap ${gap(a.stops.gapBottom)}`
      : first === 'bottom' ? `Bottom cam; top cam gap ${gap(a.stops.gapTop)}`
        : 'No stop reached');
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i <= last; i++) {
    yMin = Math.min(yMin, a.y[i]);
    yMax = Math.max(yMax, a.y[i]);
  }
  set('nock-travel', a.nock === 'free' && Number.isFinite(yMax - yMin) ? `${fixed(dims(yMax - yMin), dimsDecimals)} ${units.dims}` : MISSING);
  const xb = design.x[0];
  const xf = design.x[design.x.length - 1];
  set('brace-change', signedDims(/** @type {number} */ (a.brace?.x) - xb));
  // Against unchanged cords of the same cord model; with rigid cords their draw ends at x_f.
  set('draw-change', signedDims(a.x[last] - reference.x[reference.end]));
  if (a.elastic) {
    const { second, x2, wallStiffness } = a.stops;
    set('second-stop', second === 'both' ? 'Both cams at the first stop'
      : second === 'top' || second === 'bottom'
        ? `${second === 'top' ? 'Top' : 'Bottom'} cam, ${fixed(dims(x2 - a.stops.x), dimsDecimals)} ${units.dims} after the first`
        : 'Not reached');
    set('wall-stiffness', Number.isFinite(wallStiffness)
      ? `${fixed(fromSI(wallStiffness, 'stiffness', units.stiffness), 1)} ${units.stiffness}`
      : MISSING);
    set('stretch-draw', signedDims(reference.x[reference.end] - xf));
  }
  const changed = drawMetrics(a);
  const base = drawMetrics(reference);
  const dPeak = changed.peak - base.peak;
  const dLetOff = changed.letOff - base.letOff;
  set('peak-change', Number.isFinite(dPeak) ? `${signed(fromSI(dPeak, 'force', units.force), units.force === 'N' ? 1 : 2)} ${units.force}` : MISSING);
  // The 300-sample grids of the two analyses differ: up to 0.02 points
  // and 0.02 N of sampling error (docs/model.md), below the shown digits.
  set('letoff-change', Number.isFinite(dLetOff) ? `${signed(dLetOff * 100, 1)} points` : MISSING);
  // Per millimetre in every unit system: a twist changes a cord by about 1 mm.
  // In the nock mode of the analysis: with a free nock the nock follows.
  const perMm = deg(a.sensitivity) * 1e-3;
  set('sensitivity', Number.isFinite(perMm) ? `${fixed(perMm, 2)}${DEGREE}/mm` : MISSING);
  return items;
}

/** Rows of the timing panel with elastic cords only. */
export const ELASTIC_ITEMS = Object.freeze([
  Object.freeze({ key: 'second-stop', label: 'Second draw stop' }),
  Object.freeze({ key: 'wall-stiffness', label: 'Wall stiffness, both cams on their stops' }),
  Object.freeze({ key: 'stretch-draw', label: 'Change of draw length by stretch, unchanged cords' }),
]);

/** Glossary entries with an info button in the timing panel. */
export const TIMING_GLOSSARY = Object.freeze(/** @type {GlossaryKey[]} */ (['timing', 'drawStop', 'nockTravel']));

/**
 * Diagnostics of the analysis as text.
 * @param {SolveResult | null} result
 * @returns {{ code: string, message: string }[]}
 */
export function timingProblems(result) {
  return (result?.analysis?.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message }));
}

/**
 * @typedef {object} TimingPanel
 * @property {(result: SolveResult | null, units: Units, stale: boolean, outdated?: boolean) => void} render
 *   show the analysis of a result; a coarse result keeps the values shown
 * @property {() => void} destroy
 */

/**
 * Build the timing panel inside a container: results list, problems, chart
 * of nock height and cam timing over the draw, and a caption.
 * @param {HTMLElement} container
 * @returns {TimingPanel}
 */
export function createTiming(container) {
  const list = h('dl', { class: 'results-metrics timing-metrics', 'data-testid': 'timing-metrics' });
  /** @type {Map<string, { dd: HTMLElement, row: HTMLElement }>} */
  const rows = new Map();
  // Every row of rigid cords, then the rows of elastic cords, hidden until an elastic result shows.
  for (const item of [...timingItems(null, { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' }), ...ELASTIC_ITEMS]) {
    const glossary = 'glossary' in item ? item.glossary : undefined;
    const dt = glossary ? h('dt', {}, item.label, timingInfo(glossary, item.key)) : h('dt', {}, item.label);
    const dd = h('dd', { 'data-testid': `timing-${item.key}` }, MISSING);
    const row = h('div', { class: 'results-metric' }, dt, dd);
    rows.set(item.key, { dd, row });
    list.append(row);
  }
  for (const { key } of ELASTIC_ITEMS) /** @type {{ row: HTMLElement }} */ (rows.get(key)).row.hidden = true;
  const problemsHeading = h('h3', { class: 'results-diagnostics-heading', hidden: true }, 'Problems of the analysis');
  const problems = h('ol', { class: 'results-diagnostics', 'data-testid': 'timing-problems', hidden: true });
  const root = svg('svg', { class: 'chart timing-chart', 'data-testid': 'timing-chart', role: 'img', 'aria-label': 'Timing chart: no cam yet' });
  const bg = svg('g', { class: 'timing-bg' });
  const grid = svg('g', { class: 'chart-grid', 'aria-hidden': 'true' });
  const lines = svg('g', { 'aria-hidden': 'true', fill: 'none' });
  const axes = svg('g', { class: 'chart-axes', 'aria-hidden': 'true' });
  root.append(bg, grid, lines, axes);
  const caption = h('p', { class: 'camview-caption', 'data-testid': 'timing-caption', 'aria-live': 'polite', hidden: true });
  container.append(list, problemsHeading, problems, root, caption);

  /** @type {SolveResult | null} */
  let shown = null;
  /** @type {Units | null} */
  let units = null;
  let key = '';

  function draw() {
    const a = shown?.analysis ?? null;
    const design = shown?.achieved ?? null;
    for (const g of [bg, grid, lines, axes]) g.replaceChildren();
    // The chart ends where the draw ends.
    const n = a ? a.end + 1 : 0;
    if (!a || n < 2 || !design || !units) {
      setAttrs(root, { width: 0, height: 0, 'aria-label': 'Timing chart: no cam yet' });
      return;
    }
    const u = units;
    const W = Math.max(Math.round(container.clientWidth), 200);
    const H = Math.round(Math.min(420, Math.max(260, W * 0.6)));
    const left = MARGIN.left;
    const right = W - MARGIN.right;
    const plotH = (H - MARGIN.top - MARGIN.bottom - MARGIN.gap) / 2;
    const x0 = Math.min(a.x[0], design.x[0]);
    const x1 = Math.max(a.x[n - 1], design.x[design.x.length - 1]);
    const px = (/** @type {number} */ x) => left + ((x - x0) / (x1 - x0)) * (right - left);
    setAttrs(root, { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
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
    const xt = ticks(amo(x0, u), amo(x1, u), Math.max(3, Math.round((right - left) / 70)));
    const panels = [
      { top: MARGIN.top, values: a.y, scale: (/** @type {number} */ v) => fromSI(v, 'length', u.dims), title: `Nock height, ${u.dims}`, cls: 'timing-nock' },
      { top: MARGIN.top + plotH + MARGIN.gap, values: a.dTheta, scale: (/** @type {number} */ v) => fromSI(v, 'angle', 'deg'), title: `Cam timing, ${DEGREE}`, cls: 'timing-dtheta' },
    ];
    for (const p of panels) {
      const bottom = p.top + plotH;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = p.scale(p.values[i]);
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      // A flat series gets a range of ±1 display unit around its value.
      const pad = Math.max((hi - lo) * 0.1, hi - lo < 1e-9 ? 1 : 0);
      lo -= pad;
      hi += pad;
      const py = (/** @type {number} */ v) => bottom - ((v - lo) / (hi - lo)) * (bottom - p.top);
      add(bg, 'rect', { class: 'chart-bg', x: left, y: p.top, width: right - left, height: plotH });
      for (const v of xt.values) {
        const X = px(toSI(v, 'length', u.draw) - AMO_OFFSET);
        add(grid, 'line', { x1: X, x2: X, y1: p.top, y2: bottom });
      }
      const yt = ticks(lo, hi, Math.max(2, Math.round(plotH / 40)));
      for (const v of yt.values) {
        const Y = py(v);
        add(grid, 'line', { x1: left, x2: right, y1: Y, y2: Y });
        add(axes, 'text', { x: left - 8, y: Y + 4, 'text-anchor': 'end', class: 'tick' }, fixed(v, yt.decimals));
      }
      add(axes, 'line', { class: 'axis', x1: left, x2: left, y1: p.top, y2: bottom });
      add(axes, 'line', { class: 'axis', x1: left, x2: right, y1: bottom, y2: bottom });
      const cy = (p.top + bottom) / 2;
      add(axes, 'text', { class: 'axis-title', x: 14, y: cy, 'text-anchor': 'middle', transform: `rotate(-90 14 ${cy})` }, p.title);
      // Design full draw.
      const XF = px(design.x[design.x.length - 1]);
      add(grid, 'line', { class: 'timing-full', x1: XF, x2: XF, y1: p.top, y2: bottom });
      const values = Array.from(p.values.subarray(0, n), (v) => p.scale(v));
      for (const points of seriesRuns(a.x.subarray(0, n), values, px, py)) {
        lines.append(svg('polyline', { class: `timing-line ${p.cls}`, points, 'stroke-linejoin': 'round', 'data-testid': p.cls }));
      }
    }
    const bottom = panels[1].top + plotH;
    for (const v of xt.values) {
      add(axes, 'text', { x: px(toSI(v, 'length', u.draw) - AMO_OFFSET), y: bottom + 18, 'text-anchor': 'middle', class: 'tick' }, fixed(v, xt.decimals));
    }
    add(axes, 'text', { class: 'axis-title', x: (left + right) / 2, y: H - 10, 'text-anchor': 'middle' }, `Draw length (AMO), ${u.draw}`);
    const end = timingItems(shown, u).find((i) => i.key === 'timing-end')?.text ?? MISSING;
    setAttrs(root, {
      'aria-label': `Timing chart: nock height and cam timing against the draw, the dashed line marks full draw of the design; ` +
        `cam timing at the first stop ${end}; the list above gives the values`,
    });
  }

  let observedWidth = -1;
  const resize = new ResizeObserver((entries) => {
    const width = Math.round(entries[entries.length - 1].contentRect.width);
    if (width === observedWidth) return;
    observedWidth = width;
    requestAnimationFrame(draw);
  });
  resize.observe(container);

  return {
    render(result, u, stale, outdated = false) {
      // A coarse solve has no analysis: the values of the last full solve
      // stay, marked as belonging to earlier inputs.
      const coarse = result !== null && result.resolution === 'coarse';
      const next = coarse ? shown : result;
      const old = coarse || outdated;
      const nextKey = `${u.dims}|${u.draw}|${u.force}|${stale}|${old}`;
      if (next === shown && nextKey === key) return;
      shown = next;
      units = u;
      key = nextKey;
      const items = timingItems(next, u);
      for (const item of items) {
        const row = rows.get(item.key);
        if (!row) continue;
        if (row.dd.textContent !== item.text) row.dd.textContent = item.text;
      }
      for (const { key: k } of ELASTIC_ITEMS) {
        /** @type {{ row: HTMLElement }} */ (rows.get(k)).row.hidden = !items.some((i) => i.key === k);
      }
      const found = timingProblems(next);
      problemsHeading.hidden = found.length === 0;
      problems.hidden = found.length === 0;
      problems.replaceChildren(...found.map((d) => h('li', { class: 'results-diagnostic', 'data-testid': `timing-diag-${d.code}` },
        h('p', { class: 'results-diag-message' }, d.message))));
      const text = !next?.analysis ? ''
        : old ? 'Timing of the previous inputs; solving the current inputs.'
          : stale ? 'Timing of the latest attempt, which fails the checks.' : '';
      caption.textContent = text;
      caption.hidden = text === '';
      container.classList.toggle('results-stale', text !== '');
      draw();
    },
    destroy() {
      resize.disconnect();
      for (const el of [list, problemsHeading, problems, root, caption]) el.remove();
    },
  };
}

/**
 * Info button with test ids of the timing panel.
 * @param {GlossaryKey} glossary
 * @param {string} key
 */
function timingInfo(glossary, key) {
  const wrap = infoButton(glossary);
  wrap.querySelector('button')?.setAttribute('data-testid', `timing-info-${key}`);
  wrap.querySelector('.glossary-pop')?.setAttribute('data-testid', `timing-glossary-${key}`);
  return wrap;
}
