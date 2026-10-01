/**
 * Typed shape of the FinDeck asset-library `index.json`, written by
 * `findeck.assets` (Python) and read by this plugin. The file is a durable
 * on-disk boundary, so parsing validates defensively: an unreadable index is
 * reported as such, never silently treated as a different library. Index
 * version `2` adds `origin`, `verbs`, `freshness`, `lineage`, `tags`, and
 * `face` to every asset summary and extends the kind vocabulary; version `1`
 * entries omit those fields and are read with their documented defaults.
 *
 * @module dsh-tool-asset-library/types
 */

/** Kinds the library archives: a trained model, a reusable code module, weights, a dataset, a chart, or a report. */
export type AssetKind = 'model' | 'code' | 'weights' | 'dataset' | 'chart' | 'report'

/** Who introduced one asset into the library: an agent session, the user, or an external import. */
export type AssetOrigin = 'agent' | 'user' | 'imported'

/**
 * Freshness of one asset: the moment its measurements are valid for, plus the
 * cadence at which its owner expects it to be refreshed.
 */
export interface AssetFreshness {
  /** ISO-8601 timestamp the asset's data was measured at. */
  readonly as_of: string
  /** Expected refresh cadence as free text, e.g. `daily`; absent when unknown. */
  readonly update_frequency?: string
}

/** The run that produced one asset: its script, parameters, and originating session. */
export interface AssetProducer {
  /** Path of the producing script as archived beside the asset. */
  readonly script?: string
  /** Parameters the producing run was invoked with. */
  readonly params?: Record<string, unknown>
  /** Id of the session the producing run belonged to. */
  readonly session?: string
}

/**
 * How one asset was produced: the optional producing run and the names of the
 * inputs it was derived from.
 */
export interface AssetLineage {
  /** The run that produced this asset; absent when the library does not know it. */
  readonly producer?: AssetProducer
  /** Names of the assets or raw inputs this asset was derived from. */
  readonly inputs?: readonly string[]
}

/** One asset manifest exactly as archived (`manifest.yaml` fields). */
export interface AssetManifest {
  readonly name: string
  readonly kind: AssetKind
  readonly version: number
  readonly created: string
  readonly source_session: string
  readonly description: string
  /** Input/output contract: a function signature or model input shape. */
  readonly interface: string
  readonly dependencies: readonly string[]
  /** Names of other assets this one depends on. */
  readonly depends_on: readonly string[]
  /** `name@vN` of the version this one supersedes, or null. */
  readonly supersedes: string | null
  /** Validation metrics and data range measured at archive time. */
  readonly validation: string
  /** Who introduced this asset; absent on version-1 manifests. */
  readonly origin?: AssetOrigin
  /** Verbs this asset declares it can perform; absent on version-1 manifests. */
  readonly verbs?: readonly string[]
  /** How current the asset's inputs are; absent on version-1 manifests. */
  readonly freshness?: AssetFreshness | null
  /** How this asset was produced; absent on version-1 manifests. */
  readonly lineage?: AssetLineage | null
  /** Free-form retrieval tags; absent on version-1 manifests. */
  readonly tags?: readonly string[]
  /**
   * Version-directory-relative path of this asset's `face.json`, the
   * visualization description its UI renders; `null` when the asset declares
   * no face and absent on version-1 manifests.
   */
  readonly face?: string | null
}

/** One archived version of an asset. */
export interface AssetVersion {
  readonly version: number
  readonly manifest: AssetManifest
}

/** Summary of one asset as listed in the library index. */
export interface AssetSummary {
  readonly name: string
  readonly kind: AssetKind
  readonly latest_version: number
  readonly description: string
  readonly validation: string
  readonly depends_on: readonly string[]
  readonly versions: readonly AssetVersion[]
  /** Who introduced this asset; `null` when the library does not record it, absent on version-1 entries. */
  readonly origin?: AssetOrigin | null
  /** Verbs this asset declares it can perform; `[]` on version-1 entries. */
  readonly verbs?: readonly string[]
  /** How current the asset's inputs are; `null` when the library does not record it. */
  readonly freshness?: AssetFreshness | null
  /** How this asset was produced; `null` when the library does not record it. */
  readonly lineage?: AssetLineage | null
  /** Free-form retrieval tags; `[]` on version-1 entries. */
  readonly tags?: readonly string[]
  /**
   * Version-directory-relative path of the latest version's `face.json`;
   * `null` when the asset declares no face and absent on version-1 entries.
   */
  readonly face?: string | null
}

/** Whole-library index (`index.json` beside the human-readable `index.md`). */
export interface AssetLibraryIndex {
  /** Index format version; `1` and `2` are readable. */
  readonly version: number
  readonly updated: string
  readonly assets: readonly AssetSummary[]
}
