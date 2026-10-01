/**
 * The component catalog's download engine: mirror selection, verified
 * streaming downloads, and failure classification. The logic is carried over
 * from the SenseVoice local provider's private downloader
 * (`packages/experimental/speech-to-text-sensevoice/src/runtime.ts`), which
 * exports none of it; `fetch` here is the process-global one, so an installed
 * proxy dispatcher routes these downloads like every other request.
 * @module @deepseek-ai/dsh-web-app/downloads/engine
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Why a download stopped, as the catalog reports it to the operator. */
export type DownloadFailureReason =
  | 'dns' | 'timeout' | 'certificate' | 'storage' | 'network' | 'integrity' | 'http' | 'unknown'

/** Structured download diagnostics; the raw cause stays local to the throw site. */
export interface DownloadFailure {
  readonly reason: DownloadFailureReason
  /** Recognized diagnostic code (ENOTFOUND, ENOSPC, …) when the cause carried one. */
  readonly code?: string
  /** HTTP status of a refusing response. */
  readonly status?: number
  /** The file name this download was producing. */
  readonly resource: string
  /** The origin actually contacted, after redirects. */
  readonly source: string
}

/** A failed download, carrying its classification and, in-process, its cause. */
export class DownloadError extends Error {
  constructor(readonly download: DownloadFailure, options?: ErrorOptions) {
    super(`Unable to download ${download.resource} from ${download.source}: ${download.reason}`
      + `${download.code === undefined ? '' : ` (${download.code})`}`
      + `${download.status === undefined ? '' : ` (HTTP ${download.status})`}`, options)
  }
}

const FAILURE_CODES: readonly [DownloadFailureReason, RegExp][] = [
  ['dns', /^(ENOTFOUND|EAI_AGAIN)$/u],
  ['timeout', /^(ETIMEDOUT|ERR_SOCKET_CONNECTION_TIMEOUT|UND_ERR_(CONNECT|HEADERS|BODY)_TIMEOUT)$/u],
  ['certificate', /^(CERT_[A-Z_]+|ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY)$/u],
  ['storage', /^(ENOSPC|EDQUOT|EACCES|EPERM|EROFS)$/u],
  ['network', /^(ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET)$/u],
]

/**
 * Inspect native fetch causes, including aggregate connection attempts, without
 * publishing their messages.
 * @param failure - error received from the network or filesystem.
 * @returns an actionable category and recognized diagnostic code, or a generic failure.
 */
export function classifyDownloadFailure(failure: unknown): { reason: DownloadFailureReason; code?: string } {
  const pending: unknown[] = [failure]
  const visited = new Set<Error>()
  let reason: DownloadFailureReason = 'unknown'
  while (pending.length > 0) {
    const error = pending.shift()
    if (!(error instanceof Error) || visited.has(error)) continue
    visited.add(error)
    if (error.name === 'TimeoutError') return { reason: 'timeout' }
    if ('code' in error && typeof error.code === 'string') {
      for (const [kind, pattern] of FAILURE_CODES) {
        if (pattern.test(error.code)) return { reason: kind, code: error.code }
      }
    }
    if (error instanceof TypeError && error.message === 'fetch failed') reason = 'network'
    pending.push(error.cause)
    if (error instanceof AggregateError) {
      const causes: readonly unknown[] = error.errors
      pending.push(...causes)
    }
  }
  return { reason }
}

/** How a download's expected identity is pinned. */
export interface FileIdentity {
  /** Lowercase-hex sha256 of the whole file; omitted pins nothing by content. */
  readonly sha256?: string
  /** Exact byte length; omitted pins nothing by size. */
  readonly expectedBytes?: number
}

/** One progress notification, in bytes. */
export interface DownloadProgress {
  readonly completedBytes: number
  /** Known from the pin or the response's `content-length`; absent when neither states it. */
  readonly totalBytes?: number
}

/**
 * Minimum interval between intermediate progress notifications. One
 * notification per written chunk would put thousands of events on the
 * client's stream for a 240 MB model; the first and final counts always pass.
 */
const PROGRESS_INTERVAL_MS = 100

/** One download request. */
export interface DownloadRequest extends FileIdentity {
  /** Cancellation; the partial file is removed before the rejection is delivered. */
  readonly signal: AbortSignal
  /** Progress sink; called at least once per chunk written. */
  readonly report?: (progress: DownloadProgress) => void
}

/**
 * Test whether a file already holds the pinned content.
 * @param path - candidate file.
 * @param identity - the pin; an empty pin matches any existing regular file.
 * @param signal - cancellation checked before and during hashing.
 * @returns true for an existing regular file of the pinned size and hash.
 */
