/**
 * Release channels of the hosted site. The development head of `main` is
 * served at the site root, each release tag `vMAJOR.MINOR.PATCH` in a folder
 * of that name. `versions.json` at the site root lists them. Pure functions:
 * the caller fetches the list and reads the page location.
 * @module state/channel
 */

/** Channel of the development head, served at the site root. */
export const MAIN_CHANNEL = 'main';
/** Name of the version list at the site root. */
export const VERSIONS_FILE = 'versions.json';
/** Prefix of every localStorage key of the main channel. */
export const STORAGE_BASE = 'compoundCamCalc';
/** Largest accepted version list, in characters. */
export const VERSIONS_MAX = 64 * 1024;

const TAG = /^v(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/**
 * @typedef {object} VersionEntry
 * @property {string} id 'main' or a release tag such as 'v0.1.0'
 * @property {string} path folder below the site root: '' for main, 'v0.1.0/' for a tag
 */

/**
 * True for a release tag vMAJOR.MINOR.PATCH without leading zeros.
 * @param {string} id
 */
export function isReleaseTag(id) {
  return TAG.test(id);
}

/**
 * True for 'main' or a release tag.
 * @param {unknown} id
 * @returns {id is string}
 */
export function isChannel(id) {
  return typeof id === 'string' && (id === MAIN_CHANNEL || isReleaseTag(id));
}

/**
 * Release tags newest first; other names are left out, duplicates once.
 * @param {readonly string[]} tags
 * @returns {string[]}
 */
export function sortTags(tags) {
  /** @param {string} t */
  const parts = (t) => /** @type {RegExpExecArray} */ (TAG.exec(t)).slice(1, 4).map(Number);
  return [...new Set(tags.filter(isReleaseTag))].sort((a, b) => {
    const pa = parts(a);
    const pb = parts(b);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
    return 0;
  });
}

/**
 * Version list for the site: main first, then the release tags newest first.
 * @param {readonly string[]} tags
 * @returns {{ versions: VersionEntry[] }}
 */
export function versionsManifest(tags) {
  return {
    versions: [{ id: MAIN_CHANNEL, path: '' }, ...sortTags(tags).map((id) => ({ id, path: `${id}/` }))],
  };
}

/**
 * Entries of a version list text, or null when the text is no valid list.
 * An entry must be main at '' or a release tag in its own folder.
 * @param {string} text
 * @returns {VersionEntry[] | null}
 */
export function parseVersions(text) {
  if (typeof text !== 'string' || text.length > VERSIONS_MAX) return null;
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || !Array.isArray(/** @type {{ versions?: unknown }} */ (data).versions)) return null;
  const list = /** @type {unknown[]} */ (/** @type {{ versions: unknown[] }} */ (data).versions);
  /** @type {VersionEntry[]} */
  const out = [];
  const seen = new Set();
  for (const e of list) {
    if (typeof e !== 'object' || e === null) return null;
    const { id, path } = /** @type {{ id?: unknown, path?: unknown }} */ (e);
    if (!isChannel(id) || seen.has(id)) return null;
    if (path !== (id === MAIN_CHANNEL ? '' : `${id}/`)) return null;
    seen.add(id);
    out.push({ id, path });
  }
  return out;
}

/**
 * Relative path from a page of this channel to the site root.
 * @param {string} channel
 */
export function siteRoot(channel) {
  return channel === MAIN_CHANNEL ? './' : '../';
}

/**
 * Prefix of the localStorage keys of a channel. A release keeps its own
 * autosave and named designs, so an older release never reads or replaces
 * data written by a newer schema; main keeps the keys it has always used.
 * @param {string} channel
 */
export function storagePrefix(channel) {
  return channel === MAIN_CHANNEL ? STORAGE_BASE : `${STORAGE_BASE}@${channel}`;
}

/**
 * Text of a version in the select: main names the app version it carries.
 * @param {string} id
 * @param {string} appVersion version of this build, used for main when it is the current channel
 * @param {string} channel channel of this build
 */
export function versionLabel(id, appVersion, channel) {
  if (id !== MAIN_CHANNEL) return id;
  return channel === MAIN_CHANNEL ? `main, newest (${appVersion})` : 'main, newest';
}
