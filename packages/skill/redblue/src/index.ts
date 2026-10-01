/**
 * Red/blue adversarial review: user-editable red and blue prompts under
 * the `rbcheck` settings namespace, the `/rb-check` command a human runs, and
 * the `rb_check` tool the agent itself calls — both entries inject the same
 * red-team-attack-then-blue-team-defense instruction over one research
 * deliverable (report path or thesis id), with the conclusion written back to
 * the report.
 *
 * The orchestration happens in the owning session: each entry injects one
 * structured instruction carrying both prompts in order — red first, then
 * blue, then the write-back — and the model performs the phases sequentially
 * in one run. The tool's inject is claimed at the calling agent's next step
 * boundary, so the review continues the same turn that requested it. Both
 * prompts are store-backed with defaults, so resetting to default is a plain
 * settings write of the base values.
 *
 * @module @deepseek-ai/dsh-redblue
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'redblue': { kind: 'redblue' } & ContextFormed
  }
}
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'


export const name = 'redblue'
export const inject = ['settings', 'commands', 'tools']

/** The red-team prompt defaults; the exact attack contract a review runs on. */
export const RED_PROMPT_DEFAULT = [
  '你是红队审查员。你面前是一份研究产出（报告/结论/代码）。',
  '你的任务不是补充，而是攻击：',
  '1. 找出结论所依赖的隐含假设，逐个质疑其成立条件；',
  '2. 核对每个关键数字能否从所述数据/代码复现，指出无法复现的；',
  '3. 提出至少一个与结论相反但同样符合数据的解释；',
  '4. 检查是否存在前视偏差、幸存者偏差、过拟合迹象。',
  '只输出具体的攻击点，按严重度排序；没有问题的部分不要客套。',
].join('\n')

/** The blue-team defense prompt defaults: answer each attack, admit or rebut with evidence. */
export const BLUE_PROMPT_DEFAULT = [
  '你是蓝队辩护人。你面前是一份研究产出与红队提出的攻击点。',
  '你的任务不是护短，而是逐条回应：',
  '1. 对每条攻击点给出结论：成立/部分成立/不成立，并附证据；',
  '2. 成立的攻击点说明对结论的影响：需要修改/仍成立但置信下调/致命；',
  '3. 证据不足以反驳的，明确说"无法反驳"，并写明需要什么数据才能反驳；',
  '4. 红队指出的事实错误，指出正确事实。',
  '只输出回应清单与修正后的结论，不客套。',
].join('\n')

/**
 * User-editable red/blue prompts. The settings base carries the defaults, so
 * "reset to default" is a write of these values and an absent namespace reads
 * as the defaults.
 */
export const RB_PROMPTS_DEFAULT = {
  redPrompt: RED_PROMPT_DEFAULT,
  bluePrompt: BLUE_PROMPT_DEFAULT,
} as const

/** Runtime schema for the `rbcheck` settings namespace. */
export const RBPromptsSchema: z<typeof RB_PROMPTS_DEFAULT> = z.object({
  redPrompt: z.string().description('Red-team review prompt (attacker).'),
  bluePrompt: z.string().description('Blue-team defense prompt (respondent).'),
})

/**
 * The one instruction the command injects; pure so tests and reuse share it.
 * @param target - the report path or thesis id under review.
 * @param red - the red-team prompt injected as the first phase.
 * @param blue - the blue-team prompt injected as the second phase.
 * @returns the complete `system-reminder` message the model receives.
 */
export function buildRbCheckInstruction(target: string, red: string, blue: string): string {
  return [
    '<system-reminder>',
    '红蓝队检查请求（红先蓝后，依序完成）：',
    `检查目标：${target}`,
    '',
    '—— 第一阶段，红队审查 ——',
    red,
    '',
    '—— 第二阶段，蓝队辩护 ——',
    blue,
    '',
    '—— 完成后回写 ——',
    '1. 把检查结论（红队攻击点、蓝队回应、修正后结论）追加到目标报告的「红蓝队检查」小节（小标题+列表，不改动报告正文其他内容）；',
    '2. 若目标是命题 id（thesis id），用 thesis_mark 按检查结论记录本次命中/落空并写明证据；',
    '3. 结论既要写成立项，也要写未能反驳的项；没有攻击点也要说明结论无红队可攻击之处。',
    '</system-reminder>',
  ].join('\n')
}

