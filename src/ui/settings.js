/**
 * Settings panel: bow geometry, draw force parameters and display units.
 * Text fields validate on Enter, blur and the stepper buttons; sliders apply
 * live, and one slider gesture is one undo entry.
 * @module ui/settings
 */

import { AMO_OFFSET, fromSI, parseNumber, parseQuantity, toSI } from '../core/units.js';
import { FIELDS, MIN_POWER_STROKE } from '../state/schema.js';
import { fixed } from './display.js';
import { h } from './dom.js';
import { infoButton } from './glossary.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('../state/store.js').Store} Store */
/** @typedef {import('../state/store.js').Action} Action */
/** @typedef {keyof typeof import('./glossary.js').GLOSSARY} GlossaryKey */

/**
 * @typedef {object} FieldDef
 * @property {string} id
 * @property {string} label
 * @property {GlossaryKey} [glossary]
 * @property {string} path key of the range in FIELDS
 * @property {'draw' | 'force' | 'percent'} kind
 * @property {(s: ProjectState) => number} get SI value
 * @property {(v: number) => Action} action
 * @property {Record<string, number>} step per display unit
 * @property {Record<string, number>} decimals per display unit
 * @property {Record<string, number>} [sliderStep] per display unit; adds a slider
 * @property {(v: number, s: ProjectState) => string | null} [extra] cross-field check
 */

/**
 * @param {FieldDef} def
 * @param {Units} units
 */
function unitOf(def, units) {
  return def.kind === 'draw' ? units.draw : def.kind === 'force' ? units.force : '%';
}

/**
 * @param {FieldDef} def
 * @param {number} v SI value
 * @param {Units} units
 */
function toDisplay(def, v, units) {
  if (def.kind === 'percent') return v * 100;
  return fromSI(v, def.kind === 'draw' ? 'length' : 'force', unitOf(def, units));
}

/**
 * @param {FieldDef} def
 * @param {number} v display value
 * @param {Units} units
 */
function fromDisplay(def, v, units) {
  if (def.kind === 'percent') return v / 100;
  return toSI(v, def.kind === 'draw' ? 'length' : 'force', unitOf(def, units));
}

/**
 * @param {FieldDef} def
 * @param {string} text
 * @param {Units} units
 */
function parse(def, text, units) {
  if (def.kind === 'percent') return parseNumber(text.replace(/\s*%\s*$/, '')) / 100;
  return parseQuantity(text, def.kind === 'draw' ? 'length' : 'force', unitOf(def, units));
}

/** @param {number} v */
function plain(v) {
  return String(Number(v.toPrecision(6)));
}

/** @type {FieldDef[]} */
const GEOMETRY_FIELDS = [
  {
    id: 'ata',
    label: 'Axle-to-axle length (ATA)',
    glossary: 'ata',
    path: 'geometry.ata',
    kind: 'draw',
    get: (s) => s.geometry.ata,
    action: (v) => ({ type: 'setGeometry', geometry: { ata: v } }),
    step: { in: 0.25, mm: 5, cm: 0.5 },
    decimals: { in: 2, mm: 1, cm: 2 },
  },
  {
    id: 'brace',
    label: 'Brace height',
    glossary: 'braceHeight',
    path: 'geometry.braceHeight',
    kind: 'draw',
    get: (s) => s.geometry.braceHeight,
    action: (v) => ({ type: 'setGeometry', geometry: { braceHeight: v } }),
    step: { in: 0.25, mm: 5, cm: 0.5 },
    decimals: { in: 2, mm: 1, cm: 2 },
    extra: (v, s) => {
      const max = s.geometry.drawLength - AMO_OFFSET - MIN_POWER_STROKE;
      if (v < max) return null;
      const u = s.units.draw;
      return `Brace height must be less than ${plain(fromSI(max, 'length', u))} ${u} for this draw length (at least 5 in of power stroke)`;
    },
  },
  {
    id: 'draw',
    label: 'Draw length (AMO)',
    glossary: 'drawLength',
    path: 'geometry.drawLength',
    kind: 'draw',
    get: (s) => s.geometry.drawLength,
    action: (v) => ({ type: 'setGeometry', geometry: { drawLength: v } }),
    step: { in: 0.25, mm: 5, cm: 0.5 },
    decimals: { in: 2, mm: 1, cm: 2 },
    extra: (v, s) => {
      const min = s.geometry.braceHeight + AMO_OFFSET + MIN_POWER_STROKE;
      if (v > min) return null;
      const u = s.units.draw;
      return `Draw length must be more than ${plain(fromSI(min, 'length', u))} ${u}: brace height + 1.75 in + 5 in of power stroke`;
    },
  },
];

