/**
 * Force curve model: metrics of a target curve, the parametric generator and
 * immutable edit operations on the control points. SI units (m, N, J).
 * @module core/curve
 */

import { createCurve } from './interp.js';
import { AMO_OFFSET, INCH } from './units.js';

/** @typedef {import('./interp.js').CurvePoint} CurvePoint */
/** @typedef {import('./interp.js').Curve} Curve */

/** Minimum x distance between two points: 0.1 in (2.54 mm). */
export const MIN_GAP = 0.1 * INCH;
/** Smallest force of any point except the brace point, in N. */
export const MIN_FORCE = 1;
/** Largest force of any point, in N. */
export const MAX_FORCE = 5000;
/** Largest number of control points. */
export const MAX_POINTS = 50;
/** Valley band above the holding weight, as a fraction of the peak (5 %). */
export const VALLEY_BAND = 0.05;

/**
 * Fractions used by the parametric generator.
 * - rampX, rampF: the ramp point sits at rampX of the rise with rampF of the peak
 *   (a concave rise from brace).
 * - plateau: the peak plateau takes this fraction of the space between peak
 *   start and valley start.
 * - transitionF: the let-off transition point sits halfway between plateau end
 *   and valley start, at this fraction of the drop from peak to holding weight.
 * - riseFraction: rise from brace to peak as a fraction of the power stroke.
 * - valleyWidth: target valley width in m (1.25 in).
 */
export const GENERATOR_DEFAULTS = Object.freeze({
  rampX: 0.4,
  rampF: 0.7,
  plateau: 0.6,
  transitionF: 0.5,
  riseFraction: 0.3,
  valleyWidth: 1.25 * INCH,
});

/**
 * Nock positions at brace and full draw. x is measured from the grip pivot
 * point, so x_b is the brace height and x_f is the AMO draw length − 1.75 in.
 * @param {number} braceHeight (m)
 * @param {number} drawLength AMO draw length (m)
 * @returns {{ xBrace: number, xFull: number }}
 */
export function drawRange(braceHeight, drawLength) {
  return { xBrace: braceHeight, xFull: drawLength - AMO_OFFSET };
}

/** Sample count per knot interval for extremum search. */
const SAMPLES_PER_INTERVAL = 64;
/** Tolerance of extremum and crossing locations, in m. */
const X_TOLERANCE = 1e-9;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * @typedef {object} CurveMetrics
 * @property {number} xBrace brace position x_b (m)
 * @property {number} xFull full-draw position x_f (m)
 * @property {number} peak peak force (N)
 * @property {number} xPeak position of the peak (m)
 * @property {number} hold holding weight: minimum force on [x_peak, x_f] (N)
 * @property {number} xHold position of the holding weight (m)
 * @property {number} letOff (peak − hold) / peak, 0 to 1
 * @property {number} valleyStart start of the valley (m)
 * @property {number} valleyEnd end of the valley (m)
 * @property {number} valleyWidth length of the interval around the minimum,
 *   within [x_peak, x_f], where F ≤ hold + 5 % of the peak (m)
 * @property {number} energy draw energy: integral of F from x_b to x_f (J)
 * @property {number} powerStroke x_f − x_b (m)
 */

/**
 * Sorted sample positions on [a, b]: every knot inside plus a uniform
 * subdivision of each knot interval.
 * @param {Float64Array} knots
 * @param {number} a
 * @param {number} b
 * @returns {number[]}
 */
function denseGrid(knots, a, b) {
  const xs = [a];
  for (let k = 0; k < knots.length - 1; k++) {
    const x0 = knots[k];
    const x1 = knots[k + 1];
    if (x1 <= a || x0 >= b) continue;
    for (let j = 0; j <= SAMPLES_PER_INTERVAL; j++) {
      const x = x0 + ((x1 - x0) * j) / SAMPLES_PER_INTERVAL;
      if (x > xs[xs.length - 1] && x < b) xs.push(x);
    }
  }
  xs.push(b);
  return xs;
}

/**
 * Golden-section search for a minimum of f on [a, b].
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @returns {{ x: number, value: number }}
 */
function goldenMin(f, a, b) {
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > X_TOLERANCE) {
    if (fc <= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = f(d);
    }
  }
  const x = 0.5 * (a + b);
  return { x, value: f(x) };
}

/**
 * Extremum of f on a grid, refined by golden-section search in the bracket
 * around the best sample.
 * @param {(x: number) => number} f
 * @param {number[]} xs
 * @param {1 | -1} sign 1 for a minimum, −1 for a maximum
 * @returns {{ x: number, value: number }}
 */
