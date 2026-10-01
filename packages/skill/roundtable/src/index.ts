/**
 * Roundtable host capability: the named rosters, the user's own
 * rosters and last-opened configuration under the `roundtable` settings
 * namespace, and the room engine — one shared transcript driven
 * speaker-by-speaker through the LLM, decided entirely by the state machine in
 * {@link ./state-machine.ts}.
 *
 * A table is OPENED with three choices and runs them until it is cleared: how
 * deep it goes (`shallow` = the speaker may only search before it talks;
 * `deep` = every read-only tool this deployment registers is in reach), which
 * roster is seated, and which model every speaker requests. Nothing about the
 * table's behavior is fixed at deployment time except the limits.
 *
 * The engine never lets the model decide turn order. Each floor holder makes a
 * bounded number of requests — a deep speaker's window runs to
 * `researchMaxSteps`, a shallow speaker's to `shallowMaxSteps` — and both
 * always end in a speech. Clearing the table releases the configuration, so the
 * open-table setup is reachable again and the next table may be configured
 * differently.
 *
 * While a speaker generates, the engine publishes its unfinished speech (text,
 * thinking, and every tool call its window makes) as {@link RoundtablePartial}
 * on the room view, which the page polls and renders growing; only the finished
 * turn is recorded and logged. The partial covers the speaker's WHOLE turn — a
 * deep speaker makes several requests, and their text, thinking, and calls
 * accumulate into it. `interrupt` freezes that partial into the transcript as
 * an interrupted turn, so what the reader already saw stays visible and stays
 * reconstructable; a user message that cancels the speaker instead carries the
 * frozen speech in the notice it joins to the shared context.
 *
 * Every speaker request is logged on the driving agent's session — the opened
 * configuration, each entry joined to the room, and each finished turn with
 * the room text its request carried — so the room is reconstructable from the
 * log. A room driven without an agent has no session to write to; closing a
 * table that spoke always archives the transcript to disk
 * (see {@link ./archive.ts}), so the conclusion outlives the process. An OPEN
 * table is durable too: every change writes the room to
 * `<archiveDir>/live.json` (see {@link ./live-room.ts}), and the next process
 * restores it — by the time this service is ready, the room a caller reads is
 * the resumed one.
 *
 * @module @deepseek-ai/dsh-roundtable
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session/types'
import type {} from 'zod'
import z from '@deepseek-ai/schemastery'
import type SettingsService from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, Message, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'roundtable': { kind: 'roundtable' } & ContextFormed
  }
}
import {
  DEFAULT_ROSTER_ID,
  type RosterIdentity,
  type RoundtableCitation,
  type RoundtableDepth,
  type RoundtableEntry,
  type RoundtableFlowItem,
  type RoundtableIdentity,
  type RoundtablePartial,
  type RoundtableRoomView,
  type RoundtableSeed,
  type RoundtableTableConfig,
  type RoundtableToolActivity,
  type RoundtableAck,
  type StoredRoster,
} from './identities.ts'
import { resolveRosters, rosterFor, rosterIdentities, rosterIdFrom } from './rosters.ts'
import {
  listRoundtableArchives,
  readRoundtableArchive,
  roundtableArchiveDir,
  writeRoundtableArchive,
} from './archive.ts'
import { boundSharedReads, readLiveRoom, writeLiveRoom } from './live-room.ts'
import type { RoundtableArchiveRecord, RoundtableArchiveSummary } from './identities.ts'
import { renderConversation, writeSeedFile } from './seed.ts'
import type { SeedRequest } from './seed.ts'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { SessionId } from '@deepseek-ai/dsh-session'
import { researchCatalog, runResearchWindow, type ResearchLimits, type ResearchStep, type ResearchToolActivity } from './research.ts'
import { consumePendingRuns, type PendingRunObservation, type RunRecordBody } from './pending-runs.ts'
import {
  currentFloor,
  interruptRound,
  onSpeakerDone,
  onUserMessage,
  openTable,
  type PendingRun,
  type RoundtableState,
} from './state-machine.ts'

export type {
  RosterIdentity,
  RoundtableCitation,
  RoundtableDepth,
  RoundtableEntry,
  RoundtableFlowItem,
  RoundtableIdentity,
  RoundtableMember,
  RoundtablePartial,
  RoundtableRoomView,
  RoundtableRoster,
  RoundtableSeed,
  RoundtableTableConfig,
  RoundtableToolActivity,
  RoundtableToolStatus,
  RoundtableAck,
  StoredRoster,
} from './identities.ts'
export {
  BULL_RESEARCHER,
  BEAR_AUDITOR,
  MACRO_STRATEGIST,
  INDUSTRY_EXPERT,
  MODERATOR,
  BUILTIN_IDENTITIES,
  BUILTIN_ROSTERS,
  CLASSIC_ROSTER,
  FINANCE_ROSTER,
  DEFAULT_ROSTER_ID,
  resolveMembers,
} from './identities.ts'
export {
  resolveRosters, rosterFor, rosterIdFrom, rosterIdentities,
} from './rosters.ts'
export {
  roundtableArchiveDir,
  writeRoundtableArchive,
  ARCHIVE_ID_PATTERN,
} from './archive.ts'
export type {
  RoundtableArchiveRecord,
  RoundtableArchiveSeed,
  RoundtableArchiveSummary,
  RoundtableArchiveTable,
} from './identities.ts'
export {
  renderConversation,
  writeSeedFile,
} from './seed.ts'
export type { SeedRequest } from './seed.ts'
export {
  SEARCH_TOOLS, researchCatalog, runResearchWindow,
  type ResearchBreadth, type ResearchLimits, type ResearchOutcome, type ResearchToolActivity, type ResearchWindow,
} from './research.ts'
export {
  LIVE_ROOM_FILE,
  boundSharedReads,
  readLiveRoom,
  writeLiveRoom,
  type LiveRoomRecord,
  type RestoredRoom,
} from './live-room.ts'
export type {
  PendingRun,
  RoundtablePhase,
  RoundtableState,
  RoundtableTurn,
} from './state-machine.ts'
export {
  currentFloor,
  insertSupplement,
  onSpeakerDone,
  onUserMessage,
  openTable,
  parseAtCall,
} from './state-machine.ts'
export {
  consumePendingRuns,
  type ConsumedPendingRuns,
  type PendingRunObservation,
  type RunRecordBody,
} from './pending-runs.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One table opened: the choices it runs on and the speakers it seats. Those
     * speaking contracts are the system message of every request the room
     * makes, so this is what resolves a later `roundtable/turn`'s speaker.
     */
    'roundtable/opened': {
      depth: RoundtableDepth
      rosterId: string
      provider: string
      model: string
      speakers: { id: string; name: string; prompt: string; moderator: boolean }[]
      /**
       * The conversation this table continues, when it opened seeded: the file
       * path is what later deep speakers' requests name, so the seed stays
       * reconstructable from the log. Absent on a fresh table.
       */
      seed?: { sessionId: string; title: string; file: string }
    }
    /**
     * One entry joined to the shared context: the user's message, or a note the
     * room added itself. Every later speaker request carries it.
     */
    'roundtable/message': {
      kind: 'user' | 'system'
      name: string
      text: string
    }
    /**
     * One speaker turn joined to the shared transcript, complete enough to
     * rebuild its request: the speaking contract, the room text the request
     * carried, the speech, the speaker's thinking, what its research window
     * read, and which tools it called. An interrupted turn is the same record
     * with `interrupted: true` and whatever had streamed before the stop — its
     * text is model-visible to every later speaker, so it is logged like any
     * other turn rather than dropped.
     */
    'roundtable/turn': {
      speaker: string
      name: string
      system: string
      context: string
      text: string
      /** The speaker's thinking; absent when the route emitted none. */
      reasoning?: string
      citations: { tool: string; label: string }[]
      truncated: boolean
      research?: { callId: string; name: string; arguments: string; result: string; isError: boolean }[]
      /** The tool calls the turn made, in call order; absent when it made none. */
      tools?: { key: string; name: string; arguments: string; summary: string; status: string }[]
      /**
       * The turn's thinking and calls interleaved in the order they happened;
       * absent on a turn that thought and called nothing.
       */
      flow?: (
        | { kind: 'reasoning'; text: string }
        | { kind: 'tool'; key: string; name: string; arguments: string; summary: string; status: string }
      )[]
      /** Whether the user stopped this speaker mid-turn. */
      interrupted?: boolean
    }
  }
}

/** The configuration remembered for the next table. */
export interface StoredTableConfig {
  /** The depth the last table ran at. */
  depth: RoundtableDepth
  /** Roster id the last table seated. */
  rosterId: string
  /** Provider route the last table used. */
  provider: string
  /** Model id the last table used. */
  model: string
}

/** The `roundtable` settings document: the user's rosters and last table. */
export interface RoundtableSettings {
  rosters: StoredRoster[]
  last: StoredTableConfig
}

