import { memo, useCallback, useMemo } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<PresentationInjected>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, groupPart, useDisclosure, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions,
  usePresentation, t,
}: AssistantNodeViewProps) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  // The compact disclosure hides the folded answer's reasoning; the grouped
  // transcript keeps it in place and renders it as quiet interleaved rows.
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  // The grouped transcript renders this Turn's process as interleaved quiet
  // rows, so the reply's reasoning starts as a preview beside the Think title.
  const groupedQuiet = usePresentation(policy => policy.stepGrouping === 'collapsed')
  const reasoningQuiet = groupedQuiet && !(turnProcess?.hasContent ?? false)
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      groupPart={groupPart}
      useDisclosure={useDisclosure}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      reasoningQuiet={reasoningQuiet}
      revealProcess={revealProcess}
      mentions={mentions}
      t={t}
    />
  )
})
