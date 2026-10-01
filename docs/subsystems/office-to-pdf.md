# Office to PDF

English | [中文](office-to-pdf.zh.md)

Host Office conversion, owned by the [`office-to-pdf` package](../../packages/document/office-to-pdf/README.md): the provider converts DOC, DOCX, XLS, XLSX, PPT, and PPTX sources into complete PDF bytes through the independently published LibreOffice kit, using the declared native engine where the target has one and the kit's WASM engine elsewhere. In-process callers submit an `OfficeToPdfRequest` to `ctx.officeToPdf.convert()`; browser clients call the `officeToPdf.render` Remote method with a Session file scope, an Office path, and a priority, and receive `RenderedDocumentBytes` carrying the source path, its version, the missing font families, and the conversion generation. Remote rendering authorizes the read through `workspaceFiles` and reads source bytes through `fs`; `convert()` requires neither service. `officeToPdf.generation` reports the current provider lifetime so a client can discard PDFs rendered under a replaced rendering, font, or engine configuration.

The provider appends no Session events and adds nothing model-visible. Configuration, queue admission, cache retention, and engine packaging are on the [package README](../../packages/document/office-to-pdf/README.md) and in the [configuration catalog](../config-catalog.md#deepseek-aidsh-office-to-pdf).

Sources: [`packages/document/office-to-pdf/src/types.ts`](../../packages/document/office-to-pdf/src/types.ts), [`packages/document/office-to-pdf/src/identity.ts`](../../packages/document/office-to-pdf/src/identity.ts), [`packages/document/office-to-pdf/src/index.ts`](../../packages/document/office-to-pdf/src/index.ts)

## `OfficeExtension` — a convertible source format

```ts type-equiv
/** Binary Office and Office Open XML formats supported by Office-to-PDF conversion. */
type OfficeExtension = 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx'
```

## `OfficeToPdfPriority` — scheduling class of one conversion

```ts type-equiv
/** Foreground previews and explicit QA precede speculative background conversion. */
type OfficeToPdfPriority = 'foreground' | 'background'
```

## `OfficeToPdfRequest` — one authorized conversion

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

## `OfficeToPdfResult` — one successful conversion

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

## `OfficeToPdfErrorCode` — classified conversion failure

```ts type-equiv
/** Failures a conversion consumer can present without exposing engine diagnostics. */
type OfficeToPdfErrorCode =
  | 'input-too-large' | 'output-too-large' | 'invalid-document' | 'unsupported-format'
  | 'invalid-output' | 'timeout' | 'unavailable' | 'failed' | 'busy' | 'source-changed'
```

## `RenderedDocumentBytes` — one rendered PDF with its source identity

```ts type-equiv
/** PDF content carries the original Office file's absolute path and version. */
interface RenderedDocumentBytes extends WorkspaceFileBytes {
  readonly missingFonts: string[]
  readonly generation: OfficeToPdfGeneration
}
```

## `OfficeSourceKey` — authorized source locator

```ts type-equiv
/** Authorized execution scope and canonical source path, encoded by the consumer. */
type OfficeSourceKey = Branded<'OfficeSourceKey'>
```

## `OfficeToPdfKey` — converter-owned content identity

```ts type-equiv
/** Provider generation and source-content digest; consumers must not parse it. */
type OfficeToPdfKey = Branded<'OfficeToPdfKey'>
```

## `OfficeToPdfGeneration` — one provider lifetime

```ts type-equiv
/** One provider lifetime, including its engine, rendering settings, and font configuration. */
type OfficeToPdfGeneration = Branded<'OfficeToPdfGeneration'>
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [WorkspaceFileScope](workspace.md)

Source: [`packages/document/office-to-pdf/src/index.ts`](../../packages/document/office-to-pdf/src/index.ts)
<!-- END GENERATED cordis-surface -->
