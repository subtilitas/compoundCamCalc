/**
 * Prints every check of the reference-bow fixtures in
 * tests/fixtures/reference: value, target, tolerance and result. Exits
 * with 1 when a check of an enforced fixture fails.
 * Usage: npm run reference
 */
import { readFileSync, readdirSync } from 'node:fs';
import { runFixture } from '../tests/reference/harness.js';

const dir = new URL('../tests/fixtures/reference/', import.meta.url);
let failed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  /** @type {import('../tests/reference/harness.js').Fixture} */
  const fixture = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  console.log(`\n${fixture.id}: ${fixture.name} (${fixture.enforced ? 'enforced' : 'reported only'})`);
  for (const c of runFixture(fixture)) {
    if (!c.pass && fixture.enforced) failed++;
    const num = (/** @type {number} */ v, /** @type {number} */ p) => String(+v.toPrecision(p));
    console.log(`  ${c.pass ? 'pass' : 'FAIL'}  ${c.name.padEnd(52)} ${num(c.value, 9).padStart(14)}  target ${num(c.target, 9).padStart(14)} ± ${num(c.tolerance, 3)}`);
  }
}
if (failed) {
  console.error(`\n${failed} checks of enforced fixtures fail`);
  process.exitCode = 1;
}
