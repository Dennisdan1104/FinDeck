/**
 * Model-facing memory tools for FinDeck: durable markdown notes the agent
 * writes in one turn and reads back in a later one.
 *
 * Memory has two stores, and they are namespaces rather than one hierarchy:
 * the global store is `<harness home>/memory` (`$DSH_HOME`, else
 * `~/.findeck`) and the project store is the `memory/` directory of the
 * project directory `resolveProjectDir` derives for the workspace that owns
 * the calling session's working directory. A read names its scope explicitly
 * and a miss in that store is reported as a miss — never as a fallback to the
 * other one. An omitted scope on a write means the project store, and a
 * session whose working directory belongs to no workspace has no project store
 * at all, so that default fails loud instead of silently landing in the global
 * store.
 *
 * Every entry is one `<slug>.md` file: a `# <title>` first line, a blank line,
 * then the free-form body. There is no frontmatter, and the file's
 * modification time is the entry's update time.
 *
 * @module @deepseek-ai/dsh-tool-memory
 */

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { projectMemoryDir, resolveProjectDir, type Workspace } from '@deepseek-ai/dsh-workspace'

export const name = 'tool-memory'
export const inject = ['tools']

/** The store an operation addresses. The two stores never fall back to each other. */
type Scope = 'global' | 'project'

/** A `memory_list` store selector: one store, or both. */
type ListScope = Scope | 'all'

/** Model-facing memory tool configuration. */
export interface Config {
  /** Global memory root; defaults to `<harness home>/memory` (`$DSH_HOME`, else `~/.findeck`). */
  readonly globalDir?: string
}

/** Validate and default the memory tool configuration. */
export const Config: z<Config> = z.object({
  globalDir: z.string(),
})

/**
 * The default global memory root, `<harness home>/memory`, under the configured
 * home, `$DSH_HOME`, or the default `~/.findeck`.
 * @returns the absolute global store directory.
 */
function defaultGlobalDir(): string {
  return dshHomePath('memory')
}

/**
 * The workspace-registry surface this plugin reads. The registry is optional: a
 * composition that mounts no workspace service still exposes the global store,
 * and its project store simply does not resolve.
 */
interface WorkspaceLookup {
  /**
   * Every registered workspace.
   * @returns the registry's workspaces in registry order.
   */
  list(): readonly Workspace[]
}

/** One listed entry, carrying the modification time used for ordering as well as its wire value. */
interface ListedEntry {
  readonly slug: string
  readonly title: string
  readonly scope: Scope
  /** ISO-8601 modification time of the entry file, its update time. */
  readonly mtime: string
  /** Modification time in milliseconds, the sort key `mtime` renders. */
  readonly mtimeMs: number
}

/** A stored entry split into its title line and its body. */
interface StoredEntry {
  readonly title: string
  readonly content: string
}

/** Slug grammar; it doubles as the path-traversal guard, admitting no separator or dot. */
const SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u

/** Resolve a path to the spelling path comparison uses; Windows compares case-insensitively. */
function comparablePath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Whether one absolute directory is another or lies below it.
 * @param root - Absolute ancestor candidate.
 * @param cwd - Absolute working directory to place.
 * @returns true when `cwd` is `root` or a descendant of it.
 */
