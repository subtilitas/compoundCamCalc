/**
 * Writes the export files of three sample designs to a directory, for the
 * DXF validation job of CI: the default preset (eccentric string track),
 * the same bow with an elliptical string track (46 mm × 44 mm) and with a
 * free-form string track (the default track at 12 points plus a 1 mm
 * rounded triangle).
 *
 * Usage: node scripts/export-samples.js [dir]   (default: export-samples)
 * Exits with 1 when a sample does not solve or export.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyModifier } from '../src/core/freeform.js';
import { solve } from '../src/core/solve.js';
import { exportFiles, exportZip } from '../src/export/files.js';
import { defaultState } from '../src/state/presets.js';

const dir = process.argv[2] ?? 'export-samples';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// A fixed date keeps the samples reproducible.
const date = new Date(2026, 0, 1, 12, 0, 0);

const ellipse = structuredClone(defaultState());
Object.assign(ellipse.stringTrack, { shape: 'ellipse', semiMajor: 0.046, semiMinor: 0.044 });
const freeform = structuredClone(defaultState());
Object.assign(freeform.stringTrack, { shape: 'freeform', freeform: { values: applyModifier(freeform.stringTrack.freeform.values, 'triangle', 0.001, 0) } });
const samples = [
  ['default', defaultState()],
  ['ellipse', ellipse],
  ['freeform', freeform],
];

mkdirSync(dir, { recursive: true });
let failed = false;
for (const [name, state] of /** @type {[string, import('../src/state/schema.js').ProjectState][]} */ (samples)) {
  const result = solve(state);
  if (result.status !== 'ok') {
    console.error(`${name}: the solve reports ${result.diagnostics.map((d) => d.code).join(', ')}`);
    failed = true;
    continue;
  }
  const out = exportFiles(result, state, { date, version, units: state.units });
  if (!out.set) {
    console.error(`${name}: ${out.error}`);
    failed = true;
    continue;
  }
  for (const f of out.set.files) writeFileSync(join(dir, `${name}-${f.name}`), f.text);
  const zip = exportZip(out.set, date);
  if (!zip.bytes) {
    console.error(`${name}: ${zip.error}`);
    failed = true;
    continue;
  }
  writeFileSync(join(dir, `${name}-${zip.name}`), zip.bytes);
  console.log(`${name}: ${out.set.files.length} files and a ZIP, ${out.set.warnings.length} warnings`);
}
process.exit(failed ? 1 : 0);
