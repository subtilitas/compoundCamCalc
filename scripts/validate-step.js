#!/usr/bin/env node
/**
 * Validates the STEP files of a directory: the Part 21 checks of
 * tests/unit/step-reader.js (references, REAL tokens, knot sums, edge use,
 * loop connectivity, Euler–Poincaré, face orientation) and an import into
 * OpenCascade through occt-import-js (every file reads, one mesh per solid).
 *
 * Usage: node scripts/validate-step.js <dir>
 * Prints one summary line per file and exits with 1 when any check fails.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import occtFactory from 'occt-import-js';
import { checkStep } from '../tests/unit/step-reader.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/validate-step.js <dir>');
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => f.endsWith('.step')).sort();
if (files.length === 0) {
  console.error(`no .step files in ${dir}`);
  process.exit(1);
}
const occt = await occtFactory();
let failed = 0;
for (const name of files) {
  const text = readFileSync(join(dir, name), 'utf8');
  /** @type {string[]} */
  let problems;
  /** @type {string} */
  let summary;
  try {
    const r = checkStep(text);
    problems = r.problems;
    const read = occt.ReadStepFile(new TextEncoder().encode(text), { linearUnit: 'millimeter' });
    if (!read.success) problems.push('occt-import-js cannot read the file');
    else if (read.meshes.length !== r.solids.length) problems.push(`occt-import-js reads ${read.meshes.length} meshes for ${r.solids.length} solids`);
    summary = `${r.solids.length} solids, ${r.curves} curves, ${text.length} bytes`;
  } catch (err) {
    problems = [`check crashed: ${err instanceof Error ? err.message : String(err)}`];
    summary = 'crashed';
  }
  console.log(`${problems.length ? 'FAIL' : 'ok'} ${name}: ${summary}`);
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  if (problems.length) failed++;
}
process.exit(failed ? 1 : 0);
