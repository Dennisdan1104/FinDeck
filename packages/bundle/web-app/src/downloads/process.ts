/**
 * Child-process helpers for the component catalog: one collected run with
 * cancellation, and termination of the whole process tree behind it. The
 * catalog's children are installers (pip, npx, `uv --version`) that spawn
 * descendants of their own, so cancelling one cancels its tree.
 * @module @deepseek-ai/dsh-web-app/downloads/process
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

/** What one collected child process settled as. */
export interface ProcessOutcome {
  /** Exit code; null when the child died from a signal. */
  code: number | null
  stdout: string
  stderr: string
}

/** One process run's environment and cancellation. */
export interface ProcessRequest {
  /** Working directory; the harness process's own when omitted. */
  readonly cwd?: string
  /** Cancellation: the tree is killed and the returned promise rejects with the signal's reason. */
  readonly signal?: AbortSignal
  /** Receives each complete output line as it is produced, for progress parsing. */
  readonly onLine?: (line: string, stream: 'stdout' | 'stderr') => void
}

/**
 * Run one command, collect its output, and terminate its tree when cancelled.
 * No shell is involved: the caller passes the executable and its arguments
 * separately, so a path or argument this catalog builds is never re-parsed.
 * @param command - executable name or path.
 * @param args - the command's arguments, passed verbatim.
 * @param request - working directory, cancellation, and line sink.
 * @returns the exit code and both captured streams.
 * @throws the spawn error (a missing executable, most often) or the cancellation reason.
 */
export function runProcess(command: string, args: readonly string[], request: ProcessRequest = {}): Promise<ProcessOutcome> {
  const { signal } = request
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...request.cwd === undefined ? {} : { cwd: request.cwd },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const split = lineSplitter(request.onLine)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; split(chunk, 'stdout') })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; split(chunk, 'stderr') })
    const abort = (): void => { killProcessTree(child) }
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = (): void => { signal?.removeEventListener('abort', abort) }
    child.once('error', (error: Error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code: number | null) => {
      cleanup()
      if (signal?.aborted === true) {
        reject(signal.reason)
        return
      }
      resolve({ code, stdout, stderr })
    })
  })
}

/** Split a byte stream into complete lines, holding the trailing fragment for the next chunk. */
function lineSplitter(sink: ProcessRequest['onLine']): (chunk: string, stream: 'stdout' | 'stderr') => void {
  let pending = ''
  return (chunk, stream) => {
    if (sink === undefined) return
    pending += chunk
    const lines = pending.split(/\r?\n/u)
    pending = lines.pop() ?? ''
    for (const line of lines) sink(line, stream)
  }
}

/**
 * Terminate one child and its descendants. Windows has no process groups here,
 * so the tree is killed through `taskkill /T /F`; elsewhere the direct child's
 * signal is what this code owns.
 * @param child - the child to terminate; a child without a pid has already exited.
 */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    // taskkill reports a dead or missing target through its exit status and
    // returns rather than throwing; both are the expected case when a cancel
    // races the child's own exit.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGKILL')
}
