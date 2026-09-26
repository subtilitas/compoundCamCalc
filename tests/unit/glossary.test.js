import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGEND } from '../../src/ui/camview.js';
import { GLOSSARY } from '../../src/ui/glossary.js';
import { QUICK_START, SHORTCUTS, USER_GUIDE_URL, glossaryParts } from '../../src/ui/help.js';
import { GLOSSARY_OF, METRIC_KEYS } from '../../src/ui/results.js';
import { FIELD_GLOSSARY } from '../../src/ui/settings.js';
import { STAT_GLOSSARY } from '../../src/ui/stats.js';
import { EDITOR_GLOSSARY } from '../../src/ui/trackeditor.js';
import { TIMING_GLOSSARY } from '../../src/ui/timing.js';

/** @typedef {keyof typeof GLOSSARY} GlossaryKey */

const KEYS = /** @type {GlossaryKey[]} */ (Object.keys(GLOSSARY));

/** Results metrics without a glossary entry, on purpose: their labels say what they are. */
const METRICS_WITHOUT_TERM = ['stringLength', 'cableLength', 'camMaxDimension'];

/** Cam view legend rows without a glossary entry, on purpose: they name a line of the drawing. */
const LEGEND_WITHOUT_TERM = [
  'String track', 'Cable track', 'Groove bottom (dashed)', 'Pitch line (thin)', 'Post', 'Axle bore',
  'Timing mark', 'Contact point', 'Cord direction',
];

/** Glossary entries with at least one info button on the page. */
const WITH_BUTTON = new Set([
  ...FIELD_GLOSSARY,
  ...STAT_GLOSSARY,
  ...EDITOR_GLOSSARY,
  ...Object.values(GLOSSARY_OF),
  ...LEGEND.flatMap((row) => (row.glossary ? [row.glossary] : [])),
  ...TIMING_GLOSSARY,
]);

/**
 * Text of a section of a Markdown file, from its heading to the next
 * heading of the same level.
 * @param {string} file path from the repository root
 * @param {string} heading
 */
function sectionOf(file, heading) {
  const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, `${heading} in ${file}`).toBeGreaterThanOrEqual(0);
  const level = heading.split(' ')[0];
  const end = text.indexOf(`\n${level} `, start + heading.length + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

describe('glossary', () => {
  it('has a term and a text of one or two sentences for every key', () => {
    for (const key of KEYS) {
      const { term, text } = GLOSSARY[key];
      expect(term.length, key).toBeGreaterThan(0);
      expect(text.toLowerCase().startsWith(term.split(' (')[0].toLowerCase()) || text.includes(`(${term})`), key).toBe(true);
      expect(text.endsWith('.'), key).toBe(true);
      const sentences = text.split(/\.\s+(?=[A-Z])/).length;
      expect(sentences, key).toBeLessThanOrEqual(2);
    }
  });

  it('has an entry for every results metric, or the metric is listed as having none', () => {
    for (const key of METRIC_KEYS) {
      if (METRICS_WITHOUT_TERM.includes(key)) {
        expect(GLOSSARY_OF[key], key).toBeUndefined();
      } else {
        expect(GLOSSARY_OF[key], key).toBeDefined();
        expect(KEYS).toContain(GLOSSARY_OF[key]);
      }
    }
    // The list names only metrics that exist.
    for (const key of METRICS_WITHOUT_TERM) expect(METRIC_KEYS).toContain(key);
  });

  it('maps the results metrics to the matching terms', () => {
    expect(GLOSSARY_OF).toMatchObject({
      peak: 'peak',
      limbEnergy: 'limbEnergy',
      axleTravel: 'axleTravel',
      rotation: 'camRotation',
      stringRho: 'radiusOfCurvature',
      cableRho: 'radiusOfCurvature',
    });
  });

  it('has an entry for every cam view legend row, or the row is listed as having none', () => {
    for (const row of LEGEND) {
      if (LEGEND_WITHOUT_TERM.includes(row.label)) expect(row.glossary, row.label).toBeUndefined();
      else expect(KEYS, row.label).toContain(row.glossary);
    }
    for (const label of LEGEND_WITHOUT_TERM) expect(LEGEND.map((row) => row.label)).toContain(label);
    expect(LEGEND.find((row) => row.label.startsWith('Lever arm'))?.glossary).toBe('leverArm');
  });

  it('has info buttons on the minimum wall and the minimum bend radius settings', () => {
    expect(FIELD_GLOSSARY).toContain('wall');
    expect(FIELD_GLOSSARY).toContain('bendRadius');
  });

  it('has a key and an info button for every term the plan lists', () => {
    const plan = readFileSync(new URL('../../docs/PLAN.md', import.meta.url), 'utf8');
    const match = /^- Glossary tooltips for ([\s\S]*?)\.\s*(?:One source|\n- )/m.exec(plan);
    expect(match).not.toBeNull();
    const terms = /** @type {RegExpExecArray} */ (match)[1].replace(/\s+/g, ' ').split(/,\s*/).map((t) => t.trim());
    expect(terms.length).toBeGreaterThanOrEqual(10);
    for (const term of terms) {
      const key = KEYS.find((k) => GLOSSARY[k].term.toLowerCase() === term.toLowerCase());
      expect(key, term).toBeDefined();
      expect(WITH_BUTTON.has(/** @type {GlossaryKey} */ (key)), term).toBe(true);
    }
  });

  it('appears word for word in the Terms section of the user guide', () => {
    const terms = sectionOf('docs/user-guide.md', '## Terms');
    for (const key of KEYS) expect(terms, key).toContain(GLOSSARY[key].text);
  });
});

describe('help dialog contents', () => {
  it('has a quick start of 5 steps', () => {
    expect(QUICK_START).toHaveLength(5);
  });

  it('splits every glossary text into its name and definition without losing text', () => {
    for (const key of KEYS) {
      const { name, definition } = glossaryParts(key);
      expect(`${name}: ${definition}`).toBe(GLOSSARY[key].text);
      expect(name.toLowerCase()).toContain(GLOSSARY[key].term.split(' (')[0].toLowerCase());
    }
  });

  it('states the key steps of the code', () => {
    const text = SHORTCUTS.flatMap((g) => g.keys.map((k) => `${k.keys.join(' ')} ${k.action}`)).join('\n');
    // Chart point steps (ui/display DRAW_STEP, FORCE_STEP).
    expect(text).toContain('0.1 in (2.5 mm or 0.25 cm)');
    expect(text).toContain('1 N (0.2 lbf)');
    // Zoom and pan of the drawings (ui/viewport ZOOM_STEP, MAX_ZOOM, PAN_STEP, PAN_STEP_LARGE).
    expect(text).toContain('Zoom in by 1.5 times, up to 8 times');
    expect(text).toContain('10 % of the visible size');
    expect(text).toContain('50 %');
    // Free-form track editor (ui/trackeditor EDIT_STEP).
    expect(text).toContain('by 0.1 mm (0.005 in)');
    expect(text).toContain('by 0.5 mm (0.02 in)');
    // Undo and redo (ui/app).
    expect(text).toContain('Ctrl + Z');
    expect(text).toContain('Ctrl + Y');
    // Draw position slider.
    expect(text).toMatch(/Home Jump to brace/);
    expect(text).toMatch(/End Jump to full draw/);
  });

  it('links to the user guide in the wiki', () => {
    expect(USER_GUIDE_URL).toBe('https://github.com/subtilitas/compoundCamCalc/wiki/user-guide');
  });
});
