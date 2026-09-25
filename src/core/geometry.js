/**
 * Bow geometry of the top half (the bottom half mirrors it about y = 0).
 * World frame: origin at the grip pivot point, x towards the archer, y up;
 * the nock is at N = (x, 0).
 *
 * The top limb is a rigid lever of length R_L from the pivot Q to the axle
 * O. Its angle β against +x (counter-clockwise positive) is β_b at brace;
 * drawing rotates it by α ≥ 0 towards the bow centre, β = β_b − α:
 *
 *   O(α) = Q + R_L·(cos β, sin β),   O_α = dO/dα = R_L·(sin β, −cos β)
 *
 * The bottom axle A = (O_x, −O_y) anchors the power cable of the top cam.
 * At brace the string is vertical at x = x_b and touches the string track
 * at ψ = 0, so O_b = (x_b − p_s(0), ATA/2) and Q = O_b − R_L·(cos β_b, sin β_b).
 *
 * The cam turns by θ, clockwise positive in the world frame (string
 * pay-out); cam frame v_cam = R(θ)·v_world with R the counter-clockwise
 * rotation matrix. Lengths in m, angles in rad.
 * @module core/geometry
 */

import { describeError } from './errors.js';
import { CABLE_SIDE, STRING_SIDE, createContact, solveContact, terminationConstant } from './contact.js';
import { drawRange } from './curve.js';
import { LENGTH_MAX, LENGTH_MIN, inRange } from './domain.js';

/** @typedef {import('./support.js').Support} Support */
/** @typedef {import('./contact.js').Contact} Contact */
/** @typedef {import('../state/schema.js').Geometry} Geometry */

/**
 * @typedef {object} BowGeometry
 * @property {number} xBrace nock position at brace x_b (m)
 * @property {number} xFull nock position at full draw x_f (m)
 * @property {number} limbLength R_L (m)
 * @property {number} betaBrace limb lever angle at brace β_b (rad)
 * @property {number} pivotX limb pivot Q (m)
 * @property {number} pivotY
 * @property {number} braceAxleX top axle O at brace (m)
 * @property {number} braceAxleY
 */

/**
 * Bow geometry from the project geometry and the pitch-line support of the
 * string track. Never throws.
 * @param {Geometry} geometry
 * @param {Support} stringSupport
 * @returns {{ bow: BowGeometry | null, error: string | null }}
 */
export function bowGeometry(geometry, stringSupport) {
  try {
    return bowGeometryChecked(geometry, stringSupport);
  } catch (err) {
    // Any exception while reading malformed input.
    return { bow: null, error: describeError(err) };
  }
}

/**
 * Body of {@link bowGeometry}, which guards it.
 * @param {Parameters<typeof bowGeometry>[0]} geometry
 * @param {Parameters<typeof bowGeometry>[1]} stringSupport
 * @returns {ReturnType<typeof bowGeometry>}
 */
function bowGeometryChecked(geometry, stringSupport) {
  const g = geometry ?? /** @type {Geometry} */ ({});
  const values = [g.ata, g.braceHeight, g.drawLength, g.limbLength, g.limbAngleBrace];
  if (!values.every(Number.isFinite)) return { bow: null, error: 'Every geometry value must be a finite number' };
  if (![g.ata, g.limbLength, g.braceHeight, g.drawLength].every((v) => inRange(v, LENGTH_MIN, LENGTH_MAX))) {
    return {
      bow: null,
      error: `Axle-to-axle length, brace height, draw length and limb lever length must be from ${LENGTH_MIN} m to ${LENGTH_MAX} m`,
    };
  }
  if (!inRange(g.limbAngleBrace, -2 * Math.PI, 2 * Math.PI)) {
    return { bow: null, error: 'The limb angle at brace must be within one turn' };
  }
  const { xBrace, xFull } = drawRange(g.braceHeight, g.drawLength);
  if (!(xFull > xBrace)) return { bow: null, error: 'Full draw must lie behind brace height' };
  const ps0 = stringSupport.p(0);
  if (!Number.isFinite(ps0)) return { bow: null, error: 'The string track has no finite lever arm at brace' };
  const braceAxleX = xBrace - ps0;
  const braceAxleY = g.ata / 2;
  return {
    bow: {
      xBrace,
      xFull,
      limbLength: g.limbLength,
      betaBrace: g.limbAngleBrace,
      pivotX: braceAxleX - g.limbLength * Math.cos(g.limbAngleBrace),
      pivotY: braceAxleY - g.limbLength * Math.sin(g.limbAngleBrace),
      braceAxleX,
      braceAxleY,
    },
    error: null,
  };
}

/**
 * Top axle O and its derivative O_α.
 * @param {BowGeometry} bow
 * @param {number} alpha limb rotation from brace (rad)
 * @returns {{ x: number, y: number, dx: number, dy: number }}
 */
export function axle(bow, alpha) {
  const beta = bow.betaBrace - alpha;
  const c = Math.cos(beta);
  const s = Math.sin(beta);
  const r = bow.limbLength;
  return { x: bow.pivotX + r * c, y: bow.pivotY + r * s, dx: r * s, dy: -r * c };
}

/**
 * Bottom axle A = (O_x, −O_y), the anchor of the top power cable, and A_α.
 * @param {BowGeometry} bow
 * @param {number} alpha (rad)
 * @returns {{ x: number, y: number, dx: number, dy: number }}
 */
export function anchor(bow, alpha) {
  const o = axle(bow, alpha);
  return { x: o.x, y: -o.y, dx: o.dx, dy: -o.dy };
}

/**
 * World vector in the cam frame, R(θ)·v.
 * @param {number} theta (rad)
 * @param {number} vx
 * @param {number} vy
 * @returns {{ x: number, y: number }}
 */
