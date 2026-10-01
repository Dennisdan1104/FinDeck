/**
 * Agent-scoped durable one-shot and fixed-rate reminders over the session event log.
 * @module @deepseek-ai/dsh-schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
// Type-only: resolves ctx.sessionProjections for the optional projection child.
import type {} from '@deepseek-ai/dsh-session-projection'
import { scheduleProjectionDefinition } from './projection.ts'
import { ScheduleRuntime } from './runtime.ts'
import { registerScheduleTools } from './tools.ts'

export type * from './types.ts'
export {
  SCHEDULE_CHANGE_VERSION,
  MIN_EVERY_INTERVAL_SECONDS,
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  allocateScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  decodeScheduleChange,
  foldScheduleEvents,
  renderReminderFraming,
  renderEveryReminderBatchFraming,
  resolveEveryOccurrence,
  scheduleView,
} from './domain.ts'
export { registerScheduleTools } from './tools.ts'
export type {
  ScheduleManagementFailure,
  ScheduleManagementResult,
  ScheduleRemovalResult,
} from './management.ts'
export { deleteSchedule, pauseSchedule, resumeSchedule } from './management.ts'

/** Cordis function-plugin name. */
export const name = 'schedule'
/** Services required before future root agents can receive Schedule. */
export const inject = ['agents', 'sessions', 'tools', 'sessionPersistence']

type OwnerCleanup = () => void | Promise<void>

/**
 * Live runtime drive hooks keyed by session id string. Host-callable management
 * holds no runtime reference and reaches the exact live owner through this
 * registry; an entry exists only while its owning agent scope does.
 */
const driveListeners = new Map<string, () => void>()

/**
 * Ask one live session's Schedule runtime to recompute its timers and due work.
 * @param sessionId - Raw id of the live session that changed.
 * @returns Nothing; a session with no loaded runtime is a no-op.
 */
export function notifyScheduleDrive(sessionId: string): void {
  driveListeners.get(sessionId)?.()
}

/** Install Schedule only for root agents published after this plugin loads. */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(scheduleProjectionDefinition)
  })

  const runtimes = new Map<Agent, OwnerCleanup>()
  let stopping = false

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      if (stopping || runtimes.has(agent) || !ctx.agents.roots().includes(agent)) return
      const runtime = new ScheduleRuntime(ctx, agent)
      const driveKey = String(agent.session.id)
      const driveListener = (): void => { runtime.requestDrive() }
      const cleanup: OwnerCleanup = agent.ctx.effect(() => {
        const disposeTools = registerScheduleTools(ctx, agent.ctx, agent, () => { runtime.requestDrive() })
        const stopStatus = agent.ctx.on('agent/status', ({ status }) => {
          if (status === 'idle' && agent.session.snapshotEvents().some(event => event.type === 'schedule/change')) {
            runtime.requestDrive()
          }
        })
        driveListeners.set(driveKey, driveListener)
        runtime.start()
        return async () => {
          stopStatus()
          disposeTools()
          try {
            await runtime.dispose()
          } finally {
            if (driveListeners.get(driveKey) === driveListener) driveListeners.delete(driveKey)
            if (runtimes.get(agent) === cleanup) runtimes.delete(agent)
          }
        }
      }, 'schedule.runtime()')
      runtimes.set(agent, cleanup)
    })

    return async () => {
      stopping = true
      stopCreated()
      const cleanups = [...runtimes.values()]
      runtimes.clear()
      await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
    }
  }, 'schedule.lifecycle()')
}
