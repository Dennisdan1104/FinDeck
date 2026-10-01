/**
 * Host-callable Schedule pause, resume, and delete over live and stored sessions.
 * @module @deepseek-ai/dsh-schedule/management
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyOwnedError,
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
// Type-only: resolves ctx.sessionProjectionCache for the optional cold cache refresh.
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { foldScheduleEvents, ScheduleId, ScheduleLogError } from './domain.ts'
import type { FoldedSchedules } from './domain.ts'
import { notifyScheduleDrive } from './index.ts'
import { flushSchedulePersistence } from './persistence.ts'
import { runScheduleTransaction } from './transaction.ts'
import type {
  ScheduleChange,
  ScheduleId as ScheduleIdType,
  ScheduleManagementFailure,
  ScheduleManagementResult,
  ScheduleRecord,
  ScheduleRemovalResult,
} from './types.ts'

export type {
  ScheduleManagementFailure,
  ScheduleManagementResult,
  ScheduleRemovalResult,
} from './types.ts'

/** One applied change above the failure taxonomy; the caller attaches its own success fields. */
type ScheduleMutationResult = { readonly ok: true } | ScheduleManagementFailure

/** Cold mutations serialize per session id so two appends cannot race a stale seq. */
const coldTails = new Map<string, Promise<void>>()

/** Render an unknown thrown value for containment messages. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** One stable failure value. */
function failure(code: ScheduleManagementFailure['code'], message: string): ScheduleManagementFailure {
  return { ok: false, code, message }
}

/** Require a caller-supplied identity string with no surrounding whitespace. */
function invalidId(label: string, value: string): string | undefined {
  return value.length === 0 || value.trim() !== value
    ? `schedule: ${label} must be a non-empty string without surrounding whitespace`
    : undefined
}

/** Translate one fold rejection into the stable management taxonomy. */
function foldFailure(error: unknown): ScheduleManagementFailure {
  if (error instanceof ScheduleLogError || error instanceof SessionPersistenceCorruptionError) {
    return failure('corrupt_schedule_log', 'The stored session schedule log is corrupt.')
  }
  if (error instanceof SessionFormatUnsupportedError) {
    return failure('format_unsupported', `schedule: ${error.message}`)
  }
  return failure('internal_error', 'schedule: the stored session could not be read')
}

/** Map one write-open rejection onto the stable management taxonomy. */
function openFailure(error: unknown): ScheduleManagementFailure {
  if (error instanceof SessionAlreadyOwnedError) {
    return failure('already_owned', `schedule: session "${error.sessionId}" is owned by a live writer`)
  }
  if (error instanceof SessionPersistenceNotFoundError) {
    return failure('schedule_not_found', `schedule: session "${error.sessionId}" is not stored`)
  }
  if (error instanceof SessionFormatUnsupportedError) {
    return failure('format_unsupported', `schedule: ${error.message}`)
  }
  if (error instanceof SessionPersistenceCorruptionError) {
    return failure('corrupt_schedule_log', 'The stored session schedule log is corrupt.')
  }
  return failure('internal_error', 'schedule: the stored session could not be opened')
}

/** Locate the exact record a mutation targets inside one fold. */
function targetRecord(folded: FoldedSchedules, id: ScheduleIdType): ScheduleRecord | undefined {
  return folded.active.find(candidate => candidate.id === id)
}

/** Whether a record already holds the state a pause or resume would set. */
function alreadyDecided(record: ScheduleRecord, change: ScheduleChange): boolean {
  if (change.operation === 'pause') return record.paused === true
  if (change.operation === 'resume') return record.paused !== true
  return false
}

/**
 * Apply one already-decided change to a live owner through its transaction.
 * @param ctx - Cordis context carrying the persistence barrier.
 * @param agent - the live root agent that owns the target session.
 * @param id - the targeted reminder, identical to the change's own id.
 * @param change - the exact `schedule/change` event to append.
 * @returns The applied result; failures are values, never rejections.
 */
