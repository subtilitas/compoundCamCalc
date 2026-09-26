/**
 * Layout of the changed bow of the timing analysis: both halves at any
 * draw position between the brace and the end of the draw of the analysis
 * (core/analysis), for the string plan and the timing export files.
 *
 * Each half is given in its own mirror frame, as in core/analysis: the top
 * half in the world frame, the bottom half mirrored about y = 0 (a point
 * (x, y) of the bottom half lies at (x, −y) in the world). The nock is at
 * (x, y) in the top frame and (x, −y) in the bottom frame. Between two
 * samples the angles, contact angles, nock height and tensions are
 * interpolated linearly in x; points follow from them, so at a sample the
 * pose is the pose of the analysis.
 *
 * Lengths in m, angles in rad, forces in N.
 * @module core/timinglayout
 */

import { createSupport } from './support.js';

/** @typedef {import('./solve.js').SolveResult} SolveResult */
/** @typedef {import('./analysis.js').AnalysisResult} AnalysisResult */
/** @typedef {import('./support.js').Support} Support */
/**
 * Limb geometry of the bow, as in a layout context (core/layout).
 * @typedef {{ pivotX: number, pivotY: number, limbLength: number, betaBrace: number }} LimbFrame
 */

/**
 * One half in its own frame.
 * @typedef {object} HalfPose
 * @property {number} theta cam rotation (rad)
 * @property {number} alpha limb rotation (rad)
 * @property {number} axleX own axle O (m)
 * @property {number} axleY
 * @property {number} anchorX end of the own cable: the other axle, mirrored (m)
 * @property {number} anchorY
 * @property {number} stringX string contact point (m)
 * @property {number} stringY
 * @property {number} cableX cable contact point (m)
 * @property {number} cableY
 * @property {number} nockY nock height in this frame (m)
 * @property {number} stringTension (N)
 * @property {number} cableTension (N)
 */

/**
 * @typedef {object} TimingPose
 * @property {number} x nock position (m)
 * @property {number} y nock height, world (m)
 * @property {number} F draw force (N)
 * @property {number} pivotX limb pivot Q, top frame (m)
 * @property {number} pivotY
 * @property {HalfPose} top
 * @property {HalfPose} bottom
 */

/**
 * @typedef {object} TimingLayout
 * @property {AnalysisResult} analysis
 * @property {number} count samples of the draw, from brace to the end of the draw
 * @property {number} xBrace nock position at brace of the changed bow (m)
 * @property {number} xEnd nock position at the end of the draw (m)
 * @property {Support} stringSupport
 * @property {Support} cableSupport
 * @property {LimbFrame} bow
 */

/**
 * True when a result carries the analysis of changed cords: the analysis
 * exists, has a draw, and is not the reference of unchanged cords.
 * @param {SolveResult | null} result
 */
export function hasChangedTiming(result) {
  const a = result?.analysis ?? null;
  return a !== null && a.end >= 1 && result?.analysisReference !== a && Boolean(result?.tracks.stringPitch) && Boolean(result?.tracks.cablePitch);
}

/**
 * Layout of the changed bow of a result, or null without an analysis of
 * changed cords. Never throws.
 * @param {SolveResult | null} result
 * @param {LimbFrame} frame limb pivot, lever length and brace angle, for
 *   example the layout context of the same result
 * @returns {TimingLayout | null}
 */
export function createTimingLayout(result, frame) {
  try {
    if (!result || !hasChangedTiming(result)) return null;
    const a = /** @type {AnalysisResult} */ (result.analysis);
    const stringSupport = createSupport(/** @type {import('./support.js').SupportData} */ (result.tracks.stringPitch));
    const cableSupport = createSupport(/** @type {import('./support.js').SupportData} */ (result.tracks.cablePitch));
    const bow = { pivotX: frame.pivotX, pivotY: frame.pivotY, limbLength: frame.limbLength, betaBrace: frame.betaBrace };
    if (![bow.pivotX, bow.pivotY, bow.limbLength, bow.betaBrace].every(Number.isFinite)) return null;
    return { analysis: a, count: a.end + 1, xBrace: a.x[0], xEnd: a.x[a.end], stringSupport, cableSupport, bow };
  } catch {
    // Malformed result: no layout.
    return null;
  }
}

/**
 * Pose of the changed bow at nock position x, clamped to the draw.
 * @param {TimingLayout} tl
 * @param {number} x (m)
 * @returns {TimingPose | null} null for a non-finite x
 */
export function timingPoseAt(tl, x) {
  if (!Number.isFinite(x)) return null;
  const a = tl.analysis;
  const n = tl.count;
  const xs = a.x;
  let i = 0;
  let t = 0;
  if (x <= xs[0]) i = 0;
  else if (x >= xs[n - 1]) i = n - 1;
  else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    i = lo;
    t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  }
  /** @param {ArrayLike<number>} v */
  const at = (v) => (t === 0 ? v[i] : v[i] + t * (v[i + 1] - v[i]));
  const X = t === 0 ? xs[i] : x;
  const y = at(a.y);
  const { bow } = tl;
  /**
   * @param {number} theta
   * @param {number} alpha
   * @param {number} alphaOther
   * @param {number} psiS
   * @param {number} psiC
   * @param {number} nockY
   * @param {number} Ts
   * @param {number} Tc
   * @returns {HalfPose}
   */
  const half = (theta, alpha, alphaOther, psiS, psiC, nockY, Ts, Tc) => {
    const r = bow.limbLength;
    const axleX = bow.pivotX + r * Math.cos(bow.betaBrace - alpha);
    const axleY = bow.pivotY + r * Math.sin(bow.betaBrace - alpha);
    const otherY = bow.pivotY + r * Math.sin(bow.betaBrace - alphaOther);
    const otherX = bow.pivotX + r * Math.cos(bow.betaBrace - alphaOther);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const ps = tl.stringSupport.point(psiS);
    const pc = tl.cableSupport.point(psiC);
    return {
      theta, alpha, axleX, axleY, anchorX: otherX, anchorY: -otherY,
      stringX: axleX + c * ps.x + s * ps.y, stringY: axleY - s * ps.x + c * ps.y,
      cableX: axleX + c * pc.x + s * pc.y, cableY: axleY - s * pc.x + c * pc.y,
      nockY, stringTension: Ts, cableTension: Tc,
    };
  };
  const alphaTop = at(a.alphaTop);
  const alphaBottom = at(a.alphaBottom);
  return {
    x: X,
    y,
    F: at(a.F),
    pivotX: bow.pivotX,
    pivotY: bow.pivotY,
    top: half(at(a.thetaTop), alphaTop, alphaBottom, at(a.psiStringTop), at(a.psiCableTop), y, at(a.stringTop), at(a.cableTop)),
    bottom: half(at(a.thetaBottom), alphaBottom, alphaTop, at(a.psiStringBottom), at(a.psiCableBottom), -y, at(a.stringBottom), at(a.cableBottom)),
  };
}

/**
 * Short id of the timing settings for file names: six hex digits of an
 * FNV-1a hash of the four values.
 * @param {import('../state/schema.js').Tuning} tuning
 */
export function timingId(tuning) {
  const text = JSON.stringify([tuning.topCable, tuning.bottomCable, tuning.string, tuning.nockHeight]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}
