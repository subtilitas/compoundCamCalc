/**
 * Print report of the last cam that met every check: the inputs, the target
 * statistics, the results with diagnostics, the force chart, the cam at
 * brace, the string plan, the build lengths, the loads and a force table.
 * It uses the result and the state the exports use, in the display units
 * selected now. The report is built on beforeprint and removed on
 * afterprint; while it exists, body has the class printing-report and the
 * print style sheet shows the report only. Without such a cam the page
 * prints unchanged.
 * @module ui/report
 */

import { bowPoseAt, createBowPose, createLayout } from '../core/layout.js';
import { designId } from '../export/files.js';
import { createCamView } from './camview.js';
import { h } from './dom.js';
import { exportStatus } from './exportpanel.js';
import { createLoadChart, loadMaxima, loadTable } from './loadchart.js';
import { diagnosticItems, metricItems, warningItems } from './results.js';
import { inputGroups } from './settings.js';
import { staticChartModel, staticChartSvg } from './staticchart.js';
import { statItems } from './stats.js';
import { createStringPlan, planDims } from './stringplan.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../core/layout.js').BowPose} BowPose */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('./settings.js').InputGroup} InputGroup */
/** @typedef {import('./results.js').MetricItem} MetricItem */
/** @typedef {import('./results.js').DiagnosticItem} DiagnosticItem */

/** Note on the limits of the model, as under the results card. */
export const MODEL_NOTE = 'Static model: string stretch, cam timing and dynamics are not modelled.';

/** Width of the loads chart in the report (px). */
const LOADS_WIDTH = 640;

/**
 * @typedef {object} ReportSource
 * @property {SolveResult} result last cam that met every check
 * @property {ProjectState} state inputs of that cam
 * @property {ProjectState} now current inputs: their units apply, and their
 *   design id tells whether the cam is current
 * @property {string} name name of the design
 * @property {string} version app version
 * @property {Date} date time of printing
 */

/**
 * @typedef {object} ReportData
 * @property {string} name
 * @property {string} printed local date and time, YYYY-MM-DD HH:MM
 * @property {string} version
 * @property {string} id design id of the cam
 * @property {string} status export status sentence
 * @property {Units} units
 * @property {InputGroup[]} inputs
 * @property {{ key: string, label: string, text: string }[]} target
 * @property {MetricItem[]} metrics
 * @property {DiagnosticItem[]} diagnostics
 * @property {DiagnosticItem[]} warnings plausibility warnings
 * @property {LayoutContext | null} ctx layout of the cam, null when it cannot be built
 * @property {{ label: string, key: string, text: string }[]} lengths build lengths
 * @property {{ label: string, key: string, text: string }[]} loads load maxima
 * @property {{ head: string[], rows: string[][] }} table force table at 10 % steps
 * @property {string} note
 */

/**
 * Local date and time as YYYY-MM-DD HH:MM.
 * @param {Date} d
 */
