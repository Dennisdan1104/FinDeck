/** Session Controller adapter for React selector hooks and Slot scope data. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  ISessions,
  SessionBinding,
  SessionListState,
  SessionReference,
  SessionRetainInfo,
  SessionSnapshot,
  SessionSummary,
  UseProjection,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { standardHookPropName } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HostObservable,
  KeyedStandardSource,
  MaybeSnapshotSelectorHook,
  RootStandardSourceContribution,
  ScopedStandardSourceBinding,
  SlotScopeAdapter,
  SnapshotSelectorHook,
  StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only service merge for ctx.slots.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { renderSessionArea } from './session-provider.tsx'

/** Selector hook over the Session Controller list and current selection. */
export type UseSessions = SnapshotSelectorHook<SessionListState>
/** Selector hook over one Session's lifecycle and control state. */
export type SessionSnapshotSelector = SnapshotSelectorHook<SessionSnapshot>
/** Public name for the Session lifecycle selector hook. */
export type UseSession = SessionSnapshotSelector

/** Common identity carried by every Session-scoped pending interaction. */
export interface SessionPendingInteractionBase {
  /** Opaque request identity; a replacement request must use a new key. */
  readonly key: string
  /** Domain-owned presentation discriminator. */
  readonly kind: string
  /** Session whose UI can answer this interaction. */
  readonly sessionId: SessionId
}

/** Declaration-merged roster of domain-owned pending interaction values. */
export interface SessionPendingInteractionMap {}

/** Every pending interaction contributed by the assembled Client. */
export type SessionPendingInteraction =
  [keyof SessionPendingInteractionMap] extends [never]
    ? SessionPendingInteractionBase
    : SessionPendingInteractionMap[keyof SessionPendingInteractionMap]

/** Current effective pending interaction by Session. */
export type SessionPendingInteractionSnapshot = ReadonlyMap<SessionId, SessionPendingInteraction>
/** Selector hook over Session-scoped pending interactions. */
export type UseSessionPendingInteraction = SnapshotSelectorHook<SessionPendingInteractionSnapshot>

/** Independent UI status facts for one Session identity. */
export interface SessionStatus {
  /** Latest known running state; absent until a baseline or event establishes it. */
  readonly running: boolean | undefined
  /** Highest-precedence domain request currently awaiting user interaction. */
  readonly pendingInteraction: SessionPendingInteraction | undefined
  /** Whether an observed stop outside the main view still needs acknowledgement. */
  readonly completionUnread: boolean
}

/** Current UI status indexed by Session identity. */
export type SessionStatusSnapshot = ReadonlyMap<SessionId, SessionStatus>
/** Selector hook over the unified Session UI status snapshot. */
export type UseSessionStatus = SnapshotSelectorHook<SessionStatusSnapshot>

/** Selector hook for explicit or surrounding-Provider Session reference counts. */
export interface UseSessionRetainInfo {
  /**
   * Read the complete retain information for an explicit Session identity.
   * @param sessionId - Session identity to inspect without retaining it.
   * @returns current local reference counts, or absence while the source is unavailable.
   */
  (sessionId: SessionId): SessionRetainInfo | undefined
  /**
   * Select from the retain information for an explicit Session identity.
   * @param sessionId - Session identity to inspect without retaining it.
   * @param selector - projection over the current value.
   * @param equal - optional selected-value equality.
   * @returns selected value.
   */
  <Selected>(
    sessionId: SessionId,
    selector: (value: SessionRetainInfo | undefined) => Selected,
    equal?: (left: Selected, right: Selected) => boolean,
  ): Selected
  /**
   * Select from the surrounding Provider's Session retain information.
   * @param selector - projection receiving absence outside a Session binding.
   * @param equal - optional selected-value equality.
   * @returns selected value.
   */
  <Selected>(
    selector: (value: SessionRetainInfo | undefined) => Selected,
    equal?: (left: Selected, right: Selected) => boolean,
  ): Selected
}

