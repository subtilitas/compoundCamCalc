import { describe, expect, it } from 'vitest';
import {
  anchor, axle, bowGeometry, cableLength, createPose, evaluatePose, stringHalfLength, toCam,
} from '../../src/core/geometry.js';
import { createSupport, eccentricCircle, ellipse, offset } from '../../src/core/support.js';
import { AMO_OFFSET } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';
import { derivative } from './numeric.js';

const geometry = defaultState().geometry;
const stringSupport = createSupport(offset(ellipse({ a: 0.04, b: 0.033, axisAngle: 0.4, offset: 0.005, offsetAngle: 0.9 }), 0.00125));
const cableSupport = createSupport(eccentricCircle({ radius: 0.02, offset: 0.007, phase: 2.2 }));
const bow = /** @type {import('../../src/core/geometry.js').BowGeometry} */ (bowGeometry(geometry, stringSupport).bow);

describe('bowGeometry', () => {
  it('places the brace axle so that the vertical string touches the track at ψ = 0', () => {
    expect(bow.xBrace).toBe(geometry.braceHeight);
    expect(bow.xFull).toBeCloseTo(geometry.drawLength - AMO_OFFSET, 15);
    expect(bow.braceAxleX).toBeCloseTo(geometry.braceHeight - stringSupport.p(0), 15);
    expect(bow.braceAxleY).toBeCloseTo(geometry.ata / 2, 15);
    expect(Math.hypot(bow.braceAxleX - bow.pivotX, bow.braceAxleY - bow.pivotY)).toBeCloseTo(geometry.limbLength, 15);
    expect(Math.atan2(bow.braceAxleY - bow.pivotY, bow.braceAxleX - bow.pivotX)).toBeCloseTo(geometry.limbAngleBrace, 14);

    const { length, contact } = stringHalfLength(bow, stringSupport, bow.xBrace, 0, 0, 3);
    expect(contact.psi).toBeCloseTo(0, 14);
    expect(contact.ux).toBeCloseTo(0, 14);
    expect(contact.uy).toBeCloseTo(-1, 14);
    expect(contact.span).toBeCloseTo(bow.braceAxleY + stringSupport.dp(0), 14);
    expect(Number.isFinite(length)).toBe(true);
  });

  it('rejects invalid geometry without throwing', () => {
    expect(bowGeometry({ ...geometry, ata: NaN }, stringSupport).error).toMatch(/finite/);
    expect(bowGeometry({ ...geometry, limbLength: 0 }, stringSupport).error).toMatch(/positive/);
    expect(bowGeometry({ ...geometry, drawLength: geometry.braceHeight }, stringSupport).error).toMatch(/Full draw/);
    const broken = createSupport(eccentricCircle({ radius: NaN }));
    expect(bowGeometry(geometry, broken).error).toMatch(/lever arm/);
    expect(bowGeometry(/** @type {any} */ (null), stringSupport).bow).toBeNull();
  });
});

describe('axle and anchor', () => {
  it('moves the top axle on a circle about the pivot, towards the bow centre', () => {
    for (const alpha of [0, 0.05, 0.2, 0.4]) {
      const o = axle(bow, alpha);
      expect(Math.hypot(o.x - bow.pivotX, o.y - bow.pivotY)).toBeCloseTo(geometry.limbLength, 15);
      expect(o.dx).toBeCloseTo(derivative((a) => axle(bow, a).x, alpha, 1e-4), 10);
      expect(o.dy).toBeCloseTo(derivative((a) => axle(bow, a).y, alpha, 1e-4), 10);
      const A = anchor(bow, alpha);
      expect([A.x, A.y, A.dx, A.dy]).toEqual([o.x, -o.y, o.dx, -o.dy]);
    }
    expect(axle(bow, 0.1).y).toBeLessThan(bow.braceAxleY);
    expect(axle(bow, 0).x).toBeCloseTo(bow.braceAxleX, 15);
  });
});

describe('toCam', () => {
  it('rotates world vectors by +θ, so a positive θ turns the cam clockwise in the world', () => {
    const v = toCam(0.3, 1, 0);
    expect(v.x).toBeCloseTo(Math.cos(0.3), 15);
    expect(v.y).toBeCloseTo(Math.sin(0.3), 15);
    // A cam point at cam coordinates (0, r) sits at R(−θ)·(0, r) in the world:
    // for a small θ > 0 it moves towards +x (the archer), a clockwise turn.
    const theta = 0.01;
    const world = { x: Math.sin(theta) * 0.03, y: Math.cos(theta) * 0.03 };
    const back = toCam(theta, world.x, world.y);
    expect(back.x).toBeCloseTo(0, 16);
    expect(back.y).toBeCloseTo(0.03, 16);
    expect(world.x).toBeGreaterThan(0);
  });
});

describe('projection partials', () => {
  it('match finite differences of g_s and g_c', () => {
    const pose = createPose();
    const psiEnd = { s: 7, c: -2 };
    for (const [x, theta, alpha] of [
      [bow.xBrace + 0.05, 0.8, 0.02],
      [bow.xBrace + 0.3, 3.1, 0.15],
      [bow.xFull, 5, 0.2],
    ]) {
      expect(evaluatePose(bow, stringSupport, cableSupport, x, theta, alpha, pose)).toBe(true);
      const gs = (/** @type {number} */ xx, /** @type {number} */ t, /** @type {number} */ a) =>
        stringHalfLength(bow, stringSupport, xx, t, a, psiEnd.s, pose.string.psi).length;
      const gc = (/** @type {number} */ t, /** @type {number} */ a) => cableLength(bow, cableSupport, t, a, psiEnd.c, pose.cable.psi).length;
      const h = 1e-5;
      expect(derivative((t) => gs(x, t, alpha), theta, h)).toBeCloseTo(-pose.string.p, 10);
      expect(derivative((xx) => gs(xx, theta, alpha), x, h)).toBeCloseTo(pose.sinPhi, 10);
      expect(derivative((a) => gs(x, theta, a), alpha, h)).toBeCloseTo(-pose.sa, 10);
      expect(derivative((t) => gc(t, alpha), theta, h)).toBeCloseTo(pose.cable.p, 10);
      expect(derivative((a) => gc(theta, a), alpha, h)).toBeCloseTo(-pose.ca, 10);
      // The unit vectors point from the contacts to the nock and to the anchor.
      const o = axle(bow, alpha);
      const cs = stringSupport.point(pose.string.psi);
      const worldS = { x: Math.cos(theta) * cs.x + Math.sin(theta) * cs.y + o.x, y: -Math.sin(theta) * cs.x + Math.cos(theta) * cs.y + o.y };
      const ls = Math.hypot(x - worldS.x, -worldS.y);
      expect(pose.usx).toBeCloseTo((x - worldS.x) / ls, 12);
      expect(pose.usy).toBeCloseTo(-worldS.y / ls, 12);
      expect(pose.string.span).toBeCloseTo(ls, 13);
    }
  });

  it('reports a failed contact', () => {
    const huge = createSupport(eccentricCircle({ radius: 2 }));
    expect(evaluatePose(bow, stringSupport, huge, bow.xBrace, 0, 0, createPose())).toBe(false);
    expect(Number.isNaN(cableLength(bow, huge, 0, 0, 0).length)).toBe(true);
    expect(Number.isNaN(stringHalfLength(bow, huge, bow.xBrace, 0, 0, 0).length)).toBe(true);
  });
});
