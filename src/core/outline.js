/**
 * Closed cam outline in the cam frame (axle at the origin, lengths in m,
 * angles in rad).
 *
 * Cable track: the active part [ψ_c0, ψ_cf] covers the draw. Before ψ_c0 a
 * lead-in arc of constant radius of curvature ρ_0 = ρ(ψ_c0) carries the
 * lead-in wrap, p = ρ_0 + A·cos(ψ − ψ_c0) + B·sin(ψ − ψ_c0) with
 * A = −p''(ψ_c0), B = p'(ψ_c0), so p, p' and p'' are continuous. The
 * remaining arc from ψ_cf to ψ_c0 − lead-in + 2π is closed by the quintic in
 * ψ that matches p, p', p'' at both joins. A periodic p with p + p'' > 0 is a
 * closed convex curve. The closed track is stored as a periodic C2 cubic
 * spline through samples of these pieces (spacing about 0.25° to 0.5°).
 *
 * String track: the closed parametric track of the project; its post sits
 * at the full-draw contact angle plus the residual wrap.
 *
 * Offsets: groove bottom = pitch − d/2, flange edge = groove bottom + groove
 * depth, both parallel curves of the pitch line (support p + δ).
 * @module core/outline
 */

import { fitCableTrack } from './fit.js';
import { evaluatePoly } from './inverse.js';
import { createSupport, offset, splineSupport } from './support.js';

const DEGREE = Math.PI / 180;

/** @typedef {import('./support.js').Support} Support */
/** @typedef {import('./support.js').SupportData} SupportData */
/** @typedef {import('./support.js').SplineData} SplineData */
/** @typedef {import('./inverse.js').PolyPiece} PolyPiece */

/**
 * @typedef {object} SplinePiece
 * @property {'spline'} kind
 * @property {number} start (rad)
 * @property {number} end (rad)
 * @property {SplineData} data open spline covering [start, end]
 */

/**
 * @typedef {object} ArcPiece
 * @property {'arc'} kind
 * @property {number} start (rad)
 * @property {number} end (rad)
 * @property {number} origin angle of the matching point (rad)
 * @property {number} rho radius of curvature (m)
 * @property {number} A (m)
 * @property {number} B (m)
 */

/** @typedef {(PolyPiece & { end: number }) | SplinePiece | ArcPiece} TrackPiece */

/**
 * @typedef {object} Piecewise
 * @property {number} start (rad)
 * @property {number} end (rad)
 * @property {TrackPiece[]} pieces
 * @property {(psi: number, out: Float64Array) => Float64Array} evaluate p, p', p''
 * @property {(psi: number) => number} rho
 */

/**
 * Evaluator of consecutive track pieces; outside [start, end] the first or
 * last piece continues.
 * @param {TrackPiece[]} pieces ordered, touching
 * @returns {Piecewise}
 */
export function createPiecewise(pieces) {
  const evaluators = pieces.map((piece) => {
    if (piece.kind === 'spline') {
      const s = createSupport(piece.data);
      return (/** @type {number} */ psi, /** @type {Float64Array} */ out) => s.evaluate(psi, out);
    }
    if (piece.kind === 'arc') {
      return (/** @type {number} */ psi, /** @type {Float64Array} */ out) => {
        const c = Math.cos(psi - piece.origin);
        const s = Math.sin(psi - piece.origin);
        out[0] = piece.rho + piece.A * c + piece.B * s;
        out[1] = -piece.A * s + piece.B * c;
        out[2] = -piece.A * c - piece.B * s;
        return out;
      };
    }
    return (/** @type {number} */ psi, /** @type {Float64Array} */ out) => evaluatePoly(piece, psi, out);
  });
  const buf = new Float64Array(3);
  /** @param {number} psi */
  const index = (psi) => {
    let k = 0;
    while (k < pieces.length - 1 && psi > pieces[k].end) k++;
    return k;
  };
  return {
    start: pieces[0].start,
    end: pieces[pieces.length - 1].end,
    pieces,
    evaluate: (psi, out) => evaluators[index(psi)](psi, out),
    rho(psi) {
      evaluators[index(psi)](psi, buf);
      return buf[0] + buf[2];
    },
  };
}

/**
 * Quintic on [start, start + length] with p, p', p'' given at both ends.
 * @param {number} start (rad)
 * @param {number} length (rad)
 * @param {ArrayLike<number>} a p, p', p'' at the start
 * @param {ArrayLike<number>} b p, p', p'' at the end
 * @returns {PolyPiece & { end: number }}
 */