function applyLive(
  ctx: Context,
  agent: Agent,
  id: ScheduleIdType,
  change: ScheduleChange,
): Promise<ScheduleMutationResult> {
  return runScheduleTransaction(agent, async () => {
    try {
      await flushSchedulePersistence(ctx, agent.session)
    } catch {
      return failure('persistence_uncertain', 'Schedule persistence is uncertain; retry before relying on this result.')
    }
    let folded: FoldedSchedules
    try {
      folded = foldScheduleEvents(agent.session.ownEvents())
    } catch (error: unknown) {
      return foldFailure(error)
    }
    const record = targetRecord(folded, id)
    if (record === undefined) {
      return failure('schedule_not_found', `schedule: id ${JSON.stringify(id)} is not active`)
    }
    if (alreadyDecided(record, change)) return { ok: true }
    try {
      agent.session.append('schedule/change', change)
    } catch (error: unknown) {
      return failure('internal_error', `schedule: the session log rejected the ${change.operation} change (${renderThrown(error)})`)
    }
    try {
      await flushSchedulePersistence(ctx, agent.session)
    } catch {
      return failure('persistence_uncertain', 'Schedule persistence is uncertain; retry before relying on this result.')
    }
    // The mutation is already durable; a failing listener only forfeits the
    // immediate drive, which the owner's next activity recomputes anyway.
    try {
      notifyScheduleDrive(String(agent.session.id))
    } catch (error: unknown) {
      ctx.logger.warn(`schedule: drive notification failed for session "${agent.session.id}": ${renderThrown(error)}`)
    }
    return { ok: true }
  })
}

/**
 * Append one change through a cold session's own write handle.
 * @param ctx - Cordis context carrying the optional persistence service.
 * @param sessionKey - raw id of the stored session to mutate.
 * @param id - the targeted reminder, identical to the change's own id.
 * @param change - the exact `schedule/change` payload to append.
 * @returns The applied result; failures are values, never rejections.
 */
