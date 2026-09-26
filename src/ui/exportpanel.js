/**
 * Export panel: a ZIP of all files, one button per file, a print report
 * button, the source of the export and its warnings. Exports always use the last cam that met every
 * check (a full solve without problems) and the state it was solved for.
 * The files are built once per cam, draw and force unit and calendar day:
 * in idle time while the panel is on screen, or at the first click.
 * @module ui/exportpanel
 */

import { designId, exportFiles, exportZip } from '../export/files.js';
import { h, setAttrs } from './dom.js';
import { download } from './download.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('../export/files.js').ExportSet} ExportSet */

/** Wait after a new cam before the files are built in the background (ms). */
const IDLE_DELAY = 800;

/** Longest wait for idle time after IDLE_DELAY (ms). */
const IDLE_TIMEOUT = 2000;

/** Title of the print button while no cam meets every check. */
export const PRINT_OFF_TITLE = 'No cam meets every check yet; the report needs a full solve without problems';

/** Parts of the single-file buttons, grouped. */
const GROUPS = Object.freeze([
  {
    title: 'Cam plates (DXF, cut files)',
    parts: [
      ['plate1-string-flange', '1 Flange, string side'],
      ['plate2-string-groove', '2 String groove'],
      ['plate3-middle-flange', '3 Middle flange'],
      ['plate4-cable-groove', '4 Cable groove'],
      ['plate5-cable-flange', '5 Flange, cable side'],
    ],
  },
  { title: 'Drawings (DXF)', parts: [['reference', 'Reference drawing'], ['string-plan', 'String plan']] },
  {
    title: 'Solids (STEP)',
    parts: [
      ['step-cam', 'All plates, stacked'],
      ['step-plate1-string-flange', '1 Flange, string side'],
      ['step-plate2-string-groove', '2 String groove'],
      ['step-plate3-middle-flange', '3 Middle flange'],
      ['step-plate4-cable-groove', '4 Cable groove'],
      ['step-plate5-cable-flange', '5 Flange, cable side'],
    ],
  },
  { title: 'Data (CSV)', parts: [['force-curve', 'Force table']] },
  {
    title: 'Timing (analysis only)',
    parts: [['timing-string-plan', 'String plan with the timing settings (DXF)'], ['timing-table', 'Timing table (CSV)']],
  },
]);

/** Index of the timing group in GROUPS: shown only while a timing setting is not 0. */
const TIMING_GROUP = GROUPS.length - 1;

/**
 * True when any timing setting of a state is not 0: the export then holds
 * the timing files.
 * @param {ProjectState} state
 */
export function timingChanged(state) {
  const t = state.tuning;
  return t.topCable !== 0 || t.bottomCable !== 0 || t.string !== 0 || t.nockHeight !== 0;
}

/**
 * Status text of the panel, or null to keep the text shown. A solve that
 * has run for less than PENDING_DELAY keeps the text, so a quick edit does
 * not announce anything.
 * @param {{ hasCam: boolean, busy: boolean, pending: boolean, current: boolean, id: string }} s
 *   hasCam: a cam met every check; current: it belongs to the inputs now;
 *   pending: the running solve has taken PENDING_DELAY or longer
 * @returns {string | null}
 */
export function exportStatus(s) {
  if (!s.hasCam) {
    return s.busy
      ? 'Solving… exports are available once a cam meets every check'
      : 'No cam meets every check yet; exports need a full solve without problems';
  }
  if (s.current) return `Exports the current cam, design ${s.id}`;
  if (s.busy) return s.pending ? `Solving… exports use design ${s.id} until the new cam meets every check` : null;
  return `Exports the last cam that met every check, design ${s.id}; later edits are not included`;
}

/**
 * Cache key of an export set: the units the CSV uses and the local day in
 * the file names.
 * @param {Units} units
 * @param {Date} date
 */
