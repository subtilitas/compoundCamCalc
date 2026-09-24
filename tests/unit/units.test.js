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

  it('matches independent reference values for every factor', () => {
    expect(toSI(1, 'length', 'm')).toBe(1);
    expect(toSI(1, 'length', 'cm')).toBe(0.01);
    expect(toSI(1, 'length', 'mm')).toBe(0.001);
    expect(toSI(1, 'length', 'in')).toBe(0.0254);
    expect(toSI(1, 'force', 'N')).toBe(1);
    expect(toSI(1, 'force', 'lbf')).toBe(4.4482216152605);
    expect(toSI(1, 'energy', 'J')).toBe(1);
    expect(toSI(1, 'energy', 'ft·lbf')).toBeCloseTo(1.3558179483314, 13);
    expect(toSI(180, 'angle', 'deg')).toBeCloseTo(Math.PI, 15);
    expect(toSI(1, 'angle', 'rad')).toBe(1);
    expect(toSI(1, 'stiffness', 'N/m')).toBe(1);
    expect(toSI(1, 'stiffness', 'N/mm')).toBe(1000);
    expect(toSI(1, 'stiffness', 'lbf/in')).toBeCloseTo(175.126835246476, 10);
  });

  it('converts N/mm to lbf/in', () => {
    expect(fromSI(toSI(1, 'stiffness', 'N/mm'), 'stiffness', 'lbf/in')).toBeCloseTo(5.71015, 5);
  });

  it('rejects unknown quantities and units', () => {
    expect(() => toSI(1, 'mass', 'kg')).toThrow(/quantity/);
    expect(() => toSI(1, 'length', 'ft')).toThrow(/unit/);
  });

  it('rejects inherited object keys as units or quantities', () => {
    expect(() => toSI(1, 'length', 'constructor')).toThrow(/unit/);
    expect(() => toSI(1, 'length', '__proto__')).toThrow(/unit/);
    expect(() => toSI(1, 'toString', 'm')).toThrow(/quantity/);
    expect(() => parseQuantity('1', 'constructor', 'm')).toThrow(/quantity/);
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

  it('rejects white space inside the number', () => {
    for (const s of ['29 5', '1 000', '- 5', '1 e 3']) {
      expect(parseNumber(s)).toBeNaN();
    }
  });

  it('reads a single comma as the decimal separator', () => {
    expect(parseNumber('1,000')).toBe(1);
  });

  it('returns NaN on overflow', () => {
    expect(parseNumber('1e400')).toBeNaN();
    expect(parseQuantity('-1e400', 'force', 'N')).toBeNaN();
  });
});

describe('parseQuantity', () => {
  it('uses the default unit without suffix', () => {
    expect(parseQuantity('29', 'length', 'in')).toBeCloseTo(0.7366, 12);
  });

  it('uses a typed unit suffix', () => {
    expect(parseQuantity('750 mm', 'length', 'in')).toBeCloseTo(0.75, 12);
    expect(parseQuantity('75 cm', 'length', 'in')).toBeCloseTo(0.75, 12);
    expect(parseQuantity('2 m', 'length', 'mm')).toBe(2);
    expect(parseQuantity('12 N/mm', 'stiffness', 'N/m')).toBe(12000);
    expect(parseQuantity('12 N/m', 'stiffness', 'N/mm')).toBe(12);
    expect(parseQuantity('1 lbf/in', 'stiffness', 'N/mm')).toBeCloseTo(175.126835246476, 10);
    expect(parseQuantity('90 deg', 'angle', 'rad')).toBeCloseTo(Math.PI / 2, 15);
    expect(parseQuantity('100 N', 'force', 'lbf')).toBe(100);
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
    expect(formatQuantity(Infinity, 'force', 'N')).toBe('–');
    expect(formatQuantity(-Infinity, 'force', 'N')).toBe('–');
  });
});
