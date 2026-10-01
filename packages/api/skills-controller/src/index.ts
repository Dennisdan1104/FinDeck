/**
 * Host Remote owner for skill administration over the `ctx.skills` registry:
 * the complete inventory across the global layer and every preset's standing
 * layer, the durable disable list that suppresses skills from every consumer,
 * and the manual rescan that drops the registry's cached catalogs.
 *
 * The disable list is the namespace's only durable state. Registering the
 * namespace and applying its current value is one unit: the settings service
 * holds the stored section, and every committed change flows back through the
 * registry's own filter.
 *
 * @module @deepseek-ai/dsh-api-skills-controller
 */

import { access, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
// Type-only: resolves the `agentPresets` Context augmentation this controller reads.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: resolves the `sessionPersistence` Context augmentation the forge flow reads.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { isSkillName, type SkillSummary } from '@deepseek-ai/dsh-skill'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  SkillAdminEntry, SkillDetail, SkillExternalRoot, SkillExternalSkill,
  SkillForgeRequest, SkillForgeResult, SkillGalleryEntry, SkillSaveRequest,
} from './types.ts'

export type * from './types.ts'

/** Settings namespace owning the durable skill disable list. */
export const SKILLS_SETTINGS_NAMESPACE = 'skills'

/**
 * The shipped preset the forge session is composed from: the work mode whose
 * flow walks transcript reading, distillation, the user interview, drafting,
 * and the write. It lives beside the seed prompt because both are the forge
 * handoff's own contract, not a deployment choice.
 */
const FORGE_AGENT_PRESET = 'skill-forge'

const settingsNamespaceRequestSchema: Schema<SkillAdminSettings> = z.object({
  disabled: z.array(z.string()).default([]),
})

/** Durable skill-administration section. */
export interface SkillAdminSettings {
  /** Skill names suppressed from every registry read. */
  readonly disabled: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `skillsAdmin` Remote namespace. */
    skillsAdmin: SkillsController
  }
}

/**
 * Host service backing the generated `ctx.remote.skillsAdmin` namespace. Every
 * method answers with the whole inventory, so one round trip leaves the page
 * consistent: a toggle and a rescan each return the state their change
 * produced rather than a delta the caller has to fold.
 */
export class SkillsController extends TypertRemoteService {
  /** The namespace owner scope, absent until the settings service is composed. */
  private settingsScope: SettingsScope<SkillAdminSettings> | undefined

  /**
   * Register the `skillsAdmin` namespace, then register the durable disable
   * list once the settings and skill services are both present. The child
   * fiber owns the namespace registration and the registry filter together, so
   * losing either service leaves neither behind.
   * @param ctx - Host context carrying the skill registry and, optionally, a settings provider.
   */
  constructor(ctx: Context) {
    super(ctx, 'skillsAdmin', { namespace: 'skillsAdmin' })
    ctx.inject(['settings', 'skills'], (scoped) => {
      const scope = scoped.settings.register(SKILLS_SETTINGS_NAMESPACE, settingsNamespaceRequestSchema, {
        base: { disabled: [] },
      })
      this.settingsScope = scope
      scoped.effect(() => {
        const apply = (disabled: readonly string[]): void => { scoped.skills.setDisabled(disabled) }
        apply(scope.get().disabled)
        const unwatch = scope.watch(next => { apply(next.disabled) })
        return () => {
          unwatch()
          this.settingsScope = undefined
          scoped.skills.setDisabled([])
        }
      }, 'skills-controller: disabled skill filter')
    })
  }

  /**
   * List every discovered skill, suppressed ones included.
   * @returns name-sorted inventory entries across the global layer and every preset's standing layer.
   * @throws RemoteError when this deployment mounts no skill registry.
   */
  @Remote
  async list(): Promise<SkillAdminEntry[]> {
    return await this.inventory()
  }

