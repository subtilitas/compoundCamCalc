/**
 * Results card: solver status line, metrics of the built cam and the
 * diagnostics of the solve with their suggestions.
 * @module ui/results
 */

import { FIT_ENERGY_TOLERANCE, FIT_FORCE_FLOOR, FIT_FORCE_TOLERANCE } from '../core/solve.js';
import { fromSI } from '../core/units.js';
import { angleText, dimsText, fixed, forceText } from './display.js';
import { h } from './dom.js';
import { infoButton } from './glossary.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/solve.js').SolveMetrics} SolveMetrics */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {keyof typeof import('./glossary.js').GLOSSARY} GlossaryKey */

/** @typedef {'idle' | 'busy' | 'ok' | 'infeasible' | 'no-convergence' | 'error'} ResultsStatus */

/**
 * @typedef {object} ResultsView
 * @property {ResultsStatus} status
 * @property {SolveResult | null} result
 * @property {ProjectState} state
 * @property {boolean} stale the cam shown is the last one that met every check
 * @property {boolean} [outdated] the values belong to older inputs while a
 *   newer solve runs
 */

/**
 * @typedef {object} MetricItem
 * @property {string} key
 * @property {string} label
 * @property {string} text value with unit, or '—' without metrics
 * @property {boolean} [warn] the value is outside its tolerance
 */

/**
 * @typedef {object} DiagnosticItem
 * @property {string} code
 * @property {string} message
 * @property {string} suggestion
 */

/** Text of a value that is not available. */
export const MISSING = '—';

/** Sentence appended to the status line when the cam shown is an older one. */
export const STALE_TEXT = 'The cam shown is the last one that met every check.';

/** Caption above the metrics when the cam view shows an older cam than the metrics. */
export const STALE_CAPTION = 'These values belong to the latest attempt, which fails the checks; ' +
  'the cam view shows the last cam that met every check.';

/** Caption above the metrics while a newer solve runs. */
export const OUTDATED_CAPTION = 'These values belong to the previous inputs; solving the current inputs.';

/**
 * Status line text.
 * @param {ResultsStatus} status
 * @param {number} count number of diagnostics of the result
 * @param {boolean} stale
 * @returns {string}
 */
export function statusText(status, count, stale) {
  /** @type {string} */
  let text;
  switch (status) {
    case 'busy': text = 'Solving…'; break;
    case 'ok': text = 'The cam meets the target and every check'; break;
    case 'infeasible': text = `The cam does not meet every check: ${count} ${count === 1 ? 'problem' : 'problems'}`; break;
    case 'no-convergence': text = 'The solver did not converge'; break;
    case 'error': text = 'The solver stopped with an error; change an input to try again'; break;
    default: text = '';
  }
  if (!stale) return text;
  if (!text) return STALE_TEXT;
  return `${text}${/[.…]$/.test(text) ? '' : '.'} ${STALE_TEXT}`;
}

/**
 * Build dimension as text with unit.
 * @param {number} value (m)
 * @param {Units} units
 */
function dims(value, units) {
  return Number.isFinite(value) ? dimsText(value, units) : MISSING;
}

/**
 * @param {number} value (N)
 * @param {Units} units
 */
function force(value, units) {
  return Number.isFinite(value) ? `${forceText(value, units)} ${units.force}` : MISSING;
}

/**
 * @param {number} value (J)
 * @param {Units} units
 */
function energy(value, units) {
  return Number.isFinite(value) ? `${fixed(fromSI(value, 'energy', units.energy), 1)} ${units.energy}` : MISSING;
}

