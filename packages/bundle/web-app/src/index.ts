/**
 * @deepseek-ai/dsh-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns the browser-surface glue: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * harness-source and web-surface prompt sections, the bash-visible web runtime
 * variable, the process-token URL line, and the default-browser handoff. The
 * model and shell retain the clean URL. App command-line values arrive through
 * the `webStartup` service expressions in the bundle patch.
 * @module @deepseek-ai/dsh-web-app
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, stat, mkdir, open } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parseDocument, parse as parseYaml } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService, Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-shell-env'
// Type-only: pulls the settings service merge (ctx.settings) for the
// user-profile namespace registration below.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the agent-preset roster and workspace registry context
// merges the asset-overview gateway reads.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-workspace'
// Type-only: the session registry, persistence, projection registry, the
// schedule projection's wire value, and the title projection merge.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { deleteSchedule, pauseSchedule, resumeSchedule } from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-session-title'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { assetLibraryDir, FINANCE_PYTHON_DIR, probeDataEnv, VENV_PYTHON } from './environment.ts'
import { ComponentCatalogGateway } from './downloads/gateway.ts'
import type {
  AssetOverview,
  DataEnvReport,
  ScheduleOverview,
  AssetOverviewAsset,
  AssetOverviewFlow,
  AssetOverviewReport,
  AssetOverviewThesis,
  AssetBriefResult,
  AssetFaceManifest,
  AssetFaceResult,
  AssetFileRequest,
  AssetFileResult,
  AssetLibrary,
  AssetLibraryAsset,
  AssetLibraryFreshness,
  PluginPatchRow,
  PluginPatchWriteRequest,
  RemoteJson,
  RunVerbRequest,
  RunVerbResult,
  ScheduleControlRequest,
  ScheduleManagementResult,
  ScheduleRemovalResult,
} from './types.ts'

export type {
  AssetOverview,
  ComponentEvent,
  ComponentId,
  ComponentInfo,
  ComponentProgress,
  DataEnvReport,
  ScheduleOverview,
  AssetOverviewAsset,
  AssetOverviewFlow,
  AssetOverviewFlowStep,
  AssetOverviewReport,
  AssetOverviewThesis,
  AssetOverviewThesisScore,
  AssetBriefResult,
  AssetFaceManifest,
  AssetFaceResult,
  AssetFileRequest,
  AssetFileResult,
  AssetLibrary,
  AssetLibraryAsset,
  AssetLibraryFreshness,
  PluginPatchRow,
  PluginPatchWriteRequest,
  RemoteJson,
  RunVerbRequest,
  RunVerbResult,
  ScheduleControlRequest,
  ScheduleManagementResult,
  ScheduleRemovalResult,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'web-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const ANNOUNCED_ROOTS = new WeakSet<Context>()

/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = 'webRuntime'

/** Services required before the web runtime can mount. */
export const inject = ['webServer']

/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Permit default-browser handoff after the Loader tree settles; an SSH launch suppresses it. */
  openBrowser: boolean
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `DSH_WEB_URL` bash variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /** Explicit `--trusted-host` authorities from this invocation. */
  trustedHosts: string[]
}

export const Config: z<Config> = z.object({
  openBrowser: z.boolean().default(true),
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
  trustedHosts: z.array(String).default([]),
})

/** Bind-dependent Web values shared by the trust fence and URL display. */
export interface WebRuntimeValues {
  /** LAN IPv4 literals sampled once when the server binds all interfaces. */
  lanAddresses: string[]
  /** LAN literals followed by explicit invocation authorities. */
  trustedHosts: string[]
}

/** Environment variable naming the canonical local URL of this Web GUI. */
const DSH_WEB_URL = 'DSH_WEB_URL' as const

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'
/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = '0.0.0.0'

/** Whether this process was launched through SSH, including a forwarded-port session. */
function launchedThroughSsh(ctx: Context): boolean {
  const environment = launchEnvironmentOf(ctx)
  return ['SSH_CONNECTION', 'SSH_TTY'].some((name) => {
    const value = environment.getFrom(name, ['process'])?.value
    return value !== undefined && value !== ''
  })
}

const BROWSER_OPENER_MODULE = import.meta.resolve('open')

const BROWSER_OPENER_PROGRAM = `
try {
  const { default: open } = await import(${JSON.stringify(BROWSER_OPENER_MODULE)})
  const launcher = await open(process.argv[1])
  if (process.platform === 'win32') {
    // open resolves at PowerShell spawn; keep it referenced until that launcher hands the URL to Windows.
    const code = launcher.exitCode ?? await new Promise((resolve, reject) => {
      function onError(error) {
        launcher.off('close', onClose)
        reject(error)
      }
      function onClose(code) {
        launcher.off('error', onError)
        resolve(code)
      }
      launcher.ref()
      launcher.once('error', onError)
      launcher.once('close', onClose)
    })
    if (code !== 0) throw new Error('browser operating-system launcher exited with code ' + String(code))
  }
  process.exitCode = 0
} catch (error) {
  // The parent turns this exit into the manual-URL warning.
  console.error(error)
  process.exitCode = 1
}
`

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and
 * an OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost: string, extra: readonly string[]): WebRuntimeValues {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
}

/** Model-visible orientation and acceptance boundary for sessions created through `dsh web`. */
function webSurfacePrompt(webUrl: string): string {
  const updateContract = 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while '
    + '`pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
    + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. '
  return `You are interacting with the user through the FinDeck Web GUI at ${webUrl}. `
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + updateContract
    + 'Starting another server does not update this GUI. '
    + 'The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. '
    + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'
}

/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('web-app: webServer service missing while resolving Web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/**
 * Dist location is workspace knowledge of this bundle: anchored on the
 * frontend package manifest, not configured. Existence is a request-time
 * concern — the fallback owner reads files per request, so a composition
 * whose page never reaches the fallback seat (the static worker preview
 * ships its own page and carries no dist) boots without one.
 */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist', 'index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only when the frontend package is absent from the checkout */
    throw new Error('web-app: @deepseek-ai/dsh-web-frontend is not resolvable from this composition')
  }
}

/** Start the maintained platform opener without forwarding Harness credentials. */
function spawnBrowserLauncher(url: string): ChildProcess {
  return spawn(process.execPath, [
    '--input-type=module',
    '--eval', BROWSER_OPENER_PROGRAM,
    '--', url,
  ], {
    env: scrubbedParentEnv(),
    stdio: ['ignore', 'inherit', 'pipe'],
  })
}