  /**
   * Store one skill's suppressed state in the durable disable list.
   * @param name - kebab-case skill name the disable list stores.
   * @param disabled - whether the skill becomes hidden from every consumer.
   * @returns the inventory after the write.
   * @throws RemoteError when the name is malformed, no settings provider is mounted, or the provider refuses the write.
   */
  @Remote
  async setDisabled(name: string, disabled: boolean): Promise<SkillAdminEntry[]> {
    if (!isSkillName(name)) {
      throw new RemoteError('skills/invalid-name', `"${name}" is not a valid skill name`, { name })
    }
    const scope = this.settingsScope
    if (scope === undefined) {
      throw new RemoteError(
        'skills/rejected',
        'settings service is absent: this deployment does not mount a settings provider to store the skill disable list',
        {},
      )
    }
    const next = new Set(scope.get().disabled)
    if (disabled) next.add(name)
    else next.delete(name)
    try {
      await scope.update({ disabled: [...next].sort(compareNames) })
    } catch (error: unknown) {
      throw new RemoteError('skills/rejected', `skill disable list write failed: ${messageOf(error)}`, { name })
    }
    return await this.inventory()
  }

  /**
   * Drop the registry's cached catalogs so the next read runs provider
   * discovery again — the manual rescan for skill roots a deployment adds
   * without a watcher.
   * @returns the rediscovered inventory.
   * @throws RemoteError when this deployment mounts no skill registry.
   */
  @Remote
  async reload(): Promise<SkillAdminEntry[]> {
    this.registry().reload()
    return await this.inventory()
  }

  /**
   * Load one skill's editable document: the frontmatter fields and the
   * Markdown body. File-backed skills are read from disk so an edit preserves
   * frontmatter fields this surface does not render; a provider without a
   * file answers its loaded body as read-only.
   * @param name - skill to load.
   * @returns the document plus its writability.
   * @throws RemoteError when the name is unknown (`skills/not-found`) or the
   *   registry is absent.
   */
  @Remote
  async read(name: string): Promise<SkillDetail> {
    const entry = (await this.inventory()).find(candidate => candidate.name === name)
    if (entry === undefined) {
      throw new RemoteError('skills/not-found', `no discovered skill is named "${name}"`, { name })
    }
    const file = entry.directory === undefined ? undefined : await skillFileOf(entry.directory, entry.name)
    if (file !== undefined) {
      let parsed
      try {
        parsed = parseSkillDocument(await readFile(file, 'utf8'))
      } catch (error: unknown) {
        throw new RemoteError('skills/io', `reading ${file} failed: ${messageOf(error)}`, { path: file })
      }
      return {
        name: entry.name,
        description: parsed.description,
        whenToUse: parsed.whenToUse,
        content: parsed.content,
        source: entry.source,
        provider: entry.provider,
        ...entry.directory === undefined ? {} : { directory: entry.directory },
        writable: this.isWritableDirectory(entry.directory),
        disabled: entry.disabled,
      }
    }
    let content = ''
    if (!entry.disabled) {
      try {
        content = (await this.registry().get(name))?.content ?? ''
      } catch (error: unknown) {
        this.ctx.logger.warn(`skills-controller: body load for "${name}" failed: ${messageOf(error)}`)
      }
    }
    return {
      name: entry.name, description: entry.description, whenToUse: '', content,
      source: entry.source, provider: entry.provider,
      ...entry.directory === undefined ? {} : { directory: entry.directory },
      writable: false, disabled: entry.disabled,
    }
  }

  /**
   * Create a skill in the user skills root (`$DSH_HOME/skills/<name>/SKILL.md`).
   * @param request - frontmatter fields and the Markdown body.
   * @returns the inventory after the write and rescan.
   * @throws RemoteError when the name is malformed (`skills/invalid-name`),
   *   already discovered (`skills/conflict`), or the write fails (`skills/io`).
   */
  @Remote
  async create(request: SkillSaveRequest): Promise<SkillAdminEntry[]> {
    const { name, description, content } = validateSaveRequest(request)
    if ((await this.inventory()).some(candidate => candidate.name === name)) {
      throw new RemoteError('skills/conflict', `a skill named "${name}" already exists`, { name })
    }
    const directory = join(this.userSkillsDir(), name)
    if (await pathExists(directory)) {
      throw new RemoteError('skills/conflict', `directory ${directory} already exists`, { name })
    }
    await this.writeDocument(directory, {
      name, description, ...request.whenToUse === undefined || request.whenToUse.trim() === ''
        ? {}
        : { whenToUse: request.whenToUse },
    }, content)
    this.registry().reload()
    return await this.inventory()
  }

