/**
 * The face renderer: draws a parsed face.json block by block.
 *
 * The renderer owns the design language (colors, spacing, interaction); a face
 * carries data only. Data blocks fetch through `runVerb` on mount and keep their
 * own loading/error state, while blocks that share one `asset` + `verb` +
 * `params` triple share one bridge call (verb-bridge.md §2). Trigger blocks call
 * the bridge only on a gesture.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RunVerbResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  chartOf,
  formatScalar,
  isDataBlock,
  scalarOf,
  tableOf,
  textOf,
  verbKey,
  verbRequests,
  type ActionButtonBlock,
  type ChartData,
  type DataTableBlock,
  type EmbedBlock,
  type FaceBlock,
  type FaceDataBlock,
  type FaceSpec,
  type FormField,
  type LineChartBlock,
  type LogViewBlock,
  type MetricCardBlock,
  type ParamFormBlock,
  type StatusBadgeBlock,
  type TableData,
  type VerbParams,
} from './spec.ts'
import css from './FaceRenderer.module.css'

/** The ui.assets translate seat this package's components read. */
type Translate = TranslateNS<'ui.assets'>

/** The verb callback this renderer is given (the page's injected adapter). */
export type RunVerbFace = (request: {
  readonly asset: string
  readonly version?: number
  readonly verb: string
  readonly params?: VerbParams
}) => Promise<RunVerbResult>

/** Full renderer props: one face plus the two Remote adapters and the locale seat. */
export interface FaceRendererProps {
  /** Library asset name the face belongs to. */
  readonly asset: string
  /** Resolved version number. */
  readonly version: number
  /** The asset's kind, which selects the default face. */
  readonly kind: string
  /** The parsed face, or null when the version declares none. */
  readonly face: FaceSpec | null
  /** Blocks dropped by the parser, reported so a broken face is visible. */
  readonly skipped: number
  /** Run one verb through the bridge. */
  readonly runVerb: RunVerbFace
  /** Read one version-directory text file (the `embed` block). */
  readonly loadFile: (path: string) => Promise<string>
  readonly t: Translate
}

/** One data request's settled state. */
type VerbState =
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly value: RunVerbResult }
  | { readonly status: 'threw'; readonly message: string }

/**
 * Issue every distinct data request once and report each request's state.
 *
 * The registry lives in component state, so identical requests share one call
 * and each block subscribes to the same entry; a started key is never issued
 * twice, including across a re-render while its call is in flight.
 * @param asset - asset name the requests address.
 * @param version - resolved version number.
 * @param requests - the face's distinct data requests.
 * @param runVerb - the bridge adapter.
 * @returns the settled state per request key (absent while never issued).
 */
function useVerbResults(
  asset: string,
  version: number,
  requests: readonly { readonly key: string; readonly verb: string; readonly params?: VerbParams }[],
  runVerb: RunVerbFace,
): ReadonlyMap<string, VerbState> {
  const [states, setStates] = useState<ReadonlyMap<string, VerbState>>(() => new Map())
  const started = useRef(new Set<string>())
  useEffect(() => {
    let live = true
    const settle = (key: string, state: VerbState): void => {
      if (!live) return
      setStates((current) => {
        const next = new Map(current)
        next.set(key, state)
        return next
      })
    }
    for (const request of requests) {
      if (started.current.has(request.key)) continue
      started.current.add(request.key)
      settle(request.key, { status: 'loading' })
      void runVerb({
        asset,
        version,
        verb: request.verb,
        ...request.params === undefined ? {} : { params: request.params },
      }).then(
        value => { settle(request.key, { status: 'done', value }) },
        (error: unknown) => { settle(request.key, { status: 'threw', message: String(error) }) },
      )
    }
    return () => { live = false }
  }, [asset, version, requests, runVerb])
  return states
}

