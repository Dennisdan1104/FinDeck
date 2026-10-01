/**
 * The lineage view: one self-drawn SVG over the asset snapshot's lineage edges.
 *
 * The graph is a pure projection of the same `assetLibrary()` snapshot the grid
 * reads (R9): no second Remote, no server-side layout. Columns are dependency
 * depth, arrows point from an upstream asset to its consumer, and a click opens
 * that asset's face.
 */

import { useMemo, type ReactNode } from 'react'
import type { AssetLibraryAsset } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { LINEAGE_NODE, lineageLayout } from './library.ts'
import { kindLabel } from './AssetsView.tsx'
import css from '../AssetsPage.module.css'

/** The ui.assets translate seat this package's components read. */
type Translate = TranslateNS<'ui.assets'>

/** Full props of the lineage view. */
export interface LineageGraphProps {
  /** The snapshot's assets. */
  readonly assets: readonly AssetLibraryAsset[]
  /** Open one asset's face. */
  readonly onSelect: (name: string) => void
  readonly t: Translate
}

/** One placed node's box origin in SVG coordinates. */
function boxOf(column: number, row: number): { readonly x: number; readonly y: number } {
  return {
    x: LINEAGE_NODE.margin + column * LINEAGE_NODE.columnGap,
    y: LINEAGE_NODE.margin + row * LINEAGE_NODE.rowGap,
  }
}

/** Shorten one node label to what the fixed-width box can carry. */
function clip(name: string): string {
  return name.length <= 20 ? name : `${name.slice(0, 19)}…`
}

/** Render the lineage graph. */
export function LineageGraph({ assets, onSelect, t }: LineageGraphProps): ReactNode {
  const layout = useMemo(() => lineageLayout(assets), [assets])
  const byName = useMemo(() => new Map(assets.map(asset => [asset.name, asset])), [assets])

  if (assets.length === 0) return <p className={css.status}>{t('emptyGraph')}</p>

  const placed = new Map(layout.placements.map(placement => [placement.name, placement]))
  const width = LINEAGE_NODE.margin * 2 + Math.max(layout.columns - 1, 0) * LINEAGE_NODE.columnGap + LINEAGE_NODE.width
  const height = LINEAGE_NODE.margin * 2 + Math.max(layout.rows - 1, 0) * LINEAGE_NODE.rowGap + LINEAGE_NODE.height

  return (
    <div className={css.graphWrap}>
      <svg
        className={css.graphSvg}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        role="img"
        aria-label={t('tabGraph')}
      >
        <defs>
          <marker id="lineage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--dsw-alias-label-tertiary)" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const from = placed.get(edge.from)
          const to = placed.get(edge.to)
          if (from === undefined || to === undefined) return null
          const source = boxOf(from.column, from.row)
          const target = boxOf(to.column, to.row)
          return (
            <line
              key={`${edge.from}->${edge.to}`}
              x1={source.x + LINEAGE_NODE.width}
              y1={source.y + LINEAGE_NODE.height / 2}
              x2={target.x}
              y2={target.y + LINEAGE_NODE.height / 2}
              className={css.edge}
              markerEnd="url(#lineage-arrow)"
            />
          )
        })}
        {layout.placements.map((placement) => {
          const asset = byName.get(placement.name)
          if (asset === undefined) return null
          const box = boxOf(placement.column, placement.row)
          return (
            <g
              key={placement.name}
              className={css.graphNode}
              data-stale={asset.stale ? 'true' : undefined}
              transform={`translate(${String(box.x)} ${String(box.y)})`}
              role="button"
              tabIndex={0}
              aria-label={asset.name}
              onClick={() => { onSelect(asset.name) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelect(asset.name)
              }}
            >
              <rect width={LINEAGE_NODE.width} height={LINEAGE_NODE.height} rx="8" className={css.nodeBox} />
              <text className={css.nodeLabel} x="10" y="14">{clip(placement.name)}</text>
              <text className={css.nodeKind} x="10" y="27">
                {`${t('version', { version: String(asset.latest_version) })} · ${kindLabel(asset.kind, t)}`}
                {asset.stale ? ` · ${t('graphNodeStale')}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <p className={css.graphLegend}>{t('graphHint')}</p>
    </div>
  )
}