/** Hand one URL to the operating system's default browser. */
async function openBrowser(url: string): Promise<void> {
  const launcher = spawnBrowserLauncher(url)
  let launcherStderr = ''
  launcher.stderr?.setEncoding('utf8')
  launcher.stderr?.on('data', (chunk: string) => { launcherStderr += chunk })
  await new Promise<void>((resolve, reject) => {
    function onError(error: Error): void {
      launcher.off('close', onClose)
      reject(error)
    }
    function onClose(code: number | null): void {
      launcher.off('error', onError)
      if (code !== 0) {
        const firstLine = launcherStderr.trim().split(/\r?\n/u)[0]
        const reason = firstLine === undefined || firstLine === ''
          ? `browser launcher exited with code ${String(code)}`
          : firstLine.replace(/^(?:[A-Za-z]*Error):\s*/u, '')
        reject(new Error(reason))
        return
      }
      if (launcherStderr !== '') process.stderr.write(launcherStderr)
      resolve()
    }
    launcher.once('error', onError)
    launcher.once('close', onClose)
  })
}

/** Test hooks for the built dist and native browser handoff; production never mutates them. */
export const internals: {
  resolveDistIndex: () => string
  openBrowser: (url: string) => Promise<void>
} = { resolveDistIndex, openBrowser }

/** Settings namespace carrying the browser user's display name (sidebar card). */
export const USER_PROFILE_NAMESPACE = 'user-profile' as const

/** Grace between the replacement's spawn and this process's exit, so the Remote reply can flush. */
const RESTART_REPLY_GRACE_MS = 250

/**
 * Host owner of the `system` Remote namespace: this Web process's own
 * lifecycle. The one operation restarts the process in place, so a rebuilt
 * bundle — or any other artifact change — is what the next page load serves
 * without an operator running the launcher again.
 *
 * The replacement is a detached copy of this invocation: the same node binary,
 * exec arguments, entry script, argv, and working directory, so whatever launch
 * shape started this process (the launcher script, `pnpm run dev`, a
 * supervisor) is preserved without being re-derived from the composition.
 */
export class SystemGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'system')
  }

  /**
   * Restart this process in place.
   *
   * The caller cannot rely on the reply: the listener is released before the
   * exit that follows it, so the browser's carrier usually drops while this
   * answer is still being written. A caller judges the restart by the
   * connection generation it observes afterwards.
   * @throws RemoteError when this process owns no listening web server, or no entry script to re-execute.
   */
  @Remote
  restart(): void {
    const server = this.ctx.get('webServer')
    if (server === undefined) {
      throw new RemoteError('gateway/internal', 'web-app: this process serves no web port to restart', {})
    }
    if (process.argv[1] === undefined) {
      throw new RemoteError('gateway/internal', 'web-app: this process has no entry script to re-execute', {})
    }
    // stdout and stderr are inherited rather than ignored: the launcher
    // redirects this process's output into the operator's log file, and the
    // replacement has to keep writing there once this process is gone.
    const replacement = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    replacement.once('error', (error: unknown) => {
      // Staying alive is the whole recovery: a replacement that never started
      // must not take the served page down with it.
      this.ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
    })
    replacement.once('spawn', () => {
      replacement.unref()
      // Release the port first, so the replacement's bind cannot race a
      // listener this process still holds.
      server.releaseListener()
      setTimeout(() => { process.exit(0) }, RESTART_REPLY_GRACE_MS)
    })
  }
}

/**
 * The user-writable slice of the browser user profile: one display name.
 * Absent or empty renders the shell's localized default ("Local user").
 */
export interface UserProfileSettings {
  /** The name shown beside the avatar in the shell sidebar. */
  displayName: string
}

/** Runtime schema for {@link UserProfileSettings}. */
export const UserProfileSettingsSchema: z<UserProfileSettings> = z.object({
  displayName: z.string(),
})

/** The user-layer patch file name under the harness home. */
export const USER_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * The user-layer patch path (`$DSH_HOME/cordis.patch.yml`).
 * @param home - harness home to join; defaults to the resolved `$DSH_HOME`.
 * @returns the absolute user-layer patch file path.
 */
export function userPatchPath(home: string = resolveDshHome()): string {
  return join(home, USER_PATCH_FILENAME)
}

/** A YAML map node inside the patch sequence, as the edit helpers need it. */
interface PatchMapNode {
  items?: readonly { key: { value: unknown }; value: { value: unknown } }[]
  set?: (key: string, value: unknown) => void
  delete?: (key: string) => void
}

/** The patch document's root sequence node. */
interface PatchSeqNode {
  items?: PatchMapNode[]
  add?: (value: unknown) => void
}

/** Read the `id` value out of one patch-row node. */
function rowIdOf(node: PatchMapNode): string | undefined {
  const found = node.items?.find(item => item.key.value === 'id')
  return found === undefined ? undefined
    : typeof found.value.value === 'string' ? found.value.value : undefined
}

/** Read the `disabled` value out of one patch-row node. */
function rowDisabledOf(node: PatchMapNode): boolean | undefined {
  const found = node.items?.find(item => item.key.value === 'disabled')
  return found !== undefined && typeof found.value.value === 'boolean'
    ? found.value.value
    : undefined
}

/** Whether the row carries anything beyond `id` (the drop-row test). */
function rowOnlyId(node: PatchMapNode): boolean {
  /* v8 ignore next -- only a row that already yielded an `id` reaches this, which requires items. */
  const others = (node.items ?? []).filter(item => item.key.value !== 'id')
  return others.length === 0
}

/**
 * Read every row the user-layer patch names, as the plugin page renders
 * toggles from.
 * @param file - the patch file to read.
 * @returns one row per entry the patch names, in file order.
 */
export async function readUserPatch(file: string): Promise<PluginPatchRow[]> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error: unknown) {
    // Absent user layer is the ordinary fresh-install posture: no overrides.
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
    throw error
  }
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    throw new Error(`user cordis.patch.yml failed to parse: ${String(doc.errors[0]?.message)}`)
  }
  const seq = doc.contents as PatchSeqNode | null | undefined
  const rows: PluginPatchRow[] = []
  if (seq === null || seq === undefined || seq.items === undefined) return rows
  for (const node of seq.items) {
    const id = rowIdOf(node)
    if (id === undefined) continue
    const disabled = rowDisabledOf(node)
    rows.push({ id, ...disabled === undefined ? {} : { disabled } })
  }
  return rows
}

/**
 * Write one entry's user-layer disable fact, comment-preserving. The row is
 * located by id and its `disabled` key updated; a non-existent entry appends
 * a row; `disabled: null` removes the key (and the row when nothing else
 * remains), returning the entry to the layers below.
 * @param file - the patch file to write (created when absent).
 * @param request - the entry id and the next disable fact (null drops the row).
 * @returns the rows as written.
 */
