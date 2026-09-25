/**
 * Text of a caught exception. Never throws: a thrown value whose message or
 * string conversion throws in turn gives a fixed text.
 * @module core/errors
 */

/**
 * @param {unknown} err
 * @returns {string}
 */
export function describeError(err) {
  try {
    const text = err instanceof Error ? err.message : err;
    return typeof text === 'string' ? text : String(text);
  } catch {
    return 'an exception whose text cannot be read';
  }
}
