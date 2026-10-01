/**
 * Shared filesystem path helpers for harness user data.
 *
 * The default directory name is FinDeck's; the stock DeepSeek Harness uses
 * `.dsh`, so the two products keep separate roots. Every durable domain
 * (sessions, settings, credentials, profiles, attachments, storages, the
 * roundtable archives) resolves through {@link resolveDshHome}, so this module
 * is the only place that decides which root a process uses. See the Agent Note
 * "AlphaDeck resolves its own home directory".
 *
 * The first resolution of the default root also performs the one-time
 * `~/.alphadeck` to `~/.findeck` rename; see {@link migrateLegacyDshHome}.
 *
 * @module @deepseek-ai/dsh-home-paths
 */

import { existsSync, renameSync } from 'node:fs'
import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default FinDeck home under the OS home. */
export const DSH_HOME_DIR_NAME = '.findeck'

/** Directory name this build's default home carried before the FinDeck rename, and the source of the one-time migration. */
export const LEGACY_DSH_HOME_DIR_NAME = '.alphadeck'

/** Stable user-facing display form for the default harness home. */
export const DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`

/** Environment variable that overrides the default harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/**
 * FinDeck's own home override; it outranks {@link DSH_HOME_ENV}.
 *
 * A stock DeepSeek Harness process exports its `DSH_HOME` into every shell it
 * starts, so a fork launched from such a shell cannot tell an intentional
 * override from that leak. This fork-owned name carries FinDeck's own home
 * across those shells and is the deliberate way to place FinDeck on the stock
 * home.
 */
export const FINDECK_HOME_ENV = 'FINDECK_HOME'

/**
 * The pre-rename spelling of {@link FINDECK_HOME_ENV}, still honored.
 *
 * Deployment scripts, shortcuts, and shell profiles written before the rename
 * export this name; reading it as a lower-precedence fallback keeps those
 * installs on their existing home instead of silently moving them to the
 * default. New configuration should set `FINDECK_HOME`.
 */
export const ALPHADECK_HOME_ENV = 'ALPHADECK_HOME'

/** Directory name of the stock DeepSeek Harness home, which this build never adopts. */
export const STOCK_DSH_HOME_DIR_NAME = '.dsh'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default harness home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultDshHome(): string {
  return join(homedir(), DSH_HOME_DIR_NAME)
}

/** The stock DeepSeek Harness home this build refuses to adopt through `$DSH_HOME`. */
function stockDshHome(): string {
  return join(homedir(), STOCK_DSH_HOME_DIR_NAME)
}

/** A configured home value, or `undefined` when it is absent or blank. */
function configuredHome(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

/** One diagnostic per process for a refused stock `$DSH_HOME`. */
let warnedStockHome = false

/**
 * Report once that an inherited stock-harness home was refused.
 * @param value - the refused `$DSH_HOME` value, echoed for diagnosis.
 */
function warnStockHomeRefused(value: string): void {
  if (warnedStockHome) return
  warnedStockHome = true
  process.stderr.write(
    `FinDeck: ignoring DSH_HOME=${value} (the stock DeepSeek Harness home); `
    + `using ${DEFAULT_DSH_HOME_DISPLAY}. Set ${FINDECK_HOME_ENV} to use that directory deliberately.\n`,
  )
}

/**
 * The fork-owned home override the environment sets, with the name it used.
 *
 * `FINDECK_HOME` wins over its pre-rename alias `ALPHADECK_HOME`, so an
 * environment carrying both (a new launcher beside an old exported profile)
 * resolves the new one.
 * @param env - environment mapping used to read both override variables.
 * @returns the first name that carries a non-blank value, or `undefined` when neither does.
 */
function ownHomeOverride(env: Record<string, string | undefined>): { name: string; value: string } | undefined {
  for (const name of [FINDECK_HOME_ENV, ALPHADECK_HOME_ENV]) {
    const value = configuredHome(env[name])
    if (value !== undefined) return { name, value }
  }
  return undefined
}

/**
 * The home the process environment selects, ahead of the default.
 *
 * `$FINDECK_HOME` (then its alias `$ALPHADECK_HOME`) outranks `$DSH_HOME`. A
 * `$DSH_HOME` naming the stock harness home (`~/.dsh`) is refused with one
 * diagnostic per process: the stock build exports that value into every shell
 * it starts, and honoring it would write this build's sessions, settings, and
 * roundtable archives into the other product's root.
 * @param env - environment mapping used to read the override variables.
 * @returns the configured home, or `undefined` when none applies.
 */
function environmentDshHome(env: Record<string, string | undefined>): string | undefined {
  const own = ownHomeOverride(env)
  if (own !== undefined) return own.value
  const inherited = configuredHome(env[DSH_HOME_ENV])
  if (inherited === undefined) return undefined
  if (resolve(expandHomePath(inherited)) === resolve(stockDshHome())) {
    warnStockHomeRefused(inherited)
    return undefined
  }
  return inherited
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** One migration attempt per process, so a failed rename is not retried by every later resolution. */
let migratedLegacyHome = false

/**
 * Rename a pre-rename `~/.alphadeck` home into `~/.findeck`, once.
 *
 * One-time migration for an install upgraded in place: the default root was
 * renamed with the product, so without this the first start after the upgrade
 * would resolve an empty `~/.findeck` and appear to have lost the user's
 * sessions, settings, credentials, and roundtable archives. Nothing else has
 * opened the tree yet, because every durable read resolves its root through
 * {@link resolveDshHome}, and `fs.rename` is atomic within one volume.
 *
 * Only the default root moves: `FINDECK_HOME`, `ALPHADECK_HOME`, and `DSH_HOME`
 * each name a directory the deployment owns. An older build started after this
 * migration resolves `~/.alphadeck` again and creates a fresh empty root there —
 * the migrated data stays in `~/.findeck`, so a downgrade starts empty rather
 * than reading a half-migrated tree.
 * @throws when the rename fails for any reason other than the source being
 * absent, because starting on an empty home would hide the user's data.
 */
function migrateLegacyDshHome(): void {
  if (migratedLegacyHome) return
  migratedLegacyHome = true
  const target = defaultDshHome()
  const legacy = join(homedir(), LEGACY_DSH_HOME_DIR_NAME)
  if (existsSync(target) || !existsSync(legacy)) return
  renameSync(legacy, target)
}

/**
 * Resolve the single-root harness home.
 *
 * Precedence, highest first: an explicit configured path, `$FINDECK_HOME` (then
 * its pre-rename alias `$ALPHADECK_HOME`), `$DSH_HOME`, then `~/.findeck`. A
 * `$DSH_HOME` naming the stock harness home is refused rather than honored, and
 * a blank value of any variable is treated as unset, so a blank override never
 * resolves the home to the current working directory. The harness keeps all user
 * data under one root.
 *
 * Resolving the default performs the one-time legacy-home rename described by
 * {@link migrateLegacyDshHome}; a configured home is returned as given.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read the override variables.
 * @returns the normalized absolute harness home path.
 */
export function resolveDshHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const selected = configured ?? environmentDshHome(env)
  if (selected !== undefined) return resolve(expandHomePath(selected))
  migrateLegacyDshHome()
  return resolve(expandHomePath(defaultDshHome()))
}

/**
 * Join path segments onto the resolved harness home.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function dshHomePath(...segments: string[]): string {
  return join(resolveDshHome(), ...segments)
}

/**
 * Join path segments onto the resolved harness home's `cache` directory without
 * creating it; no arguments returns the directory itself. The cache holds only
 * regenerable data, so clearing it never removes durable user data.
 * @param optionsOrSegment - explicit home override, or the first path segment; omission uses the default home resolution.
 * @param segments - additional path segments after the first child, if any.
 * @returns the normalized absolute cache path.
 */
export function dshCachePath(optionsOrSegment: { dshHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return dshHomePath('cache', optionsOrSegment, ...segments)
  return join(resolveDshHome(optionsOrSegment.dshHome), 'cache', ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.findeck`, a home selected by `$FINDECK_HOME` (or by its pre-rename alias
 * `$ALPHADECK_HOME`) is labelled with that variable's name, and any other
 * configured home is labelled `$DSH_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveDshHome}.
 * @returns the symbolic label for the home.
 */
export function dshHomeDisplay(resolvedHome: string): string {
  if (resolvedHome === resolve(defaultDshHome())) return DEFAULT_DSH_HOME_DISPLAY
  const own = ownHomeOverride(process.env)
  return own !== undefined && resolve(expandHomePath(own.value)) === resolvedHome
    ? `$${own.name}`
    : `$${DSH_HOME_ENV}`
}
