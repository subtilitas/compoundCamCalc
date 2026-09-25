/**
 * Contact of a cord that wraps a convex track and leaves it tangentially
 * towards a point B, all in the cam frame (lengths in m, angles in rad).
 *
 * Tangency: f(ψ) = B·n(ψ) − p(ψ) = 0, f' = B·t − p'. The side σ selects
 * the branch σ·f' > 0: σ = +1 leaves along +t (cable), σ = −1 along −t
 * (string). Free span l = σ·(B·t − p') > 0, unit vector from contact to B
 * u = σ·t. Cord length from the termination ψ_e:
 *
 *   L = σ·[B·t(ψ_c) + P(ψ_c)] + C,   C = −σ·[P(ψ_e) + p'(ψ_e)]
 *
 * The wrapped length is σ·(ψ_c − ψ_e) worth of track, which must be
 * non-negative. Because ∂L/∂ψ_c = 0 at the contact, ∂L/∂B = σ·t = u and a
 * cam rotation by θ changes L by σ·p·dθ.
 * @module core/contact
 */

/** Side of the string: wraps [ψ_c, ψ_e], leaves along −t. */
export const STRING_SIDE = -1;
/** Side of the power cable: wraps [ψ_e, ψ_c], leaves along +t. */
export const CABLE_SIDE = 1;

/** Newton steps before the bracketing fallback. */
const NEWTON_STEPS = 12;
/** Largest Newton step (rad). */
const MAX_STEP = 0.5;
/** A Newton step below this ends the iteration; the next error is O(step²). */
const STEP_TOLERANCE = 1e-11;
/** Largest tangency residual |B·n − p| of an accepted contact (m). */
const RESIDUAL_TOLERANCE = 1e-9;
/** Grid points of the bracketing scan over one period. */
const SCAN_POINTS = 96;
/** Iteration cap of the safeguarded Newton–bisection in a bracket. */
const BRACKET_STEPS = 100;
/** Iteration cap of the golden-section search; 60 steps shrink one grid cell below 1e-12 rad. */
const GOLDEN_STEPS = 100;
/**
 * Relative rounding allowance for the largest tangency residual: a point
 * whose distance beyond the track is at rounding level counts as on the
 * track, which has no free span.
 */
const ON_TRACK_TOLERANCE = 256 * Number.EPSILON;
/** Relative free span below which B counts as on the track, √ON_TRACK_TOLERANCE. */
const ON_TRACK_SPAN = Math.sqrt(ON_TRACK_TOLERANCE);

/**
 * Contact result. One object is reused across calls in the solver loops.
 * @typedef {object} Contact
 * @property {'ok' | 'inside' | 'no-convergence'} status 'inside' when B lies
 *   inside the track or on it (no tangent exists)
 * @property {number} psi contact angle ψ_c, unwrapped (rad)
 * @property {number} p lever arm p(ψ_c) (m)
 * @property {number} dp p'(ψ_c) (m/rad)
 * @property {number} span free length l from contact to B (m)
 * @property {number} ux unit vector from contact to B, cam frame
 * @property {number} uy
 * @property {number} reduced σ·[B·t(ψ_c) + P(ψ_c)] (m); L = reduced + C
 * @property {number} residual B·n(ψ_c) − p(ψ_c) (m)
 * @property {boolean} inRange ψ_c lies in the defined range of the track
 * @property {number} iterations support evaluations used
 */

/** @typedef {import('./support.js').Support} Support */

/**
 * @returns {Contact}
 */
export function createContact() {
  return {
    status: 'no-convergence',
    psi: NaN,
    p: NaN,
    dp: NaN,
    span: NaN,
    ux: NaN,
    uy: NaN,
    reduced: NaN,
    residual: NaN,
    inRange: false,
    iterations: 0,
  };
}

/**
 * Termination constant C of the cord length.
 * @param {Support} support
 * @param {number} sigma STRING_SIDE or CABLE_SIDE
 * @param {number} psiEnd termination angle ψ_e (rad)
 * @returns {number} (m)
 */
export function terminationConstant(support, sigma, psiEnd) {
  return -sigma * (support.P(psiEnd) + support.dp(psiEnd));
}

/**
 * Fill the contact fields at angle psi.
 * @param {Support} support
 * @param {number} bx
 * @param {number} by
 * @param {number} sigma
 * @param {number} psi
 * @param {Float64Array} buf
 * @param {Contact} out
 */
