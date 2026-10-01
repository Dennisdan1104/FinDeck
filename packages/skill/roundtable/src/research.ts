/**
 * The roundtable's research window: before a speaker talks, one bounded tool
 * loop lets it look things up through READ-ONLY tools.
 *
 * Three properties make this safe to run unattended, which is what a
 * roundtable needs — nobody is watching to approve a call:
 *
 * 1. The advertised catalog is the tools this deployment's registry declares
 *    read-only (`ToolDefinition.readOnly`), narrowed to {@link SEARCH_TOOLS}
 *    for a shallow speaker; a call outside it is refused with a reason instead
 *    of executed. Read-only means it cannot change the workspace, the session,
 *    or the process.
 * 2. Every limit applies to the COMPLETE window rather than to one step: a
 *    step cap, a wall-clock deadline, and a per-result character cap, so one
 *    huge page cannot fill the context and a loop cannot run forever.
 * 3. When a limit is reached the model is told to answer NOW with what it has;
 *    the window always ends in a speech, never in a silent truncation.
 * 4. A tool call the model writes as TEXT (DSML-ish markup) is never executed
 *    and never becomes the speech: mid-window it draws a correction notice,
 *    and any markup left in the final text is stripped before it returns.
 *
 * An agent-driven room executes through the tool registry's pipeline; an
 * agentless room calls the registered definitions directly, because that
 * pipeline keys its checkpoint, telemetry, and session observers on a real
 * Agent and the room has none (see {@link executeCall}).
 *
 * @module @deepseek-ai/dsh-roundtable/research
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { BlockAssembler, createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ContextFormed, Message, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'roundtable': { kind: 'roundtable' } & ContextFormed
  }
}
import type { ToolDefinition, ToolExecutionResult, ToolExecutionToken, ToolRunContext, ToolRuntime, ToolExecutionSuccess } from '@deepseek-ai/dsh-tools'
import type { RoundtableCitation } from './identities.ts'

/**
 * The one tool a shallow speaker may call: a quick table thinks, searches the
 * web once or twice, and speaks. It reads no workspace file and no page body,
 * which is what makes it the quick depth.
 */
export const SEARCH_TOOLS: readonly string[] = ['web_search']

/**
 * Which read-only tools one window advertises: `search` narrows the catalog to
 * {@link SEARCH_TOOLS} (a shallow speaker), `read-only` is every tool the
 * window's scope declares read-only (a deep speaker).
 */
export type ResearchBreadth = 'search' | 'read-only'

/** How one research window behaves; every value is a deployment choice. */
export interface ResearchLimits {
  /** Model requests allowed in one research window. */
  readonly maxSteps: number
  /** Wall-clock budget for one research window, milliseconds. */
  readonly maxMillis: number
  /** Characters of one tool result that reach the model. */
  readonly maxResultChars: number
}

/** One call the window made, as the model saw it. */
export interface ResearchStep {
  /** The provider call id the result answers. */
  readonly callId: string
  /** The tool the speaker asked for, in the window's catalog or not. */
  readonly name: string
  /** The arguments exactly as the model emitted them. */
  readonly arguments: string
  /** The text the model reads back for this call, capped; a refusal carries its reason. */
  readonly result: string
  /** Whether the call failed or was refused. */
  readonly isError: boolean
}

/** One research window's outcome. */
export interface ResearchOutcome {
  /** The speaker's final text. */
  readonly text: string
  /**
   * The speaker's thinking for the final turn, the one that produced the
   * speech; empty when the route emitted none.
   */
  readonly reasoning: string
  /** What it consulted, in call order. */
  readonly citations: readonly RoundtableCitation[]
  /**
   * Whether a limit ended the window: the step cap or the clock reached the
   * forced answer. The speech stands either way.
   */
  readonly truncated: boolean
  /** Every call the window made, in call order, refusals included. */
  readonly steps: readonly ResearchStep[]
}

/**
 * One tool call's state as the room watches it: the call the model started,
 * or the settled state of the same call. The window emits these as they
 * happen, so a room can show a speaker looking things up while it talks.
 */