  /**
   * Rewrite one user skill's document, preserving frontmatter fields this
   * surface does not edit. Only skills under a user skills root are writable.
   * @param request - the skill name plus the new field values and body.
   * @returns the inventory after the write and rescan.
   * @throws RemoteError when the skill is unknown (`skills/not-found`), lives
   *   outside the user roots (`skills/read-only`), or the write fails.
   */
  @Remote
  async update(request: SkillSaveRequest): Promise<SkillAdminEntry[]> {
    const { name, description, content } = validateSaveRequest(request)
    const entry = (await this.inventory()).find(candidate => candidate.name === name)
    if (entry === undefined) {
      throw new RemoteError('skills/not-found', `no discovered skill is named "${name}"`, { name })
    }
    if (!this.isWritableDirectory(entry.directory)) {
      throw new RemoteError(
        'skills/read-only',
        `skill "${name}" is owned by provider "${entry.provider}" outside the user skills roots; edit it at its source`,
        { name },
      )
    }
    const file = await skillFileOf(entry.directory as string, name)
    if (file === undefined) {
      throw new RemoteError('skills/not-found', `no SKILL.md or ${name}.md exists under ${entry.directory}`, { name })
    }
    let frontmatter: Record<string, unknown>
    try {
      frontmatter = parseSkillDocument(await readFile(file, 'utf8')).frontmatter
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `reading ${file} failed: ${messageOf(error)}`, { path: file })
    }
    frontmatter.name = name
    frontmatter.description = description
    const whenToUse = request.whenToUse?.trim() ?? ''
    if (whenToUse === '') delete frontmatter.whenToUse
    else frontmatter.whenToUse = whenToUse
    await writeDocumentFile(file, frontmatter, content)
    this.registry().reload()
    return await this.inventory()
  }

  /**
   * Permanently delete one user skill's directory (or flat Markdown file).
   * Only skills under a user skills root are removable.
   *
   * Named `deleteSkill` rather than `remove` because the browser's Remote
   * namespace service owns `remove(kind, method, token)` for its own method
   * ledger; a Remote method of that name fails every namespace mount at once.
   * @param name - skill to remove.
   * @returns the inventory after the removal and rescan.
   * @throws RemoteError when the skill is unknown or lives outside the user roots.
   */
  @Remote
  async deleteSkill(name: string): Promise<SkillAdminEntry[]> {
    if (!isSkillName(name)) {
      throw new RemoteError('skills/invalid-name', `"${name}" is not a valid skill name`, { name })
    }
    const entry = (await this.inventory()).find(candidate => candidate.name === name)
    if (entry === undefined) {
      throw new RemoteError('skills/not-found', `no discovered skill is named "${name}"`, { name })
    }
    if (!this.isWritableDirectory(entry.directory)) {
      throw new RemoteError(
        'skills/read-only',
        `skill "${name}" is owned by provider "${entry.provider}" outside the user skills roots; remove it at its source`,
        { name },
      )
    }
    const directory = entry.directory as string
    const bundle = join(directory, 'SKILL.md')
    try {
      if (await pathExists(bundle)) await rm(directory, { recursive: true, force: true })
      else await rm(join(directory, `${name}.md`), { force: true })
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `removing skill "${name}" failed: ${messageOf(error)}`, { path: directory })
    }
    this.registry().reload()
    return await this.inventory()
  }

  /**
   * Scan the known skills roots of other agents (Claude Code, Codex) for
   * skills this deployment has not discovered. Roots that do not exist are
   * omitted rather than reported as empty.
   * @returns one entry per existing external root with its importable skills.
   */
  @Remote
  async external(): Promise<SkillExternalRoot[]> {
    const roots: { label: string; path: string }[] = [
      { label: 'Claude Code', path: join(homedir(), '.claude', 'skills') },
      { label: 'Codex', path: join(homedir(), '.codex', 'skills') },
    ]
    const result: SkillExternalRoot[] = []
    for (const root of roots) {
      const skills = await scanExternalRoot(root.path)
      if (skills !== undefined) result.push({ label: root.label, path: root.path, skills })
    }
    return result
  }

  /**
   * Copy one external skill (a directory holding SKILL.md, or one Markdown
   * file) into the user skills root and rescan.
   * @param path - absolute source path from `external()` or typed by the user.
   * @returns the inventory after the copy and rescan.
   * @throws RemoteError when the source is not a readable skill, the target
   *   name is occupied (`skills/conflict`), or the copy fails (`skills/io`).
   */
  @Remote
  async importExternal(path: string): Promise<SkillAdminEntry[]> {
    if (!isAbsolute(path)) {
      throw new RemoteError('skills/invalid-name', `import path "${path}" is not absolute`, { name: path })
    }
    const source = resolve(path)
    const userRoot = this.userSkillsDir()
    if (source === userRoot || source.startsWith(userRoot + sep)) {
      throw new RemoteError('skills/conflict', `${source} already lives in the user skills root`, { name: source })
    }
    const bundleFile = join(source, 'SKILL.md')
    const isBundle = await pathExists(bundleFile)
    const skillFile = isBundle ? bundleFile : source
    let parsed
    try {
      parsed = parseSkillDocument(await readFile(skillFile, 'utf8'))
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `reading ${skillFile} failed: ${messageOf(error)}`, { path: skillFile })
    }
    const name = parsed.name
    if (!isSkillName(name)) {
      throw new RemoteError('skills/invalid-name', `frontmatter name "${name}" is not a valid skill name`, { name })
    }
    const target = join(userRoot, name)
    if (await pathExists(target) || (await this.inventory()).some(candidate => candidate.name === name)) {
      throw new RemoteError('skills/conflict', `a skill named "${name}" already exists`, { name })
    }
    try {
      await mkdir(userRoot, { recursive: true })
      if (isBundle) await cp(source, target, { recursive: true })
      else {
        // A flat file becomes a one-file bundle so the imported shape is uniform.
        await mkdir(target, { recursive: true })
        await cp(skillFile, join(target, 'SKILL.md'))
      }
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `copying ${source} into the user skills root failed: ${messageOf(error)}`, { path: source })
    }
    this.registry().reload()
    return await this.inventory()
  }

  /**
   * The curated gallery of well-known open-source skills. Installation state
   * is answered against the current inventory, so the page renders one call.
   * @returns gallery entries with their install state.
   */
  @Remote
  async gallery(): Promise<SkillGalleryEntry[]> {
    const installed = new Set((await this.inventory()).map(entry => entry.name))
    return SKILL_GALLERY.map(entry => ({ ...entry, installed: installed.has(entry.name) }))
  }

  /**
   * Download one gallery entry's SKILL.md into the user skills root. The
   * fetched document must parse as a skill whose frontmatter name matches the
   * entry, so a redirected or stale URL can never install surprising text.
   * @param id - gallery entry id from `gallery()`.
   * @returns the inventory after the write and rescan.
   * @throws RemoteError when the id is unknown (`skills/not-found`), the name
   *   is occupied (`skills/conflict`), or the fetch or write fails (`skills/io`).
   */
  @Remote
  async installGallery(id: string): Promise<SkillAdminEntry[]> {
    const entry = SKILL_GALLERY.find(candidate => candidate.id === id)
    if (entry === undefined) {
      throw new RemoteError('skills/not-found', `no gallery entry has id "${id}"`, { name: id })
    }
    if ((await this.inventory()).some(candidate => candidate.name === entry.name)) {
      throw new RemoteError('skills/conflict', `a skill named "${entry.name}" already exists`, { name: entry.name })
    }
    let raw: string
    try {
      const response = await fetch(entry.url, { signal: AbortSignal.timeout(GALLERY_FETCH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      raw = await response.text()
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `downloading ${entry.url} failed: ${messageOf(error)}`, {})
    }
    let parsed
    try {
      parsed = parseSkillDocument(raw)
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `the downloaded document is not a valid skill: ${messageOf(error)}`, {})
    }
    if (parsed.name !== entry.name) {
      throw new RemoteError(
        'skills/io',
        `the downloaded document declares "${parsed.name}" but the gallery entry is "${entry.name}"; refusing to install it`,
        {},
      )
    }
    await this.writeDocument(join(this.userSkillsDir(), entry.name), parsed.frontmatter, parsed.content)
    this.registry().reload()
    return await this.inventory()
  }

  /**
   * Extract the user and assistant text of the chosen stored sessions into a
   * forge directory and answer the seed prompt for the distillation session.
   * The new session's agent reads the transcripts, interviews the user, and
   * writes the resulting skill into the user skills root itself.
   * @param request - the stored session ids to distill.
   * @returns the forge directory, transcript files, seed prompt, and the preset
   *   the distillation session runs.
   * @throws RemoteError when no session is selected, a session cannot be read
   *   (`skills/io`), or the persistence service is absent.
   */
  @Remote
  async forge(request: SkillForgeRequest): Promise<SkillForgeResult> {
    const sessionIds = request.sessionIds.filter(id => id.trim().length > 0)
    if (sessionIds.length === 0) {
      throw new RemoteError('skills/invalid-name', 'forge needs at least one session id', { name: 'sessionIds' })
    }
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'session persistence is absent: this deployment cannot read stored sessions',
        {},
      )
    }
    const directory = join(resolveDshHome(), 'skill-forge', `forge-${String(Date.now())}`)
    const files: string[] = []
    for (const [index, sessionId] of sessionIds.entries()) {
      const handle = await persistence.open(SessionId(sessionId), 'read')
      let events: readonly SessionEvent[]
      try {
        events = await handle.read()
      } catch (error: unknown) {
        throw new RemoteError('skills/io', `reading session "${sessionId}" failed: ${messageOf(error)}`, {})
      } finally {
        await handle.close()
      }
      const file = join(directory, `session-${String(index + 1).padStart(2, '0')}.md`)
      files.push(file)
      await mkdir(directory, { recursive: true })
      await writeFile(file, renderTranscript(sessionId, events), 'utf8')
    }
    return { directory, files, seed: forgeSeed(files, sessionIds, this.userSkillsDir()), agentPreset: FORGE_AGENT_PRESET }
  }

  /** The user skills root this surface writes to (`$DSH_HOME/skills`). */
  private userSkillsDir(): string {
    return join(resolveDshHome(), 'skills')
  }

  /** The roots whose files this surface may edit or delete. */
  private writableRoots(): string[] {
    const agentsHome = process.env.DSH_AGENTS_HOME?.trim() || join(homedir(), '.agents')
    return [this.userSkillsDir(), join(agentsHome, 'skills')].map(root => resolve(root))
  }

  /** Whether a skill resource directory sits under a user skills root. */
  private isWritableDirectory(directory: string | undefined): boolean {
    if (directory === undefined) return false
    const resolved = resolve(directory)
    return this.writableRoots().some(root => resolved === root || resolved.startsWith(root + sep))
  }

  /** Write a one-file skill bundle (`<directory>/SKILL.md`). */
  private async writeDocument(directory: string, frontmatter: Record<string, unknown>, content: string): Promise<void> {
    try {
      await mkdir(directory, { recursive: true })
      await writeDocumentFile(join(directory, 'SKILL.md'), frontmatter, content)
    } catch (error: unknown) {
      throw new RemoteError('skills/io', `writing skill "${String(frontmatter.name)}" failed: ${messageOf(error)}`, { path: directory })
    }
  }

  /**
   * Merge the catalog of every view scope a deployment can read. A preset
   * whose standing composition cannot be resolved is skipped with a warning:
   * the remaining layers still answer, and the page stays usable.
   * @returns name-sorted entries, first scope winning a duplicate name.
   */
  private async inventory(): Promise<SkillAdminEntry[]> {
    const registry = this.registry()
    const disabled = new Set(this.settingsScope?.get().disabled ?? [])
    const entries = new Map<string, SkillAdminEntry>()
    for (const scope of await this.viewScopes()) {
      let skills: SkillSummary[]
      try {
        skills = await registry.list(scope === undefined
          ? { includeDisabled: true }
          : { scope, includeDisabled: true })
      } catch (error: unknown) {
        this.ctx.logger.warn(`skills-controller: listing one skill scope failed: ${messageOf(error)}`)
        continue
      }
      for (const skill of skills) {
        if (entries.has(skill.name)) continue
        entries.set(skill.name, toEntry(skill, disabled.has(skill.name)))
      }
    }
    return [...entries.values()].sort((left, right) => compareNames(left.name, right.name))
  }

  /**
   * The registry view scopes the inventory merges: the global layer first, then
   * every preset's standing layer. Repository registrations live in the global
   * layer while a preset's own roots live in its layer, so both are needed to
   * answer "every skill this deployment can serve".
   * @returns the scopes to read, global first.
   */
  private async viewScopes(): Promise<(ScopeKey | undefined)[]> {
    const scopes: (ScopeKey | undefined)[] = [undefined]
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return scopes
    let roster
    try {
      roster = await presets.list()
    } catch (error: unknown) {
      this.ctx.logger.warn(`skills-controller: agent preset roster unavailable: ${messageOf(error)}`)
      return scopes
    }
    for (const preset of roster) {
      if (preset.broken !== undefined) continue
      try {
        scopes.push(await presets.standingKeyFor(preset.id))
      } catch (error: unknown) {
        this.ctx.logger.warn(`skills-controller: preset "${preset.id}" skill scope unavailable: ${messageOf(error)}`)
      }
    }
    return scopes
  }

  /** Resolve the mounted registry or report how to supply it. */
  private registry(): NonNullable<Context['skills']> {
    const registry = this.ctx.get('skills')
    if (registry === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'skill registry is absent: this deployment does not mount @deepseek-ai/dsh-skill in its composition',
        {},
      )
    }
    return registry
  }
}