/** Publish one pending interaction and define how plugin teardown delegates it. */
export type PendingInteractionPublisher<T extends SessionPendingInteractionBase> = (
  interaction: T,
  delegate: () => Promise<void>,
) => () => void

interface PendingInteractionEntry<T> {
  readonly interaction: T
  readonly delegate: () => Promise<void>
}

class PendingInteractionDomain<T extends SessionPendingInteractionBase> {
  private readonly values = new Map<string, PendingInteractionEntry<T>>()

  constructor(
    readonly precedence: (interaction: T) => number,
    private readonly changed: () => void,
  ) {}

  valuesSnapshot(): readonly T[] {
    return [...this.values.values()].map(entry => entry.interaction)
  }

  publish(interaction: T, delegate: () => Promise<void>): () => void {
    if (this.values.has(interaction.key)) {
      throw new Error(`ui-session: duplicate pending interaction key '${interaction.key}'`)
    }
    this.values.set(interaction.key, { interaction, delegate })
    this.changed()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (!this.values.delete(interaction.key)) return
      this.changed()
    }
  }

  /** Remove every pending value and return the operations that settle their owners. */
  release(): readonly (() => Promise<void>)[] {
    const delegates = [...this.values.values()].map(entry => entry.delegate)
    this.values.clear()
    return delegates
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotScopeTargetMap {
    session: SessionReference
  }

  interface GlobalStandardProps {
    /** Session list and current selection. */
    useSessions: UseSessions
    /** Unified Session UI status: running, pending interaction, and completion reminder. */
    useSessionStatus: UseSessionStatus
    /** Explicit-key or surrounding-Provider Session retain information. */
    useSessionRetainInfo: UseSessionRetainInfo
    /** Pending user interaction presented by a Session-scoped UI consumer. */
    useSessionPendingInteraction: UseSessionPendingInteraction
  }

  interface SessionStandardProps {
    /** Current Session lifecycle and control state. */
    useSession: SessionSnapshotSelector
    /** Current Session identity. */
    sessionId: SessionId
    /** Host-computed projection values addressed by projection key. */
    useProjection: UseProjection
  }

  interface SessionMaybeStandardProps {
    /** Current Session state, absent while no Session is selected. */
    useSession: MaybeSnapshotSelectorHook<SessionSnapshot>
    /** Current Session identity, absent while no Session is selected. */
    sessionId: SessionId | undefined
    /** Host-computed projection values; every key is absent without a Session. */
    useProjection: UseProjection
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session Controller adapter and session-scoped source registry. */
    uiSession: UiSession
  }
}

type SessionSourceRoster = readonly string[] | undefined
type StandardMemberKind = 'hook' | 'keyed hook' | 'prop'

type SessionSourceRecord<Roster extends SessionSourceRoster, Value> =
  Roster extends readonly string[] ? Readonly<Record<Roster[number], Value>> : never

/** Bare values produced by one Session-scoped source contribution. */
export interface SessionSourceContribution<
  Hooks extends SessionSourceRoster = SessionSourceRoster,
  KeyedHooks extends SessionSourceRoster = SessionSourceRoster,
  Props extends SessionSourceRoster = SessionSourceRoster,
> {
  readonly hooks?: SessionSourceRecord<Hooks, HostObservable<unknown>>
  readonly keyedHooks?: SessionSourceRecord<KeyedHooks, KeyedStandardSource>
  readonly props?: SessionSourceRecord<Props, unknown>
}

/** Static roster and per-Session resolver for one standard-props contribution. */
export interface SessionSourceDescriptor<
  Hooks extends SessionSourceRoster = SessionSourceRoster,
  KeyedHooks extends SessionSourceRoster = SessionSourceRoster,
  Props extends SessionSourceRoster = SessionSourceRoster,