function isWithin(root: string, cwd: string): boolean {
  const rel = relative(comparablePath(root), comparablePath(cwd))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The workspace owning one working directory: the deepest registry path that
 * contains it, so a workspace nested inside another one outranks its parent.
 * @param registry - Workspace registry, absent when the deployment mounts none.
 * @param cwd - Absolute working directory from the calling session's header.
 * @returns the owning workspace, or undefined when no registry path contains it.
 */
function workspaceOf(registry: WorkspaceLookup | undefined, cwd: string): Workspace | undefined {
  if (registry === undefined) return undefined
  let owner: Workspace | undefined
  for (const workspace of registry.list()) {
    if (!isWithin(workspace.path, cwd)) continue
    if (owner === undefined || workspace.path.length > owner.path.length) owner = workspace
  }
  return owner
}

/** Both stores as one call sees them; the project store is absent when no workspace owns the cwd. */
interface MemoryStores {
  /** Absolute global store directory, fixed for the plugin's lifetime. */
  readonly globalDir: string
  /** Absolute project store directory, or undefined when the cwd belongs to no workspace. */
  readonly projectDir: string | undefined
}

/**
 * Resolve both stores for one call. The global store is fixed at apply time;
 * the project store follows the calling session's working directory, so two
 * sessions in different projects never share it.
 * @param ctx - Plugin context, read for the optional workspace registry.
 * @param globalDir - Resolved global store directory.
 * @param cwd - The calling session's working directory, when it reports one.
 * @returns the stores this call can address.
 */
function resolveStores(ctx: Context, globalDir: string, cwd: string | undefined): MemoryStores {
  const registry: WorkspaceLookup | undefined = ctx.get('workspaceRegistry')
  const workspace = cwd === undefined ? undefined : workspaceOf(registry, cwd)
  return {
    globalDir,
    projectDir: workspace === undefined ? undefined : projectMemoryDir(resolveProjectDir(workspace)),
  }
}

/**
 * Resolve the directory one scope addresses.
 * @param stores - Both stores as this call resolved them.
 * @param cwd - The calling session's working directory, for the failure message.
 * @param scope - The scope this call addresses.
 * @param byDefault - Whether the caller omitted `scope`, which decides whether the
 *   failure also names the global escape.
 * @returns the absolute directory of that scope.
 * @throws when the project scope is addressed and no workspace owns the working directory.
 */
function requireDirectory(
  stores: MemoryStores,
  cwd: string | undefined,
  scope: Scope,
  byDefault: boolean,
): string {
  if (scope === 'global') return stores.globalDir
  if (stores.projectDir !== undefined) return stores.projectDir
  const where = cwd === undefined
    ? 'the calling session reports no working directory'
    : `no workspace owns the calling session's working directory "${cwd}"`
  throw new Error(
    `memory scope "project" is unavailable: ${where}`
    + (byDefault ? `; pass scope: "global" to use the global memory store (${stores.globalDir})` : ''),
  )
}

/** Reject a title that cannot be a single `# <title>` line. */
function assertTitle(title: string): void {
  if (title === '') throw new Error('memory title must not be empty')
  if (title.includes('\n')) throw new Error('memory title must be a single line')
}

/**
 * Validate an entry slug. The grammar is also the traversal guard: a slug
 * admits letters, digits, and single hyphens only, so no slug can name another
 * directory or escape the store.
 * @param slug - Candidate slug.
 * @throws when the slug is not kebab-case.
 */
function assertSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`memory slug must be kebab-case (lowercase letters, digits and single hyphens), got "${slug}"`)
  }
}

/**
 * Derive the kebab-case slug of a title: NFKC-normalized, lowercased, with every
 * run of characters that is neither a letter nor a digit collapsed to one
 * hyphen. Non-Latin titles keep their own letters, so a Chinese title yields a
 * readable slug rather than an empty one.
 * @param title - Entry title.
 * @returns the derived slug.
 * @throws when the title holds no letter or digit to derive a slug from.
 */
function slugify(title: string): string {
  const slug = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (slug === '') {
    throw new Error(`cannot derive a slug from title "${title}": it has no letter or digit — pass an explicit slug`)
  }
  return slug
}

/** Serialize one entry as it is stored: a `# <title>` line, a blank line, then the body. */
function serializeEntry(title: string, content: string): string {
  const body = content.trim()
  return body === '' ? `# ${title}\n` : `# ${title}\n\n${body}\n`
}

/**
 * Split one stored file into its title line and body. A file whose first line is
 * not a `# ` heading reports the fallback title, so a hand-written file dropped
 * into the store still lists.
 * @param fallbackTitle - Title to report when the file carries no heading.
 * @param text - Complete file contents.
 * @returns the parsed entry.
 */
function parseEntry(fallbackTitle: string, text: string): StoredEntry {
  const newline = text.indexOf('\n')
  const heading = (newline === -1 ? text : text.slice(0, newline)).trim()
  const title = heading.startsWith('#') ? heading.slice(1).trim() : fallbackTitle
  return { title: title === '' ? fallbackTitle : title, content: newline === -1 ? '' : text.slice(newline + 1).trim() }
}

