/**
 * Share link codec: a design (inputs and name) as text for the fragment
 * of a link, '#design=' followed by this text. The text is SHARE_VERSION
 * and base64url (RFC 4648, section 5) of the UTF-8 bytes of the JSON
 * `{ name, state }`, without compression. Pure functions; never throws.
 * @module state/share
 */

import { FILE_MAX, NAME_MAX, normalizeName, readProjectText } from './library.js';
import { NEWER_HINT, SCHEMA_VERSION } from './schema.js';

/** @typedef {import('./schema.js').ProjectState} ProjectState */

/** Prefix of the link text: format version 1. */
export const SHARE_VERSION = 'v1.';
/** Longest link text accepted, in characters (64 KB). */
export const SHARE_MAX = 64 * 1024;
/** Largest decoded link data accepted, in bytes (1 MB). */
export const SHARE_BYTES_MAX = FILE_MAX;
/** Name of a shared design without a usable name. */
export const SHARED_NAME = 'Shared design';

/** Message for a link that was cut off or changed on the way. */
export const LINK_DAMAGED = 'The link is incomplete or damaged, often because a chat app shortened it. Ask for the whole link, or for a project file.';
/** Message for a link from a newer version of the app. */
export const LINK_NEWER = `The link was made with a newer version of the app. ${NEWER_HINT}`;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Value of each character code below 128, or -1. */
const VALUE = (() => {
  const v = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) v[ALPHABET.charCodeAt(i)] = i;
  return v;
})();
/** Bytes per chunk of the encoder: a multiple of 3, so only the last chunk is partial. */
const CHUNK = 3 * 4096;

/**
 * Base64url text of bytes, without padding.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64url(bytes) {
  /** @type {string[]} */
  const parts = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    /** @type {string[]} */
    const out = [];
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], ALPHABET[n & 63]);
    }
    if (end - i === 1) {
      const n = bytes[i] << 16;
      out.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63]);
    } else if (end - i === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63]);
    }
    parts.push(out.join(''));
  }
  return parts.join('');
}

/**
 * Bytes of base64url text, or null for text that is not base64url: a
 * character outside A to Z, a to z, 0 to 9, '-' and '_', padding anywhere
 * but at the end or of the wrong length, a length that leaves one
 * character over, or bits left over that are not zero.
 * @param {string} text
 * @returns {Uint8Array | null}
 */
export function fromBase64url(text) {
  let len = text.length;
  if (text.endsWith('==')) len -= 2;
  else if (text.endsWith('=')) len -= 1;
  // Padding fills the text to a multiple of 4 characters.
  if (len !== text.length && text.length % 4 !== 0) return null;
  const rest = len % 4;
  if (rest === 1) return null;
  const out = new Uint8Array(Math.floor(len / 4) * 3 + (rest === 0 ? 0 : rest - 1));
  /** @param {number} i */
  const value = (i) => {
    const c = text.charCodeAt(i);
    return c < 128 ? VALUE[c] : -1;
  };
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const a = value(i);
    const b = value(i + 1);
    const c = value(i + 2);
    const d = value(i + 3);
    if ((a | b | c | d) < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  if (rest > 0) {
    const a = value(i);
    const b = value(i + 1);
    const c = rest === 3 ? value(i + 2) : 0;
    if ((a | b | c) < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6);
    // The unused low bits of the last character are zero in every encoder output.
    if (rest === 2 ? (n & 0xffff) !== 0 : (n & 0xff) !== 0) return null;
    out[o] = n >> 16;
    if (rest === 3) out[o + 1] = (n >> 8) & 255;
  }
  return out;
}

/**
 * Link text of a design.
 * @param {ProjectState} state
 * @param {string} name
 * @returns {string}
 */
export function encodeShare(state, name) {
  const bytes = new globalThis.TextEncoder().encode(JSON.stringify({ name, state }));
  return SHARE_VERSION + toBase64url(bytes);
}

/**
 * Design name from a link: cut to NAME_MAX characters and normalised;
 * SHARED_NAME for a missing, empty or invalid name.
 * @param {unknown} name
 * @returns {string}
 */
export function shareName(name) {
  if (typeof name !== 'string') return SHARED_NAME;
  let cut = name.slice(0, NAME_MAX);
  // A cut between the two halves of a surrogate pair drops the first half.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const n = normalizeName(cut);
  return n.error ? SHARED_NAME : n.name;
}

/**
 * Read link text: state, name, the reason it cannot be used, whether
 * fields took default values and which settings of the link the schema
 * does not know.
 * @param {string} text the fragment after '#design='
 * @returns {{ state: ProjectState | null, name: string, error: string | null, filled: boolean, dropped: string[] }}
 */
export function decodeShare(text) {
  /** @param {string} error */
  const fail = (error) => ({ state: null, name: SHARED_NAME, error, filled: false, dropped: [] });
  if (typeof text !== 'string' || text.length === 0) return fail(LINK_DAMAGED);
  if (text.length > SHARE_MAX) return fail(`The link is longer than ${SHARE_MAX.toLocaleString('en-US')} characters. Ask for a project file instead.`);
  if (!text.startsWith(SHARE_VERSION)) {
    // A later format version: the app that made the link is newer.
    const v = /^v(\d{1,6})\./.exec(text);
    return fail(v && Number(v[1]) > 1 ? LINK_NEWER : LINK_DAMAGED);
  }
  const bytes = fromBase64url(text.slice(SHARE_VERSION.length));
  if (!bytes || bytes.length === 0) return fail(LINK_DAMAGED);
  if (bytes.length > SHARE_BYTES_MAX) return fail(`The link holds more than ${SHARE_BYTES_MAX / 1024 / 1024} MB of data. Ask for a project file instead.`);
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    // Invalid UTF-8 or JSON: a cut link ends in the middle of either.
    return fail(LINK_DAMAGED);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.state || typeof data.state !== 'object') return fail(LINK_DAMAGED);
  const version = data.state.schemaVersion;
  if (typeof version === 'number' && version > SCHEMA_VERSION) return fail(LINK_NEWER);
  /** @type {ReturnType<typeof readProjectText>} */
  let r;
  try {
    // Serialising deeply nested data overflows the stack; such a link was
    // not made by the app.
    r = readProjectText(JSON.stringify(data.state), bytes.length, 'link');
  } catch {
    return fail(LINK_DAMAGED);
  }
  if (!r.state) return fail(r.error ?? LINK_DAMAGED);
  return { state: r.state, name: shareName(data.name), error: null, filled: r.filled, dropped: r.dropped };
}
