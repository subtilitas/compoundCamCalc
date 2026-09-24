import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { END, START, main, renderBlock, replaceBlock } from '../../scripts/coverage-readme.js';

/** @param {number} pct */
const summary = (pct) => ({ total: { lines: { pct } } });

describe('renderBlock', () => {
  it('floors the line percentage', () => {
    expect(renderBlock(summary(97.99))).toContain('**97 %**');
    expect(renderBlock(summary(100))).toContain('**100 %**');
  });

  it('throws on a malformed summary', () => {
    expect(() => renderBlock(/** @type {any} */ ({}))).toThrow(/total.lines.pct/);
  });
});

describe('replaceBlock', () => {
  it('replaces only the marked block', () => {
    const readme = `a\n${START}\nold\n${END}\nb`;
    expect(replaceBlock(readme, 'new')).toBe(`a\n${START}\nnew\n${END}\nb`);
  });

  it('keeps CRLF line endings', () => {
    const readme = `a\r\n${START}\r\nold\r\n${END}\r\nb`;
    expect(replaceBlock(readme, 'new')).toBe(`a\r\n${START}\r\nnew\r\n${END}\r\nb`);
  });

  it('throws when markers are missing', () => {
    expect(() => replaceBlock('no markers', 'x')).toThrow(/must contain/);
  });
});

describe('main', () => {
  /**
   * @param {string} readmeText
   * @param {number} pct
   */
  function setup(readmeText, pct) {
    const dir = mkdtempSync(join(tmpdir(), 'cov-'));
    const paths = { readme: join(dir, 'README.md'), summary: join(dir, 'summary.json') };
    writeFileSync(paths.readme, readmeText);
    writeFileSync(paths.summary, JSON.stringify(summary(pct)));
    return paths;
  }

  it('writes, then checks clean', () => {
    const paths = setup(`${START}\n${END}\n`, 91.4);
    expect(main(['--write'], paths)).toBe(0);
    expect(readFileSync(paths.readme, 'utf8')).toContain('**91 %**');
    expect(main(['--check'], paths)).toBe(0);
  });

  it('check fails on drift', () => {
    const paths = setup(`${START}\nstale\n${END}\n`, 91.4);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--check'], paths)).toBe(1);
    err.mockRestore();
  });

  it('prints usage without a mode', () => {
    const paths = setup(`${START}\n${END}\n`, 50);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([], paths)).toBe(2);
    err.mockRestore();
  });
});
