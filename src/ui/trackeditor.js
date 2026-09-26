/**
 * Free-form string track editor and shape presets in the String track
 * group of the settings.
 *
 * - Polar view (SVG, width 100 %, at most 280 px wide): the groove bottom,
 *   the axle bore and one handle per value at its contact point
 *   X(ψ_i) = p·n + p'·t, where the tangent line of the value touches the
 *   groove. The working arc of the latest result (brace to full-draw
 *   contact) is drawn thick; handles outside it shape the outline only.
 * - A drag moves a smooth bump along the direction of the value and stops
 *   exactly at the bend limit or at the end of the value range
 *   (core/freeform dragLimit); the stopped handle and its text say which.
 *   One drag is one undo step.
 * - Keyboard: one tab stop for the handles (roving focus). Left and Right
 *   pick a point, Up and Down change its value by 0.1 mm (Shift 0.5 mm), in
 *   inch mode 0.005 in (Shift 0.02 in).
 * - Values table with typed input, "Offset all points" and the Points
 *   select (8, 12 or 16, resampling the spline).
 * - Shape presets (core/freeform modifiers) add a term to the current track
 *   and turn an eccentric or elliptical track into a free-form one; the
 *   default amount is clamped to the bend limit plus PRESET_MARGIN, and the
 *   panel says what limits it (core/freeform presetRoom).
 *
 * Every change is one store action and one undo step.
 * @module ui/trackeditor
 */

import {
  FREEFORM_RANGE, LIMIT_TOLERANCE, MODIFIERS, MODIFIER_MAX_AMOUNT, VALUE_RESOLUTION, applyModifier, contactPoints,
  dragBump, dragLimit, freeformLimit, knotAngles, offsetValues, pitchMinRho, pointsFor, presetRoom, resample,
  resampleChecked, roomDefault, sampleAnalytic, withinLimit,
} from '../core/freeform.js';
import { createSupport, freeformSupport } from '../core/support.js';
import { fromSI, parseQuantity, toSI } from '../core/units.js';
import { freeformErrors } from '../state/schema.js';
import { DEGREE, dimsText, drawText, fixed, plain } from './display.js';
import { h, setAttrs, svg } from './dom.js';
import { infoButton } from './glossary.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').StringTrack} StringTrack */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('../state/store.js').Store} Store */
/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/freeform.js').FreeformLimit} FreeformLimit */
/** @typedef {import('../core/freeform.js').ModifierId} ModifierId */
/** @typedef {import('../core/freeform.js').PresetRoom} PresetRoom */
/** @typedef {import('../core/freeform.js').SampledTrack} SampledTrack */

/** Decimals of free-form track values in the table and the report, per dimension unit. */
export const VALUE_DECIMALS = Object.freeze({ mm: 2, in: 4 });

/** Keyboard step of one value, in the dimension unit; Shift takes the large step. */
export const EDIT_STEP = Object.freeze({ mm: { step: 0.1, large: 0.5 }, in: { step: 0.005, large: 0.02 } });

/** Default of the "Offset all points" field, in the dimension unit. */
export const OFFSET_DEFAULT = Object.freeze({ mm: 0.5, in: 0.02 });

/** Margin over the bend limit of the default preset amount: 0.5 mm (m). */
export const PRESET_MARGIN = 0.5e-3;

/** Shape presets in menu order. */
export const PRESET_IDS = /** @type {readonly ModifierId[]} */ (Object.freeze(['oval', 'triangle', 'square', 'egg', 'size', 'shift']));

/** Point counts of the Points select. */
export const POINT_CHOICES = Object.freeze([8, 12, 16]);

/** Radius of the pointer hit area around a handle: 22 px (44 px target). */
export const HIT_RADIUS = 22;

/** Glossary entries with an info button in the editor. */
export const EDITOR_GLOSSARY = Object.freeze(/** @type {const} */ (['workingArc']));

/**
 * Values rounded to VALUE_RESOLUTION (0.1 µm), as sampled values are, so
 * saved designs and share links stay short.
 * @param {readonly number[]} values (m)
 * @returns {number[]}
 */
export function roundValues(values) {
  const digits = Math.round(-Math.log10(VALUE_RESOLUTION));
  return values.map((v) => Number(v.toFixed(digits)));
}

/** Sampled analytic tracks, per track object: the panel renders often. */
/** @type {WeakMap<StringTrack, SampledTrack>} */
const sampledTracks = new WeakMap();

/**
 * The current track as free-form values with their check: the free-form
 * values, or the eccentric or elliptical track sampled by
 * core/freeform sampleAnalytic (12 to 16 points).
 * @param {StringTrack} track
 * @returns {SampledTrack}
 */
export function trackSample(track) {
  let out = sampledTracks.get(track);
  if (!out) {
    out = sampleAnalytic(track);
    sampledTracks.set(track, out);
  }
  return out;
}

/**
 * Values of the current track, as {@link trackSample}.
 * @param {StringTrack} track
 * @returns {number[]} (m)
 */
export function trackValues(track) {
  return [...trackSample(track).values];
}

/** Names of the analytic shapes in the sampling note. */
const SHAPE_NAMES = Object.freeze({ eccentric: 'eccentric circle', ellipse: 'ellipse', freeform: 'free-form track' });

/**
 * Note on an eccentric or elliptical track sampled for a free-form track
 * that does not follow it within SAMPLE_TOLERANCE of core/freeform, or ''
 * when it does.
 * @param {SampledTrack} sampled
 * @param {StringTrack['shape']} shape shape of the sampled track
 * @param {Units} units
 */
export function sampledText(sampled, shape, units) {
  if (sampled.within) return '';
  return `The ${SHAPE_NAMES[shape]} sampled at ${sampled.points} points does not follow it closely: `
    + `the groove radius differs by up to ${dimsText(sampled.pError, units)}, and the sharpest bend of the groove is `
    + `${dimsText(sampled.minRho, units)} against ${dimsText(sampled.exactMinRho, units)}.`;
}

/**
 * Range of the groove radius in the dimension unit: "2 to 150 mm", or
 * "0.079 to 5.906 in (2 to 150 mm)".
 * @param {Units} units
 */
export function rangeText(units) {
  const mm = `${plain(FREEFORM_RANGE.min * 1e3)} to ${plain(FREEFORM_RANGE.max * 1e3)} mm`;
  if (units.dims === 'mm') return mm;
  return `${fixed(fromSI(FREEFORM_RANGE.min, 'length', 'in'), 3)} to ${fixed(fromSI(FREEFORM_RANGE.max, 'length', 'in'), 3)} in (${mm})`;
}

/**
 * A signed length in the dimension unit with the table decimals and a
 * minus sign, without unit: "−21.01".
 * @param {number} v (m)
 * @param {Units} units
 */
function signedText(v, units) {
  return valueText(v, units).replace(/^-/, '−');
}