/** Runtime schema for the `roundtable` settings namespace. */
export const RoundtableSettingsSchema: z<RoundtableSettings> = z.object({
  rosters: z.array(z.object({
    id: z.string().description('Roster id; matching a shipped id replaces that shipped roster.'),
    name: z.string().description('Display name shown in the open-table setup.'),
    members: z.array(z.object({
      id: z.string().description('Member identity id; a shipped id keeps that identity\'s contract.'),
      name: z.string().description('Display name; empty takes the shipped identity\'s name.'),
      prompt: z.string().description('Speaking contract; empty takes the shipped identity\'s contract.'),
      moderator: z.boolean().description('Whether this member harvests the round instead of arguing.'),
    })),
  })),
  last: z.object({
    depth: z.union([z.const('shallow'), z.const('deep')])
      .description('The depth the table ran at; a stored value that is neither fails the namespace registration.'),
    rosterId: z.string().description('Roster id the last table seated.'),
    provider: z.string().description('Provider route the last table used.'),
    model: z.string().description('Model id the last table used.'),
  }),
})

/** Host configuration: the route and research limits a table starts from. */
export interface Config {
  /** Provider route for every speaker request; default `deepseek-official`. */
  readonly provider?: string
  /** Model id for every speaker request; default `deepseek-flash`. */
  readonly model?: string
  /** Model requests allowed in one deep speaker's research window. */
  readonly researchMaxSteps?: number
  /**
   * Model requests allowed in one shallow speaker's window. A shallow speaker
   * only searches ({@link SEARCH_TOOLS}), so its default of 2 leaves one
   * searching request before the forced answer.
   */
  readonly shallowMaxSteps?: number
  /** Wall-clock budget for one speaker's research window, milliseconds. */
  readonly researchMaxMillis?: number
  /** Characters of one research tool result that reach the model. */
  readonly researchMaxResultChars?: number
  /**
   * Archive root for closed tables; defaults to `<harness home>/roundtables`.
   * The read tools in `dsh-tool-roundtable` follow the same default.
   */
  readonly archiveDir?: string
  /**
   * Characters of earlier deep speakers' shared read material that a later
   * speaker's research opening carries (default 8000). Entries flow oldest
   * first until the budget is spent; the material itself stays capped per
   * call by `researchMaxResultChars`.
   */
  readonly sharedDigestMaxChars?: number
  /**
   * Whether a browser-driven (agentless) table gets its own read-only tool
   * scope (default true): the read-only tools this deployment registers,
   * mounted in a scope the engine owns. The web deployment disables root-level
   * tools in favor of per-session presets, so without this scope an agentless
   * room's catalog resolves to nothing and deep speakers cannot read the seed
   * export. Individual mounts fail soft (a missing capability service only
   * drops that tool) and log a warning.
   */
  readonly agentlessResearch?: boolean
  /**
   * Extra tool names a deep speaker's window may call besides the read-only
   * ones, default `['asset_run_bg']`: a background submission tool returns
   * before its work finishes, so the speaker keeps talking and the engine hands
   * the result back at a turn boundary. These tools are deliberately not marked
   * read-only — that flag's contract forbids changing the process or outside
   * systems — so the safety rule here is narrower: a deep window reaches the
   * background submission tools and no other mutating tool.
   */
  readonly backgroundTools?: string[]
  /**
   * Seconds a ledger run may stay `running` before a boundary treats it as lost
   * (default 3600). The detached process writes its own terminal record, so a
   * run that outlives this limit was killed and no terminal record will follow.
   */
  readonly runStalenessS?: number
}

/** Validate and default the roundtable host configuration. */
export const Config: z<Config> = z.object({
  provider: z.string().default('deepseek-official'),
  model: z.string().default('deepseek-flash'),
  researchMaxSteps: z.number().default(8),
  shallowMaxSteps: z.number().default(2),
  researchMaxMillis: z.number().default(120_000),
  researchMaxResultChars: z.number().default(8_000),
  archiveDir: z.string(),
  sharedDigestMaxChars: z.number().default(8_000),
  agentlessResearch: z.boolean().default(true),
  backgroundTools: z.array(z.string()).default(['asset_run_bg']),
  runStalenessS: z.number().default(3600),
})

/** One speaker's finished turn: the speech, and what its request carried. */
interface SpokenTurn {
  /** The exact shared context the request carried. */
  readonly context: string
  /** The spoken text; empty when the speaker thought and skipped. */
  readonly text: string
  /**
   * The speaker's thinking for the turn that produced the speech; empty when
   * the route emitted none. Shown beside the speech, never shared with the
   * table.
   */
  readonly reasoning: string
  /** What the speaker consulted, in call order. */
  readonly citations: readonly RoundtableCitation[]
  /** Whether a research limit ended the window before the speaker was done. */
  readonly truncated: boolean
  /** What a deep speaker's research window read; empty in a shallow table. */
  readonly steps: readonly ResearchStep[]
  /** The tool calls the turn made, in call order; empty when it made none. */
  readonly tools: readonly RoundtableToolActivity[]
  /** The turn's thinking and calls interleaved in the order they happened. */
  readonly flow: readonly RoundtableFlowItem[]
}

/** The user message that arrived mid-round, with the agent that sent it. */
interface PendingMessage {
  readonly text: string
  readonly agent: Agent | undefined
  /**
   * The speech the message's arrival froze, when the speaker was mid-turn: the
   * message's note carries it, so the table answers a sentence it can see.
   */
  readonly interrupted: InterruptedTurn | null
}

/**
 * A speaker turn the user stopped mid-flight: the speech it had written and
 * whatever its research window had already called. It is what `interrupt`
 * freezes into the transcript, because the reader already saw it and the text
 * joins every later speaker's context.
 */
interface InterruptedTurn {
  readonly speaker: string
  readonly name: string
  readonly text: string
  readonly reasoning: string
  readonly tools: readonly RoundtableToolActivity[]
  /** The turn's thinking and calls interleaved, frozen as they stood. */
  readonly flow: readonly RoundtableFlowItem[]
}

/**
 * The live partial as the engine writes it: the room view publishes it
 * read-only, the streaming fold appends to it in place.
 */
interface MutablePartial {
  readonly speaker: string
  readonly name: string
  text: string
  reasoning: string
  tools: RoundtableToolActivity[]
  flow: RoundtableFlowItem[]
}

/**
 * One speaker's turn as the fold builds it: the partial the page polls, plus
 * where the request currently streaming stands in each channel. A deep
 * speaker's research window makes several requests for ONE turn, and the reader
 * is owed the whole turn — the thinking especially, which is never re-emitted.
 * A new request therefore carries the earlier requests forward instead of
 * restarting the display.
 */
interface TurnFold {
  /** The live partial the room publishes, updated in place. */
  readonly partial: MutablePartial
  /** Whether the request now streaming has already written speech text. */
  wroteText: boolean
  /** Whether the request now streaming has already written thinking. */
  wroteReasoning: boolean
}

/**
 * The depth one open request names.
 * @param depth - the requested depth as it crossed the Remote boundary.
 * @returns the validated depth.
 * @throws {Error} when the request names neither depth.
 */
function resolveDepth(depth: string): RoundtableDepth {
  if (depth !== 'shallow' && depth !== 'deep') {
    throw new Error(`roundtable: unknown depth "${depth}" (available: shallow, deep)`)
  }
  return depth
}

/**
 * Validate one seed request: a non-empty session id and title, and a deep
 * table — shallow tables have no research window to read the export with.
 * @param seed - the caller's seed request.
 * @param depth - the depth the same open call named.
 * @returns the validated request, unchanged.
 */
function resolveSeedRequest(seed: { sessionId: string; title: string }, depth: RoundtableDepth): { sessionId: string; title: string } {
  if (depth !== 'deep') {
    throw new Error('roundtable: a seed conversation is a deep-table capability — open the table with depth "deep"')
  }
  if (seed.sessionId.trim() === '' || seed.title.trim() === '') {
    throw new Error('roundtable: a seeded table needs a non-empty sessionId and title')
  }
  return { sessionId: seed.sessionId.trim(), title: seed.title.trim() }
}

/**
 * Append one reasoning delta to a partial's activity timeline: thinking that
 * follows more thinking extends the same segment, while thinking that follows
 * a tool call opens a new one at the current position.
 * @param partial - the live partial to extend.
 * @param text - the delta text.
 * @param separated - whether the aggregate reasoning joins an earlier
 *   request's with a blank line, so the segment keeps the same separator.
 */
function appendFlowReasoning(partial: MutablePartial, text: string, separated: boolean): void {
  const last = partial.flow[partial.flow.length - 1]
  if (last !== undefined && last.kind === 'reasoning') {
    partial.flow[partial.flow.length - 1] = {
      kind: 'reasoning',
      text: `${last.text}${separated ? '\n\n' : ''}${text}`,
    }
    return
  }
  partial.flow.push({ kind: 'reasoning', text })
}

