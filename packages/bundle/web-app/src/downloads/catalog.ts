/**
 * The host component catalog: what each of the six downloadable runtime
 * components is, how its installed state is probed, and how it is installed.
 * One install runs at a time; its progress, its completion, and its failure are
 * published as {@link ComponentEvent}s to every follower.
 *
 * Install steps run as child processes with pip, npx, and the components' own
 * executables — never through a shell. Downloads go through the shared engine.
 * @module @deepseek-ai/dsh-web-app/downloads/catalog
 */

import { readFile, readdir, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ComponentEvent, ComponentId, ComponentInfo, ComponentProgress } from '../types.ts'
import {
  FINANCE_PYTHON_DIR,
  FINANCE_REQUIREMENTS_FILE,
  forgetDataEnvProbe,
  probeDataEnv,
  VENV_PYTHON,
  VENV_ROOT,
} from '../environment.ts'
import { downloadFromSources, raceSources } from './engine.ts'
import { runProcess, type ProcessOutcome, type ProcessRequest } from './process.ts'

/** One component's install stage. */
type InstallStage = ComponentProgress['stage']

/** One progress update an install reports; the catalog adds the component id. */
type InstallReport = Omit<ComponentProgress, 'id'>

/** What one probe observed about a component. */
interface ComponentFacts {
  readonly installed: boolean
  /** Installed version, when the component reports one. */
  readonly version?: string
  /** Why the probe could not decide, when it failed rather than answered "not installed". */
  readonly problem?: string
}

/** One running install's cancellation and progress sink. */
interface InstallRun {
  readonly signal: AbortSignal
  readonly report: (progress: InstallReport) => void
}

/** One downloadable component: how it is located, probed, and installed. */
interface ComponentSpec {
  /** Components that must be installed before this one. */
  readonly requires: readonly ComponentId[]
  /** Approximate download+install size, for the page's cost preview. */
  readonly estimateBytes: number
  /** The stage this component's install reports first; a follower that joins before the first report is told this stage. */
  readonly firstStage: InstallStage
  /** Where this component installs, for display. */
  location(): string
  probe(signal: AbortSignal): Promise<ComponentFacts>
  install(run: InstallRun): Promise<void>
}

/**
 * Every component id of the frozen catalog vocabulary, in display order;
 * {@link COMPONENTS} defines exactly these.
 */
const COMPONENT_IDS = [
  'python-venv',
  'python-ml',
  'uv',
  'pnpm',
  'playwright-chromium',
  'sensevoice-models',
] as const satisfies readonly ComponentId[]

/** Components whose only supported installation path is a Windows x64 binary. */
const WINDOWS_ONLY: readonly ComponentId[] = ['uv', 'pnpm']

/** How long one `catalog()` answer stays reusable; the installed set changes rarely. */
const CATALOG_TTL_MS = 60_000

/** Upper bound on one probe, so a hung component binary cannot hold a caller forever. */
const PROBE_TIMEOUT_MS = 30_000

/** Upper bound on one source probe; a mirror that does not answer HEAD is still tried for the file. */
const SOURCE_PROBE_TIMEOUT_MS = 5_000

/** The pip mirror `finance/python/setup-env.ps1` defaults to. */
const TSINGHUA_PIP_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple'

/** The index every pip round falls back to, and the only one a fallback round uses. */
const OFFICIAL_PIP_INDEX = 'https://pypi.org/simple'

/** The CPU-only PyTorch wheel index; these wheels carry no CUDA payload. */
const TORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu'

/** Prefix that mirrors a GitHub release asset when github.com itself is unreachable. */
const GH_PROXY_PREFIX = 'https://gh-proxy.com/'

/** The pnpm version this catalog installs; it tracks the root `packageManager` field. */
const PNPM_VERSION = '11.7.0'

/** The Playwright version this catalog installs, pinned so the browser build it fetches is reproducible. */
const PLAYWRIGHT_VERSION = '1.49.1'

/** Hugging Face file origin the SenseVoice models are published on, and its mirror. */
const HF_ORIGIN = 'https://huggingface.co'
const HF_MIRROR_ORIGIN = 'https://hf-mirror.com'

