/**
 * Application wiring: store, editor, chart, table, settings, stats,
 * solver, results, cam view, toolbar, keyboard shortcuts, notices and
 * autosave.
 * @module ui/app
 */

import { createStore } from '../state/store.js';
import { startAutosave, loadSaved } from './autosave.js';
import { createCamView } from './camview.js';
import { createChart } from './chart.js';
import { byId, h } from './dom.js';
import { createEditor } from './editor.js';
import { createSettings } from './settings.js';
import { createStats } from './stats.js';
import { createResults } from './results.js';
import { createSolver } from './solver.js';
import { createPointTable } from './table.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */

/**
 * Show a dismissible notice.
 * @param {HTMLElement} area
 * @param {string} text
 */
function showNotice(area, text) {
  const close = h('button', { type: 'button', class: 'notice-close', 'aria-label': 'Dismiss notice', 'data-testid': 'notice-close' }, '×');
  const notice = h('div', { class: 'notice', role: 'status', 'data-testid': 'notice' }, h('p', {}, text), close);
  close.addEventListener('click', () => notice.remove());
  area.append(notice);
}

/**
 * Text of the solve status link that stays in view beside the settings.
 * @param {string} status
 * @param {number} problems
 */
export function chipText(status, problems) {
  if (status === 'busy') return 'Cam: solving…';
  if (status === 'ok') return 'Cam: meets every check';
  if (status === 'infeasible') return `Cam: ${problems} ${problems === 1 ? 'problem' : 'problems'}, see Results`;
  if (status === 'no-convergence') return 'Cam: the solver did not converge, see Results';
  return 'Cam: the solver stopped with an error';
}

/**
 * @template T
 * @typedef {{ result: SolveResult, state: T }} Solved
 */

/**
 * What the solve views show: the result the values come from (null after a
 * solver error, whose latest result belongs to an older input), whether the
 * cam shown is the last valid one in place of the current result, the
 * status, the result drawn in the cam view and the result whose achieved
 * curve the chart shows.
 * @template T
 * @param {Solved<T> | null} latest last delivered result
 * @param {Solved<T> | null} lastGood last delivered result with status ok
 * @param {'idle' | 'busy' | 'error'} solverStatus
 */
export function solveView(latest, lastGood, solverStatus) {
  // After a solver error only the last valid cam stays in view, dimmed.
  const failed = solverStatus === 'error';
  const current = failed ? null : latest;
  const stale = lastGood !== null && (failed || (current !== null && current.result.status !== 'ok'));
  /** @type {'idle' | 'busy' | 'error' | SolveResult['status']} */
  const status = solverStatus === 'busy' ? 'busy'
    : failed ? 'error'
      : current ? current.result.status : 'idle';
  const shown = stale ? lastGood : current;
  const withCurve = current?.result.achieved ? current : stale ? lastGood : null;
  return { current, stale, status, shown, withCurve };
}

/**
 * Whether a result may stand in as the last cam that met every check: only
 * a full solve checks every sample, a coarse one can miss a violation.
 * @param {SolveResult} result
 */
export function meetsEveryCheck(result) {
  return result.status === 'ok' && result.resolution === 'full';
}