> {
  readonly hooks?: Hooks
  readonly keyedHooks?: KeyedHooks
  readonly props?: Props
  /**
   * Resolve every declared member for one Session binding.
   * @param binding - Controller-owned Session binding.
   * @returns all declared bare sources and stable props.
   */
  resolve(binding: SessionBinding): SessionSourceContribution<
    NoInfer<Hooks>,
    NoInfer<KeyedHooks>,
    NoInfer<Props>
  >
}

interface RuntimeSessionSourceContribution {
  readonly hooks?: Readonly<Record<string, HostObservable<unknown>>>
  readonly keyedHooks?: Readonly<Record<string, KeyedStandardSource>>
  readonly props?: Readonly<Record<string, unknown>>
}

interface RuntimeSessionSourceDescriptor {
  readonly hooks?: readonly string[]
  readonly keyedHooks?: readonly string[]
  readonly props?: readonly string[]
  resolve(binding: SessionBinding): RuntimeSessionSourceContribution
}

type RuntimePendingDomain = PendingInteractionDomain<SessionPendingInteractionBase>

interface MaterializedBinding {
  readonly owner: SessionBinding
  readonly value: ScopedStandardSourceBinding
  readonly release: () => void
}

/** Stable observable over one Session generation's materialized binding. */
interface BindingSource extends HostObservable<StandardSourceBinding> {
  value: StandardSourceBinding
  readonly listeners: Set<() => void>
}

const BUILTIN_SOURCE = {
  hooks: ['session'],
  keyedHooks: ['projection'],
  props: ['sessionId'],
  resolve: binding => ({
    hooks: { session: binding.session },
    keyedHooks: { projection: key => binding.session.projections.faceOf(key) },
    props: { sessionId: binding.sessionId },
  }),
} satisfies SessionSourceDescriptor<
  readonly ['session'],
  readonly ['projection'],
  readonly ['sessionId']
>

/** Session-scoped source roster and renderer adapter. */
export class UiSession extends Service {
  private readonly descriptors: RuntimeSessionSourceDescriptor[] = [
    BUILTIN_SOURCE,
  ]
  private bindings = new Map<SessionId, MaterializedBinding>()
  private absent: StandardSourceBinding
  private currentBinding: StandardSourceBinding
  private readonly currentListeners = new Set<() => void>()
  /** Per-Session sources handed to the renderer for explicit Provider targets. */
  private readonly bindingSources = new Map<SessionId, BindingSource>()
  private readonly absentSource: BindingSource = createBindingSource({
    key: undefined, hooks: {}, keyedHooks: {}, props: {},
  })
  private readonly pendingDomains: RuntimePendingDomain[] = []
  private pendingSnapshot: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map()
  private readonly pendingListeners = new Set<() => void>()
  /** Root source of pending UI interactions, independent from Controller snapshots. */
  readonly pendingInteractions: HostObservable<SessionPendingInteractionSnapshot> = {
    getSnapshot: () => this.pendingSnapshot,
    subscribe: (listener) => {
      this.pendingListeners.add(listener)
      return () => { this.pendingListeners.delete(listener) }
    },
  }
  private readonly running = new Map<SessionId, boolean>()
  private readonly completionUnread = new Set<SessionId>()
  private statusSnapshot: SessionStatusSnapshot = new Map()
  private readonly statusListeners = new Set<() => void>()
  /** Root source of independently owned Session UI status facts. */
  readonly sessionStatus: HostObservable<SessionStatusSnapshot> = {
    getSnapshot: () => this.statusSnapshot,
    subscribe: (listener) => {
      this.statusListeners.add(listener)
      return () => { this.statusListeners.delete(listener) }
    },
  }
  /** Renderer-facing adapter for `session` and `session-maybe` scopes. */
  readonly adapter: SlotScopeAdapter