/** @type {FieldDef[]} */
const FORCE_FIELDS = [
  {
    id: 'peak',
    label: 'Peak draw force',
    glossary: 'peak',
    path: 'curve.params.peak',
    kind: 'force',
    get: (s) => s.curve.params.peak,
    action: (v) => ({ type: 'setCurveParams', params: { peak: v } }),
    step: { N: 1, lbf: 0.5 },
    decimals: { N: 1, lbf: 1 },
    sliderStep: { N: 1, lbf: 0.5 },
  },
  {
    id: 'letoff',
    label: 'Let-off',
    glossary: 'letOff',
    path: 'curve.params.letOff',
    kind: 'percent',
    get: (s) => s.curve.params.letOff,
    action: (v) => ({ type: 'setCurveParams', params: { letOff: v } }),
    step: { '%': 1 },
    decimals: { '%': 1 },
    sliderStep: { '%': 1 },
  },
  {
    id: 'rise',
    label: 'Rise to peak, share of power stroke',
    path: 'curve.params.riseFraction',
    kind: 'percent',
    get: (s) => s.curve.params.riseFraction,
    action: (v) => ({ type: 'setCurveParams', params: { riseFraction: v } }),
    step: { '%': 1 },
    decimals: { '%': 0 },
  },
  {
    id: 'valley',
    label: 'Valley width',
    glossary: 'valley',
    path: 'curve.params.valleyWidth',
    kind: 'draw',
    get: (s) => s.curve.params.valleyWidth,
    action: (v) => ({ type: 'setCurveParams', params: { valleyWidth: v } }),
    step: { in: 0.1, mm: 2.5, cm: 0.25 },
    decimals: { in: 2, mm: 1, cm: 2 },
  },
];

const UNIT_SELECTS = /** @type {const} */ ([
  { id: 'draw', label: 'Draw length unit', key: 'draw', options: ['in', 'mm', 'cm'] },
  { id: 'force', label: 'Force unit', key: 'force', options: ['N', 'lbf'] },
  { id: 'energy', label: 'Energy unit', key: 'energy', options: ['J', 'ft·lbf'] },
]);

/**
 * @param {HTMLElement} panel element to fill
 * @param {Store} store
 * @returns {{ render: (state: ProjectState) => void }}
 */