/** One tool call frozen as it stood when the turn stopped: nothing will settle it now. */
function freezeTool(tool: RoundtableToolActivity): RoundtableToolActivity {
  return tool.status === 'running' ? { ...tool, status: 'interrupted' } : { ...tool }
}

/** One flow item as the session log records it: the call flattened, as the `tools` field is. */
function flowLogItem(item: RoundtableFlowItem): {
  kind: 'reasoning'
  text: string
} | {
  kind: 'tool'
  key: string
  name: string
  arguments: string
  summary: string
  status: string
} {
  return item.kind === 'reasoning'
    ? { kind: 'reasoning', text: item.text }
    : { kind: 'tool', ...item.tool }
}

/**
 * The shared-context note a user message carries when it cancelled a speaker
 * mid-turn: what that speaker had already written, stated as unfinished rather
 * than as a conclusion.
 * @param turn - the speech the message's arrival froze.
 * @returns the note text joining the shared context.
 */
function interruptedNote(turn: InterruptedTurn): string {
  const tools = turn.tools.length === 0
    ? ''
    : `\n（它已查证：${turn.tools.map(tool => tool.summary === '' ? tool.name : `${tool.name} ${tool.summary}`).join('；')}）`
  return `「${turn.name}」的发言被这条消息打断，只在说了一半时停下。它已经说出的部分如下，你可以接着回应：\n${turn.text}${tools}`
}

/**
 * Read one background run's record file at a turn boundary. The file is a
 * durable boundary another process writes: absent or half-written before the
 * bridge flushes, corrupt if that process died, and a non-object when the file
 * was replaced by something else. All of those read as null, which the ledger
 * treats as a lost run.
 * @param recordPath - absolute path of the run record.
 * @returns the parsed record object, or null when it cannot be read as one.
 */
async function readRunRecord(recordPath: string): Promise<RunRecordBody | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(recordPath, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as RunRecordBody : null
  } catch {
    // The read and parse are the only statements in the `try`, so this
    // swallows exactly one unreadable-or-malformed record; the ledger's
    // staleness rule decides what a missing record means.
    return null
  }
}

/**
 * The `roundtable` Remote: rosters, the open-table configuration, and the room.
 */
export default class RoundtableGateway extends TypertRemoteService {
  static inject = ['settings', 'llm', 'sessionQuery']

  /** The settings scope registered once at construction; reads see overrides. */
  private readonly scope: SettingsScope<RoundtableSettings>

  /** The settings service, held for the writes this service makes. */
  private readonly settings: SettingsService

  /** The deployment's default route. */
  private readonly defaults: { provider: string; model: string }

  /** The deployment's research-window caps. */
  private readonly limits: ResearchLimits

  /** The shallow window's own step cap; its time and size caps are the deep ones. */
  private readonly shallowLimits: ResearchLimits

  /**
   * The context this service was constructed under, before any caller-bound
   * shadow wrapping: Remote calls run the gateway's methods with `this.ctx`
   * bound to the caller's shadow context, and a plugin mounted under a shadow
   * resolves its injected services from the shadow origin's fiber chain —
   * which never declared them, so the mount dies on its first `ctx.<service>`
   * access. The agentless tool scope mounts from this origin instead.
   */
  private readonly originCtx: Context

  /** The running table's configuration; null before it is opened, and null again once it is cleared. */
  private table: RoundtableTableConfig | null = null

