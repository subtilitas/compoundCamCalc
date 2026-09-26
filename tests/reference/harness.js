/**
 * Reference-bow harness: runs the forward model of the app on the inputs
 * of a fixture in tests/fixtures/reference and compares its results with
 * the targets of the fixture. Used by the unit test
 * tests/unit/reference.test.js and by `npm run reference`.
 *
 * Fixture format (JSON, SI units):
 * - `id`, `name`; `enforced`: true when the unit test fails on a target
 *   outside its tolerance, false when the fixture is only reported.
 * - `sources`: citation, DOI, licence and the parts used of each source.
 * - `model`: the author's model, which maps `symbols` to app inputs
 *   (see MODELS); `symbols`: the author's parameters as printed, each
 *   [value, unit] with a unit of UNITS.
 * - `inputs`: forward-model input of the app, `geometry`, `stringTrack`,
 *   `cableTrack` (support data, or { kind: 'freeform', values } for a
 *   free-form track) and `limb`. `geometry.drawLength` sets the end of the
 *   draw; the harness searches peak and valley beyond it.
 * - `targets`: { quantity, value, tolerance, source } with a quantity of
 *   QUANTITIES; `value` in SI units, `tolerance` absolute.
 * - `forces`: { source, tolerance, points: [[x (m), F (N)], …] }, forces of
 *   the author's model at nock positions x, checked against the app and
 *   against the author's equations; the app must also agree with the
 *   author's equations there to MODEL_AGREEMENT.
 * - `measured` (optional): { source, uncertainty: { x, F }, points } of
 *   digitised measurements; reported, never enforced.
 * @module tests/reference/harness
 */

import { AMO_OFFSET } from '../../src/core/units.js';
import { solveForward } from '../../src/core/forward.js';
import { eccentricCircle, freeformSupport } from '../../src/core/support.js';
import { tiermasBrace, tiermasModel } from './tiermas-round-wheel.js';

/** Factor to SI of each unit of the author's symbols. */
export const UNITS = Object.freeze({ m: 1, cm: 0.01, mm: 0.001, rad: 1, deg: Math.PI / 180, 'N/rad': 1, 'N·m/rad': 1, '1': 1 });

/** Target quantities the harness computes. */
export const QUANTITIES = Object.freeze([
  'braceDraw', 'peakForce', 'peakDraw', 'valleyDraw', 'valleyForce', 'energyToValley', 'q', 'qF',
]);

/** Agreement of the app with the author's equations at the force points (N). */
export const MODEL_AGREEMENT = 1e-9;
/** Search range beyond the draw length of the fixture for the valley (m). */
const SEARCH_BEYOND = 0.03;
/** Samples of the coarse scan for peak and valley. */
const SCAN_SAMPLES = 2000;
/** Golden-section iterations of the peak and valley search. */
const GOLDEN_ITERATIONS = 60;

/**
 * @typedef {object} Fixture
 * @property {string} id
 * @property {string} name
 * @property {boolean} enforced
 * @property {{ citation: string, doi?: string, licence: string, used: string }[]} sources
 * @property {keyof typeof MODELS} model
 * @property {Record<string, [number, keyof typeof UNITS]>} symbols
 * @property {{ geometry: import('../../src/state/schema.js').Geometry, stringTrack: any, cableTrack: any, limb: any }} inputs
 * @property {{ quantity: string, value: number, tolerance: number, source: string }[]} targets
 * @property {{ source: string, tolerance: number, points: [number, number][] }} forces
 * @property {{ source: string, uncertainty: { x: number, F: number }, points: [number, number][] }} [measured]
 */

/**
 * Author's symbols in SI units.
 * @param {Fixture['symbols']} symbols
 * @returns {Record<string, number>}
 */
export function symbolsSI(symbols) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [name, [value, unit]] of Object.entries(symbols)) {
    if (!(unit in UNITS)) throw new RangeError(`Unknown unit "${unit}" of symbol ${name}`);
    out[name] = value * UNITS[unit];
  }
  return out;
}

