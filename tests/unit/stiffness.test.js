import { describe, expect, it } from 'vitest';
import { ANALYSIS_CODES, STIFFNESS_MAX, STIFFNESS_MIN, analyseTiming, evaluateHalf } from '../../src/core/analysis.js';
import { createContact } from '../../src/core/contact.js';
import { bowGeometry } from '../../src/core/geometry.js';
import { createLimb, limbFromState } from '../../src/core/limb.js';
import { solve } from '../../src/core/solve.js';
import { createSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';

/** @typedef {import('../../src/core/analysis.js').AnalysisInput} AnalysisInput */
/** @typedef {import('../../src/core/analysis.js').AnalysisResult} AnalysisResult */

const MM = 1e-3;
/** EA of the research tables (N). */
const EA = 3e5;

/**
 * Analysis input of the default design and its pitch-line lengths.
 * @returns {{ input: AnalysisInput, stringLength: number, cableLength: number }}
 */
function defaultInput() {
  const state = defaultState();
  const r = solve(state);
  const peg = r.posts.find((p) => p.id === 'cable-stop');
  const { limb } = limbFromState(state.limb, state.geometry.limbLength);
  if (!peg || !limb || !r.tracks.stringPitch || !r.tracks.cablePitch || !r.tracks.string || !r.tracks.cable || !r.metrics) {
    throw new Error('the default design does not solve');
  }
  return {
    input: {
      geometry: state.geometry,
      stringTrack: r.tracks.stringPitch,
      cableTrack: r.tracks.cablePitch,
      limb,
      stringTermination: r.tracks.string.psiEnd,
      cableTermination: r.tracks.cable.psiStart,
      stop: { x: peg.x, y: peg.y, radius: peg.radius },
      cableDiameter: state.cords.cableDiameter,
    },
    stringLength: r.metrics.stringLength,
    cableLength: r.metrics.cableLength,
  };
}

const { input: base, stringLength, cableLength } = defaultInput();
const limb = createLimb(base.limb);
const equal = { string: EA, topCable: EA, bottomCable: EA };
const codes = (/** @type {AnalysisResult} */ a) => a.diagnostics.map((d) => d.code);
/** Index of the first stop. */
const firstIndex = (/** @type {AnalysisResult} */ a) => a.x.indexOf(a.stops.x);

describe('elastic cords', () => {
  const rigid = analyseTiming(base);
  const elastic = analyseTiming({ ...base, stiffness: equal });

  it('reproduce the rigid analysis in the limit of stiff cords', () => {
    for (const offsets of [{}, { topCable: 1 * MM, nockHeight: 5 * MM }]) {
      const r = analyseTiming({ ...base, offsets });
      const e = analyseTiming({ ...base, offsets, stiffness: { string: 1e15, topCable: 1e15, bottomCable: 1e15 } });
      expect(e.elastic).toBe(true);
      expect(r.elastic).toBe(false);
      expect(e.stops.first).toBe(r.stops.first);
      expect(Math.abs(e.stops.x - r.stops.x)).toBeLessThan(1e-9);
      // The rigid draw ends at x₁; the stiff one continues to x₂ within a hair.
      for (let i = 0; i < r.end; i += 13) {
        expect(Math.abs(e.x[i] - r.x[i])).toBeLessThan(1e-12);
        expect(Math.abs(e.y[i] - r.y[i])).toBeLessThan(1e-9);
        expect(Math.abs(e.thetaTop[i] - r.thetaTop[i])).toBeLessThan(1e-9);
        expect(Math.abs(e.thetaBottom[i] - r.thetaBottom[i])).toBeLessThan(1e-9);
        expect(Math.abs(e.F[i] - r.F[i])).toBeLessThan(1e-8 * Math.max(1, r.F[i]));
      }
    }
  });

  it('brace at the design brace and keep the nock level and the cams in time with equal stiffness', () => {
    expect(elastic.status).toBe('ok');
    expect(elastic.brace).toMatchObject({ x: rigid.x[0], y: 0, thetaTop: 0, thetaBottom: 0, alphaTop: 0, alphaBottom: 0 });
    for (let i = 0; i < elastic.n; i++) {
      expect(Math.abs(elastic.y[i])).toBeLessThan(1e-12);
      expect(Math.abs(elastic.dTheta[i])).toBeLessThan(1e-12);
    }
    expect(elastic.stops.first).toBe('both');
    expect(elastic.stops.second).toBe('both');
    expect(elastic.stops.x2).toBe(elastic.stops.x);
    expect(elastic.end).toBe(elastic.n - 1);
  });

  it('match the stretch effects of docs/research.md at EA = 3e5 N', () => {
    // Draw length at the cam stop −0.66 mm; peak force +0.20 N.
    expect((elastic.stops.x - rigid.fullDraw) / MM).toBeCloseTo(-0.66, 2);
    const peak = (/** @type {AnalysisResult} */ a) => Math.max(...a.F.subarray(0, a.end + 1));
    expect(peak(elastic) - peak(rigid)).toBeCloseTo(0.2, 1);
  });

  it('balance the work of the draw force against the limb and cord energy, stops included', () => {
    const stiffness = { string: EA, topCable: 2e5, bottomCable: 4e5 };
    const a = analyseTiming({ ...base, stiffness, samples: 3000, offsets: { topCable: 1.5 * MM, nockHeight: 5 * MM } });
    expect(a.status).toBe('ok');
    expect(a.stops.second).not.toBeNull();
    const C = [stringLength / 2 / stiffness.string, cableLength / stiffness.topCable, stringLength / 2 / stiffness.string, cableLength / stiffness.bottomCable];
    const energy = (/** @type {number} */ i) => {
      const T = [a.stringTop[i], a.cableTop[i], a.stringBottom[i], a.cableBottom[i]];
      return limb.energy(a.alphaTop[i]) + limb.energy(a.alphaBottom[i]) + 0.5 * T.reduce((s, t, k) => s + C[k] * t * t, 0);
    };
    const i1 = firstIndex(a);
    let work = 0;
    for (let i = 1; i < a.n; i++) {
      work += 0.5 * (a.F[i] + a.F[i - 1]) * (a.x[i] - a.x[i - 1]);
      // Up to the first stop on the fine grid; past it, with the stop force doing no work, on the coarse steps to x₂.
      if (i === i1) expect(Math.abs(work - (energy(i) - energy(0)))).toBeLessThanOrEqual(1e-7 * (energy(i) - energy(0)));
    }
    expect(Math.abs(work - (energy(a.n - 1) - energy(0)))).toBeLessThanOrEqual(1e-5 * (energy(a.n - 1) - energy(0)));
  });

  it('give cam timing from differential stiffness, as the linear estimate', () => {
    const a = analyseTiming({ ...base, stiffness: { string: EA, topCable: 2e5, bottomCable: 4e5 } });
    expect(a.status).toBe('ok');
    // The softer top cable stretches more, as a longer top cable: the top cam leads and stops first.
    expect(a.stops.first).toBe('top');
    expect(a.stops.second).toBe('bottom');
    expect(a.stops.x2).toBeGreaterThan(a.stops.x);
    const i1 = firstIndex(a);
    expect(a.dTheta[i1]).toBeGreaterThan(0);
    // Δθ ≈ dΔθ/dL_c,t · (differential stretch since brace), docs/research.md.
    const stretch = (cableLength / 2e5) * (a.cableTop[i1] - a.cableTop[0]) - (cableLength / 4e5) * (a.cableBottom[i1] - a.cableBottom[0]);
    const estimate = rigid.sensitivity * stretch;
    expect(Math.abs(a.dTheta[i1] - estimate)).toBeLessThanOrEqual(0.02 * Math.abs(estimate));
  });

  it('mirror the nock and flip the timing when the cable stiffness swaps', () => {
    const a = analyseTiming({ ...base, stiffness: { string: EA, topCable: 2e5, bottomCable: 4e5 } });
    const b = analyseTiming({ ...base, stiffness: { string: EA, topCable: 4e5, bottomCable: 2e5 } });
    expect(b.stops.first).toBe('bottom');
    expect(b.stops.second).toBe('top');
    expect(Math.abs(b.stops.x - a.stops.x)).toBeLessThan(1e-9);
    for (let i = 0; i < Math.min(a.n, b.n); i += 17) {
      expect(b.x[i]).toBe(a.x[i]);
      expect(Math.abs(b.y[i] + a.y[i])).toBeLessThan(1e-10);
      expect(Math.abs(b.dTheta[i] + a.dTheta[i])).toBeLessThan(1e-9);
    }
  });

  it('continue past the first stop to the second with a longer top cable', () => {
    const a = analyseTiming({ ...base, stiffness: equal, offsets: { topCable: 1 * MM } });
    const r = analyseTiming({ ...base, offsets: { topCable: 1 * MM } });
    expect(a.status).toBe('ok');
    expect(a.stops.first).toBe('top');
    expect(a.stops.second).toBe('bottom');
    // The first stop moves a little with stretch; the gap of the other cam stays near 3.8 mm.
    expect(Math.abs(a.stops.x - r.stops.x)).toBeLessThan(1 * MM);
    expect(a.stops.gapBottom / MM).toBeCloseTo(3.75, 1);
    expect(a.stops.x2).toBeGreaterThan(a.stops.x);
    expect(a.x[a.end]).toBe(a.stops.x2);
    // The force rises past the first stop: the soft first part of a two-stage wall.
    const i1 = firstIndex(a);
    expect(a.F[a.end]).toBeGreaterThan(a.F[i1]);
    for (let i = i1 + 1; i <= a.end; i++) expect(a.F[i]).toBeGreaterThan(a.F[i - 1]);
    // The timing sensitivity comes from the first stop, before a cam rests on its stop.
    expect((a.sensitivity * 180) / Math.PI / 1000).toBeGreaterThan(5);
    // Both cams rest on their stops at x₂, so they turn equally far.
    expect(Math.abs(a.dTheta[a.end])).toBeLessThan(0.01 * Math.abs(a.dTheta[i1]));
  });

  it('give the wall stiffness of the closed form with both cams on their stops', () => {
    const a = elastic;
    const i = a.end;
    const stringSupport = createSupport(base.stringTrack);
    const cableSupport = createSupport(base.cableTrack);
    const bow = /** @type {NonNullable<ReturnType<typeof bowGeometry>['bow']>} */ (bowGeometry(base.geometry, stringSupport).bow);
    const h = { string: createContact(), cable: createContact(), theta: NaN, usx: NaN, usy: NaN, sa: NaN, co: NaN, ao: NaN };
    expect(evaluateHalf({ bow, stringSupport, cableSupport }, a.x[i], 0, a.thetaTop[i], a.alphaTop[i], a.alphaBottom[i], h)).toBe(true);
    const cHalf = stringLength / 2 / EA;
    const cCable = cableLength / EA;
    const sinPhi = h.usx;
    const cosPhi = -h.usy;
    // c_a = c_o + c_x with c_x = −a in the symmetric pose (core/analysis).
    const ca = h.co - h.ao;
    const kt = limb.stiffness(a.alphaTop[i]);
    const closed = (2 * sinPhi ** 2) / (cHalf + h.sa ** 2 / (kt + ca ** 2 / cCable)) + (2 * a.stringTop[i] * cosPhi ** 2) / h.string.span;
    expect(Math.abs(a.stops.wallStiffness - closed)).toBeLessThanOrEqual(0.01 * closed);
    // 480 N/mm, docs/research.md.
    expect(a.stops.wallStiffness / 1e3).toBeCloseTo(480, -1);
    expect(rigid.stops.wallStiffness).toBeNaN();
  });

  it('report the top cable going slack while the top cam rests on its stop', () => {
    // Top cable 2 mm longer: past x₁ the stop takes the load of the top
    // cable, whose tension falls below zero before the bottom cam stops.
    const a = analyseTiming({ ...base, stiffness: equal, offsets: { topCable: 2 * MM } });
    expect(a.stops.first).toBe('top');
    expect(a.stops.second).toBe('bottom');
    const i1 = firstIndex(a);
    expect(a.cableTop[a.end]).toBeLessThan(0);
    expect(a.cableTop[i1]).toBeGreaterThan(0);
    const slack = a.diagnostics.find((d) => d.code === 'analysis-slack');
    expect(slack?.xRange?.[0]).toBeGreaterThan(a.stops.x);
    expect(ANALYSIS_CODES['analysis-no-second-stop']).toMatch(/second cam/);
  });

  it('refuse a stiffness out of range', () => {
    for (const bad of [0, -1, NaN, Infinity, STIFFNESS_MIN / 2, STIFFNESS_MAX * 2]) {
      const a = analyseTiming({ ...base, stiffness: { ...equal, topCable: bad } });
      expect(codes(a)).toEqual(['analysis-invalid-input']);
    }
    expect(codes(analyseTiming({ ...base, stiffness: /** @type {any} */ (5) }))).toEqual(['analysis-invalid-input']);
    expect(analyseTiming({ ...base, stiffness: null }).elastic).toBe(false);
  });
});

describe('elastic cords in the solve', () => {
  it('run the analysis and its reference with the stiffness of the option', () => {
    const state = defaultState();
    const res = solve(state, { analysis: { offsets: { topCable: 1 * MM }, stiffness: equal } });
    const a = /** @type {AnalysisResult} */ (res.analysis);
    const ref = /** @type {AnalysisResult} */ (res.analysisReference);
    expect(a.elastic).toBe(true);
    expect(ref.elastic).toBe(true);
    expect(ref).not.toBe(a);
    expect(ref.stops.first).toBe('both');
    const same = solve(state, { analysis: { offsets: {}, stiffness: equal } });
    expect(same.analysisReference).toBe(same.analysis);
    const plain = solve(state);
    expect(res.metrics).toEqual(plain.metrics);
    expect(res.diagnostics).toEqual(plain.diagnostics);
  });
});