/**
 * First error of free-form values in the words of the editor: "Point 2
 * would get a groove radius of −1.20 mm; groove radii stay from 2 to
 * 150 mm", with the numbers in the dimension unit (see {@link rangeText});
 * null without error.
 * @param {readonly number[]} values (m)
 * @param {Units} units
 * @returns {string | null}
 */
export function valuesError(values, units) {
  const error = freeformErrors(values)[0];
  if (!error) return null;
  const index = /\[(\d+)\]$/.exec(error.path);
  if (!index) return error.message;
  const i = Number(index[1]);
  const v = values[i];
  const got = Number.isFinite(v) ? ` would get a groove radius of ${signedText(v, units)} ${units.dims};` : ': the groove radius is not a number;';
  return `Point ${i + 1}${got} groove radii stay from ${rangeText(units)}`;
}

/**
 * Range of an offset of all values that keeps them in FREEFORM_RANGE (m).
 * @param {readonly number[]} values (m)
 * @returns {{ min: number, max: number }}
 */
export function offsetRange(values) {
  return { min: FREEFORM_RANGE.min - Math.min(...values), max: FREEFORM_RANGE.max - Math.max(...values) };
}

/**
 * Message of an offset outside {@link offsetRange}, or null within it.
 * The bounds are rounded inwards to the table decimals.
 * @param {readonly number[]} values (m)
 * @param {number} delta (m)
 * @param {Units} units
 * @returns {string | null}
 */
export function offsetError(values, delta, units) {
  const range = offsetRange(values);
  // Rounding of the typed value: 1 nm.
  if (delta >= range.min - 1e-9 && delta <= range.max + 1e-9) return null;
  const d = VALUE_DECIMALS[units.dims];
  const scale = 10 ** d;
  const lo = fixed(Math.ceil(fromSI(range.min, 'length', units.dims) * scale - 1e-6) / scale, d).replace(/^-/, '−');
  const hi = fixed(Math.floor(fromSI(range.max, 'length', units.dims) * scale + 1e-6) / scale, d).replace(/^-/, '−');
  return `The offset must be from ${lo} to ${hi} ${units.dims}, so every groove radius stays from ${rangeText(units)}`;
}

/**
 * Bend limit of the string pitch line of a design, with a margin.
 * @param {ProjectState} s
 * @param {number} [margin] (m)
 * @returns {FreeformLimit}
 */
export function limitOf(s, margin = 0) {
  return freeformLimit(s.body, s.cords.stringDiameter, margin);
}

/**
 * Why a drag stopped: the bend limit, or the end of the value range.
 * @typedef {'bend' | 'range'} StopReason
 */

/**
 * Values after a drag of the bump at index by delta, stopped at the limit.
 * A track that misses the limit already is limited by the value range only,
 * so it can still be moved. The values are rounded; a rounded track that
 * misses the limit steps back by LIMIT_TOLERANCE-sized steps.
 * @param {readonly number[]} values (m)
 * @param {number} index
 * @param {number} delta requested move (m), positive outwards
 * @param {FreeformLimit} limit
 * @returns {{ values: number[], moved: number, stopped: boolean, reason: StopReason | null }}
 *   moved: the move applied (m); stopped: the move is shorter than
 *   requested; reason: what stopped it, null when not stopped
 */
export function dragValues(values, index, delta, limit) {
  if (delta === 0 || !Number.isFinite(delta)) return { values: [...values], moved: 0, stopped: false, reason: null };
  const direction = delta > 0 ? 1 : -1;
  const bound = withinLimit(values, limit) ? limit : { ...limit, rho: -Infinity, margin: 0 };
  const most = Math.abs(dragLimit(values, index, direction, bound));
  let t = Math.min(Math.abs(delta), most);
  let out = roundValues(dragBump(values, index, direction * t));
  for (let i = 0; i < 20 && t > 0 && !withinLimit(out, bound); i++) {
    t = Math.max(0, t - 1e-6);
    out = roundValues(dragBump(values, index, direction * t));
  }
  if (t === 0) out = [...values];
  const stopped = Math.abs(delta) > t;
  /** @type {StopReason | null} */
  let reason = null;
  if (stopped) {
    // A value just past the stop outside the range: the range stopped it.
    const past = dragBump(values, index, direction * (most + 2 * LIMIT_TOLERANCE));
    const inRange = past.every((v) => v >= FREEFORM_RANGE.min && v <= FREEFORM_RANGE.max);
    reason = bound.rho === -Infinity || !inRange ? 'range' : 'bend';
  }
  return { values: out, moved: direction * t, stopped, reason };
}

/**
 * Text of a stopped drag: ", stopped at the bend limit" or ", stopped at
 * the end of the groove radius range, 2 to 150 mm"; '' when not stopped.
 * @param {StopReason | null} reason
 * @param {Units} units
 */
export function stoppedText(reason, units) {
  if (reason === 'bend') return ', stopped at the bend limit';
  if (reason !== 'range') return '';
  return `, stopped at the end of the groove radius range, ${rangeText(units)}`;
}

/**
 * Values after a change of the single value at index by delta (keyboard).
 * A change that leaves the value range, or takes a track within the limit
 * beyond it, is refused.
 * @param {readonly number[]} values (m)
 * @param {number} index
 * @param {number} delta (m)
 * @param {FreeformLimit} limit
 * @returns {{ values: number[], refused: 'range' | 'limit' | null }}
 */
export function stepValues(values, index, delta, limit) {
  const out = roundValues(values.map((v, i) => (i === index ? v + delta : v)));
  const v = out[index];
  if (v < FREEFORM_RANGE.min || v > FREEFORM_RANGE.max) return { values: [...values], refused: 'range' };
  if (withinLimit(values, limit) && !withinLimit(out, limit)) return { values: [...values], refused: 'limit' };
  return { values: out, refused: null };
}

/**
 * @typedef {object} WorkingArc
 * @property {number} start contact angle of the string at brace (rad)
 * @property {number} end contact angle at full draw (rad)
 * @property {Float64Array} psi contact angles of the forward model (rad)
 * @property {Float64Array} x nock positions of the same samples (m)
 */

/**
 * Working arc of the string track in a result: the part of the track the
 * string leaves from between brace and full draw. Null without a forward
 * model.
 * @param {SolveResult | null} result
 * @returns {WorkingArc | null}
 */