/** Project one merged summary onto the administration view. */
function toEntry(skill: SkillSummary, disabled: boolean): SkillAdminEntry {
  const base = skill.resourceBase
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    provider: skill.provider,
    ...base?.kind === 'directory' ? { directory: base.path } : {},
    modelInvocable: skill.invocation.modelInvocable,
    userInvocable: skill.invocation.userInvocable,
    disabled,
  }
}

/** Compare names by code point so the stored disable list and the answer agree. */
function compareNames(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Milliseconds a gallery download may take before it is refused. */
const GALLERY_FETCH_TIMEOUT_MS = 20_000

/** Per-message transcript text cap: a single outlier message cannot flood the forge extract. */
const TRANSCRIPT_MESSAGE_CAP = 4_000
/** Per-session transcript cap in characters; extraction stops with a truncation note beyond it. */
const TRANSCRIPT_SESSION_CAP = 120_000

/**
 * The curated gallery of well-known open-source skills. Each entry's `url`
 * points at the upstream raw SKILL.md; the installed document must parse and
 * declare `name` before it is written (see `installGallery`).
 */
const SKILL_GALLERY: readonly (Omit<SkillGalleryEntry, 'installed'> & { readonly url: string })[] = [
  {
    id: 'superpowers-brainstorming',
    name: 'brainstorming',
    description: 'Turn ideas into fully formed designs through collaborative dialogue before any creative work.',
    origin: 'obra/superpowers',
    license: 'MIT',
    repoUrl: 'https://github.com/obra/superpowers',
    url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md',
  },
  {
    id: 'superpowers-systematic-debugging',
    name: 'systematic-debugging',
    description: 'Find the root cause before proposing fixes, for any bug, test failure, or unexpected behavior.',
    origin: 'obra/superpowers',
    license: 'MIT',
    repoUrl: 'https://github.com/obra/superpowers',
    url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md',
  },
  {
    id: 'superpowers-test-driven-development',
    name: 'test-driven-development',
    description: 'Write the failing test first, watch it fail, then write the minimal code to pass.',
    origin: 'obra/superpowers',
    license: 'MIT',
    repoUrl: 'https://github.com/obra/superpowers',
    url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md',
  },
  {
    id: 'superpowers-writing-plans',
    name: 'writing-plans',
    description: 'Write implementation plans as bite-sized tasks with exact files, interfaces, and tests.',
    origin: 'obra/superpowers',
    license: 'MIT',
    repoUrl: 'https://github.com/obra/superpowers',
    url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-plans/SKILL.md',
  },
  {
    id: 'superpowers-requesting-code-review',
    name: 'requesting-code-review',
    description: 'Dispatch a code reviewer subagent to catch issues after tasks and before merging.',
    origin: 'obra/superpowers',
    license: 'MIT',
    repoUrl: 'https://github.com/obra/superpowers',
    url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/requesting-code-review/SKILL.md',
  },
  {
    id: 'anthropics-skill-creator',
    name: 'skill-creator',
    description: 'Create new skills, improve existing ones, and measure skill performance with evals.',
    origin: 'anthropics/skills',
    license: 'Apache-2.0',
    repoUrl: 'https://github.com/anthropics/skills',
    url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md',
  },
]

/** A parsed SKILL.md: the whole frontmatter map plus the fields this surface renders. */
interface ParsedSkillDocument {
  /** Every parsed frontmatter key, preserved across edits. */
  readonly frontmatter: Record<string, unknown>
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly content: string
}

/**
 * Parse one SKILL.md document. The frontmatter must be a YAML map; `name`,
 * `description`, and `whenToUse` default to empty strings when absent, so
 * partially broken files still load for display and the caller decides which
 * fields it refuses.
 * @param raw - complete file text.
 * @returns the parsed document.
 * @throws Error when the frontmatter fences or YAML are malformed.
 */
function parseSkillDocument(raw: string): ParsedSkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (match === null) throw new Error('missing --- frontmatter fences')
  const frontmatterText = match[1] ?? ''
  const body = match[2] ?? ''
  const data: unknown = parseYaml(frontmatterText)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('frontmatter is not a YAML map')
  }
  const frontmatter = data as Record<string, unknown>
  return {
    frontmatter,
    name: typeof frontmatter.name === 'string' ? frontmatter.name : '',
    description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
    whenToUse: typeof frontmatter.whenToUse === 'string' ? frontmatter.whenToUse : '',
    content: body.trim(),
  }
}