/** The failure text one block shows, or null while there is none. */
function blockFailure(state: VerbState | undefined, t: Translate): string | null {
  if (state === undefined) return t('blockLoading')
  if (state.status === 'loading') return t('blockLoading')
  if (state.status === 'threw') return t('blockFailed', { message: state.message })
  if (state.value.status !== 'ok') return t('blockFailed', { message: state.value.error ?? '' })
  return null
}

/** One block frame: the optional title above the body. */
function BlockFrame({ title, children }: { readonly title?: string | undefined; readonly children: ReactNode }): ReactNode {
  return (
    <section className={css.block}>
      {title === undefined || title === '' ? null : <h4 className={css.blockTitle}>{title}</h4>}
      {children}
    </section>
  )
}

/** A metric value longer than this, or carrying sentence punctuation, is prose. */
function isProseMetric(text: string): boolean {
  return text.length > 20 || /[，。；、；]/.test(text)
}

/** One metric card (and the same scalar seat a status badge uses). */
function MetricBlock({ block, state, t }: {
  readonly block: MetricCardBlock | StatusBadgeBlock
  readonly state: VerbState | undefined
  readonly t: Translate
}): ReactNode {
  const failure = blockFailure(state, t)
  const scalar = state?.status === 'done'
    ? scalarOf(state.value.result, block.extract, block.type === 'status-badge' ? 'status' : 'numeric')
    : undefined
  const text = failure === null ? formatScalar(scalar, block.type === 'metric-card' ? block.format : undefined) : null
  if (block.type === 'status-badge') {
    return (
      <BlockFrame title={block.title}>
        <span className={css.badge} data-status={text ?? ''} title={failure ?? ''}>
          {failure ?? text ?? t('blockEmpty')}
        </span>
      </BlockFrame>
    )
  }
  // 数字用大字，散文用小字：the big face is reserved for numbers and short
  // tokens; a validation sentence or a description never leaves body size and
  // clamps to two lines, with the full text on hover.
  const prose = text !== null && isProseMetric(text)
  return (
    <BlockFrame title={block.title}>
      <p
        className={prose ? css.metricProse : css.metricValue}
        data-failed={failure === null ? undefined : ''}
        title={prose ? text : undefined}
      >
        {failure ?? text ?? t('blockEmpty')}
      </p>
    </BlockFrame>
  )
}

/** The chart's fixed drawing box; the CSS scales it to the column. */
const CHART = { width: 560, height: 190, pad: 30 } as const

/** One self-drawn SVG line chart. */
function ChartBlock({ block, state, t }: {
  readonly block: LineChartBlock
  readonly state: VerbState | undefined
  readonly t: Translate
}): ReactNode {
  const failure = blockFailure(state, t)
  const chart: ChartData | null = state?.status === 'done'
    ? chartOf(state.value.result, block.x, block.y)
    : null
  return (
    <BlockFrame title={block.title}>
      {failure !== null
        ? <p className={css.message} role="status">{failure}</p>
        : chart === null
          ? <p className={css.message}>{t('blockEmpty')}</p>
          : <LineChartSvg chart={chart} />}
    </BlockFrame>
  )
}

