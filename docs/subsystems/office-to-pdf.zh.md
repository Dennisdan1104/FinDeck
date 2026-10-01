# Office 转 PDF

[English](office-to-pdf.md) | 中文

Host 侧的 Office 转换，由 [`office-to-pdf` 包](../../packages/document/office-to-pdf/README.zh.md)拥有：该提供方通过独立发布的 LibreOffice 工具包把 DOC、DOCX、XLS、XLSX、PPT 和 PPTX 源文件转换为完整 PDF 字节，目标平台声明了原生引擎时用原生引擎，否则用工具包的 WASM 引擎。进程内调用方把 `OfficeToPdfRequest` 交给 `ctx.officeToPdf.convert()`；浏览器客户端用 Session 文件作用域、Office 路径和优先级调用 `officeToPdf.render` Remote 方法，取回携带源路径、源版本、缺失字体族和转换代的 `RenderedDocumentBytes`。Remote 渲染通过 `workspaceFiles` 完成读取授权，并通过 `fs` 读取源字节；`convert()` 不需要这两个服务。`officeToPdf.generation` 报告当前的提供方生命周期，使客户端可以丢弃在渲染、字体或引擎配置被替换后生成的 PDF。

该提供方不追加 Session 事件，也不添加任何模型可见内容。配置、队列准入、缓存保留与引擎打包见[包 README](../../packages/document/office-to-pdf/README.zh.md)和[配置目录](../config-catalog.zh.md#deepseek-aidsh-office-to-pdf)。

源码：[`packages/document/office-to-pdf/src/types.ts`](../../packages/document/office-to-pdf/src/types.ts)、[`packages/document/office-to-pdf/src/identity.ts`](../../packages/document/office-to-pdf/src/identity.ts)、[`packages/document/office-to-pdf/src/index.ts`](../../packages/document/office-to-pdf/src/index.ts)

## `OfficeExtension`：可转换的源格式

```ts type-equiv
/** Binary Office and Office Open XML formats supported by Office-to-PDF conversion. */
type OfficeExtension = 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx'
```

## `OfficeToPdfPriority`：单次转换的调度类别

```ts type-equiv
/** Foreground previews and explicit QA precede speculative background conversion. */
type OfficeToPdfPriority = 'foreground' | 'background'
```

## `OfficeToPdfRequest`：一次已授权的转换

```ts type-equiv
/** Source authorization and metadata lookup must finish before submitting a request. */
interface OfficeToPdfRequest {
  readonly extension: OfficeExtension
  readonly priority: OfficeToPdfPriority
  readonly source: {
    readonly key: OfficeSourceKey
    readonly version: string
    /** Authorized stat size; omission reserves the provider's entire input limit. */
    readonly bytes?: number
    /**
     * Read only after provider admission; do not capture already-buffered input in queued production requests.
     * @param signal - shared conversion lifetime, independent of an individual reader.
     * @param maxBytes - reserved source capacity; read at most this plus one overflow sentinel byte.
     * @returns owned bytes and the actual read version; a changed version rejects conversion.
     */
    read(signal: AbortSignal, maxBytes: number): Promise<{ readonly bytes: Uint8Array; readonly version: string }>
  }
}
```

## `OfficeToPdfResult`：一次成功的转换

```ts type-equiv
/** Successful conversion; failed and interrupted conversions reject instead. */
interface OfficeToPdfResult {
  /** Caller-owned complete PDF, valid after provider disposal. */
  readonly pdf: Uint8Array
  /** Requested OOXML font families unavailable to this conversion; binary Office formats return an empty list. */
  readonly missingFonts: string[]
  readonly cacheKey: OfficeToPdfKey
  readonly generation: OfficeToPdfGeneration
}
```

## `OfficeToPdfErrorCode`：分类后的转换失败

```ts type-equiv
/** Failures a conversion consumer can present without exposing engine diagnostics. */
type OfficeToPdfErrorCode =
  | 'input-too-large' | 'output-too-large' | 'invalid-document' | 'unsupported-format'
  | 'invalid-output' | 'timeout' | 'unavailable' | 'failed' | 'busy' | 'source-changed'
```

## `RenderedDocumentBytes`：带源身份的一次渲染结果

```ts type-equiv
/** PDF content carries the original Office file's absolute path and version. */
interface RenderedDocumentBytes extends WorkspaceFileBytes {
  readonly missingFonts: string[]
  readonly generation: OfficeToPdfGeneration
}
```

## `OfficeSourceKey`：已授权的源定位符

```ts type-equiv
/** Authorized execution scope and canonical source path, encoded by the consumer. */
type OfficeSourceKey = Branded<'OfficeSourceKey'>
```

## `OfficeToPdfKey`：转换器持有的内容身份

```ts type-equiv
/** Provider generation and source-content digest; consumers must not parse it. */
type OfficeToPdfKey = Branded<'OfficeToPdfKey'>
```

## `OfficeToPdfGeneration`：一个提供方生命周期

```ts type-equiv
/** One provider lifetime, including its engine, rendering settings, and font configuration. */
type OfficeToPdfGeneration = Branded<'OfficeToPdfGeneration'>
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxofficetopdf--officetopdf"></a>

### `ctx.officeToPdf` — `OfficeToPdf`

A provider lifetime owns all converters, queued calls, and temporary files.

```ts cordis-catalog
/**
 * Convert Office bytes without modifying the source or writing Session events.
 * @param request - authorized metadata and deferred bounded source read.
 * @param signal - caller cancellation; provider disposal also stops active work.
 * @returns caller-owned PDF bytes after conversion and scratch cleanup settle; canceled readers reject independently.
 * @throws {OfficeToPdfError} Invalid input, unusable output, or engine failure; cancellation rejects with its reason.
 */
convert(request: OfficeToPdfRequest, signal?: AbortSignal): Promise<OfficeToPdfResult>

/**
 * Read and convert one Office file using the Session's ordinary filesystem authorization.
 * @param workspaceFileScope - Session header lookup shared with workspaceFiles.
 * @param path - absolute or workspace-relative Office path.
 * @param priority - foreground preview or speculative background work.
 * @param signal - Remote cancellation; disposal also cancels outstanding reads and conversions.
 * @returns complete PDF bytes with original source identity and missing font families.
 */
@Remote async render( workspaceFileScope: WorkspaceFileScope, path: string, priority: OfficeToPdfPriority, signal: AbortSignal, ): Promise<RenderedDocumentBytes>

/**
 * Read the current rendering generation before reusing a Client PDF.
 * @param signal - Remote caller cancellation.
 * @returns provider lifetime, replaced with rendering, font, or engine configuration.
 */
@Remote('generation') getGeneration(signal: AbortSignal): OfficeToPdfGeneration
```

Types: [WorkspaceFileScope](workspace.zh.md)

Source: [`packages/document/office-to-pdf/src/index.ts`](../../packages/document/office-to-pdf/src/index.ts)
<!-- END GENERATED cordis-surface -->