/** One release-pinned model file. */
interface ModelAsset {
  readonly name: string
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

/**
 * The SenseVoice runtime files, copied from
 * `packages/experimental/speech-to-text-sensevoice/runtime/assets.json`. Only
 * the int8 model is part of this catalog: the fp32 alternative is 938 MB and
 * the provider defaults to int8.
 */
const SENSEVOICE_MODEL: ModelAsset = {
  name: 'model.int8.onnx',
  url: `${HF_ORIGIN}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx`,
  bytes: 239233841,
  sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
}

/** The SenseVoice token table, from the same release as {@link SENSEVOICE_MODEL}. */
const SENSEVOICE_TOKENS: ModelAsset = {
  name: 'tokens.txt',
  url: `${HF_ORIGIN}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt`,
  bytes: 315894,
  sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
}

/** The Silero voice-activity model the SenseVoice provider loads beside the recognizer. */
const SENSEVOICE_VAD: ModelAsset = {
  name: 'silero_vad.onnx',
  url: `${HF_ORIGIN}/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx`,
  bytes: 1807522,
  sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
}

/** One directory this catalog installs into, under the harness home. */
function runtimesDir(...segments: string[]): string {
  return dshHomePath('runtimes', ...segments)
}

/**
 * The SenseVoice provider's `dataRoot`, as the voice-input bundle patches it
 * into the provider (`dshHomePath('speech-to-text', 'sensevoice')`).
 */
function senseVoiceDataRoot(): string {
  return dshHomePath('speech-to-text', 'sensevoice')
}

/** The SenseVoice provider's model directory, `join(dataRoot, 'models', 'sensevoice-onnx')`. */
function senseVoiceModelDir(): string {
  return join(senseVoiceDataRoot(), 'models', 'sensevoice-onnx')
}

/** The SenseVoice provider's VAD directory, `join(dataRoot, 'models', 'silero')`. */
function senseVoiceVadDir(): string {
  return join(senseVoiceDataRoot(), 'models', 'silero')
}

/** The directory Playwright unpacks browser builds into. */
function playwrightBrowsersDir(): string {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (configured !== undefined && configured.trim() !== '') return configured
  const local = process.env.LOCALAPPDATA
  return join(local === undefined || local === '' ? join(homedir(), 'AppData', 'Local') : local, 'ms-playwright')
}

/** One error's message, or the string form of a non-Error rejection. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The last output line of a finished command: stderr first, then stdout. */
function lastLine(outcome: ProcessOutcome): string {
  const tail = (text: string): string => text.trim().split(/\r?\n/u).at(-1) ?? ''
  return tail(outcome.stderr) || tail(outcome.stdout) || 'no output'
}

/** Whether a path exists, whatever it is. */
async function exists(path: string): Promise<boolean> {
  return await stat(path).then(() => true, () => false)
}

/** Parse the last line of a command's stdout as JSON; undefined when it is not JSON. */
function parseLastJsonLine(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim().split(/\r?\n/u).at(-1) ?? '') as unknown
  } catch {
    // Every child that prints JSON here is a `-c` script this catalog owns, so
    // unparseable output means it failed before printing; the caller reports
    // that from the exit code and the captured streams.
    return undefined
  }
}

/** One usable system interpreter: the command, its argument prefix, and the version it reported. */
interface SystemPython {
  readonly command: string
  readonly args: readonly string[]
  readonly version: string
}

/**
 * The first interpreter that answers `--version`, in the order
 * `finance/python/setup-env.ps1` uses: the Windows launcher's 3.x selection,
 * then a bare `python`, then `python3` for hosts without either.
 * @param signal - cancellation.
 * @returns the winning command and the version it reported.
 * @throws when no candidate answered, naming every attempt.
 */
async function findSystemPython(signal: AbortSignal): Promise<SystemPython> {
  const candidates: readonly { command: string; args: readonly string[] }[] = [
    { command: 'py', args: ['-3'] },
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
  ]
  const attempts: string[] = []
  for (const candidate of candidates) {
    try {
      const outcome = await runProcess(candidate.command, [...candidate.args, '--version'], { signal })
      const reported = `${outcome.stdout}${outcome.stderr}`.trim()
      const version = /Python (\d+\.\d+(?:\.\d+)?)/u.exec(reported)?.[1]
      if (outcome.code === 0 && version !== undefined) return { ...candidate, version }
      attempts.push(`${candidate.command}: ${reported === '' ? `exit ${String(outcome.code)}` : reported}`)
    } catch (error) {
      signal.throwIfAborted()
      attempts.push(`${candidate.command}: ${messageOf(error)}`)
    }
  }
  throw new Error(`未找到可用的系统 Python（${attempts.join('；')}）`)
}

/**
 * Run one command in the `finance/python` tree, failing unless it exits cleanly.
 * @param command - executable to run.
 * @param args - arguments, passed as an array so nothing is re-parsed.
 * @param run - the install's cancellation.
 * @param label - what to name in the failure message.
 * @param onLine - optional line sink, for parsing progress out of the command's output.
 * @returns the collected outcome of a cleanly exiting command.
 * @throws naming the command and its last output line.
 */
async function runFinance(command: string, args: readonly string[], run: { readonly signal: AbortSignal },
  label: string, onLine?: ProcessRequest['onLine']): Promise<ProcessOutcome> {
  const outcome = await runProcess(command, args, {
    cwd: FINANCE_PYTHON_DIR,
    signal: run.signal,
    ...onLine === undefined ? {} : { onLine },
  })
  if (outcome.code !== 0) throw new Error(`${label} 失败（exit ${String(outcome.code)}）：${lastLine(outcome)}`)
  return outcome
}

/** Run one pip command through the finance venv or one system interpreter. */
function pip(python: string, args: readonly string[], run: InstallRun): Promise<ProcessOutcome> {
  return runFinance(python, ['-m', 'pip', ...args], run, 'pip')
}

