/**
 * Stats line under the chart: peak, holding weight, let-off, valley width,
 * draw energy and power stroke of the current curve.
 * @module ui/stats
 */

import { fromSI } from '../core/units.js';
import { fixed, forceText, lengthLabel, metricsOf } from './display.js';
import { h } from './dom.js';
import { infoButton } from './glossary.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../core/curve.js').CurveMetrics} CurveMetrics */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {keyof typeof import('./glossary.js').GLOSSARY} GlossaryKey */

/** @type {{ key: string, label: string, glossary: GlossaryKey, text: (m: CurveMetrics, u: Units) => string }[]} */
const ITEMS = [
  { key: 'peak', label: 'Peak', glossary: 'peak', text: (m, u) => `${forceText(m.peak, u, true)} ${u.force}` },
  { key: 'hold', label: 'Holding weight', glossary: 'hold', text: (m, u) => `${forceText(m.hold, u, true)} ${u.force}` },
  { key: 'letoff', label: 'Let-off', glossary: 'letOff', text: (m) => `${fixed(m.letOff * 100, 1)} %` },
  { key: 'valley', label: 'Valley width', glossary: 'valley', text: (m, u) => lengthLabel(m.valleyWidth, u) },
  { key: 'energy', label: 'Draw energy', glossary: 'energy', text: (m, u) => `${fixed(fromSI(m.energy, 'energy', u.energy), 1)} ${u.energy}` },
  { key: 'stroke', label: 'Power stroke', glossary: 'powerStroke', text: (m, u) => lengthLabel(m.powerStroke, u) },
];

/**
 * Statistics of the target curve of a state as label and text, in the
 * display units of the state.
 * @param {ProjectState} s
 * @returns {{ key: string, label: string, text: string }[]}
 */
export function statItems(s) {
  const m = metricsOf(s.curve.points);
  return ITEMS.map((item) => ({ key: item.key, label: item.label, text: item.text(m, s.units) }));
}

/**
 * @param {HTMLDListElement} list
 * @returns {{ render: (state: ProjectState) => void }}
 */
export function createStats(list) {
  const values = ITEMS.map((item) => {
    const dd = h('dd', { 'data-testid': `stat-${item.key}` });
    list.append(h('div', { class: 'stat' }, h('dt', {}, item.label, infoButton(item.glossary)), dd));
    return dd;
  });
  return {
    render(s) {
      statItems(s).forEach((item, i) => {
        values[i].textContent = item.text;
      });
    },
  };
}