/** Serialize one skill document: YAML frontmatter fences, then the trimmed body. */
function renderSkillDocument(frontmatter: Record<string, unknown>, content: string): string {
  return `---\n${stringifyYaml(frontmatter)}---\n\n${content.trim()}\n`
}

/** Write one SKILL.md file, failing as `skills/io` with the path. */
async function writeDocumentFile(file: string, frontmatter: Record<string, unknown>, content: string): Promise<void> {
  try {
    await writeFile(file, renderSkillDocument(frontmatter, content), 'utf8')
  } catch (error: unknown) {
    throw new RemoteError('skills/io', `writing ${file} failed: ${messageOf(error)}`, { path: file })
  }
}

/**
 * Locate one skill's document under its resource directory: a directory
 * bundle's SKILL.md first, then a flat `<name>.md` beside it.
 * @param directory - the skill's resource base.
 * @param name - the skill name.
 * @returns the absolute file path, or undefined when neither exists.
 */
async function skillFileOf(directory: string, name: string): Promise<string | undefined> {
  const bundle = join(directory, 'SKILL.md')
  if (await pathExists(bundle)) return bundle
  const flat = join(directory, `${name}.md`)
  if (await pathExists(flat)) return flat
  return undefined
}

/** Whether a path exists (any kind). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // A missing candidate is the ordinary answer; other access faults read as absent too.
    return false
  }
}

/**
 * Validate one save payload shared by `create` and `update`.
 * @param request - the submitted document.
 * @returns the trimmed, validated fields.
 * @throws RemoteError `skills/invalid-name` when the name is malformed or a required field is empty.
 */
