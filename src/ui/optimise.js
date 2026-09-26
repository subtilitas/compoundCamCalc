/**
 * Optimise section of the String track group: a goal select, the
 * "Optimise shape" button, the progress of a run with Stop, and a
 * before/after table with Apply and Discard. A run searches in the optimise
 * worker (worker/optimise.worker.js). The rest of the String track group is
 * locked while it runs; any change of the design stops the run and
 * discards its result, a change of the units does not. The goal select
 * stays locked while a result waits for Apply or Discard. Apply sets the
 * free-form track in one undo step.
 * @module ui/optimise
 */

import { GOALS, OPTIMISE_BUDGET, OPTIMISE_TIME_LIMIT } from '../core/optimise.js';
import { ANALYSIS_ONLY } from '../state/schema.js';
import { dimsText, fixed, forceText } from './display.js';
import { h } from './dom.js';
import { sampledText } from './trackeditor.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('../state/store.js').Store} Store */
/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/optimise.js').OptimiseGoal} OptimiseGoal */
/** @typedef {import('../core/optimise.js').Evaluation} Evaluation */
/** @typedef {import('../core/optimise.js').Progress} Progress */
/** @typedef {import('../core/optimise.js').Improvement} Improvement */
/** @typedef {import('../core/optimise.js').StopReason} StopReason */
/** @typedef {import('../worker/optimise.worker.js').OptimiseRequest} OptimiseRequest */
/** @typedef {import('../worker/optimise.worker.js').OptimiseMessage} OptimiseMessage */

/**
 * @typedef {object} OptimiseWorker
 * @property {(data: OptimiseRequest) => void} postMessage
 * @property {() => void} terminate
 * @property {((event: { data: OptimiseMessage }) => void) | null} onmessage
 * @property {((event: unknown) => void) | null} onerror
 */

/** URL parameter that lowers the solve budget of a run, for the browser tests. */
export const BUDGET_PARAM = 'optimise-budget';

/**
 * Solve budget from the query string of the page: an integer from 1 to
 * OPTIMISE_BUDGET in the parameter BUDGET_PARAM, otherwise OPTIMISE_BUDGET.
 * @param {string} search location.search
 */
export function budgetFromSearch(search) {
  const text = new URLSearchParams(search).get(BUDGET_PARAM);
  const n = text !== null && /^\d+$/.test(text) ? Number(text) : NaN;
  return n >= 1 && n <= OPTIMISE_BUDGET ? n : OPTIMISE_BUDGET;
}

/**
 * True when two states describe the same design; the units and the
 * analysis-only sections (ANALYSIS_ONLY) may differ.
 * @param {ProjectState} a
 * @param {ProjectState} b
 */
export function sameDesign(a, b) {
  if (a === b) return true;
  /** @param {ProjectState} s */
  const design = (s) => {
    /** @type {Record<string, unknown>} */
    const d = { ...s, units: null };
    for (const key of ANALYSIS_ONLY) delete d[key];
    return JSON.stringify(d);
  };
  return design(a) === design(b);
}

/**
 * Why "Optimise shape" is disabled, or '' when it is enabled. A design with
 * plausibility warnings but no diagnostic may start: the cam goal is meant
 * for a cam-size warning.
 * @param {object} input
 * @param {boolean} input.workers the browser runs module workers
 * @param {{ result: SolveResult, state: ProjectState } | null} input.latest
 *   latest solve result shown
 * @param {ProjectState} input.state current state
 */
export function disabledReason({ workers, latest, state }) {
  if (!workers) return 'Optimise needs Web Workers, which this browser does not run.';
  if (!latest || latest.state !== state || latest.result.resolution !== 'full') {
    return 'Optimise starts once the full solve of the current design has finished.';
  }
  if (latest.result.status !== 'ok') return 'Optimise starts from a design that meets every check. See Results for the problems.';
  return '';
}

/**
 * Objective of a goal as text with unit.
 * @param {OptimiseGoal} goal
 * @param {number} value (m or N)
 * @param {Units} units
 */
function objectiveText(goal, value, units) {
  return goal === 'cam' ? dimsText(value, units) : `${forceText(value, units)} ${units.force}`;
}

/**
 * Progress of a run as one line.
 * @param {OptimiseGoal} goal
 * @param {Progress | null} progress null before the first solve
 * @param {number} elapsed (ms)
 * @param {Units} units
 */
