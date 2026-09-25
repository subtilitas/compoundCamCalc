/**
 * Editing controller shared by the chart, the point table and the toolbar:
 * selection, point edits through the store, and status messages.
 * @module ui/editor
 */

import { addPoint, addPointInWidestGap, movePoint, removePoint, removeRefusal } from '../core/curve.js';

/** @typedef {import('../state/store.js').Store} Store */
/** @typedef {import('../core/interp.js').CurvePoint} CurvePoint */

/**
 * @typedef {object} Editor
 * @property {Store} store
 * @property {() => number} selected index of the selected point, −1 for none
 * @property {(index: number, focus?: boolean) => void} select
 * @property {() => number} takeFocusRequest index of a point to focus after
 *   the next render, −1 for none; clears the request
 * @property {(index: number, target: { x?: number, F?: number }) => void} move
 * @property {(x: number, F?: number) => number} add returns the new index or −1
 * @property {() => number} addInWidestGap returns the new index or −1
 * @property {(index: number, focusNeighbour?: boolean) => boolean} remove
 * @property {(index: number) => boolean} canRemove
 * @property {(text: string) => void} say show a status message
 * @property {(listener: () => void) => () => void} onChange selection and
 *   message changes
 * @property {() => string} message current status message; every store
 *   change clears it, so it describes the last edit only
 * @property {() => number} messageCount number of say() calls, so a
 *   repeated message can be announced again
 */

/**
 * @param {Store} store
 * @returns {Editor}
 */
export function createEditor(store) {
  let selected = -1;
  let focusRequest = -1;
  let message = '';
  let messageCount = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const notify = () => listeners.forEach((l) => l());
  const points = () => store.getState().curve.points;

  /** @param {CurvePoint[]} next */
  function apply(next) {
    return store.dispatch({ type: 'setCurvePoints', points: next });
  }

  /** @param {string} text */
  function say(text) {
    message = text;
    messageCount++;
    notify();
  }

  /**
   * @param {number} index
   * @param {boolean} [focus]
   */
  function select(index, focus = false) {
    const n = points().length;
    const next = Number.isInteger(index) && index >= 0 && index < n ? index : -1;
    if (focus) focusRequest = next;
    if (next !== selected || focus) {
      selected = next;
      notify();
    }
  }

  // Every store change clears the message: editor actions say() after they
  // dispatch, so undo, redo, drags and settings leave no stale text. Keep
  // the selection valid after undo, redo and loads.
  store.subscribe((state) => {
    message = '';
    if (selected >= state.curve.points.length) {
      selected = -1;
      notify();
    }
  });

  return {
    store,
    selected: () => selected,
    select,
    takeFocusRequest() {
      const i = focusRequest;
      focusRequest = -1;
      return i;
    },
    move(index, target) {
      apply(movePoint(points(), index, target));
    },
    add(x, F) {
      const r = addPoint(points(), x, F);
      if (r.error) {
        say(r.error);
        return -1;
      }
      apply(r.points);
      say(`Point ${r.index + 1} added`);
      select(r.index, true);
      return r.index;
    },
    addInWidestGap() {
      const r = addPointInWidestGap(points());
      if (r.error) {
        say(r.error);
        return -1;
      }
      apply(r.points);
      say(`Point ${r.index + 1} added`);
      select(r.index, true);
      return r.index;
    },
    remove(index, focusNeighbour = false) {
      const r = removePoint(points(), index);
      if (r.error) {
        say(r.error);
        return false;
      }
      apply(r.points);
      say(`Point ${index + 1} removed`);
      if (focusNeighbour) select(Math.max(index - 1, 1), true);
      else select(-1);
      return true;
    },
    canRemove: (index) => removeRefusal(points(), index) === null,
    say,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    message: () => message,
    messageCount: () => messageCount,
  };
}