function validateSaveRequest(request: SkillSaveRequest): { name: string; description: string; content: string } {
  const name = request.name.trim()
  if (!isSkillName(name)) {
    throw new RemoteError('skills/invalid-name', `"${request.name}" is not a valid kebab-case skill name`, { name: request.name })
  }
  const description = request.description.trim()
  if (description.length === 0) {
    throw new RemoteError('skills/invalid-name', 'a skill needs a non-empty description', { name })
  }
  const content = request.content.trim()
  if (content.length === 0) {
    throw new RemoteError('skills/invalid-name', 'a skill needs a non-empty body', { name })
  }
  return { name, description, content }
}

/**
 * Scan one external agent skills root: directory bundles holding SKILL.md and
 * flat Markdown files directly under the root. Unparseable entries are listed
 * with an empty description so the page can still offer them by name.
 * @param root - absolute directory to scan.
 * @returns the discovered entries, or undefined when the root does not exist.
 */
async function scanExternalRoot(root: string): Promise<SkillExternalSkill[] | undefined> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    // A missing or unreadable external root is simply not listed.
    return undefined
  }
  const skills: SkillExternalSkill[] = []
  for (const entry of entries) {
    let file: string | undefined
    if (entry.isDirectory()) file = join(root, entry.name, 'SKILL.md')
    else if (entry.isFile() && entry.name.endsWith('.md')) file = join(root, entry.name)
    else continue
    if (!await pathExists(file)) continue
    let name = entry.name.replace(/\.md$/, '')
    let description = ''
    try {
      const parsed = parseSkillDocument(await readFile(file, 'utf8'))
      if (parsed.name !== '') name = parsed.name
      description = parsed.description
    } catch {
      // An unparseable candidate keeps its directory name and an empty description.
    }
    skills.push({
      name,
      description,
      path: entry.isDirectory() ? join(root, entry.name) : file,
    })
  }
  skills.sort((left, right) => compareNames(left.name, right.name))
  return skills
}