/**
 * The pip index an install prefers: `FD_PIP_INDEX` when set, then its
 * pre-rename alias `AD_PIP_INDEX`, otherwise the Tsinghua mirror
 * `setup-env.ps1` defaults to.
 */
function pipIndex(): string {
  const configured = process.env.FD_PIP_INDEX?.trim() ?? process.env.AD_PIP_INDEX?.trim() ?? ''
  return configured === '' ? TSINGHUA_PIP_INDEX : configured
}

/**
 * Run one pip step against the preferred index, retrying it once against the
 * official index when the preferred one was a mirror and it failed: a mirror
 * outage says nothing about the packages themselves.
 */
async function withMirrorFallback(step: (indexUrl: string) => Promise<void>, run: InstallRun): Promise<void> {
  const preferred = pipIndex()
  try {
    await step(preferred)
  } catch (error) {
    run.signal.throwIfAborted()
    if (preferred === OFFICIAL_PIP_INDEX) throw error
    run.report({ stage: 'install', message: '镜像不可用，改用官方 PyPI 重试' })
    await step(OFFICIAL_PIP_INDEX)
  }
}

/** The requirement specifiers of `requirements-data.txt`: comments and blanks dropped, file order kept. */
async function readRequirementSpecs(): Promise<string[]> {
  const text = await readFile(FINANCE_REQUIREMENTS_FILE, 'utf-8').catch((error: unknown) => {
    throw new Error(`无法读取 ${FINANCE_REQUIREMENTS_FILE}：${messageOf(error)}`)
  })
  return text.split('\n').map(line => (line.split('#')[0] ?? '').trim()).filter(line => line.length > 0)
}

/** A requirement's distribution name, without its version specifiers. */
function requirementName(spec: string): string {
  return /^[A-Za-z0-9._-]+/u.exec(spec)?.[0] ?? spec
}

/** Upgrade pip in the finance venv, mirror first and official as the fallback. */
async function upgradePip(run: InstallRun): Promise<void> {
  await withMirrorFallback(async (index) => {
    await pip(VENV_PYTHON, ['install', '--upgrade', 'pip', '--index-url', index], run)
  }, run)
}

/**
 * Install every requirement one at a time, so each finished package is its own
 * progress step rather than one opaque resolve. A mirror round that fails is
 * retried whole against the official index.
 */
async function installRequirements(run: InstallRun): Promise<void> {
  const specs = await readRequirementSpecs()
  const round = async (index: string): Promise<void> => {
    for (const [position, spec] of specs.entries()) {
      run.report({ stage: 'install', message: `${requirementName(spec)} (${String(position + 1)}/${String(specs.length)})` })
      await pip(VENV_PYTHON, ['install', spec, '--index-url', index], run)
    }
  }
  await withMirrorFallback(round, run)
}

/**
 * Register the `finance/python` tree on the venv's `sys.path`, exactly as
 * `setup-env.ps1` does, by asking the venv for its own site-packages rather
 * than deriving the versioned directory name.
 */
async function registerFinancePath(run: InstallRun): Promise<void> {
  const outcome = await runFinance(VENV_PYTHON,
    ['-c', 'import json, site; print(json.dumps(site.getsitepackages()))'], run, 'venv site-packages 查询')
  const parsed = parseLastJsonLine(outcome.stdout)
  const directory = Array.isArray(parsed) ? (parsed as readonly unknown[])[0] : undefined
  if (typeof directory !== 'string') throw new Error(`venv 未报告 site-packages 目录：${lastLine(outcome)}`)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'findeck.pth'), `${FINANCE_PYTHON_DIR}\n`, 'utf-8')
}

/** Create the finance venv if it is missing, install its requirements, and verify it. */
async function installFinanceVenv(run: InstallRun): Promise<void> {
  run.report({ stage: 'install', message: '查找系统 Python' })
  const system = await findSystemPython(run.signal)
  const created = !await exists(VENV_PYTHON)
  try {
    if (created) {
      run.report({ stage: 'install', message: `创建 venv（Python ${system.version}）` })
      await runFinance(system.command, [...system.args, '-m', 'venv', VENV_ROOT], run, 'python -m venv')
    }
    run.report({ stage: 'install', message: '升级 pip' })
    await upgradePip(run)
    await installRequirements(run)
    run.report({ stage: 'install', message: '注册 findeck 工具包' })
    await registerFinancePath(run)
    run.report({ stage: 'verify', message: '检查 Python 环境' })
    forgetDataEnvProbe()
    const report = await probeDataEnv()
    if (!report.venvExists) throw new Error(`venv 校验失败：${report.problem ?? VENV_PYTHON}`)
  } catch (error) {
    // A venv this install created is half-built when the step fails or the job
    // is cancelled, and removing it leaves the next attempt the clean start it
    // needs. A venv that already existed is left alone: its packages are in use.
    if (created) await rm(VENV_ROOT, { recursive: true, force: true })
    throw error
  }
}

/** The packages a neural-modelling install adds, and therefore what a probe looks for. */
const ML_PACKAGES = ['torch', 'neuralforecast']