/**
 * Every `.md` entry of one store, unsorted; an absent directory is an empty
 * store rather than a failure.
 * @param dir - Absolute store directory.
 * @param scope - Store the entries belong to, echoed in each entry.
 * @returns the store's entries.
 */
async function listEntries(dir: string, scope: Scope): Promise<ListedEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    // The readdir is the only statement in the `try`: an absent store directory
    // is the empty listing, and an unlistable one (permissions) reports the
    // same absence, which is what the caller can act on.
    return []
  }
  const entries: ListedEntry[] = []
  for (const fileName of names) {
    if (!fileName.endsWith('.md')) continue
    const file = join(dir, fileName)
    const info = await stat(file)
    if (!info.isFile()) continue
    const slug = fileName.slice(0, -'.md'.length)
    entries.push({
      slug,
      title: parseEntry(slug, await readFile(file, 'utf-8')).title,
      scope,
      mtime: info.mtime.toISOString(),
      mtimeMs: info.mtimeMs,
    })
  }
  return entries
}

/** One entry file's text and modification time; undefined when the store holds no such entry. */
async function readEntryFile(dir: string, slug: string): Promise<{ text: string; mtime: Date } | undefined> {
  const file = join(dir, `${slug}.md`)
  try {
    return await stat(file).then(async info => ({ text: await readFile(file, 'utf-8'), mtime: info.mtime }))
  } catch {
    // The stat-then-read chain is the only statement in the `try`: an absent
    // entry file is the miss the caller reports with the store directory, and
    // any other failure (permissions, a directory in its place) is equally a
    // miss for the same message.
    return undefined
  }
}

/**
 * Write one entry through a temporary file in the same directory, so a crash
 * cannot leave a half-written entry in the store.
 * @param storeDir - Absolute store directory; created when absent.
 * @param slug - Validated entry slug.
 * @param title - Entry title line.
 * @param content - Entry body.
 * @returns the absolute path of the written entry file.
 */
async function writeEntry(storeDir: string, slug: string, title: string, content: string): Promise<string> {
  await mkdir(storeDir, { recursive: true })
  const file = join(storeDir, `${slug}.md`)
  const temporary = `${file}.tmp`
  await writeFile(temporary, serializeEntry(title, content), 'utf-8')
  await rename(temporary, file)
  return file
}

