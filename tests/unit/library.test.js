import { describe, expect, it } from 'vitest';
import {
  FILE_MAX, NAME_MAX, canonicalText, deleteDesign, emptyLibrary, fileNameOf, findByName, isDirty, listDesigns,
  nameOfFile, normalizeName, parseCurrent, parseLibrary, serializeCurrent, untitled, readProjectFile, renameDesign, saveDesign, serializeLibrary,
} from '../../src/state/library.js';
import { drawRange } from '../../src/core/curve.js';
import { defaultState } from '../../src/state/presets.js';
import { SAMPLES } from '../../src/state/samples.js';
import { toJSON } from '../../src/state/schema.js';

const t1 = new Date('2026-09-25T10:00:00Z');
const t2 = new Date('2026-09-25T11:00:00Z');

describe('design library', () => {
  it('reads nothing stored as an empty library and refuses unreadable text', () => {
    expect(parseLibrary(null)).toEqual({ library: emptyLibrary(), error: null });
    expect(parseLibrary('{').error).toMatch(/not valid JSON/);
    expect(parseLibrary('[]').error).toMatch(/no design list/);
    expect(parseLibrary('{"version":2,"designs":[]}').error).toMatch(/format version 2/);
    expect(parseLibrary('{"version":1,"designs":[null,{"id":1},{"id":"a","name":"A","state":{}}]}').library?.designs)
      .toEqual([{ id: 'a', name: 'A', savedAt: '', state: {} }]);
  });

  it('saves, renames, deletes and lists designs newest first', () => {
    let lib = emptyLibrary();
    const a = saveDesign(lib, { id: null, name: 'Target', state: defaultState(), now: t1 });
    lib = a.library;
    const b = saveDesign(lib, { id: null, name: 'Crossbow', state: SAMPLES[2].state(), now: t1 });
    expect(b.id).not.toBe(a.id);
    lib = b.library;
    lib = saveDesign(lib, { id: a.id, name: 'Target', state: SAMPLES[1].state(), now: t2 }).library;
    expect(lib.designs).toHaveLength(2);
    const round = parseLibrary(serializeLibrary(lib)).library;
    const list = listDesigns(/** @type {any} */ (round));
    expect(list.map((e) => e.name)).toEqual(['Target', 'Crossbow']);
    expect(list[0].savedAt).toBe(t2.toISOString());
    expect(list[0].state?.stringTrack.shape).toBe('ellipse');
    expect(list.every((e) => e.error === null)).toBe(true);
    lib = renameDesign(lib, b.id, 'Crossbow 2');
    expect(findByName(lib, '  crossbow   2 ')?.id).toBe(b.id);
    lib = deleteDesign(lib, a.id);
    expect(lib.designs.map((d) => d.id)).toEqual([b.id]);
  });

  it('lists a broken design with the reason it cannot be opened', () => {
    const bad = defaultState();
    bad.geometry.ata = 0.01;
    const lib = { version: 1, designs: [{ id: 'x', name: 'Bad', savedAt: '', state: bad }, { id: 'y', name: 'Old', savedAt: '', state: { schemaVersion: 9 } }] };
    const list = listDesigns(lib);
    expect(list.map((e) => [e.name, e.state, e.error !== null])).toEqual([['Bad', null, true], ['Old', null, true]]);
    expect(list.find((e) => e.id === 'x')?.error).toMatch(/Axle-to-axle length/);
  });

  it('normalises names and finds them ignoring case', () => {
    expect(normalizeName('  Bow \n  one ')).toEqual({ name: 'Bow one', error: null });
    expect(normalizeName('   ').error).toBe('Enter a name');
    expect(normalizeName('x'.repeat(NAME_MAX + 1)).error).toMatch(/at most 80/);
    expect(normalizeName('Cafe\u0301').name).toBe('Caf\u00e9');
    const lib = saveDesign(emptyLibrary(), { id: null, name: 'Café', state: defaultState(), now: t1 }).library;
    expect(findByName(lib, 'CAFE\u0301')).not.toBeNull();
    expect(findByName(lib, 'Other')).toBeNull();
  });

  it('makes file names safe and design names from file names', () => {
    expect(fileNameOf('Bow: 70/30 "hunting"')).toBe('Bow- 70-30 -hunting-.json');
    expect(fileNameOf('...')).toBe('design.json');
    expect(nameOfFile('C:\\bows\\My bow.JSON')).toBe('My bow');
    expect(nameOfFile('.json')).toBe('Design from file');
  });

  it('tells unsaved changes apart from a different key order', () => {
    const saved = defaultState();
    const edited = defaultState();
    edited.geometry.ata += 0.01;
    expect(isDirty(edited, saved)).toBe(true);
    edited.geometry.ata = saved.geometry.ata;
    expect(isDirty(edited, saved)).toBe(false);
    // Reordered keys, as a hand-edited file may have them.
    const reordered = JSON.parse(toJSON(saved));
    reordered.geometry = Object.fromEntries(Object.entries(reordered.geometry).reverse());
    reordered.limb.table = [{ force: 10, travel: 0 }];
    const tabled = { ...saved, limb: { ...saved.limb, table: [{ travel: 0, force: 10 }] } };
    expect(canonicalText(reordered)).toBe(canonicalText(tabled));
    // Display units do not count as a change.
    expect(isDirty({ ...saved, units: { ...saved.units, force: 'lbf' } }, saved)).toBe(false);
    // Without a saved copy the default design counts as unchanged.
    expect(isDirty(defaultState(), null)).toBe(false);
    expect(isDirty(SAMPLES[3].state(), null)).toBe(true);
  });

  it('reads project files and refuses the ones it cannot use', () => {
    const text = toJSON(SAMPLES[3].state());
    expect(readProjectFile(text, text.length)).toEqual({ state: SAMPLES[3].state(), error: null, filled: false });
    expect(readProjectFile('', 0).error).toBe('The file is empty');
    expect(readProjectFile('', FILE_MAX + 1).error).toBe('The file is larger than 1 MB');
    expect(readProjectFile('0\r\nSECTION', 9).error).toMatch(/not valid JSON/);
    expect(readProjectFile('{"schemaVersion":9}', 19).error).toMatch(/newer version/);
    const partial = readProjectFile('{"schemaVersion":1}', 19);
    expect(partial).toEqual({ state: defaultState(), error: null, filled: true });
    // Omitted points follow the file's geometry and parameters, not the default bow.
    const brace = readProjectFile('{"schemaVersion":1,"geometry":{"braceHeight":0.2}}', 50);
    expect(brace.error).toBeNull();
    expect(brace.state?.curve.points[0].x).toBeCloseTo(drawRange(0.2, defaultState().geometry.drawLength).xBrace, 12);
    const peak = readProjectFile('{"schemaVersion":1,"curve":{"params":{"peak":200}}}', 50);
    expect(peak.error).toBeNull();
    expect(Math.max(...(peak.state?.curve.points ?? []).map((p) => p.F))).toBeCloseTo(200, 9);
    // Extra fields are dropped and do not count as missing values.
    const extra = JSON.parse(toJSON(defaultState()));
    extra.comment = 'x';
    extra.curve.points[0].note = 'y';
    expect(readProjectFile(JSON.stringify(extra), 100).filled).toBe(false);
    // A missing field is found although an extra one keeps the key count.
    const swapped = JSON.parse(toJSON(defaultState()));
    delete swapped.body.flangeThickness;
    swapped.body.note = 'z';
    expect(readProjectFile(JSON.stringify(swapped), 100).filled).toBe(true);
  });

  it('stores the current design and falls back to Untitled', () => {
    const c = /** @type {const} */ ({ id: null, name: 'Mini', source: 'unsaved', baseline: SAMPLES[3].state() });
    expect(parseCurrent(serializeCurrent(c))).toEqual(c);
    const saved = /** @type {const} */ ({ id: 'd1', name: 'Bow', source: 'saved', baseline: null });
    expect(parseCurrent(serializeCurrent(saved))).toEqual(saved);
    for (const bad of [null, '{', '[]', '{"name":"x","source":"odd"}', '{"name":"x","source":"saved"}']) expect(parseCurrent(bad)).toEqual(untitled());
    expect(parseCurrent('{"name":"x","source":"unsaved","baseline":{"schemaVersion":9}}').baseline).toBeNull();
  });
});
