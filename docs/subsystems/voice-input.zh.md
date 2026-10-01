# 语音输入

[English](voice-input.md) | 中文

实验性的语音识别有两个 Host 角色：[服务定义](../../packages/experimental/speech-to-text/README.md) `ctx.speechToText` 路由具名提供方并拥有识别能力，[Remote 消费方](../../packages/experimental/api-speech-to-text/README.md) `ctx.speechController` 服务浏览器。麦克风界面挂在 `conversation.input.activity` 上；识别本身不写入任何 Session 事件，因此最终对模型可见的文本仍由普通的提交动作产生。

## 提供方选择

`SpeechProviderId` 标记注册身份。`SpeechProviderInfo` 携带展示名、可接受的语言提示，以及 host-local 或 cloud 的处理位置。`SpeechRequest` 包含 WAV 字节以及可选的提供方和语言选择；`resolve()` 产出一个绑定到已捕获提供方实例的 `SpeechSpec`，`transcribe()` 只执行该实例。缺少提供方或语言不受支持都会失败；替换或撤销注册会让已解析的工作失效，音频绝不会回退到其他提供方。

## 浏览器与 Host 的归属

浏览器拥有麦克风轨道和未发送的草稿；`TranscriptionRequest` 通过已认证的 Remote 发送规范的 base64 PCM16 WAV。`SpeechCatalog` 公布可用提供方、解析出的默认值，以及录音的字节和时长上限。准备是 Host 拥有的任务：`prepare()` 启动或加入它，`cancelPreparation()` 让它收敛，`follow()` 独立于任何页面生命周期观察就绪状态，因此关闭观察者绝不会取消该工作。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspeechcontroller--speechcontroller"></a>

### `ctx.speechController` — `SpeechController`

Speech calls never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Read provider choices without preparing a recognizer.
 * @returns available providers, resolved default, and recording limits.
 */
@Remote catalog(): SpeechCatalog

/**
 * Follow provider readiness independently of Session and preparation lifetimes.
 * @param signal - Client observation lifetime.
 * @returns initial and subsequent complete readiness snapshots.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<SpeechCatalog>

/**
 * Persist the user's recognition preferences.
 * @param patch - changed preference fields.
 * @returns after preferences are saved.
 */
@Remote configure(patch: SpeechSelectionPatch): Promise<void>

/**
 * Start or join one Host-owned preparation task.
 * @param providerId - selected recognizer.
 * @param options - task-local source selection validated by the provider.
 */
@Remote prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): void

/**
 * Explicitly cancel resource preparation.
 * @param providerId - selected recognizer.
 * @returns after the preparation task settles.
 */
@Remote cancelPreparation(providerId: SpeechProviderId): Promise<void>

/**
 * Validate and transcribe one recording through the explicit provider selection.
 * @param request - canonical WAV encoded as base64, provider id and language hint.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns final transcript without adding a Session event.
 */
@Remote async transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<Transcript>
```

Source: [`packages/experimental/api-speech-to-text/src/index.ts`](../../packages/experimental/api-speech-to-text/src/index.ts)

<a id="ctxspeechtotext--speechtotext"></a>

### `ctx.speechToText` — `SpeechToText`

Registry shared by all transcription consumers in one Host composition.

```ts cordis-catalog
/**
 * Register one recognizer; duplicate ids fail without replacing the original.
 * @param provider - recognizer owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
 */
register(provider: SpeechProvider): () => Promise<void>

/**
 * Read the current recognizer roster.
 * @returns available provider facts in registration order.
 */
listProviders(): readonly SpeechProviderInfo[]

/**
 * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
 * @param caller - observer lifetime, independent of any preparation task.
 * @returns an initial snapshot followed by the latest provider states.
 */
async *follow(caller: AbortSignal): AsyncIterable<SpeechSnapshot>

/**
 * Read provider readiness and current user preferences together.
 * @returns one detached complete observation.
 */
snapshot(): SpeechSnapshot

/**
 * Persist changed selection fields into this plugin's profile entry; the resulting language must be accepted by the selected provider.
 * @param patch - explicit provider or language changes.
 * @returns after the profile write and the live update it applies.
 */
async configure(patch: SpeechSelectionPatch): Promise<void>

/**
 * Start or join provider-owned preparation.
 * @param id - exact registered provider identity.
 * @param options - task-local source selection validated by the provider.
 */
prepare(id: SpeechProviderId, options?: SpeechPreparationOptions): void

/**
 * Explicitly cancel provider preparation without tying it to a browser connection.
 * @param id - exact registered provider identity.
 * @returns after the preparation task settles.
 */
async cancelPreparation(id: SpeechProviderId): Promise<void>

/**
 * Apply composition defaults and capture the selected provider. Missing providers and unsupported languages fail explicitly.
 * @param request - complete recording and optional selection.
 * @returns provider-pinned input for transcribe().
 */
resolve(request: SpeechRequest): SpeechSpec

/**
 * Execute exactly the resolved provider; no fallback sends audio elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns final transcript after provider settlement.
 */
async transcribe(spec: SpeechSpec, signal: AbortSignal): Promise<Transcript>
```

Source: [`packages/experimental/speech-to-text/src/index.ts`](../../packages/experimental/speech-to-text/src/index.ts)
<!-- END GENERATED cordis-surface -->