export function dateTimeText(d) {
  const two = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * Content of the report as text, in the units of the current inputs.
 * @param {ReportSource} src
 * @returns {ReportData}
 */
export function reportData(src) {
  const units = src.now.units;
  const state = { ...src.state, units };
  const id = designId(src.state);
  const ctx = createLayout(src.result, src.state.geometry).layout;
  return {
    name: src.name,
    printed: dateTimeText(src.date),
    version: src.version,
    id,
    status: /** @type {string} */ (exportStatus({ hasCam: true, busy: false, pending: false, current: id === designId(src.now), id })),
    units,
    inputs: inputGroups(state),
    target: statItems(state),
    metrics: metricItems(src.result, units),
    diagnostics: diagnosticItems(src.result),
    warnings: warningItems(src.result),
    ctx,
    lengths: ctx ? planDims(ctx, units) : [],
    loads: ctx ? loadMaxima(ctx.loads, units) : [],
    table: ctx ? loadTable(ctx, units) : { head: [], rows: [] },
    note: MODEL_NOTE,
  };
}

/**
 * Description list of label and text pairs; each value carries its key in
 * data-key.
 * @param {{ label: string, text: string, key?: string }[]} items
 */
function list(items) {
  return h('dl', { class: 'report-list' }, ...items.map((i) =>
    h('div', { class: 'report-row' }, h('dt', {}, i.label), h('dd', i.key ? { 'data-key': i.key } : {}, i.text))));
}

/**
 * @param {string} key section name; test id report-<key>
 * @param {string} title
 * @param {...(Node | string)} children
 */
function section(key, title, ...children) {
  return h('section', { class: 'report-section', 'data-testid': `report-${key}` }, h('h2', {}, title), ...children);
}

/**
 * @param {string} caption
 * @param {...Node} children
 */
function figure(caption, ...children) {
  return h('figure', { class: 'report-figure' }, ...children, h('figcaption', {}, caption));
}

/**
 * @typedef {object} Report
 * @property {HTMLElement} root
 * @property {() => void} destroy remove the report and its views
 */

/**
 * Build the report of a source. The views are fresh instances; test ids
 * inside the report are removed after rendering, except on the root and
 * its sections, so none repeats a test id of the page.
 * @param {ReportSource} src
 * @returns {Report}
 */
export function buildReport(src) {
  const data = reportData(src);
  const { units, ctx } = data;
  const state = { ...src.state, units };
  /** @type {BowPose | null} */
  let brace = createBowPose();
  if (!ctx || !bowPoseAt(ctx, ctx.xBrace, brace)) brace = null;

  const head = h('header', { class: 'report-head' },
    h('h1', {}, `Cam report: ${data.name}`),
    list([
      { label: 'Design', text: data.name, key: 'name' },
      { label: 'Design id', text: data.id, key: 'id' },
      { label: 'Printed', text: data.printed, key: 'printed' },
      { label: 'App version', text: data.version, key: 'version' },
    ]),
    h('p', { class: 'report-status', 'data-key': 'status' }, data.status));

  const inputs = section('inputs', 'Inputs', ...data.inputs.map((g) =>
    h('div', { class: 'report-group' }, h('h3', {}, g.title), list(g.rows))));
  const target = section('target', 'Target curve', list(data.target));
  const results = section('results', 'Results', list(data.metrics),
    ...(data.diagnostics.length > 0
      ? [h('h3', {}, 'Problems'), h('ol', { class: 'report-diagnostics' }, ...data.diagnostics.map((d) =>
          h('li', {}, h('p', {}, d.message), h('p', {}, `Suggestion: ${d.suggestion}`))))]
      : [h('p', {}, 'No problems.')]),
    ...(data.warnings.length > 0
      ? [h('h3', {}, 'Warnings'), h('ol', { class: 'report-diagnostics' }, ...data.warnings.map((d) =>
          h('li', {}, h('p', {}, d.message), h('p', {}, `Suggestion: ${d.suggestion}`))))]
      : []));

  const model = staticChartModel(src.result, units);
  const force = section('force-chart', 'Force chart',
    model ? figure('Target (solid) and achieved (dashed) draw force against the draw length', staticChartSvg(model))
      : h('p', {}, 'No target curve.'));

  const camBody = h('div', { class: 'cam-body' });
  const cam = createCamView(camBody);
  cam.render(src.result, state, false);
  cam.setPose(brace, units);
  const camSection = section('cam', 'Cam at brace', figure('Top cam seen from the side at brace, x towards the archer', camBody));

  const planBody = h('div', { class: 'cam-body' });
  const plan = createStringPlan(planBody);
  plan.render(src.result, ctx, units, false);
  plan.setPose(brace, units);
  // The build lengths have their own section.
  planBody.querySelector('.plan-dims')?.remove();
  planBody.querySelector('svg.plan-view')?.removeAttribute('aria-describedby');
  const planSection = section('plan', 'String plan', figure('The whole bow at brace (dashed) and full draw (dotted)', planBody));

  const lengths = section('lengths', 'Build lengths', list(data.lengths),
    h('p', {}, 'Pitch-line lengths are the cord centre line between the termination points; add loops, serving and stretch for the build.'));

  const loadsBody = h('div', { class: 'loads-body' });
  const loadChart = createLoadChart(loadsBody, { width: LOADS_WIDTH });
  loadChart.render(ctx, units, false);
  const loads = section('loads', 'Loads', figure('String tension, cable tension and limb tip load against the draw', loadsBody),
    h('h3', {}, 'Largest loads'), list(data.loads));

  const table = section('table', 'Force table',
    h('table', { class: 'report-table' },
      h('caption', {}, 'Draw force and loads at 10 % steps of the draw from brace to full draw'),
      h('thead', {}, h('tr', {}, ...data.table.head.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...data.table.rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c)))))));

  const note = h('p', { class: 'report-note', 'data-testid': 'report-note' }, data.note);
  const root = h('article', { class: 'report', 'data-testid': 'report', 'aria-label': 'Print report' },
    head, inputs, target, results, force, camSection, planSection, lengths, loads, table, note);

  // Static figures: no zoom buttons, no focus stops, no test ids of the page.
  for (const el of root.querySelectorAll('.camview-controls')) el.remove();
  for (const el of root.querySelectorAll('[tabindex]')) el.removeAttribute('tabindex');
  for (const el of root.querySelectorAll('[data-testid]')) {
    if (!el.getAttribute('data-testid')?.startsWith('report')) el.removeAttribute('data-testid');
  }

  return {
    root,
    destroy() {
      cam.destroy();
      plan.destroy();
      loadChart.destroy();
      root.remove();
    },
  };
}

/**
 * Build the report on beforeprint and remove it on afterprint. Ctrl+P and
 * the print command of the browser print it too.
 * @param {() => ReportSource | null} source null prints the page unchanged
 */
export function attachReport(source) {
  /** @type {Report | null} */
  let report = null;
  const clear = () => {
    report?.destroy();
    report = null;
    document.body.classList.remove('printing-report');
  };
  window.addEventListener('beforeprint', () => {
    clear();
    const src = source();
    if (!src) return;
    report = buildReport(src);
    document.body.append(report.root);
    document.body.classList.add('printing-report');
  });
  window.addEventListener('afterprint', clear);
}
