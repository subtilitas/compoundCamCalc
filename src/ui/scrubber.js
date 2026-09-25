/**
 * Draw-position control: one slider from brace to full draw, a − and a +
 * button, jump buttons (brace, peak draw force, full draw) and a readout.
 * The position is view state: it is not part of the project, the undo
 * history or the saved data, and moving it never starts a solve.
 *
 * The slider counts whole draw steps from brace (0.1 in, 2.5 mm or 0.25 cm);
 * the last step ends exactly at full draw. At brace or full draw the
 * position stays there when a new result arrives; elsewhere it keeps its
 * draw length, clamped to the new range.
 * @module ui/scrubber
 */

import { toSI } from '../core/units.js';
import { DRAW_STEP, angleText, drawText, forceText } from './display.js';
import { h, setAttrs } from './dom.js';

/** @typedef {import('../core/layout.js').LayoutContext} LayoutContext */
/** @typedef {import('../core/layout.js').BowPose} BowPose */
/** @typedef {import('../state/schema.js').Units} Units */

/**
 * @typedef {object} SliderModel
 * @property {number} x0 brace (m)
 * @property {number} x1 full draw (m)
 * @property {number} step one slider step (m)
 * @property {number} count number of steps; step `count` is full draw
 */

/**
 * Slider steps from brace x0 to full draw x1 in the draw step of the unit.
 * @param {number} x0 (m)
 * @param {number} x1 (m), > x0
 * @param {Units} units
 * @returns {SliderModel}
 */
export function sliderModel(x0, x1, units) {
  const step = toSI(DRAW_STEP[units.draw], 'length', units.draw);
  const span = x1 - x0;
  const count = Math.max(1, Math.ceil(span / step - 1e-9));
  return { x0, x1, step, count };
}

/**
 * Draw position of a slider step; the last step ends at full draw.
 * @param {SliderModel} m
 * @param {number} k
 */
export function xOfStep(m, k) {
  if (k >= m.count) return m.x1;
  if (k <= 0) return m.x0;
  return Math.min(m.x1, m.x0 + k * m.step);
}

/**
 * Nearest slider step of a draw position.
 * @param {SliderModel} m
 * @param {number} x (m)
 */
export function stepOfX(m, x) {
  if (!(x > m.x0)) return 0;
  if (x >= m.x1) return m.count;
  const k = Math.min(m.count, Math.round((x - m.x0) / m.step));
  // The last step can be shorter than the others.
  if (k >= m.count - 1 && m.x1 - x < Math.abs(x - xOfStep(m, m.count - 1))) return m.count;
  return k;
}

/**
 * Where the position sits for the next result: pinned to brace or full
 * draw, or at a draw length.
 * @typedef {{ pin: 'brace' | 'full' | null, x: number }} Position
 */

/**
 * Draw position of a kept position in a new range.
 * @param {Position} pos
 * @param {number} x0
 * @param {number} x1
 */
export function placeIn(pos, x0, x1) {
  if (pos.pin === 'brace') return x0;
  if (pos.pin === 'full') return x1;
  return Math.min(x1, Math.max(x0, pos.x));
}

/**
 * Text of the position for the readout and the slider's accessible value,
 * for example "Draw 24.00 in, draw force 251 N, cam turned 180.0° from brace".
 * @param {BowPose} pose
 * @param {Units} units
 * @param {Position} pos
 * @param {number} requestedX draw position the slider asks for (m)
 */
export function positionText(pose, units, pos, requestedX) {
  const where = pos.pin === 'brace' ? ' (brace)' : pos.pin === 'full' ? ' (full draw)' : '';
  const base = `Draw ${drawText(requestedX, units)} ${units.draw}${where}`;
  if (pose.beyondSolution) return `${base}: beyond the solved range; showing ${drawText(pose.x, units)} ${units.draw}`;
  return `${base}, draw force ${forceText(pose.F, units, true)} ${units.force}, cam turned ${angleText(pose.theta)} from brace`;
}

/**
 * Draw position of the largest draw force of a layout.
 * @param {LayoutContext} ctx
 */
export function peakX(ctx) {
  let best = -Infinity;
  let x = ctx.xBrace;
  for (let i = 0; i < ctx.valid; i++) {
    if (ctx.loads.F[i] > best) {
      best = ctx.loads.F[i];
      x = ctx.loads.x[i];
    }
  }
  return x;
}

/**
 * @typedef {object} Scrubber
 * @property {(ctx: LayoutContext | null, units: Units) => void} setDomain a new
 *   layout or units; null hides the control
 * @property {() => number} x the draw position the control asks for (m, NaN without a layout)
 * @property {(pose: BowPose | null, units: Units) => void} show write the readout of a pose
 */

/**
 * Build the draw-position control inside a container; `panel` is hidden
 * while no layout exists. onChange runs at most once per animation frame.
 * @param {HTMLElement} container
 * @param {{ panel?: HTMLElement, onChange: () => void }} options
 * @returns {Scrubber}
 */
