import { describe, expect, it } from 'vitest';
import { ANALYSIS_CODES, ANALYSIS_SAMPLES, analyseTiming } from '../../src/core/analysis.js';
import { FULL_SAMPLES } from '../../src/core/forward.js';
import { createLimb, limbFromState, tableLimb } from '../../src/core/limb.js';
import { solve } from '../../src/core/solve.js';
import { cableStopPost } from '../../src/core/outline.js';
import { createSupport } from '../../src/core/support.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES, sampleState } from '../../src/state/samples.js';
import { solveDense } from './numeric.js';
import { camToWorld, layout, tangentAngle } from './statics.js';

/** @typedef {import('../../src/core/analysis.js').AnalysisInput} AnalysisInput */
/** @typedef {import('../../src/core/analysis.js').AnalysisResult} AnalysisResult */

const MM = 1e-3;

/**
 * Analysis input of the default design, built from its full solve.
 * @returns {AnalysisInput}
 */
function defaultInput() {
  const state = defaultState();
  const r = solve(state);
  const peg = r.posts.find((p) => p.id === 'cable-stop');
  const { limb } = limbFromState(state.limb, state.geometry.limbLength);
  if (!peg || !limb || !r.tracks.stringPitch || !r.tracks.cablePitch || !r.tracks.string || !r.tracks.cable) {
    throw new Error('the default design does not solve');
  }
  return {
    geometry: state.geometry,
    stringTrack: r.tracks.stringPitch,
    cableTrack: r.tracks.cablePitch,
    limb,
    stringTermination: r.tracks.string.psiEnd,
    cableTermination: r.tracks.cable.psiStart,
    stop: { x: peg.x, y: peg.y, radius: peg.radius },
    cableDiameter: state.cords.cableDiameter,
  };
}

const base = defaultInput();
const codes = (/** @type {AnalysisResult} */ a) => a.diagnostics.map((d) => d.code);

