/**
 * DOM creation helpers.
 * @module ui/dom
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @typedef {Record<string, string | number | boolean | null | undefined>} Attrs
 */

/**
 * @param {Element} el
 * @param {Attrs} attrs
 */
export function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) el.removeAttribute(key);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

/**
 * Create an HTML element.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Attrs} [attrs]
 * @param {...(Node | string)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  el.append(...children);
  return el;
}

/**
 * Create an SVG element.
 * @template {keyof SVGElementTagNameMap} K
 * @param {K} tag
 * @param {Attrs} [attrs]
 * @returns {SVGElementTagNameMap[K]}
 */
export function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  return el;
}

/**
 * Element by id, typed; throws when missing.
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
export function byId(id, type) {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Element #${id} is missing`);
  return el;
}
