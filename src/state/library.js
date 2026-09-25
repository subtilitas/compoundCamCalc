/**
 * Library of named designs, kept as JSON text (the browser stores it in
 * localStorage). Pure functions: the caller reads and writes the text.
 * Never throws on stored data.
 * @module state/library
 */

import { defaultState } from './presets.js';
import { fromJSON, migrate, toJSON, validate } from './schema.js';

/** @typedef {import('./schema.js').ProjectState} ProjectState */

/** Format version of the library text. */
export const LIBRARY_VERSION = 1;
/** Longest design name, in characters. */
export const NAME_MAX = 80;
/** Largest project file accepted by Open from file, in bytes. */
export const FILE_MAX = 1024 * 1024;

/**
 * @typedef {object} Design
 * @property {string} id
 * @property {string} name
 * @property {string} savedAt ISO 8601
 * @property {unknown} state as stored
 */

/**
 * @typedef {object} Entry a design as listed
 * @property {string} id
 * @property {string} name
 * @property {string} savedAt
 * @property {ProjectState | null} state migrated and valid, or null
 * @property {string | null} error why the design cannot be opened
 */

/**
 * @typedef {object} Library
 * @property {number} version
 * @property {Design[]} designs
 */

/** @returns {Library} */
export function emptyLibrary() {
  return { version: LIBRARY_VERSION, designs: [] };
}

/**
 * Parse stored library text. Null (nothing stored) gives an empty library.
 * Unreadable text gives an error and no library: the caller keeps the text.
 * @param {string | null} text
 * @returns {{ library: Library | null, error: string | null }}
 */
export function parseLibrary(text) {
  if (text === null) return { library: emptyLibrary(), error: null };
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { library: null, error: 'The saved designs are not valid JSON' };
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.designs)) {
    return { library: null, error: 'The saved designs have no design list' };
  }
  if (data.version !== LIBRARY_VERSION) {
    return { library: null, error: `The saved designs have format version ${JSON.stringify(data.version)}; this version reads ${LIBRARY_VERSION}` };
  }
  /** @type {Design[]} */
  const designs = [];
  for (const d of data.designs) {
    // Entries without an id or name cannot be listed or deleted; skip them.
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string') continue;
    designs.push({ id: d.id, name: d.name, savedAt: typeof d.savedAt === 'string' ? d.savedAt : '', state: d.state });
  }
  return { library: { version: LIBRARY_VERSION, designs }, error: null };
}

/**
 * @param {Library} library
 * @returns {string}
 */
export function serializeLibrary(library) {
  return JSON.stringify(library);
}

/**
 * Migrate and validate a stored state.
 * @param {unknown} stored
 * @returns {{ state: ProjectState | null, error: string | null }}
 */
function readState(stored) {
  const migrated = migrate(stored);
  if (!migrated.state) return { state: null, error: migrated.errors[0]?.message ?? 'The design cannot be read' };
  const errors = validate(migrated.state);
  if (errors.length > 0) return { state: null, error: errors[0].message };
  return { state: migrated.state, error: null };
}

/**
 * Designs as listed, newest first.
 * @param {Library} library
 * @returns {Entry[]}
 */
export function listDesigns(library) {
  return library.designs
    .map((d) => ({ id: d.id, name: d.name, savedAt: d.savedAt, ...readState(d.state) }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.name.localeCompare(b.name)));
}

/**
 * Normalised design name: trimmed, inner white space as one space, NFC.
 * @param {string} name
 * @returns {{ name: string, error: string | null }}
 */
export function normalizeName(name) {
  const n = String(name).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (n.length === 0) return { name: n, error: 'Enter a name' };
  if (n.length > NAME_MAX) return { name: n, error: `A name has at most ${NAME_MAX} characters` };
  return { name: n, error: null };
}

/**
 * @param {string} name
 */
function nameKey(name) {
  return normalizeName(name).name.toLocaleLowerCase('en');
}

/**
 * Design with this name, ignoring case, or null.
 * @param {Library} library
 * @param {string} name
 * @returns {Design | null}
 */
export function findByName(library, name) {
  const key = nameKey(name);
  return library.designs.find((d) => nameKey(d.name) === key) ?? null;
}

/**
 * Id of a new design.
 * @param {Library} library
 * @param {Date} now
 */