/** @type {{ key: string, label: string, text: (m: SolveMetrics, u: Units) => string }[]} */
const METRICS = [
  { key: 'peak', label: 'Achieved peak', text: (m, u) => force(m.peak, u) },
  { key: 'holding', label: 'Holding weight', text: (m, u) => force(m.holding, u) },
  { key: 'letOff', label: 'Let-off', text: (m) => (Number.isFinite(m.letOff) ? `${fixed(m.letOff * 100, 1)} %` : MISSING) },
  { key: 'drawEnergy', label: 'Draw energy', text: (m, u) => energy(m.drawEnergy, u) },
  { key: 'limbEnergy', label: 'Limb energy at full draw', text: (m, u) => energy(m.limbEnergy, u) },
  { key: 'axleTravel', label: 'Axle travel', text: (m, u) => dims(m.axleTravel, u) },
  {
    key: 'rotation',
    label: 'Cam rotation',
    text: (m) => (Number.isFinite(m.rotation) ? angleText(m.rotation) : MISSING),
  },
  { key: 'stringLength', label: 'String length', text: (m, u) => dims(m.stringLength, u) },
  { key: 'cableLength', label: 'Cable length', text: (m, u) => dims(m.cableLength, u) },
  { key: 'camMaxDimension', label: 'Cam maximum dimension', text: (m, u) => dims(m.camMaxDimension, u) },
  {
    key: 'stringRho',
    label: 'String track smallest radius of curvature',
    text: (m, u) => `${dims(m.stringMinRho, u)}, limit ${dims(m.stringRhoLimit, u)}`,
  },
  {
    key: 'cableRho',
    label: 'Cable track smallest radius of curvature',
    text: (m, u) => `${dims(m.cableMinRho, u)}, limit ${dims(m.cableRhoLimit, u)}`,
  },
];

/** Row of the fit summary, shown only for a fitted cable track. */
const FIT_ROW = Object.freeze({ key: 'fit', label: 'Fitted cable track' });

/** Keys of the metric items in order, without the optional fit item. */
export const METRIC_KEYS = Object.freeze(METRICS.map((m) => m.key));

/** Glossary entries of the metric keys that have one. */
const GLOSSARY_OF = /** @type {Readonly<Record<string, GlossaryKey>>} */ ({
  peak: 'peak', holding: 'hold', letOff: 'letOff', drawEnergy: 'energy',
});

/**
 * Force tolerance of a fitted cam: FIT_FORCE_TOLERANCE of the target peak,
 * at least FIT_FORCE_FLOOR (the rule of the solver).
 * @param {SolveResult} result
 * @returns {number} (N), NaN without a target
 */
export function fitTolerance(result) {
  const F = result.target?.F;
  if (!F || F.length === 0) return NaN;
  let peak = -Infinity;
  for (let i = 0; i < F.length; i++) if (F[i] > peak) peak = F[i];
  return Math.max(FIT_FORCE_TOLERANCE * peak, FIT_FORCE_FLOOR);
}

/**
 * Metrics of a result as display items in the units of the project. Without
 * metrics every value is '—'. A fit item follows when the cable track is fitted;
 * it has warn set when the largest force difference is outside the tolerance.
 * @param {SolveResult | null} result
 * @param {Units} units
 * @returns {MetricItem[]}
 */
export function metricItems(result, units) {
  const m = result?.metrics ?? null;
  /** @type {MetricItem[]} */
  const items = METRICS.map((item) => ({ key: item.key, label: item.label, text: m ? item.text(m, units) : MISSING }));
  if (result && m && result.fit.used) {
    // The fit meets its tolerance when both the force and the draw energy
    // agree; with the force within its own tolerance, the energy failed.
    const tolerance = fitTolerance(result);
    const forceOk = result.fit.maxForceDifference <= tolerance;
    const energyFailed = forceOk && !result.fit.withinTolerance;
    items.push({
      key: FIT_ROW.key,
      label: FIT_ROW.label,
      text: `Largest force difference ${force(result.fit.maxForceDifference, units)}, ` +
        `${forceOk ? 'within' : 'more than'} the tolerance of ${force(tolerance, units)}` +
        (energyFailed ? `; the draw energy differs by more than ${fixed(FIT_ENERGY_TOLERANCE * 100, 1)} %` : ''),
      warn: !result.fit.withinTolerance,
    });
  }
  return items;
}

/**
 * Diagnostics of a result in the order given.
 * @param {SolveResult | null} result
 * @returns {DiagnosticItem[]}
 */
export function diagnosticItems(result) {
  return (result?.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message, suggestion: d.suggestion }));
}

/** Number of results cards created, for unique element ids. */
let cards = 0;

/**
 * Info button of a glossary entry with test ids of the results card, so they
 * do not repeat the ids of the target statistics (info-<key>, glossary-<key>).
 * @param {GlossaryKey} key
 */
