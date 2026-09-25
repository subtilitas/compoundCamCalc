/**
 * File menu: the name of the current design with an unsaved-changes
 * marker, and Save, Save as…, Open…, Open sample…, Reset to default, Save to
 * file and Open from file…. Named designs live in localStorage
 * (state/library); the working copy stays with the autosave. Opening a
 * design replaces the store state and clears the undo history; Reset to
 * default is one undo step. Storage failures show a message; nothing throws.
 * @module ui/filemenu
 */

import { defaultState } from '../state/presets.js';
import {
  deleteDesign, fileNameOf, findByName, isDirty, listDesigns, nameOfFile, normalizeName,
  parseLibrary, readProjectFile, renameDesign, saveDesign, serializeLibrary,
} from '../state/library.js';
import { SAMPLES } from '../state/samples.js';
import { toJSON } from '../state/schema.js';
import { h } from './dom.js';
import { download } from './download.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/store.js').Store} Store */
/** @typedef {import('../state/library.js').Current} Current */
/** @typedef {import('../state/library.js').Library} Library */
/** @typedef {import('../state/library.js').Entry} Entry */

/** localStorage key of the design library. */
export const LIBRARY_KEY = 'compoundCamCalc.designs';
/** localStorage key of a copy of a library that could not be read. */
export const LIBRARY_BACKUP_KEY = 'compoundCamCalc.designs.unreadable';

/** Message when storage refuses a write. */
export const STORAGE_FULL = 'The design was not saved: browser storage is full or blocked. Use Save to file.';

/**
 * Text after the design name in the header.
 * @param {Current} current
 * @param {boolean} dirty
 */
export function markerText(current, dirty) {
  if (current.source === 'unsaved') return dirty ? '(not saved, changed)' : '(not saved)';
  return dirty ? '(unsaved changes)' : '';
}

/**
 * Local date and time of a saved design, or '' for none.
 * @param {string} iso
 */
function savedText(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `saved ${d.toLocaleString()}`;
}

/**
 * @typedef {object} FileMenuOptions
 * @property {Current} current design of the working copy at start
 * @property {() => boolean} persist writes the working copy and the
 *   current design at once; false when storage refuses
 * @property {() => Date} [now]
 */

/**
 * Build the File menu into a container in the page header.
 * @param {HTMLElement} container
 * @param {Store} store
 * @param {FileMenuOptions} options
 * @returns {{ current: () => Current, render: () => void }}
 */
