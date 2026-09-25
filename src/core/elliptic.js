/**
 * Elliptic integrals by Carlson's duplication algorithm (B. C. Carlson,
 * "Numerical computation of real or complex elliptic integrals", Numerical
 * Algorithms 10, 1995). The series are truncated so that the relative error
 * is at the level of the double precision rounding error.
 * @module core/elliptic
 */

/** Unit roundoff of double precision, 2^−53. */
const EPS = 2 ** -53;
/** Iteration cap; the duplication converges in about 10 steps. */
const MAX_STEPS = 60;

/**
 * Carlson's symmetric integral R_F(x, y, z) = ½∫₀^∞ dt / √((t+x)(t+y)(t+z)).
 * Arguments are non-negative and at most one of them is zero.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function carlsonRF(x, y, z) {
  const [x0, y0] = [x, y];
  const a0 = (x + y + z) / 3;
  let q = Math.pow(3 * EPS, -1 / 6) * Math.max(Math.abs(a0 - x), Math.abs(a0 - y), Math.abs(a0 - z));
  let a = a0;
  let scale = 1;
  for (let k = 0; k < MAX_STEPS && q >= Math.abs(a); k++) {
    const sx = Math.sqrt(x);
    const sy = Math.sqrt(y);
    const sz = Math.sqrt(z);
    const lambda = sx * sy + sx * sz + sy * sz;
    x = (x + lambda) / 4;
    y = (y + lambda) / 4;
    z = (z + lambda) / 4;
    a = (a + lambda) / 4;
    q /= 4;
    scale /= 4;
  }
  // x_m − A_m = (x_0 − A_0)/4^m, so the scaled deviations come from the
  // original arguments without cancellation.
  const X = ((a0 - x0) * scale) / a;
  const Y = ((a0 - y0) * scale) / a;
  const Z = -(X + Y);
  const e2 = X * Y - Z * Z;
  const e3 = X * Y * Z;
  return (1 - e2 / 10 + e3 / 14 + (e2 * e2) / 24 - (3 * e2 * e3) / 44) / Math.sqrt(a);
}

/**
 * Carlson's symmetric integral R_D(x, y, z) = 3/2∫₀^∞ dt / ((t+z)√((t+x)(t+y)(t+z))).
 * x, y non-negative with at most one zero, z positive.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function carlsonRD(x, y, z) {
  const [x0, y0] = [x, y];
  const a0 = (x + y + 3 * z) / 5;
  let q = Math.pow(EPS / 4, -1 / 6) * Math.max(Math.abs(a0 - x), Math.abs(a0 - y), Math.abs(a0 - z));
  let a = a0;
  let sum = 0;
  let scale = 1;
  for (let k = 0; k < MAX_STEPS && q >= Math.abs(a); k++) {
    const sx = Math.sqrt(x);
    const sy = Math.sqrt(y);
    const sz = Math.sqrt(z);
    const lambda = sx * sy + sx * sz + sy * sz;
    sum += scale / (sz * (z + lambda));
    x = (x + lambda) / 4;
    y = (y + lambda) / 4;
    z = (z + lambda) / 4;
    a = (a + lambda) / 4;
    q /= 4;
    scale /= 4;
  }
  const X = ((a0 - x0) * scale) / a;
  const Y = ((a0 - y0) * scale) / a;
  const Z = -(X + Y) / 3;
  const xy = X * Y;
  const z2 = Z * Z;
  const e2 = xy - 6 * z2;
  const e3 = (3 * xy - 8 * z2) * Z;
  const e4 = 3 * (xy - z2) * z2;
  const e5 = xy * z2 * Z;
  const series = 1 - (3 * e2) / 14 + e3 / 6 + (9 * e2 * e2) / 88 - (3 * e4) / 22 - (9 * e2 * e3) / 52 + (3 * e5) / 26;
  return (scale * series) / (a * Math.sqrt(a)) + 3 * sum;
}

/**
 * Complete elliptic integral of the second kind E(m) = ∫₀^{π/2} √(1 − m sin²u) du,
 * parameter m ≤ 1. At m = 1 the Carlson integrals diverge; E(1) = 1 is
 * returned directly. m > 1 gives NaN.
 * @param {number} m
 * @returns {number}
 */
export function ellipticECompleteParam(m) {
  if (m === 1) return 1;
  return carlsonRF(0, 1 - m, 1) - (m / 3) * carlsonRD(0, 1 - m, 1);
}

/**
 * Incomplete elliptic integral of the second kind
 * E(φ | m) = ∫₀^φ √(1 − m sin²u) du for any real φ and m ≤ 1. The angle is
 * reduced to [−π/2, π/2] with E(φ + kπ | m) = E(φ | m) + 2k·E(m). At m = 1
 * the integrand is |cos u|, so E(φ | 1) = sin(φ − kπ) + 2k.
 * @param {number} phi (rad)
 * @param {number} m parameter (the modulus squared)
 * @returns {number}
 */
export function ellipticE(phi, m) {
  if (m === 0) return phi;
  const k = Math.round(phi / Math.PI);
  const r = phi - k * Math.PI;
  const s = Math.sin(r);
  if (m === 1) return s + 2 * k;
  const c = Math.cos(r);
  const y = 1 - m * s * s;
  const partial = s * carlsonRF(c * c, y, 1) - (m / 3) * s * s * s * carlsonRD(c * c, y, 1);
  return k === 0 ? partial : partial + 2 * k * ellipticECompleteParam(m);
}