  /**
   * @param ctx - Client root context.
   * @param sessions - Controller-owned Session object layer.
   */
  constructor(
    ctx: Context,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiSession')
    this.absent = this.materializeAbsent()
    this.currentBinding = this.resolveCurrent()
    this.adapter = {
      current: {
        getSnapshot: () => this.currentBinding,
        subscribe: (listener) => {
          this.currentListeners.add(listener)
          return () => { this.currentListeners.delete(listener) }
        },
      },
      resolve: key => this.resolve(key as SessionId),
      bindingSource: target => this.bindingSource(target),
      renderArea: renderSessionArea,
    }

    ctx.effect(() => {
      const disposeList = sessions.list.subscribe(() => { this.publishCurrent() })
      const disposeStatus = sessions.list.subscribe(() => { this.reconcileStatus() })
      // The forwarded-event allowlist seat (`@deepseek-ai/dsh-api-remotes/client`)
      // is absent from this package's compilation face, so the key reads as
      // `never`; the Host emits `api-session/status` and the session-controller
      // client subscribes through the same key.
      const disposeRemoteStatus = (
        ctx.remote.$on as unknown as (
          key: string,
          listener: (sessionId: SessionId, running: boolean) => void,
        ) => () => void
      )('api-session/status', (sessionId, running) => {
        this.observeRunning(sessionId, running)
      })
      this.reconcileStatus()
      return () => {
        disposeList()
        disposeStatus()
        disposeRemoteStatus()
        const records = [...this.bindings.values()]
        this.bindings.clear()
        for (const record of records) record.release()
      }
    }, 'ui-session: Session binding projection')
  }

  /**
   * Resolve a stable renderer source for an owned Session reference or explicit absence.
   * @param reference - reference supplied by the Provider owner, or absence.
   * @returns the binding source, which reports absence when the reference's generation ends.
   * @throws when the reference does not belong to the active Controller generation.
   */
  bindingSource(reference: SessionReference | undefined): HostObservable<StandardSourceBinding> {
    if (reference === undefined) return this.absentSource
    if (this.sessions.binding(reference.sessionId) !== reference.binding) {
      throw new Error('ui-session: Session reference is not active in this Controller')
    }
    const sessionId = reference.sessionId
    let source = this.bindingSources.get(sessionId)
    if (source === undefined) {
      source = createBindingSource(this.resolve(sessionId) ?? this.absent)
      this.bindingSources.set(sessionId, source)
    }
    return source
  }

  /**
   * Register one Session-scoped standard-source contribution.
   * @param descriptor - static member roster and per-binding resolver.
   * @returns disposer owned by the caller's Cordis fiber.
   */
  provide<
    const Hooks extends SessionSourceRoster = undefined,
    const KeyedHooks extends SessionSourceRoster = undefined,
    const Props extends SessionSourceRoster = undefined,
  >(descriptor: SessionSourceDescriptor<Hooks, KeyedHooks, Props>): () => void {
    const runtimeDescriptor = descriptor as unknown as RuntimeSessionSourceDescriptor
    const dispose = this.ctx.effect(() => {
      this.descriptors.push(runtimeDescriptor)
      try {
        this.rebuildBindings()
      } catch (error) {
        this.descriptors.pop()
        throw error
      }
      return () => {
        const index = this.descriptors.indexOf(runtimeDescriptor)
        this.descriptors.splice(index, 1)
        this.rebuildBindings()
      }
    }, 'uiSession.provide()')
    return () => { void dispose() }
  }

  /**
   * Register one pending-interaction domain and return its publication function.
   * Domain teardown first removes its visible values, then delegates and awaits
   * every still-active owner request.
   * @param precedence - deterministic cross-domain precedence; larger values win.
   * @returns a function that publishes one interaction and its teardown delegation.
   */
  registerPendingInteraction<T extends SessionPendingInteractionBase>(
    precedence: (interaction: T) => number,
  ): PendingInteractionPublisher<T> {
    const domain = new PendingInteractionDomain(precedence, () => {
      this.publishPendingInteractions()
    })
    const runtimeDomain = domain as unknown as RuntimePendingDomain
    this.ctx.effect(() => {
      this.pendingDomains.push(runtimeDomain)
      this.publishPendingInteractions()
      return async () => {
        const delegates = domain.release()
        const index = this.pendingDomains.indexOf(runtimeDomain)
        this.pendingDomains.splice(index, 1)
        this.publishPendingInteractions()
        await Promise.allSettled(delegates.map(delegate => Promise.resolve().then(delegate)))
      }
    }, 'uiSession.registerPendingInteraction()')
    return (interaction, delegate) => domain.publish(interaction, delegate)
  }

