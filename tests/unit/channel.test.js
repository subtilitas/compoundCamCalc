import { describe, expect, it } from 'vitest';
import {
  MAIN_CHANNEL, STORAGE_BASE, isChannel, isReleaseTag, parseVersions, siteRoot, sortTags,
  storagePrefix, versionLabel, versionsManifest,
} from '../../src/state/channel.js';
import { versionHref } from '../../src/ui/versions.js';

describe('release channels', () => {
  it('accepts main and vMAJOR.MINOR.PATCH tags only', () => {
    expect(isChannel('main')).toBe(true);
    expect(isChannel('v0.1.0')).toBe(true);
    expect(isChannel('v12.0.345')).toBe(true);
    for (const bad of ['v01.0.0', 'v1.0', '1.0.0', 'v1.0.0-rc1', 'v1.0.0/', '../v1.0.0', 'Main', '', 'v1.0.0 ']) {
      expect(isChannel(bad), bad).toBe(false);
    }
    expect(isChannel(1)).toBe(false);
    expect(isReleaseTag('main')).toBe(false);
  });

  it('sorts tags newest first by number, drops others and duplicates', () => {
    expect(sortTags(['v0.2.0', 'v0.10.0', 'v0.9.1', 'x', 'v1.0.0-rc1', 'v0.9.1', 'v1.0.0'])).toEqual(['v1.0.0', 'v0.10.0', 'v0.9.1', 'v0.2.0']);
    expect(sortTags([])).toEqual([]);
  });

  it('writes main first, then each tag in its folder', () => {
    expect(versionsManifest(['v0.1.0', 'v0.2.0'])).toEqual({
      versions: [{ id: 'main', path: '' }, { id: 'v0.2.0', path: 'v0.2.0/' }, { id: 'v0.1.0', path: 'v0.1.0/' }],
    });
  });

  it('reads back its own manifest', () => {
    const m = versionsManifest(['v0.1.0', 'v0.3.2']);
    expect(parseVersions(JSON.stringify(m))).toEqual(m.versions);
  });

  it('rejects lists with wrong paths, unknown ids, duplicates or bad JSON', () => {
    const bad = [
      '{',
      'null',
      '[]',
      '{"versions":{}}',
      '{"versions":[null]}',
      '{"versions":[{"id":"main","path":"main/"}]}',
      '{"versions":[{"id":"v0.1.0","path":"../"}]}',
      '{"versions":[{"id":"v0.1.0","path":"https://example.com/"}]}',
      '{"versions":[{"id":"beta","path":"beta/"}]}',
      '{"versions":[{"id":"main","path":""},{"id":"main","path":""}]}',
    ];
    for (const text of bad) expect(parseVersions(text), text).toBeNull();
    expect(parseVersions(' '.repeat(70000))).toBeNull();
    expect(parseVersions('{"versions":[]}')).toEqual([]);
  });

  it('finds the site root and builds addresses from each channel', () => {
    expect(siteRoot(MAIN_CHANNEL)).toBe('./');
    expect(siteRoot('v0.1.0')).toBe('../');
    expect(versionHref('main', { id: 'v0.1.0', path: 'v0.1.0/' }, '#design=v1.abc')).toBe('./v0.1.0/#design=v1.abc');
    expect(versionHref('v0.2.0', { id: 'main', path: '' }, null)).toBe('../');
    expect(versionHref('v0.2.0', { id: 'v0.1.0', path: 'v0.1.0/' }, null)).toBe('../v0.1.0/');
  });

  it('keeps the storage keys of main and gives each release its own', () => {
    expect(storagePrefix('main')).toBe(STORAGE_BASE);
    expect(STORAGE_BASE).toBe('compoundCamCalc');
    expect(storagePrefix('v0.2.0')).toBe('compoundCamCalc@v0.2.0');
    // A release prefix never starts with the main prefix plus its separator,
    // so no release key reads as a main key.
    expect(storagePrefix('v0.2.0').startsWith(`${STORAGE_BASE}.`)).toBe(false);
  });

  it('labels main with the app version it carries', () => {
    expect(versionLabel('main', '0.2.0', 'main')).toBe('main, newest (0.2.0)');
    expect(versionLabel('main', '0.1.0', 'v0.1.0')).toBe('main, newest');
    expect(versionLabel('v0.1.0', '0.2.0', 'main')).toBe('v0.1.0');
  });
});
