#!/usr/bin/env node
/**
 * Fails when a tracked file or a commit message reachable from HEAD contains
 * a link to an interactive coding session or a session trailer.
 *
 *   node scripts/check-session-links.js
 *
 * Exit codes: 0 clean, 1 matches found, 2 git error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Built from parts so that this file does not match itself.
export const PATTERN = new RegExp(['claude\\.ai/code/', 'session', '|', 'Claude-', 'Session:'].join(''), 'i');

/**
 * @param {string} text
 * @returns {number[]} 1-based line numbers that match
 */
export function matchingLines(text) {
  return text.split(/\r?\n/).flatMap((line, i) => (PATTERN.test(line) ? [i + 1] : []));
}

/**
 * @param {(args: string[]) => string} git
 * @param {(path: string) => string} read
 * @returns {string[]} one message per match
 */
export function findMatches(git, read) {
  /** @type {string[]} */
  const found = [];
  for (const path of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    let text;
    try {
      text = read(path);
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    for (const line of matchingLines(text)) found.push(`${path}:${line}`);
  }
  const log = git(['log', '--format=%H%x00%B%x01', 'HEAD']);
  for (const entry of log.split('\x01')) {
    const [sha, message = ''] = entry.trim().split('\0');
    if (sha && matchingLines(message).length > 0) found.push(`commit ${sha.slice(0, 12)}`);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const git = (/** @type {string[]} */ args) =>
      execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const found = findMatches(git, (path) => readFileSync(path, 'utf8'));
    if (found.length > 0) {
      console.error('Session links found:');
      for (const f of found) console.error(`  ${f}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`git failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