  private rebuildBindings(): void {
    const absent = this.materializeAbsent()
    const bindings = new Map<SessionId, MaterializedBinding>()
    try {
      for (const [sessionId, cached] of this.bindings) {
        bindings.set(sessionId, this.createMaterializedBinding(cached.owner))
      }
    } catch (error) {
      for (const record of bindings.values()) record.release()
      throw error
    }
    const previous = this.bindings
    this.absent = absent
    this.bindings = bindings
    for (const record of previous.values()) record.release()
    this.publishBindingSources(absent)
    this.publishCurrent()
  }

  /** Republish every Session source against the current roster, plus the absent projection. */
  private publishBindingSources(absent: StandardSourceBinding): void {
    if (this.absentSource.value !== absent) {
      this.absentSource.value = absent
      notifySubscribers(this.absentSource.listeners, '[ui-session] absent source')
    }
    for (const [sessionId, source] of this.bindingSources) {
      this.publishBindingSource(sessionId, source)
    }
  }

  /** Republish one Session's source; a released generation falls back to absence. */
  private publishBindingSource(sessionId: SessionId, source: BindingSource): void {
    const next = this.bindings.get(sessionId)?.value ?? this.absent
    if (source.value === next) return
    source.value = next
    notifySubscribers(source.listeners, '[ui-session] Session source')
  }

  private resolve(key: SessionId): ScopedStandardSourceBinding | undefined {
    const owner = this.sessions.binding(key)
    if (owner === undefined) return undefined
    const cached = this.bindings.get(key)
    if (cached?.owner === owner) return cached.value
    const record = this.createMaterializedBinding(owner)
    this.bindings.set(key, record)
    cached?.release()
    return record.value
  }

  private resolveCurrent(): StandardSourceBinding {
    const current = this.sessions.list.getSnapshot().current
    return current === undefined ? this.absent : this.resolve(current) ?? this.absent
  }

  private publishCurrent(): void {
    const next = this.resolveCurrent()
    if (next === this.currentBinding) return
    this.currentBinding = next
    notifySubscribers(this.currentListeners, '[ui-session] current binding')
  }

  private publishPendingInteractions(): void {
    const next = new Map<SessionId, {
      interaction: SessionPendingInteractionBase
      precedence: number
    }>()
    for (const domain of this.pendingDomains) {
      for (const interaction of domain.valuesSnapshot()) {
        const precedence = domain.precedence(interaction)
        const previous = next.get(interaction.sessionId)
        if (previous === undefined || precedence >= previous.precedence) {
          next.set(interaction.sessionId, { interaction, precedence })
        }
      }
    }
    const projected = new Map(
      [...next].map(([sessionId, value]) => [sessionId, value.interaction] as const),
    )
    if (samePendingInteractions(this.pendingSnapshot, projected)) return
    this.pendingSnapshot = projected
    notifySubscribers(this.pendingListeners, '[ui-session] pending interactions')
    this.publishStatus()
  }

  /**
   * Record one Host running observation: a stop outside the main view leaves a
   * completion reminder until that Session is viewed again.
   * @param sessionId - Session the status applies to.
   * @param running - current Agent running state.
   */
  private observeRunning(sessionId: SessionId, running: boolean): void {
    const previous = this.running.get(sessionId)
    const beforeBaseline = this.sessions.list.getSnapshot().phase === 'pending'
    this.running.set(sessionId, running)
    if (running) this.completionUnread.delete(sessionId)
    else if ((previous === true || (previous === undefined && beforeBaseline))
      && !this.isMain(sessionId)) this.completionUnread.add(sessionId)
    this.publishStatus()
  }

