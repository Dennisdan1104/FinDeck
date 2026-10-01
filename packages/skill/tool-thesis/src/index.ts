/**
 * Model-facing tools over the thesis registry: register testable conclusions
 * from finished reports, list due/failed ones, show one thesis's complete
 * recheck history, and record recheck outcomes so a running hit/miss score
 * accumulates.
 *
 * Each thesis is one YAML manifest under `<thesesDir>/<id>.yaml`, next to the
 * asset library's own manifests. Status is derived from the check history
 * (open until the first check), and the score is computed over every check in
 * the registry. Scheduled recheck tasks and the research-asset page's report
 * cards consume the same files: the tools are the only writer besides a human
 * editor.
 *
 * @module @deepseek-ai/dsh-tool-thesis
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import type {
  ThesisCheck,
  ThesisManifest,
  ThesisScore,
  ThesisStatus,
} from './types.ts'

export type * from './types.ts'

export const name = 'tool-thesis'
export const inject = ['tools']

/**
 * The default thesis-registry root, `<harness home>/asset-library/theses`, under
 * the configured home, `$DSH_HOME`, or the default `~/.findeck`.
 * @returns the absolute default registry root.
 */
function defaultThesesDir(): string {
  return dshHomePath('asset-library', 'theses')
}

/** Model-facing thesis-registry tool configuration. */
export interface Config {
  /** Thesis registry root; defaults to `<harness home>/asset-library/theses` (`$DSH_HOME`, else `~/.findeck`). */
  readonly thesesDir?: string
}

/** Validate and default the thesis-registry tool configuration. */
export const Config: z<Config> = z.object({
  thesesDir: z.string(),
})

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function thesisPath(thesesDir: string, id: string): string {
  return join(thesesDir, `${id}.yaml`)
}

/** Validate a thesis id; the pattern doubles as the traversal guard. */
function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`thesis id must be kebab-case (lowercase letters, digits and hyphens), got "${id}"`)
  }
}

/** Validate a `YYYY-MM-DD` string is a real calendar date, not just a pattern match. */
function assertDueDate(value: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`due_date must be YYYY-MM-DD, got "${value}"`)
  }
  const parts = value.split('-').map(Number)
  const year = parts[0]
  const month = parts[1]
  const day = parts[2]
  /* v8 ignore next 3 -- DATE_PATTERN admits exactly two dashes, so split('-') always has three parts */
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`due_date must be YYYY-MM-DD, got "${value}"`)
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) {
    throw new Error(`due_date is not a real calendar date: "${value}"`)
  }
}

/** Parse one manifest YAML; malformed content fails loud rather than silently skipping the thesis. */
function parseManifest(fileId: string, text: string): ThesisManifest {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    /* v8 ignore next -- a YAML error entry is an Error, whose message is always a string */
    throw new Error(`thesis "${fileId}" is not valid YAML: ${doc.errors[0]?.message ?? 'unknown parse error'}`)
  }
  const data = doc.toJS() as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) {
    throw new Error(`thesis "${fileId}" must be a YAML mapping`)
  }
  const stringField = (key: string): string => {
    const value = data[key]
    if (typeof value !== 'string' || value === '') {
      throw new Error(`thesis "${fileId}" field "${key}" must be a non-empty string`)
    }
    return value
  }
  const id = stringField('id')
  if (id !== fileId) throw new Error(`thesis "${fileId}" declares a different id: "${id}"`)
  const assets = data.assets
  if (!Array.isArray(assets)) throw new Error(`thesis "${id}" field "assets" must be an array`)
  const rawChecks = data.checks ?? []
  if (!Array.isArray(rawChecks)) throw new Error(`thesis "${id}" field "checks" must be an array`)
  const checks: ThesisCheck[] = []
  for (const raw of rawChecks) {
    const check = raw as Record<string, unknown> | null
    if (typeof check !== 'object' || check === null) throw new Error(`thesis "${id}" has a malformed check entry`)
    const outcome = check.outcome
    if (outcome !== 'hit' && outcome !== 'miss') throw new Error(`thesis "${id}" check outcome must be hit or miss`)
    if (typeof check.checked_at !== 'string' || typeof check.evidence !== 'string') {
      throw new Error(`thesis "${id}" check must carry checked_at and evidence`)
    }
    checks.push({ checkedAt: check.checked_at, outcome, evidence: check.evidence })
  }
  return {
    id,
    conclusion: stringField('conclusion'),
    metric: stringField('metric'),
    threshold: stringField('threshold'),
    dueDate: stringField('due_date'),
    report: stringField('report'),
    assets: assets.filter((asset): asset is string => typeof asset === 'string'),
    createdAt: stringField('created_at'),
    checks,
  }
}

