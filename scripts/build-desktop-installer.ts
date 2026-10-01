/**
 * Build the FinDeck Windows desktop installer: an unsigned NSIS setup
 * executable that runs the web UI in an Electron window and ships the whole
 * server runtime, so the installed app never asks the user for Node.js.
 *
 * The server is NOT an asar application. Three resolutions in the finance layer
 * are relative to the installation root -- `finance/skills` and
 * `runtime/primary-runtime` named by `packages/bundle/base/cordis.patch.yml`,
 * and `finance/python/.venv` derived from `packages/bundle/web-app`'s own
 * module URL -- so the installer carries the same repository layout as the
 * checkout, with each workspace package's built output on the path the
 * checkout uses.
 *
 * Route: `pnpm deploy --legacy --prod --node-linker=hoisted` materializes a
 * symlink-free dependency closure (the route
 * `scripts/build-exe-for-python-sdk.ts` established). Three passes complete
 * what that route cannot express on its own -- hoisted direct dependencies,
 * files a package's `files` list drops while its `exports` map still names
 * them, and surviving `link:` overrides -- and the repository-layout trees are
 * copied on top. electron-builder then maps the staged tree to
 * `resources/server` and packs the shell.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define the shipped server runtime. */
const CLOSURE_PACKAGE = 'dsh-desktop-runtime-closure'
/** Deploy source whose `node_modules` holds what the legacy hoister hoists beside the target. */
const CLOSURE_SOURCE_DIR = 'apps/desktop-runtime-closure'
/** The desktop shell package electron-builder packs. */
const DESKTOP_PACKAGE = '@deepseek-ai/dsh-desktop'
/** Build scratch root; gitignored, and refilled at the start of every run. */
const BUILD_DIR = '.tmp/desktop-installer'
/** Staged runtime tree electron-builder copies to `resources/server`. */
const SERVER_DIR = `${BUILD_DIR}/server`
/** Repository-root artifact directory. */
const RELEASE_DIR = 'release'
/** The CLI entry the packaged shell spawns; kept at its checkout path. */
const ENTRY_BIN = 'apps/cli/lib/bin.js'
/**
 * The Node runtime the shell spawns the server with, at the path the shell
 * looks for it. The harness cannot run on Electron's Node (the loader's
 * `node-addon-require-builtin` refuses this Electron build, and `dsh-skill-office`
 * refuses to activate under Electron), so the installer carries a real Node.
 */
const NODE_BIN = 'runtime/node/bin/node.exe'
/** Node version staged as {@link NODE_BIN}; must satisfy the root `engines.node` range. */
const NODE_VERSION = '22.22.0'
/** Node distribution landing point inside the staged tree. */
const NODE_DIR = 'runtime/node'
/** Default source of the Node distribution; override with `FINDECK_NODE_MIRROR`. */
const DEFAULT_NODE_MIRROR = 'https://npmmirror.com/mirrors/node/'
/** Frontend assets the web server serves, resolved through this package's own `exports`. */
const FRONTEND_DIST = 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'

/**
 * Repository-layout trees copied on top of the closure. The dependency closure
 * holds the built workspace packages; what it cannot hold is the checkout
 * structure the finance layer and the profile composer resolve against.
 */
const EXTRA_TREES = [
  // `dsh.configTrees` in apps/cli/package.json names this directory relative to
  // the CLI package, so the shipped preset trees must exist at that path.
  'packages/preset/agent-presets/presets',
  'finance/skills',
  'finance/pipelines',
  'finance/face-spec',
  'finance/workbenches',
  'config-examples',
]

/**
 * Deliberately NOT copied, although `packages/bundle/base/cordis.patch.yml`
 * resolves `runtime/primary-runtime` against the installation root.
 *
 * That tree is a machine-local payload (`/runtime/` is gitignored) whose
 * `dependencies/Lib` and `dependencies/python/Lib` are junctions into the
 * absolute path of the venv that assembled it. Copying it dereferenced would
 * ship the whole Python environment -- megabytes the installer is meant to
 * leave to the component center -- and copying it as links would leave two
 * junctions pointing at a path no fresh installation has. The row therefore
 * resolves to a directory the deployment assembles after the component center
 * installs Python, exactly as `finance/python/.venv` does.
 */
