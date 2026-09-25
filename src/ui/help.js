/**
 * Help dialog: a quick start, the keyboard shortcuts, every glossary term
 * and a link to the user guide. A Help button in the page header opens it;
 * no keyboard shortcut does (WCAG 2.1.4, Web Content Accessibility
 * Guidelines). The texts of the shortcuts use the step constants of the
 * modules that handle the keys.
 * @module ui/help
 */

import { openDialog } from './dialog.js';
import { DRAW_STEP, FORCE_STEP } from './display.js';
import { h } from './dom.js';
import { GLOSSARY } from './glossary.js';
import { MAX_ZOOM, PAN_STEP, PAN_STEP_LARGE, ZOOM_STEP } from './viewport.js';

/** @typedef {keyof typeof GLOSSARY} GlossaryKey */

/**
 * @typedef {object} Shortcut
 * @property {string[]} keys alternatives, shown joined by "or"
 * @property {string} action
 */

/**
 * @typedef {object} ShortcutGroup
 * @property {string} title
 * @property {string} where where the focus must be for the keys to work
 * @property {readonly Shortcut[]} keys
 */

/** User guide in the project wiki. */
export const USER_GUIDE_URL = 'https://github.com/subtilitas/compoundCamCalc/wiki/user-guide';

/** Quick start, one step per item. */
export const QUICK_START = Object.freeze([
  'Set the bow in Settings: axle-to-axle length (ATA), brace height, draw length and the limbs.',
  'Shape the draw force curve: set the peak force, let-off and valley in Settings, or drag the points of the chart.',
  'Read Results. The solver builds the cam after every change and lists each problem with a suggestion.',
  'Move the draw position slider and check the Cam view, the String plan and the Loads.',
  'Save the design with the File menu, then export the cam plates in Export.',
]);

/** Percentage text of a fraction, for example 0.1 → "10 %". */
const percent = (/** @type {number} */ f) => `${Math.round(f * 100)} %`;

/** Keyboard shortcuts per area of the page, as the key handlers implement them. */
export const SHORTCUTS = /** @type {readonly ShortcutGroup[]} */ (Object.freeze([
  {
    title: 'Force chart',
    where: 'Tab to a point of the chart. The point at brace is fixed.',
    keys: [
      { keys: ['←', '→'], action: `Move the point along the draw by ${DRAW_STEP.in} in (${DRAW_STEP.mm} mm or ${DRAW_STEP.cm} cm).` },
      { keys: ['↑', '↓'], action: `Change the force of the point by ${FORCE_STEP.N} N (${FORCE_STEP.lbf} lbf).` },
      { keys: ['Shift + arrow'], action: 'Move 10 times as far.' },
      { keys: ['Delete', 'Backspace'], action: 'Remove the point.' },
      { keys: ['Insert', '+'], action: 'Add a point halfway to the next point; on the full-draw point, halfway to the previous one.' },
    ],
  },
  {
    title: 'Undo and redo',
    where: 'Anywhere outside a text field and a dialog.',
    keys: [
      { keys: ['Ctrl + Z', 'Cmd + Z'], action: 'Undo the last change.' },
      { keys: ['Ctrl + Shift + Z', 'Cmd + Shift + Z', 'Ctrl + Y'], action: 'Redo.' },
    ],
  },
  {
    title: 'Cam view and string plan',
    where: 'Tab to the drawing.',
    keys: [
      { keys: ['+', '='], action: `Zoom in by ${ZOOM_STEP} times, up to ${MAX_ZOOM} times the fitted view.` },
      { keys: ['-', '_'], action: `Zoom out by ${ZOOM_STEP} times.` },
      { keys: ['0'], action: 'Fit the drawing in view.' },
      { keys: ['Arrow keys'], action: `Pan by ${percent(PAN_STEP)} of the visible size once zoomed in; with Shift, by ${percent(PAN_STEP_LARGE)}.` },
    ],
  },
  {
    title: 'Draw position',
    where: 'Tab to the draw position slider.',
    keys: [
      { keys: ['←', '↓'], action: 'One step towards brace.' },
      { keys: ['→', '↑'], action: 'One step towards full draw.' },
      { keys: ['Home'], action: 'Jump to brace.' },
      { keys: ['End'], action: 'Jump to full draw.' },
    ],
  },
  {
    title: 'Dialogs and menus',
    where: 'In a dialog, the File menu or a term definition.',
    keys: [{ keys: ['Escape'], action: 'Close it.' }],
  },
]));