export function hermiteQuintic(start, length, a, b) {
  const L = length;
  const c1 = L * a[1];
  const c2 = 0.5 * L * L * a[2];
  const D = b[0] - a[0] - c1 - c2;
  const E = L * b[1] - c1 - 2 * c2;
  const G = L * L * b[2] - 2 * c2;
  const coeffs = Float64Array.from([a[0], c1, c2, 10 * D - 4 * E + 0.5 * G, -15 * D + 7 * E - G, 6 * D - 3 * E + 0.5 * G]);
  return { kind: 'poly', start, length: L, end: start + L, coeffs };
}

/**
 * Smallest value of f on [a, b]: a grid of `count` cells refined by
 * golden-section search around the smallest grid value.
 * @param {(psi: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {number} count
 * @returns {{ value: number, at: number }}
 */
export function minimumOn(f, a, b, count) {
  let at = a;
  let value = Infinity;
  const h = (b - a) / count;
  for (let k = 0; k <= count; k++) {
    const psi = a + k * h;
    const v = f(psi);
    if (v < value || Number.isNaN(v)) {
      value = v;
      at = psi;
      if (Number.isNaN(v)) return { value, at };
    }
  }
  let lo = Math.max(a, at - h);
  let hi = Math.min(b, at + h);
  const r = (Math.sqrt(5) - 1) / 2;
  let c = hi - r * (hi - lo);
  let d = lo + r * (hi - lo);
  let fc = f(c);
  let fd = f(d);
  for (let it = 0; it < 60 && hi - lo > 1e-12; it++) {
    if (fc <= fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - r * (hi - lo);
      fc = f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + r * (hi - lo);
      fd = f(d);
    }
  }
  const mid = 0.5 * (lo + hi);
  const fm = f(mid);
  return fm < value ? { value: fm, at: mid } : { value, at };
}

/**
 * @typedef {object} ClosedCable
 * @property {boolean} ok the closing blend exists and keeps ρ ≥ rhoMin
 * @property {SplineData} support periodic pitch-line spline over
 *   [psiStart, psiStart + 2π]
 * @property {number} psiStart cable termination ψ_c0 − lead-in (rad)
 * @property {number} psiBrace ψ_c0 (rad)
 * @property {number} psiFull ψ_cf (rad)
 * @property {number} blendLength remaining arc closed by the blend (rad)
 * @property {number} blendMinRho smallest ρ on the closing blend (m)
 * @property {number} blendMinRhoAt its angle (rad)
 * @property {number} blendMinP smallest lever arm on the closing blend (m)
 * @property {boolean} blendFitted the blend is the constrained fit, not the quintic
 * @property {number} leadInRho ρ of the lead-in arc (m)
 * @property {Piecewise} track lead-in, active pieces and closing blend
 */

/**
 * Knots of a piece without its end point: the knots of a spline piece,
 * each interval subdivided to a spacing of at most `step`, otherwise a
 * uniform grid of spacing about `step`.
 * @param {TrackPiece} piece
 * @param {number} step (rad)
 * @returns {number[]}
 */
function pieceKnots(piece, step) {
  const uniform = (/** @type {number} */ a, /** @type {number} */ b) => {
    const count = Math.max(1, Math.ceil((b - a) / step - 1e-9));
    return Array.from({ length: count }, (_, j) => a + ((b - a) * j) / count);
  };
  if (piece.kind !== 'spline') return uniform(piece.start, piece.end);
  const inner = Array.from(piece.data.knots).filter((v) => v > piece.start && v < piece.end);
  const edges = [piece.start, ...inner, piece.end];
  /** @type {number[]} */
  const out = [];
  for (let k = 0; k < edges.length - 1; k++) out.push(...uniform(edges[k], edges[k + 1]));
  return out;
}

/**
 * Close the active cable track with the lead-in arc and the closing blend.
 * The blend is the quintic Hermite piece when it keeps ρ ≥ rhoMin and
 * p ≥ pMin; otherwise the constrained fit (core/fit) of a clamped spline to
 * the quintic, with p, p', p'' prescribed at both joins and the two limits
 * as constraints.
 * @param {Piecewise} active track over [ψ_c0, ψ_cf]
 * @param {{ leadIn: number, rhoMin: number, pMin?: number, step: number }} options lead-in
 *   wrap (rad), smallest allowed radius of curvature of the pitch line (m),
 *   smallest lever arm on the blend (m, default 0), knot spacing of the
 *   closed spline (rad)
 * @returns {ClosedCable | null} null when the active track leaves no arc to
 *   close (lead-in plus active range of a full turn or more)
 */