const EXCLUDED_LOCAL_TREES = ['runtime/primary-runtime']

/**
 * Extensions kept from `finance/python`. The venv, the pip scratch directories,
 * and the compiled caches are excluded by construction: the Python environment
 * is a component the user downloads from the app's own component center, not
 * part of the installer.
 */
const FINANCE_PYTHON_EXTENSIONS = new Set(['.py', '.txt', '.ps1', '.sh', '.json', '.md'])

/** Paths the closure must contain for the packaged server to boot; a miss fails the build. */
const REQUIRED_PATHS = [
  ENTRY_BIN,
  NODE_BIN,
  FRONTEND_DIST,
  'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-agent-presets/presets',
  'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
  'node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe',
  'node_modules/@koromix/koffi-win32-x64',
  'node_modules/@deepseek-ai/libreoffice-kit-win32-x64',
  'finance/skills',
]

/**
 * Source maps, and the two optional agent backends. The backends are peers the
 * web profile never loads; they become reachable only through `dsh plugin add`,
 * which installs them into the Harness home.
 */
const PRUNED_PACKAGES = ['@openai/codex', '@anthropic-ai/claude-agent-sdk']

/** A child-process invocation, plus whether Node needs a shell to start it. */
interface Invocation {
  readonly command: string
  readonly args: string[]
  readonly shell: boolean
}

/** Resolved CLI configuration. */
interface BuildCli {
  /** Skip `pnpm run build`; `lib/` and `dist/` artifacts must already exist. */
  readonly skipBuild: boolean
  /** Print every step without executing or writing anything. */
  readonly dryRun: boolean
}

/**
 * Parse argv. `--help` exits 0; a malformed flag exits 1.
 * @param argv - raw arguments (`process.argv.slice(2)`).
 * @returns the validated configuration.
 */
