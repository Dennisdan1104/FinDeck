/** Named transcription providers with disposable registration and explicit routing. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the `settings` service that persists `configure()` into this plugin's profile entry, and the Loader's
// entry the write addresses.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { SpeechPreparationOptions, SpeechProvider, SpeechProviderId, SpeechProviderInfo, SpeechSelection, SpeechSnapshot, SpeechSelectionPatch, SpeechRequest, SpeechSpec, Transcript } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech recognition provider registry. */
    speechToText: SpeechToText
  }
}

/** Composition defaults read before a transcription starts; `configure()` writes changed fields through the profile. */
export interface Config {
  /** Registered provider selected when the caller omits an id. */
  defaultProvider: string
  /** Provider language hint selected when the caller omits one. */
  language: string
}

interface Registration {
  readonly provider: SpeechProvider
  readonly lifetime: AbortController
  readonly pending: Set<Promise<Transcript>>
  readonly unsubscribe: () => void
}

/** Registry shared by all transcription consumers in one Host composition. */
export default class SpeechToText extends Service {
  static Config = z.object({
    defaultProvider: z.string().min(1).required(),
    language: z.string().min(1).default('auto'),
  })

  private readonly providers = new Map<SpeechProviderId, Registration>()
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  /** Profile-local entry id used by Settings; absent when the plugin was mounted without Loader. */
  private readonly entryId: string | undefined
  /** Live selection: the composition default until `configure()` applies a persisted change. */
  private selection: SpeechSelection

  constructor(ctx: Context, config: Config) {
    super(ctx, 'speechToText')
    this.entryId = ctx.fiber.entry?.options.id
    this.selection = { providerId: config.defaultProvider as SpeechProviderId, language: config.language }
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Speech service disposed'))
      await Promise.all([...this.providers.values()].map(registration => this.remove(registration)))
      this.listeners.clear()
    })
  }

  /**
   * Register one recognizer; duplicate ids fail without replacing the original.
   * @param provider - recognizer owned by the contributing fiber.
   * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
   */
  register(provider: SpeechProvider): () => Promise<void> {
    this.lifetime.signal.throwIfAborted()
    if (this.providers.has(provider.info.id)) throw new Error(`Speech provider already registered: ${provider.info.id}`)
    const registration: Registration = { provider, lifetime: new AbortController(), pending: new Set(),
      unsubscribe: provider.preparation?.subscribe(() => { this.changed() }) ?? (() => {}) }
    this.providers.set(provider.info.id, registration)
    this.changed()
    return async () => { await this.remove(registration) }
  }

  private async remove(registration: Registration): Promise<void> {
    if (this.providers.get(registration.provider.info.id) !== registration) return
    this.providers.delete(registration.provider.info.id)
    registration.unsubscribe()
    this.changed()
    registration.lifetime.abort(new Error('Speech provider unloaded'))
    await Promise.allSettled(registration.pending)
  }

  /**
   * Read the current recognizer roster.
   * @returns available provider facts in registration order.
   */
  listProviders(): readonly SpeechProviderInfo[] {
    return [...this.providers.values()].map(({ provider }) => provider.info)
  }

  private changed(): void { for (const listener of this.listeners) listener() }

  /**
   * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
   * @param caller - observer lifetime, independent of any preparation task.
   * @returns an initial snapshot followed by the latest provider states.
   */
  async *follow(caller: AbortSignal): AsyncIterable<SpeechSnapshot> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    let wake = Promise.withResolvers<undefined>()
    let changed = true
    const aborted = (): boolean => signal.aborted
    const notify = (): void => { changed = true; wake.resolve(undefined) }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!changed) await wake.promise
        if (aborted()) break
        wake = Promise.withResolvers<undefined>(); changed = false
        yield this.snapshot()
      }
    } finally {
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /**
   * Read provider readiness and current user preferences together.
   * @returns one detached complete observation.
   */
  snapshot(): SpeechSnapshot {
    return { providers: [...this.providers.values()].map(({ provider }) => ({ ...provider.info,
      preparation: provider.preparation?.snapshot() ?? { phase: 'ready' },
    })), selection: { providerId: this.selection.providerId, language: this.selection.language } }
  }

  /**
   * Persist changed selection fields into this plugin's profile entry; the resulting language must be accepted by the selected provider.
   * @param patch - explicit provider or language changes.
   * @returns after the profile write and the live update it applies.
   */
  async configure(patch: SpeechSelectionPatch): Promise<void> {
    const settings = this.ctx.get('settings')
    const entry = this.entryId
    if (settings === undefined || entry === undefined) throw new Error('Speech selection requires the settings service and a profile entry')
    const id = patch.providerId ?? this.selection.providerId
    const language = patch.language ?? this.selection.language
    this.selectedProvider(id, language)
    await settings.update(entry, { ...patch.providerId === undefined ? {} : { defaultProvider: patch.providerId },
      ...patch.language === undefined ? {} : { language } })
    this.selection = { providerId: id, language }
    this.changed()
  }

  private selectedProvider(id: SpeechProviderId, language: string): SpeechProvider {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    if (!registration.provider.info.languages.includes(language)) {
      throw new Error(`Speech provider ${id} does not support language: ${language}`)
    }
    return registration.provider
  }

  /**
   * Start or join provider-owned preparation.
   * @param id - exact registered provider identity.
   * @param options - task-local source selection validated by the provider.
   */
  prepare(id: SpeechProviderId, options?: SpeechPreparationOptions): void {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    registration.provider.preparation?.prepare(options)
  }

  /**
   * Explicitly cancel provider preparation without tying it to a browser connection.
   * @param id - exact registered provider identity.
   * @returns after the preparation task settles.
   */
  async cancelPreparation(id: SpeechProviderId): Promise<void> {
    const registration = this.providers.get(id)
    if (!registration) throw new Error(`Speech provider is unavailable: ${id}`)
    await registration.provider.preparation?.cancel()
  }

  /**
   * Apply composition defaults and capture the selected provider. Missing providers and unsupported languages fail explicitly.
   * @param request - complete recording and optional selection.
   * @returns provider-pinned input for transcribe().
   */
  resolve(request: SpeechRequest): SpeechSpec {
    const id = request.providerId ?? this.selection.providerId
    const language = request.language ?? this.selection.language
    return { provider: this.selectedProvider(id, language), audio: request.audio, language }
  }

  /**
   * Execute exactly the resolved provider; no fallback sends audio elsewhere.
   * @param spec - resolved input; a withdrawn or replaced registration is rejected.
   * @param signal - caller cancellation.
   * @returns final transcript after provider settlement.
   */
  async transcribe(spec: SpeechSpec, signal: AbortSignal): Promise<Transcript> {
    signal.throwIfAborted()
    const registration = this.providers.get(spec.provider.info.id)
    if (registration?.provider !== spec.provider) throw new Error('Resolved speech provider is no longer registered')
    const combined = AbortSignal.any([signal, registration.lifetime.signal])
    const pending = Promise.resolve().then(() => {
      combined.throwIfAborted()
      return spec.provider.transcribe({ audio: spec.audio, language: spec.language }, combined)
    })
    registration.pending.add(pending)
    try {
      const result = await pending
      combined.throwIfAborted()
      return result
    } finally {
      registration.pending.delete(pending)
    }
  }
}
