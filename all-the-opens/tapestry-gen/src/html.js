// The one escaping rule, shared by every renderer. It lived in `emit.js` until
// 2026-08-04, which meant the website imported 325 lines of Tapestry
// frame-building — and, through it, all of `layout.js` — to reach seven lines.
// Retiring the curated generator made that tether the only thing keeping both
// modules alive, so it moved here.

export function escapeHtml(value) {
  return String(value)
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
}