export function closeCableTrack(active, { leadIn, rhoMin, pMin = 0, step }) {
  const psiBrace = active.start;
  const psiFull = active.end;
  const psiStart = psiBrace - leadIn;
  const blendLength = psiStart + 2 * Math.PI - psiFull;
  if (!(blendLength > 0)) return null;
  const a0 = active.evaluate(psiBrace, new Float64Array(3));
  const rho0 = a0[0] + a0[2];
  /** @type {ArcPiece} */
  const arc = { kind: 'arc', start: psiStart, end: psiBrace, origin: psiBrace, rho: rho0, A: -a0[2], B: a0[1] };
  const endState = active.evaluate(psiFull, new Float64Array(3));
  const leadStart = createPiecewise([arc]).evaluate(psiStart, new Float64Array(3));
  /** @type {TrackPiece} */
  let blend = hermiteQuintic(psiFull, blendLength, endState, leadStart);
  const psiEnd = psiFull + blendLength;
  const limits = (/** @type {TrackPiece} */ piece) => {
    const one = createPiecewise([piece]);
    const buf = new Float64Array(3);
    return {
      rho: minimumOn((psi) => one.rho(psi), psiFull, psiEnd, 200),
      p: minimumOn((psi) => one.evaluate(psi, buf)[0], psiFull, psiEnd, 200).value,
    };
  };
  let low = limits(blend);
  if (!(low.rho.value >= rhoMin && low.p >= pMin)) {
    const quintic = createPiecewise([blend]);
    const count = Math.max(20, Math.ceil(blendLength / DEGREE));
    const psi = Float64Array.from({ length: count + 1 }, (_, k) => psiFull + (blendLength * k) / count);
    const buf = new Float64Array(3);
    const p = Float64Array.from(psi, (v) => quintic.evaluate(v, buf)[0]);
    const fit = fitCableTrack({
      psi, p, start: psiFull, end: psiEnd, rhoMin, pMin,
      intervals: Math.max(8, Math.ceil(blendLength / (4 * DEGREE))),
      ends: { start: endState, end: leadStart },
    });
    if (fit.spline) {
      blend = { kind: 'spline', start: psiFull, end: psiEnd, data: fit.spline };
      low = limits(blend);
    }
  }
  const track = createPiecewise([arc, ...active.pieces, blend]);

  /** @type {number[]} */
  const knots = [];
  for (const piece of [arc, ...active.pieces, blend]) knots.push(...pieceKnots(piece, step));
  knots.push(psiStart + 2 * Math.PI);
  const values = new Float64Array(knots.length);
  const buf = new Float64Array(3);
  for (let k = 0; k < knots.length - 1; k++) values[k] = track.evaluate(knots[k], buf)[0];
  values[knots.length - 1] = values[0];
  return {
    // The fitted blend meets the limits on its constraint grid; allow the
    // micrometre dips between grid points.
    ok: low.rho.value >= rhoMin - 1e-5 && low.p >= pMin - 1e-6,
    support: splineSupport(knots, values, { periodic: true }),
    psiStart,
    psiBrace,
    psiFull,
    blendLength,
    blendMinRho: low.rho.value,
    blendMinRhoAt: low.rho.at,
    blendMinP: low.p,
    blendFitted: blend.kind === 'spline',
    leadInRho: rho0,
    track,
  };
}

/**
 * Closed outline of a support over one turn from psi0, sampled at `count`
 * intervals: count + 1 points with the last equal to the first.
 * @param {Support} support
 * @param {number} psi0 (rad)
 * @param {number} [count]
 * @returns {{ x: Float64Array, y: Float64Array }}
 */
export function sampleOutline(support, psi0, count = 720) {
  const x = new Float64Array(count + 1);
  const y = new Float64Array(count + 1);
  for (let k = 0; k < count; k++) {
    const X = support.point(psi0 + (2 * Math.PI * k) / count);
    x[k] = X.x;
    y[k] = X.y;
  }
  x[count] = x[0];
  y[count] = y[0];
  return { x, y };
}

/**
 * Groove bottom and flange edge of a pitch line.
 * @param {SupportData} pitch
 * @param {number} diameter cord diameter d (m)
 * @param {number} depth groove depth (m)
 * @returns {{ groove: SupportData, flange: SupportData }}
 */
export function trackOffsets(pitch, diameter, depth) {
  return { groove: offset(pitch, -diameter / 2), flange: offset(pitch, -diameter / 2 + depth) };
}

