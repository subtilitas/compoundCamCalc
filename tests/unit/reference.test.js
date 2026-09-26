import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODELS, QUANTITIES, UNITS, runFixture, symbolsSI } from '../reference/harness.js';

const dir = new URL('../fixtures/reference/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
/** @type {import('../reference/harness.js').Fixture[]} */
const fixtures = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

describe('reference bows', () => {
  it('have at least one enforced fixture', () => {
    expect(fixtures.filter((f) => f.enforced).length).toBeGreaterThanOrEqual(1);
  });

  for (const [i, fixture] of fixtures.entries()) {
    describe(fixture.id, () => {
      it('follow the fixture format', () => {
        expect(files[i]).toBe(`${fixture.id}.json`);
        expect(typeof fixture.name).toBe('string');
        expect(typeof fixture.enforced).toBe('boolean');
        expect(fixture.sources.length).toBeGreaterThan(0);
        for (const s of fixture.sources) {
          expect(s.citation).toMatch(/\S/);
          expect(s.licence).toMatch(/\S/);
          expect(s.used).toMatch(/\S/);
        }
        expect(Object.keys(MODELS)).toContain(fixture.model);
        for (const [, unit] of Object.values(fixture.symbols)) expect(Object.keys(UNITS)).toContain(unit);
        for (const t of fixture.targets) {
          expect(QUANTITIES).toContain(t.quantity);
          expect(t.tolerance).toBeGreaterThan(0);
          expect(t.source).toMatch(/\S/);
        }
        expect(fixture.forces.tolerance).toBeGreaterThan(0);
        for (const [x, F] of fixture.forces.points) expect(Number.isFinite(x) && Number.isFinite(F)).toBe(true);
        if (fixture.measured) expect(fixture.measured.uncertainty.x > 0 && fixture.measured.uncertainty.F > 0).toBe(true);
      });

      it(fixture.enforced ? 'meet every target' : 'run (reported, not enforced)', () => {
        const checks = runFixture(fixture);
        expect(checks.length).toBeGreaterThan(0);
        const failed = checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.value} against ${c.target} ± ${c.tolerance}`);
        if (fixture.enforced) expect(failed).toEqual([]);
      });
    });
  }
});

describe('reference harness', () => {
  const b1 = fixtures.find((f) => f.id === 'tiermas-b1');
  if (!b1) throw new Error('the B1 fixture is missing');

  it('fail a target outside its tolerance', () => {
    const wrong = { ...b1, targets: [{ quantity: 'peakForce', value: 224.0, tolerance: 0.05, source: 'test' }] };
    const check = runFixture(wrong).find((c) => c.name === 'peakForce');
    expect(check?.pass).toBe(false);
    expect(check?.value).toBeCloseTo(223.856, 3);
  });

  it('fail inputs that do not follow from the symbols', () => {
    const wrong = { ...b1, inputs: { ...b1.inputs, limb: { ...b1.inputs.limb, torsionalStiffness: 241 } } };
    expect(runFixture(wrong).find((c) => c.name === 'input limb.torsionalStiffness')?.pass).toBe(false);
  });

  it('fail a force the author\'s equations do not give', () => {
    const wrong = { ...b1, forces: { ...b1.forces, points: [/** @type {[number, number]} */ ([0.4, 195.6379])] } };
    const checks = runFixture(wrong);
    expect(checks.find((c) => c.name === 'F(0.4 m), app')?.pass).toBe(false);
    expect(checks.find((c) => c.name === 'F(0.4 m), author\'s equations')?.pass).toBe(false);
    expect(checks.find((c) => c.name === 'F(0.4 m), app against the author\'s equations')?.pass).toBe(true);
  });

  it('refuse unknown units, models and quantities', () => {
    expect(() => symbolsSI({ e0: [1, /** @type {any} */ ('ft')] })).toThrow(/Unknown unit "ft"/);
    expect(() => runFixture({ ...b1, model: /** @type {any} */ ('other') })).toThrow(/unknown model "other"/);
    expect(() => runFixture({ ...b1, targets: [{ quantity: 'speed', value: 1, tolerance: 1, source: 'test' }] })).toThrow(/unknown quantity "speed"/);
  });
});
