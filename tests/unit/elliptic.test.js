import { describe, expect, it } from 'vitest';
import { carlsonRD, carlsonRF, ellipticE, ellipticECompleteParam } from '../../src/core/elliptic.js';
import { integrate } from './numeric.js';

/**
 * @param {number} actual
 * @param {number} expected
 */
const rel = (actual, expected) => Math.abs(actual - expected) / Math.abs(expected);

describe('Carlson integrals', () => {
  it('match reference values (SciPy elliprf, elliprd) to 1e-15 relative', () => {
    expect(rel(carlsonRF(1, 2, 0), 1.3110287771460598)).toBeLessThan(1e-15);
    expect(rel(carlsonRF(2, 3, 4), 0.5840828416771517)).toBeLessThan(1e-15);
    expect(rel(carlsonRD(0, 2, 1), 1.7972103521033884)).toBeLessThan(1e-15);
    expect(rel(carlsonRD(2, 3, 4), 0.16510527294261054)).toBeLessThan(1e-15);
  });

  it('reduce to elementary values for equal arguments', () => {
    expect(rel(carlsonRF(4, 4, 4), 0.5)).toBeLessThan(1e-15);
    expect(rel(carlsonRD(4, 4, 4), 1 / 8)).toBeLessThan(1e-15);
  });
});

describe('ellipticE', () => {
  it('matches SciPy ellipeinc and ellipe', () => {
    expect(rel(ellipticECompleteParam(0.5), 1.3506438810476755)).toBeLessThan(1e-15);
    const cases = [
      [0.3, 0.2, 0.2991137191295999],
      [1.2, 0.9, 0.9670376602886748],
      [-2.5, 0.7, -1.871329430383859],
      [7.3, 0.35, 6.65550376269813],
    ];
    for (const [phi, m, expected] of cases) expect(rel(ellipticE(phi, m), expected)).toBeLessThan(2e-15);
  });

  it('equals the quadrature of √(1 − m sin²u) for many angles and parameters', () => {
    for (const m of [0, 0.1, 0.5, 0.9, 0.99]) {
      for (const phi of [-7, -3.2, -1, 0, 0.4, 1.5708, 2, 4.9, 12]) {
        const exact = integrate((u) => Math.sqrt(1 - m * Math.sin(u) ** 2), 0, phi, 256);
        expect(Math.abs(ellipticE(phi, m) - exact)).toBeLessThan(1e-13);
      }
    }
  });
});