/** Ask one interpreter whether every named module is importable, and for torch's own version. */
const ML_PROBE_SCRIPT = [
  'import importlib.util, importlib.metadata, json',
  `names = ${JSON.stringify(ML_PACKAGES)}`,
  'modules = {name: importlib.util.find_spec(name) is not None for name in names}',
  'try:',
  '    version = importlib.metadata.version("torch")',
  'except Exception:',
  '    version = None',
  'print(json.dumps({"modules": modules, "version": version}))',
].join('\n')

/**
 * Ask one interpreter which of `names` it can import.
 * @param python - the interpreter to run.
 * @param script - a `-c` script printing `{"modules": {...}, "version": ...}`.
 * @param names - module names that must all be importable.
 * @param signal - cancellation.
 * @returns the observed facts, with the interpreter's last output line as `problem` when it could not answer.
 */
async function probePythonModules(python: string, script: string, names: readonly string[],
  signal: AbortSignal): Promise<ComponentFacts> {
  const outcome = await runProcess(python, ['-c', script], { signal })
  const parsed = parseLastJsonLine(outcome.stdout)
  if (outcome.code !== 0 || typeof parsed !== 'object' || parsed === null) {
    return { installed: false, problem: lastLine(outcome) }
  }
  const record = parsed as Record<string, unknown>
  const modules = record.modules
  const importable = (name: string): boolean =>
    typeof modules === 'object' && modules !== null && (modules as Record<string, unknown>)[name] === true
  return {
    installed: names.every(importable),
    ...typeof record.version === 'string' ? { version: record.version } : {},
  }
}

/** Install the neural-modelling extension into the finance venv: a CPU torch wheel, then neuralforecast. */
async function installMlPackages(run: InstallRun): Promise<void> {
  if (!await exists(VENV_PYTHON)) throw new Error('需要先安装金融 Python 环境')
  // Two halves of the job: the pinned CPU wheel index for torch, then the
  // ordinary index for the rest, each reported as one step.
  run.report({ stage: 'download', message: 'torch（CPU wheel）', completedBytes: 0, totalBytes: 2 })
  await pip(VENV_PYTHON, ['install', '--index-url', TORCH_CPU_INDEX, 'torch'], run)
  run.report({ stage: 'install', message: 'neuralforecast', completedBytes: 1, totalBytes: 2 })
  await withMirrorFallback(async (index) => {
    await pip(VENV_PYTHON, ['install', 'neuralforecast', '--index-url', index], run)
  }, run)
  run.report({ stage: 'verify', message: '检查 torch 与 neuralforecast', completedBytes: 2, totalBytes: 2 })
  const facts = await probePythonModules(VENV_PYTHON, ML_PROBE_SCRIPT, ML_PACKAGES, run.signal)
  if (!facts.installed) throw new Error('torch 或 neuralforecast 仍无法导入')
}

/** The official uv release archive; the `latest` alias publishes no checksum, so this download is unhashed. */
const UV_ARCHIVE_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'

/** The uv runtime's executable. */
function uvExecutable(): string {
  return join(runtimesDir('uv'), 'uv.exe')
}

/** Probe a Windows component binary by running its own `--version`. */
async function probeExecutableVersion(executable: string, signal: AbortSignal): Promise<ComponentFacts> {
  if (!await exists(executable)) return { installed: false }
  const outcome = await runProcess(executable, ['--version'], { signal })
  const reported = `${outcome.stdout}${outcome.stderr}`
  const version = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/u.exec(reported)?.[0]
  if (outcome.code !== 0 || version === undefined) {
    return { installed: false, problem: `无法运行 ${executable}：${lastLine(outcome)}` }
  }
  return { installed: true, version }
}

/**
 * Unpack the archive members a filter keeps, then remove the archive.
 * @param archive - the downloaded archive.
 * @param directory - the directory the members are written into.
 * @param keep - whether one archive entry belongs in the installation.
 * @returns the relative paths written, in archive order.
 */