function extremum(f, xs, sign) {
  /** @param {number} x */
  const g = (x) => sign * f(x);
  let best = 0;
  let bestValue = g(xs[0]);
  for (let j = 1; j < xs.length; j++) {
    const v = g(xs[j]);
    if (v < bestValue) {
      best = j;
      bestValue = v;
    }
  }
  const lo = xs[Math.max(best - 1, 0)];
  const hi = xs[Math.min(best + 1, xs.length - 1)];
  const refined = goldenMin(g, lo, hi);
  if (refined.value < bestValue) return { x: refined.x, value: sign * refined.value };
  return { x: xs[best], value: sign * bestValue };
}

/**
 * Location of the crossing of f through level between a (f ≤ level) and
 * b (f > level), by bisection.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {number} level
 */
function crossing(f, a, b, level) {
  while (Math.abs(b - a) > X_TOLERANCE) {
    const m = 0.5 * (a + b);
    if (f(m) <= level) a = m;
    else b = m;
  }
  return 0.5 * (a + b);
}

/**
 * Metrics of a force curve over its full range [x_b, x_f]. Extrema come from
 * dense sampling refined by golden-section search, crossings from bisection,
 * both to 1e-9 m. The valley band is 5 % of the peak above the holding weight.
 * @param {Curve} curve
 * @returns {CurveMetrics}
 */
export function curveMetrics(curve) {
  const { knots } = curve;
  const xBrace = knots[0];
  const xFull = knots[knots.length - 1];
  const f = curve.evaluate;

  const peakAt = extremum(f, denseGrid(knots, xBrace, xFull), -1);
  const afterPeak = denseGrid(knots, peakAt.x, xFull);
  const holdAt = extremum(f, afterPeak, 1);
  const peak = peakAt.value;
  const hold = holdAt.value;
  const letOff = peak > 0 ? (peak - hold) / peak : 0;

  // Walk outwards from the minimum to the first samples above the band.
  // Grid samples j − 1 and j enclose the minimum (x_hold ≤ x_j).
  const level = hold + VALLEY_BAND * peak;
  const xs = afterPeak;
  let j = xs.findIndex((x) => x >= holdAt.x);
  if (j < 0) j = xs.length - 1;
  let start = xs[0];
  for (let k = j - 1; k >= 0; k--) {
    if (f(xs[k]) > level) {
      start = crossing(f, k + 1 < j ? xs[k + 1] : holdAt.x, xs[k], level);
      break;
    }
  }
  let end = xFull;
  for (let k = j; k < xs.length; k++) {
    if (f(xs[k]) > level) {
      end = crossing(f, k > j ? xs[k - 1] : holdAt.x, xs[k], level);
      break;
    }
  }

  return {
    xBrace,
    xFull,
    peak,
    xPeak: peakAt.x,
    hold,
    xHold: holdAt.x,
    letOff,
    valleyStart: start,
    valleyEnd: end,
    valleyWidth: end - start,
    energy: curve.integral(xBrace, xFull),
    powerStroke: xFull - xBrace,
  };
}

/**
 * Metrics of the interpolant through a set of points.
 * @param {ReadonlyArray<CurvePoint>} points
 * @returns {CurveMetrics}
 */
export function pointMetrics(points) {
  return curveMetrics(createCurve(points));
}

/**
 * @typedef {object} GeneratorInput
 * @property {number} xBrace brace position (m)
 * @property {number} xFull full-draw position (m)
 * @property {number} peak peak force (N)
 * @property {number} letOff 0 to 0.95
 * @property {number} [riseFraction] rise from brace to peak start as a
 *   fraction of the power stroke, 0.1 to 0.6 (default 0.3)
 * @property {number} [valleyWidth] target valley width as measured by
 *   {@link curveMetrics} (m, default 1.25 in)
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
 * Seven points of a parametric force curve for a given flat valley length.
 * @param {GeneratorInput} input
 * @param {number} flat length of the flat part at full draw (m)
 * @returns {CurvePoint[]}
 */
