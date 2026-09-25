/**
 * Minimal ZIP archive writer. Every entry is stored without compression
 * (method 0) with its CRC-32; the archive holds the local file headers and
 * data, the central directory and the end of central directory record, and
 * no ZIP64 records, so every entry and the whole archive stay below 4 GiB
 * and the archive holds at most 65535 entries.
 *
 * Names are printable ASCII paths with '/' as separator; the UTF-8 flag
 * (general purpose bit 11) stays off. Text is encoded as UTF-8. The DOS
 * modification date and time of every entry come from the date option in
 * the local time zone of the caller, so the output depends only on the
 * input and two writes of one input are identical.
 * @module export/zip
 */

import { describeError } from '../core/errors.js';

/**
 * One archive entry: either text or bytes.
 * @typedef {object} ZipFile
 * @property {string} name path inside the archive, printable ASCII, no
 *   leading '/', no '\', no empty, '.' or '..' segment
 * @property {string} [text] contents, written as UTF-8
 * @property {Uint8Array} [bytes] contents
 */

/**
 * @typedef {object} ZipOptions
 * @property {Date} [date] modification time of every entry, 1980-01-01 to
 *   2107-12-31 in local time; 1980-01-01 00:00:00 when absent. Seconds are
 *   rounded down to an even number (DOS resolution 2 s).
 */

/** Largest value of a 16-bit field. */
const MAX_U16 = 0xffff;
/** Largest value of a 32-bit field. */
const MAX_U32 = 0xffffffff;
/** Printable ASCII. */
const PRINTABLE_ASCII = /^[ -~]+$/;
/** Version needed to extract a stored entry: 1.0. */
const VERSION_NEEDED = 10;
/** Version made by: 2.0, host MS-DOS. */
const VERSION_MADE_BY = 20;

/** CRC-32 lookup table of the reflected IEEE polynomial 0xEDB88320. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 (IEEE 802.3, as used by ZIP and PNG) of a byte array.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit value
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Writes a ZIP archive of stored entries. Never throws: malformed input, a
 * name that is not printable ASCII, a duplicate name, a date outside the DOS
 * range or an archive too large for the 32-bit fields gives
 * { bytes: null, error }.
 * @param {ZipFile[]} files
 * @param {ZipOptions} [options]
 * @returns {{ bytes: Uint8Array | null, error: string | null }}
 */
export function writeZip(files, options = {}) {
  try {
    return { bytes: writeZipChecked(files, options), error: null };
  } catch (err) {
    // Any exception while reading or validating malformed input.
    return { bytes: null, error: describeError(err) };
  }
}

/**
 * DOS time and date fields of a local date.
 * @param {Date | undefined} date
 * @returns {{ time: number, date: number }}
 */
export function dosDateTime(date) {
  if (date === undefined) return { time: 0, date: (1 << 5) | 1 };
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('ZIP: the date must be a valid Date');
  const year = date.getFullYear();
  if (year < 1980 || year > 2107) throw new Error(`ZIP: the year ${year} lies outside 1980 to 2107`);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Checks an entry name and returns its bytes.
 * @param {unknown} name
 * @returns {Uint8Array}
 */
function nameBytes(name) {
  if (typeof name !== 'string' || !PRINTABLE_ASCII.test(name)) {
    throw new Error(`ZIP: the name ${JSON.stringify(String(name))} is not printable ASCII`);
  }
  if (name.length > MAX_U16) throw new Error('ZIP: a name is longer than 65535 characters');
  if (name.startsWith('/') || name.includes('\\')) throw new Error(`ZIP: the name "${name}" must be a relative path with '/' separators`);
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`ZIP: the name "${name}" has an empty, '.' or '..' segment`);
  }
  const out = new Uint8Array(name.length);
  for (let i = 0; i < name.length; i++) out[i] = name.charCodeAt(i);
  return out;
}

/**
 * Contents of an entry.
 * @param {ZipFile} file
 * @returns {Uint8Array}
 */
function contentBytes(file) {
  const { text, bytes } = file;
  if (text !== undefined && bytes !== undefined) throw new Error(`ZIP: the entry "${file.name}" has both text and bytes`);
  if (typeof text === 'string') return new globalThis.TextEncoder().encode(text);
  if (bytes instanceof Uint8Array) return bytes;
  throw new Error(`ZIP: the entry "${file.name}" needs text (a string) or bytes (a Uint8Array)`);
}

/**
 * Body of {@link writeZip}, which guards it.
 * @param {ZipFile[]} files
 * @param {ZipOptions} options
 * @returns {Uint8Array}
 */
function writeZipChecked(files, options) {
  if (!Array.isArray(files)) throw new Error('ZIP: a list of files is expected');
  if (files.length > MAX_U16) throw new Error('ZIP: more than 65535 entries');
  if (options !== undefined && (options === null || typeof options !== 'object')) throw new Error('ZIP: the options must be an object');
  const stamp = dosDateTime(options?.date);

  const seen = new Set();
  const entries = files.map((file) => {
    if (file === null || typeof file !== 'object') throw new Error('ZIP: every entry must be an object');
    const name = nameBytes(file.name);
    if (seen.has(file.name)) throw new Error(`ZIP: the name "${file.name}" occurs twice`);
    seen.add(file.name);
    const data = contentBytes(file);
    if (data.length > MAX_U32) throw new Error(`ZIP: the entry "${file.name}" is larger than 4 GiB`);
    return { name, data, crc: crc32(data), offset: 0 };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    e.offset = localSize;
    localSize += 30 + e.name.length + e.data.length;
    centralSize += 46 + e.name.length;
  }
  if (localSize + centralSize > MAX_U32) throw new Error('ZIP: the archive is larger than 4 GiB');

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (/** @type {number} */ v) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (/** @type {number} */ v) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const raw = (/** @type {Uint8Array} */ b) => {
    out.set(b, p);
    p += b.length;
  };

  for (const e of entries) {
    u32(0x04034b50); // local file header signature
    u16(VERSION_NEEDED);
    u16(0); // general purpose flags: no UTF-8, no data descriptor
    u16(0); // method: stored
    u16(stamp.time);
    u16(stamp.date);
    u32(e.crc);
    u32(e.data.length); // compressed size
    u32(e.data.length); // uncompressed size
    u16(e.name.length);
    u16(0); // extra field length
    raw(e.name);
    raw(e.data);
  }
  for (const e of entries) {
    u32(0x02014b50); // central directory header signature
    u16(VERSION_MADE_BY);
    u16(VERSION_NEEDED);
    u16(0);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // extra field length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(e.offset);
    raw(e.name);
  }
  u32(0x06054b50); // end of central directory signature
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(localSize);
  u16(0); // comment length
  return out;
}