/**
 * Name and definition of a glossary entry: its text split at the first
 * colon. The name, ': ' and the definition give the text back.
 * @param {GlossaryKey} key
 * @returns {{ name: string, definition: string }}
 */
export function glossaryParts(key) {
  const { text } = GLOSSARY[key];
  const i = text.indexOf(': ');
  return i < 0 ? { name: GLOSSARY[key].term, definition: text } : { name: text.slice(0, i), definition: text.slice(i + 2) };
}

/**
 * Section of the help dialog with a heading.
 * @param {string} title
 * @param {...Node} children
 */
function section(title, ...children) {
  return h('section', { class: 'help-section' }, h('h3', {}, title), ...children);
}

/**
 * Contents of the help dialog, without the close buttons.
 * @returns {Node[]}
 */
function helpContents() {
  const steps = h('ol', { class: 'help-steps', 'data-testid': 'help-quick-start' }, ...QUICK_START.map((s) => h('li', {}, s)));

  const shortcuts = SHORTCUTS.map((group) => h('div', { class: 'help-keys' },
    h('h4', {}, group.title),
    h('p', { class: 'hint' }, group.where),
    h('dl', {}, ...group.keys.flatMap((k) => [
      h('dt', {}, ...k.keys.flatMap((key, i) => (i === 0 ? [h('kbd', {}, key)] : [' or ', h('kbd', {}, key)]))),
      h('dd', {}, k.action),
    ]))));

  const keys = /** @type {GlossaryKey[]} */ (Object.keys(GLOSSARY));
  const terms = h('dl', { class: 'help-terms', 'data-testid': 'help-glossary' }, ...keys.flatMap((key) => {
    const { name, definition } = glossaryParts(key);
    return [h('dt', { 'data-testid': `help-term-${key}` }, name), h('dd', {}, definition)];
  }));

  const guide = h('a', {
    href: USER_GUIDE_URL, target: '_blank', rel: 'noopener', 'data-testid': 'help-guide-link',
  }, 'User guide on GitHub (opens a new tab)');

  return [
    section('Quick start', steps),
    section('Keyboard shortcuts', ...shortcuts),
    section('Terms', terms),
    section('More', h('p', {}, guide)),
  ];
}

/**
 * Help button for the page header. It opens the help dialog; focus goes to
 * the dialog heading and returns to the button when the dialog closes.
 * @returns {HTMLButtonElement}
 */
export function createHelpButton() {
  const button = h('button', { type: 'button', class: 'help-button', 'aria-haspopup': 'dialog', 'data-testid': 'help-button' }, 'Help');
  button.addEventListener('click', () => {
    openDialog('Help', (d, done) => {
      d.classList.add('help-dialog');
      const closeTop = h('button', { type: 'button', class: 'help-close-top', 'data-testid': 'help-close-top' }, 'Close');
      const closeBottom = h('button', { type: 'button', 'data-testid': 'help-close-bottom' }, 'Close');
      closeTop.addEventListener('click', () => done(null));
      closeBottom.addEventListener('click', () => done(null));
      // showModal focuses the first button; the heading takes the focus
      // after it, so a screen reader starts at the top.
      queueMicrotask(() => /** @type {HTMLElement | null} */ (d.querySelector('h2'))?.focus());
      return [closeTop, ...helpContents(), h('div', { class: 'file-actions' }, closeBottom)];
    }, { returnTo: button, testid: 'help-dialog' });
  });
  return button;
}