function curvePoints(input, flat) {
  const { xBrace, xFull, peak } = input;
  const riseFraction = input.riseFraction ?? GENERATOR_DEFAULTS.riseFraction;
  const hold = Math.max(peak * (1 - input.letOff), MIN_FORCE);
  const stroke = xFull - xBrace;
  const G = GENERATOR_DEFAULTS;
  const xPeakStart = xBrace + riseFraction * stroke;
  const xValleyStart = xFull - flat;
  const xPeakEnd = xPeakStart + G.plateau * (xValleyStart - xPeakStart);
  const xTransition = 0.5 * (xPeakEnd + xValleyStart);
  return [
    { x: xBrace, F: 0 },
    { x: xBrace + G.rampX * (xPeakStart - xBrace), F: G.rampF * peak },
    { x: xPeakStart, F: peak },
    { x: xPeakEnd, F: peak },
    { x: xTransition, F: hold + G.transitionF * (peak - hold) },
    { x: xValleyStart, F: hold },
    { x: xFull, F: hold },
  ];
}

/**
 * Parametric force curve: brace (x_b, 0), ramp point, peak start, peak end,
 * let-off transition point, valley start and full draw (x_f, holding weight).
 * The fractions are in {@link GENERATOR_DEFAULTS}. The flat part at full
 * draw is adjusted in four secant steps so that the measured valley width
 * matches the requested one; it stays between 0.1 in and half the distance
 * from peak start to full draw.
 * @param {GeneratorInput} input
 * @returns {CurvePoint[]}
 */
export function generateCurve(input) {
  const { xBrace, xFull, peak, letOff } = input;
  if (!(Number.isFinite(xBrace) && Number.isFinite(xFull) && xFull - xBrace >= 20 * MIN_GAP)) {
    throw new RangeError('The power stroke must be at least 2 in');
  }
  if (!(peak >= MIN_FORCE && peak <= MAX_FORCE && letOff >= 0 && letOff < 1)) {
    throw new RangeError('Peak or let-off out of range');
  }
  const stroke = xFull - xBrace;
  const riseFraction = clamp(input.riseFraction ?? GENERATOR_DEFAULTS.riseFraction, 0.1, 0.6);
  const target = input.valleyWidth ?? GENERATOR_DEFAULTS.valleyWidth;
  const args = { ...input, riseFraction };
  const flatMax = 0.5 * (1 - riseFraction) * stroke;
  const flatMin = MIN_GAP;
  let flat = clamp(target, flatMin, flatMax);
  for (let it = 0; it < 4; it++) {
    const measured = pointMetrics(curvePoints(args, flat)).valleyWidth;
    const next = clamp(flat + (target - measured), flatMin, flatMax);
    if (Math.abs(next - flat) < X_TOLERANCE) break;
    flat = next;
  }
  return curvePoints(args, flat);
}

/**
 * @typedef {object} EditLimits
 * @property {number} [minGap] minimum x distance between points (m)
 * @property {number} [minForce] (N)
 * @property {number} [maxForce] (N)
 */

/**
 * @typedef {object} EditResult
 * @property {CurvePoint[]} points the new points, or a copy of the old ones
 *   when the edit is refused
 * @property {number} index index of the affected point, −1 when refused
 * @property {string | null} error reason for a refusal
 */

/**
 * @param {EditLimits} [limits]
 */
function withDefaults(limits = {}) {
  return {
    minGap: limits.minGap ?? MIN_GAP,
    minForce: limits.minForce ?? MIN_FORCE,
    maxForce: limits.maxForce ?? MAX_FORCE,
  };
}

/**
 * @param {ReadonlyArray<CurvePoint>} points
 * @returns {CurvePoint[]}
 */
function copy(points) {
  return points.map((p) => ({ x: p.x, F: p.F }));
}

/**
 * Move a point, clamped to the editing limits. Point 0 (brace) does not move.
 * The last point keeps its x. Interior points stay at least minGap from
 * their neighbours. Forces stay within [minForce, maxForce].
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {number} index
 * @param {{ x?: number, F?: number }} target
 * @param {EditLimits} [limits]
 * @returns {CurvePoint[]}
 */
export function movePoint(points, index, target, limits) {
  const { minGap, minForce, maxForce } = withDefaults(limits);
  const next = copy(points);
  const last = points.length - 1;
  if (index <= 0 || index > last) return next;
  const p = next[index];
  if (target.F !== undefined && Number.isFinite(target.F)) {
    p.F = clamp(target.F, minForce, maxForce);
  }
  if (index < last && target.x !== undefined && Number.isFinite(target.x)) {
    const lo = points[index - 1].x + minGap;
    const hi = points[index + 1].x - minGap;
    p.x = lo <= hi ? clamp(target.x, lo, hi) : 0.5 * (points[index - 1].x + points[index + 1].x);
  }
  return next;
}

