/**
 * Built-in roundtable identities (R13/U6): four speaker presets whose prompts
 * are wired into each speaker's own request. A roundtable round is the
 * controller asking each identity, in order, to speak into one shared
 * transcript — never one model role-playing all sides.
 *
 * The prompts are speaking contracts, not personas for a whole session: each
 * one governs a single turn against the full roundtable context.
 * @module @deepseek-ai/dsh-roundtable/identities
 */

/** One roundtable speaker identity. */
export interface RoundtableIdentity {
  /** Stable id, kebab-case; custom identities use the name the user gave. */
  readonly id: string
  /** Display name (中文 shown as-is). */
  readonly name: string
  /** The speaking contract injected as this speaker's system message. */
  readonly prompt: string
  /**
   * Whether this speaker harvests the round instead of arguing in it. A roster
   * has at most one, and it always speaks last: the order members are listed
   * in is the order they argue, never the order they summarize.
   */
  readonly moderator?: boolean
}

/** The bull researcher: builds the affirmative case with evidence. */
export const BULL_RESEARCHER: RoundtableIdentity = {
  id: 'bull-researcher',
  name: '多头研究员',
  prompt: [
    '你是圆桌的多头研究员。你的职责是给出最有力的看多论证：',
    '1. 先消化桌上已有的发言——你的论证要推进讨论，不重复已说过的观点；',
    '2. 给出你的核心看多论据（最多三条），每条附数据或事实支撑，注明来源与时间；',
    '3. 明确说出你的论据依赖的关键假设，以及什么证据出现你会改变看法；',
    '4. 看到值得回应的桌上观点（尤其是空头的攻击）时，可以直接回应，但不要变成辩论缠斗。',
    '克制与诚实优先：没有看多论据就说"本轮我没有增量看多观点"，比硬编理由有价值。发言控制在 300 字内。',
  ].join('\n'),
}

/** The bear auditor: attacks the strongest version of the bull case. */
export const BEAR_AUDITOR: RoundtableIdentity = {
  id: 'bear-auditor',
  name: '空头审查员',
  prompt: [
    '你是圆桌的空头审查员。你的职责是攻击，不是折中：',
    '1. 找出多头论证（或桌上任何乐观结论）依赖的隐含假设，逐个质疑；',
    '2. 对桌上出现的关键数字，核对其可复现性，指出无法复现或口径可疑的；',
    '3. 提出至少一个与桌上主流结论相反、但同样符合已知数据的解释；',
    '4. 标注风险类型：基本面恶化 / 估值 / 流动性 / 政策 / 数据不可靠。',
    '攻击要有证据；没有可攻击点时明说"本轮找不到实质攻击点"。发言控制在 300 字内。',
  ].join('\n'),
}

/** The macro strategist: places the question in the bigger picture. */
export const MACRO_STRATEGIST: RoundtableIdentity = {
  id: 'macro-strategist',
  name: '宏观策略师',
  prompt: [
    '你是圆桌的宏观策略师。你的职责是把讨论放进更大的图景：',
    '1. 指出当前讨论所处的宏观环境（利率/流动性/周期/政策）与它的方向；',
    '2. 说明宏观变量如何传导到桌上的具体标的或结论，传导链要写清楚；',
    '3. 给出一个"宏观前提变化"的敏感度判断：哪个变量变，桌上的结论就翻转；',
    '4. 不要重复桌上已说的宏观观点，只做增量。',
    '宏观判断注明数据期间与来源。发言控制在 300 字内。',
  ].join('\n'),
}

/** The neutral moderator: harvests the round, names disagreements honestly. */
export const MODERATOR: RoundtableIdentity = {
  id: 'moderator',
  name: '中立主持人',
  moderator: true,
  prompt: [
    '你是圆桌的中立主持人。你不持观点，你的职责是收割这一轮：',
    '1. 用三句话以内概括本轮讨论的实质进展；',
    '2. 列出桌上真正的分歧点（谁与谁在哪一点上对立，各自最强的一句话理由）；',
    '3. 指出尚未解决的关键问题（最多三个），作为下一轮或用户引导的抓手；',
    '4. 不和稀泥：分歧没有收敛就直说没有收敛，不制造虚假共识。',
    '用户始终是圆桌里最强的角色——结尾可以给用户一个具体可回答的引导问题。发言控制在 200 字内。',
  ].join('\n'),
}

