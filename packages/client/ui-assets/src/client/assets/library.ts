/**
 * Asset-hub projections over one `assetLibrary` snapshot: filtering, ordering,
 * and the lineage graph's edges and layers. Pure functions with no React and no
 * locale — the page's components and the standalone verification script share
 * them.
 */

import type { AssetLibraryAsset } from '@deepseek-ai/dsh-api-remotes/client'

/** The grid/list filter the page holds. */
export interface LibraryFilter {
  /** Kind to keep, or empty for every kind. */
  readonly kind: string
  /** Origin to keep, or empty for every origin. */
  readonly origin: string
  /** Tag to keep, or empty for every tag. */
  readonly tag: string
  /** Case-insensitive substring; empty keeps every asset. */
  readonly text: string
}

/** An empty filter: every asset passes. */
export const NO_FILTER: LibraryFilter = { kind: '', origin: '', tag: '', text: '' }

/** The list view's sort keys. */
export type LibrarySort = 'name' | 'as_of'

/** The asset's own currency date, or the empty string when it declares none. */
export function asOfOf(asset: AssetLibraryAsset): string {
  return asset.freshness?.as_of ?? ''
}

/** The distinct values of one string-list field, sorted, for a filter's options. */
function distinct(values: readonly (readonly string[])[]): readonly string[] {
  const out = new Set<string>()
  for (const list of values) for (const value of list) out.add(value)
  return [...out].sort((left, right) => left.localeCompare(right))
}

/** Every kind the snapshot contains. */
export function libraryKinds(assets: readonly AssetLibraryAsset[]): readonly string[] {
  return distinct(assets.map(asset => [asset.kind]))
}

/** Every origin the snapshot contains. */
export function libraryOrigins(assets: readonly AssetLibraryAsset[]): readonly string[] {
  return distinct(assets.map(asset => [asset.origin]))
}

/** Every tag the snapshot contains. */
export function libraryTags(assets: readonly AssetLibraryAsset[]): readonly string[] {
  return distinct(assets.map(asset => asset.tags))
}

/** Whether one asset carries the filter's substring in its identity fields. */
function matchesText(asset: AssetLibraryAsset, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (needle === '') return true
  return [asset.name, asset.description, asset.kind, asset.origin, ...asset.tags, ...asset.verbs]
    .some(field => field.toLowerCase().includes(needle))
}

/**
 * Apply the grid/list filter.
 * @param assets - the snapshot's assets.
 * @param filter - the page's filter.
 * @returns the assets that pass every stated condition, in input order.
 */
export function filterAssets(
  assets: readonly AssetLibraryAsset[],
  filter: LibraryFilter,
): readonly AssetLibraryAsset[] {
  return assets.filter(asset =>
    (filter.kind === '' || asset.kind === filter.kind)
    && (filter.origin === '' || asset.origin === filter.origin)
    && (filter.tag === '' || asset.tags.includes(filter.tag))
    && matchesText(asset, filter.text))
}

/**
 * Order the grid/list assets.
 * @param assets - the filtered assets.
 * @param by - `name` or the freshness `as_of` date.
 * @param descending - reverse the order.
 * @returns a new ordered array; assets without an `as_of` sort last in both directions.
 */
export function sortAssets(
  assets: readonly AssetLibraryAsset[],
  by: LibrarySort,
  descending: boolean,
): readonly AssetLibraryAsset[] {
  const sign = descending ? -1 : 1
  const ranked = [...assets]
  ranked.sort((left, right) => {
    if (by === 'as_of') {
      const leftDate = asOfOf(left)
      const rightDate = asOfOf(right)
      // An undeclared date is absent data, not the earliest date: it stays at
      // the end whichever way the declared dates run.
      if (leftDate === '' || rightDate === '') {
        if (leftDate === rightDate) return left.name.localeCompare(right.name)
        return leftDate === '' ? 1 : -1
      }
      const order = leftDate === rightDate ? 0 : leftDate < rightDate ? -1 : 1
      return order === 0 ? left.name.localeCompare(right.name) : order * sign
    }
    return left.name.localeCompare(right.name) * sign
  })
  return ranked
}