/**
 * Insert a point in x order. The force defaults to the interpolant value at
 * x. Refused outside the open range (x_b, x_f), within minGap of an existing
 * point, or when the curve already has {@link MAX_POINTS} points.
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {number} x
 * @param {number} [F]
 * @param {EditLimits} [limits]
 * @returns {EditResult}
 */
export function addPoint(points, x, F, limits) {
  const { minGap, minForce, maxForce } = withDefaults(limits);
  const refuse = (/** @type {string} */ error) => ({ points: copy(points), index: -1, error });
  if (points.length >= MAX_POINTS) return refuse(`A curve can have at most ${MAX_POINTS} points`);
  const first = points[0].x;
  const last = points[points.length - 1].x;
  if (!Number.isFinite(x) || x <= first || x >= last) return refuse('The new point must lie between brace and full draw');
  if (points.some((p) => Math.abs(p.x - x) < minGap)) return refuse('The new point is too close to an existing point');
  const force = F !== undefined && Number.isFinite(F) ? F : createCurve(points).evaluate(x);
  const index = points.findIndex((p) => p.x > x);
  const next = copy(points);
  next.splice(index, 0, { x, F: clamp(force, minForce, maxForce) });
  return { points: next, index, error: null };
}

/**
 * Point addition in the middle of the widest x gap.
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {EditLimits} [limits]
 * @returns {EditResult}
 */
export function addPointInWidestGap(points, limits) {
  let widest = 0;
  for (let k = 1; k < points.length - 1; k++) {
    if (points[k + 1].x - points[k].x > points[widest + 1].x - points[widest].x) widest = k;
  }
  return addPoint(points, 0.5 * (points[widest].x + points[widest + 1].x), undefined, limits);
}

/**
 * Reason why a point cannot be removed, or null when it can.
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {number} index
 * @returns {string | null}
 */
export function removeRefusal(points, index) {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) return 'No point is selected';
  if (index === 0) return 'The brace point cannot be removed';
  if (index === points.length - 1) return 'The full-draw point cannot be removed';
  if (points.length <= 3) return 'A curve needs at least 3 points';
  return null;
}

/**
 * Remove a point. Refused for the brace point, the full-draw point and when
 * fewer than 3 points would remain.
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {number} index
 * @returns {EditResult}
 */
export function removePoint(points, index) {
  const error = removeRefusal(points, index);
  if (error) return { points: copy(points), index: -1, error };
  const next = copy(points);
  next.splice(index, 1);
  return { points: next, index, error: null };
}

/**
 * Scale the forces of all points except the brace point by newPeak / oldPeak.
 * The peak of the interpolant equals the largest point force, so the result
 * has exactly the new peak unless the force limits clamp it.
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {number} newPeak (N)
 * @param {EditLimits} [limits]
 * @returns {CurvePoint[]}
 */
export function scalePeak(points, newPeak, limits) {
  const { minForce, maxForce } = withDefaults(limits);
  const oldPeak = Math.max(...points.map((p) => p.F));
  const next = copy(points);
  if (!(oldPeak > 0) || !Number.isFinite(newPeak)) return next;
  const k = newPeak / oldPeak;
  for (let i = 1; i < next.length; i++) next[i].F = clamp(next[i].F * k, minForce, maxForce);
  return next;
}

/**
 * Set the let-off with an affine map F → peak − (peak − F)·c applied to the
 * points after the last peak point, so the holding weight becomes
 * peak·(1 − letOff). Forces stay ≥ minForce, which limits the let-off. A
 * curve whose last point is the peak has no points to map and keeps its
 * let-off of 0.
 * @param {ReadonlyArray<CurvePoint>} points
 * @param {number} newLetOff 0 to 1
 * @param {EditLimits} [limits]
 * @returns {{ points: CurvePoint[], letOff: number }} new points and the
 *   achieved let-off
 */
export function setLetOff(points, newLetOff, limits) {
  const { minForce } = withDefaults(limits);
  const next = copy(points);
  let k = 0;
  for (let i = 1; i < points.length; i++) if (points[i].F >= points[k].F) k = i;
  const peak = points[k].F;
  // Every point after the last peak point is strictly below the peak.
  const after = next.slice(k + 1);
  if (after.length > 0 && Number.isFinite(newLetOff)) {
    const oldHold = Math.min(...after.map((p) => p.F));
    const newHold = Math.max(peak * (1 - clamp(newLetOff, 0, 1)), minForce);
    const c = (peak - newHold) / (peak - oldHold);
    for (const p of after) p.F = Math.max(peak - (peak - p.F) * c, minForce);
  }
  return { points: next, letOff: pointMetrics(next).letOff };
}