/** The industry expert: the supply chain, competition, and channel view. */
export const INDUSTRY_EXPERT: RoundtableIdentity = {
  id: 'industry-expert',
  name: '产业专家',
  prompt: [
    '你是圆桌的产业专家。你的职责是把讨论落到产业事实上：',
    '1. 给出该产业当前的供需、产能、价格与库存事实，注明数据期间；',
    '2. 指出产业链上的关键变量（上游成本、下游需求、竞争格局、政策）如何影响桌上的标的；',
    '3. 用产业常识挑战桌上的金融推论：哪些结论在产业层面根本走不通；',
    '4. 只做增量，不重复桌上已说的产业信息。',
    '没有产业层面的事实支撑时明说"这一层我无法证实"。发言控制在 300 字内。',
  ].join('\n'),
}

/** One roster member: who speaks, and (when customized) under what contract. */
export interface RoundtableMember {
  /** The identity id; a built-in id keeps that identity's own contract. */
  readonly id: string
  /** Display name; for a built-in id this is the built-in's name by default. */
  readonly name: string
  /** The speaking contract this member speaks under. */
  readonly prompt: string
  /** Whether this member harvests the round; at most one per roster. */
  readonly moderator?: boolean
}

/**
 * One roster as the settings document stores it and the Remote carries it.
 *
 * This is the WRITE vocabulary, kept beside the read vocabulary
 * ({@link RoundtableRoster}) on the public type subpath so a client can send
 * one without importing the host-side resolution rules.
 */
export interface StoredRoster {
  /** Roster id; matching a shipped id replaces that shipped roster. */
  id: string
  /** Display name shown in the open-table setup. */
  name: string
  /** Members in speaking order; an empty name/prompt takes the built-in identity's. */
  members: { id: string; name: string; prompt: string; moderator: boolean }[]
}

/**
 * One named roster: the people who sit at the table, in speaking order.
 *
 * The order is the roster's, not a global rule: members argue in the order
 * listed, and the moderator — wherever it is listed — takes the floor last.
 * A user-authored roster is stored whole under its id, so changing one member
 * of a built-in roster stores that roster's copy rather than patching it.
 */
export interface RoundtableRoster {
  /** Stable id, kebab-case. */
  readonly id: string
  /** Display name shown in the open-table setup. */
  readonly name: string
  /** Members in speaking order. */
  readonly members: readonly RoundtableMember[]
  /** Whether this roster ships with the package rather than being authored. */
  readonly builtin: boolean
}

/** One roster row as the Remote answers it (the page's roster list). */
export interface RosterIdentity {
  readonly id: string
  readonly name: string
  readonly prompt: string
  /** true for the shipped identities, false for user-authored members. */
  readonly builtin: boolean
  /** Whether this speaker harvests the round rather than arguing in it. */
  readonly moderator: boolean
}

/** The roster the classic table runs: three views, then the moderator. */
export const CLASSIC_ROSTER: RoundtableRoster = {
  id: 'classic',
  name: '经典四人',
  builtin: true,
  members: [BULL_RESEARCHER, BEAR_AUDITOR, MACRO_STRATEGIST, MODERATOR]
    .map(identity => ({ ...identity })),
}

/** The roster a finance desk runs: the classic views plus the industry seat. */
export const FINANCE_ROSTER: RoundtableRoster = {
  id: 'finance',
  name: '金融小组',
  builtin: true,
  members: [BULL_RESEARCHER, BEAR_AUDITOR, MACRO_STRATEGIST, INDUSTRY_EXPERT, MODERATOR]
    .map(identity => ({ ...identity })),
}

/** The shipped rosters, in the order the setup screen lists them. */
export const BUILTIN_ROSTERS: readonly RoundtableRoster[] = [CLASSIC_ROSTER, FINANCE_ROSTER]

/** The roster a table runs when the user names none. */
export const DEFAULT_ROSTER_ID = CLASSIC_ROSTER.id

/** The shipped identities, for resolving a member that names one by id. */
export const BUILTIN_IDENTITIES: readonly RoundtableIdentity[] = [
  BULL_RESEARCHER,
  BEAR_AUDITOR,
  MACRO_STRATEGIST,
  INDUSTRY_EXPERT,
  MODERATOR,
]

/**
 * Resolve one roster's members into complete identities: a member naming a
 * shipped id takes that identity's contract unless the member states one.
 * @param members - the roster's members, in speaking order.
 * @returns the resolved identities with their ids preserved.
 */
