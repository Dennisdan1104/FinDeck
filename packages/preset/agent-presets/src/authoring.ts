/**
 * Copying, reading, and deleting locally authored presets.
 *
 * Authoring is confined to a `user` root: the shipped `.system` set is part of
 * the deployment, and letting a browser rewrite it would turn "reset to a known
 * preset" into something the same caller could have broken first. A write names
 * the one root it acts on — the deployment's `user` root, or the project root
 * of the caller's working directory — and every write and delete verifies the
 * resolved directory is that root's own, so neither the shipped set nor a
 * sibling project's presets are reachable.
 *
 * Authoring writes are a whole-directory copy of an existing preset and the
 * {@link METADATA_FILE} document written into a preset authoring owns. No
 * caller supplies composition text: the inputs are ids the host resolves
 * against its own roots plus an optional display name, so authoring grants no
 * capability the copied preset did not already carry.
 * @module @deepseek-ai/dsh-agent-presets/authoring
 */

import { chmod, cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { METADATA_FILE, renderPresetMetadata, type PresetMetadata } from './metadata.ts'
import type { FlowStep } from './mode.ts'
import { PRESET_ID, type AgentPreset, type PresetRoot } from './preset.ts'

/**
 * Refuse one authoring request the deployment does not allow.
 * @param presetId - what the caller tried to change, for the diagnostic.
 * @param reason - why authoring is refused.
 * @returns the failure to throw.
 */
export function notWritable(presetId: string, reason: string): RemoteError<'agent-preset/read-only'> {
  return new RemoteError(
    'agent-preset/read-only',
    `agent-presets: preset "${presetId}" cannot be written: ${reason}`,
    { agentPreset: presetId, reason },
  )
}

/**
 * Refuse a copy onto an id something already occupies. Both the roster check
 * and the on-disk check answer with it, so a taken id reads the same either way.
 * @param presetId - the id that is already taken.
 * @returns the failure to throw.
 */
export function presetExists(presetId: string): RemoteError<'agent-preset/invalid'> {
  const reason = `preset "${presetId}" already exists — `
    + 'a copy never overwrites; delete the existing preset first or choose another id'
  return new RemoteError('agent-preset/invalid', `agent-presets: ${reason}`, { agentPreset: presetId, reason })
}

/**
 * Refuse a preset id that cannot name a directory under the writable root.
 *
 * The id becomes a path segment, so this is a containment check rather than a
 * style rule: `..`, a separator, or an absolute-looking name would place the
 * authored directory outside the root the deployment authorised.
 * @param presetId - the id to check.
 * @throws {RemoteError} `agent-preset/invalid` when the id is unusable.
 */
function assertPresetId(presetId: string): void {
  if (PRESET_ID.test(presetId)) return
  const reason = `preset id ${JSON.stringify(presetId)} must match ${String(PRESET_ID)} — `
    + 'the id is a directory name, so anything else could escape the preset root'
  throw new RemoteError('agent-preset/invalid', `agent-presets: ${reason}`, { agentPreset: presetId, reason })
}

/** The absolute path of one preset's directory under the writable root. */
function presetDir(root: string, presetId: string): string {
  assertPresetId(presetId)
  return join(root, presetId)
}

/**
 * The directory one resolved preset's authoring writes target.
 *
 * The id becomes a path segment and the resolved directory must still be the
 * one the writable root owns: with more than one `user` root configured, a
 * write aimed at one root would create a directory of the same name beside the
 * preset another root supplied, and discovery — reading roots in order — would
 * report that new directory broken and prefer it over the real preset.
 * Deletion and the document write share this check so neither can drift from
 * the other.
 * @param root - the absolute writable root the write targets.
 * @param preset - the resolved preset the write or delete targets.
 * @returns the absolute path of the preset's own directory.
 * @throws {RemoteError} `agent-preset/read-only` when the preset lies outside
 * that root.
 */
function ownedPresetDir(root: string, preset: AgentPreset): string {
  const dir = presetDir(root, preset.id)
  // Belt and braces over the id pattern: whatever discovery reported, the
  // directory rewritten or removed must be the one this root owns.
  if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) {
    throw notWritable(preset.id, 'it does not live under the writable preset root')
  }
  return dir
}

/**
 * Write one preset's metadata file into the directory authoring owns for it.
 *
 * Only {@link METADATA_FILE} is written: the composition beside it is what the
 * session will mount, and no authoring caller supplies composition text.
 * @param root - the absolute writable root the write targets.
 * @param preset - the resolved preset receiving the document; its own
 * directory is the write target, so a rewrite cannot land in another root
 * beside the preset it resolved.
 * @param content - the complete rendered document.
 * @throws {RemoteError} `agent-preset/read-only` when the preset lies outside
 * that root.
 */
export async function writePresetDocument(
  root: string,
  preset: AgentPreset,
  content: string,
): Promise<void> {
  const dir = ownedPresetDir(root, preset)
  await writeFileAtomic(join(dir, METADATA_FILE), content, { mode: 0o600, dirMode: 0o700 })
}

/**
 * The root locally authored presets are written to.
 * @param roots - the configured roots in precedence order.
 * @param presetId - the preset the caller is authoring, named by the refusal.
 * @returns the absolute path of the first `user` root.
 * @throws when the deployment configured no writable root.
 */
export function writableRoot(roots: readonly PresetRoot[], presetId: string): string {
  const root = roots.find(candidate => candidate.trust === 'user')
  if (root === undefined) {
    throw notWritable(presetId, 'this deployment configures no user-writable preset root')
  }
  return resolve(expandHomePath(root.path))
}

/**
 * Read one preset's composition text.
 * @param preset - the resolved preset.
 * @returns the file's contents.
 */