async function unpackZip(archive: string, directory: string, keep: (entry: string) => boolean): Promise<string[]> {
  const entries = unzipSync(new Uint8Array(await readFile(archive)))
  await mkdir(directory, { recursive: true })
  const written: string[] = []
  for (const [entry, content] of Object.entries(entries)) {
    if (!keep(entry)) continue
    const relative = entry.replace(/\\/gu, '/')
    // A release archive is external input: an entry that is a directory, is
    // absolute, or climbs out of the installation is not written at all.
    if (relative === '' || relative.endsWith('/') || relative.startsWith('/')
      || relative.split('/').includes('..')) continue
    const target = join(directory, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    written.push(relative)
  }
  await rm(archive, { force: true })
  return written
}

/** Download the uv archive, unpack it, and verify the executable it produced. */
async function installUv(run: InstallRun): Promise<void> {
  const archive = join(runtimesDir('uv'), 'uv-x86_64-pc-windows-msvc.zip')
  run.report({ stage: 'download', message: 'uv' })
  const sources = await raceSources([UV_ARCHIVE_URL, `${GH_PROXY_PREFIX}${UV_ARCHIVE_URL}`], SOURCE_PROBE_TIMEOUT_MS, run.signal)
  await downloadFromSources(sources, archive, {
    signal: run.signal,
    report: progress => run.report(bytesProgress('uv', progress)),
  })
  run.report({ stage: 'install', message: '解压 uv' })
  // `uvx` comes along because that is the executable an MCP server definition
  // usually names; the probe still checks `uv.exe`, the tool itself.
  const written = await unpackZip(archive, runtimesDir('uv'), entry => /(?:^|\/)uvx?\.exe$/u.test(entry))
  if (!written.includes('uv.exe')) throw new Error('uv 压缩包内没有 uv.exe')
  run.report({ stage: 'verify', message: '检查 uv 版本' })
  const facts = await probeExecutableVersion(uvExecutable(), run.signal)
  if (!facts.installed) throw new Error(`uv 校验失败：${facts.problem ?? uvExecutable()}`)
}

/**
 * The pnpm release archive, pinned to the version the repository's
 * `packageManager` field names. pnpm ships Windows as a zip of the standalone
 * executable, not as a bare `.exe`.
 */
function pnpmUrl(): string {
  return `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-win32-x64.zip`
}

/** The pnpm runtime's executable. */
function pnpmExecutable(): string {
  return join(runtimesDir('pnpm'), 'pnpm.exe')
}

/** Download the pinned pnpm archive, unpack it, and verify the executable it produced. */
async function installPnpm(run: InstallRun): Promise<void> {
  const archive = join(runtimesDir('pnpm'), 'pnpm-win32-x64.zip')
  run.report({ stage: 'download', message: `pnpm ${PNPM_VERSION}` })
  const sources = await raceSources([pnpmUrl(), `${GH_PROXY_PREFIX}${pnpmUrl()}`], SOURCE_PROBE_TIMEOUT_MS, run.signal)
  await downloadFromSources(sources, archive, {
    signal: run.signal,
    report: progress => run.report(bytesProgress('pnpm', progress)),
  })
  run.report({ stage: 'install', message: '解压 pnpm' })
  // The archive's whole tree, layout preserved: `pnpm.exe` loads `dist/pnpm.mjs`
  // from beside itself, so the executable alone would not start.
  const written = await unpackZip(archive, runtimesDir('pnpm'), () => true)
  if (!written.includes('pnpm.exe')) throw new Error('pnpm 压缩包内没有 pnpm.exe')
  run.report({ stage: 'verify', message: '检查 pnpm 版本' })
  const facts = await probeExecutableVersion(pnpmExecutable(), run.signal)
  if (!facts.installed) throw new Error(`pnpm 校验失败：${facts.problem ?? pnpmExecutable()}`)
}

/** Playwright's progress line: a percentage and, usually, the total it is a percentage of. */
const PLAYWRIGHT_PERCENT = /(\d{1,3})% of ([\d.]+) ?([KMGT]iB)/u

/** Byte sizes for the units Playwright prints. */
const BYTE_UNITS: Readonly<Record<string, number>> = {
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
  TiB: 1024 * 1024 * 1024 * 1024,
}

/** One download's byte progress, labelled with the file it belongs to. */
function bytesProgress(resource: string, progress: { completedBytes: number; totalBytes?: number }): InstallReport {
  return {
    stage: 'download',
    message: resource,
    completedBytes: progress.completedBytes,
    ...progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes },
  }
}

/**
 * Inspect the installed Chromium build.
 * @param signal - cancellation.
 * @returns the build's directory as `version`, or `installed: false` when no `chromium-*` directory exists.
 */
async function probeChromium(signal: AbortSignal): Promise<ComponentFacts> {
  signal.throwIfAborted()
  const root = playwrightBrowsersDir()
  if (!await exists(root)) return { installed: false }
  const names = await readdir(root)
  const builds = names.map(name => /^chromium-(\d+)$/u.exec(name)?.[1]).filter((build): build is string => build !== undefined)
  const build = builds.sort((left, right) => Number(right) - Number(left))[0]
  return build === undefined ? { installed: false } : { installed: true, version: build }
}

/**
 * The command that runs the pinned Playwright CLI. Windows ships the launcher as
 * `npx.cmd`, which cannot be spawned directly, so it runs through `cmd.exe /c`
 * with the arguments still passed as an array.
 */
function npxCommand(args: readonly string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npx', args: [...args] }
  return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/c', 'npx', ...args] }
}