describe('analysis with unchanged cords', () => {
  it.each(/** @type {[string, string | null][]} */ ([['default', null], ...SAMPLES.map((s) => [s.id, s.id])]))(
    'reproduces the forward model of the %s design',
    (_name, id) => {
      const state = id ? sampleState(/** @type {string} */ (id)) : defaultState();
      // The design grid of the forward model: same sample count, same brace.
      const r = solve(state, { analysis: { offsets: {} } });
      expect(r.status).toBe('ok');
      const a = /** @type {AnalysisResult} */ (r.analysis);
      const f = /** @type {NonNullable<typeof r.achieved>} */ (r.achieved);
      const rerun = /** @type {AnalysisResult} */ (solve(state, { analysis: { samples: FULL_SAMPLES } }).analysis);
      expect(a.status).toBe('ok');
      expect(rerun.status).toBe('ok');
      expect(rerun.brace?.x).toBe(f.x[0]);
      const scale = Math.max(...f.F);
      let compared = 0;
      for (let i = 0; i < rerun.n; i++) {
        if (rerun.x[i] !== f.x[i]) continue;
        compared++;
        expect(Math.abs(rerun.F[i] - f.F[i])).toBeLessThanOrEqual(1e-9 * scale);
        for (const [a2, b2] of [[rerun.thetaTop, f.theta], [rerun.thetaBottom, f.theta], [rerun.alphaTop, f.alpha], [rerun.alphaBottom, f.alpha]]) {
          expect(Math.abs(a2[i] - b2[i])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b2[i])));
        }
        const T = Math.max(f.Ts[i], f.Tc[i]);
        for (const [a2, b2] of [[rerun.stringTop, f.Ts], [rerun.stringBottom, f.Ts], [rerun.cableTop, f.Tc], [rerun.cableBottom, f.Tc]]) {
          expect(Math.abs(a2[i] - b2[i])).toBeLessThanOrEqual(1e-9 * T);
        }
        expect(Math.abs(rerun.y[i])).toBeLessThanOrEqual(1e-12);
      }
      // Every grid sample up to the stops at full draw.
      expect(compared).toBeGreaterThanOrEqual(FULL_SAMPLES - 1);
      // Both cams stop together at full draw.
      for (const run of [a, rerun]) {
        expect(run.stops.first).toBe('both');
        expect(Math.abs(run.stops.x - f.x[f.x.length - 1])).toBeLessThanOrEqual(1e-9);
      }
    },
    60_000,
  );

  it('takes no analysis without the option, in a coarse solve, and one with `true`', () => {
    const state = defaultState();
    expect(solve(state).analysis).toBeNull();
    expect(solve(state, { resolution: 'coarse', analysis: true }).analysis).toBeNull();
    const r = solve(state, { analysis: true });
    expect(r.analysis?.status).toBe('ok');
    expect(r.analysis?.n).toBeGreaterThanOrEqual(ANALYSIS_SAMPLES - 1);
    expect(r.timings.analysis).toBeGreaterThan(0);
  });

  it('never changes the status, diagnostics or warnings of the solve', () => {
    const state = defaultState();
    const plain = solve(state);
    const withAnalysis = solve(state, { analysis: { offsets: { topCable: 0.05 }, nock: 'board' } });
    expect(withAnalysis.analysis?.status).toBe('ok');
    expect(withAnalysis.status).toBe(plain.status);
    expect(withAnalysis.diagnostics).toEqual(plain.diagnostics);
    expect(withAnalysis.warnings).toEqual(plain.warnings);
    for (const key of ['offsets', 'nock', 'samples']) {
      const hostile = Object.defineProperty({}, key, { get() { throw new Error('unreadable'); } });
      const r = solve(state, { analysis: /** @type {any} */ (hostile) });
      expect(r.status).toBe(plain.status);
      expect(r.diagnostics).toEqual(plain.diagnostics);
      expect(r.analysis?.diagnostics.map((d) => d.code)).toEqual(['analysis-invalid-input']);
    }
    const unreadable = solve(state, /** @type {any} */ (Object.defineProperty({}, 'analysis', { get() { throw new Error('unreadable'); } })));
    expect(unreadable.status).toBe(plain.status);
    expect(unreadable.diagnostics).toEqual(plain.diagnostics);
    expect(unreadable.analysis?.diagnostics.map((d) => d.code)).toEqual(['analysis-invalid-input']);
    const slack = solve(state, { analysis: { offsets: { nockHeight: 0.02 }, nock: 'board' } });
    expect(slack.analysis?.status).toBe('infeasible');
    expect(slack.status).toBe('ok');
  });
});

describe('analysis symmetry', () => {
  it('keeps the nock level with equal changes on both halves', () => {
    for (const offsets of [{ topCable: 2 * MM, bottomCable: 2 * MM }, { string: 5 * MM }, { topCable: -3 * MM, bottomCable: -3 * MM, string: 4 * MM }]) {
      const a = analyseTiming({ ...base, offsets });
      expect(a.status).toBe('ok');
      for (let i = 0; i < a.n; i++) {
        expect(Math.abs(a.y[i])).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(a.dTheta[i])).toBeLessThanOrEqual(1e-12);
      }
      expect(a.stops.first).toBe('both');
    }
  });

  it('mirrors the nock and flips the timing when the cable changes swap', () => {
    for (const nock of /** @type {const} */ (['free', 'board'])) {
      const a = analyseTiming({ ...base, nock, offsets: { topCable: 1 * MM, bottomCable: -0.5 * MM } });
      const b = analyseTiming({ ...base, nock, offsets: { topCable: -0.5 * MM, bottomCable: 1 * MM } });
      expect(a.status).toBe('ok');
      expect(b.n).toBe(a.n);
      for (let i = 0; i < a.n; i++) {
        expect(b.x[i]).toBeCloseTo(a.x[i], 12);
        expect(b.y[i]).toBeCloseTo(-a.y[i], 11);
        expect(b.dTheta[i]).toBeCloseTo(-a.dTheta[i], 9);
        expect(b.F[i]).toBeCloseTo(a.F[i], 7);
        expect(b.Fy[i]).toBeCloseTo(-a.Fy[i], 7);
        expect(b.stringTop[i]).toBeCloseTo(a.stringBottom[i], 7);
        expect(b.cableTop[i]).toBeCloseTo(a.cableBottom[i], 7);
      }
      expect(a.stops.first).toBe('top');
      expect(b.stops.first).toBe('bottom');
      expect(b.stops.gapTop).toBeCloseTo(a.stops.gapBottom, 12);
    }
  });

  it('raises the nock by the nocking point height at brace', () => {
    const a = analyseTiming({ ...base, offsets: { nockHeight: 10 * MM } });
    expect(a.status).toBe('ok');
    // The string is straight at brace, so the nock moves along it.
    expect(a.brace?.y).toBeCloseTo(10 * MM, 12);
    expect(a.brace?.thetaTop).toBeCloseTo(0, 12);
    expect(a.brace?.x).toBeCloseTo(base.geometry.braceHeight, 12);
  });
});