/** Render one session's user/assistant text as a forge transcript file. */
function renderTranscript(sessionId: string, events: readonly SessionEvent[]): string {
  const parts: string[] = [`# Session ${sessionId}`, '']
  let budget = TRANSCRIPT_SESSION_CAP
  let truncated = false
  for (const event of events) {
    let role: string | undefined
    let text = ''
    if (event.type === 'user/message') {
      role = 'User'
      text = contentTextOf(event.data.content)
    } else if (event.type === 'assistant/message') {
      role = 'Assistant'
      text = contentTextOf(event.data.message.content)
    }
    if (role === undefined || text === '') continue
    if (text.length > TRANSCRIPT_MESSAGE_CAP) {
      text = `${text.slice(0, TRANSCRIPT_MESSAGE_CAP)}\n[…message truncated…]`
    }
    if (budget - text.length < 0) {
      truncated = true
      break
    }
    budget -= text.length
    parts.push(`## ${role}`, '', text, '')
  }
  if (truncated) parts.push('[…transcript truncated: session exceeds the extract cap…]', '')
  return `${parts.join('\n')}\n`
}

type TranscriptContentBlock = SessionEvent<'user/message'>['data']['content'][number]

/** Join the text blocks of one message; reasoning and tool traffic are not transcript prose. */
function contentTextOf(content: readonly TranscriptContentBlock[]): string {
  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text)
  }
  return texts.map(text => text.trim()).filter(Boolean).join('\n\n')
}

