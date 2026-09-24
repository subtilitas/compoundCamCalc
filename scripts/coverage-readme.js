#!/usr/bin/env node
/**
 * Keeps the coverage figure in README.md in sync with coverage/coverage-summary.json.
 *
 *   node scripts/coverage-readme.js --write   rewrite the figure
 *   node scripts/coverage-readme.js --check   exit 1 when the figure differs
 *
 * The figure is the line coverage, rounded down to an integer percent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const START = '<!-- coverage:start -->';
export const END = '<!-- coverage:end -->';

/**
 * @param {{ total: { lines: { pct: number } } }} summary
 * @returns {string}
 */
export function renderBlock(summary) {
  const pct = summary?.total?.lines?.pct;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    throw new Error('coverage summary has no total.lines.pct');
  }
  const floor = Math.floor(pct);
  return `Line coverage of \`src/core\`, \`src/state\` and \`src/export\`: **${floor} %**`;
}

/**
 * Replace the text between the markers.
 * @param {string} readme
 * @param {string} block
 * @returns {string}
 */
export function replaceBlock(readme, block) {
  const i = readme.indexOf(START);
  const j = readme.indexOf(END);
  if (i < 0 || j < 0 || j < i) {
    throw new Error(`README.md must contain ${START} followed by ${END}`);
  }
  // Keep the file's line ending (a Windows checkout may use CRLF).
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  return `${readme.slice(0, i + START.length)}${eol}${block}${eol}${readme.slice(j)}`;
}

/**
 * @param {string[]} argv
 * @param {{ readme: string, summary: string }} paths
 * @returns {number} exit code
 */
export function main(argv, paths) {
  const mode = argv.includes('--write') ? 'write' : argv.includes('--check') ? 'check' : null;
  if (!mode) {
    console.error('usage: coverage-readme.js --check | --write');
    return 2;
  }
  const readme = readFileSync(paths.readme, 'utf8');
  const summary = JSON.parse(readFileSync(paths.summary, 'utf8'));
  const next = replaceBlock(readme, renderBlock(summary));
  if (mode === 'write') {
    if (next !== readme) writeFileSync(paths.readme, next);
    return 0;
  }
  if (next !== readme) {
    console.error('README coverage figure is out of date. Run: npm run coverage:update');
    console.error(`expected: ${renderBlock(summary)}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url);
  process.exitCode = main(process.argv.slice(2), {
    readme: fileURLToPath(new URL('README.md', root)),
    summary: fileURLToPath(new URL('coverage/coverage-summary.json', root)),
  });
}