export async function matchesFile(path: string, identity: FileIdentity, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    if (identity.expectedBytes !== undefined && info.size !== identity.expectedBytes) return false
    if (identity.sha256 === undefined) return true
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
    return digest.digest('hex') === identity.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

/**
 * Download into a unique partial file, verify, then publish it atomically. An
 * already-matching destination is left untouched, so a repeated install is a
 * repeated no-op rather than a repeated transfer.
 * @param url - the source to fetch.
 * @param destination - the file's final path; its parent directory is created.
 * @param request - pin, cancellation, and progress sink.
 * @returns after the verified file is in place.
 * @throws {@link DownloadError} for every failure, including cancellation-free integrity and HTTP refusals.
 */
export async function downloadFile(url: string, destination: string, request: DownloadRequest): Promise<void> {
  const { signal } = request
  signal.throwIfAborted()
  const resource = destination.replace(/^.*[\\/]/u, '')
  const partial = `${destination}.${randomUUID()}.part`
  let source = new URL(url).origin
  try {
    await mkdir(dirname(destination), { recursive: true })
    if (await matchesFile(destination, request, signal)) return
    try {
      const response = await fetch(url, { signal })
      source = new URL(response.url === '' ? url : response.url).origin
      if (!response.ok || response.body === null) {
        await response.body?.cancel()
        throw new DownloadError({ resource, source, reason: 'http', status: response.status })
      }
      const totalBytes = request.expectedBytes ?? contentLength(response)
      const digest = createHash('sha256')
      let completedBytes = 0
      let reportedAt = 0
      const publish = (final: boolean): void => {
        const now = Date.now()
        if (!final && now - reportedAt < PROGRESS_INTERVAL_MS) return
        reportedAt = now
        request.report?.(totalBytes === undefined ? { completedBytes } : { completedBytes, totalBytes })
      }
      publish(true)
      const hashing = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          completedBytes += chunk.length
          if (request.expectedBytes !== undefined && completedBytes > request.expectedBytes) {
            callback(new DownloadError({ resource, source, reason: 'integrity' }))
            return
          }
          digest.update(chunk)
          publish(false)
          callback(null, chunk)
        },
      })
      await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
      publish(true)
      const complete = request.expectedBytes === undefined || completedBytes === request.expectedBytes
      if (!complete || (request.sha256 !== undefined && digest.digest('hex') !== request.sha256)) {
        throw new DownloadError({ resource, source, reason: 'integrity' })
      }
      signal.throwIfAborted()
      await rename(partial, destination)
    } finally {
      await rm(partial, { force: true })
    }
  } catch (error) {
    if (signal.aborted || error instanceof DownloadError) throw error
    throw new DownloadError({ resource, source, reason: classifyDownloadFailure(error).reason }, { cause: error })
  }
}

/**
 * Download one file from ordered mirrors, moving to the next only when the
 * failure says something about the mirror rather than about this machine: a
 * full disk, an unclassified failure, the last source, and cancellation all
 * stop the attempt instead of retrying elsewhere. An integrity mismatch does
 * move on, because a mirror serving a truncated file is the mirror's problem.
 * @param sources - candidate URLs, best first, as {@link raceSources} returns them.
 * @param destination - the file's final path.
 * @param request - pin, cancellation, and progress sink.
 * @returns after one source produced the verified file.
 * @throws {@link DownloadError} from the last attempted source.
 */
export async function downloadFromSources(
  sources: readonly string[],
  destination: string,
  request: DownloadRequest,
): Promise<void> {
  for (const [index, url] of sources.entries()) {
    try {
      await downloadFile(url, destination, request)
      return
    } catch (error) {
      request.signal.throwIfAborted()
      const last = index === sources.length - 1
      if (last || !(error instanceof DownloadError)
        || error.download.reason === 'storage' || error.download.reason === 'unknown') throw error
    }
  }
  /* Only an empty candidate list reaches here: nothing was attempted, so there is no download failure to report. */
  throw new Error('downloadFromSources: a download needs at least one source')
}

/** The declared body length of a response, when it states one. */
function contentLength(response: Response): number | undefined {
  const declared = response.headers.get('content-length')
  if (declared === null) return undefined
  const bytes = Number(declared)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined
}

/**
 * Prefer the first source that answers HEAD while retaining the rest for
 * download fallback. All probes settle before returning; if every probe fails,
 * the given order is preserved, because a mirror that refuses HEAD can still
 * serve the file.
 * @param sources - candidate URLs, best-guess order; duplicates are dropped.
 * @param timeoutMs - maximum probe duration, including redirects.
 * @param signal - cancellation.
 * @returns the deduplicated sources with the first responder first; a single source is returned unprobed.
 */
export async function raceSources(sources: readonly string[], timeoutMs: number, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted()
  const urls = [...new Set(sources)]
  if (urls.length === 1) return urls
  const finished = new AbortController()
  const probing = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs), finished.signal])
  const requests = urls.map(async url => ({ url, response: await fetch(url, { method: 'HEAD', signal: probing }) }))
  let preferred: string | undefined
  try {
    preferred = await Promise.any(requests.map(async (request) => {
      const { url, response } = await request
      if (!response.ok) throw new Error(`Source probe returned HTTP ${response.status}`)
      return url
    }))
  } catch {
    // Every probe failed (refused HEAD, unreachable, or past the deadline); the
    // download still gets its chance on each source in the given order.
  } finally {
    finished.abort()
    const settled = await Promise.allSettled(requests)
    await Promise.allSettled(settled.map(async (result) => {
      if (result.status === 'fulfilled') await result.value.response.body?.cancel()
    }))
  }
  signal.throwIfAborted()
  return preferred === undefined ? urls : [preferred, ...urls.filter(url => url !== preferred)]
}