/**
 * The forge session's first prompt: transcript locations, the target skills
 * root, the document format, and the interview-then-write workflow. The agent
 * it starts asks its clarifying questions in the user's own language.
 */
function forgeSeed(files: readonly string[], sessionIds: readonly string[], skillsDir: string): string {
  const transcriptLines = files.map((file, index) => `- ${file}  (session ${sessionIds[index]})`).join('\n')
  return [
    'You are creating a reusable agent skill distilled from past conversations.',
    '',
    '## Source transcripts',
    'Read every transcript file below in full before doing anything else:',
    transcriptLines,
    '',
    '## Your task',
    '1. Read the transcripts and identify the repeatable workflow, conventions, or hard-won lessons they demonstrate — what a future agent should know to do the same kind of work well without rediscovering it.',
    '2. Before writing anything, interview the user with the ask_user tool: confirm which workflow to capture, the skill name they want, and anything ambiguous in the transcripts. Ask at most 3 questions, in the language the user speaks (the transcripts may be Chinese).',
    '3. Write the skill as a single file at:',
    `   ${join(skillsDir, '<name>', 'SKILL.md')}`,
    '   The file must start with YAML frontmatter:',
    '   ```',
    '   ---',
    '   name: <kebab-case-name>',
    '   description: <one or two sentences saying what the skill does and when to use it — write it in both Chinese and English>',
    '   whenToUse: <optional: the concrete situations that should trigger it>',
    '   ---',
    '   ```',
    '   followed by the Markdown instruction body: concrete, imperative, grounded in what the transcripts actually show. Keep it under 500 lines.',
    `4. The name must be kebab-case and must not collide with an existing skill in ${skillsDir}. Create the directory if needed.`,
    '5. When done, tell the user the skill name and path, and summarize in one paragraph what the skill captures.',
    '',
    'Do not ask for confirmation before reading the transcripts — read them first.',
  ].join('\n')
}

export default SkillsController
