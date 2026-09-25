import { describe, expect, it } from 'vitest';
import { fitCableTrack } from '../../src/core/fit.js';
import { solveForward } from '../../src/core/forward.js';
import { bowGeometry } from '../../src/core/geometry.js';
import { createInverse } from '../../src/core/inverse.js';
import { limbFromState, tableLimb } from '../../src/core/limb.js';
import { solveQP } from '../../src/core/qp.js';
import { solve } from '../../src/core/solve.js';

/** An object whose every property read throws, as a malformed untyped input can. */
const hostile = () => new Proxy({}, { get() { throw new Error('unreadable'); }, has() { return true; } });
/** The same, but the thrown value cannot be turned into text either. */
const opaque = () => new Proxy({}, {
  get() {
    throw { toString() { throw new Error('no text'); } };
  },
});

// Every export documented as never throwing, with the field of its result
// that reports the failure. A throwing getter, a getter that throws a value
// without text, null and a number stand for malformed deserialized input.
const CASES = /** @type {const} */ ([
  ['solve', (/** @type {any} */ v) => solve(v, v), (/** @type {any} */ r) => r.status !== 'ok'],
  ['solveForward', (/** @type {any} */ v) => solveForward(v), (/** @type {any} */ r) => r.status !== 'ok'],
  ['fitCableTrack', (/** @type {any} */ v) => fitCableTrack(v), (/** @type {any} */ r) => r.status === 'invalid'],
  ['solveQP', (/** @type {any} */ v) => solveQP(v, v), (/** @type {any} */ r) => r.status === 'invalid'],
  ['createInverse', (/** @type {any} */ v) => createInverse(v), (/** @type {any} */ r) => r.context === null && typeof r.error === 'string'],
  ['bowGeometry', (/** @type {any} */ v) => bowGeometry(v, v), (/** @type {any} */ r) => r.bow === null && typeof r.error === 'string'],
  ['tableLimb', (/** @type {any} */ v) => tableLimb(v), (/** @type {any} */ r) => r.limb === null && typeof r.error === 'string'],
  ['limbFromState', (/** @type {any} */ v) => limbFromState(v, v, v), (/** @type {any} */ r) => r.limb === null && typeof r.error === 'string'],
]);

describe('never-throw contracts', () => {
  for (const [name, call, failed] of CASES) {
    it(`${name} returns its failure result for malformed input`, () => {
      for (const make of [hostile, opaque, () => null, () => undefined, () => 5]) {
        /** @type {any} */
        let r;
        expect(() => (r = call(make()))).not.toThrow();
        expect(failed(r)).toBe(true);
      }
    });
  }
});