export async function writeUserPatch(file: string, request: PluginPatchWriteRequest): Promise<PluginPatchRow[]> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await withFileLock(file, async () => {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
      text = '[]\n'
    }
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      throw new Error(`user cordis.patch.yml failed to parse: ${String(doc.errors[0]?.message)}`)
    }
    let seq = doc.contents as PatchSeqNode | null | undefined
    if (seq === null || seq === undefined) {
      // yaml's `set('', value)` seeds a mapping keyed by the empty string, not
      // the sequence this layer holds.
      const seeded = doc.createNode([]) as unknown as PatchSeqNode
      doc.contents = seeded as never
      seq = seeded
    }
    if (seq === null || seq === undefined || seq.items === undefined) {
      throw new Error('user cordis.patch.yml could not be seeded as a sequence')
    }
    let matched: PatchMapNode | undefined
    for (const node of seq.items) {
      if (rowIdOf(node) === request.id) matched = node
    }
    if (matched === undefined && request.disabled !== null) {
      seq.add?.({ id: request.id, disabled: request.disabled })
    } else if (matched !== undefined) {
      if (request.disabled === null) {
        matched.delete?.('disabled')
        if (rowOnlyId(matched)) {
          const at = seq.items.indexOf(matched)
          ;(seq.items as unknown[]).splice(at, 1)
        }
      } else {
        matched.set?.('disabled', request.disabled)
      }
    }
    await writeFileAtomic(file, doc.toString(), { mode: 0o600, dirMode: 0o700 })
  })
  return readUserPatch(file)
}

/**
 * The plugin-page toggle's host gateway: read the user-layer patch and write
 * one entry's disable fact into it. The patch is the user's own layer
 * (`$DSH_HOME/cordis.patch.yml`), applied last at boot, so a toggle lands
 * there and takes effect on the next start.
 */
export class PluginPatchGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'pluginPatch')
  }

  /**
   * Read every user-layer disable fact (see {@link readUserPatch}).
   * @returns one row per user-layer entry, in file order.
   */
  @Remote
  read(): Promise<PluginPatchRow[]> {
    return readUserPatch(userPatchPath())
  }

  /**
   * Write one entry's disable fact into the user layer.
   * @param request - the entry and the fact (null drops the row).
   * @returns the rows as written.
   */
  @Remote
  write(request: PluginPatchWriteRequest): Promise<PluginPatchRow[]> {
    return writeUserPatch(userPatchPath(), request)
  }
}

/** Today's local date as YYYY-MM-DD, for thesis overdue flags. */
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Read the asset index; an absent or malformed library answers empty, not fatal. */
async function readOverviewAssets(problems: string[]): Promise<AssetOverviewAsset[]> {
  let raw: string
  try {
    raw = await readFile(join(assetLibraryDir(), 'index.json'), 'utf-8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    problems.push(`asset index.json is not valid JSON (${String(error)})`)
    return []
  }
  const assets = (parsed as { assets?: unknown }).assets
  if (!Array.isArray(assets)) return []
  const out: AssetOverviewAsset[] = []
  for (const entry of assets) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.name !== 'string' || typeof row.kind !== 'string') continue
    const versions = Array.isArray(row.versions) ? row.versions : []
    const latest = typeof row.latest_version === 'number'
      ? versions.find((v): v is Record<string, unknown> =>
        typeof v === 'object' && v !== null && (v as { version?: unknown }).version === row.latest_version)
      : undefined
    const manifest = latest === undefined ? undefined : latest.manifest as Record<string, unknown> | undefined
    out.push({
      name: row.name,
      kind: row.kind,
      latest_version: typeof row.latest_version === 'number' ? row.latest_version : 1,
      description: typeof row.description === 'string' ? row.description : '',
      validation: typeof row.validation === 'string' ? row.validation : '',
      depends_on: Array.isArray(row.depends_on) ? row.depends_on.filter((d): d is string => typeof d === 'string') : [],
      ...manifest !== undefined && typeof manifest.created === 'string' ? { created: manifest.created } : {},
    })
  }
  return out
}

/**
 * The freshness window beyond which the asset page grays an asset out, per
 * `update_frequency`. A deployment-chosen frequency this table does not name
 * takes the conservative 31-day window.
 */
const STALE_AFTER_DAYS: Record<string, number> = {
  daily: 2,
  weekly: 8,
  monthly: 32,
  quarterly: 95,
}

/** The fallback freshness window for an unnamed or missing update frequency. */
const STALE_AFTER_DAYS_DEFAULT = 31

/** Whole days from `from` to `to`, both `YYYY-MM-DD`; NaN when either does not parse. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return (end - start) / 86_400_000
}

/** Whether one JSON value is a JSON object rather than an array or a scalar. */
function isJsonObject(value: RemoteJson | undefined): value is { [key: string]: RemoteJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a dataset asset is past its update deadline.
 *
 * Only a dataset carries a freshness promise, and only a dated one can be late:
 * anything else — another kind, a missing block, an unstated or unparseable
 * `as_of`, a future date — answers false.
 * @param kind - the index row's `kind` value, read defensively.
 * @param freshness - the index row's `freshness` value, read defensively.
 * @param today - `YYYY-MM-DD` date to judge against, injected so the rule is testable.
 * @returns true when the asset is past its window as of `today`.
 */
function assetStale(kind: RemoteJson | undefined, freshness: RemoteJson | undefined, today: string): boolean {
  if (kind !== 'dataset') return false
  if (!isJsonObject(freshness)) return false
  const asOf = freshness.as_of
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(asOf)) return false
  const age = daysBetween(asOf, today)
  if (Number.isNaN(age) || age <= 0) return false
  const frequency = freshness.update_frequency
  const window = typeof frequency === 'string' ? STALE_AFTER_DAYS[frequency] ?? STALE_AFTER_DAYS_DEFAULT : STALE_AFTER_DAYS_DEFAULT
  return age > window
}

/** Read one index row's freshness declaration, or null when none is stated. */
function indexFreshness(value: RemoteJson | undefined): AssetLibraryFreshness | null {
  if (!isJsonObject(value)) return null
  const asOf = value.as_of
  if (typeof asOf !== 'string') return null
  const frequency = value.update_frequency
  return {
    as_of: asOf,
    ...typeof frequency === 'string' ? { update_frequency: frequency } : {},
  }
}

/** Filter one index value into the string list the declared field means. */
function stringList(value: RemoteJson | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * Read the library index's v2 asset summaries.
 *
 * The reader is contained the way the overview readers are: an absent or
 * malformed index answers empty, naming itself in `problems`, so the asset page
 * shows the loss instead of failing.
 * @param problems - collector for read failures, appended to in place.
 * @param today - `YYYY-MM-DD` date the `stale` flags are judged against.
 * @returns one summary per entry that carries a name and kind, in index order.
 */
async function readAssetLibraryIndex(problems: string[], today: string): Promise<AssetLibraryAsset[]> {
  let raw: string
  try {
    raw = await readFile(join(assetLibraryDir(), 'index.json'), 'utf-8')
  } catch (error) {
    // An absent library is the fresh-install posture, not a data loss; every
    // other read failure is one.
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
      problems.push(`asset index.json is unreadable (${String(error)})`)
    }
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    problems.push(`asset index.json is not valid JSON (${String(error)})`)
    return []
  }
  const entries = (parsed as { assets?: unknown }).assets
  if (!Array.isArray(entries)) return []
  const out: AssetLibraryAsset[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as { [key: string]: RemoteJson }
    if (typeof row.name !== 'string' || typeof row.kind !== 'string') continue
    const latestVersion = typeof row.latest_version === 'number' ? row.latest_version : 1
    if (typeof row.latest_version !== 'number') {
      problems.push(`asset "${row.name}" names no latest_version; the page shows v${String(latestVersion)}`)
    }
    const versions = Array.isArray(row.versions) ? row.versions : []
    const latest = versions.find((version): version is { [key: string]: RemoteJson } =>
      isJsonObject(version) && version.version === latestVersion)
    const manifest = latest?.manifest
    const manifestFace = isJsonObject(manifest) ? manifest.face : undefined
    out.push({
      name: row.name,
      kind: row.kind,
      origin: typeof row.origin === 'string' ? row.origin : '',
      latest_version: latestVersion,
      description: typeof row.description === 'string' ? row.description : '',
      validation: typeof row.validation === 'string' ? row.validation : '',
      verbs: stringList(row.verbs),
      tags: stringList(row.tags),
      freshness: indexFreshness(row.freshness),
      // The version manifest is where a version declares its own face; the
      // asset-level value is the fallback for a library whose index predates it.
      face: typeof manifestFace === 'string' ? manifestFace : typeof row.face === 'string' ? row.face : null,
      depends_on: stringList(row.depends_on),
      stale: assetStale(row.kind, row.freshness, today),
      versionDir: join(assetLibraryDir(), row.name, `v${String(latestVersion)}`),
    })
  }
  return out
}

