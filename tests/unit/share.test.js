import { describe, expect, it } from 'vitest';
import { NAME_MAX, readProjectText } from '../../src/state/library.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES, sampleState } from '../../src/state/samples.js';
import {
  LINK_DAMAGED, LINK_NEWER, SHARED_NAME, SHARE_MAX, SHARE_VERSION, decodeShare, encodeShare, fromBase64url, shareName, toBase64url,
} from '../../src/state/share.js';

/**
 * Link text of any JSON value.
 * @param {unknown} data
 */
const linkOf = (data) => SHARE_VERSION + Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');

/**
 * State without its display units.
 * @param {any} state
 */
const inputs = (state) => ({ ...state, units: null });

describe('base64url', () => {
  it('matches the Node.js encoder for every length up to 300 bytes and across chunks', () => {
    for (const n of [...Array.from({ length: 301 }, (_, i) => i), 3 * 4096 - 1, 3 * 4096, 3 * 4096 + 1, 40_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 131 + n * 7) & 255);
      const text = toBase64url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64url'));
      expect(fromBase64url(text)).toEqual(bytes);
    }
  });

  it('accepts padding and rejects any illegal character or length', () => {
    expect(fromBase64url('_-8')).toEqual(Uint8Array.from([255, 239]));
    expect(fromBase64url('_-8=')).toEqual(Uint8Array.from([255, 239]));
    expect(fromBase64url('_w==')).toEqual(Uint8Array.from([255]));
    expect(fromBase64url('_w')).toEqual(Uint8Array.from([255]));
    expect(fromBase64url('')).toEqual(new Uint8Array(0));
    for (const bad of ['+w==', '/w', 'ab c', 'a=bc', '_w=', '_w===', 'abcde', 'a', '_x', '_-9', 'abéc', 'ab\u{1F600}', 'ab.c']) {
      expect(fromBase64url(bad), bad).toBeNull();
    }
  });
});

describe('share link', () => {
  it('round-trips every sample and the default design with its name', () => {
    for (const s of [defaultState(), ...SAMPLES.map((x) => x.state())]) {
      const state = { ...s, units: { ...s.units, force: /** @type {const} */ ('lbf') } };
      const text = encodeShare(state, 'Bow "A" <1>');
      expect(text.startsWith('v1.')).toBe(true);
      expect(text).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
      const r = decodeShare(text);
      expect(r.error).toBeNull();
      expect(r.filled).toBe(false);
      expect(r.name).toBe('Bow "A" <1>');
      expect(inputs(r.state)).toEqual(inputs(s));
    }
    // The default design fits a link of about 1.5 KB.
    expect(encodeShare(defaultState(), 'Untitled').length).toBeLessThan(2500);
  });

  it('rejects links cut at 50 %, 90 % and one character short', () => {
    const text = encodeShare(sampleState('hunting'), 'Hunting');
    for (const len of [Math.floor(text.length * 0.5), Math.floor(text.length * 0.9), text.length - 1]) {
      const r = decodeShare(text.slice(0, len));
      expect(r.state, `length ${len}`).toBeNull();
      expect(r.error).toBe(LINK_DAMAGED);
      expect(r.name).toBe(SHARED_NAME);
    }
  });

  it('rejects damaged, empty and wrong-prefix links with the plain message', () => {
    const text = encodeShare(defaultState(), 'Bow');
    for (const bad of [
      '', 'v1.', 'v1', 'x1.' + text.slice(3), 'V1.' + text.slice(3), text.slice(3), 'v1.' + text.slice(3).replace(/.$/, '+'), `${text})`,
      SHARE_VERSION + Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url'),
      linkOf([1]), linkOf(null), linkOf('text'), linkOf({ name: 'no state' }), linkOf({ name: 'x', state: 3 }),
    ]) {
      expect(decodeShare(bad).error, bad).toBe(LINK_DAMAGED);
    }
  });

  it('names a newer app for a newer schema or link format', () => {
    expect(decodeShare(linkOf({ name: 'x', state: { schemaVersion: 9 } })).error).toBe(LINK_NEWER);
    expect(decodeShare('v2.' + encodeShare(defaultState(), 'x').slice(3)).error).toBe(LINK_NEWER);
  });

  it('rejects an oversized link before decoding', () => {
    const r = decodeShare(SHARE_VERSION + 'A'.repeat(SHARE_MAX));
    expect(r.error).toBe('The link is longer than 65,536 characters. Ask for a project file instead.');
    expect(readProjectText('{}', 1024 * 1024 + 1, 'link').error).toBe('The link is larger than 1 MB');
    expect(readProjectText('', 0, 'link').error).toBe('The link is empty');
  });

  it('rejects deeply nested data without throwing', () => {
    const deep = `{"state":{"a":${'['.repeat(20000)}${']'.repeat(20000)}}}`;
    const text = SHARE_VERSION + Buffer.from(deep, 'utf8').toString('base64url');
    expect(text.length).toBeLessThan(SHARE_MAX);
    expect(decodeShare(text).error).toBe(LINK_DAMAGED);
  });

  it('reports invalid inputs and fields that took default values', () => {
    const bad = defaultState();
    bad.geometry.ata = 0.01;
    expect(decodeShare(encodeShare(bad, 'Bad')).error).toMatch(/Axle-to-axle length/);
    const partial = decodeShare(linkOf({ name: 'Part', state: { schemaVersion: 1 } }));
    expect(partial).toEqual({ state: defaultState(), name: 'Part', error: null, filled: true });
  });

  it('cuts, normalises and replaces names', () => {
    expect(shareName('  Bow \n  one ')).toBe('Bow one');
    expect(shareName('x'.repeat(200))).toBe('x'.repeat(NAME_MAX));
    // A cut never leaves half a surrogate pair.
    expect(shareName(`${'x'.repeat(NAME_MAX - 1)}\u{1F3F9}`)).toBe('x'.repeat(NAME_MAX - 1));
    for (const empty of ['', '   ', 42, null, undefined, { a: 1 }]) expect(shareName(empty)).toBe(SHARED_NAME);
    const markup = '<img src=x onerror=alert(1)>';
    expect(decodeShare(encodeShare(defaultState(), markup)).name).toBe(markup);
    expect(decodeShare(linkOf({ state: defaultState() })).name).toBe(SHARED_NAME);
    // Bidirectional overrides and zero-width characters do not reach the prompt.
    expect(shareName('x\u202Eabc\u200Bd\u2066e')).toBe('x abc d e');
    expect(shareName('\u202E\u200B')).toBe(SHARED_NAME);
  });
});
