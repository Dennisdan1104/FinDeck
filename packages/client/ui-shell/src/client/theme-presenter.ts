/**
 * Global theme DOM applier: projects the resolved ThemeSnapshot onto the
 * document — `html { color-scheme }` for native UA chrome, the dark palette
 * body attribute, the content font-size axis, alias-token overrides, and one
 * presenter-owned `meta[name="theme-color"]`. The FinDeck shell owns this
 * projection for the profiles it mounts in (ui-layout's copy serves the
 * profiles that still mount ui-layout; feature plugins may not share the
 * presenter between packages, so the shell carries its own). Pure DOM writes,
 * no React involvement; the presenter only ever retracts what it wrote.
 */
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Body variable carrying the user's content font size in px. */
export const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  private appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  private readonly themeColorMeta: HTMLMetaElement

  /** Create the presenter-owned metadata node before the first snapshot arrives. */
  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  /**
   * Project a snapshot onto the document: set root `color-scheme` and the body
   * palette attribute from `active.colorScheme`, publish the content
   * font-size axis, then replace the previously applied token variables with
   * `active.tokens`; theme-color metadata follows the computed background.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
  }

  /** Retract root color-scheme, the palette attribute, token variables, the font-size axis, and the owned metadata node. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}