export function exportKey(units, date) {
  return `${units.draw}|${units.force}|${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * @typedef {object} ExportView
 * @property {{ result: SolveResult, state: ProjectState } | null} lastGood
 * @property {ProjectState} now current project state
 * @property {boolean} busy a solve is running
 * @property {boolean} [pending] the running solve has taken PENDING_DELAY or longer
 */

/**
 * Build the export panel inside a container.
 * @param {HTMLElement} container
 * @param {{ version: string, date?: () => Date }} options
 * @returns {{ render: (view: ExportView) => void }}
 */
export function createExportPanel(container, { version, date = () => new Date() }) {
  const status = h('p', { class: 'export-status', role: 'status', 'data-testid': 'export-status' });
  const note = h('p', { class: 'hint', 'data-testid': 'export-note' });
  const zip = h('button', { type: 'button', class: 'export-btn export-zip', 'data-testid': 'export-zip' }, 'All files (ZIP)');
  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  const groups = GROUPS.map((g, i) => {
    const headingId = `export-group-${i}`;
    const list = h('div', { class: 'export-buttons', role: 'group', 'aria-labelledby': headingId });
    for (const [part, label] of g.parts) {
      const b = h('button', { type: 'button', class: 'export-btn', 'data-testid': `export-${part}` }, label);
      buttons.set(part, b);
      list.append(b);
    }
    return h('div', { class: 'export-group', 'data-testid': `export-group-${i}` }, h('h3', { class: 'export-heading', id: headingId }, g.title), list);
  });
  const timingGroup = groups[TIMING_GROUP];
  timingGroup.hidden = true;
  // The report itself is built on beforeprint (ui/report), so the print
  // command of the browser prints it too.
  const print = h('button', { type: 'button', class: 'export-btn', 'data-testid': 'export-print' }, 'Print report');
  groups.push(h('div', { class: 'export-group' },
    h('h3', { class: 'export-heading', id: 'export-group-report' }, 'Report'),
    h('div', { class: 'export-buttons', role: 'group', 'aria-labelledby': 'export-group-report' }, print)));
  const warnings = h('ul', { class: 'export-warnings', 'data-testid': 'export-warnings' });
  warnings.hidden = true;
  const alert = h('div', { 'data-testid': 'export-alert' });
  const plates = h('p', { class: 'hint' },
    'Top and bottom cams use the same plates: cut each plate twice and turn the bottom set over. '
      + 'Plates stack from 1 on the string side to 5 on the cable side.');
  container.append(status, zip, ...groups, warnings, note, plates, alert);

  /** @type {ExportView | null} */
  let view = null;
  /** @type {{ key: string, result: SolveResult, set: ExportSet, date: Date } | null} */
  let cache = null;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let idle = 0;
  /** Cam whose export failed; its error stays until another cam comes. @type {SolveResult | null} */
  let failed = null;
  // Background builds wait until the panel is on screen; without an
  // observer the panel counts as visible.
  let visible = typeof IntersectionObserver === 'undefined';
  if (!visible) {
    new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) schedule();
    }).observe(container);
  }

  /**
   * Whether the cache holds the set of this view for this day.
   * @param {ExportView} v
   * @param {Date} d
   */
  const cached = (v, d) => cache !== null && v.lastGood !== null && cache.result === v.lastGood.result
    && cache.key === exportKey(v.now.units, d);

  /**
   * Files of the last cam that met every check, built now if needed.
   * @returns {ExportSet | null}
   */
  function build() {
    const v = view;
    if (!v || !v.lastGood) return null;
    const d = date();
    if (cache && cached(v, d)) return cache.set;
    const out = exportFiles(v.lastGood.result, v.lastGood.state, { date: d, version, units: v.now.units });
    if (!out.set) {
      failed = v.lastGood.result;
      showError(`The export failed: ${out.error}`);
      return null;
    }
    cache = { key: exportKey(v.now.units, d), result: v.lastGood.result, set: out.set, date: d };
    markMissing(out.set);
    failed = null;
    alert.replaceChildren();
    showWarnings(out.set.warnings);
    return out.set;
  }

  /** Build in the background once the cam has settled and the panel shows. */
  function schedule() {
    if (idle || !visible || !view?.lastGood || view.lastGood.result === failed || cached(view, date())) return;
    idle = setTimeout(() => {
      idle = 0;
      const run = () => {
        if (view && !view.busy && visible) build();
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: IDLE_TIMEOUT });
      else run();
    }, IDLE_DELAY);
  }

  /**
   * Buttons of files the set left out (a plate whose outline could not be
   * fitted has no STEP file) are marked off.
   * @param {ExportSet} set
   */
  function markMissing(set) {
    for (const [part, b] of buttons) {
      const missing = !set.files.some((f) => f.part === part);
      setAttrs(b, { 'aria-disabled': missing ? 'true' : null, title: missing ? 'Not in this export: see the warnings' : null });
    }
  }

  /** @param {string[]} list */
  function showWarnings(list) {
    warnings.replaceChildren(...list.map((w) => h('li', {}, w)));
    warnings.hidden = list.length === 0;
  }

  /** @param {string} text */
  function showError(text) {
    // A new element, so screen readers announce it.
    alert.replaceChildren(h('p', { role: 'alert', class: 'export-error' }, text));
  }

  /** @param {string | null} text null keeps the text shown */
  function say(text) {
    if (text !== null && status.textContent !== text) status.textContent = text;
  }

  /**
   * Run an export from a click; the download starts inside the click.
   * @param {(set: ExportSet) => void} action
   */
  function run(action) {
    alert.replaceChildren();
    const v = view;
    if (!v || !v.lastGood) {
      say(exportStatus({ hasCam: false, busy: v?.busy ?? false, pending: false, current: false, id: '' }));
      return;
    }
    const set = build();
    if (set) action(set);
  }

  zip.addEventListener('click', () => run((set) => {
    const out = exportZip(set, /** @type {NonNullable<typeof cache>} */ (cache).date);
    if (!out.bytes) {
      showError(`The ZIP failed: ${out.error}`);
      return;
    }
    download(out.name, out.bytes, 'application/zip');
    say(`Saved ${out.name}`);
  }));
  print.addEventListener('click', () => {
    alert.replaceChildren();
    if (!view?.lastGood) {
      say(exportStatus({ hasCam: false, busy: view?.busy ?? false, pending: false, current: false, id: '' }));
      return;
    }
    window.print();
  });
  for (const [part, b] of buttons) {
    b.addEventListener('click', () => run((set) => {
      const f = set.files.find((file) => file.part === part);
      if (!f) {
        say(`${b.textContent} is not in this export: see the warnings`);
        return;
      }
      download(f.name, f.text, f.mime);
      say(`Saved ${f.name}`);
    }));
  }

  return {
    render(next) {
      view = next;
      const has = next.lastGood !== null;
      for (const b of [zip, ...buttons.values()]) setAttrs(b, { 'aria-disabled': has ? null : 'true' });
      setAttrs(print, { 'aria-disabled': has ? null : 'true', title: has ? null : PRINT_OFF_TITLE });
      container.classList.toggle('export-off', !has);
      timingGroup.hidden = !(next.lastGood && timingChanged(next.lastGood.state));
      let id = '';
      let current = false;
      if (next.lastGood) {
        id = designId(next.lastGood.state);
        current = id === designId(next.now);
        const bore = next.lastGood.state.body.boreDiameter * 1000;
        note.textContent = `DXF and STEP files are in millimetres at 1:1. After import, the axle bore measures ${bore.toFixed(2)} mm.`;
      } else {
        note.textContent = 'DXF and STEP files are in millimetres at 1:1.';
      }
      say(exportStatus({ hasCam: has, busy: next.busy, pending: next.pending ?? false, current, id }));
      if (failed !== null && next.lastGood?.result !== failed) {
        failed = null;
        alert.replaceChildren();
      }
      if (!has) {
        showWarnings([]);
        return;
      }
      if (cached(next, date())) {
        markMissing(/** @type {NonNullable<typeof cache>} */ (cache).set);
        showWarnings(/** @type {NonNullable<typeof cache>} */ (cache).set.warnings);
        return;
      }
      showWarnings([]);
      if (idle) {
        clearTimeout(idle);
        idle = 0;
      }
      schedule();
    },
  };
}