/** Start the application on the page. */
export function startApp() {
  const root = byId('app', HTMLElement);
  const notices = byId('notices', HTMLDivElement);
  const saved = loadSaved();
  const store = createStore(saved.state);
  const editor = createEditor(store);

  const chart = createChart(byId('chart-wrap', HTMLDivElement), editor);
  const table = createPointTable(
    byId('point-rows', HTMLTableSectionElement),
    byId('th-draw', HTMLTableCellElement),
    byId('th-force', HTMLTableCellElement),
    editor,
  );
  const settings = createSettings(byId('settings-body', HTMLDivElement), store);
  const stats = createStats(byId('stats', HTMLDListElement));
  const status = byId('edit-status', HTMLParagraphElement);
  const modeBadge = byId('curve-mode', HTMLSpanElement);
  const addButton = byId('btn-add-point', HTMLButtonElement);
  const deleteButton = byId('btn-delete-point', HTMLButtonElement);
  const undoButton = byId('btn-undo', HTMLButtonElement);
  const redoButton = byId('btn-redo', HTMLButtonElement);
  const resetButton = byId('btn-reset-curve', HTMLButtonElement);
  const details = byId('point-table', HTMLDetailsElement);
  if (window.matchMedia('(min-width: 960px)').matches) details.open = true;

  let rev = 0;
  let shownCount = 0;
  function render() {
    const s = store.getState();
    chart.render(s);
    table.render(s);
    settings.render(s);
    stats.render(s);
    const custom = s.curve.mode === 'custom';
    modeBadge.textContent = custom ? 'Custom' : 'Parametric';
    modeBadge.dataset.mode = s.curve.mode;
    resetButton.disabled = !custom;
    const selected = editor.selected();
    deleteButton.disabled = !editor.canRemove(selected);
    undoButton.disabled = !store.canUndo();
    redoButton.disabled = !store.canRedo();
    const text = editor.message();
    const count = editor.messageCount();
    if (count !== shownCount && text !== '' && status.textContent === text) {
      // The same message again: clear it and set it in the next frame, so
      // the status region announces it again.
      status.textContent = '';
      requestAnimationFrame(() => {
        if (editor.message() === text) status.textContent = text;
      });
    } else if (status.textContent !== text) {
      status.textContent = text;
    }
    shownCount = count;
    root.dataset.pointCount = String(s.curve.points.length);
    root.dataset.selected = selected >= 0 ? String(selected + 1) : '';
    root.dataset.curveMode = s.curve.mode;
    root.dataset.rev = String(++rev);
  }

  addButton.addEventListener('click', () => editor.addInWidestGap());
  deleteButton.addEventListener('click', () => {
    const hadFocus = document.activeElement === deleteButton;
    if (editor.remove(editor.selected()) && hadFocus) addButton.focus();
  });
  /**
   * Run a toolbar action and keep keyboard focus in the toolbar when the
   * action disables the focused button. Chromium moves focus to the body as
   * soon as the focused button is disabled, so focus is read before.
   * @param {HTMLButtonElement} button
   * @param {() => void} action
   * @param {() => HTMLButtonElement} fallback
   */
  function keepFocus(button, action, fallback) {
    const hadFocus = document.activeElement === button;
    action();
    if (hadFocus && button.disabled) fallback().focus();
  }
  undoButton.addEventListener('click', () =>
    keepFocus(undoButton, () => store.undo(), () => (redoButton.disabled ? addButton : redoButton)));
  redoButton.addEventListener('click', () =>
    keepFocus(redoButton, () => store.redo(), () => (undoButton.disabled ? addButton : undoButton)));
  resetButton.addEventListener('click', () =>
    keepFocus(resetButton, () => {
      store.dispatch({ type: 'regenerateCurve' });
      editor.say('Curve regenerated from the parameters');
    }, () => addButton));

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target;
    // Text fields keep their own undo.
    if ((t instanceof HTMLInputElement && t.type === 'text') || t instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey)) {
      e.preventDefault();
      store.redo();
    }
  });

  store.subscribe(render);
  editor.onChange(render);
  render();

  // Solver: coarse while a drag or slider gesture is open, full otherwise;
  // the latest request wins. The cam view keeps the last result that met
  // every check, dimmed, while the current one does not.
  const results = createResults(byId('results-body', HTMLDivElement));
  const solveChip = byId('solve-chip', HTMLAnchorElement);
  const camView = createCamView(byId('cam-body', HTMLDivElement));
  /** @type {{ result: SolveResult, state: ProjectState } | null} */
  let lastGood = null;
  /** @type {{ result: SolveResult, state: ProjectState } | null} */
  let latest = null;
  /** @type {'idle' | 'busy' | 'error'} */
  let solverStatus = 'idle';
  root.dataset.solveState = 'idle';

  function showSolve() {
    const { current, stale, status, shown, withCurve } = solveView(latest, lastGood, solverStatus);
    const now = store.getState();
    results.render({ status, result: current?.result ?? null, state: current?.state ?? now, stale });
    // The drawn cam keeps its geometry; labels follow the current units.
    camView.render(shown?.result ?? null, shown ? { ...shown.state, units: now.units } : now, stale, solverStatus);
    solveChip.textContent = status === 'idle' ? '' : chipText(status, current?.result.diagnostics.length ?? 0);
    solveChip.dataset.status = status;
    chart.setAchieved(withCurve?.result.achieved
      ? {
          x: withCurve.result.achieved.x,
          F: withCurve.result.achieved.F,
          ranges: (current?.result.diagnostics ?? [])
            .filter((d) => d.xRange)
            .map((d) => ({ from: /** @type {[number, number]} */ (d.xRange)[0], to: /** @type {[number, number]} */ (d.xRange)[1], code: d.code })),
          // Dimmed while a newer solve runs, and when it is the last valid
          // curve shown in place of a failing result.
          stale: withCurve !== current || solverStatus === 'busy',
          label: withCurve.result.status === 'ok' ? 'Achieved' : 'Achieved, latest attempt',
        }
      : null);
    root.dataset.solveState = solverStatus === 'busy' ? 'busy' : solverStatus === 'error' ? 'error' : current ? 'ok' : 'idle';
    root.dataset.solveStatus = current?.result.status ?? '';
    root.dataset.solveResolution = current?.result.resolution ?? '';
  }

  const solver = createSolver({
    onResult(result, _resolution, state) {
      latest = { result, state };
      if (meetsEveryCheck(result)) lastGood = latest;
      showSolve();
    },
    onStatus(status) {
      solverStatus = status;
      showSolve();
    },
  });
  // The last request: a new request for the same state object only goes out
  // when it asks for a finer resolution (a drag that ends without a move,
  // or a selection, commits the unchanged state).
  /** @type {{ state: ProjectState, resolution: 'coarse' | 'full' } | null} */
  let sent = null;
  /** @param {ProjectState} s */
  const requestSolve = (s) => {
    const resolution = store.inTransaction() ? 'coarse' : 'full';
    if (sent && sent.state === s && (sent.resolution === 'full' || resolution === 'coarse')) return;
    sent = { state: s, resolution };
    solver.request(s, resolution);
  };
  store.subscribe((s) => requestSolve(s));
  showSolve();
  requestSolve(store.getState());

  if (saved.notice) showNotice(notices, saved.notice);
  let storageWarned = false;
  root.dataset.autosave = 'idle';
  startAutosave(store, (state) => {
    root.dataset.autosave = state;
    if (state === 'error' && !storageWarned) {
      storageWarned = true;
      showNotice(notices, 'This browser does not allow saving. Changes are lost when the page is closed.');
    }
  });
}
