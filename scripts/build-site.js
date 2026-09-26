#!/usr/bin/env node
/**
 * Build the GitHub Pages site: the checked-out tree at the site root as
 * channel main, every release tag vMAJOR.MINOR.PATCH in a folder of its
 * name, and versions.json listing them.
 *
 *   node scripts/build-site.js [out-dir]     default out-dir: site
 *
 * Each tag builds in a temporary git worktree with its own `npm ci`, so a
 * release keeps the dependencies it was tested with. The release builds get
 * APP_CHANNEL set to their tag; a release older than the version select
 * ignores it and shares the browser storage of main.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { VERSIONS_FILE, sortTags, versionsManifest } from '../src/state/channel.js';

const out = resolve(process.argv[2] ?? 'site');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/**
 * Run a command with inherited output; throws on a non-zero exit.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...opts.env } });
}

/**
 * Build one tree into a folder.
 * @param {string} cwd
 * @param {string} channel
 * @param {string} dir
 */
function build(cwd, channel, dir) {
  run(npx, ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd, env: { APP_CHANNEL: channel } });
  if (!existsSync(join(dir, 'index.html'))) throw new Error(`Build of ${channel} wrote no index.html`);
}

rmSync(out, { recursive: true, force: true });
build(process.cwd(), 'main', out);

const tags = sortTags(execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').map((t) => t.trim()));
const work = mkdtempSync(join(tmpdir(), 'site-'));
try {
  for (const tag of tags) {
    const tree = join(work, tag);
    run('git', ['worktree', 'add', '--detach', tree, tag]);
    try {
      run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: tree });
      build(tree, tag, join(out, tag));
    } finally {
      run('git', ['worktree', 'remove', '--force', tree]);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

writeFileSync(join(out, VERSIONS_FILE), `${JSON.stringify(versionsManifest(tags), null, 2)}\n`);
console.log(`Site in ${out}: main${tags.map((t) => `, ${t}`).join('')}`);