/**
 * Serialize one manifest with stable field order. Hand-written rather than
 * `yaml` stringify: the record is small, `yaml` would quote strings as plain
 * scalars and reorder nothing, but its output style churns between versions —
 * a hand-written mapping stays byte-stable for the same manifest.
 */
function serializeManifest(manifest: ThesisManifest): string {
  const entries: [string, string | number | boolean | readonly unknown[]][] = [
    ['id', manifest.id],
    ['conclusion', manifest.conclusion],
    ['metric', manifest.metric],
    ['threshold', manifest.threshold],
    ['due_date', manifest.dueDate],
    ['report', manifest.report],
    ['assets', manifest.assets],
    ['created_at', manifest.createdAt],
  ]
  if (manifest.checks.length > 0) {
    entries.push(['checks', manifest.checks.map(check => ({
      checked_at: check.checkedAt,
      outcome: check.outcome,
      evidence: check.evidence,
    }))])
  }
  const lines: string[] = []
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
      } else if (value.every(item => typeof item === 'object' && item !== null)) {
        lines.push(`${key}:`)
        for (const item of value) {
          /* v8 ignore next -- parseManifest rejects non-string check fields, so every entry value is a string */
          const fields = Object.entries(item as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
            .join(', ')
          lines.push(`  - { ${fields} }`)
        }
      } else {
        /* v8 ignore next -- parseManifest filters assets to strings and thesis_write validates them as strings */
        lines.push(`${key}: [${value.map(item => typeof item === 'string' ? JSON.stringify(item) : String(item)).join(', ')}]`)
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Read one thesis manifest; an absent file reports absence, unreadable content fails. */
async function readThesis(thesesDir: string, id: string): Promise<ThesisManifest | undefined> {
  let text: string
  try {
    text = await readFile(thesisPath(thesesDir, id), 'utf-8')
  } catch {
    return undefined
  }
  return parseManifest(id, text)
}

/** Every thesis manifest, sorted by due date then id; an absent registry is empty. */
async function listTheses(thesesDir: string): Promise<ThesisManifest[]> {
  let names: string[]
  try {
    names = await readdir(thesesDir)
  } catch {
    return []
  }
  const manifests: ThesisManifest[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.yaml')) continue
    const id = name.slice(0, -'.yaml'.length)
    manifests.push(parseManifest(id, await readFile(join(thesesDir, name), 'utf-8')))
  }
  return manifests.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))
}

/** Derived status: no checks yet is open; the newest check decides the rest. */
function statusOf(manifest: ThesisManifest): ThesisStatus {
  const last = manifest.checks.at(-1)
  return last === undefined ? 'open' : last.outcome
}

/** Whether the due date passed with no check dated at or after it. */
function overdueOf(manifest: ThesisManifest): boolean {
  if (manifest.checks.some(check => check.checkedAt.slice(0, 10) >= manifest.dueDate)) return false
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return manifest.dueDate < today
}

function scoreOf(manifests: readonly ThesisManifest[]): ThesisScore {
  let hits = 0
  let misses = 0
  for (const manifest of manifests) {
    for (const check of manifest.checks) {
      if (check.outcome === 'hit') hits += 1
      else misses += 1
    }
  }
  return { hits, misses, hitRate: hits + misses === 0 ? null : hits / (hits + misses) }
}

/** Atomic write: the tmp file keeps a crash from leaving a half-written manifest. */
async function writeThesis(thesesDir: string, manifest: ThesisManifest): Promise<void> {
  assertId(manifest.id)
  await mkdir(thesesDir, { recursive: true })
  const file = thesisPath(thesesDir, manifest.id)
  const tmp = `${file}.tmp`
  await writeFile(tmp, serializeManifest(manifest), 'utf-8')
  await rename(tmp, file)
}

/** The snake_case wire view the declared output schema requires. */
function toSummaryWire(manifest: ThesisManifest): {
  id: string
  conclusion: string
  metric: string
  threshold: string
  due_date: string
  report: string
  assets: string[]
  status: ThesisStatus
  overdue: boolean
  check_count: number
} {
  return {
    id: manifest.id,
    conclusion: manifest.conclusion,
    metric: manifest.metric,
    threshold: manifest.threshold,
    due_date: manifest.dueDate,
    report: manifest.report,
    assets: [...manifest.assets],
    status: statusOf(manifest),
    overdue: overdueOf(manifest),
    check_count: manifest.checks.length,
  }
}