function finish(support, bx, by, sigma, psi, buf, out) {
  support.evaluate(psi, buf);
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  const bt = -bx * s + by * c;
  out.psi = psi;
  out.p = buf[0];
  out.dp = buf[1];
  out.residual = bx * c + by * s - buf[0];
  out.span = sigma * (bt - buf[1]);
  out.ux = -sigma * s;
  out.uy = sigma * c;
  out.reduced = sigma * (bt + support.P(psi));
  out.inRange = psi >= support.min && psi <= support.max;
  // A span at rounding level means B lies on the track (see ON_TRACK_TOLERANCE:
  // a residual of ε·scale beyond the track gives a span of about √(2ρε·scale)).
  const scale = Math.max(Math.hypot(bx, by), Math.abs(buf[0]));
  out.status = out.span > ON_TRACK_SPAN * scale ? 'ok' : 'inside';
  return out;
}

/**
 * Tangency function f and its derivative at psi.
 * @param {Support} support
 * @param {number} bx
 * @param {number} by
 * @param {number} psi
 * @param {Float64Array} buf receives p, p', p''
 * @param {Float64Array} fv receives f, f'
 */
function tangency(support, bx, by, psi, buf, fv) {
  support.evaluate(psi, buf);
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  fv[0] = bx * c + by * s - buf[0];
  fv[1] = -bx * s + by * c - buf[1];
}

const scratch = { buf: new Float64Array(3), fv: new Float64Array(2) };

/**
 * Solve the contact angle by Newton from the warm start psi0. When Newton
 * leaves the branch, stalls, or moves more than half a turn from psi0, a
 * scan of [psi0 − π, psi0 + π] brackets the root of the branch nearest to
 * psi0, and a safeguarded Newton–bisection finishes it. Never throws.
 * @param {Support} support
 * @param {number} bx B in the cam frame (m)
 * @param {number} by
 * @param {number} sigma STRING_SIDE or CABLE_SIDE
 * @param {number} psi0 warm start (rad), for example the previous contact
 * @param {Contact} [out]
 * @returns {Contact}
 */
export function solveContact(support, bx, by, sigma, psi0, out = createContact()) {
  const { buf, fv } = scratch;
  let psi = psi0;
  let evaluations = 0;
  let converged = false;
  if (Number.isFinite(psi0) && Number.isFinite(bx) && Number.isFinite(by)) {
    for (let it = 0; it < NEWTON_STEPS; it++) {
      tangency(support, bx, by, psi, buf, fv);
      evaluations++;
      if (!(sigma * fv[1] > 0)) break;
      let step = -fv[0] / fv[1];
      if (Math.abs(step) > MAX_STEP) step = Math.sign(step) * MAX_STEP;
      psi += step;
      if (Math.abs(step) < STEP_TOLERANCE) {
        converged = true;
        break;
      }
    }
  }
  if (converged && Math.abs(psi - psi0) <= Math.PI) {
    finish(support, bx, by, sigma, psi, buf, out);
    out.iterations = evaluations + 1;
    // A small step alone does not prove tangency where p' changes fast.
    if (out.status === 'ok' && Math.abs(out.residual) < RESIDUAL_TOLERANCE) return out;
  }
  return bracketed(support, bx, by, sigma, psi0, out, evaluations);
}

/**
 * Bracketing fallback of {@link solveContact}.
 * @param {Support} support
 * @param {number} bx
 * @param {number} by
 * @param {number} sigma
 * @param {number} psi0
 * @param {Contact} out
 * @param {number} evaluations
 * @returns {Contact}
 */