async function applyCold(
  ctx: Context,
  sessionKey: string,
  id: ScheduleIdType,
  change: ScheduleChange,
): Promise<ScheduleMutationResult> {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    return failure('internal_error', 'schedule: session persistence is not configured')
  }
  const sessionId = SessionId(sessionKey)
  let handle: SessionHandle | undefined
  try {
    try {
      handle = await persistence.open(sessionId, 'write')
    } catch (error: unknown) {
      return openFailure(error)
    }
    let events: readonly SessionEvent[]
    let folded: FoldedSchedules
    try {
      events = await handle.read()
      folded = foldScheduleEvents(events, handle.inheritedEventCount)
    } catch (error: unknown) {
      return foldFailure(error)
    }
    const record = targetRecord(folded, id)
    if (record === undefined) {
      return failure('schedule_not_found', `schedule: id ${JSON.stringify(id)} is not active`)
    }
    if (alreadyDecided(record, change)) return { ok: true }
    // The stored log is contiguous from seq 0, so the next seq is its length.
    const appended: SessionEvent<'schedule/change'> = {
      type: 'schedule/change',
      seq: SessionSeq(events.length),
      time: Date.now(),
      data: change,
    }
    try {
      await handle.append([appended])
      await handle.flush()
    } catch {
      return failure('persistence_uncertain', 'Schedule persistence is uncertain; retry before relying on this result.')
    }
    // Refresh the checkpoint so read-only stored-session overviews observe the
    // committed change instead of folding a stale row.
    ctx.get('sessionProjectionCache')?.coldSnapshot(
      handle.header,
      handle.inheritedEventCount,
      [...events, appended],
    )
    return { ok: true }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** Serialize cold mutations of one session id behind every earlier one. */
function runCold(
  ctx: Context,
  sessionKey: string,
  id: ScheduleIdType,
  change: ScheduleChange,
): Promise<ScheduleMutationResult> {
  const prior = coldTails.get(sessionKey) ?? Promise.resolve()
  const run = prior.then(() => applyCold(ctx, sessionKey, id, change))
  const tail = run.then(() => undefined, () => undefined)
  coldTails.set(sessionKey, tail)
  return run.finally(() => {
    if (coldTails.get(sessionKey) === tail) coldTails.delete(sessionKey)
  })
}

/**
 * Decide the live or cold path and apply one change.
 * @param ctx - Cordis context carrying sessions and optional persistence.
 * @param sessionId - raw id of the owning session.
 * @param scheduleId - raw session-local reminder id, used for validation only.
 * @param change - the exact `schedule/change` event to append.
 * @returns The applied result; failures are values, never rejections.
 */
function mutateSchedule(
  ctx: Context,
  sessionId: string,
  scheduleId: string,
  change: ScheduleChange,
): Promise<ScheduleMutationResult> {
  const invalidSession = invalidId('sessionId', sessionId)
  if (invalidSession !== undefined) return Promise.resolve(failure('internal_error', invalidSession))
  const invalidSchedule = invalidId('scheduleId', scheduleId)
  if (invalidSchedule !== undefined) return Promise.resolve(failure('internal_error', invalidSchedule))
  const id = ScheduleId(scheduleId)
  const live = ctx.get('sessions')?.get(SessionId(sessionId))
  if (live === undefined) return runCold(ctx, sessionId, id, change)
  const owner = ctx.agents.roots().find(candidate => candidate.session === live)
  if (owner === undefined) {
    return Promise.resolve(failure('internal_error', 'schedule: live session has no root agent'))
  }
  return applyLive(ctx, owner, id, change)
}

/**
 * Pause one active reminder, live or stored.
 *
 * A live owner runs the mutation through its serialized Agent transaction. A
 * stored session without a live owner is mutated through its own write handle
 * and triggers no drive: a closed session has no runtime to deliver into.
 * Pausing an already-paused reminder succeeds without appending.
 * @param ctx - Cordis context carrying sessions and optional persistence.
 * @param sessionId - Raw id of the owning session.
 * @param scheduleId - Raw session-local reminder id.
 * @returns The management outcome; failures are values, never rejections.
 */
export async function pauseSchedule(
  ctx: Context,
  sessionId: string,
  scheduleId: string,
): Promise<ScheduleManagementResult> {
  const change: ScheduleChange = { version: 1, operation: 'pause', id: ScheduleId(scheduleId) }
  const result = await mutateSchedule(ctx, sessionId, scheduleId, change)
  return result.ok ? { ok: true, paused: true } : result
}

/**
 * Resume one paused reminder, live or stored.
 *
 * A resumed overdue reminder fires on the live owner's next drive; a stored
 * session without a live owner records the resume and fires nothing until a
 * future live root agent loads. Resuming a reminder that was never paused
 * succeeds without appending.
 * @param ctx - Cordis context carrying sessions and optional persistence.
 * @param sessionId - Raw id of the owning session.
 * @param scheduleId - Raw session-local reminder id.
 * @returns The management outcome; failures are values, never rejections.
 */
export async function resumeSchedule(
  ctx: Context,
  sessionId: string,
  scheduleId: string,
): Promise<ScheduleManagementResult> {
  const change: ScheduleChange = { version: 1, operation: 'resume', id: ScheduleId(scheduleId) }
  const result = await mutateSchedule(ctx, sessionId, scheduleId, change)
  return result.ok ? { ok: true, paused: false } : result
}

/**
 * Delete one active reminder, live or stored.
 *
 * A live owner appends the delete through its serialized Agent transaction and
 * recomputes its timers; a stored session without a live owner records the
 * delete through its own write handle and triggers no drive. Unlike pause and
 * resume there is no idempotent success: an id that is already inactive reports
 * `schedule_not_found` without appending.
 * @param ctx - Cordis context carrying sessions and optional persistence.
 * @param sessionId - Raw id of the owning session.
 * @param scheduleId - Raw session-local reminder id.
 * @returns The removal outcome; failures are values, never rejections.
 */
export function deleteSchedule(
  ctx: Context,
  sessionId: string,
  scheduleId: string,
): Promise<ScheduleRemovalResult> {
  const change: ScheduleChange = { version: 1, operation: 'delete', id: ScheduleId(scheduleId) }
  return mutateSchedule(ctx, sessionId, scheduleId, change)
}