/**
 * Parse one version manifest into the fields the face view reports.
 *
 * Every field is read with the reading path's own tolerance: a value of another
 * type is reported as the field's empty form rather than coerced or rejected.
 * @param value - the parsed `manifest.yaml` document.
 * @returns the manifest summary.
 */
function assetFaceManifestOf(value: { [key: string]: RemoteJson }): AssetFaceManifest {
  const row = value
  const lineageValue = row.lineage
  const lineageRow = isJsonObject(lineageValue) ? lineageValue : undefined
  const producer = lineageRow?.producer
  const inputs = lineageRow?.inputs
  const lineage = lineageRow === undefined
    ? null
    : {
      ...isJsonObject(producer) ? { producer } : {},
      ...Array.isArray(inputs) ? { inputs: stringList(inputs) } : {},
    }
  return {
    name: typeof row.name === 'string' ? row.name : '',
    kind: typeof row.kind === 'string' ? row.kind : '',
    version: typeof row.version === 'number' ? row.version : 0,
    created: typeof row.created === 'string' ? row.created : '',
    source_session: typeof row.source_session === 'string' ? row.source_session : '',
    description: typeof row.description === 'string' ? row.description : '',
    interface: typeof row.interface === 'string' ? row.interface : '',
    dependencies: stringList(row.dependencies),
    depends_on: stringList(row.depends_on),
    supersedes: typeof row.supersedes === 'string' ? row.supersedes : null,
    validation: typeof row.validation === 'string' ? row.validation : '',
    origin: typeof row.origin === 'string' ? row.origin : '',
    verbs: stringList(row.verbs),
    freshness: indexFreshness(row.freshness),
    lineage,
    tags: stringList(row.tags),
    face: typeof row.face === 'string' ? row.face : null,
  }
}

/**
 * Whether a path is one relative path inside the version directory: no leading
 * slash, no drive letter, and no `..` segment. The check is lexical, so a
 * sibling file whose name merely starts with `..` stays readable.
 */
function relativeInsideDir(path: string): boolean {
  return path !== ''
    && !path.startsWith('/')
    && !/^[A-Za-z]:/u.test(path)
    && path.split(/[/\\]/u).includes('..') === false
}

/** Whether a path is one relative forward-slash path inside the version directory. */
function relativeFacePath(face: string): boolean {
  return face.endsWith('.json') && relativeInsideDir(face)
}

/**
 * Resolve one asset version directory, defaulting to the latest, over the
 * library's version directories rather than the index, so the directory the
 * caller reads is the one the bridge would run.
 * @param asset - library asset name.
 * @param version - requested version, or undefined for the latest.
 * @returns the version number and its absolute directory.
 * @throws RemoteError `asset/not-found` when the asset or the requested version is absent.
 */
async function resolveAssetVersion(asset: string, version?: number): Promise<{ version: number; dir: string }> {
  const assetDir = join(assetLibraryDir(), asset)
  let names: string[]
  try {
    names = await readdir(assetDir)
  } catch (error) {
    throw new RemoteError('asset/not-found', `asset "${asset}" is not in the library (${String(error)})`, {
      name: asset,
      ...version === undefined ? {} : { version },
    })
  }
  const available = names
    .map(name => /^v(\d+)$/u.exec(name)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number)
  const resolved = version ?? (available.length === 0 ? undefined : Math.max(...available))
  if (resolved === undefined || !available.includes(resolved)) {
    throw new RemoteError('asset/not-found', `asset "${asset}" has no version v${String(resolved ?? 'latest')}`, {
      name: asset,
      ...resolved === undefined ? {} : { version: resolved },
    })
  }
  return { version: resolved, dir: join(assetDir, `v${String(resolved)}`) }
}

/**
 * Read one asset version's manifest and face.
 *
 * The returned `manifest` is the whole manifest, not just the fields the face
 * view renders, so an operation that needs a field this reader does not name
 * reads it here. The returned `dir` is the directory the manifest was read
 * from, so a caller can resolve a path the manifest states relative to it.
 * @param asset - library asset name.
 * @param version - requested version, or undefined for the latest.
 * @returns the manifest, its parsed face, and the version directory.
 * @throws RemoteError `asset/face-invalid` when the manifest or face is unreadable or malformed.
 */
async function readAssetFace(asset: string, version?: number): Promise<{ face: { [key: string]: RemoteJson } | null; manifest: { [key: string]: RemoteJson }; dir: string; version: number }> {
  const resolved = await resolveAssetVersion(asset, version)
  const manifestPath = join(resolved.dir, 'manifest.yaml')
  let manifestText: string
  try {
    manifestText = await readFile(manifestPath, 'utf-8')
  } catch (error) {
    throw new RemoteError('asset/face-invalid', `asset "${asset}" v${String(resolved.version)} has no readable manifest.yaml (${String(error)})`, {
      name: asset,
      version: resolved.version,
      reason: String(error),
    })
  }
  let manifest: { [key: string]: RemoteJson }
  try {
    const parsed = parseYaml(manifestText, { schema: 'core' })
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('manifest.yaml is not a mapping')
    }
    manifest = parsed as { [key: string]: RemoteJson }
  } catch (error) {
    throw new RemoteError('asset/face-invalid', `asset "${asset}" v${String(resolved.version)} has an unparseable manifest.yaml`, {
      name: asset,
      version: resolved.version,
      reason: String(error),
    })
  }
  const declared = typeof manifest.face === 'string' ? manifest.face : null
  if (declared === null) return { face: null, manifest, dir: resolved.dir, version: resolved.version }
  if (!relativeFacePath(declared)) {
    throw new RemoteError('asset/face-invalid', `asset "${asset}" v${String(resolved.version)} declares a face that is not a version-directory-relative .json path: ${declared}`, {
      name: asset,
      version: resolved.version,
      reason: `face path is not relative: ${declared}`,
    })
  }
  let faceText: string
  try {
    faceText = await readFile(join(resolved.dir, declared), 'utf-8')
  } catch (error) {
    throw new RemoteError('asset/face-invalid', `asset "${asset}" v${String(resolved.version)} declares face ${declared} but it is unreadable (${String(error)})`, {
      name: asset,
      version: resolved.version,
      reason: String(error),
    })
  }
  let faceValue: unknown
  try {
    faceValue = JSON.parse(faceText)
  } catch (error) {
    throw new RemoteError('asset/face-invalid', `asset "${asset}" v${String(resolved.version)} declares face ${declared} but it is not valid JSON`, {
      name: asset,
      version: resolved.version,
      reason: String(error),
    })
  }
  return {
    face: typeof faceValue === 'object' && faceValue !== null && !Array.isArray(faceValue)
      ? faceValue as { [key: string]: RemoteJson }
      : null,
    manifest,
    dir: resolved.dir,
    version: resolved.version,
  }
}

