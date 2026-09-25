/**
 * Application wiring: store, editor, chart, table, settings, stats,
 * toolbar, keyboard shortcuts, notices and autosave.
 * @module ui/app
 */

import { createStore } from '../state/store.js';
import { startAutosave, loadSaved } from './autosave.js';
import { createChart } from './chart.js';
import { byId, h } from './dom.js';
import { createEditor } from './editor.js';
import { createSettings } from './settings.js';
import { createStats } from './stats.js';
import { createPointTable } from './table.js';

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
  const regenerate = byId('btn-regenerate', HTMLButtonElement);
  const addButton = byId('btn-add-point', HTMLButtonElement);
  const deleteButton = byId('btn-delete-point', HTMLButtonElement);
  const undoButton = byId('btn-undo', HTMLButtonElement);
  const redoButton = byId('btn-redo', HTMLButtonElement);
  const resetButton = byId('btn-reset-curve', HTMLButtonElement);
  const details = byId('point-table', HTMLDetailsElement);
  if (window.matchMedia('(min-width: 960px)').matches) details.open = true;

  let rev = 0;
  function render() {
    const s = store.getState();
    chart.render(s);
    table.render(s);
    settings.render(s);
    stats.render(s);
    const custom = s.curve.mode === 'custom';
    modeBadge.textContent = custom ? 'Custom' : 'Parametric';
    modeBadge.dataset.mode = s.curve.mode;
    // Hidden without collapsing, so the chart does not shift mid-drag.
    regenerate.classList.toggle('invisible', !custom);
    resetButton.disabled = !custom;
    const selected = editor.selected();
    deleteButton.disabled = !editor.canRemove(selected);
    undoButton.disabled = !store.canUndo();
    redoButton.disabled = !store.canRedo();
    if (status.textContent !== editor.message()) status.textContent = editor.message();
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
  undoButton.addEventListener('click', () => store.undo());
  redoButton.addEventListener('click', () => store.redo());
  const regenerateCurve = () => {
    store.dispatch({ type: 'regenerateCurve' });
    editor.say('Curve regenerated from the parameters');
  };
  resetButton.addEventListener('click', regenerateCurve);
  regenerate.addEventListener('click', regenerateCurve);

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