describe('analysis statics', () => {
  const stringSupport = createSupport(base.stringTrack);
  const cableSupport = createSupport(base.cableTrack);
  const limb = createLimb(base.limb);
  const lay = layout(base.geometry, stringSupport);
  const cross = (/** @type {{ x: number, y: number }} */ a, /** @type {{ x: number, y: number }} */ b) => a.x * b.y - a.y * b.x;
  const unit = (/** @type {{ x: number, y: number }} */ a, /** @type {{ x: number, y: number }} */ b) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };

  /**
   * Contact points and cord directions of one half from positions, in its
   * own frame, without core/geometry, core/contact or core/analysis.
   * @param {AnalysisResult} a
   * @param {number} i
   * @param {'top' | 'bottom'} half
   */
  function halfFrame(a, i, half) {
    const own = half === 'top';
    const theta = own ? a.thetaTop[i] : a.thetaBottom[i];
    const alpha = own ? a.alphaTop[i] : a.alphaBottom[i];
    const alphaOther = own ? a.alphaBottom[i] : a.alphaTop[i];
    const O = lay.axleAt(alpha);
    const Oo = lay.axleAt(alphaOther);
    const N = { x: a.x[i], y: own ? a.y[i] : -a.y[i] };
    const A = { x: Oo.x, y: -Oo.y };
    const psiS = own ? a.psiStringTop[i] : a.psiStringBottom[i];
    const psiC = own ? a.psiCableTop[i] : a.psiCableBottom[i];
    const Xs = camToWorld(O, theta, stringSupport.point(tangentAngle(stringSupport, O, theta, N, false, psiS)));
    const Xc = camToWorld(O, theta, cableSupport.point(tangentAngle(cableSupport, O, theta, A, true, psiC)));
    return { O, Xs, Xc, us: unit(Xs, N), uc: unit(Xc, A), alpha };
  }

  it.each([
    ['free nock, top cable 1 mm longer', { topCable: 1 * MM }, 'free'],
    ['free nock, nocking point 8 mm high, string 3 mm longer', { nockHeight: 8 * MM, string: 3 * MM }, 'free'],
    ['draw board, bottom cable 2 mm shorter', { bottomCable: -2 * MM }, 'board'],
  ])('balances each cam and limb as a free body: %s', (_name, offsets, nock) => {
    const a = analyseTiming({ ...base, offsets, nock: /** @type {'free' | 'board'} */ (nock) });
    expect(a.status).toBe('ok');
    for (const i of [0, 40, 150, 250, a.n - 1]) {
      const t = halfFrame(a, i, 'top');
      const b = halfFrame(a, i, 'bottom');
      // The bottom cable ends at the top axle and pulls towards its contact
      // (mirrored into the top frame); likewise for the top cable.
      const toBottom = unit(t.O, { x: b.Xc.x, y: -b.Xc.y });
      const toTop = unit(b.O, { x: t.Xc.x, y: -t.Xc.y });
      const rel = (/** @type {{ x: number, y: number }} */ P, /** @type {{ x: number, y: number }} */ O) => ({ x: P.x - O.x, y: P.y - O.y });
      // Rows: top cam, top limb, bottom cam, bottom limb; columns T_s,t, T_c,t, T_s,b, T_c,b.
      const leverT = rel(t.O, lay.q);
      const leverB = rel(b.O, lay.q);
      const A = [
        [cross(rel(t.Xs, t.O), t.us), cross(rel(t.Xc, t.O), t.uc), 0, 0],
        [-cross(leverT, t.us), -cross(leverT, t.uc), 0, -cross(leverT, toBottom)],
        [0, 0, cross(rel(b.Xs, b.O), b.us), cross(rel(b.Xc, b.O), b.uc)],
        [0, -cross(leverB, toTop), -cross(leverB, b.us), -cross(leverB, b.uc)],
      ];
      const [Tst, Tct, Tsb, Tcb] = solveDense(A, [0, limb.moment(t.alpha), 0, limb.moment(b.alpha)]);
      const scale = Math.max(Tst, Tct, Tsb, Tcb);
      expect(Math.abs(Tst - a.stringTop[i])).toBeLessThanOrEqual(1e-9 * scale);
      expect(Math.abs(Tct - a.cableTop[i])).toBeLessThanOrEqual(1e-9 * scale);
      expect(Math.abs(Tsb - a.stringBottom[i])).toBeLessThanOrEqual(1e-9 * scale);
      expect(Math.abs(Tcb - a.cableBottom[i])).toBeLessThanOrEqual(1e-9 * scale);
      const F = Tst * t.us.x + Tsb * b.us.x;
      const Fy = Tst * t.us.y - Tsb * b.us.y;
      expect(Math.abs(F - a.F[i])).toBeLessThanOrEqual(1e-9 * scale);
      expect(Math.abs(Fy - (nock === 'free' ? 0 : a.Fy[i]))).toBeLessThanOrEqual(1e-9 * scale);
    }
  });

  it('balances the work of the draw force against the limb energy', () => {
    for (const nock of /** @type {const} */ (['free', 'board'])) {
      const a = analyseTiming({ ...base, nock, samples: 3000, offsets: { topCable: 1.5 * MM, nockHeight: 5 * MM } });
      expect(a.status).toBe('ok');
      // Trapezoid rule; a draw board holds y fixed, so F_y does no work.
      let work = 0;
      for (let i = 1; i < a.n; i++) work += 0.5 * (a.F[i] + a.F[i - 1]) * (a.x[i] - a.x[i - 1]);
      const energy = (/** @type {number} */ i) => limb.energy(a.alphaTop[i]) + limb.energy(a.alphaBottom[i]);
      const stored = energy(a.n - 1) - energy(0);
      expect(Math.abs(work - stored)).toBeLessThanOrEqual(1e-7 * stored);
    }
  });

  it('matches the closed form of dΔθ/dL_c,t with unchanged cords', () => {
    const a = analyseTiming({ ...base, nock: 'board' });
    for (const i of [0, 60, 150, 250, a.n - 1]) {
      const t = halfFrame(a, i, 'top');
      const O = lay.axleAt(t.alpha);
      const beta = base.geometry.limbAngleBrace - t.alpha;
      const R = base.geometry.limbLength;
      const Oa = { x: R * Math.sin(beta), y: -R * Math.cos(beta) };
      const Aa = { x: Oa.x, y: -Oa.y };
      const dot = (/** @type {{ x: number, y: number }} */ u, /** @type {{ x: number, y: number }} */ v) => u.x * v.x + u.y * v.y;
      // Lever arms: the string leaves the cam clockwise, the cable anticlockwise.
      const pS = -cross({ x: t.Xs.x - O.x, y: t.Xs.y - O.y }, t.us);
      const pC = cross({ x: t.Xc.x - O.x, y: t.Xc.y - O.y }, t.uc);
      const sA = dot(t.us, Oa);
      const cO = dot(t.uc, Oa);
      const cX = -dot(t.uc, Aa);
      const closed = sA / (pC * sA + pS * (cO - cX));
      expect(Math.abs(a.dThetaDL[i] - closed)).toBeLessThanOrEqual(1e-9 * Math.abs(closed));
    }
    // 1.38 °/mm at brace, 6.65 °/mm at full draw (docs/research.md).
    const deg = (/** @type {number} */ v) => (v * 180) / Math.PI / 1000;
    expect(deg(a.dThetaDL[0])).toBeCloseTo(1.377, 3);
    expect(deg(a.dThetaDL[a.n - 1])).toBeCloseTo(6.646, 2);
  });

  it('gives the sensitivity at the end of the draw in the nock mode', () => {
    const board = analyseTiming({ ...base, nock: 'board' });
    // A draw board holds the nock: the fixed-nock value of the samples.
    expect(Math.abs(board.sensitivity - board.dThetaDL[board.end])).toBeLessThanOrEqual(1e-6 * board.sensitivity);
    // A free nock follows: 6.91 °/mm at full draw (docs/research.md).
    const free = analyseTiming(base);
    expect(free.end).toBe(free.n - 1);
    expect((free.sensitivity * 180) / Math.PI / 1000).toBeCloseTo(6.91, 2);
  });

  it('keeps the free nock stable on the default design', () => {
    const a = analyseTiming({ ...base, offsets: { topCable: 0.1 * MM } });
    expect(Math.min(...a.ky)).toBeGreaterThan(3000);
    // 3.12 N/mm at full draw (docs/research.md).
    expect(a.ky[a.n - 1] / 1000).toBeCloseTo(3.12, 2);
    // The nock drops 0.61 mm per 0.1 mm of top cable at full draw.
    expect(a.y[a.n - 1] / MM).toBeCloseTo(-0.61, 1);
  });
});