/** Render one manifest value as a line, or `（未声明）` when the manifest states none. */
function briefValue(value: RemoteJson | undefined): string {
  if (value === undefined || value === null || value === '') return '（未声明）'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Render a manifest string list, or `（无）` when it is empty. */
function briefList(value: RemoteJson | undefined): string {
  const items = stringList(value)
  return items.length === 0 ? '（无）' : items.join('、')
}

/**
 * Text suffixes an `assetFile` read accepts: the version directory's own
 * documents. Anything else — data files, scripts, archives — is not text the
 * page embeds, so the request is refused rather than guessed at.
 */
const ASSET_FILE_SUFFIXES = ['.html', '.htm', '.svg', '.md', '.txt', '.json']

/** Upper bound on one `assetFile` read: a page block embeds a document, not a corpus. */
const ASSET_FILE_MAX_BYTES = 256 * 1024

/** UTF-8 decoding that rejects malformed bytes instead of substituting `U+FFFD`. */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

/**
 * Read one text file inside an asset version directory.
 *
 * Every refusal is explicit: the path must be relative and stay inside the
 * directory, its suffix must be a whitelisted text type, the file size must fit
 * {@link ASSET_FILE_MAX_BYTES}, and the bytes must decode as UTF-8.
 * @param asset - library asset name.
 * @param path - path relative to the version directory.
 * @param version - requested version, or undefined for the latest.
 * @returns the decoded text and the path as requested.
 * @throws RemoteError `asset/not-found` for an unknown asset, version, or file, and for a path outside the version directory or outside the text whitelist; `asset/file-too-large` past the read bound; `asset/file-not-text` for bytes that are not UTF-8.
 */
async function readAssetFile(asset: string, path: string, version?: number): Promise<{ content: string; path: string }> {
  const resolved = await resolveAssetVersion(asset, version)
  if (!relativeInsideDir(path) || !ASSET_FILE_SUFFIXES.some(candidate => path.toLowerCase().endsWith(candidate))) {
    throw new RemoteError('asset/not-found', `asset "${asset}" v${String(resolved.version)} has no file at relative path ${JSON.stringify(path)} (path must stay inside the version directory and name one of ${ASSET_FILE_SUFFIXES.join('/')})`, {
      name: asset,
      version: resolved.version,
    })
  }
  const file = join(resolved.dir, path)
  let bytes: number
  try {
    bytes = (await stat(file)).size
  } catch (error) {
    throw new RemoteError('asset/not-found', `asset "${asset}" v${String(resolved.version)} has no readable file ${path} (${String(error)})`, {
      name: asset,
      version: resolved.version,
    })
  }
  // Bounded before the read, not after: a large file must not be pulled into
  // the gateway process only to be refused.
  if (bytes > ASSET_FILE_MAX_BYTES) {
    throw new RemoteError('asset/file-too-large', `asset "${asset}" v${String(resolved.version)} file ${path} is ${String(bytes)} bytes, over the ${String(ASSET_FILE_MAX_BYTES)}-byte read bound`, {
      name: asset,
      version: resolved.version,
      path,
    })
  }
  const buffer = Buffer.allocUnsafe(bytes)
  try {
    const handle = await open(file, 'r')
    try {
      await handle.read(buffer, 0, bytes, 0)
    } finally {
      await handle.close()
    }
  } catch (error) {
    throw new RemoteError('asset/not-found', `asset "${asset}" v${String(resolved.version)} has no readable file ${path} (${String(error)})`, {
      name: asset,
      version: resolved.version,
    })
  }
  let content: string
  try {
    content = UTF8_DECODER.decode(buffer)
  } catch (error) {
    throw new RemoteError('asset/file-not-text', `asset "${asset}" v${String(resolved.version)} file ${path} is not UTF-8 text (${String(error)})`, {
      name: asset,
      version: resolved.version,
      path,
    })
  }
  return { content, path }
}

/**
 * Build the Chinese seed text a new session receives as its first message, so
 * the agent it starts can drive one asset directly: where the version lives on
 * disk, what the manifest promises, and what it consumes.
 * @param asset - library asset name.
 * @param read - one asset version's manifest and directory.
 * @returns the seed text.
 */
function assetBriefSeed(asset: string, read: { manifest: AssetFaceManifest; dir: string; version: number }): string {
  const manifest = read.manifest
  const lineage = manifest.lineage
  const producer = lineage?.producer === undefined ? '（未声明）' : JSON.stringify(lineage.producer)
  const inputs = lineage?.inputs === undefined ? '（无）' : briefList(lineage.inputs)
  const freshness = manifest.freshness === null
    ? '（未声明）'
    : `${manifest.freshness.as_of}（更新频率 ${briefValue(manifest.freshness.update_frequency)}）`
  return [
    `请直接操作资产 ${asset}@v${String(read.version)}。`,
    `版本目录（绝对路径）：${read.dir}`,
    `kind：${briefValue(manifest.kind)}｜origin：${briefValue(manifest.origin)}`,
    `描述：${briefValue(manifest.description)}`,
    `接口：${briefValue(manifest.interface)}`,
    `验证指标：${briefValue(manifest.validation)}`,
    `verbs：${briefList(manifest.verbs)}`,
    `依赖（depends_on）：${briefList(manifest.depends_on)}`,
    `血缘（lineage）：producer=${producer}；inputs=${inputs}`,
    `保鲜度（freshness）：${freshness}`,
    '该资产的文件都在版本目录内；需要读数据/跑动作时用上面列出的 verbs（可经 verb 桥执行），不要重新拉数或重写已有脚本。',
  ].join('\n')
}

/**
 * Upper bound on one verb-bridge call, matching the bridge's own
 * `FINDECK_VERB_TIMEOUT` default: a hung asset script must not hold the page
 * open forever.
 */
const VERB_TIMEOUT_MS = 600_000

/** What one collected child process settled as. */
interface VerbProcessOutcome {
  /** Process exit code; null when the child died from a signal. */
  code: number | null
  stdout: string
  stderr: string
}

/** Run one verb-bridge process, collect its output, and enforce the timeout. */
function collectVerbProcess(child: ChildProcess): Promise<VerbProcessOutcome> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`verb bridge exceeded ${String(VERB_TIMEOUT_MS / 1000)}s and was killed`))
    }, VERB_TIMEOUT_MS)
    child.once('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code: number | null) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Run one verb-bridge request through the finance venv and return the bridge's
 * own response. The gateway forwards; it adds no business logic, so a verb that
 * fails still answers, carrying `status='error'` and the bridge's reason.
 * @param request - the verb-bridge request.
 * @returns the parsed response the bridge printed.
 * @throws RemoteError `gateway/internal` when the process cannot run, overruns the timeout, or prints no JSON response.
 */
async function runVerbBridge(request: RunVerbRequest): Promise<RunVerbResult> {
  let child: ChildProcess
  try {
    child = spawn(VENV_PYTHON, ['-m', 'findeck.verb_bridge', JSON.stringify(request)], {
      cwd: FINANCE_PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
  } catch (error) {
    // `spawn` raises synchronously only for an invalid argument set; a missing
    // interpreter surfaces on the child's own error event.
    throw new RemoteError('gateway/internal', `web-app: could not start the verb bridge (${String(error)})`, {}, { cause: error })
  }
  const outcome = await collectVerbProcess(child).catch((error: unknown) => {
    throw new RemoteError('gateway/internal', `web-app: ${error instanceof Error ? error.message : String(error)}`, {}, { cause: error })
  })
  // The bridge answers a failed verb with exit code 1, so the exit code is not
  // the verdict: the printed response line is.
  const line = outcome.stdout.trim().split(/\r?\n/u).at(-1) ?? ''
  try {
    return JSON.parse(line) as RunVerbResult
  } catch (error) {
    const detail = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
    throw new RemoteError('gateway/internal', `web-app: the verb bridge printed no JSON response (exit ${String(outcome.code)}): ${detail.slice(0, 2000)}`, {}, { cause: error })
  }
}

/** Read every thesis manifest; unreadable files are skipped with a problem line. */
async function readOverviewTheses(problems: string[]): Promise<AssetOverviewThesis[]> {
  const dir = join(assetLibraryDir(), 'theses')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: AssetOverviewThesis[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.yaml')) continue
    const id = name.slice(0, -'.yaml'.length)
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf-8')
    } catch (error) {
      problems.push(`thesis "${id}" is unreadable (${String(error)})`)
      continue
    }
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      problems.push(`thesis "${id}" is not valid YAML`)
      continue
    }
    const data = doc.toJS() as Record<string, unknown> | null
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      problems.push(`thesis "${id}" is not a mapping`)
      continue
    }
    const str = (key: string): string => typeof data[key] === 'string' ? data[key] : ''
    const checks = Array.isArray(data.checks) ? data.checks : []
    const last = checks.length === 0 ? undefined : checks.at(-1) as Record<string, unknown> | undefined
    const status = last !== undefined && (last.outcome === 'hit' || last.outcome === 'miss') ? last.outcome : 'open'
    const checkedOnOrAfter = checks.some((check) => {
      const at = (check as { checked_at?: unknown }).checked_at
      return typeof at === 'string' && at.slice(0, 10) >= str('due_date')
    })
    out.push({
      id: str('id') || id,
      conclusion: str('conclusion'),
      metric: str('metric'),
      threshold: str('threshold'),
      due_date: str('due_date'),
      report: str('report'),
      assets: Array.isArray(data.assets) ? data.assets.filter((a): a is string => typeof a === 'string') : [],
      status,
      overdue: !checkedOnOrAfter && str('due_date') !== '' && str('due_date') < localToday(),
      check_count: checks.length,
    })
  }
  return out
}

