/**
 * The roundtable controller's decision core: a pure, serializable state
 * machine that owns speaking order, skips, interruptions, and @-calls.
 * The orchestration engine (session-side) performs each speaker's request and
 * feeds outcomes back here — the controller decides, the model never
 * free-runs the turn order. The state also carries the ledger of background
 * runs the table submitted ({@link PendingRun}); the engine consumes it at a
 * turn boundary and, for a finished run, queues the submitting speaker first
 * with {@link insertSupplement}.
 *
 * Lifecycle:
 *
 *   WAIT_USER_OPEN       the table opens silent; the user always speaks first
 *     → ROUND            speakers take the floor in order, one request each;
 *                        a speaker may think then SKIP (rendered 思考后跳过)
 *     → WAIT_USER_GUIDE  after the last speaker the table stops; no auto next
 *
 *   Interrupt: a user message at ANY time cancels the current speaker, joins
 *   the shared context, and the round resumes from the interrupted speaker.
 *   @点名 in a user message narrows the next round to the named speaker only.
 *   An explicit {@link interruptRound} stops the round outright — the table
 *   waits for the user, and the next message opens a fresh round.
 *
 * @module @deepseek-ai/dsh-roundtable/state-machine
 */

import type { RoundtableIdentity } from './identities.ts'

/** Where the table stands; the controller's whole phase. */
export type RoundtablePhase =
  | 'wait-user-open'
  | 'round'
  | 'wait-user-guide'

/** One speaker's completed floor turn. */
export interface RoundtableTurn {
  /** The identity that held the floor. */
  readonly speaker: string
  /** spoke | skipped. */
  readonly outcome: 'spoke' | 'skipped'
}

/**
 * One background run this table submitted and has not consumed yet. The run
 * executes detached and writes its record to `recordPath`; the engine reads
 * that file at a turn boundary and either hands the result back as a
 * supplement turn or, once it is past the staleness limit, notes it as lost.
 * The ledger rides the controller state so it survives a restart with the
 * rest of the open room.
 */
export interface PendingRun {
  /** The run's id, as the bridge printed it. */
  readonly runId: string
  /** Absolute path of the run record the detached process writes. */
  readonly recordPath: string
  /** Asset the run was submitted for. */
  readonly asset: string
  /** Verb the run executes. */
  readonly verb: string
  /** The speaker that submitted it and is owed the supplement turn. */
  readonly speaker: string
  /** ISO instant the run was submitted. */
  readonly submittedAt: string
}

/** The serializable controller state; one row per roundtable session. */
export interface RoundtableState {
  readonly phase: RoundtablePhase
  /** Speaking order of the current round; index 0 holds the floor. */
  readonly queue: readonly string[]
  /** The speaker interrupted by the latest user message, when one was. */
  readonly interrupted: string | null
  /** Turns already completed in the current round, oldest first. */
  readonly turns: readonly RoundtableTurn[]
  /** Completed rounds, oldest first; a round is a list of turns. */
  readonly rounds: readonly (readonly RoundtableTurn[])[]
  /**
   * Background runs this table submitted and has not consumed yet, oldest
   * first; absent when the table never submitted one.
   */
  readonly pendingRuns?: readonly PendingRun[]
}

/** Carry the background-run ledger through a transition that replaces the other fields. */
function carryLedger(state: RoundtableState): { pendingRuns?: readonly PendingRun[] } {
  return state.pendingRuns === undefined ? {} : { pendingRuns: state.pendingRuns }
}

/**
 * Find the identity a user message @-calls, by display name or id.
 * @param message - the user message to scan.
 * @param identities - the roster whose names and ids are matched.
 * @returns the called identity's id, or null when the message names nobody.
 * @example `parseAtCall('都怎么看？@空头审查员 说说')` → `'空头审查员'`
 */
export function parseAtCall(message: string, identities: readonly RoundtableIdentity[]): string | null {
  for (const match of message.matchAll(/@([^\s@，。,]+)/gu)) {
    /* v8 ignore next -- the @-call capture group is mandatory, so every match carries group 1 */
    const named = match[1] ?? ''
    const found = identities.find(identity =>
      identity.name === named || identity.id === named || identity.id === named.toLowerCase())
    if (found !== undefined) return found.id
  }
  return null
}

/**
 * The opening state: the table exists, nobody has spoken, the user starts.
 * @returns the initial state waiting for the user's opening message.
 */
export function openTable(): RoundtableState {
  return { phase: 'wait-user-open', queue: [], interrupted: null, turns: [], rounds: [] }
}