  /** The one live room (single-table MVP; the page is a single surface). */
  private state: RoundtableState = openTable()
  private transcript: RoundtableEntry[] = []
  /** ISO instant the running table was opened; null while no table runs. */
  private openedAt: string | null = null
  /** Archive root closed tables are written to. */
  private readonly archiveDir: string
  /** Character budget of shared read material one deep opening carries. */
  private readonly sharedDigestMaxChars: number
  /** Whether agentless deep tables get the engine's read-only tool scope. */
  private readonly agentlessResearch: boolean
  /** Extra tool names a deep speaker's window may call besides the read-only ones. */
  private readonly backgroundTools: readonly string[]
  /** Seconds a still-running ledger run may stay `running` before it reads as lost. */
  private readonly runStalenessS: number
  /**
   * Supplement summaries waiting for their speaker's next floor: a boundary
   * fills one per finished run's speaker, and that speaker's turn spends it as
   * the supplement instruction's result summary.
   */
  private readonly supplements = new Map<string, string>()
  /**
   * What deep speakers' windows have read this table, deduplicated by tool
   * and exact arguments: later speakers receive it instead of re-reading.
   */
  private sharedReads: { name: string; arguments: string; result: string }[] = []
  /**
   * The agentless table's read-only tool scope, minted on first use; the stored
   * promise resolves once the tool plugins have finished mounting. Null until
   * the first deep speaker needs it.
   */
  private tableTools: Promise<ScopeKey | undefined> | null = null
  private busy = false
  /**
   * The speech streaming right now, when a speaker is mid-request: it is what
   * `room` publishes as `partial` so the page can render the turn growing. The
   * engine writes it in place and clears it when the turn settles.
   */
  private partial: MutablePartial | null = null
  /** A user message that arrived mid-round; applied the moment the floor frees. */
  private pending: PendingMessage | null = null
  /**
   * The speech `interrupt` froze, waiting for the aborted speaker's loop to
   * record it. The page has already shown that speech and it becomes part of
   * the shared context, so dropping it would lose a model-visible turn the log
   * owes a record of.
   */
  private interrupted: InterruptedTurn | null = null
  private drive: Promise<void> = Promise.resolve()
  private abort: AbortController | null = null
  /** The in-flight save chain; every room mutation queues its snapshot behind it. */
  private save: Promise<void> = Promise.resolve()
  /** The pending live-room save, or null when none is scheduled. */
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'roundtable')
    this.originCtx = ctx
    const resolved = Config(config)
    /* v8 ignore next 2 -- Config resolves every field through a defaulted schema, so no fallback is selected */
    this.defaults = { provider: resolved.provider ?? 'deepseek-official', model: resolved.model ?? 'deepseek-flash' }
    /* v8 ignore next 5 -- Config resolves every field through a defaulted schema, so no fallback is selected */
    this.limits = {
      maxSteps: resolved.researchMaxSteps ?? 8,
      maxMillis: resolved.researchMaxMillis ?? 120_000,
      maxResultChars: resolved.researchMaxResultChars ?? 8_000,
    }
    /* v8 ignore next 5 -- Config resolves every field through a defaulted schema, so no fallback is selected */
    this.shallowLimits = {
      maxSteps: resolved.shallowMaxSteps ?? 2,
      maxMillis: resolved.researchMaxMillis ?? 120_000,
      maxResultChars: resolved.researchMaxResultChars ?? 8_000,
    }
    this.archiveDir = config.archiveDir ?? roundtableArchiveDir()
    this.sharedDigestMaxChars = config.sharedDigestMaxChars ?? 8_000
    this.agentlessResearch = resolved.agentlessResearch !== false
    this.backgroundTools = resolved.backgroundTools ?? ['asset_run_bg']
    this.runStalenessS = resolved.runStalenessS ?? 3600
    this.settings = ctx.settings
    this.scope = ctx.settings.register('roundtable', RoundtableSettingsSchema, {
      base: {
        rosters: [],
        last: {
          depth: 'shallow',
          rosterId: DEFAULT_ROSTER_ID,
          provider: this.defaults.provider,
          model: this.defaults.model,
        },
      },
    })
    // The room survives a restart: restore the last process's table, or start
    // empty when there was none. The constructor runs this before the service
    // is resolvable, so nothing observes the room until it has settled; a
    // caller that reaches the room earlier queues behind the same promise.
    this.save = this.restore()
    ctx.effect(() => () => {
      if (this.saveTimer !== null) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
      this.persist()
    }, 'roundtable: live-room persistence')
  }

  /**
   * Load the last process's room, if it left one open. A missing file is the
   * ordinary "nothing was open" answer; a file that cannot be read or parsed
   * is reported loud and the process starts with no table, because a corrupt
   * live-room file must not keep the host from booting.
   */
  private async restore(): Promise<void> {
    let room: Awaited<ReturnType<typeof readLiveRoom>>
    try {
      room = await readLiveRoom(this.archiveDir)
    } catch (error: unknown) {
      this.ctx.logger.error(
        `roundtable: could not restore the live room from ${this.archiveDir}, starting with no table: ${String(error)}`,
      )
      return
    }
    if (room === null) return
    this.table = room.table
    this.state = room.state
    this.transcript = [...room.transcript]
    this.openedAt = room.openedAt
    this.sharedReads = [...room.sharedReads]
    // A room that was mid-round comes back waiting for the user: the speaker
    // generating then is gone, so nothing is busy and no partial survives.
    this.busy = false
    this.partial = null
    this.pending = null
    this.supplements.clear()
    this.ctx.logger.info(`roundtable: restored the open table seated "${room.table.rosterId}" (${String(room.transcript.length)} entries)`)
  }

  /** Every roster this deployment offers: shipped, plus the user's own. */
  private rosters(): ReturnType<typeof resolveRosters> {
    const stored: StoredRoster[] = this.scope.get().rosters
    return resolveRosters(stored)
  }

  /** The table's configuration: what was opened, or the remembered one resolved against today's rosters. */
  private tableConfig(): RoundtableTableConfig {
    if (this.table !== null) return this.table
    const last = this.scope.get().last
    return {
      depth: last.depth,
      rosterId: this.knownRosterId(last.rosterId),
      provider: last.provider === '' ? this.defaults.provider : last.provider,
      model: last.model === '' ? this.defaults.model : last.model,
    }
  }

  /**
   * The seating a remembered id names: the id itself when this deployment
   * offers it, and the default seating when it does not — including the empty
   * id a never-configured table carries — so a stale settings value can never
   * refuse a first message.
   * @param id - the remembered roster id.
   * @returns the roster id to seat.
   */
  private knownRosterId(id: string): string {
    return this.rosters().some(roster => roster.id === id) ? id : DEFAULT_ROSTER_ID
  }

  /** The speakers of the table's roster, in speaking order. */
  private speakers(): (RoundtableIdentity & { builtin: boolean })[] {
    return rosterIdentities(rosterFor(this.rosters(), this.tableConfig().rosterId))
  }

  /**
   * The agent this operation is driven for, when the caller runs the room from
   * an agent-scoped chain: its session is the room's log and scopes the tools
   * its speakers may call. A Remote caller from the browser has none, and the
   * room then runs agentless — no log, no session-scoped tool policy.
   */
  private initiator(): Agent | undefined {
    return this.ctx.get('agents')?.currentInitiator()
  }

  /** The room as the page renders it. */
  private view(): RoundtableRoomView {
    return {
      phase: this.state.phase,
      queue: this.state.queue,
      turns: this.state.turns,
      rounds: this.state.rounds,
      transcript: this.transcript,
      partial: this.partial,
      busy: this.busy,
      table: this.table,
    }
  }

  /**
   * The rosters the setup screen lists, with the table's current configuration.
   * @returns every roster with its resolved members, and the room snapshot.
   */
  @Remote
  roster(): Promise<{
    rosters: { id: string; name: string; builtin: boolean; members: RosterIdentity[] }[]
    table: RoundtableTableConfig
    room: RoundtableRoomView
  }> {
    return Promise.resolve({
      rosters: this.rosters().map(roster => ({
        id: roster.id,
        name: roster.name,
        builtin: roster.builtin,
        members: rosterIdentities(roster).map(identity => ({
          id: identity.id,
          name: identity.name,
          prompt: identity.prompt,
          builtin: identity.builtin,
          moderator: identity.moderator === true,
        })),
      })),
      // The setup screen opens on the configuration a table would run, so a
      // remembered seating that is gone shows the one that will be used.
      table: this.tableConfig(),
      room: this.view(),
    })
  }

  /**
   * Open a table with the three choices made, and remember them.
   *
   * Opening clears whatever table was running: the configuration is the
   * table's identity, so changing it cannot leave one table's transcript
   * attributed to another's roster.
   * @param depth - `shallow` or `deep`.
   * @param rosterId - the roster to seat; unknown ids are refused.
   * @param provider - the provider route every speaker request uses.
   * @param model - the model id every speaker request uses.
   * @returns the opened room's snapshot.
   * @throws {Error} when the depth or the roster id is not one this deployment offers.
   */
  @Remote
  async open(
    depth: string,
    rosterId: string,
    provider: string,
    model: string,
    seed?: { sessionId: string; title: string },
  ): Promise<RoundtableRoomView> {
    const resolvedDepth = resolveDepth(depth)
    const rosters = this.rosters()
    if (!rosters.some(roster => roster.id === rosterId)) {
      throw new Error(`roundtable: no roster "${rosterId}" (available: ${rosters.map(roster => roster.id).join(', ')})`)
    }
    // Seeding is the deep table's capability: a shallow table has no research
    // window, so an inlined conversation would be the only way to carry it —
    // exactly what seeding exists to avoid.
    const seedRequest = seed === undefined ? undefined : resolveSeedRequest(seed, resolvedDepth)
    const exportedSeed = seedRequest === undefined ? undefined : await this.exportSeed(seedRequest)
    // The table answers from what it was OPENED with rather than from the
    // settings read-back, so a table never depends on when its own write
    // becomes visible; the write is what the NEXT table starts from.
    const table: RoundtableTableConfig = {
      depth: resolvedDepth,
      rosterId,
      provider: provider.trim() === '' ? this.defaults.provider : provider.trim(),
      model: model.trim() === '' ? this.defaults.model : model.trim(),
      ...exportedSeed === undefined ? {} : { seed: exportedSeed },
    }
    await this.remember(table)
    // Opening replaces whatever table was running; a table that spoke archives
    // first, so its transcript cannot be attributed to the new roster. A write
    // failure keeps the old table running (fail loud, no silent loss).
    await this.archiveCurrentTable()
    this.abort?.abort()
    this.pending = null
    this.table = table
    this.state = openTable()
    this.transcript = []
    this.openedAt = new Date().toISOString()
    this.sharedReads = []
    this.busy = false
    this.partial = null
    this.interrupted = null
    this.supplements.clear()
    this.persist()
    this.initiator()?.session.append('roundtable/opened', {
      depth: table.depth,
      rosterId: table.rosterId,
      provider: table.provider,
      model: table.model,
      speakers: rosterIdentities(rosterFor(rosters, table.rosterId)).map(identity => ({
        id: identity.id,
        name: identity.name,
        prompt: identity.prompt,
        moderator: identity.moderator === true,
      })),
      ...exportedSeed === undefined ? {} : {
        seed: {
          sessionId: exportedSeed.sessionId,
          title: exportedSeed.title,
          file: exportedSeed.file,
        },
      },
    })
    return this.view()
  }

  /**
   * Store the user's own rosters, replacing the ones this caller did not list.
   * @param rosters - the complete set of user-authored rosters.
   * @returns once the settings write settles.
   */
  @Remote
  async saveRosters(rosters: StoredRoster[]): Promise<void> {
    await this.settings.mutate('roundtable', [{ op: 'set', path: ['rosters'], value: this.cleanRosters(rosters) }])
  }

  /**
   * The live room snapshot; poll this while a speaker is generating. The
   * snapshot carries `partial` — the turn currently streaming, text and
   * thinking — so a caller renders the speech as it is written instead of
   * waiting for the finished `roundtable/turn` to appear in the transcript.
   * @returns the current phase, queue, turns, rounds, transcript, partial, and busy flag.
   */
  @Remote
  room(): Promise<RoundtableRoomView> {
    return Promise.resolve(this.view())
  }

  /**
   * One user message into the room. Outside a round it opens or starts one;
   * mid-round it interrupts the current speaker, joins the context, and the
   * round resumes from the interrupted speaker (or narrows to an @点名 target).
   * A table that has not been opened yet is opened with the remembered
   * configuration, so the first message is never refused for a missing setup:
   * a remembered seating that no longer exists seats the default one, and the
   * room says so.
   * @param text - the user's message; empty input is refused.
   * @returns the acknowledgement with the room snapshot as it stands now.
   */
  @Remote
  async userMessage(text: string): Promise<RoundtableAck> {
    const trimmed = text.trim()
    if (trimmed === '') return { ok: false, error: 'empty message', room: this.view() }
    const agent = this.initiator()
    if (this.table === null) {
      const remembered = this.scope.get().last.rosterId
      const config = this.tableConfig()
      await this.open(config.depth, config.rosterId, config.provider, config.model)
      if (remembered !== config.rosterId) {
        this.record(agent, {
          kind: 'system',
          name: '圆桌',
          text: `上次的人员模式「${remembered}」已不在名册，本次改用「${rosterFor(this.rosters(), config.rosterId).name}」。`,
          at: new Date().toISOString(),
        })
      }
    }
    if (this.busy) {
      this.pending = { text: trimmed, agent, interrupted: this.freezePartial() }
      this.abort?.abort()
      return { ok: true, room: this.view() }
    }
    this.joinUser(trimmed, agent)
    this.drive = this.runRound(agent)
    /* v8 ignore next -- runRound contains every speaker failure in-loop, so this drive promise never rejects */
    void this.drive.catch(() => {})
    return { ok: true, room: this.view() }
  }

  /**
   * Stop the round the table is running: the speaker generating right now has
   * its request cancelled, and the speech it had already streamed is frozen
   * into the transcript as an interrupted turn — what the reader saw stays
   * visible, and later speakers answer what was said rather than a blank. The
   * table goes back to waiting for the user, so no further speaker takes the
   * floor and the next {@link userMessage} opens a fresh round; an
   * interruption is not a steer.
   *
   * This is a separate unary call precisely so it can run while
   * {@link userMessage}'s round is in flight: `userMessage` returns as soon as
   * the round has started, and the Gateway dispatches each request as it
   * arrives, so the interrupt handler is reached while speakers are generating.
   * @returns the room snapshot once the cancelled round has unwound.
   */
  @Remote
  async interrupt(): Promise<RoundtableRoomView> {
    this.pending = null
    this.interrupted = this.freezePartial()
    this.abort?.abort()
    this.state = interruptRound(this.state)
    this.partial = null
    // Report the settled room rather than the one still tearing down: the
    // aborting speaker's own unwinding records the frozen turn and clears
    // `busy`.
    await this.drive.catch(() => {})
    return this.view()
  }

  /**
   * Clear the table and release its configuration, so the open-table setup is
   * reachable again and the next table may be configured differently. The
   * choices stay remembered as that setup's defaults, and a table that spoke
   * archives its transcript first.
   * @returns the closed room snapshot.
   */
  @Remote
  async reset(): Promise<RoundtableRoomView> {
    await this.archiveCurrentTable()
    this.abort?.abort()
    this.pending = null
    this.table = null
    this.state = openTable()
    this.transcript = []
    this.openedAt = null
    this.sharedReads = []
    this.busy = false
    this.partial = null
    this.interrupted = null
    this.supplements.clear()
    this.persist()
    return this.view()
  }

  /**
   * Archive the running table's transcript, when it has one, to the archive
   * root. Empty openings write nothing; a table mid-drive archives what has
   * joined so far and the room continues to clear.
   */
  private async archiveCurrentTable(): Promise<void> {
    const table = this.table
    if (table === null || this.transcript.length === 0) return
    await writeRoundtableArchive(this.archiveDir, {
      version: 1,
      openedAt: this.openedAt,
      closedAt: new Date().toISOString(),
      table: {
        depth: table.depth,
        rosterId: table.rosterId,
        rosterName: rosterFor(this.rosters(), table.rosterId).name,
        provider: table.provider,
        model: table.model,
        ...table.seed === undefined ? {} : {
          seed: { sessionId: table.seed.sessionId, title: table.seed.title },
        },
      },
      transcript: [...this.transcript],
    })
  }

  /**
   * The archive listing for the roundtable history surface: recent closed
   * tables, newest first, without their transcripts.
   *
   * `limit` is declared required-with-undefined rather than optional: a Remote
   * caller passes every declared parameter positionally, so a short call is
   * rejected by the Client face before this method is reached.
   * @param limit - maximum rows (1–50); `undefined` takes the default 12.
   * @returns the summaries the history column renders.
   */
  @Remote
  archiveList(limit: number | undefined): Promise<RoundtableArchiveSummary[]> {
    const bound = Math.min(Math.max(Math.trunc(limit ?? 12) || 1, 1), 50)
    return listRoundtableArchives(this.archiveDir, bound)
  }

  /**
   * One archived table in full: its configuration and complete transcript.
   * @param id - archive id from {@link archiveList}.
   * @returns the complete archived record.
   * @throws when the id is malformed, absent, or the archive is corrupt.
   */
  @Remote
  archiveRead(id: string): Promise<RoundtableArchiveRecord> {
    return readRoundtableArchive(this.archiveDir, id)
  }

  /**
   * Queue a save of the open room, coalescing the changes of one polling
   * interval into a single write: the page renders the live partial, so saving
   * on every delta would rewrite the file for text nobody resumes from.
   *
   * Every mutation reaches this, so the debounce can only delay a write, never
   * drop one — and {@link flush} chains each snapshot behind the previous
   * write, so two saves can never interleave.
   */
  private persist(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 120)
  }

  /** Queue this room's snapshot behind the writes already in flight. */
  private flush(): void {
    this.save = this.save.then(() => this.writeRoom())
  }

  /**
   * Write this room's durable copy, or remove it when it holds nothing to
   * resume. The table configuration alone is a room: the setup screen must
   * still be reachable, and reopening has to remember the same three choices.
   */
  private async writeRoom(): Promise<void> {
    const table = this.table
    try {
      if (table === null && this.transcript.length === 0) {
        await writeLiveRoom(this.archiveDir, null)
        return
      }
      await writeLiveRoom(this.archiveDir, {
        version: 1,
        openedAt: this.openedAt ?? new Date().toISOString(),
        table: table ?? this.tableConfig(),
        state: this.state,
        transcript: [...this.transcript],
        sharedReads: boundSharedReads(this.sharedReads),
      })
    } catch (error: unknown) {
      // The durable copy is what a RESTART relies on; a disk that refuses it
      // must not take the running room down with it.
      this.ctx.logger.warn(`roundtable: could not persist the live room: ${String(error)}`)
    }
  }

  /**
   * Remember the table's configuration for the next one. Opening never depends
   * on this write: a read-only provider stores nothing, and a provider that
   * refuses the write leaves the table running — the next table then starts
   * from whatever was remembered last.
   */
  private async remember(config: RoundtableTableConfig): Promise<void> {
    if (!this.settings.writable) return
    try {
      // The remembered configuration carries the four route choices only: a
      // seed belongs to the table that opened with it, never to the next one.
      const { depth, rosterId, provider, model } = config
      await this.settings.mutate('roundtable', [{ op: 'set', path: ['last'], value: { depth, rosterId, provider, model } }])
    } catch (error) {
      // The remembered configuration is a convenience for the NEXT table; a
      // provider that refuses this one write must not take a room down.
      this.ctx.logger.warn(`roundtable: could not remember the table configuration: ${String(error)}`)
    }
  }

  /**
   * Append one transcript entry, logging the entries every later speaker
   * request carries. A speaker turn is logged by {@link turnLog}, which has
   * the request that produced it.
   * @param agent - the agent driving this room, when one does.
   * @param entry - the entry joining the shared context.
   */
  private record(agent: Agent | undefined, entry: RoundtableEntry): void {
    this.transcript.push(entry)
    this.persist()
    if (entry.kind === 'speaker') return
    agent?.session.append('roundtable/message', { kind: entry.kind, name: entry.name, text: entry.text })
  }

  /**
   * Log one speaker turn: the request inputs a reader needs to rebuild it, and
   * the speech it produced. An interrupted turn is logged the same way — its
   * text reached later speakers' context, so the log owes it a record.
   * @param agent - the agent driving this room, when one does.
   * @param identity - the speaker that held the floor.
   * @param spoken - what its request carried and produced.
   * @param text - the turn's recorded text, skip marker included.
   */
  private turnLog(agent: Agent | undefined, identity: RoundtableIdentity, spoken: SpokenTurn, text: string): void {
    agent?.session.append('roundtable/turn', {
      speaker: identity.id,
      name: identity.name,
      system: identity.prompt,
      context: spoken.context,
      text,
      ...spoken.reasoning === '' ? {} : { reasoning: spoken.reasoning },
      citations: [...spoken.citations],
      truncated: spoken.truncated,
      ...spoken.steps.length === 0 ? {} : { research: [...spoken.steps] },
      ...spoken.tools.length === 0 ? {} : { tools: spoken.tools.map(tool => ({ ...tool })) },
      ...spoken.flow.length === 0 ? {} : { flow: spoken.flow.map(flowLogItem) },
    })
  }

  /**
   * Log one interrupted turn: the same record as a finished turn, with
   * `interrupted: true` and the empty research fields the request never
   * reached. The reader can rebuild what the speaker had said before it lost
   * the floor, and nothing claims a conclusion it never drew.
   * @param agent - the agent driving this room, when one does.
   * @param turn - the speech the interrupt froze.
   * @param context - the shared context the interrupted turn was answering.
   * @param system - the speaking contract of the interrupted speaker.
   */
  private interruptedLog(
    agent: Agent | undefined,
    turn: InterruptedTurn,
    context: string,
    system: string,
  ): void {
    agent?.session.append('roundtable/turn', {
      speaker: turn.speaker,
      name: turn.name,
      system,
      context,
      text: turn.text,
      ...turn.reasoning === '' ? {} : { reasoning: turn.reasoning },
      citations: [],
      truncated: false,
      ...turn.tools.length === 0 ? {} : { tools: turn.tools.map(tool => ({ ...tool })) },
      ...turn.flow.length === 0 ? {} : { flow: turn.flow.map(flowLogItem) },
      interrupted: true,
    })
  }

  /**
   * Freeze the speaker the user stopped into the transcript: the speech and
   * thinking it had streamed, plus its tool calls, marked as interrupted. The
   * entry joins the shared context like any other speaker turn, because a
   * later speaker answers what was said — so it is recorded and logged rather
   * than discarded.
   * @param agent - the agent driving this room, when one does.
   * @param turn - the speech the interrupt froze.
   */
  private recordInterrupted(agent: Agent | undefined, turn: InterruptedTurn): void {
    const entry: RoundtableEntry = {
      kind: 'speaker',
      speaker: turn.speaker,
      name: turn.name,
      text: turn.text,
      at: new Date().toISOString(),
      ...turn.reasoning === '' ? {} : { reasoning: turn.reasoning },
      ...turn.tools.length === 0 ? {} : { tools: [...turn.tools] },
      ...turn.flow.length === 0 ? {} : { flow: [...turn.flow] },
      interrupted: true,
    }
    this.record(agent, entry)
    this.interruptedLog(agent, turn, this.contextBefore(entry), this.speakerPrompt(turn.speaker))
  }

  /**
   * Join the turn `interrupt` froze to the transcript, once. A stopped request
   * reaches the driving loop as a terminal `aborted` finish rather than as an
   * exception (see the LLM runtime's adapter-failure normalization), so the
   * speaker returns normally and its caller must claim the freeze on that path
   * too — otherwise the stopped turn is dropped when the round unwinds.
   * @param agent - the agent driving this room, when one does.
   */
  private claimInterrupted(agent: Agent | undefined): void {
    const frozen = this.interrupted
    this.interrupted = null
    if (frozen !== null) this.recordInterrupted(agent, frozen)
  }

  /**
   * The shared context as it stood before one entry joined it.
   * @param entry - the entry to exclude.
   * @returns the context text the entry's own request carried.
   */
  private contextBefore(entry: RoundtableEntry): string {
    return this.transcript
      .slice(0, Math.max(0, this.transcript.lastIndexOf(entry)))
      .map(row => `[${row.name}]：${row.text}`)
      .join('\n\n')
  }

  /** One speaker's contract, or an empty one when the roster no longer seats it. */
  private speakerPrompt(id: string): string {
    return this.speakers().find(row => row.id === id)?.prompt ?? ''
  }

  /**
   * Append the user's message and advance the machine for it. A message that
   * cancelled the speaker mid-turn carries what that speaker had already said
   * as a note right below it, because the sentence it interrupted is part of
   * what the table is answering; the interrupted speaker then resumes its turn
   * with the message in front of it.
   * @param text - the user's message.
   * @param agent - the agent driving this room, when one does.
   * @param interrupted - the speech the message's arrival froze, when one was.
   */
  private joinUser(text: string, agent: Agent | undefined, interrupted: InterruptedTurn | null = null): void {
    this.record(agent, { kind: 'user', name: '用户', text, at: new Date().toISOString() })
    if (interrupted !== null) {
      this.record(agent, {
        kind: 'system',
        name: '圆桌',
        text: interruptedNote(interrupted),
        at: new Date().toISOString(),
      })
    }
    const seats = this.speakers().map(row => ({
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      ...row.moderator === true ? { moderator: true } : {},
    }))
    this.state = onUserMessage(this.state, text, seats)
  }

  /**
   * Render the shared context every speaker sees, oldest first.
   *
   * An interrupted turn is rendered as such rather than as a finished speech:
   * its text is what the speaker had written when it lost the floor, and a
   * later speaker answering it as a conclusion would be answering something
   * nobody said.
   */
  private contextText(): string {
    return this.transcript
      .map(entry => entry.interrupted === true
        ? `[${entry.name}]（发言被打断，仅完成以下部分）：${entry.text}`
        : `[${entry.name}]：${entry.text}`)
      .join('\n\n')
  }

  /** A floor id as a person reads it: the current roster's name, else the id. */
  private speakerName(id: string): string {
    return this.speakers().find(row => row.id === id)?.name ?? id
  }

  /**
   * The user's rosters as the settings document stores them: ids normalized,
   * members without an id dropped, and a roster left with no members dropped
   * whole (an empty seating seats nobody, so it is not one).
   * @param rosters - what the caller sent.
   * @returns the rows to store.
   */
  private cleanRosters(rosters: readonly StoredRoster[]): StoredRoster[] {
    return rosters
      .map(roster => ({
        id: rosterIdFrom(roster.id.trim() === '' ? roster.name : roster.id),
        name: roster.name.trim(),
        members: roster.members
          .filter(member => member.id.trim() !== '')
          .map(member => ({
            id: member.id.trim(),
            name: member.name,
            prompt: member.prompt,
            moderator: member.moderator,
          })),
      }))
      .filter(roster => roster.members.length > 0)
  }

  /**
   * Note one background run this table just submitted, so the next turn
   * boundary can hand its result back to the speaker that asked for it. The
   * tool that submits the run knows the run but not the speaker, so the engine
   * fills the speaker from the turn streaming right now; `speaker` is only a
   * fallback for a caller that does. A call with no open table, a table that is
   * not between boundaries, or no identifiable speaker is ignored — the run
   * keeps running and its record stays on disk.
   * @param entry - the run to follow: id, record path, asset, verb, and
   *   submission instant; `speaker` is optional.
   */
  noteBackgroundRun(entry: {
    readonly runId: string
    readonly recordPath: string
    readonly asset: string
    readonly verb: string
    readonly speaker?: string
    readonly submittedAt: string
  }): void {
    if (this.table === null) return
    if (this.state.phase !== 'round' && this.state.phase !== 'wait-user-guide') return
    const speaker = this.partial?.speaker ?? entry.speaker ?? ''
    if (speaker === '') return
    const pendingRuns: PendingRun[] = [
      ...this.state.pendingRuns ?? [],
      {
        runId: entry.runId,
        recordPath: entry.recordPath,
        asset: entry.asset,
        verb: entry.verb,
        speaker,
        submittedAt: entry.submittedAt,
      },
    ]
    this.state = { ...this.state, pendingRuns }
    this.persist()
  }

  /**
   * The turn boundary's ledger check: read every unconsumed run's record, and
   * hand finished ones to the table as a system note plus one supplement floor
   * for the speaker that submitted them. A run still running past
   * `runStalenessS`, or whose record cannot be read, is noted as lost and drops
   * out of the ledger. The round runs this both when it starts — a run may have
   * finished after the previous round ended — and after every speaker steps
   * down, because a run may finish either way.
   * @param agent - the agent driving this room, when one does.
   */
  private async consumeRuns(agent: Agent | undefined): Promise<void> {
    const entries = this.state.pendingRuns ?? []
    if (entries.length === 0) return
    const observations: PendingRunObservation[] = await Promise.all(entries.map(async entry => ({
      entry,
      body: await readRunRecord(entry.recordPath),
    })))
    const outcome = consumePendingRuns(this.state, observations, { now: Date.now(), stalenessS: this.runStalenessS })
    this.state = outcome.state
    for (const note of outcome.notes) {
      this.record(agent, { kind: 'system', name: '圆桌', text: note, at: new Date().toISOString() })
    }
    for (const supplement of outcome.supplements) {
      const earlier = this.supplements.get(supplement.speaker)
      this.supplements.set(
        supplement.speaker,
        earlier === undefined ? supplement.summary : `${earlier}\n\n${supplement.summary}`,
      )
    }
    this.persist()
  }

  /**
   * The deep speaker's extra briefing, appended to the shared context: the
   * seed conversation's file (the speaker reads it itself — it is never
   * inlined), the material earlier deep speakers already read (shared, so
   * the same fetch is never repeated), and the asset background-run discipline
   * (submit long work detached, expect the engine to schedule a supplement
   * turn, and treat the submission tool as the only mutating tool in reach).
   * Empty on a fresh shallow table whose speakers have not read anything yet.
   */
  private deepBriefing(): string {
    const sections: string[] = []
    if (this.backgroundTools.includes('asset_run_bg')) {
      sections.push(
        '',
        '—— 资产后台运行纪律 ——',
        '1. 长任务（拉数据、训练、回测、刷新面板等）一律先用 asset_run_bg 提交后台 run，拿到 run_id 后立即继续本轮发言；禁止同步空等结果，也禁止轮询等它跑完。',
        '2. 引擎会在回合边界检查已完成的 run，并给你一轮补充发言；结果回来后先给出结论，再说明它是否修正你此前的观点，聚焦增量、不要重复此前发言。',
        '3. asset_run_bg 是本桌唯一可用的提交类工具，其余会改动资产或外部系统的工具在本桌不可用。',
      )
    }
    const seed = this.tableConfig().seed
    if (seed !== undefined) {
      sections.push(
        '',
        '—— 本次接续的既有对话 ——',
        `「${seed.title}」的完整对话已导出为文件：${seed.file}`,
        '发言前先用 read 工具阅读该文件（内容较长时可分段读取），并按需读取工作区中的相关文件；不要凭空假设其内容。',
      )
    }
    if (this.sharedReads.length > 0) {
      const budget = this.sharedDigestMaxChars
      const lines: string[] = []
      let used = 0
      let omitted = 0
      for (const read of this.sharedReads) {
        const entry = `- [${read.name}] ${read.arguments} → ${read.result}`
        if (used + entry.length > budget) {
          omitted = this.sharedReads.length - lines.length
          break
        }
        lines.push(entry)
        used += entry.length
      }
      sections.push(
        '',
        '—— 前序发言者已查证材料（全桌共享） ——',
        '以下材料本桌更早的发言者已经读取过，直接引用即可，不必重复调用同样的工具获取：',
        ...lines,
        ...(omitted > 0 ? [`（另有 ${String(omitted)} 条较早的材料未随附，如需要可自行读取）`] : []),
      )
    }
    return sections.join('\n')
  }

  /**
   * Freeze the live partial into the turn `interrupt` records. A tool call
   * still in flight when the table stopped is reported as interrupted rather
   * than running: nothing will settle it now.
   * @returns the frozen turn, or null when no speaker was mid-turn.
   */
  private freezePartial(): InterruptedTurn | null {
    const partial = this.partial
    if (partial === null) return null
    const tools = partial.tools.map(freezeTool)
    const frozen = new Map(tools.map(tool => [tool.key, tool]))
    return {
      speaker: partial.speaker,
      name: partial.name,
      text: partial.text,
      reasoning: partial.reasoning,
      tools,
      flow: partial.flow.map(item => item.kind === 'reasoning'
        ? item
        : { kind: 'tool', tool: frozen.get(item.tool.key) ?? freezeTool(item.tool) }),
    }
  }

  /**
   * Merge one deep speaker's finished window reads into the table's shared
   * material, deduplicated by tool and exact arguments: a later speaker that
   * would issue the same call already has its result in the briefing.
   * @param steps - the speaker's research steps, refusals included.
   */
  private shareReads(steps: readonly { name: string; arguments: string; result: string; isError: boolean }[]): void {
    let changed = false
    for (const step of steps) {
      if (step.isError) continue
      const key = `${step.name}:${step.arguments}`
      if (this.sharedReads.some(read => `${read.name}:${read.arguments}` === key)) continue
      this.sharedReads.push({ name: step.name, arguments: step.arguments, result: step.result })
      changed = true
    }
    if (changed) this.persist()
  }

  /**
   * Fold one call's state change into the live partial: a call the model just
   * started opens a line, and the same call's settled state updates it in
   * place, so the page shows a speaker looking things up while it talks. The
   * call also lands at its point in the partial's activity timeline: a new call
   * closes the reasoning segment above it, and a settled one updates where it
   * already sits instead of moving.
   * @param activity - the call's new state.
   */
  private reportToolActivity(activity: ResearchToolActivity): void {
    const partial = this.partial
    if (partial === null) return
    const existing = partial.tools.find(tool => tool.key === activity.callId)
    this.placeTool(partial, existing === undefined
      ? {
        key: activity.callId,
        name: activity.name,
        arguments: activity.arguments,
        summary: activity.text ?? '',
        status: activity.status,
      }
      : {
        ...existing,
        arguments: activity.arguments === '' ? existing.arguments : activity.arguments,
        status: activity.status,
        ...activity.text === undefined ? {} : { summary: activity.text },
      })
  }

  /**
   * Put one call's line into the live partial, both in the call-order `tools`
   * list and at its position in the activity timeline: a call already known is
   * replaced where it stands, a new one opens after the reasoning so far.
   * @param partial - the live partial to update.
   * @param tool - the call's current state.
   */
  private placeTool(partial: MutablePartial, tool: RoundtableToolActivity): void {
    const at = partial.tools.findIndex(entry => entry.key === tool.key)
    if (at === -1) partial.tools.push(tool)
    else partial.tools[at] = tool
    const flow = partial.flow.findIndex(item => item.kind === 'tool' && item.tool.key === tool.key)
    if (flow === -1) partial.flow.push({ kind: 'tool', tool })
    else partial.flow[flow] = { kind: 'tool', tool }
  }

  /**
   * The agentless table's read-only tool scope, minted on first use: the
   * whitelist's file and web tools mounted in a scope this engine owns, so a
   * browser-driven deep table can actually read what its briefing names. The
   * returned promise resolves only after every mount has settled, and a mount
   * whose injects cannot resolve from the engine's origin settles PENDING
   * without ever starting — so the resolved catalog is checked and a scope
   * that resolved no whitelist tool fails loud in the log instead of seating
   * silent toolless speakers. Each mount fails soft; a deployment without the
   * capability service keeps that tool out of the catalog and logs why.
   * @returns the scope key the research window resolves tools in, resolved
   *   once the mounts settle; undefined when disabled by configuration.
   */
  private tableToolScope(): Promise<ScopeKey | undefined> {
    this.tableTools ??= this.mountTableTools()
    return this.tableTools
  }

  /** Mint the agentless table's tool scope and settle its plugin mounts. */
  private async mountTableTools(): Promise<ScopeKey | undefined> {
    if (this.agentlessResearch === false) return undefined
    const key: ScopeKey = {}
    const scope = createScope(this.originCtx, key)
    const mounts: readonly [label: string, plugin: unknown, config?: Record<string, unknown>][] = [
      ['tool-fs', ToolFs],
      // tool-fs-search declares a required `sampleOverCapGlobResults`; both
      // shipped composition rows set it false, and the engine's own mount
      // names it explicitly because a config-less namespace mount fails the
      // plugin's schema validation outright.
      ['tool-fs-search', ToolFsSearch, { sampleOverCapGlobResults: false }],
      ['tool-web', ToolWeb],
    ]
    await Promise.all(mounts.map(async ([label, plugin, mountConfig]) => {
      // A plugin object namespace is this loader's plugin form; the cast to a
      // function plugin only satisfies the registry's config-arg inference —
      // the config each mount needs is passed separately. A Fiber is a
      // PromiseLike without .catch, so the soft-fail wraps it.
      try {
        await scope.ctx.plugin(plugin as (ctx: Context, config?: Record<string, unknown>) => void, mountConfig)
      } catch (error: unknown) {
        this.ctx.logger.warn(`roundtable: agentless research could not mount ${label}: ${String(error)}`)
      }
    }))
    const visible = researchCatalog(this.ctx, 'read-only', key).length
    if (visible === 0) {
      this.ctx.logger.warn(
        'roundtable: the agentless research scope resolved no read-only tool — deep speakers on a '
        + 'browser-driven table will answer without looking anything up',
      )
    }
    return key
  }

  /**
   * Materialize one seed request: read the named session through the
   * session-query service, render its visible conversation, and write it
   * under the archive root's `seeds/` staging folder.
   * @param seed - the session to continue and its display title.
   * @returns the complete seed the table and its speakers carry.
   * @throws when the session cannot be read or the export cannot be written.
   */
  private async exportSeed(seed: SeedRequest): Promise<RoundtableSeed> {
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) {
      throw new Error('roundtable: a seeded table needs the session-query service in the composition')
    }
    const snapshot = await query.readSession(SessionId(seed.sessionId))
    const file = await writeSeedFile(this.archiveDir, renderConversation(snapshot.events, seed.title))
    return { sessionId: seed.sessionId, title: seed.title, file }
  }

  /** The one user message that carries the table and this speaker's turn. */
  private speakMessage(context: string, closing: string): Message {
    return createUserMessage({
      content: [{
        type: 'text',
        text: [
          '以下是圆桌到目前为止的全部上下文（依次，最新在最后）：',
          '',
          context,
          '',
          closing,
        ].join('\n'),
      }],
      source: { kind: 'roundtable', form: 'notice', summary: '圆桌上下文' },
    })
  }

  /** One request against the table's chosen route. */
  private request(
    system: string,
    messages: readonly Message[],
    tools: readonly ToolSchema[],
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    const table = this.tableConfig()
    return this.ctx.llm.stream({
      provider: table.provider,
      model: table.model,
      system,
      messages: [...messages],
      ...tools.length === 0 ? {} : { tools: [...tools] },
      signal,
    })
  }

  /**
   * One speaker's turn: a bounded window over the tools its depth allows, then
   * the speech. A shallow speaker may only search (`search` breadth); a deep
   * one may call every read-only tool this deployment registers. Both arms open
   * with the same message — the whole shared context plus the instruction to
   * speak — so a deep speaker researches with the table in front of it and
   * answers the same question the shallow one does. Every delta the route
   * streams is mirrored into the room's live partial, and every tool call the
   * window makes is folded into it too, so the page renders the turn — speech,
   * thinking, and lookups — as it is written. The partial is cleared when the
   * turn settles; only an interrupted turn's frozen remainder is recorded.
   * @param identity - the speaker taking the floor.
   * @param signal - the caller's cancellation.
   * @param agent - the agent driving this room, when one does; its session
   *   scopes the research tools and resolves their relative paths.
   * @param supplement - the finished background run's summary, when this turn
   *   answers one: the closing asks for the conclusion first and then for how
   *   it corrects what the speaker already said.
   * @returns the spoken text and what the speaker consulted.
   */
  private async speak(
    identity: RoundtableIdentity,
    signal: AbortSignal,
    agent: Agent | undefined,
    supplement?: { readonly summary: string },
  ): Promise<SpokenTurn> {
    const closing = supplement === undefined
      ? `现在轮到你。请以「${identity.name}」的身份，按你的发言契约给出本轮发言。直接输出发言内容本身，不要重复身份标签，不要替其他身份发言。`
      : `你此前提交的后台运行已完成，结果摘要如下：\n${supplement.summary}\n请先给出结论，再说明它是否修正你此前的观点；不要重复此前发言，聚焦增量。`
    const context = this.contextText()
    const deep = this.tableConfig().depth === 'deep'
    const fold: TurnFold = {
      partial: { speaker: identity.id, name: identity.name, text: '', reasoning: '', tools: [], flow: [] },
      wroteText: false,
      wroteReasoning: false,
    }
    this.partial = fold.partial
    try {
      const opening = this.speakMessage(deep ? `${context}${this.deepBriefing()}` : context, closing)
      // An agent-driven room researches under the agent's own scope; a
      // browser-driven one under the table's dedicated read-only tool scope,
      // awaited until its mounts settle so the window's first catalog read
      // sees the tools the scope owns.
      const scope = agent === undefined ? await this.tableToolScope() : undefined
      const outcome = await runResearchWindow(
        this.ctx,
        {
          ...agent === undefined ? {} : { agent },
          ...scope === undefined ? {} : { scope },
          signal,
          opening,
          breadth: deep ? 'read-only' : 'search',
          ...deep ? { backgroundTools: this.backgroundTools } : {},
          onToolActivity: activity => { this.reportToolActivity(activity) },
        },
        deep ? this.limits : this.shallowLimits,
        (messages, tools) => this.mirror(this.request(identity.prompt, messages, tools, signal), fold),
      )
      return {
        context,
        text: outcome.text,
        reasoning: outcome.reasoning,
        citations: outcome.citations,
        // A shallow window's step cap IS its design — search once, then speak —
        // so reaching it is not the research deadline the page warns about.
        truncated: deep && outcome.truncated,
        steps: outcome.steps,
        tools: fold.partial.tools.map(tool => ({ ...tool })),
        flow: fold.partial.flow.map(item => item.kind === 'reasoning'
          ? { ...item }
          : { kind: 'tool', tool: { ...item.tool } }),
      }
    } finally {
      this.partial = null
    }
  }

  /**
   * One request's stream, mirrored into the speaker's live partial as its
   * deltas arrive. A research window makes several requests for one turn and
   * the partial keeps all of them: the first delta of a channel in a NEW
   * request opens a blank line after what the earlier requests already wrote,
   * so the reader keeps the whole turn — thinking included — and never sees a
   * finished request's text streamed twice. A tool call opens its line the
   * moment the model starts streaming it — before the window has run anything —
   * so a lookup is visible while it is happening. Thinking and calls also
   * append to the partial's activity timeline in the order they arrive, which
   * is what a reader renders as one interleaved stream.
   * @param chunks - the provider's stream for one request.
   * @param fold - the turn's live fold, updated in place.
   * @returns the same chunks, unchanged.
   */
  private async *mirror(chunks: AsyncIterable<StreamChunk>, fold: TurnFold): AsyncIterable<StreamChunk> {
    fold.wroteText = false
    fold.wroteReasoning = false
    for await (const chunk of chunks) {
      if (chunk.type === 'text-delta') {
        fold.partial.text += fold.wroteText || fold.partial.text === '' ? chunk.text : `\n\n${chunk.text}`
        fold.wroteText = true
      } else if (chunk.type === 'reasoning-delta') {
        const separated = !fold.wroteReasoning && fold.partial.reasoning !== ''
        fold.partial.reasoning += `${separated ? '\n\n' : ''}${chunk.text}`
        appendFlowReasoning(fold.partial, chunk.text, separated)
        fold.wroteReasoning = true
      } else if (chunk.type === 'tool-call-delta') {
        const id = String(chunk.id)
        if (!fold.partial.tools.some(tool => tool.key === id)) {
          this.placeTool(fold.partial, {
            key: id,
            name: chunk.name ?? '',
            arguments: chunk.argumentsDelta,
            summary: '',
            status: 'running',
          })
        }
      }
      yield chunk
    }
  }

  /**
   * Drive the current round to its end: each floor speaker gets one turn;
   * a failure records a skipped turn with a system note instead of stalling
   * the table. An interruption (abort) exits; the pending user message then
   * re-opens the round from the interrupted speaker.
   * @param agent - the agent driving this round, when one does.
   */
  private async runRound(agent: Agent | undefined): Promise<void> {
    this.busy = true
    try {
      // A run may have finished after the previous round ended, when the table
      // was already back at the user; its result joins this round.
      await this.consumeRuns(agent)
      while (this.state.phase === 'round') {
        const floor = currentFloor(this.state)
        const identity = this.speakers().find(row => row.id === floor)
        if (floor === null || identity === undefined) {
          this.record(agent, {
            kind: 'system', name: '圆桌',
            /* v8 ignore next -- onSpeakerDone ends the round at one remaining speaker, so a round-phase queue is never empty */
            text: `发言者「${this.speakerName(floor ?? '')}」已不在名册，跳过。`, at: new Date().toISOString(),
          })
          this.state = onSpeakerDone(this.state, 'skipped')
          continue
        }
        this.abort = new AbortController()
        const controller = this.abort
        let outcome: 'spoke' | 'skipped'
        // A supplement floor spends the summary the boundary queued for this
        // speaker; a floor without one speaks the ordinary turn.
        const supplement = this.supplements.get(identity.id)
        this.supplements.delete(identity.id)
        try {
          const spoken = await this.speak(
            identity,
            controller.signal,
            agent,
            supplement === undefined ? undefined : { summary: supplement },
          )
          // A user message that arrived mid-request aborted this speaker: the
          // turn is not recorded, and the round resumes from this same speaker
          // once the message has joined the shared context. Its partial rides
          // that message's notice instead (see `joinUser`). An explicit
          // `interrupt` froze the turn before aborting, and a stopped request
          // ends in an `aborted` finish instead of an exception, so the freeze
          // is claimed here as well as in the catch below.
          if (controller.signal.aborted) {
            this.claimInterrupted(agent)
            return
          }
          const text = spoken.text === '' ? '（思考后跳过）' : spoken.text
          this.record(agent, {
            kind: 'speaker', speaker: identity.id, name: identity.name,
            text,
            ...spoken.reasoning === '' ? {} : { reasoning: spoken.reasoning },
            ...spoken.citations.length === 0 ? {} : { citations: [...spoken.citations] },
            ...spoken.truncated ? { truncated: true } : {},
            ...spoken.tools.length === 0 ? {} : { tools: spoken.tools.map(tool => ({ ...tool })) },
            ...spoken.flow.length === 0 ? {} : { flow: spoken.flow },
            at: new Date().toISOString(),
          })
          this.turnLog(agent, identity, spoken, text)
          this.shareReads(spoken.steps)
          outcome = spoken.text === '' ? 'skipped' : 'spoke'
        } catch (error) {
          if (controller.signal.aborted) {
            // An explicit `interrupt` froze the turn before it aborted the
            // request: what the reader already saw joins the transcript marked
            // as interrupted. A user message's own abort set no freeze, and its
            // notice carries what had streamed instead.
            this.claimInterrupted(agent)
            return
          }
          this.record(agent, {
            kind: 'system', name: '圆桌',
            text: `「${identity.name}」发言失败，跳过：${String(error)}`, at: new Date().toISOString(),
          })
          outcome = 'skipped'
        } finally {
          this.abort = null
        }
        this.state = onSpeakerDone(this.state, outcome)
        // A background run that finished while this speaker talked gets a
        // supplement floor right after the speaker that submitted it.
        await this.consumeRuns(agent)
      }
    } finally {
      this.busy = false
      // A freeze no unwinding speaker claimed has no turn left to join: an
      // interruption that arrives between turns stops the round, not a speech.
      this.interrupted = null
      // A user message that interrupted the round joins now and re-opens it.
      if (this.pending !== null) {
        const pending = this.pending
        this.pending = null
        this.joinUser(pending.text, pending.agent, pending.interrupted)
        this.drive = this.runRound(pending.agent)
        /* v8 ignore next -- runRound contains every speaker failure in-loop, so this drive promise never rejects */
        void this.drive.catch(() => {})
      }
    }
  }
}
