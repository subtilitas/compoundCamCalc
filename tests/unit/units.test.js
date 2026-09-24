import { describe, expect, it } from 'vitest';
import {
  AMO_OFFSET, FT_LBF, INCH, LBF, UNITS,
  formatQuantity, fromSI, parseNumber, parseQuantity, toSI,
} from '../../src/core/units.js';

describe('constants', () => {
  it('uses exact definitions', () => {
    expect(INCH).toBe(0.0254);
    expect(LBF).toBe(4.4482216152605);
    expect(FT_LBF).toBeCloseTo(1.3558179483314, 13);
    expect(AMO_OFFSET).toBeCloseTo(0.04445, 15);
  });
});

describe('toSI / fromSI', () => {
  it('converts every unit and back without loss beyond 1 ulp scale', () => {
    for (const [quantity, table] of Object.entries(UNITS)) {
      for (const unit of Object.keys(table)) {
        const x = 29.123456789;
        expect(fromSI(toSI(x, quantity, unit), quantity, unit)).toBeCloseTo(x, 12);
      }
    }
  });

  it('converts 60 lbf to 266.89 N and 29 in to 736.6 mm', () => {
    expect(toSI(60, 'force', 'lbf')).toBeCloseTo(266.893, 3);
    expect(fromSI(toSI(29, 'length', 'in'), 'length', 'mm')).toBeCloseTo(736.6, 9);
  });

  it('converts N/mm to lbf/in', () => {
    expect(fromSI(toSI(1, 'stiffness', 'N/mm'), 'stiffness', 'lbf/in')).toBeCloseTo(5.71015, 5);
  });

  it('rejects unknown quantities and units', () => {
    expect(() => toSI(1, 'mass', 'kg')).toThrow(/quantity/);
    expect(() => toSI(1, 'length', 'ft')).toThrow(/unit/);
  });
});

describe('parseNumber', () => {
  it('accepts decimal point and decimal comma', () => {
    expect(parseNumber('29.5')).toBe(29.5);
    expect(parseNumber('29,5')).toBe(29.5);
    expect(parseNumber(' -0,25 ')).toBe(-0.25);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('1e-3')).toBe(0.001);
  });

  it('rejects invalid text', () => {
    for (const s of ['', 'abc', '1.2.3', '1,2,3', '12a', '--1']) {
      expect(parseNumber(s)).toBeNaN();
    }
  });
});

describe('parseQuantity', () => {
  it('uses the default unit without suffix', () => {
    expect(parseQuantity('29', 'length', 'in')).toBeCloseTo(0.7366, 12);
  });

  it('uses a typed unit suffix', () => {
    expect(parseQuantity('750 mm', 'length', 'in')).toBeCloseTo(0.75, 12);
    expect(parseQuantity('60lbf', 'force', 'N')).toBeCloseTo(266.893, 3);
    expect(parseQuantity('2,5 mm', 'length', 'in')).toBeCloseTo(0.0025, 12);
  });

  it('returns NaN for invalid text', () => {
    expect(parseQuantity('abc mm', 'length', 'in')).toBeNaN();
    expect(parseQuantity('', 'force', 'N')).toBeNaN();
  });

  it('rejects unknown quantities', () => {
    expect(() => parseQuantity('1', 'mass', 'kg')).toThrow(/quantity/);
  });
});

describe('formatQuantity', () => {
  it('formats with unit and decimals', () => {
    expect(formatQuantity(0.7366, 'length', 'in', 2)).toBe('29.00 in');
    expect(formatQuantity(266.893, 'force', 'N')).toBe('266.9 N');
  });

  it('never prints negative zero', () => {
    expect(formatQuantity(-1e-9, 'length', 'mm', 1)).toBe('0.0 mm');
  });

  it('prints a dash for non-finite values', () => {
    expect(formatQuantity(NaN, 'force', 'N')).toBe('–');
  });
});
