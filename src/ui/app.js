/**
 * Application wiring: store, editor, chart, table, settings, stats,
 * solver, results, cam view, toolbar, keyboard shortcuts, notices,
 * autosave, the File menu, share links, the Help button, the print report
 * and Optimise.
 * @module ui/app
 */

import { createStore } from '../state/store.js';
import { parseCurrent, serializeCurrent } from '../state/library.js';
import { LINK_DAMAGED, LINK_NEWER, decodeShare, encodeShare } from '../state/share.js';
import { loadCurrent, startAutosave, loadSaved } from './autosave.js';
import { createFileMenu } from './filemenu.js';
import { createHelpButton } from './help.js';
import { createCamView } from './camview.js';
import { bowPoseAt, createBowPose, createLayout } from '../core/layout.js';
import { createChart } from './chart.js';
import { byId, h } from './dom.js';
import { createEditor } from './editor.js';
import { createSettings } from './settings.js';
import { createStats } from './stats.js';
import { createResults } from './results.js';
import { createSolver } from './solver.js';
import { createPointTable } from './table.js';
import { createExportPanel } from './exportpanel.js';
import { createLoadChart } from './loadchart.js';
import { createScrubber } from './scrubber.js';
import { createStringPlan } from './stringplan.js';
import { attachReport } from './report.js';
import { budgetFromSearch, createOptimise } from './optimise.js';
import { createVersionSelect } from './versions.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */

/**
 * Show a dismissible notice, optionally with an action button that
 * removes the notice and runs the action.
 * @param {HTMLElement} area
 * @param {string} text
 * @param {{ label: string, run: () => void }} [action]
 */
function showNotice(area, text, action) {
  const close = h('button', { type: 'button', class: 'notice-close', 'aria-label': 'Dismiss notice', 'data-testid': 'notice-close' }, '×');
  const notice = h('div', { class: 'notice', role: 'status', 'data-testid': 'notice' }, h('p', {}, text));
  if (action) {
    const button = h('button', { type: 'button', class: 'notice-action', 'data-testid': 'notice-action' }, action.label);
    button.addEventListener('click', () => {
      notice.remove();
      action.run();
    });
    notice.append(button);
  }
  notice.append(close);
  close.addEventListener('click', () => notice.remove());
  area.append(notice);
}

/** Fragment of a share link, before the link text. */
export const SHARE_PREFIX = '#design=';

/**
 * Text of the solve status link that stays in view beside the settings.
 * @param {string} status
 * @param {number} problems
 */