export function resolveMembers(members: readonly RoundtableMember[]): RoundtableIdentity[] {
  return members.map((member) => {
    const builtin = BUILTIN_IDENTITIES.find(identity => identity.id === member.id)
    return {
      id: member.id,
      name: member.name.trim() === '' ? builtin?.name ?? member.id : member.name,
      prompt: member.prompt.trim() === '' ? builtin?.prompt ?? '' : member.prompt,
      ...member.moderator === true ? { moderator: true } : {},
    }
  })
}

/** One shape a tool activity line reports: the call is in flight, settled, or stopped mid-flight. */
export type RoundtableToolStatus = 'running' | 'ok' | 'error' | 'interrupted'

/**
 * One tool call a speaker's research window made, as the page renders it and
 * the archive freezes it.
 *
 * The RAW result text never rides this entry: the line names what was
 * consulted (the same subject a {@link RoundtableCitation} names), and the full
 * call and its capped result stay in the speaker's own request log.
 */
export interface RoundtableToolActivity {
  /**
   * The provider call id, or a window-synthesized one for a call the provider
   * refused to channel. It is what a running line is updated by.
   */
  readonly key: string
  /** The tool the speaker asked for, in the window's catalog or not. */
  readonly name: string
  /** The arguments exactly as the model emitted them. */
  readonly arguments: string
  /** One line naming the call's subject (a query, a URL, or a file path); empty while running. */
  readonly summary: string
  /** Where the call stands. */
  readonly status: RoundtableToolStatus
}

/**
 * One item of a turn's activity timeline, in the order it happened: a stretch
 * of the speaker's thinking, or a tool call that landed inside it.
 *
 * The timeline is what lets a reader see the turn the way it was produced —
 * think, look something up, think again — instead of one block of thinking
 * followed by one block of calls. The aggregate `reasoning` and `tools`
 * fields stay the authoritative flattened record; a timeline is derived
 * alongside them so readers that only want one channel keep working.
 */
export type RoundtableFlowItem =
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'tool'; readonly tool: RoundtableToolActivity }

/** One transcript entry: a user message, a speaker turn, or a system note. */
export interface RoundtableEntry {
  /** user | speaker | system. */
  readonly kind: 'user' | 'speaker' | 'system'
  /** The speaker id for `speaker` turns. */
  readonly speaker?: string
  /** Display name shown beside the entry. */
  readonly name: string
  /** The entry text; speaker turns carry the full spoken content. */
  readonly text: string
  /**
   * The speaker's thinking for this turn, when the route emitted one. Shown
   * beside the speech and archived with it; it never joins the shared context
   * later speakers see.
   */
  readonly reasoning?: string
  /** ISO-8601 instant. */
  readonly at: string
  /**
   * What this turn consulted, when it researched. The RAW tool results never
   * reach the transcript: the table shows what was looked up, and the speaker's
   * own text carries what it concluded from it.
   */
  readonly citations?: readonly RoundtableCitation[]
  /**
   * Whether a research limit ended this turn's window, so the speech answers
   * from what was already read rather than from a finished search. Absent on a
   * shallow turn and on a window the speaker ended itself.
   */
  readonly truncated?: boolean
  /**
   * Whether the user stopped the speaker mid-turn, so this entry holds only
   * what had already streamed when it was interrupted. The turn still joins
   * the shared context (later speakers answer what was said, however little),
   * and the page marks it as visually degraded.
   */
  readonly interrupted?: boolean
  /**
   * The tool calls this turn's research window made, in call order. Absent on
   * a turn that read nothing and on transcripts written before the field
   * existed.
   */
  readonly tools?: readonly RoundtableToolActivity[]
  /**
   * The turn's thinking and calls interleaved in the order they happened.
   * Absent on transcripts written before the field existed, which readers
   * render from `reasoning` and `tools` instead.
   */
  readonly flow?: readonly RoundtableFlowItem[]
}

/** One source a deep-dive speaker consulted during its research window. */
export interface RoundtableCitation {
  /** The tool that produced it (`web_search`, `web_fetch`, `read`, …). */
  readonly tool: string
  /** One line naming what was consulted: a query, a URL, or a file path. */
  readonly label: string
}

/** The research effort one table runs at. */
export type RoundtableDepth = 'shallow' | 'deep'

/** The configuration one table was opened with. */
/** The conversation an archived table continued; absent when it opened fresh. */
export interface RoundtableArchiveSeed {
  readonly sessionId: string
  readonly title: string
}

/** The table configuration an archive froze, plus the roster's display name at open time. */
export interface RoundtableArchiveTable {
  readonly depth: RoundtableDepth
  readonly rosterId: string
  readonly rosterName: string
  readonly provider: string
  readonly model: string
  readonly seed?: RoundtableArchiveSeed
}