/** One node of the lineage projection: what a snapshot entry contributes. */
export interface LineageNode {
  readonly name: string
  /** Upstream asset names the manifest declares. */
  readonly depends_on: readonly string[]
  /** The wider lineage declaration, when the caller has one (a version manifest). */
  readonly lineage?: { readonly inputs?: readonly string[] } | null
}

/** One directed lineage edge: `from` is consumed by `to`. */
export interface LineageEdge {
  readonly from: string
  readonly to: string
}

/**
 * Project the lineage edges of one snapshot.
 *
 * The upstream set is `depends_on` ∪ `lineage.inputs`: `archive()` keeps the two
 * equal (it backfills `depends_on` from `inputs` and refuses a mismatch), so the
 * union is the snapshot's own declaration rather than an extra read. A
 * self-dependency (the incremental-refresh shape) and an edge naming an asset
 * outside the library draw nothing.
 * @param nodes - the snapshot's assets.
 * @returns the distinct edges, in node order.
 */
export function lineageEdges(nodes: readonly LineageNode[]): readonly LineageEdge[] {
  const known = new Set(nodes.map(node => node.name))
  const edges: LineageEdge[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    for (const upstream of new Set([...node.depends_on, ...(node.lineage?.inputs ?? [])])) {
      if (upstream === node.name || !known.has(upstream)) continue
      const key = `${upstream}\u0000${node.name}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: upstream, to: node.name })
    }
  }
  return edges
}

/** One placed graph node: its asset name and the column/row it occupies. */
export interface LineagePlacement {
  readonly name: string
  readonly column: number
  readonly row: number
}

/** One lineage layout: the placements, the edge list, and the drawing extent. */
export interface LineageLayout {
  readonly placements: readonly LineagePlacement[]
  readonly edges: readonly LineageEdge[]
  /** Column count. */
  readonly columns: number
  /** Widest column's node count. */
  readonly rows: number
}

/** Node box geometry shared by layout and drawing. */
export const LINEAGE_NODE = { width: 148, height: 34, columnGap: 210, rowGap: 54, margin: 14 } as const

/**
 * Place the lineage graph in dependency-depth columns: a node with no upstream
 * sits leftmost, and a node's column is one past the deepest upstream it has.
 * @param nodes - the snapshot's assets.
 * @returns the placements, the edges, and the extent the SVG must cover.
 */
export function lineageLayout(nodes: readonly LineageNode[]): LineageLayout {
  const edges = lineageEdges(nodes)
  const upstream = new Map<string, readonly string[]>()
  for (const node of nodes) {
    upstream.set(node.name, edges.filter(edge => edge.to === node.name).map(edge => edge.from))
  }
  const depthOf = (name: string, seen: readonly string[]): number => {
    if (seen.includes(name)) return 0
    const parents = upstream.get(name) ?? []
    if (parents.length === 0) return 0
    return 1 + Math.max(...parents.map(parent => depthOf(parent, [...seen, name])))
  }
  const columns = new Map<number, readonly string[]>()
  for (const node of nodes) {
    const depth = depthOf(node.name, [])
    columns.set(depth, [...columns.get(depth) ?? [], node.name])
  }
  const placements: LineagePlacement[] = []
  let widest = 0
  for (const [column, names] of [...columns.entries()].sort((left, right) => left[0] - right[0])) {
    names.forEach((name, row) => { placements.push({ name, column, row }) })
    widest = Math.max(widest, names.length)
  }
  return { placements, edges, columns: columns.size, rows: widest }
}

/** The upstream names one asset declares, for the detail view's lineage line. */
export function lineageInputsOf(asset: {
  readonly depends_on: readonly string[]
  readonly lineage?: { readonly inputs?: readonly string[] } | null
}): readonly string[] {
  return [...new Set([...asset.depends_on, ...(asset.lineage?.inputs ?? [])])]
}

/** The freshness tone a status badge or a card dot paints: green / amber / grey / undeclared. */
export type FreshnessTone = 'fresh' | 'due' | 'stale' | 'none'

/** Days one update-frequency word spans; an unknown word reads as monthly. */
function periodDays(frequency: string | undefined): number {
  switch (frequency) {
    case 'daily': return 1
    case 'weekly': return 7
    case 'monthly': return 31
    case 'quarterly': return 92
    default: return 31
  }
}

/**
 * Judge one asset's freshness for display. The server's `stale` verdict is
 * authoritative for the expired state; a live asset within the last quarter of
 * its update period shows as due-soon. `today` is injectable for determinism.
 * @param asset - the snapshot entry.
 * @param today - the reference date; defaults to now.
 * @returns the tone the UI paints.
 */
export function freshnessTone(
  asset: { readonly stale: boolean; readonly freshness: AssetLibraryAsset['freshness'] },
  today: Date = new Date(),
): FreshnessTone {
  if (asset.stale) return 'stale'
  const freshness = asset.freshness
  if (freshness === null || freshness.as_of === '') return 'none'
  const asOf = Date.parse(freshness.as_of)
  if (Number.isNaN(asOf)) return 'none'
  const period = periodDays(freshness.update_frequency)
  const remaining = (asOf + period * 86_400_000 - today.getTime()) / 86_400_000
  return remaining <= Math.max(1, period * 0.25) ? 'due' : 'fresh'
}

/** The card's primary verb: the most action-like declared verb, else the first. */
export function primaryVerbOf(verbs: readonly string[]): string | null {
  if (verbs.length === 0) return null
  for (const preferred of ['predict', 'update', 'run', 'retrain', 'summary', 'preview']) {
    if (verbs.includes(preferred)) return preferred
  }
  return verbs[0] ?? null
}

/** One card key metric: a label plus a short value, both display-ready. */
export interface KeyMetric {
  /**
   * Dictionary key the caller translates to name this metric; null means
   * `label` is already display text (a metric name parsed from validation).
   */
  readonly labelKey: 'asOfLabel' | 'reportDateLabel' | null
  readonly label: string
  readonly value: string
}

/** One `key=value` number in a validation line, e.g. `RankIC=0.0206`. */
const METRIC_PAIR = /([A-Za-z][A-Za-z0-9_.]*)\s*=\s*(-?\d+(?:\.\d+)?)/u
/** One ISO date anywhere in prose. */
const ISO_DATE = /\d{4}-\d{2}-\d{2}/u

/**
 * Pick the one key metric a grid card shows, by kind: a dataset shows its
 * as-of date, a model shows the first measured number in its validation line,
 * a report shows its date. Nothing is invented: when the manifest carries no
 * extractable metric the card shows none rather than padding with prose.
 * @param asset - the snapshot entry.
 * @returns the metric, or null when none is extractable.
 */
export function keyMetricOf(asset: AssetLibraryAsset): KeyMetric | null {
  if (asset.kind === 'dataset') {
    const asOf = asOfOf(asset)
    return asOf === '' ? null : { labelKey: 'asOfLabel', label: '', value: asOf }
  }
  if (asset.kind === 'model' || asset.kind === 'weights') {
    const pair = METRIC_PAIR.exec(asset.validation)
    return pair === null ? null : { labelKey: null, label: pair[1] ?? '', value: pair[2] ?? '' }
  }
  if (asset.kind === 'report' || asset.kind === 'chart') {
    const day = ISO_DATE.exec(asset.validation)?.[0] ?? ISO_DATE.exec(asset.description)?.[0]
    return day === undefined ? null : { labelKey: 'reportDateLabel', label: '', value: day }
  }
  return null
}
