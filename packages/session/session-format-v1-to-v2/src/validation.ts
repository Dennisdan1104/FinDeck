import { isAbsolute } from 'node:path'
import { BlockAssembler, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import {
  SessionFormatError,
  SessionFormatUnsupportedMigrationError,
  sessionFormatCount,
  sessionFormatSafeInteger,
  snapshotSessionFormatJson,
} from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatArtifact,
  SessionFormatEvent,
  SessionFormatHeader,
  SessionFormatJsonObject,
  SessionFormatJsonValue,
} from '@deepseek-ai/dsh-session-format'
import {
  assertReleasedArtifactRelationships,
  assertReleasedPayloadSemantics,
  assertReleasedSurfaceMetadata,
} from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { RELEASED_V2_EVENT_DISPOSITIONS, RELEASED_V2_EVENT_TYPES } from './dispositions.ts'

const HEADER_REQUIRED = ['version', 'id', 'createdAt', 'isSeeded', 'delegationDepth'] as const
const HEADER_OPTIONAL = ['cwd', 'parentSession', 'origin', 'agentPreset'] as const
const EVENT_REQUIRED = ['type', 'seq', 'time', 'data'] as const
const SURFACE_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])
const SURFACE_OPTIONAL = ['ignorable', 'sourceEventSeqs', 'surfaceOp'] as const
const LOG_OPTIONAL = ['ignorable'] as const
const RELEASED_V2_RELATIONSHIP_EXTENSIONS = {
  stepEvents: new Set(['assistant/attempt']),
  preservedSourceTitleRequestText: true,
} as const
const RELEASED_V2_EVENT_TYPE_SET = new Set(RELEASED_V2_EVENT_TYPES)

/**
 * Validate the exact logical header written by released v2.
 * @param header - decoded released-v2 Session header.
 * @throws {SessionFormatError} when the header is not an exact released-v2 value.
 */
export function assertReleasedV2Header(header: SessionFormatHeader): void {
  const record = releasedV2Record(header, 'format v2 header')
  assertReleasedV2Keys(record, HEADER_REQUIRED, HEADER_OPTIONAL, 'format v2 header')
  if (record['version'] !== 2) throw new SessionFormatError('expected format v2 header')
  if (typeof record['id'] !== 'string') throw new SessionFormatError('format v2 header id must be a string')
  sessionFormatCount(record['createdAt'], 'format v2 header createdAt')
  sessionFormatCount(record['delegationDepth'], 'format v2 header delegationDepth')
  if (typeof record['isSeeded'] !== 'boolean') throw new SessionFormatError('format v2 header isSeeded must be boolean')
  if (record['cwd'] !== undefined && (typeof record['cwd'] !== 'string' || !isAbsolute(record['cwd']))) {
    throw new SessionFormatError('format v2 header cwd must be absolute')
  }
  for (const key of ['parentSession', 'agentPreset'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      throw new SessionFormatError(`format v2 header ${key} must be a string`)
    }
  }
  if (record['origin'] !== undefined && record['origin'] !== 'subagent') {
    throw new SessionFormatError('format v2 header origin must be "subagent"')
  }
}

/**
 * Validate the exact logical image emitted by the released v2 writer, including every
 * known payload and each embedded Assistant stream against its assembled message.
 * @param artifact - complete decoded released-v2 Session artifact.
 * @throws {SessionFormatError} when an envelope, payload, relationship, or inherited cut is invalid.
 * @throws {SessionFormatUnsupportedMigrationError} when the artifact contains an unknown event type.
 */
export function assertReleasedV2Artifact(artifact: SessionFormatArtifact): void {
  validateReleasedV2Artifact(artifact, 'target', RELEASED_V2_EVENT_TYPE_SET)
}

