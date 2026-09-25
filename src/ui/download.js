/**
 * File downloads from the page. The download starts inside the click that
 * asks for it: Safari on iOS and Firefox ignore a download started after an
 * await or a worker round trip, because the user gesture is gone.
 * @module ui/download
 */

/** Time before the object URL of a download is released (ms); Safari on iOS reads it late. */
const REVOKE_DELAY = 60_000;

/**
 * Save text or bytes as a file. Call it synchronously from a click handler.
 * @param {string} name file name
 * @param {string | Uint8Array} content
 * @param {string} mime media type
 */
export function download(name, content, mime) {
  const blob = new Blob([/** @type {BlobPart} */ (content)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY);
}
