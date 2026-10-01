/**
 * The seeded table's conversation export: one deep table may continue an
 * existing session, and that conversation is materialized as a markdown file
 * under `<archive root>/seeds/` instead of being inlined into any speaker's
 * context. Deep speakers are told the file's path and read it themselves
 * through the research window's read-only tools — the conversation is
 * something they consult, not something every request carries.
 *
 * @module @deepseek-ai/dsh-roundtable/seed
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** What a caller names when opening a seeded table. */
export interface SeedRequest {
  /** The session whose conversation the table continues. */
  readonly sessionId: string
  /** That session's display title. */
  readonly title: string
}

/**
 * Render one session's visible conversation as markdown: every surface user
 * and assistant text message, oldest first, with local times. Tool traffic,
 * attempts, and bookkeeping events are not conversation and stay out.
 * @param events - the session's complete raw event log.
 * @param title - the session's display title, as the header.
 * @returns the markdown document.
 */
export function renderConversation(events: readonly SessionEvent[], title: string): string {
  const lines: string[] = [`# ${title}`, '']
  for (const event of events) {
    if (event.type === 'user/message') {
      const text = textOf(event.data.content)
      if (text !== '') lines.push(`**用户**（${localTime(event.time)}）`, '', text, '')
    } else if (event.type === 'assistant/message') {
      const text = textOf(event.data.message.content)
      if (text !== '') lines.push(`**助手**（${localTime(event.time)}）`, '', text, '')
    }
  }
  return `${lines.join('\n')}\n`
}

/** Concatenate one message's text blocks; non-text blocks carry no conversation. */
function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

/** One event's wall time as a readable local timestamp. */
function localTime(time: number): string {
  return new Date(time).toLocaleString('sv-SE', { hour12: false })
}

/**
 * Write one conversation export atomically under `<dir>/seeds/` and name it
 * by the moment it was exported.
 * @param dir - the archive root (the staging `seeds/` folder is created inside).
 * @param document - the rendered markdown.
 * @returns the written file's absolute path.
 */
export async function writeSeedFile(dir: string, document: string): Promise<string> {
  const seeds = join(dir, 'seeds')
  await mkdir(seeds, { recursive: true })
  const file = join(seeds, `${Date.now()}-seed.md`)
  const tmp = `${file}.tmp`
  await writeFile(tmp, document, 'utf-8')
  await rename(tmp, file)
  return file
}
