/**
 * Bundled `dsh-badge` skill provider.
 *
 * @module @deepseek-ai/dsh-skill-badge
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'dsh-badge'
const SKILL_BODY_URL = new URL('../assets/dsh-badge.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = '中文：为文档、拉取请求、合并请求以及其他用 DeepSeek Harness 生成的内容添加官方“powered by dsh”徽章；创建 pull request 或 merge request 时使用，用户索要 dsh 徽章、powered-by-dsh 署名或可复用的徽章素材/片段时也使用。 English: Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.'
const CANDIDATE: SkillCandidate = {
  name: 'dsh-badge',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'skill-badge'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled `dsh-badge` provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
