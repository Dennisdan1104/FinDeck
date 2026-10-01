/**
 * This deployment's own on-disk environment, as the data-environment page and
 * the component catalog read it: the finance venv and the checkout paths it
 * resolves from, the asset-library root, and the probe that reports them. One
 * home for these facts keeps the two surfaces from disagreeing about the same
 * interpreter.
 * @module @deepseek-ai/dsh-web-app/environment
 */

import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { DataEnvReport } from './types.ts'

/**
 * The asset-library root this deployment reads:
 * `<harness home>/asset-library` (`$DSH_HOME`, else `~/.findeck`).
 * @returns the absolute asset-library root.
 */
export function assetLibraryDir(): string {
  return dshHomePath('asset-library')
}

/**
 * The finance venv this deployment spawns asset verbs with (and probes for the
 * data-environment page), resolved beside the workspace.
 */
export const VENV_PYTHON = join(
  fileURLToPath(new URL('../../../../', import.meta.url)),
  process.platform === 'win32' ? 'finance/python/.venv/Scripts/python.exe' : 'finance/python/.venv/bin/python',
)

/** The `.venv` directory {@link VENV_PYTHON} lives in: what an install creates and what a cancelled creation removes. */
export const VENV_ROOT = dirname(dirname(VENV_PYTHON))

/**
 * The `finance/python` tree {@link VENV_PYTHON} lives in: the tool package the
 * venv's `.pth` file registers, the directory the verb bridge runs in, and the
 * parent of {@link FINANCE_REQUIREMENTS_FILE}.
 */
export const FINANCE_PYTHON_DIR = dirname(VENV_ROOT)

/** The requirement list a finance-venv install reads, one requirement per non-comment line. */
export const FINANCE_REQUIREMENTS_FILE = join(FINANCE_PYTHON_DIR, 'requirements-data.txt')

/** Key finance modules the data-environment page checks. */
const PROBE_MODULES = ['findeck', 'akshare', 'yfinance', 'pandas', 'lightgbm', 'statsmodels']

/** How long one probe answer stays reusable; the venv rarely changes mid-session. */
const DATA_ENV_TTL_MS = 10 * 60 * 1000

/** Cached probe answer with its stamp. */
let dataEnvCache: { at: number; report: DataEnvReport } | null = null

/**
 * Drop the cached probe answer, so the next {@link probeDataEnv} reads the venv
 * as it is now rather than as it was up to ten minutes ago. An installer that
 * just changed the venv calls this before verifying its own work.
 */
export function forgetDataEnvProbe(): void {
  dataEnvCache = null
}

/**
 * Probe the finance venv once per TTL: version and key-module importability.
 * @param signal - cancellation checked before the probe starts.
 * @returns the report the data-environment page renders.
 */
export function probeDataEnv(signal?: AbortSignal): Promise<DataEnvReport> {
  signal?.throwIfAborted()
  const assetLibraryPath = assetLibraryDir()
  const base: DataEnvReport = {
    venvPath: VENV_PYTHON,
    venvExists: false,
    modules: PROBE_MODULES.map(name => ({ name, ok: false })),
    assetLibraryPath,
    assetLibraryExists: false,
  }
  if (dataEnvCache !== null && Date.now() - dataEnvCache.at < DATA_ENV_TTL_MS) {
    return Promise.resolve(dataEnvCache.report)
  }
  return new Promise((resolve) => {
    const settle = (report: DataEnvReport): void => {
      dataEnvCache = { at: Date.now(), report }
      resolve(report)
    }
    void (async () => {
      const exists = await stat(VENV_PYTHON).then(() => true, () => false)
      const libraryExists = await stat(assetLibraryPath).then(() => true, () => false)
      if (!exists) {
        settle({ ...base, assetLibraryExists: libraryExists, problem: 'finance venv 未创建（运行 finance/python/setup-env 创建）' })
        return
      }
      const child = spawn(VENV_PYTHON, ['-c', [
        'import sys, json, importlib.util',
        `print(json.dumps({"version": sys.version.split()[0], "modules": {m: importlib.util.find_spec(m) is not None for m in ${JSON.stringify(PROBE_MODULES)}}}))`,
      ].join(String.fromCharCode(10))], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk) => { out += String(chunk) })
      child.stderr.on('data', (chunk) => { err += String(chunk) })
      const timer = setTimeout(() => { child.kill() }, 20_000)
      child.on('error', (error) => {
        clearTimeout(timer)
        settle({ ...base, venvExists: true, assetLibraryExists: libraryExists, problem: String(error) })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          /* v8 ignore next -- `split` always yields at least one element, so the last line exists. */
          const parsed = JSON.parse(out.trim().split(String.fromCharCode(10)).at(-1) ?? '{}') as {
            version?: string
            modules?: Record<string, boolean>
          }
          settle({
            ...base,
            venvExists: true,
            assetLibraryExists: libraryExists,
            ...parsed.version !== undefined ? { pythonVersion: parsed.version } : {},
            modules: PROBE_MODULES.map(name => ({ name, ok: parsed.modules?.[name] === true })),
          })
        } catch {
          settle({
            ...base,
            venvExists: true,
            assetLibraryExists: libraryExists,
            problem: err.trim() || `probe exited ${String(code)}`,
          })
        }
      })
    })()
  })
}