function resultsInfo(key) {
  const wrap = infoButton(key);
  wrap.querySelector('button')?.setAttribute('data-testid', `results-info-${key}`);
  wrap.querySelector('.glossary-pop')?.setAttribute('data-testid', `results-glossary-${key}`);
  return wrap;
}

/**
 * Results card inside a container: status line (p.results-status), stale
 * caption (p.results-caption), metrics (dl.results-metrics) and diagnostics
 * (ol.results-diagnostics). The rows of
 * the metrics list are built once, so an open glossary popover stays open
 * while the values change; render only writes texts that differ.
 *
 * `view.result` is the latest result: the status count, the metrics and the
 * diagnostics come from it. `view.stale` adds the stale sentence, shows the
 * caption above the metrics and sets the class results-stale (the cam view
 * shows the older cam). The fit row has the class results-metric-warn when the
 * fitted cable track is outside the force tolerance.
 * @param {HTMLElement} container
 * @returns {{ render: (view: ResultsView) => void }}
 */
export function createResults(container) {
  const headingId = `results-diagnostics-heading-${++cards}`;
  const status = h('p', { class: 'results-status', role: 'status', 'data-testid': 'results-status' });
  const caption = h('p', { class: 'results-caption', 'data-testid': 'results-caption', hidden: true }, STALE_CAPTION);
  const metrics = h('dl', { class: 'results-metrics', 'data-testid': 'results-metrics' });
  const diagHeading = h('h3', { class: 'results-diagnostics-heading', id: headingId, hidden: true }, 'Problems');
  const diagnostics = h('ol', {
    class: 'results-diagnostics',
    'data-testid': 'results-diagnostics',
    'aria-labelledby': headingId,
    hidden: true,
  });

  /** @type {Map<string, { row: HTMLDivElement, dd: HTMLElement }>} */
  const rows = new Map();
  for (const { key, label } of [...METRICS, FIT_ROW]) {
    const glossary = GLOSSARY_OF[key];
    const dt = glossary ? h('dt', {}, label, resultsInfo(glossary)) : h('dt', {}, label);
    const dd = h('dd', { 'data-testid': `metric-${key}` }, MISSING);
    const row = h('div', { class: 'results-metric' }, dt, dd);
    rows.set(key, { row, dd });
    metrics.append(row);
  }
  const fitRow = /** @type {{ row: HTMLDivElement }} */ (rows.get(FIT_ROW.key)).row;
  fitRow.hidden = true;

  container.classList.add('results');
  container.append(status, caption, metrics, diagHeading, diagnostics);

  let diagKey = '';

  return {
    render(view) {
      const { result } = view;
      const count = result?.diagnostics.length ?? 0;
      const statusClass = `results-status results-status-${view.status}`;
      if (status.className !== statusClass) status.className = statusClass;
      const text = statusText(view.status, count, view.stale);
      // Writing the same text again makes some screen readers repeat it.
      if (status.textContent !== text) status.textContent = text;
      const outdated = view.outdated === true;
      container.classList.toggle('results-stale', view.stale || outdated);
      // The caption speaks about values, so it needs a result to show.
      const captionText = view.stale ? STALE_CAPTION : OUTDATED_CAPTION;
      if (caption.textContent !== captionText) caption.textContent = captionText;
      caption.hidden = !(view.stale || outdated) || !result;

      const items = metricItems(result, view.state.units);
      let fitShown = false;
      for (const item of items) {
        const entry = rows.get(item.key);
        if (!entry) continue;
        if (entry.dd.textContent !== item.text) entry.dd.textContent = item.text;
        if (item.key === FIT_ROW.key) {
          fitShown = true;
          entry.row.classList.toggle('results-metric-warn', item.warn === true);
        }
      }
      fitRow.hidden = !fitShown;

      const diags = diagnosticItems(result);
      const key = JSON.stringify(diags);
      if (key === diagKey) return;
      diagKey = key;
      diagHeading.hidden = diags.length === 0;
      diagnostics.hidden = diags.length === 0;
      diagnostics.replaceChildren(...diags.map((d) => h(
        'li',
        { class: 'results-diagnostic', 'data-testid': `diag-${d.code}` },
        h('p', { class: 'results-diag-message' }, d.message),
        h('p', { class: 'results-diag-suggestion' }, `Suggestion: ${d.suggestion}`),
      )));
    },
  };
}