export interface ResearchToolActivity {
  /** The provider call id the result answers, or a window-synthesized id for a call that never ran. */
  readonly callId: string
  /** The tool the speaker asked for, in the window's catalog or not. */
  readonly name: string
  /** The arguments exactly as the model emitted them; empty when it emitted none. */
  readonly arguments: string
  /** running while the call is in flight, otherwise its settled state. */
  readonly status: 'running' | 'ok' | 'error'
  /**
   * One line naming the call's subject (a query, a URL, or a file path), read
   * from the parsed arguments; empty when no recognizable subject argument is
   * present. Absent while the call is still running.
   */
  readonly text?: string
}

/** One speaker's research window: who it runs for, what cancels it, what it opens with, and how much it may call. */
export interface ResearchWindow {
  /**
   * The agent whose behalf the window runs on, when the room is driven under
   * one: its session scopes the tools and owns their pipeline execution.
   */
  readonly agent?: Agent
  /**
   * The read-only tool scope of an agentless room: catalog resolution keys off
   * it, and its calls run the tool definitions directly (there is no agent for
   * the registry pipeline to key its checkpoint, telemetry, and session
   * observers on). Absent when this deployment offers the room no tools at all.
   */
  readonly scope?: ScopeKey
  /** The caller's cancellation: it ends the window and every call the window makes. */
  readonly signal: AbortSignal
  /** The table so far plus the instruction to speak, as the window's first user message. */
  readonly opening: Message
  /**
   * Which tools the window may call: `read-only` for a deep speaker (the
   * deployment's read-only tools plus {@link ResearchWindow.backgroundTools}),
   * `search` for a shallow one, which only gets {@link SEARCH_TOOLS}.
   */
  readonly breadth: ResearchBreadth
  /**
   * Extra tool names a deep speaker may call besides the read-only ones: the
   * background submission tools, which spend no session waiting for a result
   * ({@link ResearchWindow.breadth} only). They are not marked read-only — the
   * flag's contract forbids what they do to the process — so the engine names
   * them explicitly; a shallow speaker never receives them.
   */
  readonly backgroundTools?: readonly string[]
  /**
   * Called when one call's state changes: `running` as the window starts it,
   * then its settled state. The room uses it to show the speaker's tool
   * activity while the turn is still streaming.
   */
  readonly onToolActivity?: ((activity: ResearchToolActivity) => void) | undefined
}

/**
 * The catalog one window advertises, read from the live registry: the tools
 * this scope's composition declares read-only, plus the named background
 * submission tools, so a deployment that registers another read-only tool
 * offers it to a deep speaker without naming it here.
 * @param ctx - the context the tool registry resolves from.
 * @param breadth - whether the speaker may call every deep tool or search only.
 * @param scope - the viewing scope (the speaking agent, or the room's own tool scope).
 * @param backgroundTools - extra tool names a deep speaker may call (default none).
 * @returns the callable schemas, in registry order.
 */
export function researchCatalog(
  ctx: Context,
  breadth: ResearchBreadth,
  scope?: ScopeKey,
  backgroundTools: readonly string[] = [],
): ToolSchema[] {
  const tools = ctx.get('tools')
  if (tools === undefined) return []
  return tools.schemas(scope)
    .filter(schema => (tools.get(schema.name, scope)?.readOnly === true || backgroundTools.includes(schema.name))
      && (breadth === 'read-only' || SEARCH_TOOLS.includes(schema.name)))
    .map(schema => ({ name: schema.name, description: schema.description, parameters: schema.parameters }))
}

/** The text sentinel of a provider's text-form tool-call markup (U+FF5C pipes). */
const DSML_MARKUP = '<｜｜DSML｜｜'

/** Whether a folded reply carries its tool calls as text markup instead of tool-call blocks. */
function isTextFormToolCall(text: string): boolean {
  return text.includes(DSML_MARKUP)
}

/**
 * Strip text-form tool-call markup from a final speech. The provider emits
 * this when it answers without the call channel; executed or not, raw markup
 * is never a speech. Everything from the first sentinel through the last
 * closing tag goes; text with no sentinel returns unchanged.
 * @param text - the folded final text.
 * @returns the speech with markup blocks removed.
 */