function validateReleasedV2Artifact(
  artifact: SessionFormatArtifact,
  mode: 'target' | 'current' | 'physical',
  knownEventTypes?: ReadonlySet<string>,
  relationshipHeaderVersion: number = artifact.header.version,
): void {
  assertReleasedV2Header(artifact.header)
  const cut = sessionFormatCount(artifact.inheritedEventCount, 'format v2 inherited event count')
  if (cut > artifact.events.length) throw new SessionFormatError('format v2 inherited event count exceeds its events')
  if (!artifact.header.isSeeded && cut !== 0) throw new SessionFormatError('unseeded format v2 Session has inherited events')
  let lastInheritedMarker: number | undefined
  for (const [index, event] of artifact.events.entries()) {
    const record = releasedV2Record(event, `format v2 event ${index}`)
    const type = record['type']
    if (typeof type !== 'string') throw new SessionFormatError(`format v2 event ${index} type must be a string`)
    const disposition = RELEASED_V2_EVENT_DISPOSITIONS[type]
    const installed = knownEventTypes?.has(type) === true
    const ignorableUnknown = disposition === undefined
      && mode === 'current'
      && record['ignorable'] === true
    if (mode !== 'physical' && disposition === undefined && !installed && !ignorableUnknown) {
      throw new SessionFormatUnsupportedMigrationError(
        `format v2 contains unknown event type ${JSON.stringify(type)} at seq ${index}`,
      )
    }
    const surface = disposition !== undefined && SURFACE_TYPES.has(type)
    const optional = mode === 'physical' || disposition === undefined
      ? SURFACE_OPTIONAL
      : surface ? SURFACE_OPTIONAL : LOG_OPTIONAL
    assertReleasedV2Keys(record, EVENT_REQUIRED, optional, `format v2 event ${index}`)
    if (record['seq'] !== index) throw new SessionFormatError(`format v2 event ${index} is not dense`)
    sessionFormatSafeInteger(record['time'], `format v2 event ${index} time`)
    if (record['ignorable'] !== undefined && record['ignorable'] !== true) {
      throw new SessionFormatError(`format v2 event ${index} ignorable must be true when present`)
    }
    if (mode === 'target' && surface) assertReleasedSurfaceMetadata(record, index, type, 'forbid-assistant')
    if (mode === 'target' && disposition !== undefined) assertPayload(event, disposition)
    if (type === 'session/end-seed') {
      const data = releasedV2Record(event.data, `session/end-seed ${index} data`)
      if (data['inherited'] === true) lastInheritedMarker = index
    }
  }
  if (artifact.header.isSeeded && lastInheritedMarker !== cut) {
    throw new SessionFormatError('format v2 seeded header disagrees with its last inherited end-seed marker')
  }
  if (!artifact.header.isSeeded && lastInheritedMarker !== undefined) {
    throw new SessionFormatError('format v2 unseeded Session contains an inherited end-seed marker')
  }
  if (mode === 'target') {
    assertReleasedArtifactRelationships(artifact, RELEASED_V2_RELATIONSHIP_EXTENSIONS)
    return
  }
  if (mode === 'current') {
    assertReleasedArtifactRelationships({
      ...artifact, header: { ...artifact.header, version: relationshipHeaderVersion },
    }, RELEASED_V2_RELATIONSHIP_EXTENSIONS)
  }
}

/**
 * Validate one known released-v2 payload and, for an Assistant step, prove that its
 * embedded stream assembles into the message, usage, and replay state it stores.
 * @param event - known released-v2 event.
 * @param disposition - frozen payload disposition for its event type.
 */