/** Install Chromium for the pinned Playwright version, reporting the download percentage it prints. */
async function installChromium(run: InstallRun): Promise<void> {
  const command = npxCommand(['-y', `playwright@${PLAYWRIGHT_VERSION}`, 'install', 'chromium'])
  let reported = -1
  const onLine = (line: string): void => {
    const parsed = PLAYWRIGHT_PERCENT.exec(line)
    if (parsed === null) return
    const percent = Number(parsed[1])
    if (percent === reported) return
    reported = percent
    const scale = BYTE_UNITS[parsed[3] ?? '']
    if (scale === undefined) {
      run.report({ stage: 'download', message: `chromium ${String(percent)}%` })
      return
    }
    const totalBytes = Math.round(Number(parsed[2]) * scale)
    run.report({
      stage: 'download',
      message: `chromium ${String(percent)}%`,
      completedBytes: Math.round(totalBytes * percent / 100),
      totalBytes,
    })
  }
  const outcome = await runProcess(command.command, command.args, { signal: run.signal, onLine })
  if (outcome.code !== 0) throw new Error(`playwright install 失败（exit ${String(outcome.code)}）：${lastLine(outcome)}`)
  run.report({ stage: 'verify', message: '检查 Chromium 目录' })
  const facts = await probeChromium(run.signal)
  if (!facts.installed) throw new Error(`Chromium 未安装到 ${playwrightBrowsersDir()}`)
}

/** The hf-mirror.com equivalent of a Hugging Face file URL. */
function hfMirrorUrl(url: string): string {
  return url.replace(`${HF_ORIGIN}/`, `${HF_MIRROR_ORIGIN}/`)
}

/**
 * Inspect the three SenseVoice runtime files. Only sizes are compared: hashing
 * the 239 MB model on every probe would cost more than it tells, and the
 * install verifies the full hash as it writes each file.
 * @param signal - cancellation.
 * @returns the observed state, with the mismatching file named as `problem` when one is present but wrong.
 */
async function probeSenseVoice(signal: AbortSignal): Promise<ComponentFacts> {
  signal.throwIfAborted()
  const targets = [
    [join(senseVoiceModelDir(), SENSEVOICE_MODEL.name), SENSEVOICE_MODEL.bytes],
    [join(senseVoiceModelDir(), SENSEVOICE_TOKENS.name), SENSEVOICE_TOKENS.bytes],
    [join(senseVoiceVadDir(), SENSEVOICE_VAD.name), SENSEVOICE_VAD.bytes],
  ] as const
  const sizes = await Promise.all(targets.map(async ([path]) => await stat(path).then(info => info.size, () => undefined)))
  const complete = targets.every(([, bytes], index) => sizes[index] === bytes)
  if (complete) return { installed: true, version: 'int8' }
  const mismatched = targets.find(([, bytes], index) => sizes[index] !== undefined && sizes[index] !== bytes)
  return {
    installed: false,
    ...mismatched === undefined ? {} : { problem: `${mismatched[0]} 大小不符，需重新下载` },
  }
}

/** Download the three SenseVoice runtime files, mirror fallback included. */
async function installSenseVoiceModels(run: InstallRun): Promise<void> {
  const targets = [
    { asset: SENSEVOICE_MODEL, directory: senseVoiceModelDir() },
    { asset: SENSEVOICE_TOKENS, directory: senseVoiceModelDir() },
    { asset: SENSEVOICE_VAD, directory: senseVoiceVadDir() },
  ]
  for (const { asset, directory } of targets) {
    const destination = join(directory, asset.name)
    run.report({ stage: 'download', message: asset.name, completedBytes: 0, totalBytes: asset.bytes })
    const sources = await raceSources([asset.url, hfMirrorUrl(asset.url)], SOURCE_PROBE_TIMEOUT_MS, run.signal)
    await downloadFromSources(sources, destination, {
      sha256: asset.sha256,
      expectedBytes: asset.bytes,
      signal: run.signal,
      report: progress => run.report(bytesProgress(asset.name, progress)),
    })
  }
  run.report({ stage: 'verify', message: '检查模型文件' })
  const facts = await probeSenseVoice(run.signal)
  if (!facts.installed) throw new Error(`模型文件校验失败：${facts.problem ?? senseVoiceModelDir()}`)
}

/** How each component is probed and installed. */
const COMPONENTS: Record<ComponentId, ComponentSpec> = {
  'python-venv': {
    requires: [],
    estimateBytes: 900 * 1024 * 1024,
    firstStage: 'install',
    location: () => VENV_PYTHON,
    probe: async (signal) => {
      const report = await probeDataEnv(signal)
      return {
        installed: report.venvExists,
        ...report.pythonVersion === undefined ? {} : { version: report.pythonVersion },
        // A missing venv is the answer, not a probe failure; only a venv that
        // exists and still could not be read is a problem worth naming.
        ...report.problem === undefined || !report.venvExists ? {} : { problem: report.problem },
      }
    },
    install: installFinanceVenv,
  },
  'python-ml': {
    requires: ['python-venv'],
    estimateBytes: 3 * 1024 * 1024 * 1024,
    firstStage: 'download',
    location: () => VENV_PYTHON,
    probe: async (signal) => await exists(VENV_PYTHON)
      ? await probePythonModules(VENV_PYTHON, ML_PROBE_SCRIPT, ML_PACKAGES, signal)
      : { installed: false },
    install: installMlPackages,
  },
  uv: {
    requires: [],
    estimateBytes: 30 * 1024 * 1024,
    firstStage: 'download',
    location: uvExecutable,
    probe: async (signal) => process.platform === 'win32'
      ? await probeExecutableVersion(uvExecutable(), signal)
      : { installed: false, problem: '仅支持 Windows' },
    install: installUv,
  },
  pnpm: {
    requires: [],
    estimateBytes: 30 * 1024 * 1024,
    firstStage: 'download',
    location: pnpmExecutable,
    probe: async (signal) => process.platform === 'win32'
      ? await probeExecutableVersion(pnpmExecutable(), signal)
      : { installed: false, problem: '仅支持 Windows' },
    install: installPnpm,
  },
  'playwright-chromium': {
    requires: [],
    estimateBytes: 300 * 1024 * 1024,
    firstStage: 'download',
    location: playwrightBrowsersDir,
    probe: probeChromium,
    install: installChromium,
  },
  'sensevoice-models': {
    requires: [],
    estimateBytes: SENSEVOICE_MODEL.bytes + SENSEVOICE_TOKENS.bytes + SENSEVOICE_VAD.bytes,
    firstStage: 'download',
    location: senseVoiceModelDir,
    probe: probeSenseVoice,
    install: installSenseVoiceModels,
  },
}