/** Everyone in roster order, with a marked moderator moved to the end. */
function speakingOrder(identities: readonly RoundtableIdentity[]): string[] {
  const arguing = identities.filter(identity => identity.moderator !== true)
  const moderators = identities.filter(identity => identity.moderator === true)
  return [...arguing, ...moderators].map(identity => identity.id)
}

/** Whether one more speaker remains after the current queue head. */
function queueHasMore(state: RoundtableState): boolean {
  return state.queue.length > 1
}

/**
 * A user message arrived. The table joins the message to its shared context
 * (the engine's job); the controller answers with the next state, whose floor
 * is the speaker the engine runs next.
 * @param state - the state before the message.
 * @param message - the user's message text, @-calls parsed against `identities`.
 * @param identities - the full roster (built-ins plus user additions).
 * @returns the next state; an interrupted round resumes from the speaker that lost the floor.
 */
export function onUserMessage(
  state: RoundtableState,
  message: string,
  identities: readonly RoundtableIdentity[],
): RoundtableState {
  const named = parseAtCall(message, identities)
  // An @call narrows the next round to that one speaker, moderator rules aside.
  const nextQueue = named === null ? speakingOrder(identities) : [named]
  const base: RoundtableState = {
    phase: 'round',
    queue: nextQueue,
    interrupted: null,
    turns: [],
    rounds: state.phase === 'wait-user-open' ? [] : state.rounds,
    ...carryLedger(state),
  }
  if (state.phase !== 'round') return base
  // An interruption: the speaker holding the floor lost it mid-thought and
  // resumes first after the user's message lands in the shared context.
  const interruptedSpeaker = state.queue[0]
  if (interruptedSpeaker === undefined) return base
  return {
    ...base,
    queue: named === null
      ? [interruptedSpeaker, ...state.queue.slice(1)]
      : nextQueue,
    turns: state.turns,
    interrupted: interruptedSpeaker,
  }
}

/**
 * The floor speaker finished: spoke or thought-then-skipped. Advances within
 * the round, or ends the round back to the user; outside a round the state is
 * already the answer.
 * @param state - the state with the speaker still holding the floor.
 * @param outcome - what the speaker did with the floor.
 * @returns the next state, whose floor is the next speaker or none.
 */
export function onSpeakerDone(
  state: RoundtableState,
  outcome: 'spoke' | 'skipped',
): RoundtableState {
  if (state.phase !== 'round') return state
  const speaker = state.queue[0] ?? '(nobody)'
  const turns: RoundtableTurn[] = [...state.turns, { speaker, outcome }]
  if (queueHasMore(state)) {
    return {
      phase: 'round',
      queue: state.queue.slice(1),
      interrupted: null,
      turns,
      rounds: state.rounds,
      ...carryLedger(state),
    }
  }
  return {
    phase: 'wait-user-guide',
    queue: [],
    interrupted: null,
    turns: [],
    rounds: [...state.rounds, turns],
    ...carryLedger(state),
  }
}

/**
 * Queue a supplement turn for a speaker at the head of the floor, keeping the
 * table in a round. The engine calls this right after {@link onSpeakerDone} has
 * popped the speaker that just finished — including when that pop ended the
 * round — so the floor order reads 当前发言者 → 发起者补充 → 其余, and a round
 * the boundary had ended resumes with the supplement. Turns and completed
 * rounds are untouched: a supplement is a new floor turn, not a replay.
 * @param state - the state after the finished speaker stepped down.
 * @param speakerId - the speaker taking the supplement floor.
 * @returns the state with the supplement queued first, phase `round`.
 */
export function insertSupplement(state: RoundtableState, speakerId: string): RoundtableState {
  return { ...state, phase: 'round', queue: [speakerId, ...state.queue] }
}

/**
 * The user stopped the round: no speaker holds the floor and the table waits
 * for the user's next message, which opens a fresh round from the roster. The
 * turns the interrupted round had already completed are dropped — that round
 * never finished, and its speakers are already in the shared transcript.
 * @param state - the state with a speaker mid-turn, or any other phase.
 * @returns the waiting-for-the-user state; a table that was not in a round is
 *   already in one and comes back unchanged.
 */
export function interruptRound(state: RoundtableState): RoundtableState {
  if (state.phase !== 'round') return state
  return {
    phase: 'wait-user-guide',
    queue: [],
    interrupted: null,
    turns: [],
    rounds: state.rounds,
    ...carryLedger(state),
  }
}

/**
 * Re-prompt the floor speaker (a retry after a failed request, or the resumed
 * speaker after an interruption): same state, the engine just runs the floor.
 * @param state - the current machine state.
 * @returns the speaker id holding the floor, or null outside a round.
 */
export function currentFloor(state: RoundtableState): string | null {
  return state.phase === 'round' ? state.queue[0] ?? null : null
}