/** The roster's modes and flows, straight from the agent-preset service. */
async function readOverviewFlows(ctx: Context): Promise<AssetOverviewFlow[]> {
  const roster = ctx.get('agentPresets')
  if (roster === undefined) return []
  const presets = await roster.list()
  return presets.map(preset => ({
    presetId: preset.id,
    name: preset.name ?? preset.id,
    modeKind: preset.modeKind ?? 'free',
    steps: preset.flow?.steps.map(step => ({
      id: step.id,
      label: step.label,
      model: step.model,
      ...step.prompt === undefined ? {} : { prompt: step.prompt },
      ...step.cluster === undefined ? {} : {
        cluster: {
          ...step.cluster.perspectives === undefined ? {} : { perspectives: [...step.cluster.perspectives] },
          ...step.cluster.strategy === undefined ? {} : { strategy: step.cluster.strategy },
        },
      },
    })) ?? [],
  }))
}

/** One workspace's `output/*.md` reports, first heading as the title. */
async function readOverviewReports(ctx: Context, problems: string[]): Promise<AssetOverviewReport[]> {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return []
  const out: AssetOverviewReport[] = []
  for (const workspace of registry.list()) {
    let names: string[]
    try {
      names = await readdir(join(workspace.path, 'output'))
    } catch {
      continue
    }
    for (const name of names.sort().reverse()) {
      if (!name.endsWith('.md') || out.length >= 200) continue
      const file = join(workspace.path, 'output', name)
      try {
        const info = await stat(file)
        const head = (await readFile(file, 'utf-8')).slice(0, 512)
        const heading = head.split('\n').find(line => line.startsWith('# '))
        out.push({
          workspaceId: String(workspace.id),
          workspaceTitle: workspace.title,
          file: `output/${name}`,
          title: heading === undefined ? name : heading.slice(2).trim(),
          modifiedAt: info.mtime.toISOString(),
          bytes: info.size,
        })
      } catch (error) {
        problems.push(`report ${name} of workspace "${workspace.title}" is unreadable (${String(error)})`)
      }
    }
  }
  return out.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
}

/** One stored schedule record, read defensively from a projection wire value. */
interface StoredSchedule {
  readonly id: string
  readonly kind: string
  readonly prompt: string
  readonly scheduledAt: string
  readonly everySeconds?: number
  readonly paused?: boolean
}

/** Validate one projection wire value into a stored schedule, or undefined. */
function storedSchedule(value: unknown): StoredSchedule | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.kind !== 'string') return undefined
  if (typeof record.prompt !== 'string' || typeof record.scheduledAt !== 'string') return undefined
  return {
    id: record.id,
    kind: record.kind,
    prompt: record.prompt,
    scheduledAt: record.scheduledAt,
    ...typeof record.everySeconds === 'number' ? { everySeconds: record.everySeconds } : {},
    ...typeof record.paused === 'boolean' ? { paused: record.paused } : {},
  }
}

/**
 * Read-only Remote over every stored session's schedules.
 * Live sessions answer from the live projection; stored sessions answer from
 * the projection cache's checkpoint (never opening a log, never taking a
 * write handle). Sessions with no readable row are counted, not hidden.
 */