function assertPayload(
  event: SessionFormatEvent,
  disposition: (typeof RELEASED_V2_EVENT_DISPOSITIONS)[string],
): void {
  const data = releasedV2Record(event.data, `${event.type} ${event.seq} data`)
  assertReleasedV2Keys(data, disposition.required, disposition.optional, `${event.type} ${event.seq} data`)
  for (const key of disposition.opaque) {
    if (Object.hasOwn(data, key)) snapshotSessionFormatJson(data[key], `${event.type} ${event.seq} opaque ${key}`)
  }
  if (event.type === 'assistant/attempt' || event.type === 'assistant/message') {
    const turn = sessionFormatCount(data['turn'], `${event.type} ${event.seq} turn`)
    const step = sessionFormatCount(data['step'], `${event.type} ${event.seq} step`)
    const assembler = new BlockAssembler()
    let timed: ReturnType<typeof expandAssistantStream>
    try {
      timed = expandAssistantStream(data['stream'] as never)
      for (const member of timed) {
        assertReleasedPayloadSemantics({
          type: 'assistant/chunk',
          seq: event.seq,
          time: member.time,
          data: { turn, step, chunk: member.chunk } as unknown as SessionFormatJsonValue,
        }, 2)
        assembler.push(member.chunk)
      }
    } catch (error: unknown) {
      throw new SessionFormatError(`${event.type} ${event.seq} has an invalid embedded stream`, { cause: error })
    }
    if (event.type === 'assistant/attempt') return
    assertReleasedPayloadSemantics(event, 2)
    if (timed.length > 0) {
      const message = releasedV2Record(data['message'], `assistant/message ${event.seq} message`)
      const content = data['interrupted'] === true ? assembler.interruptedBlocks() : assembler.blocks()
      if (!deepEqualJson(message['content'], content)) {
        throw new SessionFormatError(`assistant/message ${event.seq} message content disagrees with its embedded stream`)
      }
      if (!deepEqualJson(data['usage'], assembler.usage)) {
        throw new SessionFormatError(`assistant/message ${event.seq} usage disagrees with its embedded stream`)
      }
      const source = releasedV2Record(message['source'], `assistant/message ${event.seq} source`)
      if (!deepEqualJson(source['replayState'], assembler.replayState)) {
        throw new SessionFormatError(`assistant/message ${event.seq} replay state disagrees with its embedded stream`)
      }
    }
    return
  }
  if (event.type === 'session/end-seed') {
    if (data['inherited'] !== undefined && data['inherited'] !== true) {
      throw new SessionFormatError(`session/end-seed ${event.seq} inherited must be true when present`)
    }
    return
  }
  assertReleasedPayloadSemantics(event, 2)
}

/**
 * Require one released-v2 value to be a JSON object.
 * @param value - value to narrow.
 * @param label - diagnostic subject.
 * @returns the narrowed object.
 */
export function releasedV2Record(
  value: SessionFormatJsonValue | undefined,
  label: string,
): SessionFormatJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionFormatError(`${label} must be an object`)
  }
  return value as SessionFormatJsonObject
}

/**
 * Require one released-v2 object to contain exactly the admitted keys.
 * @param value - object to inspect.
 * @param required - keys that must be present.
 * @param optional - additional keys that may be present.
 * @param label - diagnostic subject.
 */
export function assertReleasedV2Keys(
  value: SessionFormatJsonObject,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const missing = required.find(key => !Object.hasOwn(value, key))
  if (missing !== undefined) throw new SessionFormatError(`${label} lacks required field ${missing}`)
  const unexpected = Object.keys(value).find(key => !allowed.has(key))
  if (unexpected !== undefined) throw new SessionFormatError(`${label} has unexpected field ${unexpected}`)
}

/**
 * Restore and validate one decoded released-v2 artifact.
 * @param artifact - detached vocabulary-restored artifact.
 * @param knownEventTypes - event types understood by the installed current Session package.
 * @param relationshipHeaderVersion - logical generation whose version-sensitive relationships are checked.
 * @returns the same validated artifact.
 */
export function restoreReleasedV2Artifact(
  artifact: SessionFormatArtifact,
  knownEventTypes: ReadonlySet<string>,
  relationshipHeaderVersion: number = artifact.header.version,
): SessionFormatArtifact {
  validateReleasedV2Artifact(artifact, 'current', knownEventTypes, relationshipHeaderVersion)
  return artifact
}

/**
 * Validate the released-v2 physical envelope without interpreting event vocabulary.
 * @param artifact - released-v2 physical artifact.
 */
export function assertReleasedV2PhysicalArtifact(artifact: SessionFormatArtifact): void {
  validateReleasedV2Artifact(artifact, 'physical')
}

/**
 * Restore the exact artifact an adjacent migration produced: every released-v2 envelope,
 * payload, embedded Assistant stream, relationship, and inherited cut is validated.
 * @param artifact - artifact at v2 produced by the adjacent migration.
 * @returns the same validated artifact.
 */
export function restoreReleasedV2TransformedArtifact(
  artifact: SessionFormatArtifact,
): SessionFormatArtifact {
  assertReleasedV2Artifact(artifact)
  return artifact
}
