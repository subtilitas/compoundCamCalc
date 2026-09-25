import { describe, expect, it } from 'vitest';
import { formatter } from '../../src/core/diagnostics.js';
import { CAM_SIZE_SHARE, lowestCamPoint, plausibility } from '../../src/core/plausibility.js';
import { solve } from '../../src/core/solve.js';
import { INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES } from '../../src/state/samples.js';

const fmt = formatter({ ...defaultState().units, dims: 'mm', draw: 'in' });

/**
 * Circle of radius r about (cx, cy) in the cam frame.
 * @param {number} r
 * @param {number} cx
 * @param {number} cy
 */
function circle(r, cx, cy, count = 3600) {
  const x = new Float64Array(count + 1);
  const y = new Float64Array(count + 1);
  for (let k = 0; k <= count; k++) {
    x[k] = cx + r * Math.cos((2 * Math.PI * k) / count);
    y[k] = cy + r * Math.sin((2 * Math.PI * k) / count);
  }
  return { x, y };
}

/**
 * @param {number[]} theta
 * @param {number[]} axleY
 */
function samples(theta, axleY) {
  return { x: Float64Array.from(theta, (_, i) => 0.1 + 0.01 * i), theta: Float64Array.from(theta), axleY: Float64Array.from(axleY) };
}

describe('plausibility', () => {
  it('finds the lowest point of the top cam from its rotation', () => {
    // A disc of radius 0.02 m centred 0.03 m from the axle along +u. At θ the
    // bow-frame height of the centre is O_y − sin θ·0.03, so the lowest point
    // is O_y − sin θ·0.03 − 0.02.
    const theta = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1];
    const low = lowestCamPoint({ ata: 0.3, camMaxDimension: 0.1, outlines: [circle(0.02, 0.03, 0)], achieved: samples(theta, theta.map(() => 0.15)) });
    theta.forEach((t, i) => expect(low[i]).toBeCloseTo(0.15 - Math.sin(t) * 0.03 - 0.02, 6));
  });

  it('skips samples without a pose', () => {
    const low = lowestCamPoint({ ata: 0.3, camMaxDimension: 0.1, outlines: [circle(0.02, 0, 0)], achieved: samples([0, NaN], [0.15, 0.15]) });
    expect(low[0]).toBeCloseTo(0.13, 6);
    expect(low[1]).toBeNaN();
  });

  it('warns above the cam size share of the axle-to-axle length', () => {
    const ata = 0.254;
    const outlines = [circle(0.01, 0, 0)];
    const achieved = samples([0], [ata / 2]);
    expect(plausibility({ ata, camMaxDimension: CAM_SIZE_SHARE * ata, outlines, achieved }, fmt)).toEqual([]);
    const [w] = plausibility({ ata, camMaxDimension: 0.5239, outlines, achieved }, fmt);
    expect(w.code).toBe('cam-size');
    expect(w.message).toBe('The cam measures 523.9 mm across, 206 % of the 254.0 mm axle-to-axle length; this app warns above 35 %');
  });

  it('reports the draw range and depth of a cam overlap', () => {
    // Axle at 0.1 m; the disc reaches 0.12 m below the axle from sample 2 on.
    const theta = [0, 0, Math.PI / 2, Math.PI / 2, 0];
    const achieved = samples(theta, [0.1, 0.1, 0.1, 0.1, 0.1]);
    const w = plausibility({ ata: 0.2, camMaxDimension: 0.05, outlines: [circle(0.02, 0.1, 0)], achieved }, fmt);
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('cam-overlap');
    expect(w[0].xRange?.[0]).toBeCloseTo(0.12, 12);
    expect(w[0].xRange?.[1]).toBeCloseTo(0.13, 12);
    // Lowest point −0.02 m: the mirrored cams overlap by 0.04 m.
    expect(w[0].message).toMatch(/by up to 40\.0 mm$/);
  });

  it('lists separate overlap ranges', () => {
    // Overlap at the first and last sample only: two ranges, not one span.
    const theta = [Math.PI / 2, 0, 0, Math.PI / 2];
    const achieved = { x: Float64Array.from([0.2, 0.3, 0.4, 0.5]), theta: Float64Array.from(theta), axleY: Float64Array.from([0.1, 0.1, 0.1, 0.1]) };
    const [w] = plausibility({ ata: 0.2, camMaxDimension: 0.05, outlines: [circle(0.02, 0.1, 0)], achieved }, fmt);
    expect(w.message).toBe(`The two cams overlap ${fmt.drawRange([0.2, 0.2])} and ${fmt.drawRange([0.5, 0.5])}, by up to 40.0 mm`);
    expect(w.xRange).toEqual([0.2, 0.5]);
  });

  it('gives no warning for the samples and both for an oversized mini cam', () => {
    for (const s of SAMPLES) expect(solve(s.state()).warnings, s.id).toEqual([]);
    const st = SAMPLES[3].state();
    st.limb = { ...st.limb, mode: 'travel', travel: 0.03 };
    const r = solve(st);
    expect(r.warnings.map((w) => w.code)).toEqual(['cam-size', 'cam-overlap']);
    expect(r.metrics?.camMaxDimension).toBeGreaterThan(0.35 * 10 * INCH);
  }, 60_000);
});