export function createScrubber(container, { panel, onChange }) {
  const label = h('label', { for: 'draw-position', class: 'scrub-label', 'data-testid': 'scrubber-label' }, 'Draw position (AMO)');
  const slider = h('input', {
    type: 'range', id: 'draw-position', class: 'scrub-slider', min: 0, max: 1, step: 1, value: 0, 'data-testid': 'scrubber',
  });
  /**
   * @param {string} text
   * @param {string} testid
   * @param {string} content
   */
  const button = (text, testid, content) => h('button', { type: 'button', class: 'scrub-btn', 'aria-label': text, title: text, 'data-testid': testid }, content);
  const minus = button('One step towards brace', 'scrubber-minus', '−');
  const plus = button('One step towards full draw', 'scrubber-plus', '+');
  const toBrace = h('button', { type: 'button', class: 'scrub-jump', 'data-testid': 'scrubber-brace' }, 'Brace');
  const toPeak = h('button', { type: 'button', class: 'scrub-jump', 'data-testid': 'scrubber-peak' }, 'Peak force');
  const toFull = h('button', { type: 'button', class: 'scrub-jump', 'data-testid': 'scrubber-full' }, 'Full draw');
  const readout = h('output', { for: 'draw-position', class: 'scrub-readout', 'data-testid': 'scrubber-readout' });
  container.append(
    h('div', { class: 'scrub-row' }, label),
    h('div', { class: 'scrub-row scrub-controls' }, minus, slider, plus),
    h('div', { class: 'scrub-row scrub-jumps', role: 'group', 'aria-label': 'Jump to draw position' }, toBrace, toPeak, toFull),
    readout,
  );

  // Height of the sticky bar, so focused elements scroll clear of it.
  if (panel) {
    new ResizeObserver(() => {
      if (panel.hidden) return;
      document.documentElement.style.setProperty('--scrub-h', `${panel.offsetHeight}px`);
    }).observe(panel);
  }

  /** @type {LayoutContext | null} */
  let ctx = null;
  /** @type {SliderModel | null} */
  let model = null;
  /** @type {Position} */
  let pos = { pin: 'brace', x: NaN };
  let frame = 0;

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  }

  /**
   * Enable the step buttons for a step; a focused button that becomes
   * disabled hands focus to the slider, which announces the position.
   * @param {number} step
   * @param {number} count
   */
  function setButtons(step, count) {
    const minusOff = step === 0;
    const plusOff = step === count;
    if ((minusOff && document.activeElement === minus) || (plusOff && document.activeElement === plus)) slider.focus();
    minus.disabled = minusOff;
    plus.disabled = plusOff;
  }

  /** @param {number} k */
  function setStep(k) {
    if (!model) return;
    const step = Math.min(model.count, Math.max(0, Math.round(k)));
    slider.value = String(step);
    pos = { pin: step === 0 ? 'brace' : step === model.count ? 'full' : null, x: xOfStep(model, step) };
    setButtons(step, model.count);
    schedule();
  }

  slider.addEventListener('input', () => setStep(Number(slider.value)));
  // The slider announces its own value; the readout announces the moves of
  // the buttons.
  slider.addEventListener('focus', () => readout.setAttribute('aria-live', 'off'));
  slider.addEventListener('blur', () => readout.removeAttribute('aria-live'));
  minus.addEventListener('click', () => setStep(Number(slider.value) - 1));
  plus.addEventListener('click', () => setStep(Number(slider.value) + 1));
  toBrace.addEventListener('click', () => setStep(0));
  toFull.addEventListener('click', () => model && setStep(model.count));
  toPeak.addEventListener('click', () => ctx && model && setStep(stepOfX(model, peakX(ctx))));

  return {
    setDomain(next, units) {
      ctx = next;
      if (panel && panel.hidden !== !next) {
        panel.hidden = !next;
        if (!next) document.documentElement.style.removeProperty('--scrub-h');
      }
      if (!next) {
        model = null;
        return;
      }
      const m = sliderModel(next.xBrace, next.xFull, units);
      model = m;
      label.textContent = `Draw position (AMO, ${units.draw})`;
      const x = placeIn(pos, m.x0, m.x1);
      const step = pos.pin === 'full' ? m.count : pos.pin === 'brace' ? 0 : stepOfX(m, x);
      setAttrs(slider, { max: m.count });
      slider.value = String(step);
      pos = { pin: pos.pin, x };
      setButtons(step, m.count);
    },
    x() {
      if (!model) return NaN;
      return placeIn(pos, model.x0, model.x1);
    },
    show(pose, units) {
      const text = pose && model ? positionText(pose, units, pos, placeIn(pos, model.x0, model.x1)) : '';
      if (readout.textContent !== text) readout.textContent = text;
      if (slider.getAttribute('aria-valuetext') !== text) setAttrs(slider, { 'aria-valuetext': text || null });
    },
  };
}
