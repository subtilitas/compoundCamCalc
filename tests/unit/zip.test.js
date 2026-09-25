import { describe, expect, it } from 'vitest';
import { crc32, dosDateTime, writeZip } from '../../src/export/zip.js';

const ascii = (/** @type {string} */ s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const DATE = new Date(2026, 8, 25, 13, 45, 31);

/**
 * Reads a ZIP archive of stored entries back: end of central directory,
 * central directory and local headers, which must agree.
 * @param {Uint8Array} bytes
 */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  expect(view.getUint16(eocd + 8, true)).toBe(count);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  expect(cdOffset + cdSize).toBe(eocd);
  const text = (/** @type {number} */ at, /** @type {number} */ n) => String.fromCharCode(...bytes.subarray(at, at + n));
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const time = view.getUint16(p + 12, true);
    const date = view.getUint16(p + 14, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    expect(view.getUint32(p + 24, true)).toBe(size);
    const nameLength = view.getUint16(p + 28, true);
    const offset = view.getUint32(p + 42, true);
    const name = text(p + 46, nameLength);
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);

    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 6, true)).toBe(flags);
    expect(view.getUint16(offset + 8, true)).toBe(method);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    expect(view.getUint32(offset + 22, true)).toBe(size);
    const localNameLength = view.getUint16(offset + 26, true);
    expect(text(offset + 30, localNameLength)).toBe(name);
    const start = offset + 30 + localNameLength + view.getUint16(offset + 28, true);
    const data = bytes.slice(start, start + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, flags, method, time, date, data });
  }
  expect(p).toBe(eocd);
  return entries;
}

describe('crc32', () => {
  it('matches the check value of CRC-32/ISO-HDLC', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('writeZip', () => {
  const files = [
    { name: 'cam.csv', text: 'a,b\r\n1,2\r\n' },
    { name: 'drawings/cam.dxf', text: 'Grad ° µ' },
    { name: 'data.bin', bytes: Uint8Array.from([0, 255, 128, 7]) },
    { name: 'empty.txt', text: '' },
  ];

  it('reads back with names, contents and stored entries', () => {
    const r = writeZip(files, { date: DATE });
    expect(r.error).toBeNull();
    const entries = readZip(/** @type {Uint8Array} */ (r.bytes));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    const dec = new TextDecoder();
    expect(dec.decode(entries[0].data)).toBe('a,b\r\n1,2\r\n');
    expect(dec.decode(entries[1].data)).toBe('Grad ° µ');
    expect(entries[1].data.length).toBe(10);
    expect([...entries[2].data]).toEqual([0, 255, 128, 7]);
    expect(entries[3].data.length).toBe(0);
    for (const e of entries) {
      expect(e.method).toBe(0);
      expect(e.flags).toBe(0);
      expect(e.time).toBe((13 << 11) | (45 << 5) | 15);
      expect(e.date).toBe((46 << 9) | (9 << 5) | 25);
    }
  });

  it('writes identical bytes twice', () => {
    const a = writeZip(files, { date: DATE }).bytes;
    const b = writeZip(files, { date: new Date(DATE.getTime()) }).bytes;
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('writes an empty archive and uses 1980-01-01 without a date', () => {
    const r = writeZip([]);
    expect(r.bytes?.length).toBe(22);
    expect(readZip(/** @type {Uint8Array} */ (r.bytes))).toEqual([]);
    const one = readZip(/** @type {Uint8Array} */ (writeZip([{ name: 'a', text: 'x' }]).bytes));
    expect(one[0].time).toBe(0);
    expect(one[0].date).toBe(33);
    expect(dosDateTime(new Date(1980, 0, 1, 0, 0, 0))).toEqual({ time: 0, date: 33 });
  });

  it('rejects malformed input with an error', () => {
    /** @type {any[]} */
    const bad = [
      [null],
      ['x'],
      [[null]],
      [[{ name: 'ä.txt', text: 'x' }]],
      [[{ name: '', text: 'x' }]],
      [[{ name: 'a\nb', text: 'x' }]],
      [[{ name: 7, text: 'x' }]],
      [[{ name: '/abs', text: 'x' }]],
      [[{ name: 'a\\b', text: 'x' }]],
      [[{ name: 'a/../b', text: 'x' }]],
      [[{ name: 'a//b', text: 'x' }]],
      [[{ name: 'x'.repeat(65536), text: 'x' }]],
      [[{ name: 'a', text: 'x' }, { name: 'a', text: 'y' }]],
      [[{ name: 'a' }]],
      [[{ name: 'a', text: 5 }]],
      [[{ name: 'a', bytes: [1, 2] }]],
      [[{ name: 'a', text: 'x', bytes: new Uint8Array(1) }]],
      [[], null],
      [[], 5],
      [[], { date: 'today' }],
      [[], { date: new Date(NaN) }],
      [[], { date: new Date(1979, 11, 31) }],
      [[], { date: new Date(2108, 0, 1) }],
      [new Array(65536).fill({ name: 'a', text: '' })],
    ];
    for (const args of bad) {
      /** @type {any} */
      const r = /** @type {any} */ (writeZip)(...args);
      expect(r.bytes).toBeNull();
      expect(typeof r.error).toBe('string');
    }
    expect(writeZip([{ name: 'ä', text: '' }]).error).toMatch(/printable ASCII/);
    expect(writeZip([{ name: 'dir/', text: '' }]).error).toBeNull();
  });
});