export async function readComposition(preset: AgentPreset): Promise<string> {
  return await readFile(preset.path, 'utf8')
}

/**
 * Render one preset's metadata file: the display half plus the semantic mode
 * declaration. Both halves live in {@link METADATA_FILE}, so they are written
 * by one renderer — a second writer would have to reproduce this file's
 * ordering and quoting.
 *
 * The mode is derived from the pair, so the two declarations cannot disagree:
 * steps make it `work`, an empty list makes it `free`, and `undefined` stores
 * no mode at all — which is how a preset that never declared one reads back.
 * @param metadata - the display text to store.
 * @param steps - the work-mode steps, `[]` for a declared free mode, or
 * undefined for no mode declaration.
 * @returns the YAML document, or undefined when there is nothing to store.
 */
export function renderPresetDocument(
  metadata: PresetMetadata,
  steps?: readonly FlowStep[],
): string | undefined {
  const display = renderPresetMetadata(metadata)
  if (steps === undefined) return display
  // Every free-text scalar is emitted double-quoted, so a value carrying YAML
  // punctuation or a line break stays one value: `id` is the only entry field
  // the step-id rule already proves safe as a plain scalar.
  const entries = steps.flatMap(step => [
    `    - id: ${step.id}`,
    `      label: ${JSON.stringify(step.label)}`,
    `      model: ${JSON.stringify(step.model)}`,
    ...step.prompt === undefined ? [] : [`      prompt: ${JSON.stringify(step.prompt)}`],
    ...step.cluster === undefined ? [] : [
      '      cluster:',
      ...step.cluster.perspectives === undefined ? [] : [
        '        perspectives:',
        ...step.cluster.perspectives.map(viewpoint => `          - ${JSON.stringify(viewpoint)}`),
      ],
      ...step.cluster.strategy === undefined ? [] : [`        strategy: ${JSON.stringify(step.cluster.strategy)}`],
    ],
  ])
  return [
    ...display === undefined ? [] : [display.trimEnd()],
    steps.length === 0 ? 'mode_kind: free' : 'mode_kind: work',
    ...steps.length === 0 ? [] : ['flow:', '  steps:', ...entries],
    '',
  ].join('\n')
}

/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
async function occupied(path: string): Promise<boolean> {
  let present = true
  try {
    await stat(path)
  } catch {
    // Every stat failure means the same thing here: nothing usable occupies
    // the path, so the copy may claim it.
    present = false
  }
  return present
}

/**
 * Re-tighten a copied tree to owner-only. A shipped preset is world-readable
 * in its install and `cp` preserves that; the copy carries the same weight as
 * the settings document beside it, so group/other access is stripped. A
 * file's owner-execute bit survives — a preset may ship runnable helpers.
 */
async function tightenModes(dir: string): Promise<void> {
  await chmod(dir, 0o700)
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) {
      await tightenModes(target)
    } else {
      /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
      await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
    }
  }
}

/**
 * Create a preset by copying an existing one's whole directory.
 *
 * The copy carries everything the source directory holds — composition,
 * metadata, skill directories, assets — because a preset is its directory,
 * not one file. Symlinks are dereferenced so the copy is self-contained
 * rather than a set of links back into the install it was copied from.
 *
 * The copied metadata is then rewritten: the source's description is kept
 * unless the caller states one (the file is the author's to edit afterwards),
 * but its name and roster `order` are not — a copy presenting itself
 * identically to its source, or sorted into the shipped set's declared order,
 * would make the roster stop distinguishing them. With no name given and no
 * description to keep, the file is removed so the copy publishes nothing
 * rather than a blank.
 * @param root - the absolute writable root the copy lands in; the project root
 * for a project-scoped preset, otherwise the deployment's first `user` root.
 * @param source - the resolved preset the copy starts from.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; omitted falls back to the id.
 * @param description - description the copy publishes; omitted keeps the
 * source's own.
 * @returns the absolute path of the new preset directory.
 * @throws when the id is unusable or already occupied on disk.
 */
export async function copyComposition(
  root: string,
  source: AgentPreset,
  id: string,
  name?: string,
  description?: string,
): Promise<string> {
  const dir = presetDir(root, id)
  // The roster check upstream only sees discovered presets; a directory with
  // no composition file still occupies the name and deserves a readable
  // refusal rather than a filesystem error code.
  if (await occupied(dir)) throw presetExists(id)
  try {
    await cp(dirname(source.path), dir, {
      recursive: true, dereference: true, force: false, errorOnExist: true,
    })
    await tightenModes(dir)
    const kept = description ?? source.description
    const rendered = renderPresetMetadata({
      ...name === undefined ? {} : { name },
      ...kept === undefined ? {} : { description: kept },
    })
    const metadataPath = join(dir, METADATA_FILE)
    if (rendered === undefined) {
      await rm(metadataPath, { force: true })
    } else {
      await writeFileAtomic(metadataPath, rendered, { mode: 0o600, dirMode: 0o700 })
    }
  } catch (error) {
    // A half-copied directory would be invisible to discovery at best and a
    // mountable-but-incomplete preset at worst; a failed copy leaves nothing.
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}

/**
 * Delete a locally authored preset.
 *
 * A shipped preset is refused: it belongs to the deployment. A preset a live
 * session mounted is NOT refused — the composition was read at creation and is
 * never re-read, so that session keeps running exactly as it was.
 * @param root - the absolute writable root the preset is deleted from.
 * @param preset - the resolved preset to remove.
 * @throws when the preset ships with the deployment or lies outside the writable root.
 */
export async function deleteComposition(
  root: string,
  preset: AgentPreset,
): Promise<void> {
  if (preset.trust !== 'user') {
    throw notWritable(preset.id, 'it ships with the deployment')
  }
  await rm(ownedPresetDir(root, preset), { recursive: true, force: true })
}
