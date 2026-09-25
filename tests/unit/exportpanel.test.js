import { describe, expect, it } from 'vitest';
import { exportKey, exportStatus } from '../../src/ui/exportpanel.js';

describe('export status', () => {
  it('says which cam the files come from', () => {
    const base = { hasCam: true, busy: false, pending: false, current: false, id: 'abc123' };
    expect(exportStatus({ ...base, hasCam: false, busy: true, id: '' })).toBe('Solving… exports are available once a cam meets every check');
    expect(exportStatus({ ...base, hasCam: false, id: '' })).toBe('No cam meets every check yet; exports need a full solve without problems');
    expect(exportStatus({ ...base, current: true })).toBe('Exports the current cam, design abc123');
    expect(exportStatus(base)).toBe('Exports the last cam that met every check, design abc123; later edits are not included');
  });

  it('keeps its text during a short solve and names the source during a long one', () => {
    const base = { hasCam: true, busy: true, pending: false, current: false, id: 'abc123' };
    expect(exportStatus(base)).toBeNull();
    expect(exportStatus({ ...base, pending: true })).toBe('Solving… exports use design abc123 until the new cam meets every check');
  });
});

describe('export cache key', () => {
  const units = /** @type {const} */ ({ draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' });
  const day = new Date(2026, 8, 25, 23, 59);

  it('changes with the draw and force units and the local day only', () => {
    const key = exportKey(units, day);
    expect(exportKey({ ...units, dims: 'in', energy: 'ft·lbf', stiffness: 'lbf/in' }, new Date(2026, 8, 25, 0, 1))).toBe(key);
    expect(exportKey({ ...units, draw: 'mm' }, day)).not.toBe(key);
    expect(exportKey({ ...units, force: 'lbf' }, day)).not.toBe(key);
    expect(exportKey(units, new Date(2026, 8, 26, 0, 0))).not.toBe(key);
  });
});
