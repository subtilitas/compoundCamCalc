import { describe, expect, it } from 'vitest';
import { PATTERN, findMatches, matchingLines } from '../../scripts/check-session-links.js';

const link = ['https://claude.ai/code/', 'session_0123'].join('');
const trailer = ['Claude-', 'Session: x'].join('');

describe('PATTERN', () => {
  it('matches session links and trailers', () => {
    expect(PATTERN.test(link)).toBe(true);
    expect(PATTERN.test(trailer)).toBe(true);
  });

  it('does not match the plain product link', () => {
    expect(PATTERN.test('https://claude.ai/code')).toBe(false);
    expect(PATTERN.test('https://claude.com/claude-code')).toBe(false);
  });
});

describe('matchingLines', () => {
  it('returns 1-based line numbers', () => {
    expect(matchingLines(`a\r\n${link}\nb\n${trailer}`)).toEqual([2, 4]);
  });
});

describe('findMatches', () => {
  /**
   * @param {Record<string, string>} files
   * @param {string[]} messages
   */
  function fakeGit(files, messages) {
    return (/** @type {string[]} */ args) => {
      if (args[0] === 'ls-files') return Object.keys(files).join('\0');
      return messages.map((m, i) => `${'abcdef'[i].repeat(40)}\0${m}\x01`).join('\n');
    };
  }

  it('reports files, lines and commits', () => {
    /** @type {Record<string, string>} */
    const files = { 'a.md': `ok\n${link}`, 'b.bin': 'x\0y', 'c.txt': 'clean' };
    const git = fakeGit(files, ['clean message', `subject\n\n${trailer}`]);
    const read = (/** @type {string} */ p) => {
      if (p === 'gone.txt') throw new Error('missing');
      return files[p];
    };
    expect(findMatches(git, read)).toEqual(['a.md:2', `commit ${'b'.repeat(12)}`]);
  });

  it('skips unreadable files', () => {
    const git = fakeGit({ 'gone.txt': '' }, ['clean']);
    expect(findMatches(git, () => { throw new Error('missing'); })).toEqual([]);
  });
});
