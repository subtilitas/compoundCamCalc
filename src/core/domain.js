/**
 * Input domain of the core model. The bounds cover every bow by several
 * orders of magnitude and keep every intermediate quantity far from the
 * floating-point limits (about 1e±308): lengths, forces and energies stay
 * inside roughly 1e-12 to 1e20. Values outside the domain are invalid input.
 * @module core/domain
 */

/** Largest length: track sizes, offsets, bow dimensions, axle travel (m). */
export const LENGTH_MAX = 10;
/** Smallest track radius or semi-axis, and smallest bow dimension (m). */
export const LENGTH_MIN = 1e-6;
/** Largest |p''| of a spline track (m); ρ = p + p'' up to 1000 km. */
export const SECOND_DERIVATIVE_MAX = 1e6;
/**
 * Largest |angle| of a track parameter (phase, axis and offset angles,
 * spline knots) and of a cord termination (rad), about 1600 turns; the
 * spacing of floating-point numbers there is 1.8e-12 rad.
 */
export const ANGLE_MAX = 1e4;
/** Largest limb rotation from unstrung, at brace or in a limb table: one turn (rad). */
export const ROTATION_MAX = 2 * Math.PI;
/** Torsional limb stiffness range (N·m/rad). */
export const TORSIONAL_STIFFNESS_MIN = 1e-6;
export const TORSIONAL_STIFFNESS_MAX = 1e9;
/** Smallest spacing of limb table rotations (rad); 1e-6 rad is 0.3 µm of axle travel on a 0.28 m lever. */
export const ROTATION_SPACING_MIN = 1e-6;
/** Largest limb moment in a limb table (N·m). */
export const MOMENT_MAX = 1e7;
/** Largest draw energy (J). */
export const ENERGY_MAX = 1e7;

/**
 * True when v is a finite number in [min, max].
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @returns {v is number}
 */
export function inRange(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