/**
 * Register the three memory tools: `memory_write` upserts one entry in one
 * store, `memory_read` reads one entry from exactly one store, and
 * `memory_list` lists one or both stores newest first.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const globalDir = resolve(config.globalDir ?? defaultGlobalDir())

  ctx.tools.register(defineTool({
    name: 'memory_write',
    description:
      'Write or overwrite one durable memory entry: a titled markdown note you can read back in a later turn '
      + 'or session. `scope` selects the store — "project" (the memory directory of the project that owns this '
      + 'session\'s working directory) or "global" (the user-wide store shared by every project). Omitting '
      + '`scope` uses the project store, and fails loud when this session\'s working directory belongs to no '
      + 'project; it never silently writes globally. Re-running the same slug replaces that entry, and the '
      + 'file\'s modification time becomes its update time.',
    parameters: {
      title: { type: 'string', required: true, description: 'Entry title, one line; also the source of the default slug.' },
      content: { type: 'string', required: true, description: 'Entry body, markdown; replaces any existing body for this slug.' },
      scope: {
        type: 'string',
        enum: ['global', 'project'] satisfies readonly Scope[],
        description: 'Store to write: "project" (default when this session has an owning project) or "global".',
      },
      slug: { type: 'string', description: 'Kebab-case entry id; omit to derive it from the title.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
          path: { type: 'string', required: true },
          scope: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `memory "${value.slug}" written to the ${value.scope} store: ${value.path}`,
      }],
    },
    async execute(args, exec) {
      const title = args.title.trim()
      assertTitle(title)
      const slug = args.slug === undefined ? slugify(title) : args.slug
      assertSlug(slug)
      const cwd = exec.agent?.session.header.cwd
      const stores = resolveStores(ctx, globalDir, cwd)
      const scope: Scope = args.scope ?? 'project'
      const storeDir = requireDirectory(stores, cwd, scope, args.scope === undefined)
      const path = await writeEntry(storeDir, slug, title, args.content)
      return { slug, path, scope }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Write memory ${args.slug ?? args.title}`,
      kind: 'other',
      rawInput: args.title,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_read',
    description:
      'Read one durable memory entry by slug from exactly one store. `scope` is explicit: "project" reads the '
      + 'store of the project that owns this session\'s working directory and "global" the user-wide store. The '
      + 'two stores are separate namespaces, so a slug that exists only in the other store is reported as a miss '
      + 'rather than read from there.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Entry slug, as `memory_list` reports it.' },
      scope: {
        type: 'string',
        required: true,
        enum: ['global', 'project'] satisfies readonly Scope[],
        description: 'Store to read: "project" or "global".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          scope: { type: 'string', required: true },
          path: { type: 'string', required: true },
          mtime: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `memory "${value.slug}" — ${value.title} (${value.scope} store, updated ${value.mtime}):\n\n${value.content}`,
      }],
    },
    async execute(args, exec) {
      assertSlug(args.slug)
      const cwd = exec.agent?.session.header.cwd
      const stores = resolveStores(ctx, globalDir, cwd)
      const storeDir = requireDirectory(stores, cwd, args.scope, false)
      const stored = await readEntryFile(storeDir, args.slug)
      if (stored === undefined) {
        throw new Error(`memory "${args.slug}" is not in the ${args.scope} store (${storeDir})`)
      }
      const entry = parseEntry(args.slug, stored.text)
      return {
        slug: args.slug,
        title: entry.title,
        content: entry.content,
        scope: args.scope,
        path: join(storeDir, `${args.slug}.md`),
        mtime: stored.mtime.toISOString(),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Read memory ${args.slug}`, kind: 'read', rawInput: args.slug }),
    readOnly: true,
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description:
      'List durable memory entries: each entry\'s slug, title, store, and last-updated time, newest first. '
      + '`scope` defaults to "all" (both stores); "project" or "global" lists one store. A session whose working '
      + 'directory belongs to no project has no project store, which this reports as a note instead of failing.',
    parameters: {
      scope: {
        type: 'string',
        enum: ['global', 'project', 'all'] satisfies readonly ListScope[],
        description: 'Stores to list: "all" (default), "project", or "global".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                slug: { type: 'string', required: true },
                title: { type: 'string', required: true },
                scope: { type: 'string', required: true },
                mtime: { type: 'string', required: true },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? `No memory entries in the ${value.scope} store${value.note === undefined ? '' : ` — ${value.note}`}.`
          : [
            `Memory entries (${value.scope}), newest first:`,
            ...value.entries.map(entry =>
              `- [${entry.scope}] \`${entry.slug}\`: ${entry.title} (updated ${entry.mtime})`,
            ),
            ...(value.note === undefined ? [] : ['', value.note]),
          ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const requested: ListScope = args.scope ?? 'all'
      const cwd = exec.agent?.session.header.cwd
      const stores = resolveStores(ctx, globalDir, cwd)
      const scopes: readonly Scope[] = requested === 'all' ? ['global', 'project'] : [requested]
      const entries: ListedEntry[] = []
      for (const scope of scopes) {
        if (scope === 'global') {
          entries.push(...await listEntries(stores.globalDir, 'global'))
          continue
        }
        if (stores.projectDir !== undefined) entries.push(...await listEntries(stores.projectDir, 'project'))
      }
      const sorted = entries.sort((left, right) => right.mtimeMs - left.mtimeMs || left.slug.localeCompare(right.slug))
      const note = stores.projectDir !== undefined || !scopes.includes('project')
        ? undefined
        : cwd === undefined
          ? 'the calling session reports no working directory, so no project store is available'
          : `no workspace owns the calling session's working directory "${cwd}", so no project store is available`
      return {
        scope: requested,
        entries: sorted.map(({ slug, title, scope, mtime }) => ({ slug, title, scope, mtime })),
        ...(note === undefined ? {} : { note }),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List memory', kind: 'read', rawInput: '' }),
    readOnly: true,
  }))
}
