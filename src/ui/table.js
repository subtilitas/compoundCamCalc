/**
 * Point table: draw length and force of every point as editable text
 * fields. Values apply on Enter or blur; invalid or out-of-range input
 * shows a message next to the field and is not applied.
 * @module ui/table
 */

import { MAX_FORCE, MIN_FORCE, MIN_GAP } from '../core/curve.js';
import { AMO_OFFSET, fromSI, parseQuantity } from '../core/units.js';
import { DRAW_DECIMALS, amo, drawText, forceText } from './display.js';
import { h } from './dom.js';

/** @typedef {import('./editor.js').Editor} Editor */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */

/**
 * A bound rounded towards the inside of its range, so the printed value is
 * itself valid.
 * @param {number} value
 * @param {number} decimals
 * @param {1 | -1} direction 1 rounds up (lower bound), −1 rounds down
 */
function inward(value, decimals, direction) {
  const f = 10 ** decimals;
  const r = direction > 0 ? Math.ceil(value * f - 1e-9) / f : Math.floor(value * f + 1e-9) / f;
  return r.toFixed(decimals);
}

/**
 * @param {HTMLTableSectionElement} tbody
 * @param {HTMLElement} drawHead header cell of the draw length column
 * @param {HTMLElement} forceHead header cell of the force column
 * @param {Editor} editor
 * @returns {{ render: (state: ProjectState) => void }}
 */
export function createPointTable(tbody, drawHead, forceHead, editor) {
  const store = editor.store;
  let shape = '';

  /**
   * Parse and check one cell. Returns the SI value or an error message.
   * @param {'x' | 'F'} key
   * @param {number} i
   * @param {string} text
   * @returns {{ value: number } | { error: string }}
   */
  function check(key, i, text) {
    const { units, curve } = store.getState();
    const pts = curve.points;
    if (key === 'x') {
      const value = parseQuantity(text, 'length', units.draw) - AMO_OFFSET;
      if (Number.isNaN(value)) return { error: 'Enter a number, for example 24.5 or 24,5' };
      const lo = pts[i - 1].x + MIN_GAP;
      const hi = pts[i + 1].x - MIN_GAP;
      if (value < lo || value > hi) {
        const d = DRAW_DECIMALS[units.draw];
        return {
          error: `Enter a draw length between ${inward(amo(lo, units), d, 1)} and ${inward(amo(hi, units), d, -1)} ${units.draw}`,
        };
      }
      return { value };
    }
    const value = parseQuantity(text, 'force', units.force);
    if (Number.isNaN(value)) return { error: 'Enter a number, for example 250 or 250,5' };
    if (value < MIN_FORCE || value > MAX_FORCE) {
      const lo = fromSI(MIN_FORCE, 'force', units.force);
      const hi = fromSI(MAX_FORCE, 'force', units.force);
      return { error: `Enter a force between ${inward(lo, 2, 1)} and ${inward(hi, 1, -1)} ${units.force}` };
    }
    return { value };
  }

  /**
   * @param {HTMLInputElement} input
   * @param {HTMLElement} message
   * @param {string} text
   */
  function showError(input, message, text) {
    message.textContent = text;
    message.hidden = text === '';
    input.setAttribute('aria-invalid', String(text !== ''));
  }

  /**
   * @param {'x' | 'F'} key
   * @param {number} i
   * @param {string} label
   */
  function cell(key, i, label) {
    const n = i + 1;
    const id = `pt-${key}-${n}`;
    const message = h('span', { class: 'cell-error', id: `${id}-msg`, 'data-testid': `point-${key.toLowerCase()}-${n}-msg` });
    message.hidden = true;
    const input = h('input', {
      id,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': `Point ${n} ${label}`,
      'aria-describedby': `${id}-msg`,
      'data-testid': `point-${key.toLowerCase()}-${n}`,
      'data-rendered': '',
    });
    const commit = () => {
      if (input.value === input.dataset.rendered) {
        showError(input, message, '');
        return;
      }
      const r = check(key, i, input.value);
      if ('error' in r) {
        showError(input, message, r.error);
        return;
      }
      showError(input, message, '');
      editor.move(i, key === 'x' ? { x: r.value } : { F: r.value });
      editor.select(i);
      // Show the stored value in the field that still has focus.
      const s = store.getState();
      const p = s.curve.points[i];
      const text = key === 'x' ? drawText(p.x, s.units) : forceText(p.F, s.units);
      input.value = text;
      input.dataset.rendered = text;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        input.value = input.dataset.rendered ?? '';
        showError(input, message, '');
      }
    });
    input.addEventListener('blur', commit);
    return h('td', {}, input, message);
  }

  /**
   * @param {string} text
   * @param {string} testId
   */
  function locked(text, testId) {
    return h('td', { class: 'locked' }, h('span', { 'data-testid': testId }, text), h('span', { class: 'lock-note' }, ' fixed'));
  }

  /** @param {ProjectState} s */
  function build(s) {
    const pts = s.curve.points;
    const last = pts.length - 1;
    const rows = pts.map((_, i) => {
      const n = i + 1;
      const drawCell = i === 0 || i === last ? locked('', `point-x-${n}`) : cell('x', i, 'draw length');
      const forceCell = i === 0 ? locked('', `point-f-${n}`) : cell('F', i, 'force');
      return h('tr', { 'data-index': i }, h('th', { scope: 'row' }, String(n)), drawCell, forceCell);
    });
    tbody.replaceChildren(...rows);
  }

  /** @param {ProjectState} s */
  function render(s) {
    const { units } = s;
    const pts = s.curve.points;
    drawHead.textContent = `Draw length (AMO), ${units.draw}`;
    forceHead.textContent = `Draw force, ${units.force}`;
    const nextShape = `${pts.length}|${units.draw}|${units.force}`;
    if (nextShape !== shape) {
      shape = nextShape;
      build(s);
    }
    const selected = editor.selected();
    pts.forEach((p, i) => {
      const row = /** @type {HTMLTableRowElement} */ (tbody.rows[i]);
      row.classList.toggle('selected', i === selected);
      for (const [key, text] of /** @type {const} */ ([['x', drawText(p.x, units)], ['f', forceText(p.F, units)]])) {
        const el = row.querySelector(`[data-testid="point-${key}-${i + 1}"]`);
        if (el instanceof HTMLInputElement) {
          // Leave a field alone while it is being edited or shows an error.
          if (document.activeElement === el || el.getAttribute('aria-invalid') === 'true') continue;
          el.value = text;
          el.dataset.rendered = text;
        } else if (el) {
          el.textContent = text;
        }
      }
    });
  }

  return { render };
}