export function workingArc(result) {
  const a = result?.achieved;
  if (!a || a.psiS.length < 2) return null;
  const start = a.psiS[0];
  const end = a.psiS[a.psiS.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  return { start, end, psi: a.psiS, x: a.x };
}

/**
 * Angle of a direction counted from the start of the arc: the angle in
 * [start, start + 2π) that points the same way.
 * @param {number} psi (rad)
 * @param {WorkingArc} arc
 */
function unwrap(psi, arc) {
  const turn = 2 * Math.PI;
  return arc.start + ((((psi - arc.start) % turn) + turn) % turn);
}

/**
 * Whether the string leaves the track at angle psi between brace and full
 * draw.
 * @param {number} psi (rad)
 * @param {WorkingArc | null} arc
 */
export function inArc(psi, arc) {
  // Rounding of the unwrapped angle: 1e-12 rad.
  return arc !== null && unwrap(psi, arc) <= arc.end + 1e-12;
}

/**
 * Nock position at which the string leaves the track at angle psi, linear
 * between the samples of the forward model; NaN outside the working arc.
 * @param {number} psi (rad)
 * @param {WorkingArc | null} arc
 * @returns {number} (m)
 */
export function drawAt(psi, arc) {
  if (!arc || !inArc(psi, arc)) return NaN;
  const u = Math.min(unwrap(psi, arc), arc.end);
  const { psi: angles, x } = arc;
  if (u <= angles[0]) return x[0];
  for (let j = 1; j < angles.length; j++) {
    if (angles[j] >= u) {
      const span = angles[j] - angles[j - 1];
      const f = span > 0 ? (u - angles[j - 1]) / span : 1;
      return x[j - 1] + f * (x[j] - x[j - 1]);
    }
  }
  return NaN;
}

/**
 * A value in the dimension unit with the table decimals, without unit.
 * @param {number} v (m)
 * @param {Units} units
 */
export function valueText(v, units) {
  return fixed(fromSI(v, 'length', units.dims), VALUE_DECIMALS[units.dims]);
}

/**
 * Angle of point i of n in whole or decimal degrees, for example '30°' or '22.5°'.
 * @param {number} i
 * @param {number} n
 */
export function knotDegrees(i, n) {
  return `${plain((360 * i) / n, 4)}${DEGREE}`;
}

/**
 * Description of a point: "Point 3 at 60°: 33.34 mm".
 * @param {number} i 0-based
 * @param {readonly number[]} values (m)
 * @param {Units} units
 */
export function pointText(i, values, units) {
  return `Point ${i + 1} at ${knotDegrees(i, values.length)}: ${valueText(values[i], units)} ${units.dims}`;
}

/**
 * Sharpest bend of the pitch line against the limit: "Sharpest bend
 * 9.1 mm, limit 5.0 mm", with "below the limit" when it misses it.
 * @param {readonly number[]} values (m)
 * @param {FreeformLimit} limit
 * @param {Units} units
 */
export function bendText(values, limit, units) {
  const rho = pitchMinRho(values, limit.d).value;
  const text = `Sharpest bend ${dimsText(rho, units)}, limit ${dimsText(limit.rho, units)}`;
  return rho >= limit.rho ? text : `${text}: below the limit, the solve reports it`;
}

/**
 * Text of a preset application: "Oval of 1.00 mm at 0° applied".
 * @param {ModifierId} id
 * @param {number} amount (m)
 * @param {number} angle (rad)
 * @param {Units} units
 */
export function presetText(id, amount, angle, units) {
  const at = id === 'size' ? '' : ` at ${plain(fromSI(angle, 'angle', 'deg'), 4)}${DEGREE}`;
  return `${MODIFIERS[id].label} of ${valueText(amount, units)} ${units.dims}${at} applied`;
}

/**
 * Values of a track with a preset added, rounded. An eccentric or
 * elliptical track is sampled first, as {@link trackSample}.
 * @param {StringTrack} track
 * @param {ModifierId} id
 * @param {number} amount (m)
 * @param {number} angle (rad)
 */
export function presetValues(track, id, amount, angle) {
  return roundValues(applyModifier(trackValues(track), id, amount, angle));
}

/**
 * Bore radius plus minimum wall of a design, the clearance a Shift keeps (m).
 * @param {ProjectState} s
 */
export function wallOf(s) {
  return s.body.boreDiameter / 2 + s.body.minWall;
}

/**
 * An amount rounded up to the table decimals of the dimension unit, so
 * the amount shown still reaches the limit it was found for (m).
 * @param {number} amount (m)
 * @param {Units} units
 */
export function roundUp(amount, units) {
  const scale = 10 ** VALUE_DECIMALS[units.dims];
  // 1e-6 of a display step absorbs the rounding of the conversion.
  return toSI(Math.ceil(fromSI(amount, 'length', units.dims) * scale - 1e-6) / scale, 'length', units.dims);
}

/**
 * Room of a preset on a track and the amount to fill in: the clamped
 * default of core/freeform, and for Size on a track that misses the
 * margin the smallest amount that restores it, rounded up to the table
 * decimals.
 * @param {readonly number[]} values (m)
 * @param {ModifierId} id
 * @param {number} angle (rad)
 * @param {ProjectState} s
 * @returns {{ room: PresetRoom, amount: number, rho: number }} rho: the
 *   sharpest bend of the pitch line of the track the preset changes (m)
 */
export function presetPlan(values, id, angle, s) {
  const limit = limitOf(s, PRESET_MARGIN);
  const room = presetRoom(values, id, angle, limit, wallOf(s));
  const raw = Math.max(0, roomDefault(values, id, room));
  let amount = raw;
  if (id === 'size' && room.track !== 'within' && raw > 0) {
    // The nearest amount of the table decimals when it reaches the margin
    // (the bisection ends up to 1 µm above the exact amount), else the next one up.
    const near = toSI(Number(valueText(raw, s.units)), 'length', s.units.dims);
    amount = near > 0 && withinLimit(applyModifier(values, 'size', near, 0), limit) ? near : roundUp(raw, s.units);
  }
  const rho = pitchMinRho(resample(values, pointsFor(id, values.length)), limit.d).value;
  return { room, amount, rho };
}

/**
 * Text of the room of a preset, for the line under the amount.
 * - A track below the bend limit, or within it but inside the margin: says
 *   so with the sharpest bend; Size names the smallest amount that brings
 *   the track within the limit and the margin.
 * - Otherwise the largest amount and what limits it: the bend limit with
 *   its margin, the groove radius range, the bore clearance (Shift) or the
 *   largest amount a preset takes. Without room it says which limit blocks
 *   the preset, and names a negative amount that fits.
 * @param {{ room: PresetRoom, amount: number, rho: number }} plan
 * @param {ModifierId} id
 * @param {ProjectState} s
 */
export function presetRoomText(plan, id, s) {
  const { room, amount, rho } = plan;
  const units = s.units;
  const limit = limitOf(s);
  const margin = dimsText(PRESET_MARGIN, units);
  const bend = `sharpest bend ${dimsText(rho, units)}, limit ${dimsText(limit.rho, units)}`;
  const size = () => (amount > 0
    ? ` A Size of at least ${valueText(amount, units)} ${units.dims} brings it within the limit and the ${margin} margin.`
    : ` No Size up to ${plain(fromSI(MODIFIER_MAX_AMOUNT, 'length', units.dims))} ${units.dims} brings it within the limit and the ${margin} margin.`);
  if (id !== 'shift' && room.track === 'below') {
    return `The track bends more sharply than the limit: ${bend}.${id === 'size' ? size() : ' Size raises every bend.'}`;
  }
  if (id !== 'shift' && room.track === 'margin') {
    return `The track is within the bend limit but inside the ${margin} margin of the presets: ${bend}.`
      + `${id === 'size' ? size() : ' Size raises every bend.'}`;
  }
  const range = `the groove radius range, ${rangeText(units)}`;
  if (room.most > 0) {
    const within = room.stop === 'bend' ? `within the bend limit and a ${margin} margin`
      : room.stop === 'range' ? `within ${range}`
        : room.stop === 'bore' ? 'that keeps the groove clear of the bore and its wall'
          : 'this preset takes';
    const note = id === 'shift' ? '. Shift moves the track and does not change its bend' : '';
    return `Largest amount ${within}: ${valueText(room.most, units)} ${units.dims}${note}`;
  }
  const blocked = room.stop === 'range' ? `${range[0].toUpperCase()}${range.slice(1)}, leaves no room for this preset in this direction`
    : room.stop === 'bore' ? 'The bore clearance leaves no room for this preset in this direction'
      : `The track is at the bend limit and the ${margin} margin for this preset at this angle`;
  const other = room.negative < 0
    ? `; a negative amount down to ${signedText(room.negative, units)} ${units.dims} fits.`
    : '; try another angle.';
  return `${blocked}${other}`;
}

/**
 * Options of the Points select: 8, 12 and 16, plus the current count when
 * it is another one (a loaded design).
 * @param {number} n
 */
export function pointChoices(n) {
  return POINT_CHOICES.includes(n) ? [...POINT_CHOICES] : [...POINT_CHOICES, n].sort((a, b) => a - b);
}

/**
 * Square view of the track in drawing units (mm, y down): centre and half
 * side. It holds the groove outline, the handles and the axle bore with
 * 25 % to spare for the marks; the centre and the half side are rounded to
 * 5 mm, so the view keeps its place and scale through small edits.
 * @param {{ x: number, y: number }[]} outline cam-frame points (m)
 * @param {number} boreRadius (m)
 * @returns {{ cx: number, cy: number, half: number }} (mm)
 */
export function viewBox(outline, boreRadius) {
  const b = boreRadius * 1e3;
  let minX = -b;
  let maxX = b;
  let minY = -b;
  let maxY = b;
  for (const p of outline) {
    minX = Math.min(minX, p.x * 1e3);
    maxX = Math.max(maxX, p.x * 1e3);
    minY = Math.min(minY, -p.y * 1e3);
    maxY = Math.max(maxY, -p.y * 1e3);
  }
  const round5 = (/** @type {number} */ v) => Math.round(v / 5) * 5;
  const cx = round5((minX + maxX) / 2);
  const cy = round5((minY + maxY) / 2);
  const far = Math.max(cx - minX, maxX - cx, cy - minY, maxY - cy);
  return { cx, cy, half: Math.max(5, Math.ceil((far * 1.25) / 5) * 5) };
}

/**
 * SVG path through cam-frame points (m), drawn in mm with y down.
 * @param {{ x: number, y: number }[]} points
 * @param {boolean} [close]
 */
export function pathOf(points, close = false) {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 1e3).toFixed(3)} ${(-p.y * 1e3).toFixed(3)}`).join('');
  return close ? `${d}Z` : d;
}

/** Samples of the drawn groove outline over one turn. */
const OUTLINE_SAMPLES = 240;

/**
 * Groove outline of the values over one turn, or over [from, to].
 * @param {ReturnType<typeof createSupport>} s
 * @param {number} [from] (rad)
 * @param {number} [to] (rad)
 */
function outlineOf(s, from = 0, to = 2 * Math.PI) {
  const count = Math.max(2, Math.ceil((OUTLINE_SAMPLES * (to - from)) / (2 * Math.PI)));
  return Array.from({ length: count + 1 }, (_, i) => s.point(from + ((to - from) * i) / count));
}

/**
 * Free-form editor and shape presets.
 * @param {Store} store
 * @returns {{ editor: HTMLElement, presets: HTMLElement, render: (s: ProjectState) => void,
 *   setResult: (result: SolveResult | null) => void }}
 */
export function createTrackEditor(store) {
  // ---- Polar view ----------------------------------------------------
  const helpId = 'track-editor-help';
  const root = svg('svg', {
    class: 'track-view',
    role: 'group',
    'aria-label': 'Free-form string track',
    'aria-describedby': helpId,
    'data-testid': 'track-editor-view',
  });
  const bore = svg('circle', { class: 'track-bore', cx: 0, cy: 0, 'aria-hidden': 'true' });
  const axle = svg('path', { class: 'track-axle', 'aria-hidden': 'true' });
  const guides = svg('g', { class: 'track-guides', 'aria-hidden': 'true' });
  const groove = svg('path', { class: 'track-groove', 'aria-hidden': 'true', 'data-testid': 'track-editor-groove' });
  const arcPath = svg('path', { class: 'track-arc', 'aria-hidden': 'true', 'data-testid': 'track-editor-arc' });
  const marks = svg('g', { class: 'track-marks', 'aria-hidden': 'true' });
  const handleLayer = svg('g', { class: 'track-handles' });
  root.append(bore, axle, guides, groove, arcPath, marks, handleLayer);

  const live = h('p', { class: 'hint track-live', 'aria-live': 'polite', 'data-testid': 'track-editor-live' });
  const bendLine = h('p', { class: 'hint', 'data-testid': 'track-editor-bend' });
  const arcLine = h('p', { class: 'hint', 'data-testid': 'track-editor-arc-note' });
  const help = h('p', { class: 'hint', id: helpId },
    'Drag a point along its line: its neighbours follow in a smooth bump, and the drag stops at the bend limit or at the end of the groove radius range. ',
    'Keyboard: Tab to the points, Left and Right pick a point, Up and Down change its groove radius by ',
    '0.1 mm (Shift: 0.5 mm) or 0.005 in (Shift: 0.02 in). ',
    'Each point sits where the tangent line of its value touches the groove, so points move sideways when their neighbours change.');
  const arcTitle = h('div', { class: 'field-label-row' }, h('span', {}, 'Thick line: working arc, brace (B) to full draw (F)'), infoButton('workingArc'));

  // ---- Values table --------------------------------------------------
  const valueHead = h('th', { scope: 'col' });
  const drawHead = h('th', { scope: 'col' });
  const tbody = h('tbody');
  const table = h('table', { 'aria-describedby': 'track-values-note' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Point'), h('th', { scope: 'col' }, `Angle (${DEGREE})`), drawHead, valueHead)),
    tbody);
  const tableNote = h('p', { class: 'field-range', id: 'track-values-note', 'data-testid': 'track-values-note' });
  const tableMsg = h('p', { class: 'field-msg', 'aria-live': 'polite', 'data-testid': 'track-values-msg' });
  const values = h('details', { class: 'point-table track-values', 'data-testid': 'track-values' },
    h('summary', {}, 'Point values'), tableNote, h('div', { class: 'table-scroll' }, table), tableMsg);

  // ---- Offset all points -------------------------------------------
  const offsetInput = h('input', {
    id: 'track-offset', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': 'track-offset-note', 'data-testid': 'track-offset',
  });
  const offsetUnit = h('span', { class: 'unit', 'aria-hidden': 'true' });
  const offsetButton = h('button', { type: 'button', 'data-testid': 'track-offset-apply' }, 'Offset all points');
  const offsetMsg = h('p', { class: 'field-msg', 'aria-live': 'polite', 'data-testid': 'track-offset-msg' });
  const offsetField = h('div', { class: 'field' },
    h('div', { class: 'field-label-row' }, h('label', { for: 'track-offset' }, 'Offset of all points, outwards')),
    h('div', { class: 'field-input-row' }, offsetInput, offsetUnit),
    h('p', { class: 'field-range', id: 'track-offset-note' }, 'Moves the whole track outwards (negative: inwards) and raises every radius of curvature by the same amount.'),
    offsetButton, offsetMsg);

  // ---- Points ------------------------------------------------------
  const pointsSelect = h('select', { id: 'track-points', 'aria-describedby': 'track-points-note track-points-msg', 'data-testid': 'track-points' });
  const pointsMsg = h('p', { class: 'field-msg', id: 'track-points-msg', 'aria-live': 'polite', 'data-testid': 'track-points-msg' });
  const pointsField = h('div', { class: 'field unit-field' },
    h('label', { for: 'track-points' }, 'Points'), pointsSelect,
    h('p', { class: 'field-range', id: 'track-points-note' }, 'Another number of points resamples the curve, which changes its shape slightly; check the sharpest bend after the change.'),
    pointsMsg);

  const editor = h('div', { class: 'track-editor', 'data-testid': 'track-editor' },
    h('div', { class: 'track-view-wrap' }, root), live, bendLine, arcTitle, arcLine, help, pointsField, offsetField, values);

  // ---- Shape presets ---------------------------------------------------
  const presetSelect = h('select', { id: 'preset-id', 'data-testid': 'preset-select' });
  for (const id of PRESET_IDS) presetSelect.append(h('option', { value: id }, MODIFIERS[id].label));
  const amountInput = h('input', {
    id: 'preset-amount', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': 'preset-largest', 'data-testid': 'preset-amount',
  });
  const amountLabel = h('label', { for: 'preset-amount' });
  const angleInput = h('input', {
    id: 'preset-angle', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: '0',
    'data-testid': 'preset-angle',
  });
  const largest = h('p', { class: 'field-range', id: 'preset-largest', 'data-testid': 'preset-largest' });
  const presetButton = h('button', { type: 'button', 'data-testid': 'preset-apply' }, 'Apply preset');
  const presetMsg = h('p', { class: 'hint', 'aria-live': 'polite', 'data-testid': 'preset-msg' });
  const presetError = h('p', { class: 'field-msg', 'aria-live': 'polite', 'data-testid': 'preset-error' });
  const angleField = h('div', { class: 'field' },
    h('div', { class: 'field-label-row' }, h('label', { for: 'preset-angle' }, `Angle (${DEGREE})`)),
    h('div', { class: 'field-input-row' }, angleInput));
  const presets = h('fieldset', { class: 'subgroup track-presets', 'data-testid': 'track-presets' },
    h('legend', {}, 'Shape presets'),
    h('p', { class: 'hint' }, 'A preset changes the current track and makes it a free-form track. A preset can make the design fail; the solve shows why.'),
    h('div', { class: 'field unit-field' }, h('label', { for: 'preset-id' }, 'Preset'), presetSelect),
    h('div', { class: 'field' },
      h('div', { class: 'field-label-row' }, amountLabel),
      h('div', { class: 'field-input-row' }, amountInput), largest),
    angleField, presetButton, presetError, presetMsg);

  // ---- State -----------------------------------------------------------
  /** @type {ProjectState} */
  let state = store.getState();
  /** @type {WorkingArc | null} */
  let arc = null;
  let selected = 0;
  /** Index of the handle whose last drag stopped at a limit, −1 for none. */
  let stopped = -1;
  /** What stopped that drag. */
  /** @type {StopReason | null} */
  let stoppedReason = null;
  /** Values the stopped mark belongs to. */
  /** @type {readonly number[] | null} */
  let stoppedValues = null;
  /** Half the side of the view (mm); frozen during a drag. */
  let R = 60;
  /** Centre of the view (mm, y down); frozen during a drag. */
  let VX = 0;
  let VY = 0;
  /** @type {SVGGElement[]} */
  let handles = [];
  /** @type {{ x: number, y: number, psi: number }[]} */
  let contacts = [];
  /**
   * Active drag: pointer start in client coordinates, the values at the
   * start and the scale of the view (mm per CSS px).
   * @type {{ index: number, pointerId: number, cx: number, cy: number, base: number[], scale: number, moved: boolean,
   *   stopped: StopReason | null } | null}
   */
  let drag = null;
  let amountTouched = false;
  /** The track the preset amount was filled for. */
  /** @type {StringTrack | null} */
  let amountFor = null;
  let shownTableKey = '';
  /** @type {HTMLInputElement[]} */
  let cells = [];
  /** @type {HTMLTableCellElement[]} */
  let drawCells = [];

  /** The track the shown messages describe; another track clears them. */
  /** @type {StringTrack | null} */
  let messagesFor = null;
  let shownChoices = '';

  /**
   * Show a message in an element; it stays until the track changes in
   * another way (undo, load, another edit).
   * @param {HTMLElement} el
   * @param {string} text
   */
  const show = (el, text) => {
    el.textContent = text;
    messagesFor = store.getState().stringTrack;
  };

  /** @param {string} text */
  const say = (text) => show(live, text);

  /** Current free-form values. */
  const current = () => store.getState().stringTrack.freeform.values;

  /**
   * Dispatch new values of the free-form track.
   * @param {number[]} next
   * @returns {string | null} error message
   */
  function setValues(next) {
    const error = valuesError(next, store.getState().units);
    if (error) return error;
    const errors = store.dispatch({ type: 'setStringTrack', stringTrack: { shape: 'freeform', freeform: { values: next } } });
    return errors.length > 0 ? errors[0].message : null;
  }

  // ---- Handles -------------------------------------------------------

  /** @param {number} n */
  function makeHandles(n) {
    handles = Array.from({ length: n }, (_, i) => {
      const g = svg('g', { class: 'track-handle', role: 'slider', 'aria-orientation': 'vertical', tabindex: -1, 'data-index': i, 'data-testid': `track-handle-${i + 1}` });
      g.append(svg('circle', { class: 'track-handle-ring' }), svg('circle', { class: 'track-handle-dot' }));
      return g;
    });
    handleLayer.replaceChildren(...handles);
  }

  /**
   * @param {number} i
   * @param {boolean} [focus]
   */
  function select(i, focus = false) {
    const n = handles.length;
    if (n === 0) return;
    selected = ((i % n) + n) % n;
    handles.forEach((g, j) => g.setAttribute('tabindex', j === selected ? '0' : '-1'));
    if (focus) handles[selected].focus({ preventScroll: true });
  }

  function renderView() {
    const s = state;
    const vals = s.stringTrack.freeform.values;
    const n = vals.length;
    const sup = createSupport(freeformSupport(vals));
    const outline = outlineOf(sup);
    contacts = contactPoints(vals);
    const boreRadius = s.body.boreDiameter / 2;
    if (!drag) ({ cx: VX, cy: VY, half: R } = viewBox([...outline, ...contacts], boreRadius));
    setAttrs(root, { viewBox: `${VX - R} ${VY - R} ${2 * R} ${2 * R}` });
    const dot = R * 0.05;
    bore.setAttribute('r', (boreRadius * 1e3).toFixed(3));
    const c = R * 0.04;
    axle.setAttribute('d', `M${-c} 0H${c}M0 ${-c}V${c}`);
    groove.setAttribute('d', pathOf(outline, true));
    if (arc) {
      const from = arc.start;
      const to = Math.min(arc.end, arc.start + 2 * Math.PI);
      arcPath.setAttribute('d', pathOf(outlineOf(sup, from, to)));
      const tick = (/** @type {number} */ psi, /** @type {string} */ label, /** @type {string} */ id) => {
        const p = sup.point(psi);
        const nx = Math.cos(psi);
        const ny = Math.sin(psi);
        const x = p.x * 1e3;
        const y = -p.y * 1e3;
        const line = svg('line', {
          class: 'track-mark', x1: x - nx * R * 0.06, y1: y + ny * R * 0.06, x2: x + nx * R * 0.1, y2: y - ny * R * 0.1,
          'data-testid': `track-arc-${id}`,
        });
        const text = svg('text', {
          class: 'track-mark-label', x: x + nx * R * 0.17, y: y - ny * R * 0.17, 'font-size': R * 0.1,
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
        });
        text.textContent = label;
        return [line, text];
      };
      marks.replaceChildren(...tick(arc.start, 'B', 'brace'), ...tick(arc.end, 'F', 'full'));
      arcPath.style.display = '';
    } else {
      arcPath.style.display = 'none';
      marks.replaceChildren();
    }
    // Guides: the line each handle moves along, through its contact point.
    guides.replaceChildren(...contacts.map((p) => {
      const nx = Math.cos(p.psi);
      const ny = Math.sin(p.psi);
      const x = p.x * 1e3;
      const y = -p.y * 1e3;
      const len = R * 0.12;
      return svg('line', { class: 'track-guide', x1: x - nx * len, y1: y + ny * len, x2: x + nx * len, y2: y - ny * len });
    }));
    if (handles.length !== n) {
      makeHandles(n);
      select(Math.min(selected, n - 1));
    }
    const units = s.units;
    const lo = fromSI(FREEFORM_RANGE.min, 'length', units.dims);
    const hi = fromSI(FREEFORM_RANGE.max, 'length', units.dims);
    const isStopped = stoppedValues === vals;
    handles.forEach((g, i) => {
      const p = contacts[i];
      g.setAttribute('transform', `translate(${(p.x * 1e3).toFixed(3)} ${(-p.y * 1e3).toFixed(3)})`);
      g.firstElementChild?.setAttribute('r', (dot * 1.7).toFixed(3));
      g.lastElementChild?.setAttribute('r', dot.toFixed(3));
      const outside = arc !== null && !inArc(p.psi, arc);
      g.classList.toggle('outside', outside);
      g.classList.toggle('selected', i === selected);
      const stop = isStopped && i === stopped ? stoppedReason : null;
      g.classList.toggle('stopped', stop === 'bend');
      g.classList.toggle('stopped-range', stop === 'range');
      const value = fromSI(vals[i], 'length', units.dims);
      setAttrs(g, {
        'aria-label': `Point ${i + 1} at ${knotDegrees(i, n)}${outside ? ', outline only' : ''}`,
        'aria-valuemin': plain(lo),
        'aria-valuemax': plain(hi),
        'aria-valuenow': plain(value),
        'aria-valuetext': `${valueText(vals[i], units)} ${units.dims}${stoppedText(stop, units)}`,
        'data-stopped': stop,
      });
    });
  }

  // ---- Table -----------------------------------------------------------

  /** @param {number} n */
  function makeRows(n) {
    tbody.replaceChildren();
    cells = [];
    drawCells = [];
    for (let i = 0; i < n; i++) {
      const input = h('input', {
        type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-testid': `track-value-${i + 1}`,
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitCell(i);
        } else if (e.key === 'Escape') {
          input.value = valueText(current()[i], store.getState().units);
          tableMsg.textContent = '';
        }
      });
      input.addEventListener('blur', () => commitCell(i));
      const drawCell = h('td', { 'data-testid': `track-draw-${i + 1}` });
      tbody.append(h('tr', {}, h('th', { scope: 'row' }, String(i + 1)), h('td', { 'data-testid': `track-angle-${i + 1}` }), drawCell, h('td', {}, input)));
      cells.push(input);
      drawCells.push(drawCell);
    }
  }

  /** @param {number} i */
  function commitCell(i) {
    const s = store.getState();
    if (s.stringTrack.shape !== 'freeform') return;
    const vals = s.stringTrack.freeform.values;
    const input = cells[i];
    if (!input) return;
    const shown = valueText(vals[i], s.units);
    if (input.value.trim() === shown) {
      input.setAttribute('aria-invalid', 'false');
      return;
    }
    const v = parseQuantity(input.value, 'length', s.units.dims);
    const lo = plain(fromSI(FREEFORM_RANGE.min, 'length', s.units.dims));
    const hi = plain(fromSI(FREEFORM_RANGE.max, 'length', s.units.dims));
    // A typed bound round-trips through the display unit.
    const tol = 1e-9 * FREEFORM_RANGE.max;
    if (!Number.isFinite(v) || v < FREEFORM_RANGE.min - tol || v > FREEFORM_RANGE.max + tol) {
      tableMsg.textContent = `Point ${i + 1}: the groove radius must be a number from ${lo} to ${hi} ${s.units.dims}`;
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    const clamped = Math.min(Math.max(v, FREEFORM_RANGE.min), FREEFORM_RANGE.max);
    const next = roundValues(vals.map((x, j) => (j === i ? clamped : x)));
    const error = setValues(next);
    input.setAttribute('aria-invalid', String(error !== null));
    tableMsg.textContent = error ?? '';
    // The focused cell keeps its text on renders: show the applied value.
    if (!error) input.value = valueText(next[i], s.units);
    if (!error) say(`${pointText(i, next, s.units)}. ${bendText(next, limitOf(s), s.units)}`);
  }

  function renderTable() {
    const s = state;
    const vals = s.stringTrack.freeform.values;
    const units = s.units;
    const n = vals.length;
    valueHead.textContent = `Groove radius (${units.dims})`;
    drawHead.textContent = `String leaves here at (${units.draw})`;
    tableNote.textContent = `The groove radius is the distance from the axle to the tangent line of the groove bottom at the angle of the point. The lever arm of the string, measured on its pitch line, is half the string diameter larger (${dimsText(s.cords.stringDiameter / 2, units)}). The column "String leaves here at" is blank for points outside the working arc.`;
    if (cells.length !== n) makeRows(n);
    const angles = knotAngles(n);
    const key = JSON.stringify([vals, units.dims]);
    const refill = key !== shownTableKey;
    shownTableKey = key;
    cells.forEach((input, i) => {
      const angleCell = tbody.rows[i]?.cells[1];
      if (angleCell) angleCell.textContent = plain((360 * i) / n, 4);
      const x = drawAt(angles[i], arc);
      drawCells[i].textContent = Number.isFinite(x) ? drawText(x, units) : '';
      input.setAttribute('aria-label', `Point ${i + 1} groove radius in ${units.dims}`);
      if (refill && (document.activeElement !== input)) {
        input.value = valueText(vals[i], units);
        input.setAttribute('aria-invalid', 'false');
      }
    });
    if (refill) tableMsg.textContent = '';
  }

  // ---- Presets -------------------------------------------------------

  const presetId = () => /** @type {ModifierId} */ (presetSelect.value);

  /** Angle of the preset field (rad), NaN when not a number. */
  const presetAngle = () => (presetId() === 'size' ? 0 : parseQuantity(angleInput.value.replace(/\s*°\s*$/, ''), 'angle', 'deg'));

  /** Fill the amount with the clamped default and show the largest amount. */
  function renderPresets() {
    const s = state;
    const units = s.units;
    const id = presetId();
    amountLabel.textContent = `Amount (${units.dims})`;
    angleField.hidden = id === 'size';
    const angle = presetAngle();
    const vals = trackValues(s.stringTrack);
    if (!Number.isFinite(angle)) {
      largest.textContent = 'Enter an angle to see the largest amount.';
      return;
    }
    const plan = presetPlan(vals, id, angle, s);
    const sampled = s.stringTrack.shape === 'freeform' ? '' : sampledText(trackSample(s.stringTrack), s.stringTrack.shape, units);
    const room = presetRoomText(plan, id, s);
    largest.textContent = sampled ? `${room}${room.endsWith('.') ? '' : '.'} ${sampled}` : room;
    if (!amountTouched || amountFor !== s.stringTrack) {
      amountInput.value = valueText(plan.amount, units);
      amountInput.setAttribute('aria-invalid', 'false');
      amountTouched = false;
      amountFor = s.stringTrack;
    }
  }

  presetSelect.addEventListener('change', () => {
    amountTouched = false;
    presetError.textContent = '';
    renderPresets();
  });
  amountInput.addEventListener('input', () => {
    amountTouched = true;
  });
  angleInput.addEventListener('change', () => {
    angleInput.setAttribute('aria-invalid', 'false');
    presetError.textContent = '';
    renderPresets();
  });
  presetButton.addEventListener('click', () => {
    const s = store.getState();
    const units = s.units;
    const id = presetId();
    const amount = parseQuantity(amountInput.value, 'length', units.dims);
    const angle = presetAngle();
    const most = plain(fromSI(MODIFIER_MAX_AMOUNT, 'length', units.dims));
    if (!Number.isFinite(amount) || Math.abs(amount) > MODIFIER_MAX_AMOUNT * (1 + 1e-9)) {
      presetError.textContent = `The amount must be a number from −${most} to ${most} ${units.dims}`;
      amountInput.setAttribute('aria-invalid', 'true');
      return;
    }
    if (!Number.isFinite(angle)) {
      presetError.textContent = 'The angle must be a number of degrees';
      angleInput.setAttribute('aria-invalid', 'true');
      return;
    }
    const next = presetValues(s.stringTrack, id, amount, angle);
    const error = setValues(next);
    presetError.textContent = error ?? '';
    amountInput.setAttribute('aria-invalid', String(error !== null));
    if (error) return;
    const sampled = s.stringTrack.shape === 'freeform' ? '' : sampledText(trackSample(s.stringTrack), s.stringTrack.shape, units);
    const text = `${presetText(id, amount, angle, units)}: ${next.length} points. ${bendText(next, limitOf(s), units)}.${sampled ? ` ${sampled}` : ''}`;
    show(presetMsg, text);
  });

  // ---- Offset and points ----------------------------------------------

  offsetButton.addEventListener('click', () => {
    const s = store.getState();
    if (s.stringTrack.shape !== 'freeform') return;
    const units = s.units;
    const delta = parseQuantity(offsetInput.value, 'length', units.dims);
    if (!Number.isFinite(delta)) {
      offsetMsg.textContent = 'The offset must be a number';
      offsetInput.setAttribute('aria-invalid', 'true');
      return;
    }
    const outside = offsetError(s.stringTrack.freeform.values, delta, units);
    if (outside) {
      offsetMsg.textContent = outside;
      offsetInput.setAttribute('aria-invalid', 'true');
      return;
    }
    const next = roundValues(offsetValues(s.stringTrack.freeform.values, delta));
    const error = setValues(next);
    offsetInput.setAttribute('aria-invalid', String(error !== null));
    offsetMsg.textContent = error ?? '';
    if (!error) say(`All points offset by ${valueText(delta, units)} ${units.dims}. ${bendText(next, limitOf(s), units)}`);
  });
  offsetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      offsetButton.click();
    }
  });

  pointsSelect.addEventListener('change', () => {
    const s = store.getState();
    const n = Number(pointsSelect.value);
    if (s.stringTrack.shape !== 'freeform' || n === s.stringTrack.freeform.values.length) return;
    const limit = limitOf(s);
    const wasWithin = withinLimit(s.stringTrack.freeform.values, limit);
    const r = resampleChecked(s.stringTrack.freeform.values, n, limit);
    const error = setValues(r.values);
    if (error) {
      pointsMsg.textContent = error;
      pointsSelect.value = String(s.stringTrack.freeform.values.length);
      return;
    }
    const bend = bendText(r.values, limit, s.units);
    show(pointsMsg, r.below && wasWithin
      ? `Resampled to ${n} points: the track now bends more sharply than the limit. ${bend}. Undo goes back.`
      : '');
    say(`Resampled to ${n} points. ${bend}`);
  });

  // ---- Pointer -------------------------------------------------------

  /** @param {PointerEvent} e */
  function nearest(e) {
    const r = root.getBoundingClientRect();
    if (!(r.width > 0)) return -1;
    const scale = (2 * R) / r.width;
    let best = -1;
    let bestDist = HIT_RADIUS;
    contacts.forEach((p, i) => {
      const px = r.left + (p.x * 1e3 - VX + R) / scale;
      const py = r.top + (-p.y * 1e3 - VY + R) / scale;
      const d = Math.hypot(px - e.clientX, py - e.clientY);
      if (d <= bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }

  /** @param {boolean} commit */
  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    delete root.dataset.dragging;
    if (root.hasPointerCapture(d.pointerId)) root.releasePointerCapture(d.pointerId);
    if (commit) store.commitTransaction();
    else store.cancelTransaction();
    const s = store.getState();
    if (d.moved && commit) {
      stopped = d.stopped ? d.index : -1;
      stoppedReason = d.stopped;
      stoppedValues = d.stopped ? s.stringTrack.freeform.values : null;
      const vals = s.stringTrack.freeform.values;
      say(`${pointText(d.index, vals, s.units)}${stoppedText(d.stopped, s.units)}. ${bendText(vals, limitOf(s), s.units)}`);
    }
    render(s);
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag || state.stringTrack.shape !== 'freeform') return;
    const i = nearest(e);
    if (i < 0) return;
    e.preventDefault();
    select(i, true);
    const r = root.getBoundingClientRect();
    drag = {
      index: i, pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, base: [...current()],
      scale: (2 * R) / (r.width || 1), moved: false, stopped: null,
    };
    root.setPointerCapture(e.pointerId);
    store.beginTransaction();
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = (e.clientX - drag.cx) * drag.scale;
    const dy = -(e.clientY - drag.cy) * drag.scale;
    if (!drag.moved && Math.hypot(dx, dy) / drag.scale < 3) return;
    drag.moved = true;
    root.dataset.dragging = 'true';
    const psi = (2 * Math.PI * drag.index) / drag.base.length;
    const delta = (dx * Math.cos(psi) + dy * Math.sin(psi)) * 1e-3;
    const out = dragValues(drag.base, drag.index, delta, limitOf(store.getState()));
    drag.stopped = out.reason;
    root.dataset.stopped = out.reason ?? 'false';
    if (out.values.some((v, j) => v !== current()[j])) setValues(out.values);
  });

  root.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
  });
  root.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  });
  root.addEventListener('lostpointercapture', (e) => {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
  });

  // ---- Keyboard ------------------------------------------------------

  handleLayer.addEventListener('focusin', (e) => {
    const i = handles.indexOf(/** @type {SVGGElement} */ (e.target));
    if (i < 0) return;
    if (i !== selected) select(i);
    handles.forEach((g, j) => g.classList.toggle('selected', j === i));
    const s = store.getState();
    say(`${pointText(i, s.stringTrack.freeform.values, s.units)}. ${bendText(s.stringTrack.freeform.values, limitOf(s), s.units)}`);
  });

  handleLayer.addEventListener('keydown', (e) => {
    const i = handles.indexOf(/** @type {SVGGElement} */ (e.target));
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const s = store.getState();
    const vals = s.stringTrack.freeform.values;
    const n = vals.length;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        select(i - 1, true);
        return;
      case 'ArrowRight':
        e.preventDefault();
        select(i + 1, true);
        return;
      case 'Home':
        e.preventDefault();
        select(0, true);
        return;
      case 'End':
        e.preventDefault();
        select(n - 1, true);
        return;
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const unit = s.units.dims;
        const size = EDIT_STEP[unit][e.shiftKey ? 'large' : 'step'];
        const delta = toSI(e.key === 'ArrowUp' ? size : -size, 'length', unit);
        const limit = limitOf(s);
        const r = stepValues(vals, i, delta, limit);
        if (r.refused === 'limit') {
          say(`${pointText(i, vals, s.units)}: a step of ${plain(size)} ${unit} bends the track more sharply than the limit ${dimsText(limit.rho, s.units)}`);
          return;
        }
        if (r.refused === 'range') {
          say(`${pointText(i, vals, s.units)}: the groove radius stays from ${plain(fromSI(FREEFORM_RANGE.min, 'length', unit))} to ${plain(fromSI(FREEFORM_RANGE.max, 'length', unit))} ${unit}`);
          return;
        }
        setValues(r.values);
        const now = store.getState();
        say(`${pointText(i, r.values, now.units)}. ${bendText(r.values, limit, now.units)}`);
        handles[i]?.focus({ preventScroll: true });
        return;
      }
      default:
    }
  });

  // ---- Render ----------------------------------------------------------

  /** @param {ProjectState} s */
  function render(s) {
    const previous = state;
    state = s;
    const freeform = s.stringTrack.shape === 'freeform';
    editor.hidden = !freeform;
    if (s.units !== previous.units || s.stringTrack !== previous.stringTrack) {
      offsetUnit.textContent = s.units.dims;
      if (s.units.dims !== previous.units.dims || offsetInput.value === '') {
        offsetInput.value = plain(OFFSET_DEFAULT[s.units.dims]);
      }
    }
    if (s.stringTrack !== previous.stringTrack && !drag) {
      if (stoppedValues !== s.stringTrack.freeform.values) {
        stopped = -1;
        stoppedReason = null;
        stoppedValues = null;
      }
      // Changed elsewhere (undo, load, a settings field): the old messages
      // no longer apply.
      if (s.stringTrack !== messagesFor) {
        for (const el of [live, presetMsg, presetError, pointsMsg, offsetMsg]) el.textContent = '';
      }
    }
    renderPresets();
    if (!freeform) return;
    const vals = s.stringTrack.freeform.values;
    const choices = pointChoices(vals.length);
    if (choices.join() !== shownChoices) {
      shownChoices = choices.join();
      pointsSelect.replaceChildren(...choices.map((n) => h('option', { value: String(n) }, String(n))));
    }
    pointsSelect.value = String(vals.length);
    renderView();
    renderTable();
    bendLine.textContent = `${bendText(vals, limitOf(s), s.units)}.`;
    arcLine.textContent = arc
      ? `The string leaves the track from ${fixed(fromSI(arc.start, 'angle', 'deg'), 0)}${DEGREE} at brace to ${fixed(fromSI(arc.end, 'angle', 'deg'), 0)}${DEGREE} at full draw (latest result). Grey points lie outside it and shape the outline only.`
      : 'No result yet: the working arc shows after the solve.';
  }

  offsetUnit.textContent = state.units.dims;
  offsetInput.value = plain(OFFSET_DEFAULT[state.units.dims]);
  // The first render compares against this state: start from an empty one.
  state = { ...state, stringTrack: { ...state.stringTrack } };

  return {
    editor,
    presets,
    render,
    setResult(result) {
      const next = workingArc(result);
      if (next === arc || (next && arc && next.psi === arc.psi)) return;
      arc = next;
      if (state.stringTrack.shape === 'freeform' && !drag) render(state);
    },
  };
}