function parseCli(argv: string[]): BuildCli {
  let values: { 'skip-build': boolean; 'dry-run': boolean; help: boolean }
  try {
    values = parseArgs({
      args: argv,
      options: {
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  } catch (error) {
    console.error(`build-desktop-installer: ${error instanceof Error ? error.message : String(error)}\n`)
    console.error(usage())
    process.exit(1)
  }
  if (values.help) {
    console.log(usage())
    process.exit(0)
  }
  return { skipBuild: values['skip-build'], dryRun: values['dry-run'] }
}

/** @returns the command's help text. */
function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/build-desktop-installer.ts [flags]',
    '',
    '  --skip-build  skip `pnpm run build` (lib/ and apps/web/dist must already exist).',
    '  --dry-run     print every command and filesystem change without executing.',
    '  --help        print this help.',
    '',
    `Builds an unsigned NSIS installer and the unpacked app under ${RELEASE_DIR}/.`,
    `The staged server runtime lives in ${SERVER_DIR} between runs.`,
    'The first run downloads the Node runtime the server runs on and the Electron',
    'distribution plus electron-builder\'s own tools; point any of them at a mirror',
    'when GitHub or nodejs.org is slow or unreachable:',
    '  FINDECK_NODE_MIRROR=https://npmmirror.com/mirrors/node/',
    '  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/',
    '  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/',
  ].join('\n')
}

/**
 * Resolve the pnpm invocation. `pnpm run` exports `npm_execpath`; a bare
 * `tsx scripts/...` invocation does not, and on Windows the `pnpm` on PATH is a
 * shim script Node refuses to spawn without a shell, so the corepack entry
 * beside the running Node is the fallback.
 * @param args - arguments to pass to pnpm.
 * @returns the command, its arguments, and whether a shell is required.
 */
function pnpmInvocation(args: string[]): Invocation {
  const entrypoint = process.env.npm_execpath?.trim()
  if (entrypoint !== undefined && entrypoint !== '') {
    if (/\.(?:c?js|mjs)$/u.test(entrypoint)) {
      return { command: process.execPath, args: [entrypoint, ...args], shell: false }
    }
    if (process.platform !== 'win32') return { command: entrypoint, args, shell: false }
  }
  const corepack = resolve(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js')
  if (existsSync(corepack)) return { command: process.execPath, args: [corepack, ...args], shell: false }
  const home = process.env.PNPM_HOME?.trim()
  if (home !== undefined && home !== '') {
    const packageBin = resolve(home, '..', 'pnpm', 'bin')
    for (const filename of ['pnpm.mjs', 'pnpm.cjs']) {
      const candidate = resolve(packageBin, filename)
      if (existsSync(candidate)) return { command: process.execPath, args: [candidate, ...args], shell: false }
    }
  }
  return { command: 'pnpm', args, shell: true }
}

/**
 * Render a command for logs and errors.
 * @param invocation - the command and its arguments.
 * @returns the printable command line, quoting arguments that contain spaces.
 */
function formatCommand(invocation: Invocation): string {
  return [invocation.command, ...invocation.args]
    .map(part => (part.includes(' ') ? JSON.stringify(part) : part))
    .join(' ')
}

/** One build run: the parsed configuration plus the staging and output paths. */
class DesktopInstallerBuild {
  /** Cleared and refilled by {@link deployClosure}. */
  readonly server = resolve(root, SERVER_DIR)
  private readonly buildDir = resolve(root, BUILD_DIR)
  private readonly releaseDir = resolve(root, RELEASE_DIR)

  constructor(private readonly cli: BuildCli) {}

  /** Build every package artifact and the web shell unless `--skip-build` was passed. */
  async buildArtifacts(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-desktop-installer: skipping pnpm run build (--skip-build)')
      return
    }
    await this.run('build', pnpmInvocation(['run', 'build']), { cwd: root })
  }

  /**
   * Materialize the runtime closure into the staging directory. Each pass
   * completes something `pnpm deploy` cannot express on its own, so the tree it
   * produces is repaired rather than replaced.
   */
  async deployClosure(): Promise<void> {
    if (this.server === root || root.startsWith(this.server + sep)) {
      throw new Error(`build-desktop-installer: refusing to clear staging dir ${this.server}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`build-desktop-installer: [dry-run] rm -rf ${this.server}`)
    else await rm(this.server, { recursive: true, force: true })
    const workspaceState = await this.readWorkspaceState()
    try {
      await this.run('deploy runtime closure', pnpmInvocation([
        '--filter',
        CLOSURE_PACKAGE,
        'deploy',
        '--legacy',
        '--prod',
        '--config.node-linker=hoisted',
        '--config.auto-install-peers=false',
        '--config.link-workspace-packages=true',
        this.server,
      ]), { cwd: root })
    } finally {
      // `deploy`'s own flags are workspace-level configuration, so pnpm records
      // them as the settings this checkout was installed with. Left in place,
      // the next `pnpm install` reads a hoisted/production layout where the
      // developer's tree is isolated, decides the modules directory must be
      // rebuilt, and refuses to do so without a terminal. The deploy does not
      // touch that directory, so restoring the record keeps it truthful.
      await this.writeWorkspaceState(workspaceState)
      await this.repairCheckout()
    }
    if (this.cli.dryRun) {
      console.log('build-desktop-installer: [dry-run] restore legacy hoists, dropped files, and staged links')
      return
    }
    await this.restoreLegacyHoists()
    await this.restoreDroppedFiles()
    await this.materializeStagedLinks()
  }

  /**
   * Put the checkout's own modules back. `pnpm deploy --legacy` runs a
   * production install for the target and leaves the workspace packages'
   * `node_modules` behind it pruned, so a `dsh` or `pnpm run dev` in the same
   * tree would no longer resolve the workspace dependencies it did before. A
   * failure here is reported rather than thrown: the installer this run
   * produces is already complete, and the repair is one `pnpm install`.
   */
  private async repairCheckout(): Promise<void> {
    if (this.cli.dryRun) return
    try {
      await this.run('restore the checkout', pnpmInvocation(['install', '--reporter=append-only']), { cwd: root })
    } catch (error) {
      console.error('build-desktop-installer: could not restore the checkout after the deploy')
      console.error(`build-desktop-installer: ${error instanceof Error ? error.message : String(error)}`)
      console.error('build-desktop-installer: run `pnpm install` before using this source tree again.')
    }
  }

  /** @returns the recorded module-layout settings of this checkout, or undefined when there is none. */
  private async readWorkspaceState(): Promise<string | undefined> {    const path = join(root, 'node_modules', '.pnpm-workspace-state-v1.json')
    if (this.cli.dryRun || !existsSync(path)) return undefined
    return readFile(path, 'utf8')
  }

  /** @param state - the contents {@link readWorkspaceState} captured, if any. */
  private async writeWorkspaceState(state: string | undefined): Promise<void> {
    if (state === undefined) return
    const path = resolve(root, 'node_modules', '.pnpm-workspace-state-v1.json')
    if (this.cli.dryRun) {
      console.log(`build-desktop-installer: [dry-run] restore ${path}`)
      return
    }
    if (await readFile(path, 'utf8') === state) return
    await writeFile(path, state)
    console.log('build-desktop-installer: restored the checkout\'s recorded pnpm module-layout settings')
  }

  /**
   * Copy the direct dependencies the legacy hoister places beside the deploy
   * source instead of into the target. Nested `node_modules` trees are dropped
   * so the closure keeps one flat Cordis instance.
   */
  private async restoreLegacyHoists(): Promise<void> {
    const manifest = JSON.parse(await readFile(join(this.server, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const source = resolve(root, CLOSURE_SOURCE_DIR, 'node_modules')
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.server, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const from = join(source, dependency)
      if (!existsSync(from)) {
        throw new Error(`build-desktop-installer: ${dependency} is absent from both ${destination} and ${from}.`)
      }
      if (this.cli.dryRun) {
        console.log(`build-desktop-installer: [dry-run] restore ${dependency} from ${from}`)
      } else {
        await mkdir(dirname(destination), { recursive: true })
        await copyTree(from, destination)
      }
      restored.push(dependency)
    }
    console.log(`build-desktop-installer: restored ${restored.length} legacy hoist(s)`)
    for (const entry of restored) console.log(`  ${entry}`)
  }

  /**
   * Re-add the files `pnpm deploy` dropped because a workspace package's
   * `files` list excludes a path its own `exports` map still names, plus any
   * relative import a shipped module makes to a file that is missing. Both are
   * invisible in a checkout, where module resolution reads the whole package.
   */
  private async restoreDroppedFiles(): Promise<void> {
    const workspace = await workspacePackageDirs()
    const restored: string[] = []
    for (const packageDir of await nodeModulesPackageDirs(join(this.server, 'node_modules'))) {
      const manifestPath = join(packageDir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        name?: string
        main?: string
        exports?: unknown
      }
      const name = manifest.name
      const source = name === undefined ? undefined : workspace.get(name)
      if (name === undefined || source === undefined) continue

      const targets: string[] = []
      collectExportTargets(manifest.exports, targets)
      if (typeof manifest.main === 'string') targets.push(manifest.main)
      const missing = new Set<string>()
      for (const target of targets) {
        if (!target.startsWith('./') || target.includes('*')) continue
        if (!existsSync(join(packageDir, target))) missing.add(target.slice('./'.length))
      }
      for (const importer of await listFiles(packageDir)) {
        if (!/\.(?:js|cjs|mjs)$/u.test(importer)) continue
        const text = await readFile(importer, 'utf8')
        for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)['"](\.[^'"]+)['"]/gu)) {
          const specifier = match[1]
          if (specifier === undefined) continue
          const target = relativeTarget(packageDir, importer, specifier)
          if (target !== undefined) missing.add(target)
        }
      }

      for (const target of missing) {
        const from = join(source, target)
        if (!existsSync(from) || !statSync(from).isFile()) continue
        if (this.cli.dryRun) {
          console.log(`build-desktop-installer: [dry-run] restore ${name}/${target}`)
        } else {
          await mkdir(dirname(join(packageDir, target)), { recursive: true })
          await cp(from, join(packageDir, target))
        }
        restored.push(`${name}/${target.replaceAll(sep, '/')}`)
      }
    }
    console.log(`build-desktop-installer: restored ${restored.length} file(s) the deploy files lists dropped`)
    for (const entry of restored) console.log(`  ${entry}`)
  }

  /**
   * Replace every remaining link with real files. The `link:` overrides for the
   * vendored `cosmokit` and `schemastery` survive the deploy as links, and an
   * installer payload must not depend on the target machine resolving them.
   */
  private async materializeStagedLinks(): Promise<void> {
    const nodeModules = join(this.server, 'node_modules')
    let link = await findSymlink(nodeModules)
    while (link !== undefined) {
      const source = await realpath(link)
      if (this.cli.dryRun) {
        console.log(`build-desktop-installer: [dry-run] materialize ${link} -> ${source}`)
        return
      }
      await rm(link, { recursive: true, force: true })
      if (statSync(source).isDirectory()) await copyTree(source, link)
      else await cp(source, link)
      console.log(`build-desktop-installer: materialized ${link}`)
      link = await findSymlink(nodeModules)
    }
  }

  /** Copy the repository-layout trees on top of the closure. */
  async copyRepositoryLayout(): Promise<void> {
    for (const tree of EXCLUDED_LOCAL_TREES) {
      if (existsSync(join(this.server, tree))) {
        throw new Error(`build-desktop-installer: ${tree} must not be staged (see EXCLUDED_LOCAL_TREES).`)
      }
    }
    await this.copyEntry()
    await this.stageNodeRuntime()
    for (const tree of EXTRA_TREES) {
      const from = resolve(root, tree)
      if (!existsSync(from)) throw new Error(`build-desktop-installer: ${tree} is missing from the checkout.`)
      if (this.cli.dryRun) {
        console.log(`build-desktop-installer: [dry-run] copy ${tree}`)
        continue
      }
      await mkdir(dirname(join(this.server, tree)), { recursive: true })
      await copyTree(from, join(this.server, tree))
    }
    await this.copyFinancePython()
  }

  /**
   * Put the CLI at its checkout path. The shell spawns this entry, and its
   * location decides the installation anchor the profile composer resolves the
   * bundle packages and their patch files from.
   */
  private async copyEntry(): Promise<void> {
    const from = resolve(root, 'apps/cli')
    const to = join(this.server, 'apps/cli')
    if (this.cli.dryRun) {
      console.log('build-desktop-installer: [dry-run] copy apps/cli/{package.json,lib}')
      return
    }
    await mkdir(to, { recursive: true })
    await cp(join(from, 'package.json'), join(to, 'package.json'))
    await cp(join(from, 'lib'), join(to, 'lib'), {
      recursive: true,
      filter: path => extname(path) !== '.tsbuildinfo',
    })
  }

  /**
   * Put the Node runtime the shell spawns the server with into the staged tree.
   * Nothing in the checkout provides it, so it is fetched once per staged tree
   * from a distribution mirror and cached between runs by the staging directory
   * itself.
   */
  async stageNodeRuntime(): Promise<void> {
    const destination = join(this.server, NODE_DIR, 'bin')
    const nodePath = join(destination, 'node.exe')
    if (existsSync(nodePath)) {
      console.log(`build-desktop-installer: reusing staged Node ${NODE_VERSION}`)
      return
    }
    const mirror = process.env.FINDECK_NODE_MIRROR?.trim() || DEFAULT_NODE_MIRROR
    const archiveName = `node-v${NODE_VERSION}-win-x64.zip`
    const url = `${mirror}${mirror.endsWith('/') ? '' : '/'}v${NODE_VERSION}/${archiveName}`
    const scratch = join(this.buildDir, 'node')
    if (this.cli.dryRun) {
      console.log(`build-desktop-installer: [dry-run] fetch ${url} -> ${nodePath}`)
      return
    }
    await mkdir(scratch, { recursive: true })
    console.log(`build-desktop-installer: fetching Node ${NODE_VERSION}: ${url}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`build-desktop-installer: ${url} answered ${response.status} ${response.statusText}`)
    }
    const archive = join(scratch, archiveName)
    await writeFile(archive, Buffer.from(await response.arrayBuffer()))
    const extracted = join(scratch, `node-v${NODE_VERSION}-win-x64`)
    await rm(extracted, { recursive: true, force: true })
    await this.run('expand Node distribution', {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${scratch}' -Force`,
      ],
      shell: false,
    }, { cwd: scratch })
    await mkdir(destination, { recursive: true })
    await cp(join(extracted, 'node.exe'), nodePath)
    await writeFile(join(this.server, NODE_DIR, 'VERSION'), `${NODE_VERSION}\n`)
    await rm(archive, { force: true })
    await rm(extracted, { recursive: true, force: true })
    console.log(`build-desktop-installer: staged Node ${NODE_VERSION} at ${nodePath}`)
  }

  /**
   * Copy the Python tooling and its installer scripts without the interpreter.
   * The venv and the pip scratch directories are exactly what the component
   * center creates later, and neither belongs in an installer.
   */
  private async copyFinancePython(): Promise<void> {
    const from = resolve(root, 'finance/python')
    const to = join(this.server, 'finance/python')
    if (this.cli.dryRun) {
      console.log(`build-desktop-installer: [dry-run] copy finance/python/{${[...FINANCE_PYTHON_EXTENSIONS].join(',')}}`)
      return
    }
    await cp(from, to, {
      recursive: true,
      filter: (path) => {
        const relative = path.slice(from.length)
        if (relative === '') return true
        const segments = relative.split(sep).filter(part => part !== '')
        if (segments.some(part => part === '.venv' || part === '__pycache__' || part.startsWith('pip-'))) return false
        if (statSync(path).isDirectory()) return true
        return FINANCE_PYTHON_EXTENSIONS.has(extname(path).toLowerCase())
      },
    })
  }

  /** Drop source maps and the optional agent backends. */
  async prune(): Promise<void> {
    const removed: string[] = []
    for (const name of PRUNED_PACKAGES) {
      const target = join(this.server, 'node_modules', name)
      if (!existsSync(target)) {
        console.log(`build-desktop-installer: ${name} is not in the closure; nothing to prune`)
        continue
      }
      if (this.cli.dryRun) {
        console.log(`build-desktop-installer: [dry-run] rm -rf ${target}`)
        continue
      }
      await rm(target, { recursive: true, force: true })
      removed.push(name)
    }
    if (removed.length > 0) console.log(`build-desktop-installer: pruned packages: ${removed.join(', ')}`)
    if (this.cli.dryRun) return
    const maps = await removeFiles(this.server, path => extname(path) === '.map')
    console.log(`build-desktop-installer: pruned ${maps.length} source map(s)`)
  }

  /** Fail before packing when the closure is missing something the server loads at boot. */
  verifyStaged(): void {
    const missing = REQUIRED_PATHS.filter(path => !existsSync(join(this.server, path)))
    if (missing.length > 0) {
      throw new Error(`build-desktop-installer: staged runtime is incomplete: ${missing.join(', ')}`)
    }
    console.log(`build-desktop-installer: verified ${REQUIRED_PATHS.length} required runtime path(s)`)
  }

  /** Print the staged tree's size and its largest parts. */
  reportSizes(): void {
    console.log(`build-desktop-installer: staged runtime: ${megabytes(directorySize(this.server))}`)
    const parts = [
      'node_modules',
      'apps',
      'packages',
      ...EXTRA_TREES,
    ].map(path => join(this.server, path)).filter(path => existsSync(path))
    const rows = parts
      .map((path): [string, number] => [path.slice(this.server.length + 1).replaceAll(sep, '/'), directorySize(path)])
      .sort((left, right) => right[1] - left[1])
    for (const [name, size] of rows) console.log(`  ${name}: ${megabytes(size)}`)
    for (const name of ['@deepseek-ai', '@vscode', '@koromix'] ) {
      const part = join(this.server, 'node_modules', name)
      if (existsSync(part)) console.log(`  node_modules/${name}: ${megabytes(directorySize(part))}`)
    }
  }

  /**
   * Run electron-builder for the NSIS target.
   *
   * The NSIS pass builds the uninstaller by running its own installer stub, and
   * NSIS refuses to write temporary files under a session-scoped `%TEMP%` such
   * as `%LOCALAPPDATA%\Temp\1`: the stub opens an "Error writing temporary
   * file" dialog and never exits, so electron-builder times out with
   * `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`. Pointing the child at a directory
   * this build owns removes the dependency on whatever the ambient TEMP happens
   * to be, and keeps that residue inside the gitignored build directory.
   */
  async packInstaller(): Promise<void> {
    const tmp = join(this.buildDir, 'tmp')
    await mkdir(this.releaseDir, { recursive: true })
    await mkdir(tmp, { recursive: true })
    await this.run(
      'electron-builder',
      pnpmInvocation(['--filter', DESKTOP_PACKAGE, 'exec', 'electron-builder', '--win', '--config', 'electron-builder.yml', '--publish', 'never']),
      { cwd: root, env: { ...process.env, TEMP: tmp, TMP: tmp } },
    )
  }

  /**
   * Fail when the packaged app does not carry the staged runtime. electron-builder
   * only logs a warning for an `extraResources` source it cannot find, so a
   * drifted path would otherwise ship a shell with no server behind it.
   */
  verifyPackaged(): void {
    if (this.cli.dryRun) return
    const unpacked = join(this.releaseDir, 'win-unpacked')
    const missing = REQUIRED_PATHS
      .map(path => join(unpacked, 'resources/server', path))
      .filter(path => !existsSync(path))
    if (missing.length > 0) {
      throw new Error(`build-desktop-installer: packaged app is missing runtime paths: ${missing.join(', ')}`)
    }
    console.log(`build-desktop-installer: verified ${REQUIRED_PATHS.length} runtime path(s) inside the packaged app`)
  }

  /** Print the produced artifacts and their sizes. */
  printProducts(): void {
    if (this.cli.dryRun) return
    const installer = join(this.releaseDir, `FinDeck Setup ${desktopVersion()}.exe`)
    const unpacked = join(this.releaseDir, 'win-unpacked')
    const products = [installer, unpacked].filter(path => existsSync(path))
    if (products.length === 0) {
      throw new Error(`build-desktop-installer: electron-builder produced no artifact under ${this.releaseDir}.`)
    }
    console.log('build-desktop-installer: products:')
    for (const path of products) console.log(`  ${path}  (${megabytes(directorySize(path))})`)
  }

  /**
   * Run one subprocess with inherited stdio. Spawn and non-zero-exit failures
   * name the command; a dry run only prints it.
   * @param label - the step name used in logs and errors.
   * @param invocation - the command to run.
   * @param options - working directory and environment.
   */
  private async run(
    label: string,
    invocation: Invocation,
    options: { cwd: string; env?: NodeJS.ProcessEnv },
  ): Promise<void> {
    const printable = formatCommand(invocation)
    if (this.cli.dryRun) {
      console.log(`build-desktop-installer: [dry-run] ${printable}`)
      return
    }
    console.log(`build-desktop-installer: ${label}: ${printable}`)
    await new Promise<void>((settle, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        stdio: 'inherit',
        shell: invocation.shell,
        env: options.env ?? process.env,
      })
      child.once('error', (error) => {
        reject(new Error(`build-desktop-installer: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          settle()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-desktop-installer: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

/** @param bytes @returns the size in megabytes with one decimal, for logs. */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Copy a directory tree, dropping the nested `node_modules` a hoisted closure
 * must not inherit. A link inside the tree would be inlined by the dereferencing
 * copy, which is how an excluded payload turns into gigabytes of someone else's
 * environment, so one found here fails the build instead.
 * @param from - source directory or link target.
 * @param to - destination directory.
 */
async function copyTree(from: string, to: string): Promise<void> {
  const link = await findSymlink(from, true)
  if (link !== undefined) {
    throw new Error(`build-desktop-installer: ${from} contains the link ${link}; a copied tree must be plain files.`)
  }
  const nested = join(from, 'node_modules')
  await cp(from, to, {
    recursive: true,
    dereference: true,
    filter: path => path !== nested && !path.startsWith(nested + sep),
  })
}

/**
 * @param directory - the directory to search.
 * @param skipNodeModules - ignore nested `node_modules` trees, which a copy drops.
 * @returns the first symbolic link below it, or undefined when there is none.
 */
async function findSymlink(directory: string, skipNodeModules = false): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipNodeModules && entry.name === 'node_modules') continue
    const path = join(directory, entry.name)
    if ((await lstat(path)).isSymbolicLink()) return path
    if (entry.isDirectory()) {
      const nested = await findSymlink(path, skipNodeModules)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Delete every file a predicate selects.
 * @param directory - the tree to walk.
 * @param remove - the predicate selecting files.
 * @returns the removed paths.
 */
async function removeFiles(directory: string, remove: (path: string) => boolean): Promise<string[]> {
  const removed: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      removed.push(...await removeFiles(path, remove))
      continue
    }
    if (!remove(path)) continue
    await rm(path, { force: true })
    removed.push(path)
  }
  return removed
}

/**
 * @param path - a file or directory.
 * @returns its recursive size in bytes.
 */
function directorySize(path: string): number {
  const info = statSync(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directorySize(join(path, entry.name))
  }
  return total
}

/**
 * Collect every non-glob file an `exports` map names.
 * @param node - the `exports` value, or a nested part of it.
 * @param out - the collected targets.
 */
function collectExportTargets(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (node === null || typeof node !== 'object') return
  for (const value of Object.values(node)) collectExportTargets(value, out)
}

/**
 * Resolve a relative import the way Node does, reporting whether the target is
 * missing from a staged package.
 * @param packageDir - the staged package root.
 * @param importer - the importing file, absolute.
 * @param specifier - the relative specifier.
 * @returns the package-relative target path when the file is missing there, else undefined.
 */
function relativeTarget(packageDir: string, importer: string, specifier: string): string | undefined {
  const base = resolve(dirname(importer), specifier)
  const candidates = [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    `${base}.json`,
    `${base}.yml`,
    `${base}.yaml`,
    join(base, 'index.js'),
    join(base, 'index.cjs'),
    join(base, 'index.json'),
  ]
  if (candidates.some(candidate => existsSync(candidate))) return undefined
  if (!base.startsWith(packageDir + sep)) return undefined
  return base.slice(packageDir.length + 1)
}

/**
 * @param directory - a tree to walk.
 * @returns every file below it, as absolute paths.
 */
async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(path))
      continue
    }
    files.push(path)
  }
  return files
}

/**
 * @param nodeModules - a `node_modules` directory.
 * @returns every installed package directory below it.
 */
async function nodeModulesPackageDirs(nodeModules: string): Promise<string[]> {
  const dirs: string[] = []
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const path = join(nodeModules, entry.name)
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(path, { withFileTypes: true })) {
        if (scoped.isDirectory()) dirs.push(join(path, scoped.name))
      }
      continue
    }
    if (entry.isDirectory()) dirs.push(path)
  }
  return dirs
}

/**
 * @returns every workspace package directory in the checkout, keyed by package name.
 */
async function workspacePackageDirs(): Promise<Map<string, string>> {
  const dirs = new Map<string, string>()
  const consider = async (directory: string): Promise<void> => {
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) return
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string }
    if (manifest.name !== undefined && !dirs.has(manifest.name)) dirs.set(manifest.name, directory)
  }
  for (const group of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupDir = join(root, 'packages', group.name)
    for (const entry of await readdir(groupDir, { withFileTypes: true })) {
      if (entry.isDirectory()) await consider(join(groupDir, entry.name))
    }
  }
  for (const tree of ['apps', 'vendor']) {
    const base = join(root, tree)
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (entry.isDirectory()) await consider(join(base, entry.name))
    }
  }
  await consider(join(root, 'native/system'))
  return dirs
}

/** @returns the desktop shell's version, which names the installer artifact. */
function desktopVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/desktop/package.json'), 'utf8')) as {
    version?: string
  }
  if (manifest.version === undefined) throw new Error('build-desktop-installer: apps/desktop/package.json has no version.')
  return manifest.version
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  const build = new DesktopInstallerBuild(cli)
  console.log(`build-desktop-installer: staging: ${build.server}`)
  await build.buildArtifacts()
  await build.deployClosure()
  await build.copyRepositoryLayout()
  await build.prune()
  if (!cli.dryRun) {
    build.verifyStaged()
    build.reportSizes()
  }
  await build.packInstaller()
  build.verifyPackaged()
  build.printProducts()
}

await main()