  /** Fold the list snapshot's running/retention facts into the two local status sets. */
  private reconcileStatus(): void {
    const list = this.sessions.list.getSnapshot()
    const present = new Set(Object.keys(list.byId) as SessionId[])
    // Subagent catalog rows and retained subagent fallback rows do not establish Host running state.
    for (const id of list.ids) {
      const row = list.byId[id] as SessionSummary
      const previous = this.running.get(id)
      if (previous === undefined) this.running.set(id, row.running)
      else if (previous !== row.running) this.observeRunning(id, row.running)
    }
    for (const id of present) {
      if (this.isMain(id)) this.completionUnread.delete(id)
    }
    if (list.phase === 'ready') {
      for (const id of this.running.keys()) {
        if (present.has(id)) continue
        this.running.delete(id)
        this.completionUnread.delete(id)
      }
    }
    this.publishStatus()
  }

  /** Whether one identity is currently held by the main view's own reference. */
  private isMain(sessionId: SessionId): boolean {
    return (this.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView ?? 0) > 0
  }

  /** Republish the unified status snapshot for every identity any status fact names. */
  private publishStatus(): void {
    const ids = new Set<SessionId>([
      ...(Object.keys(this.sessions.list.getSnapshot().byId) as SessionId[]),
      ...this.running.keys(),
      ...this.pendingSnapshot.keys(),
      ...this.completionUnread,
    ])
    const next = new Map<SessionId, SessionStatus>()
    for (const id of ids) {
      next.set(id, {
        running: this.running.get(id),
        pendingInteraction: this.pendingSnapshot.get(id),
        completionUnread: this.completionUnread.has(id),
      })
    }
    if (sameSessionStatus(this.statusSnapshot, next)) return
    this.statusSnapshot = next
    notifySubscribers(this.statusListeners, '[ui-session] Session status')
  }

  private createMaterializedBinding(owner: SessionBinding): MaterializedBinding {
    const value = this.materialize(owner)
    const releaseEffect = owner.ctx.effect(() => () => {
      if (this.bindings.get(owner.sessionId) !== record) return
      this.bindings.delete(owner.sessionId)
      const source = this.bindingSources.get(owner.sessionId)
      if (source !== undefined) this.publishBindingSource(owner.sessionId, source)
      if (this.currentBinding !== value) return
      this.currentBinding = this.absent
      notifySubscribers(this.currentListeners, '[ui-session] current binding')
    }, `ui-session: binding ${owner.sessionId}`)
    const record: MaterializedBinding = {
      owner,
      value,
      release: () => { void releaseEffect() },
    }
    return record
  }

  private materialize(binding: SessionBinding): ScopedStandardSourceBinding {
    const hooks: Record<string, HostObservable<unknown>> = {}
    const keyedHooks: Record<string, KeyedStandardSource> = {}
    const props: Record<string, unknown> = {}
    const finalProps = new Set<string>()
    for (const descriptor of this.descriptors) {
      const contribution = descriptor.resolve(binding)
      validateContribution(descriptor, contribution)
      copyDeclared('hook', hooks, descriptor.hooks, contribution.hooks, finalProps)
      copyDeclared('keyed hook', keyedHooks, descriptor.keyedHooks, contribution.keyedHooks, finalProps)
      copyDeclared('prop', props, descriptor.props, contribution.props, finalProps)
    }
    const value: ScopedStandardSourceBinding = {
      key: binding.sessionId,
      ctx: binding.ctx,
      hooks,
      keyedHooks,
      props,
    }
    this.ctx.slots.bindStoreScope(value)
    return value
  }

  private materializeAbsent(): StandardSourceBinding {
    const hooks: Record<string, undefined> = {}
    const keyedHooks: Record<string, undefined> = {}
    const props: Record<string, undefined> = {}
    const finalProps = new Set<string>()
    for (const descriptor of this.descriptors) {
      declareAbsent('hook', hooks, descriptor.hooks, finalProps)
      declareAbsent('keyed hook', keyedHooks, descriptor.keyedHooks, finalProps)
      declareAbsent('prop', props, descriptor.props, finalProps)
    }
    return { key: undefined, hooks, keyedHooks, props }
  }
}