function stripTextFormToolCalls(text: string): string {
  const first = text.indexOf(DSML_MARKUP)
  if (first === -1) return text
  const closer = '｜｜DSML｜｜>'
  const last = text.lastIndexOf(closer)
  const cut = last === -1 || last < first ? text.length : last + closer.length
  return text.slice(0, first).concat(text.slice(cut)).trim()
}

/** Flatten one tool result's content blocks into the text the model reads. */
function resultText(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * One line naming what a call consulted: the first recognizable subject
 * argument (`query`, `url`, `file_path`, `pattern`), as the transcript's
 * citation list and the room's tool activity line both read it.
 * @param args - the call's parsed arguments.
 * @returns the subject text, or an empty string when the call names none.
 */
export function citationLabel(args: unknown): string {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const first = ['query', 'url', 'file_path', 'pattern']
    .map(key => record[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  return first ?? ''
}

/**
 * One line naming what a call consulted, for the transcript's citation list.
 * @param name - the tool that ran.
 * @param args - its parsed arguments.
 * @returns the tool name plus the first recognizable subject argument, if any.
 */
export function citationOf(name: string, args: unknown): RoundtableCitation {
  return { tool: name, label: citationLabel(args) }
}

/**
 * Send one request and fold its stream into a final text plus any tool calls.
 * @param chunks - the provider's stream for this request.
 * @returns the folded text, thinking, and calls; a failed request throws.
 */
async function collectTurn(chunks: AsyncIterable<StreamChunk>): Promise<{
  text: string
  reasoning: string
  toolCalls: { id: string; name: string; arguments: string }[]
}> {
  const assembler = new BlockAssembler()
  for await (const chunk of chunks) assembler.push(chunk)
  const finish = assembler.finish
  // A provider failure arrives as a terminal finish reason rather than as a
  // throw; the window reports it so the engine records a skipped turn.
  if (finish.kind === 'error') throw new Error(finish.failure.message)
  const blocks = assembler.blocks()
  return {
    text: blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
    reasoning: blocks.flatMap(block => block.type === 'reasoning' ? [block.text] : []).join(''),
    toolCalls: blocks.flatMap(block => block.type === 'tool-call'
      ? [{ id: String(block.id), name: block.name, arguments: block.arguments }]
      : []),
  }
}

/** Parse one tool call's raw argument JSON, tolerating malformed provider output. */
function parseArguments(raw: string): unknown {
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    // A model that emits truncated JSON gets a refusal it can act on rather
    // than an exception that would end the window.
    return null
  }
}

/** One model request this window makes: the accumulated messages and the catalog. */
export type ResearchRequest = (messages: readonly Message[], tools: readonly ToolSchema[]) => AsyncIterable<StreamChunk>

/**
 * The discardable model-loop pieces of a run context: deferred context and
 * turn conclusion have no consumer in a research window, but the definition
 * contract requires them.
 */
function directRunContext(
  call: { id: string; name: string },
  args: unknown,
  signal: AbortSignal,
): ToolRunContext {
  const callId = ToolCallId(call.id)
  return {
    callId,
    rootCallId: callId,
    token: Symbol('dsh.roundtable.research') as ToolExecutionToken,
    name: call.name,
    arguments: args,
    signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

/**
 * Run one whitelisted call under the window's cancellation. An agent-driven
 * room executes through the registry's pipeline — guards, cooperative
 * timeouts, and the session logging the driving agent should record. An
 * agentless room has no agent for that pipeline to key on: its checkpoint,
 * telemetry, and session observers dereference the calling agent and would
 * crash on the room's bare scope key, so the window calls the definition's own
 * body instead, with the whitelist, caps, and deadline as its only police.
 * @param tools - the registry the definitions resolve from.
 * @param definition - the registered tool, visible in the window's scope.
 * @param call - the model's call identity and name.
 * @param args - the parsed arguments.
 * @param window - the running window: its agent, scope, and cancellation.
 * @param deadline - the window's wall-clock deadline, epoch millis.
 * @returns the call's outcome, failures captured rather than thrown.
 */
async function executeCall(
  tools: ToolRuntime,
  definition: ToolDefinition,
  call: { id: string; name: string },
  args: unknown,
  window: ResearchWindow,
  deadline: number,
): Promise<ToolExecutionResult> {
  // The caller's cancellation must reach the tool itself: an interrupt ends
  // the call instead of waiting for its own deadline.
  const signal = AbortSignal.any([window.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
  if (window.agent !== undefined) {
    return tools.execute({
      callId: ToolCallId(call.id),
      name: call.name,
      arguments: args,
      agent: window.agent,
      signal,
    })
  }
  try {
    const value = await definition.execute(args, directRunContext(call, args, signal)) as ToolExecutionSuccess['value']
    return {
      isError: false,
      value,
      content: definition.output.render(args, value),
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { isError: true, error: { message }, content: [{ type: 'text', text: `Error: ${message}` }] }
  }
}

/**
 * Run one speaker's research window: alternate requests and tool calls until
 * the speaker answers, or until a limit forces it to.
 * @param ctx - the host context the tool registry resolves from.
 * @param window - the speaking agent, the caller's cancellation, the breadth, and the opening message.
 * @param limits - the window's step, time, and size caps.
 * @param request - the request runner, so the caller owns the provider route.
 * @returns the speaker's text, what it consulted, and what it read.
 */
export async function runResearchWindow(
  ctx: Context,
  window: ResearchWindow,
  limits: ResearchLimits,
  request: ResearchRequest,
): Promise<ResearchOutcome> {
  const tools = ctx.get('tools')
  const viewScope = window.agent ?? window.scope
  const catalog = researchCatalog(ctx, window.breadth, viewScope, window.backgroundTools)
  const available = catalog.map(schema => schema.name)
  const availability = available.length === 0
    ? '本部署未注册任何可用工具'
    : available.join('、')
  const messages: Message[] = [window.opening]
  const citations: RoundtableCitation[] = []
  const steps: ResearchStep[] = []
  const deadline = Date.now() + limits.maxMillis
  /** Publish one call's state, when the caller watches this window. */
  const report = (activity: ResearchToolActivity): void => { window.onToolActivity?.(activity) }
  // `maxSteps` counts requests in the window, and the LAST one is the forced
  // answer, so a window makes at most maxSteps - 1 requests that may call a tool.
  const lastStep = Math.max(1, limits.maxSteps) - 1
  // The window always returns from the forced-answer request, so the loop needs
  // no exit of its own: `last` is true on the final iteration whatever the clock did.
  for (let step = 0; ; step += 1) {
    // Cancellation is checked between requests as well as inside them: a tool
    // call that swallowed its own abort (the agentless path captures failures)
    // must not let the window open one more request.
    if (window.signal.aborted) throw new Error('roundtable: the research window was interrupted')
    const last = step >= lastStep || Date.now() >= deadline
    if (last) {
      messages.push(createUserMessage({
        content: [{
          type: 'text',
          text: '研究时间到此为止。现在直接用你已掌握的信息发言，不要再调用任何工具；没有查到的部分就明说你没能证实。',
        }],
        source: { kind: 'roundtable', form: 'notice', summary: '研究时间到' },
      }))
    }
    // The final request is made without the catalog AND its calls are not run:
    // a limit ends in the speech, never in another call.
    const turn = await collectTurn(request(messages, last ? [] : catalog))
    const text = turn.text.trim()
    // A text-form tool call is a request the provider refused to channel: it
    // executed nothing and is not a speech. With budget left, tell the speaker
    // how to call and let it try again; at the limit, strip the markup so the
    // forced answer never quotes raw invocation text.
    if (turn.toolCalls.length === 0 && isTextFormToolCall(text) && !last && step + 1 <= lastStep) {
      steps.push({ callId: `text-form-${String(step)}`, name: '(text-form tool call)', arguments: '', result: '以文本形式发出的工具调用未被执行；已要求改走调用通道。', isError: true })
      report({
        callId: `text-form-${String(step)}`,
        name: '(text-form tool call)',
        arguments: '',
        status: 'error',
        text: '以文本形式发出的工具调用未被执行',
      })
      messages.push(createMessage({
        role: 'assistant',
        content: [
          ...turn.reasoning === '' ? [] : [{ type: 'reasoning' as const, text: turn.reasoning }],
          { type: 'text' as const, text },
        ],
        source: { kind: 'model', provider: 'roundtable', model: 'research' },
      }))
      messages.push(createUserMessage({
        content: [{
          type: 'text',
          text: '你把工具调用写成了文本，它不会被执行。请通过工具调用通道发起调用（模型输出里的 tool calls），或直接给出发言；不要在发言文本里书写调用标记。',
        }],
        source: { kind: 'roundtable', form: 'notice', summary: '调用方式纠正' },
      }))
      continue
    }
    if (last || turn.toolCalls.length === 0) {
      return {
        text: stripTextFormToolCalls(text),
        reasoning: turn.reasoning.trim(),
        citations,
        truncated: last,
        steps,
      }
    }
    messages.push(createMessage({
      role: 'assistant',
      content: [
        // The turn's thinking stays in its replayed message: thinking-mode
        // routes require the reasoning content to ride along on tool-call
        // turns, and the next request answers better with it.
        ...turn.reasoning === '' ? [] : [{ type: 'reasoning' as const, text: turn.reasoning }],
        // Text the model emitted beside its calls is part of what the next
        // request answers, so it stays in the window's own history.
        ...turn.text === '' ? [] : [{ type: 'text' as const, text: turn.text }],
        ...turn.toolCalls.map(call => ({
          type: 'tool-call' as const,
          id: ToolCallId(call.id),
          name: call.name,
          arguments: call.arguments,
        })),
      ],
      source: { kind: 'model', provider: 'roundtable', model: 'research' },
    }))
    for (const call of turn.toolCalls) {
      // Every call the model started is announced as running, whether or not
      // the window is still allowed to run it: a call at the forced answer is
      // refused with its reason, and the room shows that rather than hiding it.
      report({ callId: call.id, name: call.name, arguments: call.arguments, status: 'running' })
      const args = parseArguments(call.arguments)
      let result: ToolExecutionResult | undefined
      if (tools !== undefined && args !== null && available.includes(call.name)) {
        const definition = tools.get(call.name, viewScope)
        if (definition !== undefined) {
          result = await executeCall(tools, definition, call, args, window, deadline)
        }
      }
      if (result === undefined) {
        const reason = args === null
          ? `${call.name} 的调用参数不是合法 JSON，已拒绝。`
          : `${call.name} 不在本桌可用的工具内，已拒绝。可用：${availability}。`
        steps.push({ callId: call.id, name: call.name, arguments: call.arguments, result: reason, isError: true })
        report({
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
          status: 'error',
          text: args === null ? '调用参数不是合法 JSON' : '不在本桌可用的只读工具内',
        })
        messages.push(createMessage({
          role: 'tool',
          toolCallId: ToolCallId(call.id),
          content: [{ type: 'text', text: reason }],
          isError: true,
          source: { kind: 'tool', callId: ToolCallId(call.id) },
        }))
        continue
      }
      citations.push(citationOf(call.name, args))
      report({
        callId: call.id,
        name: call.name,
        arguments: call.arguments,
        status: result.isError ? 'error' : 'ok',
        text: citationLabel(args),
      })
      // The cap covers the WHOLE result text, failure prefix included: a
      // single oversized error must not reach the model uncut.
      const body = result.isError ? `调用失败：${resultText(result.content)}` : resultText(result.content)
      const capped = body.slice(0, limits.maxResultChars)
      steps.push({ callId: call.id, name: call.name, arguments: call.arguments, result: capped, isError: result.isError })
      messages.push(createMessage({
        role: 'tool',
        toolCallId: ToolCallId(call.id),
        content: [{ type: 'text', text: capped }],
        ...result.isError ? { isError: true } : {},
        source: { kind: 'tool', callId: ToolCallId(call.id) },
      }))
    }
  }
}