/** One in-flight install. The catalog runs at most one of these. */
interface InstallTask {
  readonly id: ComponentId
  readonly controller: AbortController
  /** The latest progress published for this task; a follower that joins receives it first. */
  progress: ComponentProgress
  /**
   * Settles when the task ends and never rejects: a failed or cancelled job is
   * published as a `failed` event, so a client that only follows the stream
   * still learns about it.
   */
  done: Promise<void>
}

/** One follower's mailbox: buffered events, a wake-up for its waiting reader, and a close that ends it. */
class EventMailbox {
  private readonly queued: ComponentEvent[] = []
  private wake: (() => void) | undefined
  private closed = false

  /** Buffer one event; after {@link close} this drops it, because the follower is gone. */
  push(event: ComponentEvent): void {
    if (this.closed) return
    this.queued.push(event)
    this.wake?.()
  }

  /** End the mailbox: its reader finishes after draining whatever was buffered. */
  close(): void {
    this.closed = true
    this.wake?.()
  }

  /** Yield buffered events as they arrive, until the mailbox is closed. */
  async *drain(): AsyncIterable<ComponentEvent> {
    while (true) {
      while (this.queued.length > 0) {
        const event = this.queued.shift()
        /* A `shift` of a non-empty queue cannot be undefined; the guard only satisfies the unchecked-access rule. */
        if (event !== undefined) yield event
      }
      if (this.closed) return
      await new Promise<void>((resolve) => { this.wake = resolve })
      this.wake = undefined
    }
  }
}

/**
 * The host component catalog: probe all six components, install one at a time,
 * cancel the running job, and follow its events. State is per instance, so one
 * mounted gateway owns one install at a time process-wide.
 *
 * These method names are internal. The gateway publishes them as `catalog`,
 * `start`, `cancel`, and `follow` — `install` is not a legal wire method name,
 * because the Client's namespace service owns one under that name.
 */
export class ComponentCatalog {
  /** Cached answers of {@link catalog}, stamped. */
  private cache: { at: number; items: ComponentInfo[] } | null = null
  /** The running install, when one is running. */
  private task: InstallTask | null = null
  /** Event listeners; a follower adds one for the lifetime of its stream. */
  private readonly followers = new Set<(event: ComponentEvent) => void>()

  /**
   * Probe every component.
   * @returns one entry per component, in display order; a probe that failed is reported as a `problem` rather than a rejection.
   */
  async catalog(): Promise<ComponentInfo[]> {
    const cached = this.cache
    if (cached !== null && Date.now() - cached.at < CATALOG_TTL_MS) return cached.items
    const deadline = AbortSignal.timeout(PROBE_TIMEOUT_MS)
    const items = await Promise.all(COMPONENT_IDS.map(async id => this.info(id, await this.probe(id, deadline))))
    this.cache = { at: Date.now(), items }
    return items
  }

  /**
   * Start the install job for one component, or answer the component's current
   * state when there is nothing to install. An already-installed component is
   * idempotent: it publishes an `installed` event and starts no job, so a
   * repeated request costs one probe instead of a repeated transfer. A probe
   * that could not decide (`problem`) still installs, because the component may
   * well be broken rather than absent.
   * @param id - the component to install; the wire boundary has already validated it against {@link ComponentId}.
   * @returns after the job is running, or after the installed answer was published; progress and outcome arrive on the event stream.
   * @throws RemoteError `component/busy` when another job is running; `component/requires` when a prerequisite is not installed; `component/unsupported` on a host with no install path for it.
   */
  async install(id: ComponentId): Promise<void> {
    this.assertIdle()
    if (process.platform !== 'win32' && WINDOWS_ONLY.includes(id)) {
      throw new RemoteError('component/unsupported', `componentCatalog: ${id} 仅支持 Windows（当前 ${process.platform}-${process.arch}）`, { id })
    }
    const missing: ComponentId[] = []
    for (const required of COMPONENTS[id].requires) {
      const facts = await this.probe(required, AbortSignal.timeout(PROBE_TIMEOUT_MS))
      if (!facts.installed) missing.push(required)
    }
    if (missing.length > 0) {
      throw new RemoteError('component/requires', `componentCatalog: 安装 ${id} 前需先安装 ${missing.join('、')}`, { id, missing })
    }
    const current = await this.probe(id, AbortSignal.timeout(PROBE_TIMEOUT_MS))
    if (current.installed) {
      this.publish({ type: 'installed', info: this.info(id, current) })
      return
    }
    // The probes above awaited, so another caller could have started a job
    // meanwhile: re-check here, where nothing awaits between the check and the
    // job it guards.
    this.assertIdle()
    this.start(id)
  }