/**
 * Largest distance between two points of the union of convex outlines (the
 * caliper width of the cam), from the support function
 * h(ψ) = max of the supports: max over ψ of h(ψ) + h(ψ + π).
 * @param {Support[]} supports
 * @param {number} [count] grid over half a turn
 * @returns {number} (m)
 */
export function maxDimension(supports, count = 360) {
  /** @param {number} psi */
  const h = (psi) => Math.max(...supports.map((s) => s.p(psi)));
  const width = (/** @type {number} */ psi) => -(h(psi) + h(psi + Math.PI));
  return -minimumOn(width, 0, Math.PI, count).value;
}

/**
 * @typedef {object} Post
 * @property {'string-post' | 'cable-post' | 'cable-stop'} id
 * @property {number} x centre, cam frame (m)
 * @property {number} y
 * @property {number} radius (m)
 * @property {number} psi track angle of the contact it serves (rad)
 */

/**
 * Post at a cord termination: the pitch line of the cord is tangent to the
 * post, so the centre lies on the track normal at ψ_e, inside the track, at
 * the distance r_post + d/2 from the pitch line.
 * @param {Support} pitch
 * @param {number} psi termination (rad)
 * @param {number} radius post radius (m)
 * @param {number} diameter cord diameter (m)
 * @param {'string-post' | 'cable-post'} id
 * @returns {Post}
 */
export function terminationPost(pitch, psi, radius, diameter, id) {
  const X = pitch.point(psi);
  const k = radius + diameter / 2;
  return { id, x: X.x - k * Math.cos(psi), y: X.y - k * Math.sin(psi), radius, psi };
}

/**
 * Cable stop post: a peg touching the cable free span at full draw. Its
 * centre lies at r_peg + d/2 from the cable line on the cam side, at the
 * smallest distance s ≥ 0 along the span beyond the contact where the peg
 * clears the cable groove bottom (distance of the centre from the groove
 * bottom at least r_peg, the groove bottom being convex).
 * @param {Support} pitch closed cable pitch line
 * @param {number} psi full-draw contact angle ψ_cf (rad)
 * @param {number} radius peg radius (m)
 * @param {number} diameter cable diameter (m)
 * @returns {Post & { span: number }} span: distance s from the contact (m)
 */
export function cableStopPost(pitch, psi, radius, diameter) {
  const X = pitch.point(psi);
  const n = { x: Math.cos(psi), y: Math.sin(psi) };
  const t = { x: -n.y, y: n.x };
  const k = radius + diameter / 2;
  const groove = (/** @type {number} */ phi) => pitch.p(phi) - diameter / 2;
  /** @param {number} s */
  const centre = (s) => ({ x: X.x + s * t.x - k * n.x, y: X.y + s * t.y - k * n.y });
  // Distance of an outside point from a convex region: max over ψ of C·n − h.
  /** @param {number} s */
  const clearance = (s) => {
    const C = centre(s);
    const f = (/** @type {number} */ phi) => -(C.x * Math.cos(phi) + C.y * Math.sin(phi) - groove(phi));
    return -minimumOn(f, psi - Math.PI, psi + Math.PI, 180).value - radius;
  };
  let lo = 0;
  let hi = Math.max(radius, 1e-3);
  for (let it = 0; it < 40 && clearance(hi) < 0; it++) hi *= 1.5;
  if (clearance(lo) < 0) {
    for (let it = 0; it < 50; it++) {
      const mid = 0.5 * (lo + hi);
      if (clearance(mid) < 0) lo = mid;
      else hi = mid;
    }
  } else {
    hi = lo;
  }
  const C = centre(hi);
  return { id: 'cable-stop', x: C.x, y: C.y, radius, psi, span: hi };
}

/**
 * @typedef {object} Mark
 * @property {'string-brace' | 'cable-brace' | 'full-draw'} id
 * @property {number} psi track angle (rad)
 * @property {number} x point on the pitch line, cam frame (m)
 * @property {number} y
 * @property {number} nx outward normal
 * @property {number} ny
 */

/**
 * Timing mark on a track: the pitch point at ψ and the outward normal.
 * @param {Support} pitch
 * @param {number} psi (rad)
 * @param {Mark['id']} id
 * @returns {Mark}
 */
export function trackMark(pitch, psi, id) {
  const X = pitch.point(psi);
  return { id, psi, x: X.x, y: X.y, nx: Math.cos(psi), ny: Math.sin(psi) };
}