export class ScheduleOverviewGateway extends TypertRemoteService {
  static inject = ['sessionPersistence', 'sessions', 'sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'scheduleOverview')
  }

  /**
   * Every scheduled run across stored sessions, soonest first.
   * @returns the schedule overview with its entries and unreadable-session count.
   */
  @Remote
  async schedules(): Promise<ScheduleOverview> {
    const entries: ScheduleOverview['entries'] = []
    let unreadable = 0
    const cache = this.ctx.get('sessionProjectionCache')
    const now = Date.now()
    for (const { header } of await this.ctx.sessionPersistence.list()) {
      const live = this.ctx.sessions.get(header.id)
      let block: ProjectionSnapshot | undefined
      try {
        if (live !== undefined) {
          block = this.ctx.sessionProjections.snapshot(live, ['schedule', 'title'])
        } else if (!header.isSeeded) {
          block = cache?.cachedSnapshot(header, SessionLogOffset(0), ['schedule', 'title'])
        }
      } catch {
        unreadable += 1
        continue
      }
      if (block === undefined) {
        unreadable += 1
        continue
      }
      const raw = block.values.schedule ?? []
      const title = typeof block.values.title === 'string' && block.values.title !== ''
        ? block.values.title
        : String(header.id)
      for (const value of raw) {
        const record = storedSchedule(value)
        if (record === undefined) continue
        entries.push({
          sessionId: String(header.id),
          sessionTitle: title,
          id: record.id,
          kind: record.kind,
          prompt: record.prompt,
          scheduledAt: record.scheduledAt,
          ...record.everySeconds === undefined ? {} : { everySeconds: record.everySeconds },
          ...record.paused === undefined ? {} : { paused: record.paused },
          overdue: Date.parse(record.scheduledAt) <= now,
          live: live !== undefined,
        })
      }
    }
    entries.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
    return { entries, unreadable }
  }
}

/** A raw identity string: non-empty with no surrounding whitespace. */
function isRawScheduleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

/** Whether one wire request carries both raw schedule-control ids. */
function isScheduleControlRequest(value: unknown): value is ScheduleControlRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return isRawScheduleId(record.sessionId) && isRawScheduleId(record.scheduleId)
}

/**
 * Write-side Remote for one Session-local schedule: pause, resume, and delete
 * by (sessionId, scheduleId). Thin adapter over the schedule package's
 * management API — durable mutation lives there. JSON string parameters on
 * purpose: Typert Session/Agent lookups in this profile resume cold
 * sessions, which must not happen as a side effect of a pause.
 */
export class ScheduleControlGateway extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'scheduleControl')
  }

  /**
   * Pause one schedule, live or stored.
   * @param request - the owning session id and the schedule id within it.
   * @returns the management outcome; domain failures are values, never rejections.
   * @throws RemoteError `gateway/invalid-request` when either id is missing, empty, or whitespace-padded.
   */
  @Remote
  async pause(request: ScheduleControlRequest): Promise<ScheduleManagementResult> {
    if (!isScheduleControlRequest(request)) {
      throw new RemoteError('gateway/invalid-request', 'scheduleControl: sessionId and scheduleId must be non-empty strings', {})
    }
    return pauseSchedule(this.ctx, request.sessionId, request.scheduleId)
  }

  /**
   * Resume one paused schedule, live or stored.
   * @param request - the owning session id and the schedule id within it.
   * @returns the management outcome; domain failures are values, never rejections.
   * @throws RemoteError `gateway/invalid-request` when either id is missing, empty, or whitespace-padded.
   */
  @Remote
  async resume(request: ScheduleControlRequest): Promise<ScheduleManagementResult> {
    if (!isScheduleControlRequest(request)) {
      throw new RemoteError('gateway/invalid-request', 'scheduleControl: sessionId and scheduleId must be non-empty strings', {})
    }
    return resumeSchedule(this.ctx, request.sessionId, request.scheduleId)
  }

  /**
   * Delete one schedule, live or stored.
   * @param request - the owning session id and the schedule id within it.
   * @returns the removal outcome; domain failures are values, never rejections.
   * @throws RemoteError `gateway/invalid-request` when either id is missing, empty, or whitespace-padded.
   */
  @Remote
  async deleteSchedule(request: ScheduleControlRequest): Promise<ScheduleRemovalResult> {
    if (!isScheduleControlRequest(request)) {
      throw new RemoteError('gateway/invalid-request', 'scheduleControl: sessionId and scheduleId must be non-empty strings', {})
    }
    return deleteSchedule(this.ctx, request.sessionId, request.scheduleId)
  }
}

/** Read-only Remote over the research-asset page's four data tabs. */
export class AssetOverviewGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'assetOverview')
  }

  /**
   * One snapshot of assets, theses, mode flows, and workspace reports. Every
   * reader is independently contained; a failing source answers empty and
   * names itself in `problems` so the page never hides data loss silently.
   * @returns the asset overview with each source's data and any problems.
   */
  @Remote
  async overview(): Promise<AssetOverview> {
    const problems: string[] = []
    const [assets, theses, flows, reports] = await Promise.all([
      readOverviewAssets(problems),
      readOverviewTheses(problems),
      readOverviewFlows(this.ctx),
      readOverviewReports(this.ctx, problems),
    ])
    const hits = theses.reduce((total, thesis) => total + (thesis.status === 'hit' ? 1 : 0), 0)
    const misses = theses.reduce((total, thesis) => total + (thesis.status === 'miss' ? 1 : 0), 0)
    return {
      assets,
      theses: {
        items: theses,
        score: { hits, misses, hit_rate: hits + misses === 0 ? null : Number((hits / (hits + misses)).toFixed(4)) },
      },
      flows,
      reports,
      problems,
    }
  }

  /**
   * The data-environment probe: venv presence, Python version, key modules.
   * @returns the probe report the data-environment page renders.
   */
  @Remote
  dataEnv(): Promise<DataEnvReport> {
    return probeDataEnv()
  }

  /**
   * Every asset the library's index registers, as the asset page's grid, list,
   * and lineage views read it. The client filters and sorts; the server only
   * computes what it alone can — the version directory and the freshness
   * verdict.
   * @returns the asset summaries and any per-index read problems.
   */
  @Remote
  assetLibrary(): Promise<AssetLibrary> {
    const problems: string[] = []
    return readAssetLibraryIndex(problems, localToday()).then(assets => ({ assets, problems }))
  }

  /**
   * One asset version's face: the parsed face.json, its manifest fields, and
   * the absolute directory both were read from. A manifest that declares no
   * face answers null — the page then renders its own default face for the kind.
   * @param request - the asset name and, optionally, the version (default: latest).
   * @returns the face, manifest, directory, and resolved version.
   * @throws RemoteError `asset/not-found` for an unknown asset or version; `asset/face-invalid` for an unreadable or malformed manifest or face.
   */
  @Remote
  async assetFace(request: { asset: string; version?: number }): Promise<AssetFaceResult> {
    const read = await readAssetFace(request.asset, request.version)
    return {
      face: read.face,
      manifest: assetFaceManifestOf(read.manifest),
      dir: read.dir,
      version: read.version,
    }
  }

  /**
   * One text file inside an asset version directory, decoded as UTF-8 — the
   * `embed` block's document. A face embeds the asset's own page, never host
   * content, so the path is confined to the version directory and to the text
   * suffixes {@link ASSET_FILE_SUFFIXES} names.
   * @param request - the asset, the version-relative path, and optionally the version (default: latest).
   * @returns the file text and the path as requested.
   * @throws RemoteError `asset/not-found` for an unknown asset, version, or file, and for a path outside the version directory or outside the text whitelist; `asset/file-too-large` past the read bound; `asset/file-not-text` for bytes that are not UTF-8.
   */
  @Remote
  assetFile(request: AssetFileRequest): Promise<AssetFileResult> {
    return readAssetFile(request.asset, request.path, request.version)
  }

  /**
   * Run one verb of one asset version through the finance venv's verb bridge,
   * exactly as `finance/face-spec/verb-bridge.md` defines it. This is the
   * user's own gesture from a face, so it needs no approval seam; the gateway
   * forwards the request and returns the response unchanged.
   * @param request - the asset, verb, and optional version and params.
   * @returns the verb-bridge response, forwarding a failed verb as `status='error'`.
   * @throws RemoteError `gateway/internal` when the bridge cannot run or overruns its timeout.
   */
  @Remote
  runVerb(request: RunVerbRequest): Promise<RunVerbResult> {
    return runVerbBridge(request)
  }

  /**
   * The Chinese seed text a "hand to AI" entry sends as a new session's first
   * message: the asset, its version directory, and its manifest facts, so the
   * agent starts on the real files instead of asking which asset was meant.
   * @param request - the asset name and, optionally, the version (default: latest).
   * @returns the seed text.
   * @throws RemoteError `asset/not-found` for an unknown asset or version; `asset/face-invalid` for an unreadable manifest.
   */
  @Remote
  async assetBrief(request: { asset: string; version?: number }): Promise<AssetBriefResult> {
    const read = await readAssetFace(request.asset, request.version)
    const manifest = assetFaceManifestOf(read.manifest)
    return { seed: assetBriefSeed(request.asset, { manifest, dir: read.dir, version: read.version }) }
  }
}

