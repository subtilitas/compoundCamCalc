/**
 * Autosave of the project to localStorage, debounced and written at once
 * when the page is hidden or closed, and restore on load. Storage access is
 * guarded: private windows and blocked storage only disable saving.
 * @module ui/autosave
 */

import { defaultState } from '../state/presets.js';
import { fromJSON, toJSON } from '../state/schema.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/store.js').Store} Store */

/** localStorage key of the saved project. */
export const STORAGE_KEY = 'compoundCamCalc.project';
/** localStorage key of the current design: id, name and source of the working copy. */
export const CURRENT_KEY = 'compoundCamCalc.current';
/** localStorage key of a copy of saved data that could not be loaded. */
export const BACKUP_KEY = 'compoundCamCalc.project.unreadable';
/** Delay between the last change and the save, in ms. */
export const SAVE_DELAY = 300;

/**
 * Saved project, or the default preset. A notice explains why saved data
 * was not used; that data is copied to {@link BACKUP_KEY} first, because the
 * next change replaces it.
 * @returns {{ state: ProjectState, notice: string | null }}
 */
export function loadSaved() {
  /** @type {string | null} */
  let text;
  try {
    text = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaultState(), notice: null };
  }
  if (text === null) return { state: defaultState(), notice: null };
  const { state, errors } = fromJSON(text);
  if (errors.length > 0) {
    let kept = false;
    try {
      window.localStorage.setItem(BACKUP_KEY, text);
      kept = true;
    } catch {
      // Storage full or blocked: the notice says that no copy exists.
    }
    const copy = kept ? ` A copy of the saved data is kept in the browser under "${BACKUP_KEY}".` : '';
    return {
      state,
      notice: `The saved project could not be loaded: ${errors[0].message}. The default project is shown instead.${copy} The next change replaces the saved project.`,
    };
  }
  return { state, notice: null };
}

/**
 * Stored current design text, or null.
 * @returns {string | null}
 */
export function loadCurrent() {
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

/**
 * Save the store state after every change, debounced. A pending save is
 * written at once when the page is hidden or closed. The current design
 * text, when given, is written together with the working copy, so both
 * always come from one tab.
 * @param {Store} store
 * @param {(status: 'pending' | 'saved' | 'error') => void} onStatus
 * @param {{ current?: () => string }} [options]
 * @returns {{ saveNow: () => boolean }} saveNow writes at once; false when storage refuses
 */
export function startAutosave(store, onStatus, options = {}) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      window.localStorage.setItem(STORAGE_KEY, toJSON(store.getState()));
      if (options.current) window.localStorage.setItem(CURRENT_KEY, options.current());
      onStatus('saved');
      return true;
    } catch {
      onStatus('error');
      return false;
    }
  };
  const flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    save();
  };
  store.subscribe(() => {
    clearTimeout(timer);
    onStatus('pending');
    timer = setTimeout(save, SAVE_DELAY);
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  return { saveNow: save };
}
