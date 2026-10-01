/** Durable thesis records for tracked-prediction rechecking. */

/** Outcome of one thesis recheck: the prediction hit or missed. */
export type ThesisOutcome = 'hit' | 'miss'

/** One recorded recheck: when, which outcome, and the evidence text. */
export interface ThesisCheck {
  readonly checkedAt: string
  readonly outcome: ThesisOutcome
  readonly evidence: string
}

/**
 * Durable thesis manifest, one YAML file under `<thesesDir>/<id>.yaml`.
 * Ownership of the fields and the `theses/` directory convention lives here,
 * mirroring the asset library's `manifest.yaml` discipline: every field the
 * model records must be honestly derived from executed data, never invented.
 */
export interface ThesisManifest {
  /** Machine id, kebab-case, unique across the thesis registry. */
  readonly id: string
  /** The testable conclusion (命题内容). */
  readonly conclusion: string
  /** The measure that decides the outcome (检验指标), e.g. "茅台前复权区间收益". */
  readonly metric: string
  /** The pass/fail bar, e.g. "≥ +5% 相对沪深300". */
  readonly threshold: string
  /** Recheck due date, `YYYY-MM-DD`. */
  readonly dueDate: string
  /** The report that states this conclusion, workspace-relative path. */
  readonly report: string
  /** Names of related archived assets (asset library), empty when none. */
  readonly assets: readonly string[]
  /** Creation timestamp, ISO 8601. */
  readonly createdAt: string
  /** Recheck history, newest last. */
  readonly checks: readonly ThesisCheck[]
}

/** Derived lifecycle state of one thesis: nothing checked yet, or the latest outcome. */
export type ThesisStatus = 'open' | 'hit' | 'miss'

/** One thesis as the model sees it, with the derived status and running hit-rate facts. */
export interface ThesisSummary {
  readonly id: string
  readonly conclusion: string
  readonly metric: string
  readonly threshold: string
  readonly dueDate: string
  readonly report: string
  readonly assets: readonly string[]
  readonly status: ThesisStatus
  /** True when the due date has passed and no check exists at or after it. */
  readonly overdue: boolean
  readonly checkCount: number
}

/** Registry-level hit/miss tallies across every thesis. */
export interface ThesisScore {
  readonly hits: number
  readonly misses: number
  /** hits / (hits + misses); null when nothing has been checked yet. */
  readonly hitRate: number | null
}