/**
 * Mount the Web runtime: dist serving, surface prompt, the bash runtime
 * variable, the URL line, and the default-browser handoff.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts)
  // The plugin page's toggle path: a Remote service over the user patch layer
  // (`$DSH_HOME/cordis.patch.yml`), mounted beside this runtime glue so the
  // Web surface owns its own configuration write-back.
  ctx.plugin(PluginPatchGateway)
  // The research-asset page's read-only data source: asset index, thesis
  // registry, mode flows, and workspace reports.
  ctx.plugin(AssetOverviewGateway)
  // The data-environment page's downloadable components: what is installed,
  // one install job at a time, and its progress stream.
  ctx.plugin(ComponentCatalogGateway)
  // The schedule page's read-only source: stored sessions' schedules.
  ctx.plugin(ScheduleOverviewGateway)
  // The schedule page's write side: pause and resume ride the schedule
  // package's own durable management path.
  ctx.plugin(ScheduleControlGateway)
  // This process's own lifecycle: the sidebar's restart control re-executes the
  // invocation in place instead of asking the operator to relaunch the app.
  ctx.plugin(SystemGateway)
  // The browser user's display name rides the settings service so the shell
  // reads and writes it through the existing settings Remote namespace —
  // nothing new on the wire. Registration may land after a client asked
  // (settings describe/update return the namespace's own diagnostics), and a
  // profile without the web surface simply never registers it.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      USER_PROFILE_NAMESPACE,
      UserProfileSettingsSchema,
      { base: { displayName: '' } },
    )
  })
  // The loopback URL belongs to this host. Under SSH, the operator reaches it
  // through a local forwarding address that this process cannot derive.
  const handoffBrowser = config.openBrowser && !launchedThroughSsh(ctx)
  // Release dependent rows only after bind-dependent trust has been sampled once.
  ctx.provide(WEB_RUNTIME_SERVICE, runtime)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      promptCtx.systemPrompt.section({
        name: 'app:web-surface',
        order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
        text: () => webSurfacePrompt(localWebUrl(promptCtx)),
      })
    })
    ctx.inject(['shellEnv'], (runtimeCtx) => {
      runtimeCtx.shellEnv.register({
        name: 'web-runtime',
        variables: {
          [DSH_WEB_URL]: { description: 'Canonical local URL of the FinDeck Web GUI serving this session.' },
        },
        resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx) }),
      })
    })
  }
  if (config.printUrl || handoffBrowser) {
    ctx.inject(['connection'], (connectionCtx) => {
      // The URL line and browser handoff are readiness signals: supervisors RPC
      // as soon as they observe the line, while a browser requests the page as
      // soon as it opens. Neither may run while sibling rows such as the /api
      // route owner are still mounting. Await Loader settlement first; a
      // hand-built tree without a Loader is already the complete tree.
      const announceReady = (): void => {
        if (ANNOUNCED_ROOTS.has(connectionCtx.root)) return
        const webUrl = localWebUrl(connectionCtx)
        const authenticatedUrl = connectionCtx.connection.authenticatedUrl(webUrl)
        // Reuse the exact LAN snapshot provided to the /api trust fence.
        const lanCandidate = runtime.lanAddresses[0]
        const port = connectionCtx.webServer.port
        const lanUrl = lanCandidate === undefined
          ? undefined
          : connectionCtx.connection.authenticatedUrl(`http://${lanCandidate}:${String(port)}`)
        ANNOUNCED_ROOTS.add(connectionCtx.root)
        if (config.printUrl) {
          console.log(`dsh web: ${authenticatedUrl}${lanUrl === undefined ? '' : ` (LAN: ${lanUrl})`}`)
        }
        if (handoffBrowser) {
          console.log('dsh web: opening the default browser; pass --no-open to disable')
          void internals.openBrowser(authenticatedUrl).catch((error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error)
            console.error(`web-app: could not open the default browser because ${reason}; use the dsh web URL printed at startup`)
          })
        }
      }
      // This row's own activation can precede a sibling failure. The app owns
      // readiness by waiting for its Loader tree, or announces at once in a
      // hand-built tree without Loader.
      const settled = connectionCtx.get('loader')?.await()
      if (settled === undefined) announceReady()
      else {
        void settled.then(() => {
          // The tree can be disposed while the boot was in flight (early
          // SIGTERM); a URL line or browser tab for a dead server would only
          // mislead, and reading torn-down services would turn a clean shutdown
          // into a crash.
          if (connectionCtx.get('webServer') !== undefined
            && connectionCtx.get('connection') !== undefined) announceReady()
        // Loader reports a failed boot; this row only stays quiet.
        }, () => {})
      }
    })
  }
}