/**
 * Register the four thesis tools. `thesis_list` returns the registry with
 * derived status, `thesis_show` returns one thesis with its complete check
 * history, `thesis_write` upserts one manifest, and `thesis_mark` records one
 * recheck outcome.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const thesesDir = resolve(config.thesesDir ?? defaultThesesDir())

  ctx.tools.register(defineTool({
    name: 'thesis_list',
    description: 'List the registered theses (tracked, testable conclusions from past reports): each entry shows its conclusion, metric, threshold, due date, status (open/hit/miss), and whether it is overdue. Includes the registry\'s running hit/miss score.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          score: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              hits: { type: 'number', required: true },
              misses: { type: 'number', required: true },
              hit_rate: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
            },
          },
          theses: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                conclusion: { type: 'string', required: true },
                metric: { type: 'string', required: true },
                threshold: { type: 'string', required: true },
                due_date: { type: 'string', required: true },
                report: { type: 'string', required: true },
                assets: { type: 'array', required: true, items: { type: 'string' } },
                status: { type: 'string', required: true },
                overdue: { type: 'boolean', required: true },
                check_count: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderList(value.score, value.theses),
      }],
    },
    async execute() {
      const manifests = await listTheses(thesesDir)
      return {
        dir: thesesDir,
        score: scoreToWire(scoreOf(manifests)),
        theses: manifests.map(toSummaryWire),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List theses', kind: 'read', rawInput: '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'thesis_show',
    description:
      'Show one tracked thesis in full: its conclusion, metric, threshold, and due date, plus the COMPLETE '
      + 'recheck history — every check\'s date, hit/miss outcome, and evidence — and this thesis\'s own '
      + 'hit/miss score. Use it before rechecking (what did earlier rechecks measure?) or when writing a '
      + 'follow-up report that cites the thesis\'s track record.',
    parameters: {
      id: { type: 'string', required: true, description: 'Thesis id from `thesis_list`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          thesis: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              conclusion: { type: 'string', required: true },
              metric: { type: 'string', required: true },
              threshold: { type: 'string', required: true },
              due_date: { type: 'string', required: true },
              report: { type: 'string', required: true },
              assets: { type: 'array', required: true, items: { type: 'string' } },
              created_at: { type: 'string', required: true },
              status: { type: 'string', required: true },
              overdue: { type: 'boolean', required: true },
              checks: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    checked_at: { type: 'string', required: true },
                    outcome: { type: 'string', required: true },
                    evidence: { type: 'string', required: true },
                  },
                },
              },
              score: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  hits: { type: 'number', required: true },
                  misses: { type: 'number', required: true },
                  hit_rate: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `thesis "${value.thesis.id}" (${value.thesis.status}${value.thesis.overdue ? ', OVERDUE' : ''}, due ${value.thesis.due_date}): ${value.thesis.conclusion}`,
          `metric: ${value.thesis.metric} | threshold: ${value.thesis.threshold} | report: ${value.thesis.report}`,
          ...(value.thesis.assets.length > 0 ? [`assets: ${value.thesis.assets.join(', ')}`] : []),
          value.thesis.checks.length === 0
            ? 'no rechecks recorded yet'
            : [
              `rechecks (${String(value.thesis.checks.length)}), this thesis hit/miss ${String(value.thesis.score.hits)}/${String(value.thesis.score.misses)}:`,
              ...value.thesis.checks.map(check => `- ${check.checked_at.slice(0, 10)} [${check.outcome}] ${check.evidence}`),
            ].join('\n'),
        ].join('\n'),
      }],
    },
    async execute(args) {
      assertId(args.id)
      const manifest = await readThesis(thesesDir, args.id)
      if (manifest === undefined) throw new Error(`thesis "${args.id}" is not registered — call thesis_write first`)
      const hits = manifest.checks.filter(check => check.outcome === 'hit').length
      const misses = manifest.checks.length - hits
      return {
        dir: thesesDir,
        thesis: {
          ...toSummaryWire(manifest),
          created_at: manifest.createdAt,
          checks: manifest.checks.map(check => ({
            checked_at: check.checkedAt,
            outcome: check.outcome,
            evidence: check.evidence,
          })),
          score: scoreToWire({ hits, misses, hitRate: hits + misses === 0 ? null : hits / (hits + misses) }),
        },
      }
    },
    presentCall: args => ({ card: 'generic', title: `Show thesis ${args.id}`, kind: 'read', rawInput: args.id }),
  }))

  ctx.tools.register(defineTool({
    name: 'thesis_write',
    description: 'Register or update one tracked thesis: a testable conclusion from a completed report, plus its evaluation metric, threshold, due date, source report path, and optional related asset names. Upsert: re-running an existing id updates the stated fields and keeps the check history.',
    parameters: {
      id: { type: 'string', required: true, description: 'Kebab-case id; re-running the same id updates the existing thesis.' },
      conclusion: { type: 'string', required: true, description: 'The testable conclusion, one sentence.' },
      metric: { type: 'string', required: true, description: 'The measure that decides the outcome.' },
      threshold: { type: 'string', required: true, description: 'The bar that separates hit from miss.' },
      due_date: { type: 'string', required: true, description: 'Recheck due date, YYYY-MM-DD.' },
      report: { type: 'string', required: true, description: 'Workspace-relative path of the report stating this conclusion.' },
      assets: { type: 'array', items: { type: 'string' }, description: 'Names of related archived assets; optional.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          due_date: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `thesis "${value.id}" registered (status: ${value.status}, due ${value.due_date})`,
      }],
    },
    async execute(args) {
      assertId(args.id)
      assertDueDate(args.due_date)
      const existing = await readThesis(thesesDir, args.id)
      const manifest: ThesisManifest = {
        id: args.id,
        conclusion: args.conclusion,
        metric: args.metric,
        threshold: args.threshold,
        dueDate: args.due_date,
        report: args.report,
        assets: (args.assets ?? []).filter(asset => asset !== ''),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        checks: existing?.checks ?? [],
      }
      await writeThesis(thesesDir, manifest)
      return { dir: thesesDir, id: args.id, status: statusOf(manifest), due_date: args.due_date }
    },
    presentCall: args => ({ card: 'generic', title: `Write thesis ${args.id}`, kind: 'edit', rawInput: args.id }),
  }))

  ctx.tools.register(defineTool({
    name: 'thesis_mark',
    description: 'Record one recheck outcome for a thesis: `hit` or `miss` and the evidence. Appends to the check history, derives the new status, and returns the registry score. Use when a recheck deadline arrives (scheduled task or user request) and the evidence is real data, not an assumption.',
    parameters: {
      id: { type: 'string', required: true, description: 'Thesis id from `thesis_list`.' },
      outcome: { type: 'string', required: true, description: 'hit or miss.' },
      evidence: { type: 'string', required: true, description: 'What the recheck actually measured (dates, values, source).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          check_count: { type: 'number', required: true },
          score: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              hits: { type: 'number', required: true },
              misses: { type: 'number', required: true },
              hit_rate: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `thesis "${value.id}" → ${value.status} (checks: ${String(value.check_count)}); score hit/miss ${String(value.score.hits)}/${String(value.score.misses)} (hit rate ${value.score.hit_rate === null ? 'n/a' : `${(value.score.hit_rate * 100).toFixed(1)}%`})`,
      }],
    },
    async execute(args) {
      assertId(args.id)
      if (args.outcome !== 'hit' && args.outcome !== 'miss') {
        throw new Error(`outcome must be "hit" or "miss", got "${args.outcome}"`)
      }
      if (args.evidence.trim() === '') throw new Error('evidence must not be empty — record what the recheck actually measured')
      const manifest = await readThesis(thesesDir, args.id)
      if (manifest === undefined) throw new Error(`thesis "${args.id}" is not registered — call thesis_write first`)
      await writeThesis(thesesDir, {
        ...manifest,
        checks: [...manifest.checks, {
          checkedAt: new Date().toISOString(),
          outcome: args.outcome,
          evidence: args.evidence,
        }],
      })
      const all = await listTheses(thesesDir)
      const updated = all.find(candidate => candidate.id === args.id)
      const score = scoreOf(all)
      return {
        id: args.id,
        /* v8 ignore next -- listTheses re-reads the directory writeThesis just renamed into, so the id is always listed */
        status: statusOf(updated ?? manifest),
        /* v8 ignore next -- the same listing makes the write count equal the stored check history */
        check_count: updated === undefined ? manifest.checks.length + 1 : updated.checks.length,
        score: scoreToWire(score),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Mark thesis ${args.id}`, kind: 'other', rawInput: args.id }),
  }))
}

function scoreToWire(score: ThesisScore): { hits: number; misses: number; hit_rate: number | null } {
  return {
    hits: score.hits,
    misses: score.misses,
    hit_rate: score.hitRate === null ? null : Number(score.hitRate.toFixed(4)),
  }
}

type RenderThesis = {
  id: string
  conclusion: string
  metric: string
  threshold: string
  due_date: string
  report: string
  status: string
  overdue: boolean
}

function renderList(
  score: { hits: number; misses: number; hit_rate: number | null },
  theses: readonly RenderThesis[],
): string {
  const scoreLine = score.hit_rate === null
    ? `no checks yet (hit/miss: ${String(score.hits)}/${String(score.misses)})`
    : `hit/miss: ${String(score.hits)}/${String(score.misses)} · hit rate ${(score.hit_rate * 100).toFixed(1)}%`
  if (theses.length === 0) {
    return `Thesis registry is empty. Register testable conclusions from finished reports with thesis_write. (${scoreLine})`
  }
  return [
    `Tracked theses (${scoreLine}):`,
    ...theses.map(thesis =>
      `- \`${thesis.id}\`: ${thesis.conclusion} [metric: ${thesis.metric}, threshold: ${thesis.threshold}, due: ${thesis.due_date}, status: ${thesis.status}${thesis.overdue ? ', OVERDUE' : ''}, report: ${thesis.report}]`,
    ),
  ].join('\n')
}
