/**
 * Project store: current state, actions, undo and redo, and transactions
 * that group several changes (one drag gesture) into one history entry.
 * States are treated as immutable; every change creates a new object.
 * @module state/store
 */

import { MIN_GAP, drawRange, generateCurve, pointMetrics, scalePeak, setLetOff } from '../core/curve.js';
import { FIELDS, drawLengthMessage, validate, validateField, validatePoints } from './schema.js';

/** @typedef {import('./schema.js').ProjectState} ProjectState */
/** @typedef {import('./schema.js').Units} Units */
/** @typedef {import('./schema.js').Geometry} Geometry */
/** @typedef {import('./schema.js').CurveParams} CurveParams */
/** @typedef {import('./schema.js').LimbState} LimbState */
/** @typedef {import('./schema.js').StringTrack} StringTrack */
/** @typedef {import('./schema.js').Cords} Cords */
/** @typedef {import('./schema.js').Body} Body */
/** @typedef {import('./schema.js').Tuning} Tuning */
/** @typedef {import('./schema.js').ValidationError} ValidationError */
/** @typedef {import('../core/interp.js').CurvePoint} CurvePoint */

/** Largest number of undo steps kept. */
export const HISTORY_LIMIT = 100;

/**
 * Store actions. setCurveParams on a custom curve rescales the current
 * points, or basePoints when given: a slider gesture passes the points from
 * its start, so every value applies to the same points and the steps of the
 * gesture do not compound.
 * @typedef {{ type: 'setUnits', units: Partial<Units> }
 *   | { type: 'setGeometry', geometry: Partial<Geometry> }
 *   | { type: 'setCurvePoints', points: CurvePoint[] }
 *   | { type: 'setCurveParams', params: Partial<CurveParams>, basePoints?: CurvePoint[] }
 *   | { type: 'regenerateCurve' }
 *   | { type: 'setLimb', limb: Partial<LimbState> }
 *   | { type: 'setStringTrack', stringTrack: Partial<StringTrack> }
 *   | { type: 'setCords', cords: Partial<Cords> }
 *   | { type: 'setBody', body: Partial<Body> }
 *   | { type: 'setTuning', tuning: Partial<Tuning> }
 *   | { type: 'load', state: ProjectState }} Action
 */

/**
 * @typedef {(state: ProjectState, previous: ProjectState, info: { replaced: boolean }) => void} Listener
 *   replaced: the state came from {@link Store.replace} (another design)
 */

/**
 * @typedef {object} Store
 * @property {() => ProjectState} getState
 * @property {(action: Action) => ValidationError[]} dispatch applies the
 *   action when the resulting state is valid; returns the validation errors
 *   otherwise and keeps the state
 * @property {(listener: Listener) => () => void} subscribe returns the unsubscribe function
 * @property {() => boolean} undo false when there is nothing to undo or a
 *   transaction is open
 * @property {() => boolean} redo false when there is nothing to redo or a
 *   transaction is open
 * @property {(next: ProjectState) => ValidationError[]} replace switches
 *   to another design: applies a valid state, clears undo, redo and any
 *   open transaction, and always notifies; not undoable. Returns the
 *   validation errors and keeps everything otherwise
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 * @property {() => boolean} beginTransaction
 * @property {() => boolean} commitTransaction
 * @property {() => boolean} cancelTransaction
 * @property {() => boolean} inTransaction
 */

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * @param {Geometry} geometry
 * @param {CurveParams} params
 */
function regenerate(geometry, params) {
  return generateCurve({ ...drawRange(geometry.braceHeight, geometry.drawLength), ...params });
}

/**
 * @param {Geometry} geometry
 */
function geometryValid(geometry) {
  return (
    !validateField('geometry.braceHeight', geometry.braceHeight) &&
    !validateField('geometry.drawLength', geometry.drawLength) &&
    !drawLengthMessage(geometry.braceHeight, geometry.drawLength)
  );
}

/**
 * @param {CurveParams} params
 */