/** Draw one projected series as a polyline with min/max/last axis labels. */
function LineChartSvg({ chart }: { readonly chart: ChartData }): ReactNode {
  const { width, height, pad } = CHART
  const span = chart.max - chart.min
  const plotWidth = width - pad * 2
  const plotHeight = height - pad * 2
  const minX = chart.x.length === 0 ? 0 : Math.min(...chart.x)
  const maxX = chart.x.length === 0 ? 1 : Math.max(...chart.x)
  const points = chart.y.map((value, index) => {
    const ratio = chart.numericX
      ? (maxX === minX ? 0.5 : ((chart.x[index] ?? minX) - minX) / (maxX - minX))
      : (chart.y.length === 1 ? 0.5 : index / (chart.y.length - 1))
    const level = span === 0 ? 0.5 : (value - chart.min) / span
    return {
      x: pad + ratio * plotWidth,
      y: pad + (1 - level) * plotHeight,
    }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const last = chart.xLabels[chart.xLabels.length - 1] ?? ''
  return (
    <svg className={css.chart} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={last}>
      <line x1={pad} y1={pad + plotHeight} x2={pad + plotWidth} y2={pad + plotHeight} className={css.axis} />
      <line x1={pad} y1={pad} x2={pad} y2={pad + plotHeight} className={css.axis} />
      <path d={path} className={css.series} />
      <text x={pad} y={pad - 12} className={css.axisLabel}>{String(chart.max)}</text>
      <text x={pad} y={pad + plotHeight + 18} className={css.axisLabel}>{String(chart.min)}</text>
      <text x={pad} y={pad + plotHeight + 32} className={css.axisLabel}>{chart.xLabels[0] ?? ''}</text>
      <text x={pad + plotWidth} y={pad + plotHeight + 32} className={css.axisLabel} textAnchor="end">{last}</text>
    </svg>
  )
}

/** One data table. */
function TableBlock({ block, state, t }: {
  readonly block: DataTableBlock
  readonly state: VerbState | undefined
  readonly t: Translate
}): ReactNode {
  const failure = blockFailure(state, t)
  const table: (TableData & { readonly totalRows: number }) | null = state?.status === 'done'
    ? tableOf(state.value.result, block.columns, block.max_rows)
    : null
  return (
    <BlockFrame title={block.title}>
      {failure !== null
        ? <p className={css.message} role="status">{failure}</p>
        : table === null || table.rows.length === 0
          ? <p className={css.message}>{t('blockEmpty')}</p>
          : (
            <div className={css.tableWrap}>
              <table className={css.table}>
                <thead>
                  <tr>{table.columns.map(column => <th key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    // A verb result carries no row identity; the row position is
                    // the only stable key a projection can offer.
                    <tr key={String(index)}>
                      {table.columns.map(column => <td key={column}>{cellText(row[column], t('blockEmpty'))}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </BlockFrame>
  )
}

/**
 * Render one table cell: scalars verbatim, anything structured as JSON.
 * @param value - the cell's value from the verb result.
 * @param empty - the placeholder an absent value renders.
 * @returns the cell text.
 */
function cellText(value: unknown, empty: string): string {
  if (value === null || value === undefined) return empty
  if (typeof value === 'object') return JSON.stringify(value)
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) ? value.replace('T', ' ').slice(0, 19) : String(value)
}

/** One text/log block. */
function LogBlock({ block, state, t }: {
  readonly block: LogViewBlock
  readonly state: VerbState | undefined
  readonly t: Translate
}): ReactNode {
  const failure = blockFailure(state, t)
  const text = state?.status === 'done' ? textOf(state.value.result, state.value.stdout) : ''
  return (
    <BlockFrame title={block.title}>
      {failure !== null
        ? <p className={css.message} role="status">{failure}</p>
        : <pre className={css.log}>{text === '' ? t('blockEmpty') : text}</pre>}
    </BlockFrame>
  )
}

/** One triggered-verb run report. */
function RunReport({ outcome, t }: {
  readonly outcome: { readonly status: 'running' } | { readonly status: 'done'; readonly value: RunVerbResult }
  readonly t: Translate
}): ReactNode {
  if (outcome.status === 'running') return <p className={css.message}>{t('runBusy')}</p>
  const value = outcome.value
  if (value.status !== 'ok') {
    return <p className={css.resultError} role="alert">{t('runFailed', { message: value.error ?? '' })}</p>
  }
  const output = textOf(value.result, value.stdout).trim()
  return (
    <div className={css.resultOk}>
      <p className={css.message}>{t('runOk', { duration: value.duration_s.toFixed(2) })}</p>
      {output === '' ? null : (
        <>
          <p className={css.blockTitle}>{t('runOutput')}</p>
          <pre className={css.log}>{output.slice(0, 4000)}</pre>
        </>
      )}
    </div>
  )
}

/** One trigger button. */
function ActionBlock({ block, asset, version, runVerb, t }: {
  readonly block: ActionButtonBlock
  readonly asset: string
  readonly version: number
  readonly runVerb: RunVerbFace
  readonly t: Translate
}): ReactNode {
  const [outcome, setOutcome] = useState<
    { readonly status: 'running' } | { readonly status: 'done'; readonly value: RunVerbResult } | undefined
  >(undefined)
  const run = (): void => {
    if (block.confirm === true && !window.confirm(t('confirmRun', { verb: block.verb }))) return
    setOutcome({ status: 'running' })
    void runVerb({
      asset,
      version,
      verb: block.verb,
      ...block.params === undefined ? {} : { params: block.params },
    }).then(
      value => { setOutcome({ status: 'done', value }) },
      (error: unknown) => {
        setOutcome({
          status: 'done',
          value: {
            status: 'error',
            asset,
            version,
            verb: block.verb,
            duration_s: 0,
            error: String(error),
          },
        })
      },
    )
  }
  return (
    <BlockFrame title={block.title}>
      <>
        <button type="button" className={css.primary} disabled={outcome?.status === 'running'} onClick={run}>
          {outcome?.status === 'running' ? t('runBusy') : `${t('formSubmit')} ${block.verb}`}
        </button>
        {outcome === undefined ? null : <RunReport outcome={outcome} t={t} />}
      </>
    </BlockFrame>
  )
}

/** The starting value of one form field. */
function initialValue(field: FormField): unknown {
  if (field.default !== undefined) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'number') return ''
  if (field.type === 'select') return field.options?.[0] ?? ''
  return ''
}

/** One parameter form. */
function FormBlock({ block, asset, version, runVerb, t }: {
  readonly block: ParamFormBlock
  readonly asset: string
  readonly version: number
  readonly runVerb: RunVerbFace
  readonly t: Translate
}): ReactNode {
  const [values, setValues] = useState<ReadonlyMap<string, unknown>>(
    () => new Map(block.fields.map(field => [field.name, initialValue(field)])),
  )
  const [outcome, setOutcome] = useState<
    { readonly status: 'running' } | { readonly status: 'done'; readonly value: RunVerbResult } | undefined
  >(undefined)
  const set = (name: string, value: unknown): void => {
    setValues((current) => {
      const next = new Map(current)
      next.set(name, value)
      return next
    })
  }
  const submit = (): void => {
    const params: { [key: string]: unknown } = { ...block.params }
    for (const field of block.fields) {
      const value = values.get(field.name)
      if (value === undefined) continue
      // An untouched number field is absent input, not the empty string: the
      // bridge validates parameter types and would reject it.
      if (field.type === 'number' && value === '') continue
      params[field.name] = value
    }
    setOutcome({ status: 'running' })
    void runVerb({ asset, version, verb: block.verb, params: params as VerbParams }).then(
      value => { setOutcome({ status: 'done', value }) },
      (error: unknown) => {
        setOutcome({
          status: 'done',
          value: { status: 'error', asset, version, verb: block.verb, duration_s: 0, error: String(error) },
        })
      },
    )
  }
  return (
    <BlockFrame title={block.title}>
      <>
        <div className={css.form}>
          {block.fields.map((field) => {
            const value = values.get(field.name)
            return (
              <label key={field.name} className={css.formField}>
                <span>{field.label}</span>
                <FieldInput field={field} value={value} onChange={next => { set(field.name, next) }} />
              </label>
            )
          })}
        </div>
        <button type="button" className={css.primary} disabled={outcome?.status === 'running'} onClick={submit}>
          {outcome?.status === 'running' ? t('formBusy') : t('formSubmit')}
        </button>
        {outcome === undefined ? null : <RunReport outcome={outcome} t={t} />}
      </>
    </BlockFrame>
  )
}

/** One form input, chosen by the field's declared type. */
function FieldInput({ field, value, onChange }: {
  readonly field: FormField
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}): ReactNode {
  if (field.type === 'boolean') {
    return <input type="checkbox" checked={value === true} onChange={event => { onChange(event.currentTarget.checked) }} />
  }
  if (field.type === 'select') {
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={event => { onChange(event.currentTarget.value) }}>
        {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(event) => {
          const raw = event.currentTarget.value
          onChange(raw === '' ? '' : Number(raw))
        }}
      />
    )
  }
  return <input value={typeof value === 'string' ? value : ''} onChange={event => { onChange(event.currentTarget.value) }} />
}

/** One embedded version-directory document. */
function EmbedBlockView({ block, loadFile, t }: {
  readonly block: EmbedBlock
  readonly loadFile: (path: string) => Promise<string>
  readonly t: Translate
}): ReactNode {
  const [state, setState] = useState<
    { readonly status: 'loading' } | { readonly status: 'ready'; readonly html: string } | { readonly status: 'failed'; readonly message: string }
  >({ status: 'loading' })
  useEffect(() => {
    let live = true
    void loadFile(block.path).then(
      (html) => { if (live) setState({ status: 'ready', html }) },
      (error: unknown) => { if (live) setState({ status: 'failed', message: String(error) }) },
    )
    return () => { live = false }
  }, [block.path, loadFile])
  return (
    <BlockFrame title={block.title}>
      {state.status === 'loading'
        ? <p className={css.message}>{t('blockLoading')}</p>
        : state.status === 'failed'
          ? <p className={css.message} role="alert">{t('embedFailed', { message: state.message })}</p>
          : (
            // An embedded document is the asset's own content: the sandbox keeps
            // it in an opaque origin, so its scripts cannot reach this page.
            <iframe
              className={css.embed}
              title={block.title ?? t('embedTitle')}
              sandbox="allow-scripts"
              srcDoc={state.html}
            />
          )}
    </BlockFrame>
  )
}

/**
 * The built-in default face of one kind (R5): every asset renders the same
 * skeleton even without a face.json, and no default block dumps raw manifest
 * fields — datasets show their shape and a preview, models their measured
 * summary and file list, reports their body, code its interface and files.
 * @param kind - the asset's manifest kind.
 * @param t - the locale seat.
 * @returns the default face, or null for a kind with no sensible default.
 */
function defaultFace(kind: string, t: Translate): FaceSpec | null {
  switch (kind) {
    case 'dataset':
      return {
        version: 1,
        title: '',
        blocks: [
          { type: 'metric-card', title: t('defaultFaceRows'), verb: 'preview', extract: 'rows' },
          { type: 'data-table', title: t('defaultFacePreview'), verb: 'preview', params: { n: 10 }, max_rows: 10 },
        ],
      }
    case 'model':
    case 'weights':
      return {
        version: 1,
        title: '',
        blocks: [
          { type: 'metric-card', title: t('defaultFaceValidation'), verb: 'preview', extract: 'validation' },
          { type: 'log-view', title: t('defaultFaceFiles'), verb: 'preview' },
        ],
      }
    case 'report':
    case 'chart':
      return {
        version: 1,
        title: '',
        blocks: [
          { type: 'metric-card', title: t('createdLabel'), verb: 'preview', extract: 'created', format: 'date' },
          { type: 'log-view', title: t('defaultFaceText'), verb: 'preview' },
        ],
      }
    case 'code':
      return {
        version: 1,
        title: '',
        blocks: [
          { type: 'metric-card', title: t('defaultFaceInterface'), verb: 'preview', extract: 'interface' },
          { type: 'log-view', title: t('defaultFaceFiles'), verb: 'preview' },
        ],
      }
    default:
      return null
  }
}

/** Render one face block. */
function Block({ block, asset, version, states, runVerb, loadFile, t }: {
  readonly block: FaceBlock
  readonly asset: string
  readonly version: number
  readonly states: ReadonlyMap<string, VerbState>
  readonly runVerb: RunVerbFace
  readonly loadFile: (path: string) => Promise<string>
  readonly t: Translate
}): ReactNode {
  if (!isDataBlock(block)) {
    switch (block.type) {
      case 'action-button': return <ActionBlock block={block} asset={asset} version={version} runVerb={runVerb} t={t} />
      case 'param-form': return <FormBlock block={block} asset={asset} version={version} runVerb={runVerb} t={t} />
      case 'embed': return <EmbedBlockView block={block} loadFile={loadFile} t={t} />
      default: return assertNever(block)
    }
  }
  const state = states.get(blockStateKey(block))
  switch (block.type) {
    case 'metric-card': return <MetricBlock block={block} state={state} t={t} />
    case 'status-badge': return <MetricBlock block={block} state={state} t={t} />
    case 'line-chart': return <ChartBlock block={block} state={state} t={t} />
    case 'data-table': return <TableBlock block={block} state={state} t={t} />
    case 'log-view': return <LogBlock block={block} state={state} t={t} />
    default: return assertNever(block)
  }
}

/** The request key one data block reads: its own verb plus its parameters. */
function blockStateKey(block: FaceDataBlock): string {
  return verbKey(block.verb, block.params)
}

/**
 * The closed block union is exhausted; a value reaching here would mean the
 * discriminant set and the renderer were edited apart.
 * @param value - the unreachable block.
 * @returns never.
 */
function assertNever(value: never): never {
  throw new Error(`face renderer: unhandled block ${JSON.stringify(value)}`)
}

/** Render one asset version's face, or its absence. */
export function FaceRenderer({ asset, version, kind, face, skipped, runVerb, loadFile, t }: FaceRendererProps): ReactNode {
  // An asset without a declared face still gets its kind's default projection
  // over the built-in `preview`, so the page skeleton holds for every asset.
  const resolved = useMemo(
    () => face ?? defaultFace(kind, t),
    [face, kind, t],
  )
  const blocks = resolved?.blocks ?? []
  const requests = useMemo(() => verbRequests(blocks), [blocks])
  const states = useVerbResults(asset, version, requests, runVerb)

  if (resolved === null) {
    return (
      <section className={css.face}>
        <p className={css.blockTitle}>{t('noFaceTitle')}</p>
        <p className={css.message}>{t('noFaceHint')}</p>
      </section>
    )
  }
  // Consecutive scalar cards (metric-card / status-badge) share one row, so a
  // face's headline numbers read as a console strip instead of a stack.
  const rows: { readonly key: string; readonly items: { readonly block: FaceBlock; readonly index: number }[] }[] = []
  blocks.forEach((block, index) => {
    const scalar = block.type === 'metric-card' || block.type === 'status-badge'
    const last = rows[rows.length - 1]
    if (scalar && last !== undefined && last.key === 'scalars') {
      last.items.push({ block, index })
      return
    }
    rows.push({ key: scalar ? 'scalars' : `${block.type}-${String(index)}`, items: [{ block, index }] })
  })
  const renderOne = (block: FaceBlock, index: number): ReactNode => (
    <Block
      key={`${block.type}-${String(index)}`}
      block={block}
      asset={asset}
      version={version}
      states={states}
      runVerb={runVerb}
      loadFile={loadFile}
      t={t}
    />
  )
  return (
    <section className={css.face}>
      {skipped === 0 ? null : <p className={css.message} role="status">{t('faceSkipped', { count: skipped })}</p>}
      {rows.map(row => row.key === 'scalars'
        ? (
          <div key={row.key} className={css.metricRow}>
            {row.items.map(({ block, index }) => renderOne(block, index))}
          </div>
        )
        : row.items.map(({ block, index }) => renderOne(block, index)))}
    </section>
  )
}
