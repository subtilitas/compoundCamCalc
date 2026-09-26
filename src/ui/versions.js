/**
 * Version select in the header: switches between the newest main build at
 * the site root and the release builds in their folders. The list comes
 * from versions.json at the site root; without it (local development, a
 * site without releases) the select stays hidden. Switching carries the
 * current design along as a share link, since every release keeps its own
 * browser storage.
 * @module ui/versions
 */

import { MAIN_CHANNEL, VERSIONS_FILE, parseVersions, siteRoot, versionLabel } from '../state/channel.js';
import { h } from './dom.js';

/** @typedef {import('../state/channel.js').VersionEntry} VersionEntry */

/**
 * Address of a version, relative to the page of this channel, with the
 * design fragment appended when one is given.
 * @param {string} channel channel of this page
 * @param {VersionEntry} entry version to open
 * @param {string | null} fragment `#design=…` text, or null
 */
export function versionHref(channel, entry, fragment) {
  return `${siteRoot(channel)}${entry.path}${fragment ?? ''}`;
}

/**
 * @typedef {object} VersionSelectOptions
 * @property {string} channel channel of this build
 * @property {string} version app version of this build
 * @property {() => string | null} fragment `#design=…` text of the current design, or null
 * @property {(href: string) => void} [navigate] opens the address; the default assigns location
 * @property {(url: string) => Promise<string | null>} [load] text of the version list, or null
 */

/**
 * Text of a file, or null when it cannot be fetched.
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function fetchText(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/**
 * Version select. The element is empty until the list has loaded, and stays
 * hidden when the list is missing, invalid, holds only one version or does
 * not name this build.
 * @param {VersionSelectOptions} options
 * @returns {{ element: HTMLElement, ready: Promise<boolean> }}
 */
export function createVersionSelect(options) {
  const element = h('div', { class: 'version-area', 'data-testid': 'version-area', hidden: true });
  const load = options.load ?? fetchText;
  const navigate = options.navigate ?? ((href) => location.assign(href));
  const ready = load(`${siteRoot(options.channel)}${VERSIONS_FILE}`).then((text) => {
    const list = text === null ? null : parseVersions(text);
    if (!list || list.length < 2 || !list.some((e) => e.id === options.channel)) return false;
    const select = h('select', { id: 'version-select', 'data-testid': 'version-select' });
    for (const e of list) {
      const opt = h('option', { value: e.id }, versionLabel(e.id, options.version, options.channel));
      opt.selected = e.id === options.channel;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      const entry = list.find((e) => e.id === select.value);
      if (!entry || entry.id === options.channel) return;
      navigate(versionHref(options.channel, entry, options.fragment()));
    });
    const note = options.channel === MAIN_CHANNEL
      ? 'Releases keep their own saved designs; the open design goes along.'
      : 'This release keeps its own saved designs; the open design goes along.';
    element.append(
      h('label', { for: 'version-select' }, 'Version'),
      select,
      h('span', { class: 'hint version-note', id: 'version-note' }, note),
    );
    select.setAttribute('aria-describedby', 'version-note');
    element.hidden = false;
    return true;
  });
  return { element, ready };
}