function paramsValid(params) {
  return ['peak', 'letOff', 'riseFraction', 'valleyWidth'].every(
    (key) => !validateField(`curve.params.${key}`, params[/** @type {keyof CurveParams} */ (key)]),
  );
}

/**
 * Peak and let-off parameters set to the measured values of custom points,
 * rounded to 12 significant digits and clamped to their ranges, so
 * regenerating keeps them.
 * @param {CurveParams} params
 * @param {CurvePoint[]} points
 * @returns {CurveParams}
 */
function syncParams(params, points) {
  const m = pointMetrics(points);
  const peak = FIELDS['curve.params.peak'];
  const letOff = FIELDS['curve.params.letOff'];
  /** @param {number} v */
  const round = (v) => Number(v.toPrecision(12));
  return {
    ...params,
    peak: clamp(round(m.peak), peak.min, peak.max),
    letOff: clamp(round(m.letOff), letOff.min, letOff.max),
  };
}

/**
 * Map point x linearly from one brace/full-draw range to another, then move
 * points apart where a gap fell below {@link MIN_GAP}. A stroke shorter than
 * (n − 1) gaps of MIN_GAP cannot hold n points: interior points at the
 * smallest gaps are dropped first. The power stroke of a valid geometry
 * (more than 2 in) holds at least 21 points. Order and forces stay.
 * @param {CurvePoint[]} points
 * @param {{ xBrace: number, xFull: number }} from
 * @param {{ xBrace: number, xFull: number }} to
 * @returns {CurvePoint[]}
 */
function rescalePoints(points, from, to) {
  const k = (to.xFull - to.xBrace) / (from.xFull - from.xBrace);
  const out = points.map((p, i) => ({
    x: i === 0 ? to.xBrace : i === points.length - 1 ? to.xFull : to.xBrace + (p.x - from.xBrace) * k,
    F: p.F,
  }));
  const fit = Math.floor((to.xFull - to.xBrace) / MIN_GAP + 1e-9) + 1;
  while (out.length > Math.max(fit, 3)) {
    // The interior point at the smallest gap; the last gap drops the point before full draw.
    let drop = 1;
    for (let i = 2; i < out.length; i++) if (out[i].x - out[i - 1].x < out[drop].x - out[drop - 1].x) drop = i;
    out.splice(Math.min(drop, out.length - 2), 1);
  }
  const last = out.length - 1;
  for (let i = 1; i < last; i++) out[i].x = Math.max(out[i].x, out[i - 1].x + MIN_GAP);
  for (let i = last - 1; i > 0; i--) out[i].x = Math.min(out[i].x, out[i + 1].x - MIN_GAP);
  return out;
}

/**
 * @param {ReadonlyArray<CurvePoint>} a
 * @param {ReadonlyArray<CurvePoint>} b
 */
function samePoints(a, b) {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.F === b[i].F);
}

/**
 * Next state for an action. The caller validates the result.
 * @param {ProjectState} state
 * @param {Action} action
 * @returns {ProjectState}
 */