/**
 * The author's models: app inputs from the symbols (all but the draw
 * length) and the author's draw force at a nock position.
 */
export const MODELS = Object.freeze({
  'tiermas-round-wheel': {
    /** @param {Record<string, number>} s */
    params: (s) => ({ e0: s.e0, g: s.g, thetaU: s.thetaU, alpha0: s.alpha0, L: s.L, A: s.A, R: s.R, r: s.r, d: s.d, k: s.k }),
    /**
     * @param {Record<string, number>} s
     * @returns {Omit<Fixture['inputs'], 'geometry'> & { geometry: Omit<Fixture['inputs']['geometry'], 'drawLength'> }}
     */
    inputs(s) {
      const { theta0, D0 } = tiermasBrace(this.params(s));
      const AL = s.A * s.L;
      const phase = Math.PI + s.alpha0;
      return {
        geometry: { ata: s.e0, braceHeight: D0, limbLength: AL, limbAngleBrace: Math.PI / 2 - theta0 },
        stringTrack: eccentricCircle({ radius: s.R, offset: s.d, phase }),
        cableTrack: eccentricCircle({ radius: s.r, offset: s.d, phase }),
        limb: { kind: 'linear', torsionalStiffness: s.k * AL, alpha0: theta0 - s.thetaU },
      };
    },
    /**
     * @param {Record<string, number>} s
     * @returns {(x: number) => number}
     */
    force(s) {
      const model = tiermasModel(this.params(s));
      return (x) => model.at(x).F;
    },
  },
});

/**
 * Forward-model input of a fixture with a draw length.
 * @param {Fixture} fixture
 * @param {number} drawLength (m)
 */
function input(fixture, drawLength) {
  /** @param {any} t */
  const track = (t) => (t.kind === 'freeform' ? freeformSupport(t.values) : t);
  const { geometry, stringTrack, cableTrack, limb } = fixture.inputs;
  return { geometry: { ...geometry, drawLength }, stringTrack: track(stringTrack), cableTrack: track(cableTrack), limb };
}

/**
 * Draw force of the app at nock positions x.
 * @param {Fixture} fixture
 * @param {number[]} x (m), increasing
 * @returns {Float64Array}
 */
export function appForces(fixture, x) {
  const r = solveForward({ ...input(fixture, x[x.length - 1] + AMO_OFFSET), x });
  if (r.status !== 'ok') throw new Error(`${fixture.id}: the forward model reports ${r.status} (${r.diagnostics.map((d) => d.code).join(', ')})`);
  return r.F.subarray(r.n - x.length);
}

/**
 * Extremum of f on [a, b] by golden-section search; sign 1 for a maximum,
 * −1 for a minimum.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {1 | -1} sign
 */
function golden(f, a, b, sign) {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = sign * f(x1);
  let f2 = sign * f(x2);
  for (let i = 0; i < GOLDEN_ITERATIONS; i++) {
    if (f1 > f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = sign * f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = sign * f(x2);
    }
  }
  return 0.5 * (a + b);
}

/**
 * The quantities of QUANTITIES from the forward model of the app: peak
 * and valley of the draw force, the first minimum after the peak, and the
 * stored energy to the valley.
 * @param {Fixture} fixture
 * @returns {Record<string, number>}
 */