function bracketed(support, bx, by, sigma, psi0, out, evaluations) {
  const { buf, fv } = scratch;
  const fail = (/** @type {'inside' | 'no-convergence'} */ status) => {
    Object.assign(out, createContact());
    out.status = status;
    out.iterations = evaluations;
    return out;
  };
  if (!(Number.isFinite(psi0) && Number.isFinite(bx) && Number.isFinite(by))) return fail('no-convergence');
  const h = (2 * Math.PI) / SCAN_POINTS;
  const f = new Float64Array(SCAN_POINTS + 1);
  for (let k = 0; k <= SCAN_POINTS; k++) {
    tangency(support, bx, by, psi0 - Math.PI + k * h, buf, fv);
    f[k] = fv[0];
  }
  evaluations += SCAN_POINTS + 1;
  // A root of the σ branch: f rises through zero for σ = +1, falls for σ = −1.
  let best = -1;
  let bestDistance = Infinity;
  for (let k = 0; k < SCAN_POINTS; k++) {
    const g0 = sigma * f[k];
    const g1 = sigma * f[k + 1];
    if (g0 < 0 && g1 >= 0) {
      const distance = Math.abs((k + 0.5) * h - Math.PI);
      if (distance < bestDistance) {
        best = k;
        bestDistance = distance;
      }
    }
  }
  let lo;
  let hi;
  if (best >= 0) {
    lo = psi0 - Math.PI + best * h;
    hi = lo + h;
  } else {
    // No sign change on the grid: B is inside the track, or the positive
    // arc of f is narrower than one grid step. Refine the grid maximum over
    // both neighbouring cells. At the window ends the outer cell lies beyond
    // the scan; f is defined there too (a periodic track repeats, an open
    // spline continues its end pieces).
    let k = 0;
    for (let j = 1; j <= SCAN_POINTS; j++) if (f[j] > f[k]) k = j;
    const left = psi0 - Math.PI + (k - 1) * h;
    const right = psi0 - Math.PI + (k + 1) * h;
    const top = goldenMax(support, bx, by, left, right);
    evaluations += top.evaluations;
    const scale = Math.max(Math.hypot(bx, by), Math.abs(support.p(top.psi)));
    if (!(top.value > ON_TRACK_TOLERANCE * scale)) return fail(Number.isFinite(top.value) ? 'inside' : 'no-convergence');
    lo = sigma > 0 ? left : top.psi;
    hi = sigma > 0 ? top.psi : right;
  }
  // Safeguarded Newton–bisection on g = σ·f with g(lo) < 0 ≤ g(hi).
  let psi = 0.5 * (lo + hi);
  let dxOld = hi - lo;
  let dx = dxOld;
  for (let it = 0; it < BRACKET_STEPS; it++) {
    tangency(support, bx, by, psi, buf, fv);
    evaluations++;
    const g = sigma * fv[0];
    const dg = sigma * fv[1];
    if (g < 0) lo = psi;
    else hi = psi;
    if (((psi - hi) * dg - g) * ((psi - lo) * dg - g) > 0 || Math.abs(2 * g) > Math.abs(dxOld * dg)) {
      dxOld = dx;
      dx = 0.5 * (hi - lo);
      psi = lo + dx;
    } else {
      dxOld = dx;
      dx = g / dg;
      psi -= dx;
    }
    if (Math.abs(dx) < STEP_TOLERANCE * 1e-3 || hi - lo < 1e-15) break;
  }
  finish(support, bx, by, sigma, psi, buf, out);
  out.iterations = evaluations + 1;
  if (out.status !== 'ok') return fail('inside');
  if (!(Math.abs(out.residual) < RESIDUAL_TOLERANCE)) return fail('no-convergence');
  return out;
}

/**
 * Golden-section search for the maximum of f on [a, b]. Stops at an
 * interval of 1e-12 relative to |a| (at least 1e-12 rad) or after
 * GOLDEN_STEPS steps, so large angles cannot stall it.
 * @param {Support} support
 * @param {number} bx
 * @param {number} by
 * @param {number} a
 * @param {number} b
 */
function goldenMax(support, bx, by, a, b) {
  const { buf, fv } = scratch;
  const r = (Math.sqrt(5) - 1) / 2;
  /** @param {number} psi */
  const f = (psi) => {
    tangency(support, bx, by, psi, buf, fv);
    return fv[0];
  };
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  let fc = f(c);
  let fd = f(d);
  let evaluations = 2;
  for (let it = 0; it < GOLDEN_STEPS && b - a > 1e-12 * Math.max(1, Math.abs(a)); it++) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - r * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + r * (b - a);
      fd = f(d);
    }
    evaluations++;
  }
  const psi = 0.5 * (a + b);
  return { psi, value: f(psi), evaluations: evaluations + 1 };
}

/**
 * Cord length from the termination psiEnd to the point B.
 * @param {Support} support
 * @param {number} bx B in the cam frame (m)
 * @param {number} by
 * @param {number} sigma STRING_SIDE or CABLE_SIDE
 * @param {number} psiEnd termination ψ_e (rad)
 * @param {number} psi0 warm start of the contact angle (rad)
 * @returns {{ length: number, wrap: number, contact: Contact }} wrap: σ·(ψ_c − ψ_e) (rad)
 */
export function cordLength(support, bx, by, sigma, psiEnd, psi0) {
  const contact = solveContact(support, bx, by, sigma, psi0);
  const length = contact.status === 'ok' ? contact.reduced + terminationConstant(support, sigma, psiEnd) : NaN;
  return { length, wrap: sigma * (contact.psi - psiEnd), contact };
}
