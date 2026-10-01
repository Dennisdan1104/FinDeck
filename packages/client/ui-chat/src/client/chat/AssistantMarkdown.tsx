import { Fragment, memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps, UseDisclosure } from '../contract/slots.ts'
import type { AssistantBlock } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import { useSearchableHidden } from './searchable-hidden.ts'
import css from './AssistantMarkdown.module.css'

export interface AssistantMarkdownProps {
  /** Render only the requested business portion, preserving original block indexes. */
  groupPart?: string | undefined
  /** Stable Hook forwarded to each independently expandable reasoning block. */
  useDisclosure: UseDisclosure
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Hide reasoning that belongs to the Turn-level process disclosure. */
  reasoningHidden?: boolean | undefined
  /**
   * Render reasoning as the grouped transcript's interleaved quiet rows: the
   * label names the process, and every segment starts collapsed.
   */
  reasoningQuiet?: boolean | undefined
  /** Reveal the owning Turn-level process disclosure. */
  revealProcess?: (() => void) | undefined
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** Reasoning block as the Think variant summary row (figma 39:28304). */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages, groupPart, useDisclosure,
  reasoningHidden = false, reasoningQuiet = false, revealProcess, mentions, t,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const labels = useMemo(() => markdownLabels(t), [t])
  const last = blocks.length - 1
  // Tool-call heads render as tool rows in the chat view's grouping pass, so a
  // node that is only those heads (or empty) would paint an empty root between
  // tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call' && isInPart(partOf(block.kind), groupPart))
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    if (isToolCall(block)) continue
    if (!isInPart(partOf(block.kind), groupPart)) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <MarkdownText
            key={i}
            text={block.text}
            streaming={streaming}
            labels={labels}
            fileMentions={mentions}
          />,
        )
        break
      case 'reasoning':
        rendered.push(
          <ProcessReasoning
            key={i}
            quiet={reasoningQuiet}
            hidden={reasoningHidden}
            reveal={revealProcess}
          >
            <ReasoningRow
              text={block.text}
              running={streaming && i === last}
              useDisclosure={useDisclosure}
              titleKey={reasoningQuiet ? 'message.turnProcess.group.title' : 'message.think'}
              t={t}
            />
          </ProcessReasoning>,
        )
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {rendered}
        {interrupted && (groupPart === undefined || groupPart === 'response'
          || !blocks.some(block => block.kind !== 'reasoning' && block.kind !== 'tool-call'))
          && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})

function ProcessReasoning({ quiet, hidden, reveal, children }: {
  quiet: boolean
  hidden: boolean
  reveal?: (() => void) | undefined
  children: ReactNode
}) {
  const ref = useSearchableHidden(hidden, reveal ?? NOOP)
  return (
    <div
      ref={ref}
      className={quiet ? css.quiet : undefined}
      data-turn-process-inline={hidden || undefined}
    >
      {children}
    </div>
  )
}

const NOOP = (): void => {}

/**
 * Which business portion one assistant block belongs to.
 * @param kind - assistant block discriminant.
 * @returns the reasoning portion for reasoning blocks, the response portion otherwise.
 */
function partOf(kind: AssistantBlock['kind']): 'reasoning' | 'response' {
  return kind === 'reasoning' ? 'reasoning' : 'response'
}

/**
 * Whether one assistant block is a tool-call head, which the grouping pass renders as a tool row.
 * @param block - assistant content block.
 * @returns whether the block carries no row of its own here.
 */
function isToolCall(block: AssistantBlock): boolean {
  return block.kind === 'tool-call'
}

/**
 * Whether one block belongs to the requested render portion.
 * @param part - the block's business portion.
 * @param requested - the owner's portion, or undefined for the whole message.
 * @returns whether the block renders.
 */
function isInPart(part: 'reasoning' | 'response', requested: string | undefined): boolean {
  return requested === undefined || requested === part
}