export function progressText(goal, progress, elapsed, units) {
  const time = `${fixed(elapsed / 1000, 1)} s`;
  if (!progress) return `Solving the current design, ${time}`;
  const halvings = Math.round(progress.halvings);
  const best = goal === 'cam' ? 'smallest cam so far' : 'best force difference so far';
  return `${progress.solves} of ${progress.budget} solves, step halved ${halvings} ${halvings === 1 ? 'time' : 'times'}, ${time}; `
    + `${best} ${objectiveText(goal, progress.best, units)}`;
}

/**
 * Rows of the before/after table.
 * @param {Evaluation} before
 * @param {Evaluation} after
 * @param {Units} units
 * @returns {{ label: string, before: string, after: string }[]}
 */
export function comparisonRows(before, after, units) {
  /** @type {[string, (e: Evaluation) => string][]} */
  const rows = [
    ['Largest cam dimension', (e) => dimsText(e.camSize, units)],
    ['Largest force difference', (e) => `${forceText(e.forceDifference, units)} ${units.force}`],
    ['Let-off', (e) => `${fixed(e.letOff * 100, 1)} %`],
    ['Sharpest string bend', (e) => dimsText(e.stringMinRho, units)],
  ];
  return rows.map(([label, text]) => ({ label, before: text(before), after: text(after) }));
}

/**
 * Message at the end of a run without a better track.
 * @param {StopReason | 'stopped'} reason
 * @param {number} solves
 */
export function noResultText(reason, solves) {
  if (reason === 'start') return 'The current design does not meet every check, so Optimise has nothing to keep. See Results for the problems.';
  if (reason === 'start-coarse') {
    return 'The current design meets every check at full resolution, but not in the coarse solve the search compares '
      + 'candidates with, so Optimise cannot start.';
  }
  const how = reason === 'stopped' ? `Stopped after ${solves} solves.`
    : reason === 'time' ? `The run reached the time limit of ${OPTIMISE_TIME_LIMIT / 1000} s.`
      : reason === 'budget' ? `The run used all ${solves} solves.`
        : `The search ended after ${solves} solves.`;
  return `No better shape found. ${how} The track stays as it is.`;
}

/**
 * Note above the before/after table.
 * @param {StopReason | 'stopped'} reason
 * @param {number} solves
 */
export function resultText(reason, solves) {
  const how = reason === 'stopped' ? `Stopped after ${solves} solves; the best shape so far is kept.`
    : reason === 'time' ? `The run reached the time limit of ${OPTIMISE_TIME_LIMIT / 1000} s; the best shape so far is kept.`
      : reason === 'budget' ? `The run used all ${solves} solves.`
        : `The search ended after ${solves} solves.`;
  return `A better free-form track was found. ${how} Apply sets it as the string track.`;
}

/**
 * Note on the start of a search from an eccentric or elliptical track that
 * 16 points do not follow closely, or '' when the sampled track follows it.
 * @param {import('../core/freeform.js').SampledTrack} sampled
 * @param {import('../state/schema.js').StringTrack['shape']} shape
 * @param {Units} units
 */
export function searchStartText(sampled, shape, units) {
  const text = sampledText(sampled, shape, units);
  return text ? `${text} The search starts from this sampled track; the Before column is the ${shape === 'ellipse' ? 'ellipse' : 'eccentric circle'}.` : '';
}

/**
 * Default worker: the optimise module worker.
 * @returns {OptimiseWorker}
 */
function spawnOptimiseWorker() {
  return /** @type {OptimiseWorker} */ (/** @type {unknown} */ (
    new Worker(new URL('../worker/optimise.worker.js', import.meta.url), { type: 'module' })
  ));
}

/**
 * Create the Optimise section.
 * @param {Store} store
 * @param {object} [options]
 * @param {() => OptimiseWorker} [options.spawn] creates the worker of a run
 * @param {boolean} [options.workers] the browser runs workers (default:
 *   Worker exists)
 * @param {number} [options.budget] solve budget of a run (default OPTIMISE_BUDGET)
 * @param {(locked: boolean) => void} [options.lock] locks or unlocks the
 *   rest of the String track group
 * @returns {{ element: HTMLElement, setLatest: (latest: { result: SolveResult, state: ProjectState } | null) => void }}
 */