/** Mint one stable observable over a materialized binding value. */
function createBindingSource(value: StandardSourceBinding): BindingSource {
  const source: BindingSource = {
    value,
    listeners: new Set(),
    getSnapshot: () => source.value,
    subscribe: (listener) => {
      source.listeners.add(listener)
      return () => { source.listeners.delete(listener) }
    },
  }
  return source
}

function validateContribution(
  descriptor: RuntimeSessionSourceDescriptor,
  contribution: RuntimeSessionSourceContribution,
): void {
  rejectUndeclared('hook', descriptor.hooks, contribution.hooks)
  rejectUndeclared('keyed hook', descriptor.keyedHooks, contribution.keyedHooks)
  rejectUndeclared('prop', descriptor.props, contribution.props)
}

function rejectUndeclared(
  kind: string,
  declared: readonly string[] | undefined,
  values: Readonly<Record<string, unknown>> | undefined,
): void {
  for (const name of Object.keys(values ?? {})) {
    if (!(declared ?? []).includes(name)) {
      throw new Error(`uiSession.provide: undeclared ${kind} '${name}'`)
    }
  }
}

function copyDeclared<T>(
  kind: StandardMemberKind,
  target: Record<string, T>,
  declared: readonly string[] | undefined,
  values: Readonly<Record<string, T>> | undefined,
  finalProps: Set<string>,
): void {
  for (const name of declared ?? []) {
    claimStandardProp(kind, name, finalProps)
    const value = values?.[name]
    if (value === undefined) throw new Error(`uiSession.provide: missing ${kind} '${name}'`)
    target[name] = value
  }
}

function declareAbsent(
  kind: StandardMemberKind,
  target: Record<string, undefined>,
  declared: readonly string[] | undefined,
  finalProps: Set<string>,
): void {
  for (const name of declared ?? []) {
    claimStandardProp(kind, name, finalProps)
    target[name] = undefined
  }
}

function claimStandardProp(kind: StandardMemberKind, name: string, finalProps: Set<string>): void {
  const propName = kind === 'prop' ? name : standardHookPropName(name)
  if (finalProps.has(propName)) {
    throw new Error(`uiSession.provide: duplicate ${kind} '${name}' at prop '${propName}'`)
  }
  finalProps.add(propName)
}

/** Required Controller and renderer services. */
export const inject = ['sessions', 'slots', 'remote']

/**
 * Install the Session root source and scoped adapter.
 * @param ctx - Client Cordis context.
 */
export function apply(ctx: Context): void {
  const service = new UiSession(ctx, ctx.sessions)
  ctx.slots.provideRoot({
    hooks: {
      sessions: ctx.sessions.list,
      sessionStatus: service.sessionStatus,
      sessionPendingInteraction: service.pendingInteractions,
    },
    keyedHooks: {
      sessionRetainInfo: key => ctx.sessions.retainInfo(key as SessionId),
    },
  } satisfies RootStandardSourceContribution)
  ctx.slots.installScope('session', service.adapter)
}

function sameSessionStatus(left: SessionStatusSnapshot, right: SessionStatusSnapshot): boolean {
  if (left.size !== right.size) return false
  for (const [id, status] of left) {
    const candidate = right.get(id)
    if (candidate === undefined
      || candidate.running !== status.running
      || candidate.pendingInteraction !== status.pendingInteraction
      || candidate.completionUnread !== status.completionUnread) return false
  }
  return true
}

function samePendingInteractions(
  left: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
  right: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
): boolean {
  if (left.size !== right.size) return false
  for (const [sessionId, interaction] of left) {
    if (right.get(sessionId) !== interaction) return false
  }
  return true
}