/** The stored prompts with an empty string read as its shipped default. */
function resolvePrompts(stored: { redPrompt: string; bluePrompt: string }): { red: string; blue: string } {
  // An empty stored prompt means "use the default": the settings card's
  // reset button writes empty strings instead of duplicating the defaults.
  return {
    red: stored.redPrompt.trim() === '' ? RED_PROMPT_DEFAULT : stored.redPrompt,
    blue: stored.bluePrompt.trim() === '' ? BLUE_PROMPT_DEFAULT : stored.bluePrompt,
  }
}

/** The one injected user message both entries share. */
function rbCheckMessage(target: string, red: string, blue: string) {
  return createUserMessage({
    content: [{ type: 'text', text: buildRbCheckInstruction(target, red, blue) }],
    source: { kind: name, form: 'notice', summary: '红蓝队检查请求' },
  })
}

/**
 * Register the `rbcheck` settings namespace, the `/rb-check` command, and the
 * `rb_check` tool. Command form: `/rb-check <报告路径|命题id>` — one argument
 * naming the deliverable under review; missing or empty reports a usage error.
 */
export function apply(ctx: Context): void {
  const scope = ctx.settings.register('rbcheck', RBPromptsSchema, { base: { ...RB_PROMPTS_DEFAULT } })

  ctx.commands.register({
    name: 'rb-check',
    description: 'Run a red-team attack then a blue-team defense over one research deliverable, and write the conclusion back.',
    input: { hint: '<报告路径|命题id>' },
    handler: ({ agent, rawInput }): Promise<CommandResult> => {
      const target = rawInput.trim()
      if (target === '') {
        return Promise.resolve({ kind: 'error', text: '用法：/rb-check <报告路径或命题id>' })
      }
      const { red, blue } = resolvePrompts(scope.get())
      agent.inject(rbCheckMessage(target, red, blue))
      return Promise.resolve({
        kind: 'success',
        text: `已请求红蓝队检查「${target}」——红队先攻、蓝队辩护，完成后结论回写;可在会话中随时打断。`,
      })
    },
  })

  ctx.tools.register(defineTool({
    name: 'rb_check',
    description:
      'Initiate a red/blue adversarial review of one research deliverable yourself — the same review the '
      + 'user triggers with /rb-check. Pass a report file path or a thesis id. The red phase attacks the '
      + 'conclusion (hidden assumptions, numbers that do not reproduce, rival explanations, lookahead and '
      + 'survivorship bias), the blue phase answers each attack with evidence, and the conclusion is written '
      + "back to the report's red-blue section or recorded via thesis_mark. The instruction arrives at your "
      + 'next step; run both phases in order before moving on. Use it before publishing a report, before '
      + 'marking a thesis, or when you want your own conclusion challenged.',
    parameters: {
      target: { type: 'string', required: true, description: 'The deliverable under review: a report file path or a thesis id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true },
          queued: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Red/blue review of "${value.target}" queued — the instruction arrives at the next step; complete the red phase, then the blue phase, then the write-back.`,
      }],
    },
    execute(args, exec) {
      const target = args.target.trim()
      if (target === '') {
        throw new Error('rb_check requires a non-empty target (report path or thesis id)')
      }
      if (!exec.agent) {
        // The review runs in the calling agent's session; without one there is
        // no turn the instruction could continue.
        throw new Error('rb_check requires a calling agent session')
      }
      const { red, blue } = resolvePrompts(scope.get())
      exec.agent.inject(rbCheckMessage(target, red, blue))
      return Promise.resolve({ target, queued: true })
    },
    presentCall: args => ({ card: 'generic', title: 'Red/blue review', kind: 'other', rawInput: args.target }),
  }))
}