describe('analysis draw stops', () => {
  it('stops the advanced cam first and reports the gap of the other', () => {
    const a = analyseTiming({ ...base, offsets: { topCable: 1 * MM } });
    expect(a.status).toBe('ok');
    expect(a.stops.first).toBe('top');
    expect(a.stops.x).toBe(a.x[a.n - 1]);
    expect(a.stops.x).toBeLessThan(a.fullDraw);
    expect(Math.abs(a.stops.gapTop)).toBeLessThanOrEqual(1e-9);
    expect(a.stops.gapBottom).toBeGreaterThan(1 * MM);
    // Both gaps stay open before the stop.
    for (let i = 0; i < a.n - 1; i++) expect(Math.min(a.gapTop[i], a.gapBottom[i])).toBeGreaterThan(0);
    const board = analyseTiming({ ...base, nock: 'board', offsets: { topCable: 1 * MM } });
    expect(board.stops.first).toBe('top');
  });

  it('runs past full draw to a late stop', () => {
    const a = analyseTiming({ ...base, offsets: { string: 20 * MM } });
    expect(a.status).toBe('ok');
    expect(a.stops.first).toBe('both');
    expect(a.stops.x).toBeGreaterThan(a.fullDraw);
  });

  it('searches beyond full draw at any sample count', () => {
    const fine = analyseTiming({ ...base, offsets: { string: 20 * MM } });
    for (const samples of [2, 5, 20]) {
      const a = analyseTiming({ ...base, samples, offsets: { string: 20 * MM } });
      expect(a.status).toBe('ok');
      expect(a.stops.first).toBe('both');
      expect(Math.abs(a.stops.x - fine.stops.x)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('finds a stop between two coarse samples', () => {
    const offsets = { topCable: 0.0137630067, bottomCable: -0.0149809458, string: -0.0066702191, nockHeight: -0.0026809258 };
    const fine = analyseTiming({ ...base, offsets });
    expect(fine.stops.first).toBe('top');
    for (const samples of [2, 20, 1500]) {
      const a = analyseTiming({ ...base, samples, offsets });
      expect(a.stops.first).toBe('top');
      expect(Math.abs(a.stops.x - fine.stops.x)).toBeLessThanOrEqual(1e-9);
      expect(a.status).toBe(fine.status);
    }
  });

  it('counts a gap of zero at the end of the search as a stop', () => {
    // The design rule of the stop peg, applied at the cable contact of the
    // last search point: the peg touches the cable line there and nowhere
    // before.
    const probe = analyseTiming({ ...base, stop: { x: 0, y: 0, radius: 0 } });
    const i = probe.n - 1;
    const peg = cableStopPost(createSupport(base.cableTrack), probe.psiCableTop[i], 0.004, /** @type {number} */ (base.cableDiameter));
    // Moved 5e-13 m towards the axle: the gap at the end is +5e-13 m, inside
    // the contact tolerance but not negative.
    const psi = probe.psiCableTop[i];
    const stop = { x: peg.x - 5e-13 * Math.cos(psi), y: peg.y - 5e-13 * Math.sin(psi), radius: peg.radius };
    const a = analyseTiming({ ...base, stop });
    expect(Math.abs(a.stops.gapTop)).toBeLessThanOrEqual(1e-12);
    expect(a.stops.x).toBe(probe.x[i]);
    expect(a.stops.first).toBe('both');
    expect(codes(a)).not.toContain('analysis-no-stop');
  });

  it('ends at full draw without a stop peg', () => {
    const a = analyseTiming({ ...base, stop: null, offsets: { topCable: 1 * MM } });
    expect(a.status).toBe('ok');
    expect(a.x[a.n - 1]).toBe(a.fullDraw);
    expect(a.n).toBe(ANALYSIS_SAMPLES);
    expect(a.stops).toEqual({ first: null, x: NaN, gapTop: NaN, gapBottom: NaN, second: null, x2: NaN, wallStiffness: NaN, releases: 0 });
    expect(Number.isNaN(a.gapTop[0])).toBe(true);
  });
});

describe('analysis diagnostics', () => {
  it('names every code in the table', () => {
    for (const [code, text] of Object.entries(ANALYSIS_CODES)) {
      expect(code.startsWith('analysis-')).toBe(true);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it('reports a slack string half on a draw board with a high nocking point', () => {
    const a = analyseTiming({ ...base, nock: 'board', offsets: { nockHeight: 20 * MM } });
    expect(codes(a)).toEqual(['analysis-slack']);
    expect(a.status).toBe('infeasible');
    const [x0, x1] = /** @type {[number, number]} */ (a.diagnostics[0].xRange);
    expect(x0).toBeGreaterThan(0.6);
    expect(x1).toBeLessThanOrEqual(a.stops.x);
  });

  it('reports a cord that runs off its wrapped track', () => {
    const a = analyseTiming({ ...base, offsets: { topCable: -50 * MM } });
    expect(codes(a)).toContain('analysis-wrap');
    // A string termination just past the brace contact: the string runs
    // off its track a few millimetres into the draw.
    const early = analyseTiming({ ...base, stringTermination: 0.01 });
    const range = early.diagnostics.find((d) => d.code === 'analysis-wrap')?.xRange;
    expect(range?.[0]).toBeGreaterThan(early.x[0]);
    expect(range?.[0]).toBeLessThan(early.x[0] + 10 * MM);
  });

  it('reports an unstable free nock for a limb whose moment falls', () => {
    const limb = createLimb(base.limb);
    const a0 = /** @type {number} */ (base.limb.alpha0);
    const m0 = limb.moment(0);
    const soft = tableLimb({ rotation: [0, a0, a0 + 0.1, a0 + 0.3, a0 + 0.6], moment: [0, m0, 0.8 * m0, 0.5 * m0, 0.2 * m0], alpha0: a0 });
    const a = analyseTiming({ ...base, limb: /** @type {any} */ (soft.limb) });
    expect(codes(a)).toEqual(['analysis-unstable']);
    expect(Math.max(...a.ky)).toBeLessThanOrEqual(0);
    // A draw board holds the nock and has no k_y.
    const board = analyseTiming({ ...base, nock: 'board', limb: /** @type {any} */ (soft.limb) });
    expect(codes(board)).not.toContain('analysis-unstable');
    expect(board.ky.every(Number.isNaN)).toBe(true);
  });

  it('reports a fold where the closure Jacobian reaches zero', () => {
    // A limb that points down at brace turns the cable anchors inwards
    // until the pose folds.
    const geometry = { ...base.geometry, limbAngleBrace: (-30 * Math.PI) / 180 };
    const a = analyseTiming({ ...base, geometry, offsets: { topCable: 2 * MM } });
    expect(codes(a)[0]).toBe('analysis-fold');
    expect(a.status).toBe('infeasible');
    expect(a.diagnostics[0].message).toMatch(/the draw ends at \d+\.\d mm$/);
  });

  it('reports no stop within the search range', () => {
    const a = analyseTiming({ ...base, stop: { x: 0, y: 0, radius: 0 } });
    // Past full draw the string also runs off the residual wrap.
    expect(codes(a)).toEqual(['analysis-wrap', 'analysis-no-stop']);
    expect(a.x[a.n - 1]).toBeGreaterThan(a.fullDraw * 1.05);
    expect(a.stops.first).toBeNull();
  });

  it('reports a brace that cannot be solved', () => {
    // A peg on the brace cable line, 20 mm from the contact.
    const psi = analyseTiming(base).psiCableTop[0];
    const X = createSupport(base.cableTrack).point(psi);
    const onLine = { x: X.x - 0.02 * Math.sin(psi), y: X.y + 0.02 * Math.cos(psi), radius: 0.001 };
    const resting = analyseTiming({ ...base, stop: onLine });
    expect(codes(resting)).toEqual(['analysis-brace']);
    expect(resting.diagnostics[0].message).toMatch(/rests on its draw stop at brace/);
  });

  it('reports no convergence when the iteration limit is too small', () => {
    const a = analyseTiming({ ...base, maxIterations: 1, offsets: { topCable: 1 * MM } });
    expect(codes(a)[0]).toMatch(/^analysis-(brace|no-convergence)$/);
    expect(a.status).not.toBe('ok');
  });

  it.each([
    ['a missing input', null],
    ['an unknown limb', { ...base, limb: { kind: 'spring' } }],
    ['a bad geometry', { ...base, geometry: { ...base.geometry, ata: -1 } }],
    ['a bad termination', { ...base, stringTermination: NaN }],
    ['an offset beyond 0.1 m', { ...base, offsets: { topCable: 0.2 } }],
    ['offsets that are not an object', { ...base, offsets: 3 }],
    ['an unknown nock mode', { ...base, nock: 'hand' }],
    ['a sample count of 1', { ...base, samples: 1 }],
    ['an iteration limit of 0', { ...base, maxIterations: 0 }],
    ['a stop without a cable diameter', { ...base, cableDiameter: undefined }],
    ['a stop that is false', { ...base, stop: false }],
    ['a stop that is 0', { ...base, stop: 0 }],
    ['a stop that is an empty string', { ...base, stop: '' }],
    ['a stop that is NaN', { ...base, stop: NaN }],
    ['a getter that throws', Object.defineProperty({ ...base }, 'offsets', { get() { throw new Error('boom'); } })],
  ])('rejects %s as invalid input', (_name, input) => {
    const a = analyseTiming(/** @type {any} */ (input));
    expect(codes(a)).toEqual(['analysis-invalid-input']);
    expect(a.n).toBe(0);
    expect(a.status).toBe('infeasible');
  });
});