export function createOptimise(store, options = {}) {
  const spawn = options.spawn ?? spawnOptimiseWorker;
  let workers = options.workers ?? typeof Worker !== 'undefined';
  const budget = options.budget ?? OPTIMISE_BUDGET;
  const lock = options.lock ?? (() => {});

  const goalSelect = h('select', { id: 'c-optimise-goal', 'data-testid': 'optimise-goal' });
  for (const [value, label] of Object.entries(GOALS)) goalSelect.append(h('option', { value }, label));
  const run = h('button', { type: 'button', class: 'file-primary', 'aria-describedby': 'optimise-reason', 'data-testid': 'optimise-run' }, 'Optimise shape');
  const reason = h('p', { class: 'hint', id: 'optimise-reason', 'data-testid': 'optimise-reason' });
  const bar = h('progress', { max: String(budget), value: '0', 'aria-label': 'Optimise solves', 'data-testid': 'optimise-bar' });
  const status = h('p', { class: 'hint', 'data-testid': 'optimise-progress' });
  const stop = h('button', { type: 'button', 'data-testid': 'optimise-stop' }, 'Stop');
  const running = h('div', { class: 'optimise-running', 'data-testid': 'optimise-running' }, bar, status, stop);
  const note = h('p', { class: 'hint', 'data-testid': 'optimise-note' });
  const body = h('tbody');
  const table = h('table', { class: 'optimise-table', 'data-testid': 'optimise-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Figure'), h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'After'))),
    body);
  const apply = h('button', { type: 'button', class: 'file-primary', 'data-testid': 'optimise-apply' }, 'Apply');
  const discard = h('button', { type: 'button', 'data-testid': 'optimise-discard' }, 'Discard');
  const result = h('div', { class: 'optimise-result', 'data-testid': 'optimise-result' },
    note, h('div', { class: 'table-scroll' }, table), h('div', { class: 'optimise-actions' }, apply, discard));
  const message = h('p', { class: 'hint', role: 'status', 'data-testid': 'optimise-message' });
  const element = h('section', { class: 'optimise', 'aria-labelledby': 'optimise-title', 'data-testid': 'optimise' },
    h('h3', { id: 'optimise-title', class: 'optimise-title' }, 'Optimise'),
    h('p', { class: 'hint' }, 'Searches for a free-form track that improves the goal and keeps every check, with margins. '
      + `A run takes up to ${budget} solves, usually 2 s to 45 s.`),
    h('div', { class: 'field unit-field' }, h('label', { for: 'c-optimise-goal' }, 'Goal'), goalSelect),
    h('div', { class: 'optimise-actions' }, run),
    reason, running, result, message);

  /** @type {'idle' | 'running' | 'result'} */
  let phase = 'idle';
  /** @type {OptimiseWorker | null} */
  let worker = null;
  /** @type {ProjectState | null} */
  let startState = null;
  /** @type {OptimiseGoal} */
  let goal = 'cam';
  /** @type {Evaluation | null} */
  let start = null;
  /** @type {Improvement | null} */
  let best = null;
  /** @type {Progress | null} */
  let progress = null;
  let startedAt = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let clock = null;
  /** @type {{ result: SolveResult, state: ProjectState } | null} */
  let latest = null;

  function render() {
    const s = store.getState();
    const why = disabledReason({ workers, latest, state: s });
    run.disabled = phase !== 'idle' || why !== '';
    // A result belongs to the goal of its run: the goal stays locked until
    // Apply or Discard.
    goalSelect.disabled = phase !== 'idle';
    reason.textContent = phase === 'idle' ? why : '';
    reason.hidden = reason.textContent === '';
    running.hidden = phase !== 'running';
    result.hidden = phase !== 'result';
    element.dataset.phase = phase;
    if (phase === 'running') {
      bar.value = progress?.solves ?? 0;
      status.textContent = progressText(goal, progress, performance.now() - startedAt, s.units);
      element.dataset.solves = String(progress?.solves ?? 0);
      element.dataset.improved = String(best !== null);
    }
    if (phase === 'result' && start && best) {
      body.replaceChildren(...comparisonRows(start, best.evaluation, s.units).map((r) =>
        h('tr', {}, h('th', { scope: 'row' }, r.label), h('td', {}, r.before), h('td', {}, r.after))));
    }
  }

  /** @param {string} text */
  const say = (text) => {
    message.textContent = text;
  };

  /** End the run: stop the worker and the clock, unlock the group. */
  function halt() {
    worker?.terminate();
    worker = null;
    if (clock !== null) clearInterval(clock);
    clock = null;
    lock(false);
  }

  /**
   * The run has ended: show the best track, or say that there is none.
   * @param {StopReason | 'stopped'} why
   * @param {number} solves
   * @param {import('../core/freeform.js').SampledTrack | null} [sampled]
   *   the analytic start track sampled for the search
   */
  function finish(why, solves, sampled = null) {
    const hadFocus = document.activeElement === stop;
    halt();
    const s = store.getState();
    const shape = startState?.stringTrack.shape ?? 'freeform';
    const sampling = sampled && why !== 'start' && why !== 'start-coarse' ? searchStartText(sampled, shape, s.units) : '';
    if (best && start) {
      phase = 'result';
      note.textContent = `${resultText(why, solves)}${sampling ? ` ${sampling}` : ''}`;
      say('');
    } else {
      phase = 'idle';
      say(`${noResultText(why, solves)}${sampling ? ` ${sampling}` : ''}`);
    }
    render();
    if (hadFocus) (phase === 'result' ? apply : run).focus();
  }

  /**
   * Drop the run or its result.
   * @param {string} text message, '' for none
   */
  function drop(text) {
    const hadFocus = element.contains(document.activeElement) && document.activeElement !== goalSelect;
    halt();
    phase = 'idle';
    best = null;
    start = null;
    startState = null;
    say(text);
    render();
    if (hadFocus && !run.disabled) run.focus();
  }

  /** @param {{ data: OptimiseMessage }} event */
  function onMessage(event) {
    const m = event.data;
    if (!m || phase !== 'running') return;
    if (m.type === 'start') start = m.start;
    else if (m.type === 'progress') progress = m.progress;
    else if (m.type === 'improved') best = m.improvement;
    else if (m.type === 'done') {
      finish(m.outcome.reason, m.outcome.solves, m.outcome.sampled);
      return;
    } else if (m.type === 'error') {
      finish('stopped', progress?.solves ?? 0);
      say(`The optimiser stopped with an internal error: ${m.message}.`);
      return;
    }
    render();
  }

  run.addEventListener('click', () => {
    const s = store.getState();
    if (phase !== 'idle' || disabledReason({ workers, latest, state: s })) return;
    /** @type {OptimiseWorker} */
    let w;
    try {
      w = spawn();
    } catch {
      workers = false;
      render();
      return;
    }
    worker = w;
    goal = goalSelect.value === 'force' ? 'force' : 'cam';
    startState = s;
    start = null;
    best = null;
    progress = null;
    startedAt = performance.now();
    phase = 'running';
    say('');
    let answered = false;
    w.onmessage = (event) => {
      if (w !== worker) return;
      answered = true;
      onMessage(event);
    };
    w.onerror = () => {
      if (w !== worker) return;
      // A worker that fails before its first message cannot start in this browser.
      if (!answered) workers = false;
      finish('stopped', progress?.solves ?? 0);
      say(answered ? 'The optimiser stopped with an error.' : 'The optimiser could not start in this browser.');
    };
    lock(true);
    clock = setInterval(render, 500);
    render();
    stop.focus();
    w.postMessage({ state: s, goal, budget });
  });

  stop.addEventListener('click', () => {
    if (phase === 'running') finish('stopped', progress?.solves ?? 0);
  });

  apply.addEventListener('click', () => {
    const s = store.getState();
    if (phase !== 'result' || !best || !startState) return;
    if (!sameDesign(s, startState)) {
      drop('The design changed after the run, so its result is discarded.');
      return;
    }
    const values = best.values;
    phase = 'idle';
    best = null;
    start = null;
    startState = null;
    // One undo step, also from an eccentric or elliptical track.
    if (store.inTransaction()) store.commitTransaction();
    const errors = store.dispatch({ type: 'setStringTrack', stringTrack: { shape: 'freeform', freeform: { values } } });
    say(errors.length > 0 ? errors[0].message : `Optimised free-form track applied, ${values.length} points. Undo restores the previous track.`);
    render();
    run.focus();
  });

  discard.addEventListener('click', () => drop('Optimise result discarded. The track stays as it is.'));

  store.subscribe((s, _previous, info) => {
    if (phase !== 'idle' && startState) {
      if (info.replaced) {
        drop('Another design was opened, so the Optimise run is discarded.');
        return;
      }
      if (!sameDesign(s, startState)) {
        drop(phase === 'running'
          ? 'The design changed during the run, so the run stopped and its result is discarded.'
          : 'The design changed after the run, so its result is discarded.');
        return;
      }
    }
    render();
  });

  render();
  return {
    element,
    setLatest(next) {
      latest = next;
      render();
    },
  };
}