export function createSettings(panel, store) {
  /** @type {((s: ProjectState) => void)[]} */
  const renderers = [];

  /** @param {FieldDef} def */
  function field(def) {
    const inputId = `f-${def.id}`;
    const msg = h('p', { class: 'field-msg', id: `${inputId}-msg`, 'data-testid': `field-${def.id}-msg`, 'aria-live': 'polite' });
    const range = h('p', { class: 'field-range', id: `${inputId}-range` });
    const input = h('input', {
      id: inputId,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'spinbutton',
      'aria-describedby': `${inputId}-range ${inputId}-msg`,
      'data-testid': `field-${def.id}`,
    });
    const unit = h('span', { class: 'unit', 'aria-hidden': 'true' });
    const dec = h('button', { type: 'button', class: 'stepper', 'aria-label': `Decrease ${def.label.toLowerCase()}` }, '−');
    const inc = h('button', { type: 'button', class: 'stepper', 'aria-label': `Increase ${def.label.toLowerCase()}` }, '+');
    const labelRow = h('div', { class: 'field-label-row' }, h('label', { for: inputId }, def.label));
    if (def.glossary) labelRow.append(infoButton(def.glossary));
    const row = h('div', { class: 'field-input-row' }, dec, input, inc, unit);
    /** @type {HTMLInputElement | null} */
    let slider = null;
    if (def.sliderStep) {
      slider = h('input', {
        type: 'range',
        class: 'slider',
        'aria-label': `${def.label} slider`,
        'data-testid': `slider-${def.id}`,
      });
    }
    const wrap = h('div', { class: 'field', 'data-field': def.id }, labelRow);
    if (slider) wrap.append(slider);
    wrap.append(row, range, msg);
    let rendered = '';

    /** @param {string} text */
    const say = (text) => {
      msg.textContent = text;
      input.setAttribute('aria-invalid', String(text !== ''));
    };

    /**
     * Validate and apply an SI value. Returns true when applied.
     * @param {number} value
     */
    function apply(value) {
      const s = store.getState();
      const spec = FIELDS[def.path];
      const u = unitOf(def, s.units);
      if (!Number.isFinite(value)) {
        say(`${def.label} must be a number`);
        return false;
      }
      if (value < spec.min - 1e-12 || value > spec.max + 1e-12) {
        say(`${def.label} must be between ${plain(toDisplay(def, spec.min, s.units))} and ${plain(toDisplay(def, spec.max, s.units))} ${u}`);
        return false;
      }
      const extra = def.extra?.(value, s);
      if (extra) {
        say(extra);
        return false;
      }
      const errors = store.dispatch(def.action(value));
      if (errors.length > 0) {
        say(errors[0].message);
        return false;
      }
      say('');
      if (def.id === 'letoff') {
        const achieved = store.getState().curve.params.letOff;
        if (Math.abs(achieved - value) > 0.001) {
          say(`Let-off is limited to ${fixed(achieved * 100, 1)} % by the points after the peak`);
        }
      }
      return true;
    }

    function commitText() {
      if (input.value === rendered) {
        say('');
        return;
      }
      apply(parse(def, input.value, store.getState().units));
      renderField(store.getState(), true);
    }

    /** @param {number} direction */
    function step(direction) {
      const s = store.getState();
      const u = unitOf(def, s.units);
      const current = toDisplay(def, def.get(s), s.units);
      const size = def.step[u];
      const next = (Math.round(current / size + 1e-9) + direction) * size;
      apply(fromDisplay(def, next, s.units));
      renderField(store.getState(), true);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitText();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(e.key === 'ArrowUp' ? 1 : -1);
      } else if (e.key === 'Escape') {
        input.value = rendered;
        say('');
      }
    });
    input.addEventListener('blur', commitText);
    dec.addEventListener('click', () => step(-1));
    inc.addEventListener('click', () => step(1));

    if (slider) {
      const s0 = slider;
      s0.addEventListener('input', () => {
        if (!store.inTransaction()) store.beginTransaction();
        apply(fromDisplay(def, Number(s0.value), store.getState().units));
      });
      const end = () => {
        if (store.inTransaction()) store.commitTransaction();
      };
      s0.addEventListener('change', end);
      s0.addEventListener('pointerup', end);
      s0.addEventListener('blur', end);
    }

    /**
     * @param {ProjectState} s
     * @param {boolean} [force] update the text field even when focused
     */
    function renderField(s, force = false) {
      const spec = FIELDS[def.path];
      const u = unitOf(def, s.units);
      const d = def.decimals[u];
      const value = toDisplay(def, def.get(s), s.units);
      const text = fixed(value, d);
      unit.textContent = u;
      const lo = toDisplay(def, spec.min, s.units);
      const hi = toDisplay(def, spec.max, s.units);
      range.textContent = `${plain(lo)} to ${plain(hi)} ${u}, step ${plain(def.step[u])}`;
      setAria(input, lo, hi, value, `${text} ${u}`);
      if (force || (document.activeElement !== input && input.getAttribute('aria-invalid') !== 'true')) {
        input.value = text;
        rendered = text;
      }
      if (slider && def.sliderStep) {
        const st = def.sliderStep[u];
        const min = Math.ceil(lo / st - 1e-9) * st;
        const max = Math.floor(hi / st + 1e-9) * st;
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(st);
        slider.value = String(value);
        slider.setAttribute('aria-valuetext', `${text} ${u}`);
      }
    }
    renderers.push(renderField);
    return wrap;
  }

  /**
   * @param {HTMLInputElement} input
   * @param {number} lo
   * @param {number} hi
   * @param {number} now
   * @param {string} text
   */
  function setAria(input, lo, hi, now, text) {
    input.setAttribute('aria-valuemin', plain(lo));
    input.setAttribute('aria-valuemax', plain(hi));
    input.setAttribute('aria-valuenow', plain(now));
    input.setAttribute('aria-valuetext', text);
  }

  const customHint = h('p', { class: 'hint', 'data-testid': 'custom-hint' },
    'The curve is custom: rise and valley width apply when it is regenerated from parameters. Peak and let-off rescale the points.');

  const units = h('fieldset', { class: 'group' }, h('legend', {}, 'Units'));
  const unitRow = h('div', { class: 'unit-row' });
  for (const def of UNIT_SELECTS) {
    const select = h('select', { id: `u-${def.id}`, 'data-testid': `unit-${def.id}` });
    for (const option of def.options) select.append(h('option', { value: option }, option));
    select.addEventListener('change', () => {
      store.dispatch({ type: 'setUnits', units: { [def.key]: select.value } });
    });
    renderers.push((s) => {
      select.value = s.units[def.key];
    });
    unitRow.append(h('div', { class: 'unit-field' }, h('label', { for: `u-${def.id}` }, def.label), select));
  }
  units.append(unitRow);

  panel.append(
    h('fieldset', { class: 'group' }, h('legend', {}, 'Bow geometry'), ...GEOMETRY_FIELDS.map(field)),
    h('fieldset', { class: 'group' }, h('legend', {}, 'Draw force'), ...FORCE_FIELDS.map(field), customHint),
    units,
  );

  return {
    render(s) {
      for (const r of renderers) r(s);
      customHint.hidden = s.curve.mode !== 'custom';
    },
  };
}