export function chipText(status, problems) {
  if (status === 'busy') return 'Cam: solving…';
  if (status === 'preview') return 'Cam: preview, full check follows';
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
 * Whether two states hold the same inputs: the same object, or the same
 * section objects apart from the display units (the store keeps unchanged
 * sections).
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameInputs(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = /** @type {Record<string, unknown>} */ (a);
  const y = /** @type {Record<string, unknown>} */ (b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  keys.delete('units');
  return [...keys].every((k) => x[k] === y[k]);
}

/** A solve running longer than this marks the shown result as outdated (ms). */
export const PENDING_DELAY = 250;

/**
 * What the solve views show: the result the values come from (null after a
 * solver error, whose latest result belongs to an older input), whether the
 * cam shown is the last valid one in place of the current result, whether
 * the current result belongs to older inputs while a newer solve runs
 * (outdated), the status, the result drawn in the cam view, the result
 * whose achieved curve the chart shows and the result whose working arc the
 * track editor shows. The last valid cam can belong to another track, so the
 * editor gets the current result only, none when it has no achieved curve,
 * and none while its inputs differ from the current inputs (a newer solve
 * runs).
 * @template T
 * @param {Solved<T> | null} latest last delivered result
 * @param {Solved<T> | null} lastGood last delivered result with status ok
 * @param {'idle' | 'busy' | 'error'} solverStatus
 * @param {boolean} [pending] a solve has been running for PENDING_DELAY or longer
 * @param {T} [now] current inputs; without them the inputs count as the same
 */
export function solveView(latest, lastGood, solverStatus, pending = false, now = undefined) {
  // After a solver error only the last valid cam stays in view, dimmed.
  const failed = solverStatus === 'error';
  const current = failed ? null : latest;
  const stale = lastGood !== null && (failed || (current !== null && current.result.status !== 'ok'));
  // A coarse solve checks 100 samples only: without problems it is a
  // preview until the full solve of the same input confirms it.
  /** @type {'idle' | 'busy' | 'error' | 'preview' | SolveResult['status']} */
  const status = solverStatus === 'busy' ? 'busy'
    : failed ? 'error'
      : !current ? 'idle'
        : current.result.status === 'ok' && current.result.resolution === 'coarse' ? 'preview'
          : current.result.status;
  const outdated = pending && solverStatus === 'busy' && current !== null;
  const shown = stale ? lastGood : current;
  const withCurve = current?.result.achieved ? current : stale ? lastGood : null;
  const forEditor = current?.result.achieved && (now === undefined || sameInputs(current.state, now)) ? current : null;
  return { current, stale, outdated, status, shown, withCurve, forEditor };
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
  /** @type {{ saveNow: () => boolean } | null} */
  let autosave = null;
  const versions = createVersionSelect({
    channel: __APP_CHANNEL__,
    version: __APP_VERSION__,
    fragment: () => {
      try {
        return SHARE_PREFIX + encodeShare(store.getState(), fileMenu.current().name);
      } catch {
        return null;
      }
    },
  });
  const fileMenu = createFileMenu(byId('file-area', HTMLDivElement), store, {
    // Unreadable saved data (text null) means the working copy is the
    // default design, whatever the stored current design says.
    current: parseCurrent(loadCurrent(), saved.text),
    persist: () => autosave?.saveNow() ?? false,
    after: [createHelpButton(), versions.element],
  });

  const chart = createChart(byId('chart-wrap', HTMLDivElement), editor);
  const table = createPointTable(
    byId('point-rows', HTMLTableSectionElement),
    byId('th-draw', HTMLTableCellElement),
    byId('th-force', HTMLTableCellElement),
    editor,
  );
  const settings = createSettings(byId('settings-body', HTMLDivElement), store);
  // Optimise sits at the end of the String track group and locks the rest
  // of the group while it runs.
  const trackGroup = /** @type {HTMLElement} */ (document.querySelector('[data-testid="settings-string-track"]'));
  const optimise = createOptimise(store, {
    budget: budgetFromSearch(location.search),
    lock: (locked) => {
      for (const child of trackGroup.children) {
        if (child.tagName !== 'SUMMARY' && child !== optimise.element) child.toggleAttribute('inert', locked);
      }
      trackGroup.dataset.locked = String(locked);
    },
  });
  trackGroup.append(optimise.element);
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
    // A dialog of the File menu keeps its keys.
    if (document.querySelector('dialog[open]')) return;
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
  const plan = createStringPlan(byId('plan-body', HTMLDivElement));
  const loads = createLoadChart(byId('loads-body', HTMLDivElement));
  const exportPanel = createExportPanel(byId('export-body', HTMLDivElement), { version: __APP_VERSION__ });
  const scrubber = createScrubber(byId('scrub-body', HTMLDivElement), {
    panel: byId('scrub-panel', HTMLElement),
    onChange: () => showPose(),
  });
  /** Layout of the result drawn in the cam view, built once per result. */
  /** @type {{ result: SolveResult | null, layout: import('../core/layout.js').LayoutContext | null }} */
  let layoutOf = { result: null, layout: null };
  /** The achieved curve on the chart belongs to the result of the pose. */
  let markerOnCurve = false;
  const pose = createBowPose();
  /** @type {{ result: SolveResult, state: ProjectState } | null} */
  let lastGood = null;
  /** Count of design switches (store.replace); results carry the count of their request. */
  let generation = 0;
  /** @type {WeakMap<ProjectState, number>} */
  const generationOf = new WeakMap();
  /** @type {{ result: SolveResult, state: ProjectState } | null} */
  let latest = null;
  /** @type {'idle' | 'busy' | 'error'} */
  let solverStatus = 'idle';
  /** Start of the running solve (ms). */
  let busySince = 0;
  root.dataset.solveState = 'idle';

  /** Move every view to the draw position of the control. */
  function showPose() {
    const units = store.getState().units;
    const ctx = layoutOf.layout;
    const ok = ctx !== null && bowPoseAt(ctx, scrubber.x(), pose);
    const p = ok ? pose : null;
    camView.setPose(p, units);
    plan.setPose(p, units);
    loads.setPose(p, units);
    chart.setMarker(p ? p.x : null, markerOnCurve);
    scrubber.show(p, units);
    root.dataset.drawPosition = p ? String(p.x) : '';
  }

  function showSolve() {
    const pending = solverStatus === 'busy' && performance.now() - busySince >= PENDING_DELAY;
    const now = store.getState();
    const { current, stale, outdated, status, shown, withCurve, forEditor } = solveView(latest, lastGood, solverStatus, pending, now);
    const shownResult = shown?.result ?? null;
    markerOnCurve = withCurve !== null && withCurve === shown;
    if (layoutOf.result !== shownResult) {
      const built = shown && shownResult?.achieved ? createLayout(shownResult, shown.state.geometry).layout : null;
      layoutOf = { result: shownResult, layout: built };
    }
    const ctx = layoutOf.layout;
    scrubber.setDomain(ctx, now.units);
    plan.render(shownResult, ctx, now.units, stale, outdated);
    loads.render(ctx, now.units, stale, outdated);
    // Cached values show in the units selected now.
    results.render({
      status, result: current?.result ?? null, state: current ? { ...current.state, units: now.units } : now, stale, outdated,
    });
    // The drawn cam keeps its geometry; labels follow the current units.
    camView.render(
      shown?.result ?? null,
      shown ? { ...shown.state, units: now.units } : now,
      stale || outdated,
      stale ? solverStatus : outdated ? 'pending' : solverStatus,
    );
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
          stale: withCurve !== current || outdated,
          label: withCurve !== current ? 'Achieved, last valid cam'
            : withCurve.result.status === 'ok' ? 'Achieved' : 'Achieved, latest attempt',
        }
      : null);
    root.dataset.solveState = solverStatus === 'busy' ? 'busy' : solverStatus === 'error' ? 'error' : current ? 'ok' : 'idle';
    root.dataset.solveStatus = current?.result.status ?? '';
    root.dataset.solveResolution = current?.result.resolution ?? '';
    exportPanel.render({ lastGood, now, busy: solverStatus === 'busy', pending });
    settings.setResult(forEditor?.result ?? null);
    showPose();
  }

  const solver = createSolver({
    onResult(result, _resolution, state) {
      // A result for a design that was replaced since is dropped.
      if (generationOf.get(state) !== generation) {
        showSolve();
        return;
      }
      latest = { result, state };
      if (meetsEveryCheck(result)) lastGood = latest;
      optimise.setLatest(latest);
      showSolve();
    },
    onStatus(status) {
      if (status === 'busy' && solverStatus !== 'busy') {
        busySince = performance.now();
        // Mark the shown result outdated when the solve takes longer.
        setTimeout(() => {
          if (solverStatus === 'busy') showSolve();
        }, PENDING_DELAY + 10);
      }
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
    generationOf.set(s, generation);
    solver.request(s, resolution);
  };
  // Another design: no result of the previous one stays in view or in the
  // export panel, also none still in flight.
  store.subscribe((_s, _p, info) => {
    if (!info.replaced) return;
    generation++;
    latest = null;
    lastGood = null;
    optimise.setLatest(null);
    showSolve();
  });
  store.subscribe((s) => requestSolve(s));
  // Unit changes relabel the solve views at once.
  let shownUnits = store.getState().units;
  store.subscribe((s) => {
    if (s.units === shownUnits) return;
    shownUnits = s.units;
    showSolve();
  });
  showSolve();
  requestSolve(store.getState());
  // The report shows what the exports use: the last cam that met every check.
  attachReport(() => (lastGood
    ? {
        result: lastGood.result,
        state: lastGood.state,
        now: store.getState(),
        name: fileMenu.current().name,
        version: __APP_VERSION__,
        date: new Date(),
      }
    : null));

  if (saved.notice) showNotice(notices, saved.notice);
  let storageWarned = false;
  root.dataset.autosave = 'idle';
  autosave = startAutosave(store, (state) => {
    root.dataset.autosave = state;
    if (state === 'error' && !storageWarned) {
      storageWarned = true;
      showNotice(notices, 'This browser does not allow saving. Changes are lost when the page is closed.');
    }
  }, { current: (text) => serializeCurrent(fileMenu.current(), text) });

  // Share links. Before autosave starts, persist returns false, so links
  // are read only from here on. Only the newest link waiting for a dialog
  // to close applies.
  /** @type {string | null} */
  let pendingLink = null;
  let handling = false;

  /** Resolve when every open dialog has closed. */
  async function dialogsClosed() {
    for (let d = document.querySelector('dialog[open]'); d; d = document.querySelector('dialog[open]')) {
      const open = d;
      await new Promise((resolve) => open.addEventListener('close', resolve, { once: true }));
    }
  }

  /**
   * Open a decoded design; a design kept open leaves a notice to open the
   * shared one later.
   * @param {ProjectState} state
   * @param {string} name
   * @param {boolean} filled
   * @param {readonly string[]} dropped
   */
  async function openLink(state, name, filled, dropped) {
    if (await fileMenu.openShared(state, name, filled, dropped)) return;
    showNotice(notices, `The shared design "${name}" was not opened; your design stays open.`, {
      label: 'Open shared design',
      run: () => void openLink(state, name, filled, dropped),
    });
  }

  async function handleLinks() {
    if (handling) return;
    handling = true;
    try {
      while (pendingLink !== null) {
        await dialogsClosed();
        const text = pendingLink;
        pendingLink = null;
        const r = decodeShare(text);
        try {
          if (r.state) await openLink(r.state, r.name, r.filled, r.dropped);
          else showNotice(notices, `The shared design could not be opened. ${r.error}`);
        } catch {
          showNotice(notices, `The shared design could not be opened. ${LINK_DAMAGED}`);
        }
        // The fragment goes once the link is handled: a reload does not
        // open it again. A newer link stays until its turn. A link from a
        // newer app keeps its fragment, so a reload that loads the newer
        // app opens it.
        if (location.hash === SHARE_PREFIX + text && r.error !== LINK_NEWER) {
          history.replaceState(null, '', location.pathname + location.search);
        }
      }
    } finally {
      handling = false;
    }
  }

  // Other fragments, such as the #results-title of the solve chip, are
  // page anchors and stay.
  const readLink = () => {
    if (!location.hash.startsWith(SHARE_PREFIX)) return;
    pendingLink = location.hash.slice(SHARE_PREFIX.length);
    void handleLinks();
  };
  window.addEventListener('hashchange', readLink);
  readLink();
}