export function appQuantities(fixture) {
  const xBrace = fixture.inputs.geometry.braceHeight;
  const scan = solveForward({ ...input(fixture, fixture.inputs.geometry.drawLength + SEARCH_BEYOND), samples: SCAN_SAMPLES });
  if (scan.status !== 'ok') throw new Error(`${fixture.id}: the forward model reports ${scan.status}`);
  const { x, F } = scan;
  let ip = 0;
  for (let i = 1; i < scan.n; i++) if (F[i] > F[ip]) ip = i;
  let iv = ip;
  while (iv + 1 < scan.n && F[iv + 1] <= F[iv]) iv++;
  if (iv === ip || iv === scan.n - 1) throw new Error(`${fixture.id}: no valley after the peak within ${SEARCH_BEYOND} m beyond the draw length`);
  /** @param {number} at */
  const force = (at) => appForces(fixture, [at])[0];
  const peakDraw = golden(force, x[ip - 1], x[ip + 1], 1);
  const valleyDraw = golden(force, x[iv - 1], x[iv + 1], -1);
  const peakForce = force(peakDraw);
  const energyToValley = solveForward(input(fixture, valleyDraw + AMO_OFFSET)).drawEnergy;
  return {
    braceDraw: xBrace,
    peakForce,
    peakDraw,
    valleyDraw,
    valleyForce: force(valleyDraw),
    energyToValley,
    q: energyToValley / (valleyDraw * peakForce),
    qF: energyToValley / ((valleyDraw - xBrace) * peakForce),
  };
}

/**
 * @typedef {object} Check
 * @property {string} name what is compared
 * @property {number} value result of the app, or of the check
 * @property {number} target
 * @property {number} tolerance
 * @property {boolean} pass
 * @property {string} source
 */

/**
 * Every check of a fixture: the app inputs against the author's symbols,
 * the targets, and the forces against the app and the author's equations.
 * @param {Fixture} fixture
 * @returns {Check[]}
 */
export function runFixture(fixture) {
  /** @type {Check[]} */
  const checks = [];
  /**
   * @param {string} name
   * @param {number} value
   * @param {number} target
   * @param {number} tolerance
   * @param {string} source
   */
  const add = (name, value, target, tolerance, source) =>
    checks.push({ name, value, target, tolerance, pass: Math.abs(value - target) <= tolerance, source });
  const model = MODELS[fixture.model];
  if (!model) throw new RangeError(`${fixture.id}: unknown model "${fixture.model}"`);
  const s = symbolsSI(fixture.symbols);
  // The stored inputs follow from the symbols.
  const mapped = model.inputs(s);
  /** @type {[string, number, number][]} */
  const pairs = [
    ...Object.entries(mapped.geometry).map(([k, v]) => /** @type {[string, number, number]} */ ([`geometry.${k}`, fixture.inputs.geometry[/** @type {keyof typeof mapped.geometry} */ (k)], v])),
    ...(['radius', 'offset', 'phase']).map((k) => /** @type {[string, number, number]} */ ([`stringTrack.${k}`, fixture.inputs.stringTrack[k], /** @type {any} */ (mapped.stringTrack)[k]])),
    ...(['radius', 'offset', 'phase']).map((k) => /** @type {[string, number, number]} */ ([`cableTrack.${k}`, fixture.inputs.cableTrack[k], /** @type {any} */ (mapped.cableTrack)[k]])),
    ...(['torsionalStiffness', 'alpha0']).map((k) => /** @type {[string, number, number]} */ ([`limb.${k}`, fixture.inputs.limb[k], /** @type {any} */ (mapped.limb)[k]])),
  ];
  for (const [name, value, target] of pairs) add(`input ${name}`, value, target, 1e-9 * Math.max(1, Math.abs(target)), `symbols, model ${fixture.model}`);
  const q = appQuantities(fixture);
  for (const t of fixture.targets) {
    if (!(t.quantity in q)) throw new RangeError(`${fixture.id}: unknown quantity "${t.quantity}"`);
    add(t.quantity, q[t.quantity], t.value, t.tolerance, t.source);
  }
  const xs = fixture.forces.points.map(([x]) => x);
  const app = appForces(fixture, xs);
  const author = model.force(s);
  fixture.forces.points.forEach(([x, F], i) => {
    add(`F(${x} m), app`, app[i], F, fixture.forces.tolerance, fixture.forces.source);
    const a = author(x);
    add(`F(${x} m), author's equations`, a, F, fixture.forces.tolerance, fixture.forces.source);
    add(`F(${x} m), app against the author's equations`, app[i], a, MODEL_AGREEMENT, `model ${fixture.model}`);
  });
  return checks;
}