/** One archived table: everything a reader needs to reconstruct the room. */
export interface RoundtableArchiveRecord {
  readonly version: 1
  /** ISO instant the table was opened, when the engine recorded it. */
  readonly openedAt: string | null
  /** ISO instant the table was closed and archived. */
  readonly closedAt: string
  readonly table: RoundtableArchiveTable
  readonly transcript: readonly RoundtableEntry[]
}

/** One row of `roundtable_list`: the archive's header without the transcript. */
export interface RoundtableArchiveSummary {
  readonly id: string
  readonly openedAt: string | null
  readonly closedAt: string
  readonly depth: RoundtableDepth
  readonly rosterId: string
  readonly rosterName: string
  readonly model: string
  /** How many speaker turns the table recorded. */
  readonly turns: number
  /** First user message, truncated; empty when the table has none. */
  readonly topic: string
  /** The continued conversation's title; absent when the table opened fresh. */
  readonly seedTitle?: string
}

/** The conversation a deep table continues: exported to a file, never inlined into context. */
export interface RoundtableSeed {
  /** The session whose conversation the table continues. */
  readonly sessionId: string
  /** That session's display title. */
  readonly title: string
  /** Absolute path of the exported conversation file deep speakers read. */
  readonly file: string
}

export interface RoundtableTableConfig {
  /** shallow = one request per speaker; deep = research window, then speak. */
  readonly depth: RoundtableDepth
  /** The roster the table seats. */
  readonly rosterId: string
  /** Provider route every speaker request uses. */
  readonly provider: string
  /** Model id every speaker request uses. */
  readonly model: string
  /** The conversation this table continues; deep tables only, absent when opened fresh. */
  readonly seed?: RoundtableSeed
}

/**
 * The turn a speaker is producing right now: the deltas folded so far, as the
 * page polls them. It is a live view of one in-flight turn, never a transcript
 * entry and never a session event — the finished turn replaces it, and only an
 * interrupted turn's frozen remainder is recorded (see
 * {@link RoundtableEntry.interrupted}). A speaker that makes several requests
 * (a research window) accumulates them here: `reasoning` keeps every request's
 * thinking in order, blank-line separated, and `text` likewise carries what the
 * earlier requests already wrote ahead of the current one.
 */
export interface RoundtablePartial {
  /** The identity holding the floor. */
  readonly speaker: string
  /** That identity's display name. */
  readonly name: string
  /** The speech text folded so far; a new request's text follows the previous one. */
  readonly text: string
  /** The thinking folded so far, every request's kept; empty when the route emitted none. */
  readonly reasoning: string
  /**
   * The tool calls the turn has made so far, in call order: a call appears as
   * `running` the moment the model starts streaming it and is updated in place
   * when it settles. Empty on a shallow turn that has not searched yet.
   */
  readonly tools: readonly RoundtableToolActivity[]
  /**
   * The thinking and calls interleaved in the order they happened, so a reader
   * renders the turn the way it is produced rather than as two blocks. Absent
   * only from a reader talking to an engine older than this field.
   */
  readonly flow?: readonly RoundtableFlowItem[]
}

/** The live room snapshot the roundtable page renders. */
export interface RoundtableRoomView {
  /** Controller state: phase, queue, turns, rounds (see state-machine). */
  readonly phase: 'wait-user-open' | 'round' | 'wait-user-guide'
  /** Speaking order still ahead in the current round. */
  readonly queue: readonly string[]
  /** Turns completed in the current round. */
  readonly turns: readonly { readonly speaker: string; readonly outcome: 'spoke' | 'skipped' }[]
  /** Completed rounds. */
  readonly rounds: readonly (readonly { readonly speaker: string; readonly outcome: 'spoke' | 'skipped' }[])[]
  /** The full shared context, oldest first. */
  readonly transcript: readonly RoundtableEntry[]
  /**
   * The turn being produced right now, when a speaker is mid-request; the page
   * renders it as a last entry that grows. Null while nothing streams.
   */
  readonly partial: RoundtablePartial | null
  /** True while the engine is driving speaker requests. */
  readonly busy: boolean
  /** The configuration the table is running; null before it is opened. */
  readonly table: RoundtableTableConfig | null
}

/** {@link RoundtableGateway.userMessage}'s answer. */
export interface RoundtableAck {
  /** Whether the message was accepted into the shared context. */
  readonly ok: boolean
  /** Why a message was refused (empty input, unknown @点名 target is not an error). */
  readonly error?: string
  /** The room as of the answer. */
  readonly room: RoundtableRoomView
}
