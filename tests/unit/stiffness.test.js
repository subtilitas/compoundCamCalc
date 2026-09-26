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

  it('approach the rigid analysis as the cords stiffen', () => {
    for (const offsets of [{}, { topCable: 1 * MM, nockHeight: 5 * MM }]) {
      const r = analyseTiming({ ...base, offsets });
      /** Largest differences from rigid cords up to x₁, and x₁ itself. */
      const gap = (/** @type {number} */ ea) => {
        const e = analyseTiming({ ...base, offsets, stiffness: { string: ea, topCable: ea, bottomCable: ea } });
        expect(e.elastic).toBe(true);
        expect(e.stops.first).toBe(r.stops.first);
        let y = 0;
        let theta = 0;
        let F = 0;
        for (let i = 0; i < r.end; i++) {
          expect(Math.abs(e.x[i] - r.x[i])).toBeLessThan(1e-6);
          y = Math.max(y, Math.abs(e.y[i] - r.y[i]));
          theta = Math.max(theta, Math.abs(e.thetaTop[i] - r.thetaTop[i]), Math.abs(e.thetaBottom[i] - r.thetaBottom[i]));
          F = Math.max(F, Math.abs(e.F[i] - r.F[i]) / Math.max(1, r.F[i]));
        }
        return { x1: Math.abs(e.stops.x - r.stops.x), y, theta, F };
      };
      const g9 = gap(1e9);
      const g10 = gap(1e10);
      // The stretch is proportional to 1/EA: ten times the stiffness, a tenth of the difference.
      for (const key of /** @type {const} */ (['x1', 'y', 'theta', 'F'])) {
        expect(g10[key], key).toBeLessThan(0.15 * g9[key] + 1e-11);
      }
      expect(g10.x1).toBeLessThan(1e-7);
      expect(g10.theta).toBeLessThan(1e-6);
      expect(g10.F).toBeLessThan(1e-5);
    }
    expect(analyseTiming(base).elastic).toBe(false);
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

  it('give dΔθ/dL_c,t of the elastic closures at a fixed nock', () => {
    // Top cable 1 mm longer: at the first stop no cam is held yet.
    const offsets = { topCable: 1 * MM };
    const a = analyseTiming({ ...base, nock: 'board', stiffness: equal, offsets });
    const i1 = firstIndex(a);
    // A draw board holds the nock: the sensitivity is the fixed-nock rate at the first stop.
    expect(Math.abs(a.dThetaDL[i1] - a.sensitivity)).toBeLessThanOrEqual(1e-6 * Math.abs(a.sensitivity));
    const r = analyseTiming({ ...base, nock: 'board', offsets });
    // Stretch lowers the rate against the rigid closures at their first stop.
    expect(a.dThetaDL[i1]).toBeLessThan(0.8 * r.dThetaDL[r.end]);
    const plain = analyseTiming({ ...base, nock: 'board', stiffness: equal, offsets, rates: false });
    expect(plain.dThetaDL[i1]).toBeNaN();
    expect(plain.sensitivity).toBeNaN();
    expect(plain.x).toEqual(a.x);
    expect(codes(analyseTiming({ ...base, rates: /** @type {any} */ ('yes') }))).toEqual(['analysis-invalid-input']);
  });

  it('take the force limit of the second-stop search from every solved pose, whatever the sample count', () => {
    const offsets = { topCable: -20 * MM };
    const sparse = analyseTiming({ ...base, stiffness: equal, offsets, samples: 2 });
    const dense = analyseTiming({ ...base, stiffness: equal, offsets });
    expect(sparse.stops.second).toBe(dense.stops.second);
    expect(Math.abs(sparse.stops.x2 - dense.stops.x2)).toBeLessThan(1e-9);
    expect(codes(sparse)).not.toContain('analysis-no-second-stop');
  });

  it('let a cam leave its stop when its stop force would pull, and hold it again when it returns', () => {
    const a = analyseTiming({
      ...base,
      stiffness: { string: 1.9235e6, topCable: 28649.7, bottomCable: 45049.2 },
      offsets: { topCable: 3.296 * MM, bottomCable: 3.622 * MM, string: 4.106 * MM, nockHeight: -1.567 * MM },
    });
    expect(a.status).toBe('ok');
    expect(a.stops.first).toBe('top');
    expect(a.stops.releases).toBe(1);
    expect(a.stops.second).toBe('bottom');
    // Past the first stop the top gap opens to more than 1 mm, then closes again; it never goes below zero.
    const gaps = Array.from(a.gapTop.subarray(firstIndex(a)));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(-1e-12);
    expect(Math.max(...gaps)).toBeGreaterThan(1 * MM);
    expect(Math.abs(a.gapTop[a.end])).toBeLessThanOrEqual(1e-12);
    // The usual case keeps the cam on its stop.
    expect(analyseTiming({ ...base, stiffness: equal, offsets: { topCable: 1 * MM } }).stops.releases).toBe(0);
  });

  it('name the other cam second when the first cam returns to its stop last', () => {
    const a = analyseTiming({
      ...base,
      stiffness: { string: 654460.33, topCable: 41047.94, bottomCable: 14300.7 },
      offsets: { topCable: 0.68444 * MM, bottomCable: -5.70923 * MM, string: 0.67001 * MM, nockHeight: -3.99618 * MM },
    });
    expect(a.status).toBe('ok');
    expect(a.stops.releases).toBe(1);
    expect(a.stops.first).toBe('top');
    expect(a.stops.second).toBe('bottom');
    // The top cam is the last to arrive at x₂.
    expect(Math.abs(a.gapTop[a.end])).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(a.gapBottom[a.end])).toBeLessThanOrEqual(1e-12);
  });

  it('give k_y of the accepted pose when the nock search ends in the noise', () => {
    const a = analyseTiming({
      ...base,
      stiffness: { string: 33293.5458, topCable: 602016002.28, bottomCable: 30313.2209 },
      offsets: { topCable: -9.79591 * MM, bottomCable: -7.99803 * MM, string: 0.21681 * MM, nockHeight: -4.53143 * MM },
    });
    expect(a.status).toBe('ok');
    // k_y varies within 1.5 kN/m to 4.2 kN/m over the draw; the slope at the last trial of the search is about 80 times smaller.
    const ky = Array.from(a.ky.subarray(0, a.end + 1));
    expect(Math.min(...ky)).toBeGreaterThan(0.25 * Math.max(...ky));
  });

  it('follow the same branch at any sample count', () => {
    // Soft cables with two branches past brace: one with the top cam ahead, one with the bottom cam ahead.
    const input = {
      ...base,
      stiffness: { string: 7539877.9, topCable: 17778.162, bottomCable: 22589.592 },
      offsets: { topCable: 5.935004 * MM, bottomCable: 6.82752 * MM, string: 3.103243 * MM, nockHeight: -4.555196 * MM },
    };
    const ref = analyseTiming(input);
    expect(ref.status).toBe('ok');
    expect(ref.stops.first).toBe('top');
    for (const samples of [2, 3, 5, 10, 1000]) {
      const a = analyseTiming({ ...input, samples });
      expect(a.stops.first).toBe(ref.stops.first);
      expect(a.stops.x).toBeCloseTo(ref.stops.x, 9);
      expect(a.dTheta[firstIndex(a)]).toBeCloseTo(ref.dTheta[firstIndex(ref)], 6);
      expect(a.stops.x2).toBeCloseTo(ref.stops.x2, 9);
    }
  });

  it('give the same stops and wall stiffness at any sample count', () => {
    /** @type {[import('../../src/core/analysis.js').AnalysisInput['stiffness'], import('../../src/core/analysis.js').TimingOffsets][]} */
    const cases = [
      [{ string: 76412905.27, topCable: 3924711.71, bottomCable: 47385.41 }, { topCable: 3.14688 * MM, bottomCable: 4.50055 * MM, string: 3.0285 * MM, nockHeight: 1.41769 * MM }],
      [{ string: 474445.4168, topCable: 179231.9418, bottomCable: 1293195.2501 }, { topCable: -2.119554 * MM, bottomCable: -0.812423 * MM, string: 1.143062 * MM, nockHeight: -1.678626 * MM }],
      [{ string: 39001472.9187717, topCable: 3408384730.8525376, bottomCable: 7820233.558002885 }, { topCable: 1.9544381 * MM, bottomCable: 1.969523 * MM, string: -4.9536336 * MM, nockHeight: -2.0683162 * MM }],
    ];
    // Seeded cases: EA from 3e4 N to 1e9 N, cable changes within ±3 mm, string ±5 mm, nock ±3 mm.
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const logu = () => Math.exp(Math.log(3e4) + rnd() * Math.log(1e9 / 3e4));
    for (let c = 0; c < 20; c++) {
      cases.push([
        { string: logu(), topCable: logu(), bottomCable: logu() },
        { topCable: (rnd() - 0.5) * 6 * MM, bottomCable: (rnd() - 0.5) * 6 * MM, string: (rnd() - 0.5) * 10 * MM, nockHeight: (rnd() - 0.5) * 6 * MM },
      ]);
    }
    // Status and stops; diagnostics of single samples depend on where the samples lie.
    const key = (/** @type {AnalysisResult} */ a) => `${a.status}|${a.stops.first}|${a.stops.second}`;
    for (const [stiffness, offsets] of cases) {
      const dense = analyseTiming({ ...base, stiffness, offsets });
      for (const samples of [2, 3, 5]) {
        const a = analyseTiming({ ...base, stiffness, offsets, samples });
        const name = `${JSON.stringify({ stiffness, offsets })} samples ${samples}`;
        expect(key(a), name).toBe(key(dense));
        if (dense.stops.second) {
          expect(Math.abs(a.stops.x2 - dense.stops.x2), name).toBeLessThan(1e-8);
          // A forward difference over 10 µm: agreement to 1e-5.
          expect(Math.abs(a.stops.wallStiffness - dense.stops.wallStiffness), name).toBeLessThanOrEqual(1e-5 * dense.stops.wallStiffness);
        }
      }
    }
  }, 60_000);

  it('hold both cams on their stops at the second stop', () => {
    const a = analyseTiming({ ...base, nock: 'board', stiffness: equal, offsets: { topCable: 1 * MM } });
    const i1 = firstIndex(a);
    // With both cams held a longer top cable cannot turn the cams: the rate at x₂ is near zero.
    expect(Math.abs(a.dThetaDL[a.end])).toBeLessThan(1e-3 * Math.abs(a.dThetaDL[i1]));
  });

  it('solve the wall stiffness of very unequal cords', () => {
    // EA from 2.6e4 N to 1e10 N: the closure tolerance scales with the compliance ratio.
    const a = analyseTiming({ ...base, stiffness: { string: 1e10, topCable: 2.62e4, bottomCable: 1e10 } });
    expect(a.status).toBe('ok');
    expect(a.stops.second).not.toBeNull();
    expect(a.stops.wallStiffness).toBeGreaterThan(0);
  });

  it('reports a fold with and without rates', () => {
    const geometry = { ...base.geometry, limbAngleBrace: (-30 * Math.PI) / 180 };
    for (const rates of [true, false]) {
      const a = analyseTiming({ ...base, geometry, stiffness: equal, rates });
      expect(codes(a)[0]).toBe('analysis-fold');
      expect(a.status).toBe('infeasible');
    }
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