  /**
   * Cancel the running job.
   * @param id - the component whose job should stop; the wire boundary has already validated it against {@link ComponentId}.
   * @returns after the job has settled; the partial install has been cleaned up where the component can be cleaned up safely.
   * @throws RemoteError `component/not-running` when this component has no running job.
   */
  async cancel(id: ComponentId): Promise<void> {
    const task = this.task
    if (task === null || task.id !== id) {
      throw new RemoteError('component/not-running', `componentCatalog: ${id} 没有正在运行的安装任务`, { id })
    }
    task.controller.abort()
    await task.done
  }

  /**
   * Follow install events.
   * @param signal - the client's observation lifetime; aborting it ends the stream.
   * @returns the running job's latest progress first, when one is running, then every subsequent event.
   */
  async *follow(signal: AbortSignal): AsyncIterable<ComponentEvent> {
    const mailbox = new EventMailbox()
    const listener = (event: ComponentEvent): void => { mailbox.push(event) }
    this.followers.add(listener)
    const close = (): void => { mailbox.close() }
    signal.addEventListener('abort', close, { once: true })
    // An abort that landed before the listener was added never fires one, so a
    // follower of an already-cancelled stream closes immediately.
    if (signal.aborted) close()
    try {
      const running = this.task
      if (running !== null) yield { type: 'progress', progress: running.progress }
      for await (const event of mailbox.drain()) yield event
    } finally {
      signal.removeEventListener('abort', close)
      this.followers.delete(listener)
    }
  }

  /** Probe one component, reporting a probe failure as a `problem` instead of a rejection. */
  private async probe(id: ComponentId, signal: AbortSignal): Promise<ComponentFacts> {
    try {
      return await COMPONENTS[id].probe(signal)
    } catch (error) {
      return { installed: false, problem: messageOf(error) }
    }
  }

  /**
   * Refuse a second job: one install runs at a time, so a caller's cancel and
   * follower stream always name the same task.
   * @throws RemoteError `component/busy` naming the component already installing.
   */
  private assertIdle(): void {
    const running = this.task
    if (running !== null) {
      throw new RemoteError('component/busy', `componentCatalog: ${running.id} 正在安装，同一时刻只允许一个安装任务`, { running: running.id })
    }
  }

  /** One component's answer: its static facts plus what the probe observed. */
  private info(id: ComponentId, facts: ComponentFacts): ComponentInfo {
    const spec = COMPONENTS[id]
    return {
      id,
      installed: facts.installed,
      location: spec.location(),
      estimateBytes: spec.estimateBytes,
      requires: [...spec.requires],
      ...facts.version === undefined ? {} : { version: facts.version },
      ...facts.problem === undefined ? {} : { problem: facts.problem },
    }
  }

  /** Register the job, announce it, and run it to its end. */
  private start(id: ComponentId): void {
    const controller = new AbortController()
    const task: InstallTask = {
      id,
      controller,
      progress: { id, stage: COMPONENTS[id].firstStage },
      done: Promise.resolve(),
    }
    this.task = task
    this.publish({ type: 'progress', progress: task.progress })
    task.done = this.execute(task)
      .catch((error: unknown) => {
        this.publish({ type: 'failed', id, error: controller.signal.aborted ? '已取消' : messageOf(error) })
      })
      .finally(() => {
        if (this.task === task) this.task = null
        this.cache = null
      })
  }

  /** Run one install and publish its completion. */
  private async execute(task: InstallTask): Promise<void> {
    const report = (progress: InstallReport): void => {
      const next: ComponentProgress = {
        id: task.id,
        stage: progress.stage,
        ...progress.message === undefined ? {} : { message: progress.message },
        ...progress.completedBytes === undefined ? {} : { completedBytes: progress.completedBytes },
        ...progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes },
      }
      task.progress = next
      this.publish({ type: 'progress', progress: next })
    }
    await COMPONENTS[task.id].install({ signal: task.controller.signal, report })
    // The install finished, so its own signal must not decide the verification:
    // a cancel that lands after the last step still leaves a truthful probe to
    // report. The deadline is what bounds a hung component binary instead.
    const facts = await this.probe(task.id, AbortSignal.timeout(PROBE_TIMEOUT_MS))
    this.publish({ type: 'installed', info: this.info(task.id, facts) })
  }

  /** Deliver one event to every current follower. */
  private publish(event: ComponentEvent): void {
    for (const follower of this.followers) follower(event)
  }
}
