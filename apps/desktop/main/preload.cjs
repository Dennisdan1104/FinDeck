/**
 * Desktop shell marker.
 *
 * The web shell's frame reads `html[data-shell="desktop"]` to tell this window
 * from a plain browser tab: the band it reserves above every column exists for
 * this window's window-controls overlay alone. The mark lands before the page's
 * own scripts, so the client boots with it already on the document —
 * `document.documentElement` does not exist yet when the preload starts, hence
 * the listener.
 *
 * A plain DOM attribute, deliberately not a bridge: `data-platform` (what the
 * shortcut adapter and the darwin layout variants read) promises the
 * `window.dshDesktop` APIs, which this shell does not provide.
 */
function markDocument() {
  const root = document.documentElement
  if (root === null) return false
  root.dataset.shell = 'desktop'
  return true
}

if (!markDocument()) {
  const once = () => {
    if (markDocument()) document.removeEventListener('readystatechange', once)
  }
  document.addEventListener('readystatechange', once)
}