export function toCam(theta, vx, vy) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: c * vx - s * vy, y: s * vx + c * vy };
}

/**
 * String half-length g_s(x, θ, α) from the nock to the termination ψ_e on
 * the top cam.
 * @param {BowGeometry} bow
 * @param {Support} support string pitch line
 * @param {number} x nock position (m)
 * @param {number} theta (rad)
 * @param {number} alpha (rad)
 * @param {number} psiEnd string termination (rad)
 * @param {number} [psi0] warm start of the contact angle (rad)
 * @returns {{ length: number, contact: Contact }}
 */
export function stringHalfLength(bow, support, x, theta, alpha, psiEnd, psi0 = theta) {
  const o = axle(bow, alpha);
  const b = toCam(theta, x - o.x, -o.y);
  const contact = solveContact(support, b.x, b.y, STRING_SIDE, psi0);
  const length = contact.status === 'ok' ? contact.reduced + terminationConstant(support, STRING_SIDE, psiEnd) : NaN;
  return { length, contact };
}

/**
 * Power cable length g_c(θ, α) from the termination ψ_e on the top cam to
 * the anchor A at the bottom axle.
 * @param {BowGeometry} bow
 * @param {Support} support cable pitch line
 * @param {number} theta (rad)
 * @param {number} alpha (rad)
 * @param {number} psiEnd cable termination (rad)
 * @param {number} [psi0] warm start of the contact angle (rad)
 * @returns {{ length: number, contact: Contact }}
 */
export function cableLength(bow, support, theta, alpha, psiEnd, psi0 = Math.PI + theta) {
  const o = axle(bow, alpha);
  const b = toCam(theta, 0, -2 * o.y);
  const contact = solveContact(support, b.x, b.y, CABLE_SIDE, psi0);
  const length = contact.status === 'ok' ? contact.reduced + terminationConstant(support, CABLE_SIDE, psiEnd) : NaN;
  return { length, contact };
}

/**
 * State of the top half at (x, θ, α): contacts, reduced lengths and the
 * projection partials. One object is reused by the solver.
 * @typedef {object} Pose
 * @property {number} x nock position (m)
 * @property {number} theta (rad)
 * @property {number} alpha (rad)
 * @property {number} axleX O (m)
 * @property {number} axleY
 * @property {number} axleDx O_α (m/rad)
 * @property {number} axleDy
 * @property {Contact} string string contact, cam frame
 * @property {Contact} cable cable contact, cam frame
 * @property {number} usx unit vector from string contact to nock, world
 * @property {number} usy
 * @property {number} ucx unit vector from cable contact to anchor, world
 * @property {number} ucy
 * @property {number} sinPhi ∂g_s/∂x = u_s·(1, 0)
 * @property {number} sa s_a = u_s·O_α (m)
 * @property {number} ca c_a = u_c·(O_α − A_α) (m)
 */

/**
 * @returns {Pose}
 */
export function createPose() {
  return {
    x: NaN,
    theta: NaN,
    alpha: NaN,
    axleX: NaN,
    axleY: NaN,
    axleDx: NaN,
    axleDy: NaN,
    string: createContact(),
    cable: createContact(),
    usx: NaN,
    usy: NaN,
    ucx: NaN,
    ucy: NaN,
    sinPhi: NaN,
    sa: NaN,
    ca: NaN,
  };
}

/**
 * Evaluate both contacts at (x, θ, α). The contact warm starts come from
 * the previous state of the pose, shifted by the change of θ. Returns false
 * when a contact fails.
 * @param {BowGeometry} bow
 * @param {Support} stringSupport
 * @param {Support} cableSupport
 * @param {number} x (m)
 * @param {number} theta (rad)
 * @param {number} alpha (rad)
 * @param {Pose} pose
 * @returns {boolean}
 */
export function evaluatePose(bow, stringSupport, cableSupport, x, theta, alpha, pose) {
  const beta = bow.betaBrace - alpha;
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const r = bow.limbLength;
  const ox = bow.pivotX + r * cb;
  const oy = bow.pivotY + r * sb;
  const odx = r * sb;
  const ody = -r * cb;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const shift = Number.isFinite(pose.theta) ? theta - pose.theta : theta;
  const psiS = Number.isFinite(pose.string.psi) ? pose.string.psi + shift : theta;
  const psiC = Number.isFinite(pose.cable.psi) ? pose.cable.psi + shift : Math.PI + theta;

  // String: B = N − O in the world frame, rotated into the cam frame.
  const bx = x - ox;
  const by = -oy;
  solveContact(stringSupport, c * bx - s * by, s * bx + c * by, STRING_SIDE, psiS, pose.string);
  // Cable: B = A − O = (0, −2·O_y).
  const ay = -2 * oy;
  solveContact(cableSupport, -s * ay, c * ay, CABLE_SIDE, psiC, pose.cable);

  pose.x = x;
  pose.theta = theta;
  pose.alpha = alpha;
  pose.axleX = ox;
  pose.axleY = oy;
  pose.axleDx = odx;
  pose.axleDy = ody;
  // World unit vectors R(−θ)·u_cam.
  const us = pose.string;
  const uc = pose.cable;
  pose.usx = c * us.ux + s * us.uy;
  pose.usy = -s * us.ux + c * us.uy;
  pose.ucx = c * uc.ux + s * uc.uy;
  pose.ucy = -s * uc.ux + c * uc.uy;
  pose.sinPhi = pose.usx;
  pose.sa = pose.usx * odx + pose.usy * ody;
  // O_α − A_α = (0, 2·O_α,y).
  pose.ca = pose.ucy * 2 * ody;
  return us.status === 'ok' && uc.status === 'ok';
}