export function reduce(state, action) {
  const curve = state.curve;
  switch (action.type) {
    case 'setUnits':
      return { ...state, units: { ...state.units, ...action.units } };
    case 'setGeometry': {
      const geometry = { ...state.geometry, ...action.geometry };
      if (!geometryValid(geometry)) return { ...state, geometry };
      const from = drawRange(state.geometry.braceHeight, state.geometry.drawLength);
      const to = drawRange(geometry.braceHeight, geometry.drawLength);
      if (from.xBrace === to.xBrace && from.xFull === to.xFull) return { ...state, geometry };
      const points = curve.mode === 'parametric' ? regenerate(geometry, curve.params) : rescalePoints(curve.points, from, to);
      return { ...state, geometry, curve: { ...curve, points } };
    }
    case 'setCurvePoints': {
      // An edit that changes nothing keeps the mode and records nothing.
      if (samePoints(action.points, curve.points)) return state;
      const points = action.points.map((p) => ({ x: p.x, F: p.F }));
      const valid = validatePoints(points, state.geometry).length === 0;
      const params = valid ? syncParams(curve.params, points) : curve.params;
      return { ...state, curve: { mode: 'custom', params, points } };
    }
    case 'setCurveParams': {
      let params = { ...curve.params, ...action.params };
      if (!paramsValid(params)) return { ...state, curve: { ...curve, params } };
      if (curve.mode === 'parametric') {
        return { ...state, curve: { ...curve, params, points: regenerate(state.geometry, params) } };
      }
      let points = action.basePoints ?? curve.points;
      if (action.params.peak !== undefined) points = scalePeak(points, params.peak);
      if (action.params.letOff !== undefined) points = setLetOff(points, params.letOff).points;
      params = syncParams(params, points);
      return { ...state, curve: { ...curve, params, points } };
    }
    case 'regenerateCurve':
      return { ...state, curve: { ...curve, mode: 'parametric', points: regenerate(state.geometry, curve.params) } };
    case 'setLimb':
      return { ...state, limb: { ...state.limb, ...action.limb } };
    case 'setStringTrack':
      return { ...state, stringTrack: { ...state.stringTrack, ...action.stringTrack } };
    case 'setCords':
      return { ...state, cords: { ...state.cords, ...action.cords } };
    case 'setBody':
      return { ...state, body: { ...state.body, ...action.body } };
    case 'setTuning':
      return { ...state, tuning: { ...state.tuning, ...action.tuning } };
    case 'load':
      return action.state;
    default:
      throw new Error(`Unknown action type "${/** @type {{ type: string }} */ (action).type}"`);
  }
}

/**
 * @param {ProjectState} a
 * @param {ProjectState} b
 */
function sameState(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Create a store holding a valid initial state.
 * @param {ProjectState} initial
 * @param {{ historyLimit?: number }} [options]
 * @returns {Store}
 */
export function createStore(initial, options = {}) {
  const limit = options.historyLimit ?? HISTORY_LIMIT;
  let state = initial;
  /** @type {ProjectState[]} */
  const past = [];
  /** @type {ProjectState[]} */
  let future = [];
  /** @type {ProjectState | null} */
  let txStart = null;
  /** @type {Set<Listener>} */
  const listeners = new Set();

  /**
   * @param {ProjectState} previous
   * @param {boolean} [replaced]
   */
  function emit(previous, replaced = false) {
    const info = { replaced };
    for (const listener of [...listeners]) listener(state, previous, info);
  }

  /** @param {ProjectState} previous */
  function record(previous) {
    past.push(previous);
    if (past.length > limit) past.shift();
    future = [];
  }

  function commitTransaction() {
    if (txStart === null) return false;
    const start = txStart;
    txStart = null;
    if (!sameState(start, state)) record(start);
    emit(state);
    return true;
  }

  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      const errors = validate(next);
      if (errors.length > 0) return errors;
      if (sameState(next, state)) return [];
      const previous = state;
      if (txStart === null) record(previous);
      state = next;
      emit(previous);
      return [];
    },
    replace(next) {
      const errors = validate(next);
      if (errors.length > 0) return errors;
      past.length = 0;
      future = [];
      txStart = null;
      const previous = state;
      state = next;
      emit(previous, true);
      return [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    undo() {
      // A gesture in progress keeps its one history entry.
      if (txStart !== null) return false;
      const previous = past.pop();
      if (!previous) return false;
      future.push(state);
      const current = state;
      state = previous;
      emit(current);
      return true;
    },
    redo() {
      if (txStart !== null) return false;
      const next = future.pop();
      if (!next) return false;
      past.push(state);
      const current = state;
      state = next;
      emit(current);
      return true;
    },
    canUndo: () => txStart === null && past.length > 0,
    canRedo: () => txStart === null && future.length > 0,
    beginTransaction() {
      if (txStart !== null) return false;
      txStart = state;
      return true;
    },
    commitTransaction,
    cancelTransaction() {
      if (txStart === null) return false;
      const current = state;
      state = txStart;
      txStart = null;
      emit(current);
      return true;
    },
    inTransaction: () => txStart !== null,
  };
}
