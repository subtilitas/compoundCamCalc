import { describe, expect, it } from 'vitest';
import { analyseTiming } from '../../src/core/analysis.js';
import { fitSupport } from '../../src/core/bspline.js';
import { fitCableTrack } from '../../src/core/fit.js';
import { solveForward } from '../../src/core/forward.js';
import { bowGeometry } from '../../src/core/geometry.js';
import { createInverse, inverseAt } from '../../src/core/inverse.js';
import { bowPoseAt, createBowPose, createLayout } from '../../src/core/layout.js';
import { limbFromState, tableLimb } from '../../src/core/limb.js';
import { solveQP } from '../../src/core/qp.js';
import { solve } from '../../src/core/solve.js';
import { writeCsv } from '../../src/export/csv.js';
import { writeDxf } from '../../src/export/dxf.js';
import { writeZip } from '../../src/export/zip.js';
import { buildExportModel } from '../../src/export/model.js';
import { exportFiles, exportZip } from '../../src/export/files.js';

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
  ['analyseTiming', (/** @type {any} */ v) => analyseTiming(v), (/** @type {any} */ r) => r.status !== 'ok'],
  ['fitCableTrack', (/** @type {any} */ v) => fitCableTrack(v), (/** @type {any} */ r) => r.status === 'invalid'],
  ['solveQP', (/** @type {any} */ v) => solveQP(v, v), (/** @type {any} */ r) => r.status === 'invalid'],
  ['createInverse', (/** @type {any} */ v) => createInverse(v), (/** @type {any} */ r) => r.context === null && typeof r.error === 'string'],
  ['inverseAt', (/** @type {any} */ v) => inverseAt(v, v, 0.3, 100, 10, 0, 0, v), (/** @type {any} */ r) => r.ok === false],
  ['bowGeometry', (/** @type {any} */ v) => bowGeometry(v, v), (/** @type {any} */ r) => r.bow === null && typeof r.error === 'string'],
  ['tableLimb', (/** @type {any} */ v) => tableLimb(v), (/** @type {any} */ r) => r.limb === null && typeof r.error === 'string'],
  ['createLayout', (/** @type {any} */ v) => createLayout(v, v), (/** @type {any} */ r) => r.layout === null && typeof r.error === 'string'],
  ['bowPoseAt', (/** @type {any} */ v) => bowPoseAt(v, 0.3, createBowPose()), (/** @type {any} */ r) => r === false],
  ['buildExportModel', (/** @type {any} */ v) => buildExportModel(v, v, v), (/** @type {any} */ r) => r.model === null && typeof r.error === 'string'],
  ['exportFiles', (/** @type {any} */ v) => exportFiles(v, v, v), (/** @type {any} */ r) => r.set === null && typeof r.error === 'string'],
  ['exportZip', (/** @type {any} */ v) => exportZip(v, v), (/** @type {any} */ r) => r.bytes === null && typeof r.error === 'string'],
  ['limbFromState', (/** @type {any} */ v) => limbFromState(v, v, v), (/** @type {any} */ r) => r.limb === null && typeof r.error === 'string'],
  ['fitSupport', (/** @type {any} */ v) => fitSupport(v, 0, 1, 1e-5), (/** @type {any} */ r) => r.spline === null && typeof r.error === 'string'],
  ['writeDxf', (/** @type {any} */ v) => writeDxf(v), (/** @type {any} */ r) => r.text === null && typeof r.error === 'string'],
  ['writeZip', (/** @type {any} */ v) => writeZip(v, v), (/** @type {any} */ r) => r.bytes === null && typeof r.error === 'string'],
  ['writeCsv', (/** @type {any} */ v) => writeCsv(v, v, v, v), (/** @type {any} */ r) => r.text === null && typeof r.error === 'string'],
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