function newId(library, now) {
  const base = `d${now.getTime().toString(36)}`;
  let id = base;
  for (let i = 2; library.designs.some((d) => d.id === id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * Save a state under an id (replacing that design) or as a new design.
 * The name must be normalised and must not belong to another design.
 * @param {Library} library
 * @param {{ id: string | null, name: string, state: ProjectState, now: Date }} design
 * @returns {{ library: Library, id: string }}
 */
export function saveDesign(library, { id, name, state, now }) {
  const savedAt = now.toISOString();
  const existing = id === null ? undefined : library.designs.find((d) => d.id === id);
  if (existing) {
    const designs = library.designs.map((d) => (d.id === id ? { id: d.id, name, savedAt, state } : d));
    return { library: { ...library, designs }, id: existing.id };
  }
  const nid = newId(library, now);
  return { library: { ...library, designs: [...library.designs, { id: nid, name, savedAt, state }] }, id: nid };
}

/**
 * @param {Library} library
 * @param {string} id
 * @param {string} name normalised, not used by another design
 * @returns {Library}
 */
export function renameDesign(library, id, name) {
  return { ...library, designs: library.designs.map((d) => (d.id === id ? { ...d, name } : d)) };
}

/**
 * @param {Library} library
 * @param {string} id
 * @returns {Library}
 */
export function deleteDesign(library, id) {
  return { ...library, designs: library.designs.filter((d) => d.id !== id) };
}

/**
 * JSON text of a state in the form a reload produces: migrated, so the key
 * order is that of the default state.
 * @param {ProjectState} state
 */
export function canonicalText(state) {
  const migrated = migrate(JSON.parse(toJSON(state)));
  return toJSON(migrated.state ?? state);
}

/**
 * Whether the inputs differ from the saved copy; without one, from the
 * default design. Display units are a preference, not an input: they do
 * not count.
 * @param {ProjectState} state
 * @param {ProjectState | null} saved
 */
export function isDirty(state, saved) {
  const other = saved ?? defaultState();
  return canonicalText(state) !== canonicalText({ ...other, units: state.units });
}

/**
 * File name for a design: characters that file systems refuse become '-'.
 * @param {string} name
 */
export function fileNameOf(name) {
  // eslint-disable-next-line no-control-regex
  const base = normalizeName(name).name.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '-').replace(/^\.+/, '').trim();
  return `${base || 'design'}.json`;
}

/**
 * Design name from a file name: without the directory and the .json ending.
 * @param {string} fileName
 */
export function nameOfFile(fileName) {
  const base = String(fileName).split(/[/\\]/).pop() ?? '';
  const n = normalizeName(base.replace(/\.json$/i, ''));
  return n.error ? 'Design from file' : n.name;
}

/**
 * Read a project file. Refuses empty and oversized files and text that is
 * not a valid project; reports fields that took default values.
 * @param {string} text
 * @param {number} bytes file size
 * @returns {{ state: ProjectState | null, error: string | null, filled: boolean }}
 */
export function readProjectFile(text, bytes) {
  if (bytes > FILE_MAX) return { state: null, error: `The file is larger than ${FILE_MAX / 1024 / 1024} MB`, filled: false };
  if (bytes === 0 || text.trim() === '') return { state: null, error: 'The file is empty', filled: false };
  const { state, errors } = fromJSON(text);
  if (errors.length > 0) return { state: null, error: errors[0].message, filled: false };
  // A field of the state the file lacks took its default value; extra
  // fields of the file are dropped and do not count.
  const data = JSON.parse(text);
  return { state, error: null, filled: missingPath(state, data) };
}

/**
 * Whether a key path of the state, array items included, is missing from
 * the data.
 * @param {unknown} state
 * @param {unknown} data
 * @returns {boolean}
 */
function missingPath(state, data) {
  if (Array.isArray(state)) return !Array.isArray(data) || data.length < state.length || state.some((x, i) => missingPath(x, data[i]));
  if (state && typeof state === 'object') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return true;
    const d = /** @type {Record<string, unknown>} */ (data);
    return Object.entries(state).some(([k, v]) => !(k in d) || missingPath(v, d[k]));
  }
  return data === undefined;
}

/**
 * @typedef {object} Current the design the working copy belongs to
 * @property {string | null} id saved design, or null
 * @property {string} name
 * @property {'new' | 'saved' | 'unsaved'} source new: the default without
 *   a name; saved: a design in the library; unsaved: opened from a file or
 *   a sample, or deleted from the library
 * @property {ProjectState | null} baseline state the unsaved-changes marker
 *   compares with, for an unsaved design (a saved one compares with the
 *   library)
 * @property {boolean} [orphan] the saved copy was deleted: the inputs exist
 *   nowhere else, so replacing them always asks first
 */

/** @returns {Current} */
export function untitled() {
  return { id: null, name: 'Untitled', source: 'new', baseline: null };
}

/**
 * Parse the stored current design; anything unreadable gives Untitled.
 * @param {string | null} text
 * @returns {Current}
 */
export function parseCurrent(text) {
  if (text === null) return untitled();
  /** @type {any} */
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return untitled();
  }
  if (!d || typeof d !== 'object' || typeof d.name !== 'string' || !['new', 'saved', 'unsaved'].includes(d.source)) return untitled();
  const id = d.source === 'saved' && typeof d.id === 'string' ? d.id : null;
  if (d.source === 'saved' && id === null) return untitled();
  const baseline = d.baseline === null || d.baseline === undefined ? null : readState(d.baseline).state;
  /** @type {Current} */
  const out = { id, name: normalizeName(d.name).name || 'Untitled', source: d.source, baseline };
  if (d.orphan === true && d.source === 'unsaved') out.orphan = true;
  return out;
}

/**
 * @param {Current} current
 * @returns {string}
 */
export function serializeCurrent(current) {
  return JSON.stringify(current);
}