export function createFileMenu(container, store, options) {
  const now = options.now ?? (() => new Date());
  let current = options.current;

  // Storage: reading and writing are probed apart. Blocked storage turns
  // the library off; full storage keeps Open (and its Delete, which frees
  // space) and turns Save and Save as off.
  let storageOk = true;
  let writable = true;
  try {
    window.localStorage.getItem(LIBRARY_KEY);
  } catch {
    storageOk = false;
    writable = false;
  }
  /** Whether a write succeeds now; a delete may have freed space. */
  const probeWrite = () => {
    if (!storageOk) return false;
    try {
      window.localStorage.setItem(`${LIBRARY_KEY}.probe`, '1');
      window.localStorage.removeItem(`${LIBRARY_KEY}.probe`);
      return true;
    } catch {
      return false;
    }
  };
  writable = probeWrite();
  /** The stored library could not be read; saving would replace it. */
  let libraryBroken = false;

  /** @returns {Library | null} */
  function readLibrary() {
    if (!storageOk) return null;
    /** @type {string | null} */
    let text;
    try {
      text = window.localStorage.getItem(LIBRARY_KEY);
    } catch {
      return null;
    }
    const { library } = parseLibrary(text);
    if (library) {
      libraryBroken = false;
      return library;
    }
    if (!libraryBroken) {
      libraryBroken = true;
      try {
        if (text !== null && window.localStorage.getItem(LIBRARY_BACKUP_KEY) === null) {
          window.localStorage.setItem(LIBRARY_BACKUP_KEY, text);
        }
      } catch {
        // The note below still tells the user to save to a file.
      }
    }
    return null;
  }

  /**
   * @param {Library} library
   * @returns {boolean}
   */
  function writeLibrary(library) {
    try {
      window.localStorage.setItem(LIBRARY_KEY, serializeLibrary(library));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change the library: read it fresh, apply change, write it, all under a
   * lock shared by every tab (Web Locks), so two tabs cannot overwrite each
   * other's changes. A failed write marks the storage as full.
   * @template T
   * @param {(lib: Library) => { library: Library, value: T } | null} change null leaves the library as it is
   * @returns {Promise<{ ok: boolean, value: T | null, before: Library | null }>}
   */
  async function withLibrary(change) {
    const run = () => {
      const lib = readLibrary();
      if (!lib) return { ok: false, value: null, before: null };
      const out = change(lib);
      if (!out) return { ok: true, value: null, before: lib };
      if (!writeLibrary(out.library)) {
        writable = false;
        render();
        return { ok: false, value: null, before: lib };
      }
      return { ok: true, value: out.value, before: lib };
    };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request(LIBRARY_KEY, run) : run();
  }

  /** State the unsaved-changes marker compares with. */
  function baseline() {
    if (current.source === 'saved') {
      const lib = readLibrary();
      const entry = lib ? listDesigns(lib).find((e) => e.id === current.id) : undefined;
      return entry?.state ?? null;
    }
    return current.baseline;
  }

  /** Whether the inputs differ from the saved copy, the opened file or sample, or the default. */
  function dirty() {
    return isDirty(store.getState(), baseline());
  }

  // Header bar.
  const nameEl = h('strong', { class: 'file-name', 'data-testid': 'design-name' });
  const marker = h('span', { class: 'file-marker', 'data-testid': 'design-marker' });
  const menuButton = h('button', {
    type: 'button', class: 'file-button', 'aria-expanded': 'false', 'aria-controls': 'file-panel', 'data-testid': 'file-menu',
  }, 'File');
  /**
   * @param {string} id
   * @param {string} label
   * @param {string} [description]
   */
  const item = (id, label, description) => h('button', {
    type: 'button', class: 'file-item', 'data-testid': `file-${id}`, ...(description ? { title: description } : {}),
  }, label);
  const saveBtn = item('save', 'Save');
  const saveAsBtn = item('save-as', 'Save as…');
  const openBtn = item('open', 'Open…');
  const sampleBtn = item('sample', 'Open sample…');
  const resetBtn = item('reset', 'Reset to default', 'Replace all inputs with the default design');
  const toFileBtn = item('to-file', 'Save to file (.json)');
  const fromFileBtn = item('from-file', 'Open from file…');
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-testid': 'file-input' });
  const storageNote = h('p', { class: 'hint file-note', 'data-testid': 'file-note' });
  storageNote.hidden = true;
  const panel = h('div', { class: 'file-panel', id: 'file-panel', 'data-testid': 'file-panel' },
    saveBtn, saveAsBtn, openBtn, sampleBtn, resetBtn, toFileBtn, fromFileBtn, storageNote, fileInput);
  panel.hidden = true;
  const live = h('p', { class: 'file-status', role: 'status', 'data-testid': 'file-status' });
  container.append(
    h('div', { class: 'file-bar' },
      h('div', { class: 'file-menu' }, menuButton, panel),
      h('span', { class: 'file-design' }, 'Design: ', nameEl, ' ', marker)),
    live,
  );

  /** Live regions of the open dialogs; the page region lies inert behind a modal dialog. */
  /** @type {HTMLElement[]} */
  const liveStack = [];

  /** @param {string} text */
  function say(text) {
    const region = liveStack.length > 0 ? liveStack[liveStack.length - 1] : live;
    // The same text again is announced again.
    region.textContent = '';
    region.textContent = text;
  }

  function close() {
    panel.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }

  function render() {
    nameEl.textContent = current.name;
    marker.textContent = markerText(current, dirty());
    const readOk = storageOk && !libraryBroken;
    const writeOk = readOk && writable;
    saveBtn.disabled = !writeOk;
    saveAsBtn.disabled = !writeOk;
    openBtn.disabled = !readOk;
    storageNote.hidden = writeOk;
    storageNote.textContent = !storageOk
      ? 'This browser blocks storage: Save, Save as and Open are off. Use Save to file.'
      : libraryBroken
        ? 'Saved designs could not be read; use Save to file. A copy is kept in the browser.'
        : 'Browser storage is full: Save and Save as are off. Delete designs in Open… or use Save to file.';
  }

  /** @param {Current} next */
  function setCurrent(next) {
    current = next;
    const ok = options.persist();
    render();
    return ok;
  }

  menuButton.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) {
      readLibrary();
      // A failed probe shows full storage; a passing one does not undo a
      // real write that failed (the library needs far more than the probe).
      writable = writable && probeWrite();
      render();
      /** @type {HTMLButtonElement | undefined} */ ([...panel.querySelectorAll('button')].find((b) => !b.disabled))?.focus();
    }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
    menuButton.focus();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && e.target instanceof Node && !container.contains(e.target)) close();
  });

  // Dialogs: native <dialog> with showModal(); focus returns to the opener.
  /**
   * @param {string} title
   * @param {(dialog: HTMLDialogElement, done: (v: any) => void) => Node[]} body
   * @param {HTMLElement} returnTo
   * @returns {Promise<any>}
   */
  function dialog(title, body, returnTo) {
    return new Promise((resolve) => {
      const titleId = `file-dialog-${Math.random().toString(36).slice(2)}`;
      const d = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'file-dialog', 'aria-labelledby': titleId, 'data-testid': 'file-dialog' }));
      let result = /** @type {any} */ (null);
      const status = h('p', { class: 'file-status', role: 'status', 'data-testid': 'dialog-status' });
      const leave = () => {
        const i = liveStack.indexOf(status);
        if (i >= 0) liveStack.splice(i, 1);
      };
      /** @param {any} v */
      const done = (v) => {
        result = v;
        // Messages after this go to the page again.
        leave();
        d.close();
      };
      // The title first: body builders may look it up.
      d.append(h('h2', { id: titleId, class: 'file-dialog-title', tabindex: -1 }, title));
      d.append(...body(d, done), status);
      d.addEventListener('close', () => {
        leave();
        d.remove();
        if (returnTo.isConnected && !returnTo.hidden) returnTo.focus();
        else menuButton.focus();
        resolve(result);
      });
      document.body.append(d);
      d.showModal();
      liveStack.push(status);
    });
  }

  /**
   * Ask a yes or no question.
   * @param {string} text
   * @param {string} yes
   * @param {HTMLElement} returnTo
   * @returns {Promise<boolean>}
   */
  function confirm(text, yes, returnTo) {
    return dialog('Please confirm', (_d, done) => {
      const ok = h('button', { type: 'button', class: 'file-primary', 'data-testid': 'dialog-yes' }, yes);
      const no = h('button', { type: 'button', 'data-testid': 'dialog-no' }, 'Cancel');
      ok.addEventListener('click', () => done(true));
      no.addEventListener('click', () => done(false));
      queueMicrotask(() => no.focus());
      const questionId = `file-question-${Math.random().toString(36).slice(2)}`;
      _d.setAttribute('aria-describedby', questionId);
      return [h('p', { id: questionId }, text), h('div', { class: 'file-actions' }, ok, no)];
    }, returnTo).then((v) => v === true);
  }

  /**
   * Ask for a design name. A name another design has shows an error with a
   * Replace button.
   * @param {string} title
   * @param {string} initial
   * @param {string | null} ownId the design being renamed or saved, which may keep its name
   * @param {HTMLElement} returnTo
   * @returns {Promise<{ name: string, replaceId: string | null } | null>}
   */
  function askName(title, initial, ownId, returnTo) {
    return dialog(title, (_d, done) => {
      const inputId = `file-name-${Math.random().toString(36).slice(2)}`;
      const errId = `${inputId}-error`;
      const input = h('input', { id: inputId, type: 'text', value: initial, maxlength: 200, 'aria-describedby': errId, 'data-testid': 'dialog-name', autocomplete: 'off' });
      const error = h('p', { id: errId, class: 'field-msg', 'data-testid': 'dialog-error' });
      const ok = h('button', { type: 'button', class: 'file-primary', 'data-testid': 'dialog-ok' }, 'Save');
      const replace = h('button', { type: 'button', 'data-testid': 'dialog-replace' }, 'Replace');
      replace.hidden = true;
      const cancel = h('button', { type: 'button', 'data-testid': 'dialog-no' }, 'Cancel');
      /** @type {string | null} */
      let clashId = null;
      const check = () => {
        const n = normalizeName(input.value);
        clashId = null;
        let msg = n.error;
        if (!msg) {
          const lib = readLibrary();
          const clash = lib ? findByName(lib, n.name) : null;
          if (clash && clash.id !== ownId) {
            clashId = clash.id;
            msg = `A design named "${clash.name}" already exists`;
          }
        }
        error.textContent = msg ?? '';
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        replace.hidden = clashId === null;
        return { name: n.name, ok: msg === null };
      };
      ok.addEventListener('click', () => {
        const r = check();
        if (r.ok) done({ name: r.name, replaceId: null });
        else input.focus();
      });
      replace.addEventListener('click', () => {
        const r = check();
        if (clashId) done({ name: r.name, replaceId: clashId });
      });
      cancel.addEventListener('click', () => done(null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ok.click();
        }
      });
      input.addEventListener('input', () => {
        error.textContent = '';
        replace.hidden = true;
        input.setAttribute('aria-invalid', 'false');
      });
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return [
        h('label', { for: inputId, class: 'file-label' }, 'Design name'),
        input, error,
        h('div', { class: 'file-actions' }, ok, replace, cancel),
      ];
    }, returnTo);
  }

  /**
   * Ask before a design replaces unsaved changes.
   * @param {HTMLElement} returnTo
   */
  async function mayDiscard(returnTo) {
    if (!dirty() && !current.orphan) return true;
    const what = current.source === 'unsaved' ? `"${current.name}" is not saved` : `"${current.name}" has unsaved changes`;
    return confirm(`${what}. Discard them?`, 'Discard', returnTo);
  }

  /**
   * Switch to another design.
   * @param {ProjectState} state
   * @param {Current} next
   * @param {string} message
   */
  function switchTo(state, next, message) {
    const errors = store.replace(state);
    if (errors.length > 0) {
      say(`Could not open "${next.name}": ${errors[0].message}`);
      return;
    }
    const ok = setCurrent(next);
    say(ok ? message : `${message}. ${STORAGE_FULL}`);
  }

  /**
   * Save the working copy under a name.
   * @param {string} name
   * @param {string | null} id design to overwrite, or null for a new one
   */
  async function saveUnder(name, id) {
    const state = store.getState();
    const r = await withLibrary((lib) => {
      const out = saveDesign(lib, { id: id !== null && lib.designs.some((d) => d.id === id) ? id : null, name, state, now: now() });
      return { library: out.library, value: out.id };
    });
    if (!r.ok || r.value === null) {
      say(STORAGE_FULL);
      return;
    }
    writable = true;
    const ok = setCurrent({ id: r.value, name, source: 'saved', baseline: null });
    say(ok ? `Saved "${name}"` : `Saved "${name}", but the working copy was not updated: browser storage is full. Use Save to file.`);
  }

  async function saveAs() {
    close();
    const initial = current.source === 'new' ? '' : current.name;
    const own = current.source === 'saved' ? current.id : null;
    const r = await askName('Save as', initial, own, menuButton);
    if (!r) return;
    await saveUnder(r.name, r.replaceId ?? (r.name.toLocaleLowerCase('en') === current.name.toLocaleLowerCase('en') ? own : null));
  }

  saveBtn.addEventListener('click', async () => {
    if (current.source !== 'saved') {
      void saveAs();
      return;
    }
    const lib = readLibrary();
    // Deleted meanwhile (another tab): ask for a name, which checks clashes.
    if (!lib?.designs.some((d) => d.id === current.id)) {
      void saveAs();
      return;
    }
    close();
    await saveUnder(current.name, current.id);
    menuButton.focus();
  });
  saveAsBtn.addEventListener('click', () => void saveAs());

  openBtn.addEventListener('click', async () => {
    close();
    if (!(await mayDiscard(menuButton))) return;
    // Whether the user was asked already; the inputs may become orphaned or
    // change while the dialog is open (another tab deletes the design).
    const asked = dirty() || current.orphan === true;
    await dialog('Open a design', (_d, done) => {
      const list = h('ul', { class: 'file-list', 'data-testid': 'design-list' });
      const empty = h('p', { class: 'hint' }, 'No saved designs yet. Save as… stores the current design in this browser.');
      const fill = () => {
        const lib = readLibrary();
        const entries = lib ? listDesigns(lib) : [];
        empty.hidden = entries.length > 0;
        list.replaceChildren(...entries.map((e) => row(e)));
      };
      /** @param {Entry} e */
      const row = (e) => {
        const open = h('button', { type: 'button', 'aria-label': `Open ${e.name}`, 'data-testid': 'design-open' }, 'Open');
        const rename = h('button', { type: 'button', 'aria-label': `Rename ${e.name}`, 'data-testid': 'design-rename' }, 'Rename');
        const del = h('button', { type: 'button', 'aria-label': `Delete ${e.name}`, 'data-testid': 'design-delete' }, 'Delete');
        open.disabled = e.state === null;
        open.addEventListener('click', async () => {
          if (!e.state) return;
          if (!asked && !(await mayDiscard(open))) return;
          done(true);
          switchTo(e.state, { id: e.id, name: e.name, source: 'saved', baseline: null }, `Opened "${e.name}"`);
        });
        rename.addEventListener('click', async () => {
          const r = await askName('Rename', e.name, e.id, rename);
          if (!r) return;
          const done2 = await withLibrary((lib) => {
            const next = r.replaceId ? deleteDesign(lib, r.replaceId) : lib;
            return { library: renameDesign(next, e.id, r.name), value: true };
          });
          if (!done2.ok || !done2.before) {
            say(STORAGE_FULL);
            return;
          }
          if (current.id === e.id) setCurrent({ ...current, name: r.name });
          else if (r.replaceId !== null && r.replaceId === current.id) {
            // The open design was replaced: its inputs stay open, unsaved.
            const gone = listDesigns(done2.before).find((x) => x.id === r.replaceId);
            setCurrent({ id: null, name: current.name, source: 'unsaved', baseline: gone?.state ?? null, orphan: true });
          }
          say(`Renamed "${e.name}" to "${r.name}"`);
          fill();
          /** @type {HTMLElement | null} */ (list.querySelector(`[aria-label="Rename ${CSS.escape(r.name)}"]`))?.focus();
        });
        del.addEventListener('click', async () => {
          const isOpen = current.id === e.id;
          const text = isOpen ? `Delete "${e.name}"? Its inputs stay open as an unsaved design.` : `Delete "${e.name}"?`;
          if (!(await confirm(text, 'Delete', del))) return;
          const gone = await withLibrary((lib) => ({ library: deleteDesign(lib, e.id), value: listDesigns(lib).findIndex((x) => x.id === e.id) }));
          if (!gone.ok) {
            say(STORAGE_FULL);
            return;
          }
          const index = gone.value ?? 0;
          writable = probeWrite();
          if (isOpen) setCurrent({ id: null, name: e.name, source: 'unsaved', baseline: store.getState(), orphan: true });
          say(`Deleted "${e.name}"`);
          fill();
          const rows = [...list.querySelectorAll('[data-testid="design-open"]')];
          /** @type {HTMLElement | undefined} */ (rows[Math.min(index, rows.length - 1)])?.focus();
          if (rows.length === 0) /** @type {HTMLElement} */ (_d.querySelector('h2'))?.focus();
        });
        return h('li', { class: 'file-row', 'data-testid': 'design-row' },
          h('span', { class: 'file-row-name' }, e.name,
            h('span', { class: 'file-row-meta' }, e.state ? savedText(e.savedAt) : `cannot be opened: ${e.error}`)),
          h('span', { class: 'file-row-actions' }, open, rename, del));
      };
      const cancel = h('button', { type: 'button', 'data-testid': 'dialog-no' }, 'Close');
      cancel.addEventListener('click', () => done(null));
      const onStorage = (/** @type {StorageEvent} */ ev) => {
        if (ev.key === LIBRARY_KEY) fill();
      };
      window.addEventListener('storage', onStorage);
      _d.addEventListener('close', () => window.removeEventListener('storage', onStorage));
      fill();
      queueMicrotask(() => /** @type {HTMLElement | null} */ (list.querySelector('button:not(:disabled)') ?? cancel)?.focus());
      return [empty, list, h('div', { class: 'file-actions' }, cancel)];
    }, menuButton);
  });

  sampleBtn.addEventListener('click', async () => {
    close();
    if (!(await mayDiscard(menuButton))) return;
    await dialog('Open a sample design', (_d, done) => {
      const rows = SAMPLES.map((sample) => {
        const open = h('button', { type: 'button', 'aria-label': `Open ${sample.name}`, 'data-testid': `sample-${sample.id}` }, 'Open');
        open.addEventListener('click', () => {
          const state = sample.state();
          done(true);
          switchTo(state, { id: null, name: sample.name, source: 'unsaved', baseline: state }, `Opened the sample "${sample.name}"`);
        });
        return h('li', { class: 'file-row' },
          h('span', { class: 'file-row-name' }, sample.name, h('span', { class: 'file-row-meta' }, sample.description)),
          h('span', { class: 'file-row-actions' }, open));
      });
      const cancel = h('button', { type: 'button', 'data-testid': 'dialog-no' }, 'Close');
      cancel.addEventListener('click', () => done(null));
      queueMicrotask(() => /** @type {HTMLElement | null} */ (_d.querySelector('li button'))?.focus());
      return [
        h('p', { class: 'hint' }, 'A sample opens as an unsaved design. Limb values are assumptions, not measured limbs.'),
        h('ul', { class: 'file-list', 'data-testid': 'sample-list' }, ...rows),
        h('div', { class: 'file-actions' }, cancel),
      ];
    }, menuButton);
  });

  resetBtn.addEventListener('click', () => {
    close();
    const s = store.getState();
    store.dispatch({ type: 'load', state: { ...defaultState(), units: s.units } });
    say('All inputs are back at the default design; Undo restores them');
    menuButton.focus();
  });

  toFileBtn.addEventListener('click', () => {
    close();
    const name = fileNameOf(current.name);
    download(name, `${toJSON(store.getState())}\n`, 'application/json');
    say(`Saved ${name}`);
    menuButton.focus();
  });

  fromFileBtn.addEventListener('click', () => {
    close();
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    /** @type {string} */
    let text = '';
    if (file.size > 0 && file.size <= 1024 * 1024) {
      try {
        text = await file.text();
      } catch {
        say(`Could not open ${file.name}: the file cannot be read`);
        return;
      }
    }
    const r = readProjectFile(text, file.size);
    if (!r.state) {
      say(`Could not open ${file.name}: ${r.error}`);
      menuButton.focus();
      return;
    }
    if (!(await mayDiscard(menuButton))) return;
    const name = nameOfFile(file.name);
    switchTo(r.state, { id: null, name, source: 'unsaved', baseline: r.state },
      r.filled ? `Opened ${file.name}. Missing values in ${file.name} were set to their defaults` : `Opened ${file.name}`);
    menuButton.focus();
  });
  // A closed picker returns focus to the File button.
  fileInput.addEventListener('cancel', () => menuButton.focus());

  // Another tab changed the library: the open design may be gone or renamed.
  window.addEventListener('storage', (ev) => {
    if (ev.key !== LIBRARY_KEY || current.source !== 'saved') return;
    const lib = readLibrary();
    const d = lib?.designs.find((x) => x.id === current.id);
    if (!lib) {
      render();
      return;
    }
    if (!d) setCurrent({ id: null, name: current.name, source: 'unsaved', baseline: store.getState(), orphan: true });
    else if (d.name !== current.name) setCurrent({ ...current, name: d.name });
    else render();
  });

  store.subscribe(() => {
    if (!store.inTransaction()) render();
  });
  // A saved design deleted while the page was closed stays open, unsaved.
  const lib = readLibrary();
  if (current.source === 'saved' && lib && !lib.designs.some((d) => d.id === current.id)) {
    current = { id: null, name: current.name, source: 'unsaved', baseline: store.getState(), orphan: true };
  }
  render();
  return { current: () => current, render };
}

