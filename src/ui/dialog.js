/**
 * Modal dialogs: native <dialog> with showModal(), a title as the first
 * child, and a live region per dialog for status messages. Focus returns
 * to the element that had it when the dialog opened, or to a fallback.
 * @module ui/dialog
 */

import { h } from './dom.js';

/** Live regions of the open dialogs, the newest last. */
const liveStack = /** @type {HTMLElement[]} */ ([]);

/**
 * Live region of the newest open dialog, or null when none is open.
 * @returns {HTMLElement | null}
 */
export function dialogLiveRegion() {
  return liveStack.length > 0 ? liveStack[liveStack.length - 1] : null;
}

/**
 * Show a modal dialog.
 * @param {string} title
 * @param {(dialog: HTMLDialogElement, done: (v: any) => void) => Node[]} body
 * @param {{ returnTo?: HTMLElement | null, fallback?: HTMLElement | null, testid?: string }} [options]
 *   returnTo gets the focus back (default: the focused element at open);
 *   fallback when returnTo is gone or hidden by then
 * @returns {Promise<any>} the value passed to done, or null
 */
export function openDialog(title, body, options = {}) {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const returnTo = options.returnTo ?? active;
  return new Promise((resolve) => {
    const titleId = `dialog-${Math.random().toString(36).slice(2)}`;
    const d = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'file-dialog', 'aria-labelledby': titleId, 'data-testid': options.testid ?? 'file-dialog' }));
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
      if (returnTo && returnTo.isConnected && !returnTo.hidden) returnTo.focus();
      else options.fallback?.focus();
      resolve(result);
    });
    document.body.append(d);
    d.showModal();
    liveStack.push(status);
  });
}

/**
 * Ask a yes or no question; Cancel has the focus.
 * @param {string} text
 * @param {string} yes
 * @param {{ returnTo?: HTMLElement | null, fallback?: HTMLElement | null }} [options]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(text, yes, options = {}) {
  return openDialog('Please confirm', (d, done) => {
    const ok = h('button', { type: 'button', class: 'file-primary', 'data-testid': 'dialog-yes' }, yes);
    const no = h('button', { type: 'button', 'data-testid': 'dialog-no' }, 'Cancel');
    ok.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    queueMicrotask(() => no.focus());
    const questionId = `dialog-question-${Math.random().toString(36).slice(2)}`;
    d.setAttribute('aria-describedby', questionId);
    return [h('p', { id: questionId }, text), h('div', { class: 'file-actions' }, ok, no)];
  }, options).then((v) => v === true);
}
